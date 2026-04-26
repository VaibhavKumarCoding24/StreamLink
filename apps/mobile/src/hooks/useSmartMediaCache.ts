import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as FileSystem from "expo-file-system";
import type { Track } from "@streamlink/shared";

type SmartCacheStatus = "idle" | "probing" | "buffering" | "ready" | "error";

type CacheSegment = {
  startByte: number;
  endByte: number;
  sizeBytes: number;
  uri: string;
  md5: string | null;
};

type SmartCacheSnapshot = {
  status: SmartCacheStatus;
  remoteUrl: string | null;
  totalBytes: number;
  cachedBytes: number;
  startupTargetBytes: number;
  chunkSizeBytes: number;
  playbackPositionMs: number;
  bufferedAheadMs: number;
  bitPerfect: boolean;
  cacheDirectoryUri: string | null;
  activeTrackId: string | null;
  error: string | null;
};

type SmartCacheSession = {
  trackId: string;
  remoteUrl: string;
  cacheDirectoryUri: string;
  totalBytes: number;
  durationMs: number;
  bytesPerMs: number;
  startupTargetBytes: number;
  chunkSizeBytes: number;
};

type UseSmartMediaCacheOptions = {
  track: Track | null;
  serverUrl: string;
  playbackPositionMs: number;
  enabled: boolean;
};

const startupPercent = 0.2;
const startupBufferMs = 60_000;
const lookAheadMs = 30_000;
const fallbackChunkSizeBytes = 256 * 1024;
const cacheFolderName = "streamlink-smart-cache";

const emptySnapshot = (playbackPositionMs: number): SmartCacheSnapshot => ({
  status: "idle",
  remoteUrl: null,
  totalBytes: 0,
  cachedBytes: 0,
  startupTargetBytes: 0,
  chunkSizeBytes: fallbackChunkSizeBytes,
  playbackPositionMs,
  bufferedAheadMs: 0,
  bitPerfect: true,
  cacheDirectoryUri: null,
  activeTrackId: null,
  error: null
});

