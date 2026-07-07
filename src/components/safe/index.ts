/**
 * Safe primitives · consistent error + loading behavior for media.
 *
 * Migration pattern from raw <img> / <video>:
 *   import { SafeImg, SafeVideo } from "../components/safe";
 *
 * See docstrings on each component for full API.
 */

export { SafeImg } from "./SafeImg";
export type { SafeImgProps, SafeImgFallback } from "./SafeImg";

export { SafeVideo } from "./SafeVideo";
export type { SafeVideoProps } from "./SafeVideo";
