// Browser/WebView port of electron/crypto.ts — runs the same self-contained
// WASM signer (no imports, secret baked in) inside the iOS WKWebView so API
// request signing works without the Electron main process.
import { SIGNER_WASM_BASE64 } from "../../../electron/signer";

export interface SignRequestInput {
  method: string;
  path: string;
  body?: string | null;
  timestamp?: number;
}

export interface SignedRequestHeaders {
  signature: string;
  timestamp: number;
  nonce: string;
}

interface WasmSignerExports {
  liner_alloc: (len: number) => number;
  liner_dealloc: (ptr: number, len: number) => void;
  liner_get_result_ptr: () => number;
  liner_get_result_len: () => number;
  liner_sign_cover_url: (ptr: number, len: number) => number;
  liner_sign_request: (
    method_ptr: number,
    method_len: number,
    path_ptr: number,
    path_len: number,
    body_ptr: number,
    body_len: number,
    timestamp: bigint,
    nonce_ptr: number,
    nonce_len: number,
  ) => number;
  liner_sign_monitor_request: (
    method_ptr: number,
    method_len: number,
    path_ptr: number,
    path_len: number,
    body_ptr: number,
    body_len: number,
    timestamp: bigint,
    nonce_ptr: number,
    nonce_len: number,
  ) => number;
  liner_sign_raw_payload: (ptr: number, len: number) => number;
  memory: WebAssembly.Memory;
}

let serverTimeOffsetMs = 0;

export function setServerTimeOffset(offsetMs: number): void {
  if (Number.isFinite(offsetMs)) serverTimeOffsetMs = offsetMs;
}

export function syncServerTime(dateHeaderOrMs: string | number | Date): number {
  const serverMs =
    typeof dateHeaderOrMs === "number"
      ? dateHeaderOrMs
      : typeof dateHeaderOrMs === "string"
        ? Date.parse(dateHeaderOrMs)
        : dateHeaderOrMs.getTime();
  if (!Number.isNaN(serverMs) && serverMs > 0) {
    serverTimeOffsetMs = serverMs - Date.now();
  }
  return serverTimeOffsetMs;
}

export function getServerTimeOffset(): number {
  return serverTimeOffsetMs;
}

function getAdjustedTimestamp(): number {
  return Math.floor((Date.now() + serverTimeOffsetMs) / 1000);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomNonceHex(bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

let wasmExportsInstance: WasmSignerExports | null = null;

function getWasmExports(): WasmSignerExports {
  if (wasmExportsInstance) return wasmExportsInstance;
  const wasmBuffer = base64ToBytes(SIGNER_WASM_BASE64);
  const wasmModule = new WebAssembly.Module(wasmBuffer.buffer as ArrayBuffer);
  const wasmInstance = new WebAssembly.Instance(wasmModule, {});
  wasmExportsInstance = wasmInstance.exports as unknown as WasmSignerExports;
  return wasmExportsInstance;
}

function passStringToWasm(
  exports: WasmSignerExports,
  str: string,
): { ptr: number; len: number; free: () => void } {
  const bytes = encoder.encode(str);
  const ptr = exports.liner_alloc(bytes.length);
  const memoryView = new Uint8Array(exports.memory.buffer, ptr, bytes.length);
  memoryView.set(bytes);
  return {
    ptr,
    len: bytes.length,
    free: () => exports.liner_dealloc(ptr, bytes.length),
  };
}

function readResultFromWasm(exports: WasmSignerExports): string {
  const ptr = exports.liner_get_result_ptr();
  const len = exports.liner_get_result_len();
  if (!ptr || len === 0) return "";
  const memoryView = new Uint8Array(exports.memory.buffer, ptr, len);
  return decoder.decode(memoryView);
}

export function signCoverUrl(payload: string): string {
  const wasm = getWasmExports();
  const payloadBuf = passStringToWasm(wasm, payload);
  try {
    const code = wasm.liner_sign_cover_url(payloadBuf.ptr, payloadBuf.len);
    if (code !== 0) throw new Error(`wasm sign_cover_url failed (${code})`);
    return readResultFromWasm(wasm);
  } finally {
    payloadBuf.free();
  }
}

function signWith(
  fn: "liner_sign_request" | "liner_sign_monitor_request",
  input: SignRequestInput,
): SignedRequestHeaders {
  const wasm = getWasmExports();
  const timestamp = input.timestamp ?? getAdjustedTimestamp();
  const nonce = randomNonceHex();
  const methodBuf = passStringToWasm(wasm, input.method);
  const pathBuf = passStringToWasm(wasm, input.path);
  const bodyBuf = passStringToWasm(wasm, input.body ?? "");
  const nonceBuf = passStringToWasm(wasm, nonce);
  try {
    const code = wasm[fn](
      methodBuf.ptr,
      methodBuf.len,
      pathBuf.ptr,
      pathBuf.len,
      bodyBuf.ptr,
      bodyBuf.len,
      BigInt(timestamp),
      nonceBuf.ptr,
      nonceBuf.len,
    );
    if (code !== 0) throw new Error(`wasm ${fn} failed (${code})`);
    return { signature: readResultFromWasm(wasm), timestamp, nonce };
  } finally {
    methodBuf.free();
    pathBuf.free();
    bodyBuf.free();
    nonceBuf.free();
  }
}

export function signRequest(input: SignRequestInput): SignedRequestHeaders {
  return signWith("liner_sign_request", input);
}

export function signMonitorRequest(
  input: SignRequestInput,
): SignedRequestHeaders {
  return signWith("liner_sign_monitor_request", input);
}

export function signRawPayload(payload: number[] | Uint8Array): string {
  const wasm = getWasmExports();
  const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const ptr = wasm.liner_alloc(bytes.length);
  const memoryView = new Uint8Array(wasm.memory.buffer, ptr, bytes.length);
  memoryView.set(bytes);
  try {
    const code = wasm.liner_sign_raw_payload(ptr, bytes.length);
    if (code !== 0) throw new Error(`wasm sign_raw_payload failed (${code})`);
    return readResultFromWasm(wasm);
  } finally {
    wasm.liner_dealloc(ptr, bytes.length);
  }
}
