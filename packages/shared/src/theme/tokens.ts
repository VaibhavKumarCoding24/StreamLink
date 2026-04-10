export const colors = {
  background: "#0B0B0B",
  backgroundElevated: "#111111",
  accent: "#00FFC6",
  accentMuted: "rgba(0, 255, 198, 0.18)",
  textPrimary: "#FF7A00",
  textSecondary: "#F6C28B",
  glass: "rgba(255, 255, 255, 0.08)",
  glassStrong: "rgba(255, 255, 255, 0.14)",
  glassBorder: "rgba(255, 255, 255, 0.16)",
  glow: "rgba(0, 255, 198, 0.28)",
  danger: "#FF5A5A",
  success: "#6FFFB6"
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48
} as const;

export const radii = {
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999
} as const;

export const typography = {
  hero: 34,
  h1: 28,
  h2: 22,
  body: 16,
  meta: 13,
  caption: 11
} as const;

export const shadows = {
  glow: `0 0 32px ${colors.glow}`,
  soft: "0 18px 50px rgba(0, 0, 0, 0.32)"
} as const;