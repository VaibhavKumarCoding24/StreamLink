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
import { Http2MediaServer } from "./services/http2MediaServer.service";
import { MdnsService } from "./services/mdns.service";
import { MediaStreamService } from "./services/mediaStream.service";
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
const mediaStreamService = new MediaStreamService(fileTransferService);
const mediaServer = new Http2MediaServer(mediaStreamService);
const mdnsService = new MdnsService();

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

  res.json({
    ok: true,
    ts: Date.now(),
    addresses,
    mediaStreaming: {
      protocol: "h2c",
      port: Number(process.env.MEDIA_PORT ?? 4100),
      chunkSizeBytes: mediaStreamService.getDefaultChunkSize()
    }
  });
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
    },
    onTransferProgress: ({ transferId, sentBytes, totalBytes, status }) => {
      io.emit("FILE_TRANSFER_PROGRESS", {
        transferId,
        sentBytes,
        totalBytes,
        status
      });
    }
  })
);

registerPlaybackGateway(io, playbackService, deviceTrustService, fileTransferService);

const port = Number(process.env.PORT ?? 4000);
const mediaPort = Number(process.env.MEDIA_PORT ?? 4100);
mediaServer.start({ port: mediaPort, host: "0.0.0.0" });
server.listen(port, "0.0.0.0", () => {
  mdnsService.start({
    name: `StreamLink ${os.hostname()}`,
    port
  });
  const discovery = mdnsService.getSummary(port);
  console.log(`streamlink server listening on http://0.0.0.0:${port}`);
  console.log(`streamlink media server listening on h2c://0.0.0.0:${mediaPort}`);
  console.log(`streamlink discovery advertised on ${discovery.type}.${discovery.domain}:${discovery.port}`);
});

const shutdown = () => {
  mdnsService.stop();
  mediaServer.stop(() => {
    server.close(() => {
      process.exit(0);
    });
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
