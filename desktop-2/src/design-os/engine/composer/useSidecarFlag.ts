/**
 * useSidecarFlag · Composer Class B · runtime flag React hook.
 *
 * ⚠ IRON GATE IG-COMPOSER-EE · Sidecar flag hook contract.
 *
 * React wrapper over setSidecarFlag() so Composer panels can flip
 * sidecar env-var gates from a toggle without every panel importing
 * sidecar-stub directly. Local state mirrors the last accepted value
 * so a toggle can render immediately without waiting for the RPC
 * round-trip · when the sidecar returns, we reconcile.
 *
 * Master plan Class B features consumed via this hook:
 *   * B1 silence removal · JUNIOR_SILENCE_REMOVE
 *   * B3 karaoke captions · JUNIOR_ANIMATED_CAPTIONS
 *   * (adjacent) voice enhance · JUNIOR_VOICE_ENHANCE
 */

import { useCallback, useState } from "react";
import { setSidecarFlag, type SidecarFlagName } from "../sidecar-stub";

export interface UseSidecarFlagReturn {
  value: boolean;
  pending: boolean;
  error: string | null;
  set: (next: boolean) => Promise<void>;
  toggle: () => Promise<void>;
}

export function useSidecarFlag(
  name: SidecarFlagName,
  initial: boolean = false,
): UseSidecarFlagReturn {
  const [value, setValue] = useState<boolean>(initial);
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(
    async (next: boolean) => {
      setError(null);
      setPending(true);
      // Optimistic render · UI shows the toggled state before the RPC
      // finishes so the panel feels snappy.
      setValue(next);
      try {
        const resp = await setSidecarFlag(name, next);
        // Reconcile against what the sidecar accepted · the string
        // "0" / "" / null / "off" all mean "off"; anything else means "on".
        const accepted = resp.value !== null && resp.value !== "0" && resp.value !== "" && resp.value.toLowerCase() !== "off" && resp.value.toLowerCase() !== "false";
        setValue(accepted);
      } catch (err) {
        setError(err instanceof Error ? err.message : "sidecar flag error");
        setValue(!next); // rollback the optimistic write
      } finally {
        setPending(false);
      }
    },
    [name],
  );

  const toggle = useCallback(() => set(!value), [value, set]);

  return { value, pending, error, set, toggle };
}
