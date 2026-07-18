/**
 * ComposerKade · Sprint 3 E4 · absolute-positioned Kade portrait inside
 * the Composer canvas.
 *
 * ⚠ IRON GATE IG-COMPOSER-W · Composer Kade canvas contract.
 *
 * Kade portrait mounted absolutely inside .lc-composer. Two channels
 * drive it:
 *   * kade:move  → transform:translate(x, y) over ms · turbo-clamped.
 *   * kade:pose  → swap the img src to POSES[pose] (falls back to idle).
 *
 * Distinct from StickyKade (shell-level sticky wrapper). This is the
 * in-canvas actor that reacts to per-flow beats · Composer moveKade
 * calls nudge it to left/right corners on flow enter, back to centre
 * on idle. Turbo scaling honoured via clampMoveDuration().
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useEvent } from "../../bridge/useEvent";
import { POSES, type KadePose } from "./kadePoses";
import { clampMoveDuration, parseKadePos } from "./kadeMove";
import "./ComposerKade.css";

export interface ComposerKadeProps {
  /** Whether the composer root is in turbo mode. When true, move
   *  durations are clamped to 40ms per IG-COMPOSER-D. */
  turbo?: boolean;
}

interface Position {
  x: number;
  y: number;
  ms: number;
}

const HOME_POSITION: Position = { x: 0, y: 0, ms: 200 };

export function ComposerKade(props: ComposerKadeProps): ReactElement {
  const { turbo = false } = props;
  const [pose, setPose] = useState<KadePose>("idle");
  const [position, setPosition] = useState<Position>(HOME_POSITION);

  useEvent("kade:move", (payload) => {
    setPosition({ x: payload.x, y: payload.y, ms: payload.ms });
  });

  useEvent("kade:pose", (payload) => {
    // Coerce unknown pose to idle · matches setPose fallback behaviour
    // in kadePoses.ts.
    const next = (payload.pose in POSES ? payload.pose : "idle") as KadePose;
    setPose(next);
  });

  const style = useMemo(() => {
    const dur = clampMoveDuration(position.ms, turbo);
    return {
      transform: `translate(${position.x}px, ${position.y}px)`,
      transitionDuration: `${dur}ms`,
    };
  }, [position.x, position.y, position.ms, turbo]);

  // Sync data-kade-pos so DevTools / QA can read the current position
  // string without parsing the transform. Round-trippable via
  // parseKadePos() (IG-COMPOSER-P helper).
  const dataPos = useMemo(() => {
    return `${Math.round(position.x)},${Math.round(position.y)}`;
  }, [position.x, position.y]);

  // Assert the data-kade-pos formatter contract in dev builds.
  useEffect(() => {
    if (import.meta.env?.DEV) {
      const parsed = parseKadePos(dataPos);
      if (!parsed) {
        // eslint-disable-next-line no-console
        console.warn("ComposerKade · data-kade-pos malformed:", dataPos);
      }
    }
  }, [dataPos]);

  return (
    <img
      className="lc-composer-kade"
      data-testid="composer-kade"
      data-kade-pose={pose}
      data-kade-pos={dataPos}
      data-turbo={turbo ? "true" : "false"}
      src={POSES[pose]}
      alt=""
      aria-hidden="true"
      style={style}
    />
  );
}

export default ComposerKade;