const resolveMediaUrl = (sourceUrl: string, serverUrl: string) => {
  if (/^https?:\/\//i.test(sourceUrl)) {
    return sourceUrl;
  }

  if (!serverUrl) {
    return sourceUrl;
  }

  return new URL(sourceUrl, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`).toString();
};

const sanitizePathSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

const getSequentialCachedBytes = (segments: CacheSegment[]) => {
  if (!segments.length) {
    return 0;
  }

  const ordered = [...segments].sort((left, right) => left.startByte - right.startByte);
  let cursor = 0;

  for (const segment of ordered) {
    if (segment.startByte > cursor) {
      break;
    }

    cursor = Math.max(cursor, segment.endByte + 1);
  }

  return cursor;
};

const parsePositiveNumber = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseTotalBytes = (contentRange: string | null, contentLength: string | null) => {
  if (contentRange) {
    const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/i);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return parsePositiveNumber(contentLength) ?? 0;
};

const ensureDirectory = async (uri: string) => {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
};

export function useSmartMediaCache({ track, serverUrl, playbackPositionMs, enabled }: UseSmartMediaCacheOptions) {
  const [snapshot, setSnapshot] = useState<SmartCacheSnapshot>(() => emptySnapshot(playbackPositionMs));
  const sessionRef = useRef<SmartCacheSession | null>(null);
  const segmentsRef = useRef<CacheSegment[]>([]);
  const runTokenRef = useRef(0);
  const bufferingRef = useRef(false);

  const updateSnapshot = useCallback(
    (partial: Partial<SmartCacheSnapshot>) => {
      setSnapshot((current) => {
        const session = sessionRef.current;
        const sequentialBytes = getSequentialCachedBytes(segmentsRef.current);
        const bytesPerMs = session?.bytesPerMs ?? 0;
        const contiguousBufferedMs = bytesPerMs > 0 ? Math.floor(sequentialBytes / bytesPerMs) : 0;

        return {
          ...current,
          playbackPositionMs,
          cachedBytes: sequentialBytes,
          bufferedAheadMs: Math.max(0, contiguousBufferedMs - playbackPositionMs),
          ...partial
        };
      });
    },
    [playbackPositionMs]
  );

  const clearSession = useCallback(() => {
    runTokenRef.current += 1;
    sessionRef.current = null;
    segmentsRef.current = [];
    bufferingRef.current = false;
    setSnapshot(emptySnapshot(playbackPositionMs));
  }, [playbackPositionMs]);

  const trackKey = `${track?.id ?? "none"}|${track?.sourceUrl ?? "none"}|${track?.durationMs ?? 0}`;
  const trackId = track?.id ?? null;
  const trackSourceUrl = track?.sourceUrl ?? null;
  const trackDurationMs = track?.durationMs ?? 0;
  const trackTitle = track?.title ?? "Unknown";
  const trackArtist = track?.artist ?? "Unknown";

  const writeManifest = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    const manifestUri = `${session.cacheDirectoryUri}/manifest.json`;
    await FileSystem.writeAsStringAsync(
      manifestUri,
      JSON.stringify(
        {
          trackId: session.trackId,
          remoteUrl: session.remoteUrl,
          totalBytes: session.totalBytes,
          durationMs: session.durationMs,
          startupTargetBytes: session.startupTargetBytes,
          chunkSizeBytes: session.chunkSizeBytes,
          segments: segmentsRef.current
        },
        null,
        2
      )
    );
  }, []);

  const probeSource = useCallback(
    async (remoteUrl: string, activeTrack: Track, token: number): Promise<SmartCacheSession> => {
      const response = await fetch(remoteUrl, {
        method: "GET",
        headers: {
          Range: "bytes=0-0"
        }
      });

      if (token !== runTokenRef.current) {
        throw new Error("Smart cache probe canceled");
      }

      if (!response.ok && response.status !== 206) {
        throw new Error(`Source probe failed with status ${response.status}`);
      }

      const totalBytes = parseTotalBytes(response.headers.get("Content-Range"), response.headers.get("Content-Length"));
      if (!totalBytes) {
        throw new Error("Remote stream did not report total byte length");
      }

      const chunkSizeBytes = parsePositiveNumber(response.headers.get("x-streamlink-chunk-size")) ?? fallbackChunkSizeBytes;
      const durationMs = Math.max(activeTrack.durationMs, 1);
      const bytesPerMs = totalBytes / durationMs;
      const startupTargetBytes = Math.min(
        totalBytes,
        Math.max(Math.ceil(totalBytes * startupPercent), Math.ceil(bytesPerMs * startupBufferMs))
      );
      const cacheRoot = FileSystem.cacheDirectory;
      if (!cacheRoot) {
        throw new Error("Temporary cache directory is unavailable on this device");
      }

      const cacheDirectoryUri = `${cacheRoot}${cacheFolderName}/${sanitizePathSegment(activeTrack.id)}`;
      await ensureDirectory(cacheDirectoryUri);

      return {
        trackId: activeTrack.id,
        remoteUrl,
        cacheDirectoryUri,
        totalBytes,
        durationMs,
        bytesPerMs,
        startupTargetBytes,
        chunkSizeBytes
      };
    },
    []
  );

  const downloadSegment = useCallback(
    async (session: SmartCacheSession, token: number) => {
      const nextStart = getSequentialCachedBytes(segmentsRef.current);
      if (nextStart >= session.totalBytes) {
        return null;
      }

      const nextEnd = Math.min(session.totalBytes - 1, nextStart + session.chunkSizeBytes - 1);
      const uri = `${session.cacheDirectoryUri}/${String(nextStart).padStart(12, "0")}-${String(nextEnd).padStart(12, "0")}.part`;

      const existing = await FileSystem.getInfoAsync(uri, { md5: true });
      if (existing.exists && "size" in existing && existing.size === nextEnd - nextStart + 1) {
        return {
          startByte: nextStart,
          endByte: nextEnd,
          sizeBytes: existing.size,
          uri,
          md5: existing.md5 ?? null
        } satisfies CacheSegment;
      }

      await FileSystem.deleteAsync(uri, { idempotent: true });
      const result = await FileSystem.downloadAsync(session.remoteUrl, uri, {
        md5: true,
        cache: true,
        headers: {
          Range: `bytes=${nextStart}-${nextEnd}`
        }
      });

      if (token !== runTokenRef.current) {
        return null;
      }

      const expectedSize = nextEnd - nextStart + 1;
      const info = await FileSystem.getInfoAsync(uri, { md5: true });
      if (!info.exists || !("size" in info) || info.size !== expectedSize) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        throw new Error(`Segment integrity failed for bytes ${nextStart}-${nextEnd}`);
      }

      const contentRange = result.headers["content-range"] ?? result.headers["Content-Range"];
      if (result.status !== 206 && !(result.status === 200 && expectedSize === session.totalBytes)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        throw new Error(`Unexpected status ${result.status} while downloading segment`);
      }

      if (contentRange && !contentRange.includes(`${nextStart}-${nextEnd}`)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        throw new Error(`Unexpected content range returned for bytes ${nextStart}-${nextEnd}`);
      }

      return {
        startByte: nextStart,
        endByte: nextEnd,
        sizeBytes: info.size,
        uri,
        md5: result.md5 ?? info.md5 ?? null
      } satisfies CacheSegment;
    },
    []
  );

  const ensureBuffer = useCallback(async () => {
    const session = sessionRef.current;
    const token = runTokenRef.current;
    if (!session || bufferingRef.current) {
      return;
    }

    bufferingRef.current = true;
    updateSnapshot({ status: "buffering", error: null });

    try {
      while (token === runTokenRef.current) {
        const sequentialBytes = getSequentialCachedBytes(segmentsRef.current);
        const lookAheadTargetBytes = Math.min(
          session.totalBytes,
          Math.ceil((playbackPositionMs + lookAheadMs) * session.bytesPerMs)
        );
        const desiredBytes = Math.min(
          session.totalBytes,
          Math.max(session.startupTargetBytes, lookAheadTargetBytes)
        );

        if (sequentialBytes >= desiredBytes) {
          break;
        }

        const segment = await downloadSegment(session, token);
        if (!segment || token !== runTokenRef.current) {
          break;
        }

        segmentsRef.current = [...segmentsRef.current, segment].sort((left, right) => left.startByte - right.startByte);
        await writeManifest();
        updateSnapshot({
          status: getSequentialCachedBytes(segmentsRef.current) >= desiredBytes ? "ready" : "buffering",
          bitPerfect: segmentsRef.current.every((item) => Boolean(item.md5)),
          cacheDirectoryUri: session.cacheDirectoryUri,
          activeTrackId: session.trackId,
          totalBytes: session.totalBytes,
          startupTargetBytes: session.startupTargetBytes,
          chunkSizeBytes: session.chunkSizeBytes,
          remoteUrl: session.remoteUrl
        });
      }

      if (token === runTokenRef.current) {
        updateSnapshot({ status: "ready" });
      }
    } catch (error) {
      if (token === runTokenRef.current) {
        updateSnapshot({
          status: "error",
          error: error instanceof Error ? error.message : "Smart cache failed"
        });
      }
    } finally {
      if (token === runTokenRef.current) {
        bufferingRef.current = false;
      }
    }
  }, [downloadSegment, playbackPositionMs, updateSnapshot, writeManifest]);

  useEffect(() => {
    if (!enabled || !trackId || !trackSourceUrl) {
      clearSession();
      return;
    }

    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    bufferingRef.current = false;
    sessionRef.current = null;
    segmentsRef.current = [];
    updateSnapshot({
      ...emptySnapshot(playbackPositionMs),
      status: "probing",
      activeTrackId: trackId,
      remoteUrl: resolveMediaUrl(trackSourceUrl, serverUrl)
    });

    const start = async () => {
      try {
        const remoteUrl = resolveMediaUrl(trackSourceUrl, serverUrl);
        const session = await probeSource(
          remoteUrl,
          {
            id: trackId,
            sourceUrl: trackSourceUrl,
            durationMs: trackDurationMs,
            title: trackTitle,
            artist: trackArtist
          },
          token
        );
        if (token !== runTokenRef.current) {
          return;
        }

        sessionRef.current = session;
        segmentsRef.current = [];
        updateSnapshot({
          status: "buffering",
          remoteUrl: session.remoteUrl,
          totalBytes: session.totalBytes,
          startupTargetBytes: session.startupTargetBytes,
          chunkSizeBytes: session.chunkSizeBytes,
          cacheDirectoryUri: session.cacheDirectoryUri,
          activeTrackId: session.trackId,
          bitPerfect: true,
          error: null
        });
        await writeManifest();
        await ensureBuffer();
      } catch (error) {
        if (token === runTokenRef.current) {
          updateSnapshot({
            status: "error",
            error: error instanceof Error ? error.message : "Unable to initialize smart cache"
          });
        }
      }
    };

    void start();

    return () => {
      if (runTokenRef.current === token) {
        runTokenRef.current += 1;
      }
      bufferingRef.current = false;
    };
  }, [
    clearSession,
    enabled,
    ensureBuffer,
    playbackPositionMs,
    probeSource,
    serverUrl,
    trackArtist,
    trackDurationMs,
    trackId,
    trackKey,
    trackSourceUrl,
    trackTitle,
    updateSnapshot,
    writeManifest
  ]);

  useEffect(() => {
    if (!enabled || !sessionRef.current) {
      return;
    }

    updateSnapshot({});
    void ensureBuffer();
  }, [enabled, ensureBuffer, playbackPositionMs, updateSnapshot]);

  return useMemo(
    () => ({
      ...snapshot,
      lookAheadMs,
      startupBufferMs
    }),
    [snapshot]
  );
}
