import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { playerTheme } from "@streamlink/shared";
import { GlassCard } from "./components/GlassCard";
import { PlayerControls } from "./components/PlayerControls";
import { QueueList } from "./components/QueueList";
import { usePlaybackSync } from "./hooks/usePlaybackSync";
const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:4000";
const storageKey = "streamlink.host.device";
const fingerprintKey = "streamlink.host.fingerprint";
const demoQueue = [
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
    if (existing)
        return existing;
    const next = `host-${crypto.randomUUID()}`;
    localStorage.setItem(fingerprintKey, next);
    return next;
};
const reconcileAudio = async (audio, state) => {
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
    const [hostDevice, setHostDevice] = useState(() => {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : null;
    });
    const [devices, setDevices] = useState([]);
    const [pairingPin, setPairingPin] = useState(null);
    const [lanAddresses, setLanAddresses] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [uploading, setUploading] = useState(false);
    const { state, connected, sendCommand } = usePlaybackSync(socketUrl, demoQueue, hostDevice);
    const audioRef = useRef(null);
    const refreshMetadata = async (deviceId) => {
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
            const paired = (await response.json());
            localStorage.setItem(storageKey, JSON.stringify(paired));
            setHostDevice(paired);
            await refreshMetadata(paired.id);
        };
        void bootstrapHost();
    }, []);
    useEffect(() => {
        if (!hostDevice)
            return;
        void refreshMetadata(hostDevice.id);
    }, [hostDevice]);
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio)
            return;
        void reconcileAudio(audio, state);
    }, [state]);
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio)
            return;
        const onTimeUpdate = () => {
            sendCommand({
                type: "SEEK",
                progressMs: Math.floor(audio.currentTime * 1000)
            }, false);
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
        if (!state.durationMs)
            return 0;
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
    const handleUpload = async (event) => {
        if (!hostDevice || !event.target.files?.[0])
            return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", event.target.files[0]);
            formData.append("senderDeviceId", hostDevice.id);
            formData.append("senderName", hostDevice.name);
            const response = await fetch(`${socketUrl}/api/files/upload`, {
                method: "POST",
                body: formData
            });
            if (!response.ok) {
                throw new Error("Upload failed");
            }
            await refreshMetadata(hostDevice.id);
        }
        finally {
            setUploading(false);
            event.target.value = "";
        }
    };
    return (_jsxs("main", { className: "min-h-screen px-6 py-8 text-ember md:px-10", children: [_jsx("audio", { ref: audioRef }), _jsxs(motion.div, { className: "mx-auto grid max-w-7xl gap-6 lg:grid-cols-[1.35fr_1fr]", initial: { opacity: 0, y: 32 }, animate: { opacity: 1, y: 0 }, transition: { duration: playerTheme.motion.smooth }, children: [_jsxs("div", { className: "grid gap-6", children: [_jsxs(GlassCard, { className: "overflow-hidden p-8", children: [_jsxs("div", { className: "mb-8 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "mb-2 text-sm uppercase tracking-[0.3em] text-ember/70", children: "StreamLink Host" }), _jsx("h1", { className: "text-4xl font-semibold text-ember", children: "Unified Playback Engine" })] }), _jsx("div", { className: `rounded-full px-4 py-2 text-sm ${connected ? "bg-accent/15 text-accent" : "bg-red-500/10 text-red-300"}`, children: connected ? "Laptop Ready" : "Pairing Host" })] }), _jsxs("div", { className: "grid gap-8 md:grid-cols-[280px_1fr]", children: [_jsxs("div", { className: "relative aspect-square overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-glow", children: [state.currentTrack?.artworkUrl ? (_jsx("img", { src: state.currentTrack.artworkUrl, alt: state.currentTrack.title, className: "h-full w-full object-cover" })) : null, _jsx("div", { className: "absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" })] }), _jsxs("div", { className: "flex flex-col justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm uppercase tracking-[0.3em] text-accent/80", children: "Now Streaming" }), _jsx("h2", { className: "mt-3 text-5xl font-semibold leading-tight text-ember", children: state.currentTrack?.title ?? "Queue a track" }), _jsx("p", { className: "mt-3 text-lg text-[#f6c28b]", children: state.currentTrack?.artist ?? "Phone or laptop can start playback" })] }), _jsxs("div", { children: [_jsxs("div", { className: "mb-3 flex justify-between text-sm text-[#f6c28b]", children: [_jsxs("span", { children: [Math.floor(state.progressMs / 1000), "s"] }), _jsxs("span", { children: [Math.floor(state.durationMs / 1000), "s"] })] }), _jsx("div", { className: "h-3 overflow-hidden rounded-full bg-white/10", children: _jsx("div", { className: "h-full rounded-full bg-accent shadow-glow", style: { width: `${progressPercent}%` } }) })] }), _jsx(PlayerControls, { state: state, onCommand: sendCommand })] })] })] }), _jsxs("div", { className: "grid gap-6 md:grid-cols-2", children: [_jsxs(GlassCard, { className: "p-6", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsx("h3", { className: "text-xl font-semibold text-ember", children: "Pair Phone" }), _jsx("button", { className: "rounded-full bg-accent/15 px-4 py-2 text-sm text-accent", onClick: generatePin, children: "Generate PIN" })] }), _jsx("p", { className: "text-sm text-[#f6c28b]", children: "Phone server URL" }), _jsx("p", { className: "mt-2 break-all rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-ember", children: lanAddresses.length ? lanAddresses.map((item) => `${item}:4000`).join(" / ") : "Open the server and use your laptop LAN IP with port 4000." }), _jsx("p", { className: "mt-4 text-sm text-[#f6c28b]", children: "Active pairing PIN" }), _jsx("div", { className: "mt-2 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-4 text-center text-4xl tracking-[0.35em] text-accent", children: pairingPin?.pin ?? "------" })] }), _jsxs(GlassCard, { className: "p-6", children: [_jsx("h3", { className: "mb-4 text-xl font-semibold text-ember", children: "Trusted Devices" }), _jsx("div", { className: "space-y-3", children: devices.map((device) => (_jsx("div", { className: "rounded-[20px] border border-white/10 bg-white/5 px-4 py-3", children: _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-lg text-ember", children: device.name }), _jsx("div", { className: "text-sm uppercase tracking-[0.2em] text-[#f6c28b]", children: device.type })] }), _jsx("div", { className: "text-right text-sm text-[#f6c28b]", children: new Date(device.lastSeenAt).toLocaleString() })] }) }, device.id))) })] })] })] }), _jsxs("div", { className: "grid gap-6", children: [_jsxs(GlassCard, { className: "p-6", children: [_jsx("h3", { className: "mb-4 text-xl font-semibold text-ember", children: "Queue" }), _jsx(QueueList, { queue: state.queue, currentTrackId: state.currentTrack?.id })] }), _jsxs(GlassCard, { className: "p-6", children: [_jsxs("div", { className: "mb-4 flex items-center justify-between", children: [_jsx("h3", { className: "text-xl font-semibold text-ember", children: "Local File Bridge" }), _jsxs("label", { className: "cursor-pointer rounded-full bg-accent/15 px-4 py-2 text-sm text-accent", children: [uploading ? "Uploading..." : "Send File", _jsx("input", { hidden: true, type: "file", onChange: handleUpload })] })] }), _jsx("div", { className: "space-y-3", children: transfers.map((transfer) => (_jsx("div", { className: "rounded-[20px] border border-white/10 bg-white/5 px-4 py-3", children: _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-ember", children: transfer.fileName }), _jsxs("div", { className: "text-sm text-[#f6c28b]", children: [transfer.senderName ?? transfer.senderDeviceId, " \uFFFD ", Math.round(transfer.fileSize / 1024), " KB"] })] }), _jsx("a", { className: "rounded-full bg-white/10 px-4 py-2 text-sm text-accent", href: `${socketUrl}${transfer.downloadUrl}`, children: "Download" })] }) }, transfer.transferId))) })] })] })] })] }));
}
