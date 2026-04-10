import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { v4 as uuid } from "uuid";
import { FileTransferService } from "../services/fileTransfer.service";

type RouterOptions = {
  onTransferCreated?: (transferId: string) => void;
};

export const createFilesRouter = (fileTransferService: FileTransferService, options: RouterOptions = {}) => {
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

  return router;
};