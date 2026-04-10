import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Track } from "@streamlink/shared";
import { colors, radii, spacing, typography } from "@streamlink/shared";

export function QueueStack({ queue, activeTrackId }: { queue: Track[]; activeTrackId?: string }) {
  return (
    <View style={styles.list}>
      {queue.map((track, index) => {
        const active = track.id === activeTrackId;
        return (
          <View key={track.id} style={[styles.row, active && styles.rowActive]}>
            <View>
              <Text style={styles.index}>{String(index + 1).padStart(2, "0")}</Text>
              <Text style={styles.title}>{track.title}</Text>
              <Text style={styles.artist}>{track.artist}</Text>
            </View>
            <Text style={styles.duration}>{Math.floor(track.durationMs / 1000)}s</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm
  },
  row: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  rowActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted
  },
  index: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    letterSpacing: 2
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    marginTop: spacing.xs
  },
  artist: {
    color: colors.textSecondary,
    fontSize: typography.meta
  },
  duration: {
    color: colors.textSecondary,
    fontSize: typography.meta
  }
});