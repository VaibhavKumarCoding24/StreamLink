import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type {
  CreateUploadSessionPayload,
  FileTransferRecord,
  PairingSession,
  PairedDevice,
  PlaybackState,
  Track,
  TrustedDevice,
  UploadSessionRecord
} from "@streamlink/shared";
import { playerTheme } from "@streamlink/shared";
import { GlassCard } from "./components/GlassCard";
import { PlayerControls } from "./components/PlayerControls";
import { QueueList } from "./components/QueueList";
import { usePlaybackSync } from "./hooks/usePlaybackSync";

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000";
const storageKey = "streamlink.host.device";
const fingerprintKey = "streamlink.host.fingerprint";
const uploadConcurrency = 6;

type ActiveUpload = {
  id: string;
  fileName: string;
  sentBytes: number;
  totalBytes: number;
  progress: number;
  status: "preparing" | "uploading" | "finalizing" | "completed" | "failed";
};

const demoQueue: Track[] = [
  {
    id: "1",
    title: "Neon Tides",
    artist: "Aurora Current",
    album: "Glass Circuit",
    durationMs: 214000,
    sourceUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    artworkUrl: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=900&q=80"
  },
  {
    id: "2",
    title: "Midnight Packet",
    artist: "Signal Bloom",
    album: "LAN Dreams",
    durationMs: 186000,
    sourceUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    artworkUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80"
  }
];

const getFingerprint = () => {
  const existing = localStorage.getItem(fingerprintKey);
  if (existing) return existing;
  const next = `host-${crypto.randomUUID()}`;
  localStorage.setItem(fingerprintKey, next);
  return next;
};

const reconcileAudio = async (audio: HTMLAudioElement, state: PlaybackState) => {
  if (!state.currentTrack) {
    audio.pause();
    audio.removeAttribute("src");
    return;
  }

  if (audio.src !== state.currentTrack.sourceUrl) {
    audio.src = state.currentTrack.sourceUrl;
    audio.load();
  }

  audio.volume = state.volume;

  if (Math.abs(audio.currentTime * 1000 - state.progressMs) > 1500) {
    audio.currentTime = state.progressMs / 1000;
  }

  if (state.isPlaying && audio.paused) {
    await audio.play().catch(() => undefined);
  }

  if (!state.isPlaying && !audio.paused) {
    audio.pause();
  }
};

