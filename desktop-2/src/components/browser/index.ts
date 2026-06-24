// Browser overlay barrel — v1, iframe only, no Tauri webview.

export { BrowseOverlay } from "./BrowseOverlay";
export { BrowserScrim } from "./BrowserScrim";
export { BrowseRailTab } from "./BrowseRailTab";
export {
  useBrowseOverlay,
  urlIsLikelyBlocked,
  WHOP_REWARDS_URL,
  type BrowseIntent,
  type LoadState,
  type EngineHandoff,
} from "../../state/browseOverlay";
