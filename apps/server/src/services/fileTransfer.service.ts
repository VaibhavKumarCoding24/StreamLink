import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type {
  CreateUploadSessionPayload,
  FileTransferInit,
  FileTransferOffer,
  FileTransferProgress,
  FileTransferRecord,
  UploadSessionRecord
} from "@streamlink/shared";
import { readJsonFile, writeJsonFile } from "./jsonStore";
import { ensureParentDir } from "./jsonStore";

type TransferStore = {
  transfers: FileTransferRecord[];
};

type InternalUploadSession = UploadSessionRecord & {
  chunkDir: string;
  storedFileName: string;
  receivedChunkIndexes: Set<number>;
};

const initialStore: TransferStore = {
  transfers: []
};

export class FileTransferService {
  private store: TransferStore;
  private uploadSessions = new Map<string, InternalUploadSession>();

  constructor(
    private readonly storageRoot: string,
    private readonly metadataFile: string,
    private readonly streamChunkSizeBytes = 256 * 1024
  ) {
    fs.mkdirSync(this.storageRoot, { recursive: true });
    this.store = readJsonFile<TransferStore>(this.metadataFile, initialStore);
  }

  private persist() {
    writeJsonFile(this.metadataFile, this.store);
  }

  createTransfer(payload: FileTransferInit & { storedFileName: string; senderName?: string; receiverName?: string }): FileTransferRecord {
    const record: FileTransferRecord = {
      ...payload,
      downloadUrl: `/api/files/${payload.transferId}/download`,
      streamUrl: `/api/files/${payload.transferId}/stream`,
      http2StreamUrl: `/media/${payload.transferId}/stream`,
      supportsByteRange: true,
      chunkSizeBytes: this.streamChunkSizeBytes,
      createdAt: Date.now(),
      status: "completed",
      storedFileName: payload.storedFileName,
      senderName: payload.senderName,
      receiverName: payload.receiverName
    };

    this.store.transfers.unshift(record);
    this.persist();
    return record;
  }

  listTransfers(deviceId?: string): FileTransferRecord[] {
    if (!deviceId) {
      return this.store.transfers;
    }

    return this.store.transfers.filter(
      (transfer) => !transfer.receiverDeviceId || transfer.receiverDeviceId === deviceId || transfer.senderDeviceId === deviceId
    );
  }

  getTransfer(transferId: string): FileTransferRecord | null {
    return this.store.transfers.find((transfer) => transfer.transferId === transferId) ?? null;
  }

  getFilePath(transferId: string): string | null {
    const record = this.getTransfer(transferId);
    if (!record) return null;
    return path.join(this.storageRoot, record.storedFileName);
  }

  updateProgress(transferId: string, sentBytes: number, status: FileTransferProgress["status"]): FileTransferProgress | null {
    const record = this.store.transfers.find((item) => item.transferId === transferId);
    if (!record) return null;
    record.status = status;
    this.persist();
    return {
      transferId,
      sentBytes,
      totalBytes: record.fileSize,
      status
    };
  }

  getStorageRoot() {
    return this.storageRoot;
  }

  getStreamChunkSizeBytes() {
    return this.streamChunkSizeBytes;
  }

  toOffer(record: FileTransferRecord): FileTransferOffer {
    return record;
  }

  private toUploadSessionRecord(session: InternalUploadSession): UploadSessionRecord {
    return {
      uploadId: session.uploadId,
      transferId: session.transferId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      mimeType: session.mimeType,
      senderDeviceId: session.senderDeviceId,
      senderName: session.senderName,
      receiverDeviceId: session.receiverDeviceId,
      receiverName: session.receiverName,
      chunkSizeBytes: session.chunkSizeBytes,
      totalChunks: session.totalChunks,
      uploadedChunks: session.uploadedChunks,
      uploadedBytes: session.uploadedBytes,
      status: session.status,
      createdAt: session.createdAt,
      uploadUrl: session.uploadUrl
    };
  }

