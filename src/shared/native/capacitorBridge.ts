// iOS/Capacitor bridge: provides a `window.linerElectron` implementation inside
// the WebView so the existing renderer runs unchanged.
//
// Only request signing + server-time really matter: the app already falls back
// to localStorage for the auth session when `authSession` is absent (see
// src/shared/api/auth-session.ts -> refreshHere), so we intentionally leave
// `authSession` undefined and stub every desktop-only capability as a no-op.
import {
  signRequest,
  signMonitorRequest,
  signCoverUrl,
  signRawPayload,
  syncServerTime,
  getServerTimeOffset,
  setServerTimeOffset,
} from "./wasmSigner";

const noop = (): void => {};
const unsub = (): (() => void) => () => {};
const resolve =
  <T>(value: T) =>
  (): Promise<T> =>
    Promise.resolve(value);

let edgeKey: string | null = null;

export function installCapacitorBridge(): void {
  if (typeof window === "undefined") return;
  if ((window as unknown as { linerElectron?: unknown }).linerElectron) return;

  const api = {
    platform: "ios",
    isHyprland: false,

    // --- window chrome (no-ops on iOS) ---
    minimize: resolve(undefined),
    toggleMaximize: resolve(undefined),
    toggleFullScreen: resolve(undefined),
    close: resolve(undefined),
    isMaximized: resolve(false),
    isFullScreen: resolve(false),
    getRememberWindowBounds: resolve(false),
    setRememberWindowBounds: resolve(false),
    onWindowStateChange: unsub,
    onWindowRestored: unsub,
    onWindowMinimized: unsub,
    notePresence: noop,
    dragStart: noop,
    dragMove: noop,
    dragEnd: noop,

    // --- signing (REAL, via WASM) ---
    signRequest: async (input: {
      method: string;
      path: string;
      body?: string | null;
      timestamp?: number;
    }) => {
      try {
        return signRequest(input);
      } catch (e) {
        return { error: String(e) };
      }
    },
    signMonitorRequest: async (input: {
      method: string;
      path: string;
      body?: string | null;
      timestamp?: number;
    }) => {
      try {
        return signMonitorRequest(input);
      } catch (e) {
        return { error: String(e) };
      }
    },
    syncServerTime: async (dateHeaderOrMs: string | number) =>
      syncServerTime(dateHeaderOrMs),
    setEdgeKey: (key: string | null) => {
      edgeKey = key;
      void edgeKey;
    },
    getServerTimeOffset: async () => getServerTimeOffset(),
    signCoverUrl: async (payload: string) => signCoverUrl(payload),
    signRawPayload: async (payload: number[] | Uint8Array) =>
      signRawPayload(payload),

    // authSession intentionally omitted -> renderer uses localStorage fallback.

    youtubeAuthSession: {
      get: () => null,
      set: resolve(null),
    },

    onDeeplink: unsub,
    diagnoseNetwork: resolve({} as never),
    probeNetwork: resolve({} as never),
    openDownloads: resolve(false),
    openExportFolder: resolve(false),
    setAppIcon: resolve(undefined),
    getAppVersion: resolve(
      (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ ?? "0.2.12",
    ),
    getCacheStats: resolve({
      cacheSize: 0,
      httpCacheSize: 0,
      codeCacheSize: 0,
      serviceWorkerSize: 0,
      indexedDbSize: 0,
      localStorageSize: 0,
      blobStorageSize: 0,
      cachePath: "",
    }),
    openCacheFolder: resolve(false),
    clearCoversCache: resolve(true),
    clearAudioCache: resolve(true),
    clearHttpCache: resolve(true),

    // --- updater (disabled) ---
    checkForUpdates: resolve({ available: false }),
    downloadUpdate: resolve({ success: false }),
    quitAndInstall: resolve(false),
    onUpdateAvailable: unsub,
    onUpdateDownloadProgress: unsub,
    onUpdateDownloaded: unsub,
    onUpdateError: unsub,

    // --- OTA bundle (disabled) ---
    bundleCheck: resolve({ available: false }),
    bundleDownloadAndInstall: resolve({ success: false }),
    bundleHotSwap: resolve(false),
    bundleRollback: resolve(false),
    bundleGetStatus: resolve({
      appVersion: "0.2.12",
      bundleVersion: "0.2.12",
      isOta: false,
      sha256: null,
      effectivePath: "",
    }),
    onBundleAvailable: unsub,
    onBundleDownloadProgress: unsub,
    onBundleReady: unsub,
    onBundleStamp: unsub,

    // --- touchbar / overlay / discord (desktop-only no-ops) ---
    touchbarUpdateState: noop,
    onTouchBarAction: unsub,
    sendTouchBarAction: noop,
    getTouchBarInitialState: resolve(null),
    onTouchBarRequestSync: unsub,
    overlayUpdateState: noop,
    overlayReady: noop,
    onOverlayAction: unsub,
    sendOverlayAction: noop,
    toggleOverlay: resolve(false),
    isOverlayOpen: resolve(false),
    closeOverlay: noop,
    onOverlayState: unsub,
    getOverlayInitialState: resolve(null),
    updateOverlaySettings: noop,
    pauseOverlayShortcuts: noop,
    getShortcutStatus: resolve({} as Record<string, string>),
    onShortcutStatus: unsub,
    onOverlaySettingsChanged: unsub,
    onOverlayVisibility: unsub,
    setOverlayAuthenticated: noop,
    discordUpdateState: noop,
    discordUpdateSettings: noop,
    getDiscordStatus: resolve({ connected: false }),

    // --- youtube helpers (fallback path; may be unavailable on iOS) ---
    mintPoToken: resolve(""),
    youtubeTvSession: resolve({} as never),
    youtubeSolveN: resolve({} as never),

    // --- local / saved tracks (no filesystem on iOS v1) ---
    localTracksList: resolve([]),
    localTracksImport: resolve({} as never),
    localTracksPick: resolve(null),
    localTracksRemove: resolve(undefined),
    localTracksRemoveAll: resolve(0),
    localTracksUsage: resolve({} as never),
    savedTracksList: resolve([]),
    savedTracksSave: resolve(null),
    savedTracksRemove: resolve(0),
    savedTracksRemoveAll: resolve(0),
    savedTracksUsage: resolve({} as never),
    savedTracksUsageOf: resolve({} as never),
    savedTracksOpenFolder: resolve(false),
    savedTracksGetLyrics: resolve(null),
    savedTracksSetLyrics: resolve(false),
    pathForFile: () => "",
  };

  setServerTimeOffset(0);
  (window as unknown as { linerElectron: unknown }).linerElectron = api;
}
