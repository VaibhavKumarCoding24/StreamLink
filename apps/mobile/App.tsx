import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as DocumentPicker from "expo-document-picker";
import type { DiscoveredStreamLinkServer, FileTransferRecord, PairedDevice, PairingSession, TrustedDevice } from "@streamlink/shared";
import { colors, radii, spacing, typography } from "@streamlink/shared";
import { useMdnsDiscovery } from "./src/hooks/useMdnsDiscovery";
import { useMobileSync } from "./src/hooks/useMobileSync";
import { useSmartMediaCache } from "./src/hooks/useSmartMediaCache";
import { QueueStack } from "./src/components/QueueStack";

const storageKeys = {
  serverUrl: "streamlink.mobile.serverUrl",
  pairedDevice: "streamlink.mobile.pairedDevice",
  fingerprint: "streamlink.mobile.fingerprint",
  localLibrary: "streamlink.mobile.localLibrary"
};

type PlaybackTarget = "device" | "cast";

type LocalMediaItem = {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  sizeBytes?: number;
  importedAt: number;
};

type UnifiedLibraryItem = {
  id: string;
  title: string;
  subtitle: string;
  sourceType: "local" | "remote";
  mimeType: string;
  sizeBytes?: number;
  streamUrl?: string;
  localUri?: string;
  transferId?: string;
  importedAt: number;
  cached: boolean;
  lossless: boolean;
  qualityLabel: string;
};

type ReceivedCategory = "images" | "videos" | "documents" | "other";

function GlassPanel({ children }: React.PropsWithChildren) {
  return (
    <BlurView intensity={30} tint="dark" style={styles.glassPanel}>
      {children}
    </BlurView>
  );
}

function ActionButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.actionButton, disabled && styles.actionButtonDisabled]}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function SourceToggle({
  value,
  onChange
}: {
  value: PlaybackTarget;
  onChange: (next: PlaybackTarget) => void;
}) {
  return (
    <View style={styles.toggleShell}>
      {(["device", "cast"] as const).map((target) => {
        const active = value === target;
        return (
          <Pressable key={target} onPress={() => onChange(target)} style={[styles.toggleChip, active && styles.toggleChipActive]}>
            <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>
              {target === "device" ? "This Device" : "Cast"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const getExtension = (value: string) => {
  const parts = value.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
};

const formatBytes = (sizeBytes?: number) => {
  if (!sizeBytes) return "Unknown size";
  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isLosslessMedia = (mimeType: string, title: string) => {
  const extension = getExtension(title);
  return ["flac", "wav", "aiff", "alac", "ape"].includes(extension) || /flac|wav|aiff|alac|lossless/i.test(mimeType);
};

const estimateQualityLabel = (sizeBytes: number | undefined, mimeType: string, lossless: boolean) => {
  if (lossless) {
    return "Lossless";
  }

  if (!sizeBytes) {
    return mimeType.startsWith("video/") ? "Original video" : "Original audio";
  }

  if (mimeType.startsWith("video/")) {
    return sizeBytes > 150 * 1024 * 1024 ? "High bitrate video" : "Stream-ready";
  }

  if (sizeBytes > 25 * 1024 * 1024) {
    return "Hi-fi audio";
  }

  if (sizeBytes > 8 * 1024 * 1024) {
    return "320 kbps class";
  }

  return "Compressed";
};

const categorizeTransfer = (transfer: FileTransferRecord): ReceivedCategory => {
  if (transfer.mimeType.startsWith("image/")) return "images";
  if (transfer.mimeType.startsWith("video/")) return "videos";
  if (transfer.mimeType.startsWith("audio/")) return "other";
  if (/pdf|word|excel|powerpoint|text|json|zip|officedocument/i.test(transfer.mimeType)) return "documents";
  return "other";
};

export default function App() {
  const [serverUrl, setServerUrl] = useState("");
  const [pairPin, setPairPin] = useState("");
  const [deviceName, setDeviceName] = useState("Android Remote");
  const [pairedDevice, setPairedDevice] = useState<PairedDevice | null>(null);
  const [hostSession, setHostSession] = useState<PairingSession | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [transfers, setTransfers] = useState<FileTransferRecord[]>([]);
  const [localLibrary, setLocalLibrary] = useState<LocalMediaItem[]>([]);
  const [playbackTarget, setPlaybackTarget] = useState<PlaybackTarget>("device");
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [healthMessage, setHealthMessage] = useState("Looking for nearby StreamLink hosts over Wi-Fi...");
  const { services: discoveredHosts, isScanning, scanError, refresh: refreshDiscovery } = useMdnsDiscovery();
  const { state, connected, sendCommand, latestTransferOffer, latestTransferProgress } = useMobileSync(serverUrl, pairedDevice);
  const smartCache = useSmartMediaCache({
    track: state.currentTrack,
    serverUrl,
    playbackPositionMs: state.progressMs,
    enabled: Boolean(serverUrl && state.currentTrack?.sourceUrl)
  });

  const canControl = useMemo(() => Boolean(serverUrl && pairedDevice), [pairedDevice, serverUrl]);
  const libraryItems = useMemo<UnifiedLibraryItem[]>(() => {
    const localItems = localLibrary.map((item) => {
      const lossless = isLosslessMedia(item.mimeType, item.name);
      return {
        id: `local:${item.id}`,
        title: item.name,
        subtitle: "On this phone",
        sourceType: "local" as const,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        localUri: item.uri,
        importedAt: item.importedAt,
        cached: true,
        lossless,
        qualityLabel: estimateQualityLabel(item.sizeBytes, item.mimeType, lossless)
      };
    });

    const remoteItems = transfers.map((transfer) => {
      const lossless = isLosslessMedia(transfer.mimeType, transfer.fileName);
      const streamPath = transfer.streamUrl ?? transfer.downloadUrl;
      const resolvedStreamUrl = streamPath ? new URL(streamPath, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`).toString() : undefined;
      return {
        id: `remote:${transfer.transferId}`,
        title: transfer.fileName,
        subtitle: transfer.senderName ?? "Connected device",
        sourceType: "remote" as const,
        mimeType: transfer.mimeType,
        sizeBytes: transfer.fileSize,
        streamUrl: resolvedStreamUrl,
        transferId: transfer.transferId,
        importedAt: transfer.createdAt,
        cached: transfer.transferId === smartCache.activeTrackId ? smartCache.cachedBytes > 0 : false,
        lossless,
        qualityLabel: lossless
          ? "Lossless"
          : transfer.supportsByteRange
            ? `${transfer.chunkSizeBytes ? `${Math.round(transfer.chunkSizeBytes / 1024)} KB chunks` : "Chunked"}`
            : estimateQualityLabel(transfer.fileSize, transfer.mimeType, lossless)
      };
    });

    return [...localItems, ...remoteItems].sort((left, right) => right.importedAt - left.importedAt);
  }, [localLibrary, serverUrl, smartCache.activeTrackId, smartCache.cachedBytes, transfers]);

  const selectedLibraryItem = useMemo(
    () => libraryItems.find((item) => item.id === selectedLibraryId) ?? libraryItems[0] ?? null,
    [libraryItems, selectedLibraryId]
  );
  const selectedItemCached = useMemo(() => {
    if (!selectedLibraryItem) return false;
    if (selectedLibraryItem.sourceType === "local") return true;
    return selectedLibraryItem.transferId === smartCache.activeTrackId ? smartCache.cachedBytes > 0 : selectedLibraryItem.cached;
  }, [selectedLibraryItem, smartCache.activeTrackId, smartCache.cachedBytes]);
  const receivedTransfers = useMemo(() => {
    const categories: Record<ReceivedCategory, FileTransferRecord[]> = {
      images: [],
      videos: [],
      documents: [],
      other: []
    };

    transfers.forEach((transfer) => {
      categories[categorizeTransfer(transfer)].push(transfer);
    });

    return categories;
  }, [transfers]);

  useEffect(() => {
    const bootstrap = async () => {
      const storedUrl = await AsyncStorage.getItem(storageKeys.serverUrl);
      const storedDevice = await AsyncStorage.getItem(storageKeys.pairedDevice);
      const storedLibrary = await AsyncStorage.getItem(storageKeys.localLibrary);
      if (storedUrl) setServerUrl(storedUrl);
      if (storedDevice) setPairedDevice(JSON.parse(storedDevice) as PairedDevice);
      if (storedLibrary) setLocalLibrary(JSON.parse(storedLibrary) as LocalMediaItem[]);
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!serverUrl && discoveredHosts[0]) {
      setServerUrl(discoveredHosts[0].serverUrl);
    }
  }, [discoveredHosts, serverUrl]);

  useEffect(() => {
    if (!selectedLibraryId && libraryItems[0]) {
      setSelectedLibraryId(libraryItems[0].id);
      return;
    }

    if (selectedLibraryId && !libraryItems.some((item) => item.id === selectedLibraryId)) {
      setSelectedLibraryId(libraryItems[0]?.id ?? null);
    }
  }, [libraryItems, selectedLibraryId]);

  useEffect(() => {
    if (!latestTransferOffer) return;
    setTransfers((current) => {
      const remaining = current.filter((item) => item.transferId !== latestTransferOffer.transferId);
      return [latestTransferOffer as FileTransferRecord, ...remaining];
    });
  }, [latestTransferOffer]);

  useEffect(() => {
    if (!latestTransferProgress) return;
    setTransfers((current) =>
      current.map((transfer) =>
        transfer.transferId === latestTransferProgress.transferId
          ? { ...transfer, status: latestTransferProgress.status }
          : transfer
      )
    );
  }, [latestTransferProgress]);

  const getFingerprint = async () => {
    const existing = await AsyncStorage.getItem(storageKeys.fingerprint);
    if (existing) return existing;
    const next = `android-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await AsyncStorage.setItem(storageKeys.fingerprint, next);
    return next;
  };

  const refreshServerData = async (deviceId?: string) => {
    const [healthRes, devicesRes, transfersRes] = await Promise.all([
      fetch(`${serverUrl}/health`),
      fetch(`${serverUrl}/api/pairing/devices`),
      fetch(`${serverUrl}/api/files${deviceId ? `?deviceId=${deviceId}` : ""}`)
    ]);

    const health = await healthRes.json();
    setHostSession(null);
    setHealthMessage(health.addresses?.length ? `Laptop LAN IPs: ${health.addresses.join(", ")}` : "Server is reachable on LAN.");
    setTrustedDevices(await devicesRes.json());
    setTransfers(await transfersRes.json());
  };

  const testConnection = async () => {
    try {
      await AsyncStorage.setItem(storageKeys.serverUrl, serverUrl);
      await refreshServerData(pairedDevice?.id);
    } catch (error) {
      Alert.alert("Connection failed", error instanceof Error ? error.message : "Unable to reach server");
    }
  };

  const selectDiscoveredHost = (host: DiscoveredStreamLinkServer) => {
    setServerUrl(host.serverUrl);
    setHealthMessage(`Selected ${host.name} at ${host.serverUrl}`);
  };

  const pairDevice = async () => {
    try {
      const fingerprint = await getFingerprint();
      const response = await fetch(`${serverUrl}/api/pairing/trust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceName,
          deviceType: "android",
          fingerprint,
          pin: pairPin
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Unable to pair device");
      }

      const paired = data as PairedDevice;
      setPairedDevice(paired);
      await AsyncStorage.setItem(storageKeys.pairedDevice, JSON.stringify(paired));
      await AsyncStorage.setItem(storageKeys.serverUrl, serverUrl);
      await refreshServerData(paired.id);
      setPairPin("");
    } catch (error) {
      Alert.alert("Pairing failed", error instanceof Error ? error.message : "Unable to pair device");
    }
  };

  const uploadFile = async () => {
    if (!pairedDevice) {
      Alert.alert("Pair first", "You need to pair this phone before sending files.");
      return;
    }

    const picked = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) {
      return;
    }

    const asset = picked.assets[0];
    const formData = new FormData();
    formData.append("senderDeviceId", pairedDevice.id);
    formData.append("senderName", pairedDevice.name);
    formData.append("file", {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream"
    } as unknown as Blob);

    try {
      const response = await fetch(`${serverUrl}/api/files/upload`, {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Upload failed");
      }
      await refreshServerData(pairedDevice.id);
      Alert.alert("Upload complete", `${asset.name} is now available on the laptop.`);
    } catch (error) {
      Alert.alert("Upload failed", error instanceof Error ? error.message : "Unable to send file");
    }
  };

  const importLocalMedia = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: ["audio/*", "video/*"]
    });

    if (picked.canceled || !picked.assets[0]) {
      return;
    }

    const asset = picked.assets[0];
    const nextItem: LocalMediaItem = {
      id: `local-${Date.now()}`,
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType ?? "application/octet-stream",
      sizeBytes: asset.size,
      importedAt: Date.now()
    };

    const nextLibrary = [nextItem, ...localLibrary].slice(0, 30);
    setLocalLibrary(nextLibrary);
    setSelectedLibraryId(`local:${nextItem.id}`);
    await AsyncStorage.setItem(storageKeys.localLibrary, JSON.stringify(nextLibrary));
  };

  const handleLibraryAction = async () => {
    if (!selectedLibraryItem) {
      return;
    }

    if (playbackTarget === "device") {
      if (selectedLibraryItem.sourceType === "local" && selectedLibraryItem.localUri) {
        const supported = await Linking.canOpenURL(selectedLibraryItem.localUri);
        if (supported) {
          await Linking.openURL(selectedLibraryItem.localUri);
          return;
        }

        Alert.alert("Selected for playback", `${selectedLibraryItem.title} is ready on this device.`);
        return;
      }

      if (selectedLibraryItem.streamUrl) {
        const supported = await Linking.canOpenURL(selectedLibraryItem.streamUrl);
        if (supported) {
          await Linking.openURL(selectedLibraryItem.streamUrl);
          return;
        }
      }

      Alert.alert("Unavailable", "This media item does not have a playable local source yet.");
      return;
    }

    if (!canControl) {
      Alert.alert("Pair first", "Connect to a StreamLink host before casting media.");
      return;
    }

    Alert.alert("Cast queued", `${selectedLibraryItem.title} is selected for the connected system.`);
  };

  const openDownload = async (transfer: FileTransferRecord) => {
    const url = `${serverUrl}${transfer.downloadUrl}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        <GlassPanel>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.kicker}>Android Controller</Text>
              <Text style={styles.title}>Connect over LAN and mirror the laptop in real time</Text>
            </View>
            <View style={[styles.badge, connected ? styles.badgeOn : styles.badgeOff]}>
              <Text style={connected ? styles.badgeTextOn : styles.badgeTextOff}>{connected ? "Synced" : "Not Live"}</Text>
            </View>
          </View>

          <Text style={styles.label}>Laptop server URL</Text>
          <TextInput value={serverUrl} onChangeText={setServerUrl} style={styles.input} autoCapitalize="none" autoCorrect={false} />
          <Text style={styles.helper}>{scanError ?? healthMessage}</Text>
          <View style={styles.inlineBetween}>
            <Text style={styles.label}>Nearby hosts</Text>
            <Pressable onPress={refreshDiscovery}>
              <Text style={styles.discoveryAction}>{isScanning ? "Scanning..." : "Rescan"}</Text>
            </Pressable>
          </View>
          <View style={styles.list}>
            {discoveredHosts.length ? (
              discoveredHosts.map((host) => (
                <Pressable key={host.id} style={styles.transferCard} onPress={() => selectDiscoveredHost(host)}>
                  <View>
                    <Text style={styles.transferTitle}>{host.name}</Text>
                    <Text style={styles.transferMeta}>{host.serverUrl}</Text>
                  </View>
                  <Text style={styles.downloadCta}>{serverUrl === host.serverUrl ? "Selected" : "Use"}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.helper}>No hosts discovered yet. You can still enter a URL manually.</Text>
            )}
          </View>
          <ActionButton label="Test Selected Host" onPress={testConnection} />

          <Text style={styles.label}>Phone name</Text>
          <TextInput value={deviceName} onChangeText={setDeviceName} style={styles.input} autoCapitalize="words" />
          <Text style={styles.label}>4-digit PIN from laptop</Text>
          <TextInput value={pairPin} onChangeText={setPairPin} style={styles.input} keyboardType="number-pad" maxLength={4} />
          <ActionButton label={pairedDevice ? "Re-pair and Connect" : "Pair and Connect"} onPress={pairDevice} />
        </GlassPanel>

        <GlassPanel>
          <Text style={styles.sectionTitle}>Now Playing</Text>
          <View style={styles.inlineBetween}>
            <Text style={styles.artist}>Unified player route</Text>
            <SourceToggle value={playbackTarget} onChange={setPlaybackTarget} />
          </View>
          <Text style={styles.trackTitle}>{state.currentTrack?.title ?? "Waiting for host playback"}</Text>
          <Text style={styles.artist}>{state.currentTrack?.artist ?? "Pair and connect to begin"}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${state.durationMs ? (state.progressMs / state.durationMs) * 100 : 0}%` }]} />
          </View>
          <View style={styles.controlsRow}>
            <ActionButton label="Prev" onPress={() => sendCommand({ type: "PREVIOUS" })} disabled={!canControl} />
            <ActionButton label={state.isPlaying ? "Pause" : "Play"} onPress={() => sendCommand({ type: state.isPlaying ? "PAUSE" : "PLAY" })} disabled={!canControl} />
            <ActionButton label="Next" onPress={() => sendCommand({ type: "NEXT" })} disabled={!canControl} />
          </View>
        </GlassPanel>

        <GlassPanel>
          <View style={styles.inlineBetween}>
            <View>
              <Text style={styles.sectionTitle}>Unified Library</Text>
              <Text style={styles.helper}>Local files and remote media in one translucent queue</Text>
            </View>
            <Pressable onPress={importLocalMedia} style={styles.secondaryChip}>
              <Text style={styles.secondaryChipText}>Import</Text>
            </Pressable>
          </View>

          {selectedLibraryItem ? (
            <View style={styles.heroCard}>
              <View style={styles.heroGlow} />
              <View style={styles.inlineBetween}>
                <View style={styles.heroTextWrap}>
                  <Text style={styles.heroKicker}>{selectedLibraryItem.sourceType === "local" ? "Local" : "Remote"}</Text>
                  <Text style={styles.heroTitle}>{selectedLibraryItem.title}</Text>
                  <Text style={styles.heroSubtitle}>{selectedLibraryItem.subtitle}</Text>
                </View>
                <View style={styles.pillStack}>
                  <Text style={[styles.infoPill, selectedItemCached && styles.infoPillActive]}>
                    {selectedItemCached ? "Cached" : "Streaming"}
                  </Text>
                  <Text style={[styles.infoPill, selectedLibraryItem.lossless && styles.infoPillActive]}>
                    {selectedLibraryItem.qualityLabel}
                  </Text>
                </View>
              </View>
              <View style={styles.inlineBetween}>
                <Text style={styles.transferMeta}>{formatBytes(selectedLibraryItem.sizeBytes)}</Text>
                <Text style={styles.transferMeta}>
                  {playbackTarget === "device" ? "Play here" : "Cast to connected system"}
                </Text>
              </View>
              <ActionButton
                label={playbackTarget === "device" ? "Open Selected Media" : "Cast Selected Media"}
                onPress={handleLibraryAction}
                disabled={playbackTarget === "cast" && !canControl}
              />
            </View>
          ) : (
            <Text style={styles.helper}>Import media or connect to a host to start building the library.</Text>
          )}

          <View style={styles.list}>
            {libraryItems.map((item) => {
              const active = selectedLibraryItem?.id === item.id;
              const cached = item.id === selectedLibraryItem?.id ? selectedItemCached : item.cached;
              return (
                <Pressable key={item.id} style={[styles.libraryRow, active && styles.libraryRowActive]} onPress={() => setSelectedLibraryId(item.id)}>
                  <View style={styles.libraryMain}>
                    <Text style={styles.libraryTitle}>{item.title}</Text>
                    <Text style={styles.transferMeta}>{item.subtitle}</Text>
                  </View>
                  <View style={styles.libraryMeta}>
                    <Text style={[styles.badgeInline, cached && styles.badgeInlineActive]}>{cached ? "Cached" : "Live"}</Text>
                    <Text style={styles.transferMeta}>{item.qualityLabel}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </GlassPanel>

        <GlassPanel>
          <Text style={styles.sectionTitle}>Smart Cache</Text>
          <View style={styles.list}>
            <View style={styles.transferCard}>
              <View>
                <Text style={styles.transferTitle}>Status</Text>
                <Text style={styles.transferMeta}>{smartCache.status}</Text>
              </View>
              <Text style={styles.downloadCta}>{smartCache.bitPerfect ? "Bit-perfect" : "Verifying"}</Text>
            </View>
            <View style={styles.transferCard}>
              <View>
                <Text style={styles.transferTitle}>Startup Buffer</Text>
                <Text style={styles.transferMeta}>
                  {smartCache.totalBytes
                    ? `${Math.round((smartCache.startupTargetBytes / smartCache.totalBytes) * 100)}% or ${Math.round(smartCache.startupBufferMs / 1000)}s`
                    : `${Math.round(smartCache.startupBufferMs / 1000)}s target`}
                </Text>
              </View>
              <Text style={styles.transferMeta}>{Math.round(smartCache.startupTargetBytes / 1024)} KB</Text>
            </View>
            <View style={styles.transferCard}>
              <View>
                <Text style={styles.transferTitle}>Ahead of Playback</Text>
                <Text style={styles.transferMeta}>Look-ahead target {Math.round(smartCache.lookAheadMs / 1000)}s</Text>
              </View>
              <Text style={styles.downloadCta}>{Math.max(0, Math.round(smartCache.bufferedAheadMs / 1000))}s</Text>
            </View>
            <View style={styles.transferCard}>
              <View>
                <Text style={styles.transferTitle}>Cached Bytes</Text>
                <Text style={styles.transferMeta}>
                  {smartCache.cacheDirectoryUri ? "Stored in temporary cache" : "Waiting for stream"}
                </Text>
              </View>
              <Text style={styles.downloadCta}>
                {smartCache.totalBytes
                  ? `${((smartCache.cachedBytes / smartCache.totalBytes) * 100).toFixed(1)}%`
                  : `${Math.round(smartCache.cachedBytes / 1024)} KB`}
              </Text>
            </View>
            {smartCache.error ? (
              <Text style={styles.helper}>{smartCache.error}</Text>
            ) : (
              <Text style={styles.helper}>
                Raw byte ranges are cached directly to temporary storage and validated with per-segment MD5 hashes to keep the cache lossless.
              </Text>
            )}
          </View>
        </GlassPanel>

        <GlassPanel>
          <Text style={styles.sectionTitle}>Queue</Text>
          <QueueStack queue={state.queue} activeTrackId={state.currentTrack?.id} />
        </GlassPanel>

        <GlassPanel>
          <Text style={styles.sectionTitle}>Received Files</Text>
          <View style={styles.galleryGrid}>
            {([
              ["images", "Images"],
              ["videos", "Videos"],
              ["documents", "Documents"],
              ["other", "Other"]
            ] as const).map(([key, label]) => (
              <View key={key} style={styles.galleryCard}>
                <View style={styles.inlineBetween}>
                  <Text style={styles.transferTitle}>{label}</Text>
                  <Text style={styles.badgeInline}>{receivedTransfers[key].length}</Text>
                </View>
                {receivedTransfers[key].length ? (
                  <View style={styles.list}>
                    {receivedTransfers[key].slice(0, 3).map((transfer) => (
                      <Pressable key={transfer.transferId} style={styles.galleryItem} onPress={() => openDownload(transfer)}>
                        <View>
                          <Text style={styles.transferTitle}>{transfer.fileName}</Text>
                          <Text style={styles.transferMeta}>{formatBytes(transfer.fileSize)}</Text>
                        </View>
                        <Text style={styles.downloadCta}>{transfer.status === "completed" ? "Open" : transfer.status}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.helper}>No {label.toLowerCase()} received yet.</Text>
                )}
              </View>
            ))}
          </View>
        </GlassPanel>

        <GlassPanel>
          <View style={styles.inlineBetween}>
            <Text style={styles.sectionTitle}>File Sharing</Text>
            <ActionButton label="Send File" onPress={uploadFile} disabled={!pairedDevice} />
          </View>
          <View style={styles.list}>
            {transfers.map((transfer) => (
              <Pressable key={transfer.transferId} style={styles.transferCard} onPress={() => openDownload(transfer)}>
                <View>
                  <Text style={styles.transferTitle}>{transfer.fileName}</Text>
                  <Text style={styles.transferMeta}>{transfer.senderName ?? transfer.senderDeviceId} • {Math.round(transfer.fileSize / 1024)} KB</Text>
                </View>
                <Text style={styles.downloadCta}>Open</Text>
              </Pressable>
            ))}
          </View>
        </GlassPanel>

        <GlassPanel>
          <Text style={styles.sectionTitle}>Trusted Devices</Text>
          <View style={styles.list}>
            {trustedDevices.map((device) => (
              <View key={device.id} style={styles.transferCard}>
                <View>
                  <Text style={styles.transferTitle}>{device.name}</Text>
                  <Text style={styles.transferMeta}>{device.type}</Text>
                </View>
                <Text style={styles.transferMeta}>{new Date(device.lastSeenAt).toLocaleDateString()}</Text>
              </View>
            ))}
          </View>
        </GlassPanel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  container: {
    padding: spacing.lg,
    gap: spacing.lg,
    backgroundColor: colors.background
  },
  glassPanel: {
    borderRadius: radii.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    padding: spacing.lg,
    gap: spacing.md
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md
  },
  kicker: {
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 2,
    fontSize: typography.caption
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.h1,
    marginTop: spacing.xs,
    maxWidth: 220
  },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  badgeOn: {
    backgroundColor: colors.accentMuted
  },
  badgeOff: {
    backgroundColor: "rgba(255,90,90,0.14)"
  },
  badgeTextOn: {
    color: colors.accent
  },
  badgeTextOff: {
    color: colors.danger
  },
  label: {
    color: colors.textPrimary,
    fontSize: typography.meta
  },
  helper: {
    color: colors.textSecondary,
    fontSize: typography.meta
  },
  discoveryAction: {
    color: colors.accent,
    fontSize: typography.meta
  },
  toggleShell: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.glassBorder
  },
  toggleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill
  },
  toggleChipActive: {
    backgroundColor: colors.accentMuted
  },
  toggleLabel: {
    color: colors.textSecondary,
    fontSize: typography.meta
  },
  toggleLabelActive: {
    color: colors.accent
  },
  secondaryChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  secondaryChipText: {
    color: colors.accent,
    fontSize: typography.meta
  },
  input: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: typography.body
  },
  nowPlayingCard: {
    gap: spacing.sm
  },
  trackTitle: {
    color: colors.textPrimary,
    fontSize: typography.h1
  },
  heroCard: {
    position: "relative",
    overflow: "hidden",
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: spacing.lg,
    gap: spacing.md
  },
  heroGlow: {
    position: "absolute",
    top: -40,
    right: -20,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,198,0.14)"
  },
  heroTextWrap: {
    flex: 1,
    paddingRight: spacing.md
  },
  heroKicker: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    letterSpacing: 2,
    textTransform: "uppercase"
  },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: typography.h2,
    marginTop: spacing.xs
  },
  heroSubtitle: {
    color: colors.textSecondary,
    fontSize: typography.body,
    marginTop: spacing.xs
  },
  pillStack: {
    gap: spacing.xs,
    alignItems: "flex-end"
  },
  infoPill: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(255,255,255,0.05)"
  },
  infoPillActive: {
    color: colors.accent,
    borderColor: colors.accent
  },
  artist: {
    color: colors.textSecondary,
    fontSize: typography.body
  },
  progressTrack: {
    marginTop: spacing.sm,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent
  },
  controlsRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  actionButton: {
    flex: 1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassStrong,
    paddingVertical: spacing.md,
    alignItems: "center"
  },
  actionButtonDisabled: {
    opacity: 0.45
  },
  actionText: {
    color: colors.textPrimary,
    fontSize: typography.body
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: typography.h2
  },
  inlineBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  list: {
    gap: spacing.sm
  },
  galleryGrid: {
    gap: spacing.md
  },
  galleryCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: spacing.md,
    gap: spacing.sm
  },
  galleryItem: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  libraryRow: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  libraryRowActive: {
    borderColor: colors.accent,
    backgroundColor: "rgba(0,255,198,0.08)"
  },
  libraryMain: {
    flex: 1
  },
  libraryTitle: {
    color: colors.textPrimary,
    fontSize: typography.body
  },
  libraryMeta: {
    alignItems: "flex-end",
    gap: spacing.xs
  },
  badgeInline: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  badgeInlineActive: {
    color: colors.accent,
    borderColor: colors.accent
  },
  transferCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  transferTitle: {
    color: colors.textPrimary,
    fontSize: typography.body
  },
  transferMeta: {
    color: colors.textSecondary,
    fontSize: typography.meta
  },
  downloadCta: {
    color: colors.accent,
    fontSize: typography.meta
  }
});