  private clampChunkSize(requestedChunkSize?: number) {
    if (!requestedChunkSize || Number.isNaN(requestedChunkSize)) {
      return 1024 * 1024;
    }

    return Math.max(256 * 1024, Math.min(requestedChunkSize, 8 * 1024 * 1024));
  }

  createUploadSession(payload: CreateUploadSessionPayload): UploadSessionRecord {
    const uploadId = randomUUID();
    const transferId = randomUUID();
    const chunkSizeBytes = this.clampChunkSize(payload.chunkSizeBytes);
    const totalChunks = Math.max(1, Math.ceil(payload.fileSize / chunkSizeBytes));
    const storedFileName = `${Date.now()}-${payload.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const chunkDir = path.join(this.storageRoot, ".chunks", uploadId);

    fs.mkdirSync(chunkDir, { recursive: true });

    const session: InternalUploadSession = {
      uploadId,
      transferId,
      fileName: payload.fileName,
      fileSize: payload.fileSize,
      mimeType: payload.mimeType || "application/octet-stream",
      senderDeviceId: payload.senderDeviceId,
      senderName: payload.senderName,
      receiverDeviceId: payload.receiverDeviceId,
      receiverName: payload.receiverName,
      chunkSizeBytes,
      totalChunks,
      uploadedChunks: 0,
      uploadedBytes: 0,
      status: "pending",
      createdAt: Date.now(),
      uploadUrl: `/api/files/upload-sessions/${uploadId}/chunks`,
      chunkDir,
      storedFileName,
      receivedChunkIndexes: new Set<number>()
    };

    this.uploadSessions.set(uploadId, session);
    return this.toUploadSessionRecord(session);
  }

  getUploadSession(uploadId: string): UploadSessionRecord | null {
    const session = this.uploadSessions.get(uploadId);
    return session ? this.toUploadSessionRecord(session) : null;
  }

  async storeUploadChunk(uploadId: string, chunkIndex: number, source: NodeJS.ReadableStream): Promise<UploadSessionRecord | null> {
    const session = this.uploadSessions.get(uploadId);
    if (!session || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      return null;
    }

    const chunkPath = path.join(session.chunkDir, `${chunkIndex}.part`);
    ensureParentDir(chunkPath);
    await pipeline(source, fs.createWriteStream(chunkPath));

    const stats = fs.statSync(chunkPath);
    if (!session.receivedChunkIndexes.has(chunkIndex)) {
      session.receivedChunkIndexes.add(chunkIndex);
      session.uploadedChunks += 1;
      session.uploadedBytes = Math.min(session.fileSize, session.uploadedBytes + stats.size);
    }

    session.status = session.uploadedChunks >= session.totalChunks ? "finalizing" : "uploading";
    return this.toUploadSessionRecord(session);
  }

  async finalizeUploadSession(uploadId: string): Promise<FileTransferRecord | null> {
    const session = this.uploadSessions.get(uploadId);
    if (!session || session.uploadedChunks < session.totalChunks) {
      return null;
    }

    const finalPath = path.join(this.storageRoot, session.storedFileName);
    fs.writeFileSync(finalPath, "");
    for (let index = 0; index < session.totalChunks; index += 1) {
      const chunkPath = path.join(session.chunkDir, `${index}.part`);
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`Missing upload chunk ${index}`);
      }

      fs.appendFileSync(finalPath, fs.readFileSync(chunkPath));
    }

    const record = this.createTransfer({
      transferId: session.transferId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      mimeType: session.mimeType,
      senderDeviceId: session.senderDeviceId,
      receiverDeviceId: session.receiverDeviceId,
      senderName: session.senderName,
      receiverName: session.receiverName,
      storedFileName: session.storedFileName
    });

    session.status = "completed";
    fs.rmSync(session.chunkDir, { recursive: true, force: true });
    this.uploadSessions.delete(uploadId);
    return record;
  }
}
