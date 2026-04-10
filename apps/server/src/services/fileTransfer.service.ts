import fs from "node:fs";
import path from "node:path";
import type { FileTransferInit, FileTransferOffer, FileTransferProgress, FileTransferRecord } from "@streamlink/shared";
import { readJsonFile, writeJsonFile } from "./jsonStore";

type TransferStore = {
  transfers: FileTransferRecord[];
};

const initialStore: TransferStore = {
  transfers: []
};

export class FileTransferService {
  private store: TransferStore;

  constructor(
    private readonly storageRoot: string,
    private readonly metadataFile: string
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

  toOffer(record: FileTransferRecord): FileTransferOffer {
    return record;
  }
}