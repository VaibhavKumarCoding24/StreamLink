import { colors, radii, shadows, spacing, typography } from "./tokens";

export const playerTheme = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
  blur: 22,
  motion: {
    quick: 0.18,
    smooth: 0.32,
    spring: {
      damping: 18,
      stiffness: 180
    }
  }
} as const;

export type PlayerTheme = typeof playerTheme;