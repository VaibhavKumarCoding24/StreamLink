import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as DocumentPicker from "expo-document-picker";
import type { FileTransferRecord, PairedDevice, PairingSession, TrustedDevice } from "@streamlink/shared";
import { colors, radii, spacing, typography } from "@streamlink/shared";
import { useMobileSync } from "./src/hooks/useMobileSync";
import { QueueStack } from "./src/components/QueueStack";

const storageKeys = {
  serverUrl: "streamlink.mobile.serverUrl",
  pairedDevice: "streamlink.mobile.pairedDevice",
  fingerprint: "streamlink.mobile.fingerprint"
};

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

export default function App() {
  const [serverUrl, setServerUrl] = useState("http://192.168.1.2:4000");
  const [pairPin, setPairPin] = useState("");
  const [deviceName, setDeviceName] = useState("Android Remote");
  const [pairedDevice, setPairedDevice] = useState<PairedDevice | null>(null);
  const [hostSession, setHostSession] = useState<PairingSession | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [transfers, setTransfers] = useState<FileTransferRecord[]>([]);
  const [healthMessage, setHealthMessage] = useState("Enter your laptop LAN URL and pair using the PIN from the web host.");
  const { state, connected, sendCommand } = useMobileSync(serverUrl, pairedDevice);

  const canControl = useMemo(() => Boolean(serverUrl && pairedDevice), [pairedDevice, serverUrl]);

  useEffect(() => {
    const bootstrap = async () => {
      const storedUrl = await AsyncStorage.getItem(storageKeys.serverUrl);
      const storedDevice = await AsyncStorage.getItem(storageKeys.pairedDevice);
      if (storedUrl) setServerUrl(storedUrl);
      if (storedDevice) setPairedDevice(JSON.parse(storedDevice) as PairedDevice);
    };

    void bootstrap();
  }, []);

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
          <Text style={styles.helper}>{healthMessage}</Text>
          <ActionButton label="Test LAN Connection" onPress={testConnection} />

          <Text style={styles.label}>Phone name</Text>
          <TextInput value={deviceName} onChangeText={setDeviceName} style={styles.input} autoCapitalize="words" />
          <Text style={styles.label}>Pairing PIN from laptop</Text>
          <TextInput value={pairPin} onChangeText={setPairPin} style={styles.input} keyboardType="number-pad" maxLength={6} />
          <ActionButton label={pairedDevice ? "Re-pair Device" : "Pair This Phone"} onPress={pairDevice} />
        </GlassPanel>

        <GlassPanel>
          <Text style={styles.sectionTitle}>Now Playing</Text>
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
          <Text style={styles.sectionTitle}>Queue</Text>
          <QueueStack queue={state.queue} activeTrackId={state.currentTrack?.id} />
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