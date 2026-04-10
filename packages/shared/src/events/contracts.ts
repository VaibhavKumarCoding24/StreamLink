import type { FileTransferInit, FileTransferOffer, FileTransferProgress } from "../types/fileTransfer";
import type { PlaybackCommand, PlaybackState } from "../types/playback";
import type { TrustedDevice } from "../types/device";

export type ClientToServerEvents = {
  PLAY: (command: PlaybackCommand) => void;
  PAUSE: (command: PlaybackCommand) => void;
  NEXT: (command: PlaybackCommand) => void;
  PREVIOUS: (command: PlaybackCommand) => void;
  SEEK: (command: PlaybackCommand) => void;
  VOLUME_CHANGE: (command: PlaybackCommand) => void;
  QUEUE_REPLACE: (command: PlaybackCommand) => void;
  REQUEST_SYNC: (payload: { sessionId: string; deviceId: string }) => void;
  FILE_TRANSFER_INIT: (payload: FileTransferInit) => void;
};

export type ServerToClientEvents = {
  SYNC_STATE: (state: PlaybackState) => void;
  COMMAND_ACK: (payload: { commandId: string; accepted: boolean; version: number }) => void;
  DEVICE_PAIRED: (device: TrustedDevice) => void;
  FILE_TRANSFER_OFFER: (payload: FileTransferOffer) => void;
  FILE_TRANSFER_PROGRESS: (payload: FileTransferProgress) => void;
  ERROR_STATE: (payload: { message: string }) => void;
};