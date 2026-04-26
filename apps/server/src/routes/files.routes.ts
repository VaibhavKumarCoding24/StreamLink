import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { FileTransferService } from "../services/fileTransfer.service";
import { MediaStreamService } from "../services/mediaStream.service";

type RouterOptions = {
  onTransferCreated?: (transferId: string) => void;
  onTransferProgress?: (payload: { transferId: string; sentBytes: number; totalBytes: number; status: "in_progress" | "completed" }) => void;
};

const createUploadSessionSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1),
  senderDeviceId: z.string().min(1),
  senderName: z.string().optional(),
  receiverDeviceId: z.string().optional(),
  receiverName: z.string().optional(),
  chunkSizeBytes: z.number().int().positive().optional()
});

export const createFilesRouter = (fileTransferService: FileTransferService, options: RouterOptions = {}) => {
  const mediaStreamService = new MediaStreamService(fileTransferService);
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      const targetDir = fileTransferService.getStorageRoot();
      fs.mkdirSync(targetDir, { recursive: true });
      cb(null, targetDir);
    },
    filename: (_req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      cb(null, uniqueName);
    }
  });

  const upload = multer({ storage });
  const router = Router();

  router.get("/", (req, res) => {
    const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
    res.json(fileTransferService.listTransfers(deviceId));
  });

  router.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    const senderDeviceId = typeof req.body.senderDeviceId === "string" ? req.body.senderDeviceId : "unknown";
    const receiverDeviceId = typeof req.body.receiverDeviceId === "string" && req.body.receiverDeviceId.length > 0 ? req.body.receiverDeviceId : undefined;
    const senderName = typeof req.body.senderName === "string" ? req.body.senderName : undefined;
    const receiverName = typeof req.body.receiverName === "string" ? req.body.receiverName : undefined;
    const transferId = typeof req.body.transferId === "string" ? req.body.transferId : uuid();

    const record = fileTransferService.createTransfer({
      transferId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype || "application/octet-stream",
      senderDeviceId,
      receiverDeviceId,
      senderName,
      receiverName,
      storedFileName: req.file.filename
    });

    options.onTransferCreated?.(record.transferId);
    return res.status(201).json(record);
  });

  router.post("/upload-sessions", (req, res) => {
    const parsed = createUploadSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const session = fileTransferService.createUploadSession(parsed.data);
    return res.status(201).json(session);
  });

  router.get("/upload-sessions/:uploadId", (req, res) => {
    const session = fileTransferService.getUploadSession(req.params.uploadId);
    if (!session) {
      return res.status(404).json({ error: "Upload session not found" });
    }

    return res.json(session);
  });

  router.put("/upload-sessions/:uploadId/chunks/:chunkIndex", (req, res, next) => {
    const chunkIndex = Number.parseInt(req.params.chunkIndex, 10);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ error: "Invalid chunk index" });
    }

    fileTransferService.storeUploadChunk(req.params.uploadId, chunkIndex, req)
      .then(async (session) => {
        if (!session) {
          return res.status(404).json({ error: "Upload session not found" });
        }

        options.onTransferProgress?.({
          transferId: session.transferId,
          sentBytes: session.uploadedBytes,
          totalBytes: session.fileSize,
          status: session.status === "completed" ? "completed" : "in_progress"
        });

        if (session.uploadedChunks >= session.totalChunks) {
          const record = await fileTransferService.finalizeUploadSession(req.params.uploadId);
          if (record) {
            options.onTransferProgress?.({
              transferId: record.transferId,
              sentBytes: record.fileSize,
              totalBytes: record.fileSize,
              status: "completed"
            });
            options.onTransferCreated?.(record.transferId);
            return res.status(201).json({ session, record });
          }
        }

        return res.status(202).json(session);
      })
      .catch(next);
  });

  router.get("/:transferId", (req, res) => {
    const record = fileTransferService.getTransfer(req.params.transferId);
    if (!record) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    return res.json(record);
  });

  router.get("/:transferId/download", (req, res) => {
    const record = fileTransferService.getTransfer(req.params.transferId);
    const filePath = fileTransferService.getFilePath(req.params.transferId);
    if (!record || !filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    return res.download(path.resolve(filePath), record.fileName);
  });

  router.get("/:transferId/stream", (req, res) => {
    const plan = mediaStreamService.buildPlan(req.params.transferId, req.headers, req.originalUrl);
    if (!plan) {
      return res.status(404).json({ error: "Media file not found" });
    }

    res.status(plan.statusCode);
    Object.entries(plan.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    const fileStream = mediaStreamService.createReadStream(plan);
    fileStream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "Unable to stream media" });
        return;
      }

      res.destroy();
    });

    req.on("close", () => {
      fileStream.destroy();
    });

    fileStream.pipe(res);
  });

  return router;
};
