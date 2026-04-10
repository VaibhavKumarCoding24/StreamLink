export type PlaybackCommandType =
  | "PLAY"
  | "PAUSE"
  | "NEXT"
  | "PREVIOUS"
  | "SEEK"
  | "VOLUME_CHANGE"
  | "QUEUE_REPLACE";

export type QueueMode = "replace" | "append";

export type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  sourceUrl: string;
  durationMs: number;
};

export type PlaybackCommandBase = {
  commandId: string;
  sessionId: string;
  deviceId: string;
  sentAt: number;
};

export type PlaybackCommand = PlaybackCommandBase & {
  type: PlaybackCommandType;
  progressMs?: number;
  volume?: number;
  queue?: Track[];
  queueMode?: QueueMode;
  trackId?: string;
};

export type PlaybackState = {
  sessionId: string;
  version: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  volume: number;
  queue: Track[];
  updatedAt: number;
  lastCommandId?: string;
  activeDeviceId?: string;
};