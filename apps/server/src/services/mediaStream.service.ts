import fs from "node:fs";
import path from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import type { FileTransferRecord } from "@streamlink/shared";
import { FileTransferService } from "./fileTransfer.service";

export type MediaStreamHeaders = {
  "content-type": string;
  "accept-ranges": "bytes";
  "cache-control": "no-store";
  "x-streamlink-chunk-size": string;
  "x-streamlink-transfer-id": string;
  "content-length": string;
  "content-range"?: string;
};

export type MediaStreamPlan = {
  filePath: string;
  record: FileTransferRecord;
  statusCode: 200 | 206;
  headers: MediaStreamHeaders;
  start: number;
  end: number;
  chunkSizeBytes: number;
};

const defaultChunkSizeBytes = 256 * 1024;

const clampChunkSize = (value: number | undefined) => {
  if (!value || Number.isNaN(value)) return defaultChunkSizeBytes;
  return Math.max(64 * 1024, Math.min(value, 1024 * 1024));
};

const parsePositiveInt = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseRange = (rangeHeader: string | undefined, fileSize: number) => {
  if (!rangeHeader?.startsWith("bytes=")) {
    return null;
  }

  const [rawStart, rawEnd] = rangeHeader.slice("bytes=".length).split("-", 2);
  const start = rawStart ? Number.parseInt(rawStart, 10) : undefined;
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : undefined;

  if (start === undefined && end === undefined) {
    return null;
  }

  if (start === undefined) {
    const suffixLength = end ?? 0;
    if (suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1
    };
  }

  return {
    start,
    end: end ?? fileSize - 1
  };
};

export class MediaStreamService {
  constructor(private readonly fileTransferService: FileTransferService) {}

  getDefaultChunkSize() {
    return defaultChunkSizeBytes;
  }

  getMediaUrls(transferId: string) {
    return {
      streamUrl: `/api/files/${transferId}/stream`,
      http2StreamUrl: `/media/${transferId}/stream`
    };
  }

  buildPlan(transferId: string, headers: IncomingHttpHeaders, requestUrl?: string): MediaStreamPlan | null {
    const record = this.fileTransferService.getTransfer(transferId);
    const filePath = this.fileTransferService.getFilePath(transferId);
    if (!record || !filePath || !fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    const url = requestUrl ? new URL(requestUrl, "http://streamlink.local") : null;
    const requestedChunkSize = clampChunkSize(parsePositiveInt(url?.searchParams.get("chunkSize") ?? null));
    const requestedStart = parsePositiveInt(url?.searchParams.get("start") ?? null);
    const requestedEnd = parsePositiveInt(url?.searchParams.get("end") ?? null);
    const explicitRange = parseRange(typeof headers.range === "string" ? headers.range : undefined, stats.size);

    let start = explicitRange?.start ?? requestedStart ?? 0;
    let end = explicitRange?.end ?? requestedEnd ?? Math.min(start + requestedChunkSize - 1, stats.size - 1);

    start = Math.max(0, Math.min(start, stats.size - 1));
    end = Math.max(start, Math.min(end, stats.size - 1));

    const isPartial = start > 0 || end < stats.size - 1 || Boolean(explicitRange) || requestedStart !== undefined || requestedEnd !== undefined;
    const contentLength = end - start + 1;
    const mimeType = record.mimeType || "application/octet-stream";

    return {
      filePath: path.resolve(filePath),
      record,
      statusCode: isPartial ? 206 : 200,
      start,
      end,
      chunkSizeBytes: requestedChunkSize,
      headers: {
        "content-type": mimeType,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        "x-streamlink-chunk-size": String(requestedChunkSize),
        "x-streamlink-transfer-id": transferId,
        "content-length": String(contentLength),
        ...(isPartial ? { "content-range": `bytes ${start}-${end}/${stats.size}` } : {})
      }
    };
  }

  createReadStream(plan: MediaStreamPlan) {
    return fs.createReadStream(plan.filePath, {
      start: plan.start,
      end: plan.end,
      highWaterMark: plan.chunkSizeBytes
    });
  }
}
