import type { PlaybackCommand, PlaybackState } from "@streamlink/shared";

const defaultState = (): PlaybackState => ({
  sessionId: "default-session",
  version: 1,
  currentTrack: null,
  isPlaying: false,
  progressMs: 0,
  durationMs: 0,
  volume: 0.75,
  queue: [],
  updatedAt: Date.now()
});

export class PlaybackStateService {
  private state: PlaybackState = defaultState();
  private processedCommands = new Set<string>();

  getState(): PlaybackState {
    return this.state;
  }

  applyCommand(command: PlaybackCommand): PlaybackState {
    if (this.processedCommands.has(command.commandId)) {
      return this.state;
    }

    this.processedCommands.add(command.commandId);

    const next = { ...this.state };
    next.updatedAt = Date.now();
    next.lastCommandId = command.commandId;
    next.activeDeviceId = command.deviceId;
    next.version += 1;

    switch (command.type) {
      case "PLAY": {
        if (command.queue && command.queue.length > 0) {
          next.queue = command.queue;
          next.currentTrack = command.queue[0] ?? null;
          next.durationMs = next.currentTrack?.durationMs ?? 0;
          next.progressMs = 0;
        }
        next.isPlaying = true;
        break;
      }
      case "PAUSE": {
        next.isPlaying = false;
        break;
      }
      case "NEXT": {
        const currentIndex = next.queue.findIndex((track) => track.id === next.currentTrack?.id);
        const nextTrack = next.queue[currentIndex + 1] ?? next.queue[0] ?? null;
        next.currentTrack = nextTrack;
        next.durationMs = nextTrack?.durationMs ?? 0;
        next.progressMs = 0;
        next.isPlaying = Boolean(nextTrack);
        break;
      }
      case "PREVIOUS": {
        const currentIndex = next.queue.findIndex((track) => track.id === next.currentTrack?.id);
        const previousTrack = next.queue[currentIndex - 1] ?? next.queue[0] ?? null;
        next.currentTrack = previousTrack;
        next.durationMs = previousTrack?.durationMs ?? 0;
        next.progressMs = 0;
        next.isPlaying = Boolean(previousTrack);
        break;
      }
      case "SEEK": {
        next.progressMs = Math.max(0, Math.min(command.progressMs ?? 0, next.durationMs));
        break;
      }
      case "VOLUME_CHANGE": {
        next.volume = Math.max(0, Math.min(command.volume ?? next.volume, 1));
        break;
      }
      case "QUEUE_REPLACE": {
        next.queue = command.queue ?? [];
        next.currentTrack = next.queue[0] ?? null;
        next.durationMs = next.currentTrack?.durationMs ?? 0;
        next.progressMs = 0;
        next.isPlaying = false;
        break;
      }
      default:
        break;
    }

    this.state = next;
    return next;
  }

  patchProgress(progressMs: number): PlaybackState {
    this.state = {
      ...this.state,
      progressMs,
      updatedAt: Date.now(),
      version: this.state.version + 1
    };
    return this.state;
  }
}