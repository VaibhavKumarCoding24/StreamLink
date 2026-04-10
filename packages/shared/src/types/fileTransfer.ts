export type FileTransferStatus = "pending" | "in_progress" | "completed" | "failed";

export type FileTransferInit = {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  senderDeviceId: string;
  receiverDeviceId?: string;
};

export type FileTransferOffer = FileTransferInit & {
  downloadUrl: string;
  createdAt: number;
  status: FileTransferStatus;
  senderName?: string;
  receiverName?: string;
};

export type FileTransferProgress = {
  transferId: string;
  sentBytes: number;
  totalBytes: number;
  status: FileTransferStatus;
};

export type FileTransferRecord = FileTransferOffer & {
  storedFileName: string;
};