export default function App() {
  const [hostDevice, setHostDevice] = useState<PairedDevice | null>(() => {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as PairedDevice) : null;
  });
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [pairingPin, setPairingPin] = useState<PairingSession | null>(null);
  const [lanAddresses, setLanAddresses] = useState<string[]>([]);
  const [transfers, setTransfers] = useState<FileTransferRecord[]>([]);
  const [activeUploads, setActiveUploads] = useState<ActiveUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const { state, connected, sendCommand } = usePlaybackSync(socketUrl, demoQueue, hostDevice);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshMetadata = async (deviceId?: string) => {
    const [devicesRes, transfersRes, healthRes] = await Promise.all([
      fetch(`${socketUrl}/api/pairing/devices`),
      fetch(`${socketUrl}/api/files${deviceId ? `?deviceId=${deviceId}` : ""}`),
      fetch(`${socketUrl}/health`)
    ]);

    setDevices(await devicesRes.json());
    setTransfers(await transfersRes.json());
    const health = await healthRes.json();
    setLanAddresses(health.addresses ?? []);
  };

  useEffect(() => {
    const bootstrapHost = async () => {
      const fingerprint = getFingerprint();
      const response = await fetch(`${socketUrl}/api/pairing/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceName: "Laptop Host",
          fingerprint
        })
      });

      const paired = (await response.json()) as PairedDevice;
      localStorage.setItem(storageKey, JSON.stringify(paired));
      setHostDevice(paired);
      await refreshMetadata(paired.id);
    };

    void bootstrapHost();
  }, []);

  useEffect(() => {
    if (!hostDevice) return;
    void refreshMetadata(hostDevice.id);
  }, [hostDevice]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void reconcileAudio(audio, state);
  }, [state]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      sendCommand(
        {
          type: "SEEK",
          progressMs: Math.floor(audio.currentTime * 1000)
        },
        false
      );
    };

    const onEnded = () => sendCommand({ type: "NEXT" });
    audio.addEventListener("ended", onEnded);
    const interval = window.setInterval(onTimeUpdate, 1000);

    return () => {
      audio.removeEventListener("ended", onEnded);
      window.clearInterval(interval);
    };
  }, [sendCommand]);

  const progressPercent = useMemo(() => {
    if (!state.durationMs) return 0;
    return (state.progressMs / state.durationMs) * 100;
  }, [state.durationMs, state.progressMs]);

  const generatePin = async () => {
    const response = await fetch(`${socketUrl}/api/pairing/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "Laptop Host" })
    });
    setPairingPin(await response.json());
  };

  const updateUpload = (id: string, patch: Partial<ActiveUpload>) => {
    setActiveUploads((current) => current.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)));
  };

  const removeUpload = (id: string) => {
    setActiveUploads((current) => current.filter((upload) => upload.id !== id));
  };

  const uploadViaParallelChunks = async (file: File) => {
    if (!hostDevice) return;

    const uploadId = crypto.randomUUID();
    setActiveUploads((current) => [
      {
        id: uploadId,
        fileName: file.name,
        sentBytes: 0,
        totalBytes: file.size,
        progress: 0,
        status: "preparing"
      },
      ...current
    ]);

    try {
      const payload: CreateUploadSessionPayload = {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        senderDeviceId: hostDevice.id,
        senderName: hostDevice.name,
        chunkSizeBytes: 1024 * 1024
      };

      const sessionResponse = await fetch(`${socketUrl}/api/files/upload-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!sessionResponse.ok) {
        throw new Error("Unable to create upload session");
      }

      const session = (await sessionResponse.json()) as UploadSessionRecord;
      updateUpload(uploadId, { status: "uploading" });

      const chunkIndexes = Array.from({ length: session.totalChunks }, (_, index) => index);
      let uploadedBytes = 0;

      const uploadChunk = async () => {
        while (chunkIndexes.length > 0) {
          const chunkIndex = chunkIndexes.shift();
          if (chunkIndex === undefined) return;

          const start = chunkIndex * session.chunkSizeBytes;
          const end = Math.min(start + session.chunkSizeBytes, file.size);
          const chunk = file.slice(start, end);
          const response = await fetch(`${socketUrl}${session.uploadUrl}/${chunkIndex}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(chunk.size)
            },
            body: chunk
          });

          if (!response.ok) {
            throw new Error(`Chunk ${chunkIndex + 1} failed`);
          }

          uploadedBytes += chunk.size;
          const progress = Math.min(100, (uploadedBytes / file.size) * 100);
          updateUpload(uploadId, {
            sentBytes: uploadedBytes,
            progress,
            status: progress >= 100 ? "finalizing" : "uploading"
          });
        }
      };

      await Promise.all(Array.from({ length: Math.min(uploadConcurrency, session.totalChunks) }, () => uploadChunk()));
      updateUpload(uploadId, {
        sentBytes: file.size,
        progress: 100,
        status: "completed"
      });
      await refreshMetadata(hostDevice.id);
      window.setTimeout(() => removeUpload(uploadId), 2000);
    } catch {
      updateUpload(uploadId, { status: "failed" });
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      await uploadViaParallelChunks(file);
    }
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) return;
    await handleFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!event.dataTransfer.files?.length) return;
    await handleFiles(event.dataTransfer.files);
  };

  return (
    <main className="min-h-screen px-6 py-8 text-ember md:px-10">
      <audio ref={audioRef} />
      <motion.div
        className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.35fr_1fr]"
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: playerTheme.motion.smooth }}
      >
        <div className="grid gap-6">
          <GlassCard className="overflow-hidden p-8">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <p className="mb-2 text-sm uppercase tracking-[0.3em] text-ember/70">StreamLink Host</p>
                <h1 className="text-4xl font-semibold text-ember">Unified Playback Engine</h1>
              </div>
              <div className={`rounded-full px-4 py-2 text-sm ${connected ? "bg-accent/15 text-accent" : "bg-red-500/10 text-red-300"}`}>
                {connected ? "Laptop Ready" : "Pairing Host"}
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-[280px_1fr]">
              <div className="relative aspect-square overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-glow">
                {state.currentTrack?.artworkUrl ? (
                  <img src={state.currentTrack.artworkUrl} alt={state.currentTrack.title} className="h-full w-full object-cover" />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              </div>
              <div className="flex flex-col justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-accent/80">Now Streaming</p>
                  <h2 className="mt-3 text-5xl font-semibold leading-tight text-ember">{state.currentTrack?.title ?? "Queue a track"}</h2>
                  <p className="mt-3 text-lg text-[#f6c28b]">{state.currentTrack?.artist ?? "Phone or laptop can start playback"}</p>
                </div>

                <div>
                  <div className="mb-3 flex justify-between text-sm text-[#f6c28b]">
                    <span>{Math.floor(state.progressMs / 1000)}s</span>
                    <span>{Math.floor(state.durationMs / 1000)}s</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-accent shadow-glow" style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>

                <PlayerControls state={state} onCommand={sendCommand} />
              </div>
            </div>
          </GlassCard>

          <div className="grid gap-6 md:grid-cols-2">
            <GlassCard className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-ember">Pair Phone</h3>
                <button className="rounded-full bg-accent/15 px-4 py-2 text-sm text-accent" onClick={generatePin}>Generate PIN</button>
              </div>
              <p className="text-sm text-[#f6c28b]">Phone server URL</p>
              <p className="mt-2 break-all rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-ember">{lanAddresses.length ? lanAddresses.map((item) => `${item}:4000`).join(" / ") : "Open the server and use your laptop LAN IP with port 4000."}</p>
              <p className="mt-4 text-sm text-[#f6c28b]">Active pairing PIN</p>
              <div className="mt-2 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-4 text-center text-4xl tracking-[0.35em] text-accent">
                {pairingPin?.pin ?? "------"}
              </div>
            </GlassCard>

            <GlassCard className="p-6">
              <h3 className="mb-4 text-xl font-semibold text-ember">Trusted Devices</h3>
              <div className="space-y-3">
                {devices.map((device) => (
                  <div key={device.id} className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-lg text-ember">{device.name}</div>
                        <div className="text-sm uppercase tracking-[0.2em] text-[#f6c28b]">{device.type}</div>
                      </div>
                      <div className="text-right text-sm text-[#f6c28b]">{new Date(device.lastSeenAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </div>

        <div className="grid gap-6">
          <GlassCard className="p-6">
            <h3 className="mb-4 text-xl font-semibold text-ember">Queue</h3>
            <QueueList queue={state.queue} currentTrackId={state.currentTrack?.id} />
          </GlassCard>

          <GlassCard className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-ember">High-Speed File Bridge</h3>
              <button
                className="rounded-full bg-accent/15 px-4 py-2 text-sm text-accent"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Files
              </button>
              <input ref={fileInputRef} hidden multiple type="file" onChange={handleUpload} />
            </div>
            <div
              className={`mb-4 rounded-[24px] border border-dashed px-5 py-8 text-center transition ${dragging ? "border-accent bg-accent/10" : "border-white/15 bg-white/5"}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={handleDrop}
            >
              <p className="text-lg text-ember">Drag and drop files here</p>
              <p className="mt-2 text-sm text-[#f6c28b]">Parallel chunk uploads over your local network for faster transfer throughput.</p>
            </div>
            {activeUploads.length ? (
              <div className="mb-4 space-y-3">
                {activeUploads.map((upload) => (
                  <div key={upload.id} className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-ember">{upload.fileName}</div>
                        <div className="text-sm text-[#f6c28b]">{Math.round(upload.sentBytes / 1024)} KB / {Math.round(upload.totalBytes / 1024)} KB</div>
                      </div>
                      <div className="text-sm text-accent">{upload.status}</div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-accent shadow-glow" style={{ width: `${upload.progress}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="space-y-3">
              {transfers.map((transfer) => (
                <div key={transfer.transferId} className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-ember">{transfer.fileName}</div>
                      <div className="text-sm text-[#f6c28b]">{transfer.senderName ?? transfer.senderDeviceId} • {Math.round(transfer.fileSize / 1024)} KB</div>
                    </div>
                    <a className="rounded-full bg-white/10 px-4 py-2 text-sm text-accent" href={`${socketUrl}${transfer.downloadUrl}`}>
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </motion.div>
    </main>
  );
}
