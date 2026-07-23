/**
 * useRemoteControl · SSE-driven remote-control hook.
 *
 * On mount:
 *   1. Gates on `founder_flag` from useMe · non-founder returns early.
 *   2. Gates on session opt-in (localStorage `lc.remote.consent` === "1").
 *   3. Opens EventSource(`/remote/stream`) with License JWT.
 *   4. Every `event: command` chunk → dispatchRemoteCommand → POST /remote/ack.
 *
 * Kill switch: ⌘⇧K (Cmd+Shift+K) instantly closes the stream + clears
 * the consent flag for this session.
 *
 * ⛔ IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY · founder-flag check MUST
 *    happen BEFORE opening the stream. Removing that check exposes
 *    every user to remote drive.
 *
 * 2026-07-22 · Sprint remote-1
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "../design-os/state/useMe";
import { getJwt } from "./authStorage";
import { dispatchRemoteCommand, type RemoteCommand } from "./remoteControlDispatch";
import { lcDiag } from "./diagnosticLogger";
import { useRemoteStatus } from "./remoteControlStatus";
import { getBrain } from "./composerBrainRegistry";

const BACKEND_URL =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL?.replace(
    /\/+$/,
    "",
  ) ?? "https://api.liquidclips.app";

const CONSENT_KEY = "lc.remote.consent";
const LOG_KEY = "lc.remote.log";
const LOG_CAP = 40;

export interface RemoteLogEntry {
  ts: number;
  id: string;
  kind: string;
  result: string;
  ok: boolean;
}

export interface RemoteControlState {
  active: boolean;
  hasConsent: boolean;
  isFounder: boolean;
  lastError: string | null;
  log: readonly RemoteLogEntry[];
}

export interface RemoteControlActions {
  optIn: () => void;
  killSwitch: () => void;
}

function readLog(): RemoteLogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as RemoteLogEntry[]) : [];
  } catch { return []; }
}

function writeLog(entries: RemoteLogEntry[]): void {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(0, LOG_CAP)));
  } catch { /* silent · quota */ }
}

export function useRemoteControl(): RemoteControlState & RemoteControlActions {
  const me = useMe();
  // 2026-07-22 · read the actual MeApi.snapshot shape · admin-email
  // override + platformRole="admin" both flag a founder here. The prior
  // `me.founder_flag` was reading undefined on every mount, silently
  // gating every founder out of the SSE stream. Fix in 2.3.16.
  const snap = (me as { snapshot?: { adminOverride?: boolean | null; platformRole?: string | null } } | null | undefined)?.snapshot;
  const isFounder: boolean = Boolean(snap?.adminOverride) || snap?.platformRole === "admin";
  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    try { return window.localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; }
  });
  const [active, setActive] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [log, setLog] = useState<readonly RemoteLogEntry[]>(() => readLog());
  const esRef = useRef<EventSource | null>(null);

  const appendLog = useCallback((entry: RemoteLogEntry) => {
    setLog((prev) => {
      const next = [entry, ...prev].slice(0, LOG_CAP);
      writeLog(next);
      return next;
    });
  }, []);

  const executeAndAck = useCallback(async (cmd: RemoteCommand) => {
    let result;
    try {
      const brain = getBrain();
      // brain-free commands (state.snapshot / composer.forceShell /
      // composer.clearSession / nav.click) work without composer mounted;
      // dispatch handles that. Only submit/pickFile/acceptSource need brain.
      result = await dispatchRemoteCommand(cmd, { brain });
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      result = { ok: false as const, kind: cmd.kind, error: msg };
    }
    appendLog({
      ts: Date.now(),
      id: cmd.id,
      kind: cmd.kind,
      ok: result.ok,
      result: result.ok ? JSON.stringify(result.data ?? {}).slice(0, 200) : `ERROR: ${result.error}`,
    });
    // Ack the server with the result.
    try {
      const jwt = getJwt();
      if (!jwt) throw new Error("no jwt");
      await fetch(`${BACKEND_URL}/remote/ack/${cmd.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", "Authorization": `Bearer ${jwt}` },
        body: JSON.stringify({ result }),
      });
    } catch (exc) {
      void lcDiag("remote_ack_failed", { id: cmd.id, message: (exc as Error).message?.slice(0, 200) });
    }
  }, [appendLog]);

  const openStream = useCallback(() => {
    if (esRef.current) return;
    const jwt = getJwt();
    if (!jwt) {
      setLastError("no jwt · sign in first");
      return;
    }
    // EventSource does not accept custom headers, so we pass the JWT
    // as a query param. Backend accepts both (Bearer + ?jwt=). If the
    // backend rejects, the SSE stream falls to onerror.
    const url = `${BACKEND_URL}/remote/stream?jwt=${encodeURIComponent(jwt)}`;
    const es = new EventSource(url);
    esRef.current = es;
    setLastError(null);

    es.addEventListener("hello", (evt) => {
      void lcDiag("remote_stream_hello", { data: (evt as MessageEvent).data?.slice?.(0, 200) });
      setActive(true);
    });

    es.addEventListener("command", (evt) => {
      try {
        const cmd = JSON.parse((evt as MessageEvent).data) as RemoteCommand;
        void executeAndAck(cmd);
      } catch (exc) {
        void lcDiag("remote_stream_parse_failed", {
          message: (exc as Error).message?.slice(0, 200),
        });
      }
    });

    es.addEventListener("heartbeat", () => {
      // no-op · just keeps the connection alive
    });

    es.onerror = () => {
      setLastError("stream error · will auto-reconnect");
      // EventSource auto-reconnects · we just note the error.
      setActive(false);
    };
  }, [executeAndAck]);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setActive(false);
  }, []);

  const optIn = useCallback(() => {
    try { window.localStorage.setItem(CONSENT_KEY, "1"); } catch { /* silent */ }
    setHasConsent(true);
  }, []);

  const killSwitch = useCallback(() => {
    try { window.localStorage.removeItem(CONSENT_KEY); } catch { /* silent */ }
    setHasConsent(false);
    closeStream();
    void lcDiag("remote_kill_switch_fired", {});
  }, [closeStream]);

  // Open / close based on guards
  useEffect(() => {
    if (!isFounder || !hasConsent) {
      closeStream();
      return;
    }
    openStream();
    return () => closeStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFounder, hasConsent]);

  // Publish state to the app-wide Zustand slot so a HUD pill can render
  // OUTSIDE the composer route (visible on Home, Wallet, everywhere).
  useEffect(() => {
    useRemoteStatus.getState().setStatus({
      active, hasConsent, isFounder, lastError, optIn, killSwitch,
    });
  }, [active, hasConsent, isFounder, lastError, optIn, killSwitch]);

  // ⌘⇧K kill switch
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        killSwitch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [killSwitch]);

  return { active, hasConsent, isFounder, lastError, log, optIn, killSwitch };
}
