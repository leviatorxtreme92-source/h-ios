// Side-effect module: installs the Capacitor/iOS `window.linerElectron` bridge
// as early as possible. On desktop (Electron) the real preload already set it,
// so installCapacitorBridge() is a no-op there.
import { installCapacitorBridge } from "./capacitorBridge";

installCapacitorBridge();
