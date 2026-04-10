import cors from "cors";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@streamlink/shared";
import { createPairingRouter } from "./routes/pairing.routes";
import { createFilesRouter } from "./routes/files.routes";
import { DeviceTrustService } from "./services/deviceTrust.service";
import { FileTransferService } from "./services/fileTransfer.service";
import { PlaybackStateService } from "./services/playbackState.service";
import { registerPlaybackGateway } from "./socket/sessionGateway";

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "*"
  }
});

const storageRoot = path.resolve("storage");
const playbackService = new PlaybackStateService();
const deviceTrustService = new DeviceTrustService(path.join(storageRoot, "state", "devices.json"));
const fileTransferService = new FileTransferService(path.join(storageRoot, "transfers"), path.join(storageRoot, "state", "transfers.json"));

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.get("/health", (_req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = Object.values(interfaces)
    .flat()
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);

  res.json({ ok: true, ts: Date.now(), addresses });
});
app.use("/api/pairing", createPairingRouter(deviceTrustService));
app.use(
  "/api/files",
  createFilesRouter(fileTransferService, {
    onTransferCreated: (transferId) => {
      const record = fileTransferService.getTransfer(transferId);
      if (!record) return;
      io.emit("FILE_TRANSFER_OFFER", fileTransferService.toOffer(record));
      io.emit("FILE_TRANSFER_PROGRESS", {
        transferId,
        sentBytes: record.fileSize,
        totalBytes: record.fileSize,
        status: "completed"
      });
    }
  })
);

registerPlaybackGateway(io, playbackService, deviceTrustService, fileTransferService);

const port = Number(process.env.PORT ?? 4000);
server.listen(port, "0.0.0.0", () => {
  console.log(`streamlink server listening on http://0.0.0.0:${port}`);
});