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
  streamUrl?: string;
  http2StreamUrl?: string;
  supportsByteRange?: boolean;
  chunkSizeBytes?: number;
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

export type FileCategory = "image" | "video" | "document" | "audio" | "other";

export type CreateUploadSessionPayload = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  senderDeviceId: string;
  senderName?: string;
  receiverDeviceId?: string;
  receiverName?: string;
  chunkSizeBytes?: number;
};

export type UploadSessionRecord = {
  uploadId: string;
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  senderDeviceId: string;
  senderName?: string;
  receiverDeviceId?: string;
  receiverName?: string;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadedChunks: number;
  uploadedBytes: number;
  status: "pending" | "uploading" | "finalizing" | "completed" | "failed";
  createdAt: number;
  uploadUrl: string;
};
