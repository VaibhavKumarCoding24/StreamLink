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

const initialState = (queue: Track[], deviceId?: string): PlaybackState => ({
  sessionId: "default-session",
  version: 1,
  currentTrack: queue[0] ?? null,
  isPlaying: false,
  progressMs: 0,
  durationMs: queue[0]?.durationMs ?? 0,
  volume: 0.75,
  queue,
  updatedAt: Date.now(),
  activeDeviceId: deviceId
});

export function usePlaybackSync(socketUrl: string, seedQueue: Track[], device: PairedDevice | null) {
  const [state, setState] = useState<PlaybackState>(() => initialState(seedQueue, device?.id));
  const [connected, setConnected] = useState(false);

  const socket = useMemo<Socket<ServerToClientEvents, ClientToServerEvents> | null>(() => {
    if (!device) return null;

    return io(socketUrl, {
      autoConnect: true,
      transports: ["websocket", "polling"],
      auth: {
        deviceId: device.id,
        accessToken: device.accessToken
      }
    });
  }, [device, socketUrl]);

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
    (partial: Partial<PlaybackCommand>, emit = true) => {
      if (!device) return;

      const command: PlaybackCommand = {
        commandId: crypto.randomUUID(),
        sessionId: state.sessionId,
        deviceId: device.id,
        sentAt: Date.now(),
        type: partial.type ?? "PLAY",
        progressMs: partial.progressMs,
        volume: partial.volume,
        queue: partial.queue ?? (partial.type === "PLAY" && !state.queue.length ? seedQueue : partial.queue)
      };

      setState((prev) => {
        if (!emit) {
          return {
            ...prev,
            progressMs: partial.progressMs ?? prev.progressMs
          };
        }

        if (command.type === "PLAY" && !prev.currentTrack && seedQueue.length > 0) {
          return {
            ...prev,
            queue: seedQueue,
            currentTrack: seedQueue[0],
            durationMs: seedQueue[0].durationMs,
            isPlaying: true
          };
        }

        return {
          ...prev,
          isPlaying: command.type === "PAUSE" ? false : command.type === "PLAY" ? true : prev.isPlaying,
          volume: partial.volume ?? prev.volume,
          progressMs: partial.progressMs ?? prev.progressMs
        };
      });

      if (emit && socket && commandEvents.has(command.type)) {
        socket.emit(command.type, command);
      }
    },
    [device, seedQueue, socket, state.sessionId, state.queue.length]
  );

  return { state, connected, sendCommand };
}