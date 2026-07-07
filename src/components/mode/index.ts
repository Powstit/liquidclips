// Mode-system barrel exports.
// Simulator-only; no auth or billing wiring.

export { ModeStrip } from "./ModeStrip";
export { ModeBadge } from "./ModeBadge";
export { CapabilityLock } from "./CapabilityLock";
export { GemPillToggle } from "./GemPillToggle";
export { useModeStore, type UserMode, DEFAULT_MODE, MODE_STORAGE_KEY } from "../../state/mode";
