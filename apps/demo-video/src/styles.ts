export const COLORS = {
  bg: '#0a0a0f',
  bgLight: '#12121a',
  bgCard: '#16161f',
  text: '#e8e8e8',
  textDim: '#a0a0a8',
  green: '#00ff88',
  greenDim: '#00cc6a',
  cyan: '#00d4ff',
  cyanDim: '#0099bb',
  red: '#ff3344',
  redDim: '#cc2233',
  orange: '#ff8844',
  yellow: '#ffcc00',
  muted: '#666666',
  white: '#ffffff',
  border: '#2a2a3a',
  glow: 'rgba(0, 255, 136, 0.15)',
  cyanGlow: 'rgba(0, 212, 255, 0.15)',
  redGlow: 'rgba(255, 51, 68, 0.15)',
} as const;

export const FONTS = {
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace",
  sans: "'SF Pro Display', 'Helvetica Neue', 'Segoe UI', sans-serif",
  display: "'SF Pro Display', 'Helvetica Neue', sans-serif",
} as const;

// 80 BPM = 0.75s per beat = 22.5 frames at 30fps
export const BEAT = 22.5;

export const DURATIONS = {
  quickFade: 8,
  fade: 15,
  slide: 20,
  typeChar: 2,
  beat: BEAT,
  halfBeat: BEAT / 2,
  twoBeat: BEAT * 2,
} as const;

export const LAYOUT = {
  width: 1920,
  height: 1080,
  padding: 80,
  centerX: 960,
  centerY: 540,
} as const;

export const baseTextStyle: React.CSSProperties = {
  fontFamily: FONTS.mono,
  color: COLORS.text,
  fontSize: 24,
  lineHeight: 1.5,
  letterSpacing: '-0.02em',
};

export const headingStyle: React.CSSProperties = {
  fontFamily: FONTS.mono,
  color: COLORS.white,
  fontSize: 72,
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: '-0.04em',
};

export const greenAccent: React.CSSProperties = {
  color: COLORS.green,
  textShadow: `0 0 20px ${COLORS.glow}, 0 0 40px ${COLORS.glow}`,
};

export const cyanAccent: React.CSSProperties = {
  color: COLORS.cyan,
  textShadow: `0 0 20px ${COLORS.cyanGlow}, 0 0 40px ${COLORS.cyanGlow}`,
};

export const sourceStyle: React.CSSProperties = {
  fontFamily: FONTS.mono,
  color: COLORS.muted,
  fontSize: 14,
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};
