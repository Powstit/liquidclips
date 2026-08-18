/**
 * useVoiceCall · v1 — small-group mesh voice (2-4 people)
 *
 * 2026-08-17. Signaling rides the SAME /chat/ws connection useChatChannel
 * already holds open for the channel (see sendRaw/voiceEvent on that
 * hook) — a second socket per channel would double-count presence
 * server-side. Media itself is peer-to-peer WebRTC: every participant
 * opens a direct RTCPeerConnection to every other participant (full
 * mesh). That's the "small-group, built in-house" tradeoff — it scales
 * to maybe 4 people before each client's upload bandwidth becomes the
 * bottleneck, and it only uses a public STUN server (no TURN), so a
 * peer behind a restrictive NAT/corporate firewall may fail to connect.
 * Both are known, accepted limits of this approach, not bugs to chase.
 *
 * Glare avoidance: when two peers both see each other join at once,
 * only the one with the lexicographically smaller user id sends the
 * offer — otherwise both sides could simultaneously offer each other.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WsInboundMessage } from "./chat";

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type VoiceEvent = Extract<WsInboundMessage, { type: "voice-presence" | "voice-signal" }>;

interface UseVoiceCallOptions {
  channel: string;
  viewerUserId: string | null | undefined;
  sendRaw: (payload: unknown) => void;
  voiceEvent: VoiceEvent | null;
}

export interface UseVoiceCallResult {
  isJoined: boolean;
  isMuted: boolean;
  /** Every user id currently in the room's call, including the viewer
   *  once joined. Server-authoritative (from voice-presence). */
  participants: string[];
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  /** Set only on a join() failure (mic permission denied, no device,
   *  etc) — surfaced so the UI can show a real reason instead of
   *  silently doing nothing. */
  error: string | null;
}

export function useVoiceCall({
  channel,
  viewerUserId,
  sendRaw,
  voiceEvent,
}: UseVoiceCallOptions): UseVoiceCallResult {
  const [isJoined, setIsJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const isJoinedRef = useRef(false);

  const cleanupPeer = useCallback((userId: string) => {
    peersRef.current.get(userId)?.close();
    peersRef.current.delete(userId);
    const audio = audioElsRef.current.get(userId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audioElsRef.current.delete(userId);
    }
  }, []);

  const createPeer = useCallback((targetUserId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendRaw({
          type: "voice-signal",
          target_user_id: targetUserId,
          payload: { kind: "ice-candidate", candidate: event.candidate.toJSON() },
        });
      }
    };
    pc.ontrack = (event) => {
      let audio = audioElsRef.current.get(targetUserId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audioElsRef.current.set(targetUserId, audio);
      }
      audio.srcObject = event.streams[0] ?? null;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        cleanupPeer(targetUserId);
      }
    };
    peersRef.current.set(targetUserId, pc);
    return pc;
  }, [sendRaw, cleanupPeer]);

  const initiateOfferTo = useCallback(async (targetUserId: string) => {
    const pc = createPeer(targetUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendRaw({
      type: "voice-signal",
      target_user_id: targetUserId,
      payload: { kind: "offer", sdp: offer.sdp },
    });
  }, [createPeer, sendRaw]);

  const join = useCallback(async () => {
    if (isJoinedRef.current) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
    } catch {
      setError("Couldn't access your microphone — check the permission and try again.");
      return;
    }
    isJoinedRef.current = true;
    setIsJoined(true);
    sendRaw({ type: "voice-join" });
  }, [sendRaw]);

  const leave = useCallback(() => {
    if (!isJoinedRef.current) return;
    sendRaw({ type: "voice-leave" });
    isJoinedRef.current = false;
    setIsJoined(false);
    setIsMuted(false);
    for (const userId of Array.from(peersRef.current.keys())) cleanupPeer(userId);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setParticipants([]);
  }, [sendRaw, cleanupPeer]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    for (const track of stream.getAudioTracks()) track.enabled = !next;
    setIsMuted(next);
  }, [isMuted]);

  useEffect(() => {
    if (!voiceEvent || voiceEvent.channel !== channel) return;

    if (voiceEvent.type === "voice-presence") {
      const next = voiceEvent.participants;
      setParticipants(next);
      if (!isJoinedRef.current || !viewerUserId) return;
      for (const otherId of next) {
        if (otherId === viewerUserId || peersRef.current.has(otherId)) continue;
        if (viewerUserId < otherId) void initiateOfferTo(otherId); // glare avoidance, see file header
      }
      for (const existingId of Array.from(peersRef.current.keys())) {
        if (!next.includes(existingId)) cleanupPeer(existingId);
      }
      return;
    }

    // voice-signal
    const { from_user_id, payload } = voiceEvent;
    if (payload.kind === "offer") {
      void (async () => {
        const pc = peersRef.current.get(from_user_id) ?? createPeer(from_user_id);
        await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendRaw({
          type: "voice-signal",
          target_user_id: from_user_id,
          payload: { kind: "answer", sdp: answer.sdp },
        });
      })();
    } else if (payload.kind === "answer") {
      void peersRef.current.get(from_user_id)?.setRemoteDescription({ type: "answer", sdp: payload.sdp });
    } else if (payload.kind === "ice-candidate") {
      void peersRef.current.get(from_user_id)?.addIceCandidate(payload.candidate);
    }
  }, [voiceEvent, channel, viewerUserId, createPeer, cleanupPeer, initiateOfferTo, sendRaw]);

  // Leave cleanly on unmount / channel switch — never leave a mic hot
  // or a peer connection dangling when the user navigates away.
  useEffect(() => {
    return () => {
      if (isJoinedRef.current) leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  return { isJoined, isMuted, participants, join, leave, toggleMute, error };
}
