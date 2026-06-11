import { useCallback, useEffect, useState } from "react";
import {
  listChannels,
  socialGetConnectionStrict,
  type Channel,
  type ChannelPlatform,
  type SocialConnectionState,
} from "./backend";

export type ConnectionSnapshot =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "loaded";
      channels: Channel[];
      ayrshare: SocialConnectionState | null;
    };

export function usePlatformConnections() {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setSnapshot({ kind: "loading" });
    try {
      const [channels, ayrshareRaw] = await Promise.all([
        listChannels(),
        socialGetConnectionStrict().catch(() => "no-connection" as const),
      ]);
      const ayrshare = ayrshareRaw === "no-connection" ? null : ayrshareRaw;
      setSnapshot({ kind: "loaded", channels, ayrshare });
    } catch (e) {
      setSnapshot({
        kind: "error",
        message: "Couldn't load connections",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isConnected = useCallback(
    (platform: ChannelPlatform) => {
      if (snapshot.kind !== "loaded") return false;
      const channel = snapshot.channels.find(
        (c) => c.platform === platform && c.status === "active"
      );
      if (channel) return true;
      return snapshot.ayrshare?.platforms.includes(platform) ?? false;
    },
    [snapshot]
  );

  const getChannel = useCallback(
    (platform: ChannelPlatform): Channel | undefined => {
      if (snapshot.kind !== "loaded") return undefined;
      return snapshot.channels.find((c) => c.platform === platform);
    },
    [snapshot]
  );

  const getStatus = useCallback(
    (platform: ChannelPlatform): Channel["status"] | "no-channel" | "loading" => {
      if (snapshot.kind === "loading") return "loading";
      if (snapshot.kind === "error") return "no-channel";
      const channel = snapshot.channels.find((c) => c.platform === platform);
      if (channel) return channel.status;
      return snapshot.ayrshare?.platforms.includes(platform) ? "active" : "no-channel";
    },
    [snapshot]
  );

  return { snapshot, refresh, isConnected, getChannel, getStatus };
}
