import { useCallback, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  PairedDevice,
  PlaybackCommand,
  PlaybackState,
  ServerToClientEvents,
  Track
} from "@streamlink/shared";

const commandEvents = new Set<PlaybackCommand["type"]>([
  "PLAY",
  "PAUSE",
  "NEXT",
  "PREVIOUS",
  "SEEK",
  "VOLUME_CHANGE",
  "QUEUE_REPLACE"
]);

const seedQueue: Track[] = [
  {
    id: "1",
    title: "Neon Tides",
    artist: "Aurora Current",
    album: "Glass Circuit",
    durationMs: 214000,
    sourceUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
  },
  {
    id: "2",
    title: "Midnight Packet",
    artist: "Signal Bloom",
    album: "LAN Dreams",
    durationMs: 186000,
    sourceUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"
  }
];

const initialState: PlaybackState = {
  sessionId: "default-session",
  version: 1,
  currentTrack: seedQueue[0] ?? null,
  isPlaying: false,
  progressMs: 0,
  durationMs: seedQueue[0]?.durationMs ?? 0,
  volume: 0.75,
  queue: seedQueue,
  updatedAt: Date.now()
};

export function useMobileSync(serverUrl: string, device: PairedDevice | null) {
  const [state, setState] = useState<PlaybackState>(initialState);
  const [connected, setConnected] = useState(false);

  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents> | null>(() => {
    if (!serverUrl || !device) return null;

    return io(serverUrl, {
      autoConnect: true,
      auth: {
        deviceId: device.id,
        accessToken: device.accessToken
      }
    });
  }, [device, serverUrl]);

  useEffect(() => {
    if (!socket || !device) {
      setConnected(false);
      return;
    }

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("REQUEST_SYNC", { sessionId: "default-session", deviceId: device.id });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("SYNC_STATE", (nextState) => {
      setState((prev) => (nextState.version >= prev.version ? nextState : prev));
    });
    socket.on("ERROR_STATE", () => {
      setConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [device, socket]);

  const sendCommand = useCallback(
    (partial: Partial<PlaybackCommand>) => {
      if (!socket || !device) return;

      const command: PlaybackCommand = {
        commandId: `${device.id}-${Date.now()}`,
        deviceId: device.id,
        sessionId: state.sessionId,
        sentAt: Date.now(),
        type: partial.type ?? "PLAY",
        progressMs: partial.progressMs,
        volume: partial.volume,
        queue: partial.queue
      };

      if (commandEvents.has(command.type)) {
        socket.emit(command.type, command);
      }
    },
    [device, socket, state.sessionId]
  );

  return { state, connected, sendCommand };
}