import type { Server } from "socket.io";
import type { ClientToServerEvents, PlaybackCommand, ServerToClientEvents } from "@streamlink/shared";
import { DeviceTrustService } from "../services/deviceTrust.service";
import { FileTransferService } from "../services/fileTransfer.service";
import { PlaybackStateService } from "../services/playbackState.service";

type SocketAuth = {
  deviceId?: string;
  accessToken?: string;
};

export const registerPlaybackGateway = (
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  playbackStateService: PlaybackStateService,
  deviceTrustService: DeviceTrustService,
  fileTransferService: FileTransferService
) => {
  io.on("connection", (socket) => {
    const auth = (socket.handshake.auth ?? {}) as SocketAuth;
    const trustedDevice = auth.deviceId && auth.accessToken ? deviceTrustService.verifyDevice(auth.deviceId, auth.accessToken) : null;

    socket.emit("SYNC_STATE", playbackStateService.getState());

    const handlePlaybackCommand = (command: PlaybackCommand) => {
      if (!trustedDevice || trustedDevice.id !== command.deviceId) {
        socket.emit("ERROR_STATE", { message: "This device must be paired before it can control playback." });
        return;
      }

      const nextState = playbackStateService.applyCommand(command);
      io.emit("COMMAND_ACK", {
        commandId: command.commandId,
        accepted: true,
        version: nextState.version
      });
      io.emit("SYNC_STATE", nextState);
    };

    socket.on("PLAY", handlePlaybackCommand);
    socket.on("PAUSE", handlePlaybackCommand);
    socket.on("NEXT", handlePlaybackCommand);
    socket.on("PREVIOUS", handlePlaybackCommand);
    socket.on("SEEK", handlePlaybackCommand);
    socket.on("VOLUME_CHANGE", handlePlaybackCommand);
    socket.on("QUEUE_REPLACE", handlePlaybackCommand);

    socket.on("REQUEST_SYNC", () => {
      socket.emit("SYNC_STATE", playbackStateService.getState());
    });

    socket.on("FILE_TRANSFER_INIT", (payload) => {
      const record = fileTransferService.getTransfer(payload.transferId);
      if (!record) return;
      io.emit("FILE_TRANSFER_OFFER", fileTransferService.toOffer(record));
      io.emit("FILE_TRANSFER_PROGRESS", {
        transferId: payload.transferId,
        sentBytes: record.fileSize,
        totalBytes: record.fileSize,
        status: record.status
      });
    });
  });
};