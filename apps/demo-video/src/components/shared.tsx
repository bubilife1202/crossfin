import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from 'remotion';
import { COLORS, FONTS } from '../styles';

export const TypingText: React.FC<{
  text: string;
  startFrame?: number;
  framesPerChar?: number;
  style?: React.CSSProperties;
  cursorColor?: string;
  showCursor?: boolean;
}> = ({
  text,
  startFrame = 0,
  framesPerChar = 2,
  style = {},
  cursorColor = COLORS.green,
  showCursor = true,
}) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const charsToShow = Math.min(
    Math.floor(elapsed / framesPerChar),
    text.length
  );
  const visibleText = text.slice(0, charsToShow);
  const isTypingDone = charsToShow >= text.length;
  const cursorVisible = showCursor && (isTypingDone ? Math.floor(frame / 15) % 2 === 0 : true);

  return (
    <span style={{ fontFamily: FONTS.mono, whiteSpace: 'pre', ...style }}>
      {visibleText}
      {cursorVisible && (
        <span
          style={{
            backgroundColor: cursorColor,
            width: '0.6em',
            height: '1.1em',
            display: 'inline-block',
            marginLeft: 2,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </span>
  );
};

export const CountUp: React.FC<{
  target: number;
  startFrame?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  style?: React.CSSProperties;
  formatFn?: (n: number) => string;
}> = ({
  target,
  startFrame = 0,
  duration = 45,
  prefix = '',
  suffix = '',
  decimals = 0,
  style = {},
  formatFn,
}) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const progress = interpolate(elapsed, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const value = target * progress;
  const displayValue = formatFn
    ? formatFn(value)
    : value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

  return (
    <span style={{ fontFamily: FONTS.mono, ...style }}>
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
};

export const SlideIn: React.FC<{
  direction?: 'left' | 'right' | 'bottom' | 'top';
  startFrame?: number;
  duration?: number;
  distance?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({
  direction = 'left',
  startFrame = 0,
  duration = 20,
  distance = 120,
  children,
  style = {},
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < -5) return null;

  const progress = spring({
    frame: Math.max(0, elapsed),
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.8 },
    durationInFrames: duration,
  });

  const translateMap = {
    left: `translateX(${interpolate(progress, [0, 1], [-distance, 0])}px)`,
    right: `translateX(${interpolate(progress, [0, 1], [distance, 0])}px)`,
    bottom: `translateY(${interpolate(progress, [0, 1], [distance, 0])}px)`,
    top: `translateY(${interpolate(progress, [0, 1], [-distance, 0])}px)`,
  };

  const opacity = interpolate(progress, [0, 0.3, 1], [0, 0.8, 1]);

  return (
    <div
      style={{
        transform: translateMap[direction],
        opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const FadeIn: React.FC<{
  startFrame?: number;
  duration?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ startFrame = 0, duration = 15, children, style = {} }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const opacity = interpolate(elapsed, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return <div style={{ opacity, ...style }}>{children}</div>;
};

export const GlitchText: React.FC<{
  text: string;
  startFrame?: number;
  glitchIntensity?: number;
  style?: React.CSSProperties;
  color?: string;
}> = ({
  text,
  startFrame = 0,
  glitchIntensity = 8,
  style = {},
  color = COLORS.red,
}) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const isGlitching = elapsed < 30 && elapsed % 4 < 2;
  const offsetX = isGlitching
    ? Math.sin(elapsed * 7.3) * glitchIntensity
    : 0;
  const offsetY = isGlitching
    ? Math.cos(elapsed * 5.1) * (glitchIntensity * 0.5)
    : 0;
  const skew = isGlitching ? Math.sin(elapsed * 11.7) * 3 : 0;

  return (
    <div style={{ position: 'relative', ...style }}>
      {isGlitching && (
        <>
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              color: COLORS.cyan,
              opacity: 0.7,
              transform: `translate(${-offsetX}px, ${-offsetY}px)`,
              clipPath: 'inset(10% 0 60% 0)',
            }}
          >
            {text}
          </span>
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              color,
              opacity: 0.7,
              transform: `translate(${offsetX}px, ${offsetY}px)`,
              clipPath: 'inset(50% 0 10% 0)',
            }}
          >
            {text}
          </span>
        </>
      )}
      <span
        style={{
          position: 'relative',
          color: isGlitching ? color : undefined,
          transform: `skewX(${skew}deg)`,
          display: 'inline-block',
        }}
      >
        {text}
      </span>
    </div>
  );
};

export const CursorBlink: React.FC<{
  color?: string;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}> = ({
  color = COLORS.green,
  width = 14,
  height = 28,
  style = {},
}) => {
  const frame = useCurrentFrame();
  const visible = Math.floor(frame / 15) % 2 === 0;

  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        backgroundColor: visible ? color : 'transparent',
        verticalAlign: 'text-bottom',
        ...style,
      }}
    />
  );
};

export const BarChart: React.FC<{
  bars: Array<{ label: string; value: number; color?: string }>;
  maxValue?: number;
  startFrame?: number;
  barWidth?: number;
  barGap?: number;
  height?: number;
  style?: React.CSSProperties;
  showValues?: boolean;
}> = ({
  bars,
  maxValue: maxValueProp,
  startFrame = 0,
  barWidth = 120,
  barGap = 30,
  height = 300,
  style = {},
  showValues = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const maxValue = maxValueProp ?? Math.max(...bars.map((b) => b.value));

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: barGap,
        height,
        ...style,
      }}
    >
      {bars.map((bar, i) => {
        const barProgress = spring({
          frame: Math.max(0, elapsed - i * 6),
          fps,
          config: { damping: 15, stiffness: 80 },
          durationInFrames: 30,
        });

        const barHeight = (bar.value / maxValue) * height * barProgress;
        const barColor = bar.color ?? COLORS.green;

        return (
          <div
            key={bar.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {showValues && (
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 16,
                  color: barColor,
                  opacity: barProgress,
                }}
              >
                {Math.round(bar.value * barProgress).toLocaleString()}
              </span>
            )}
            <div
              style={{
                width: barWidth,
                height: barHeight,
                backgroundColor: barColor,
                borderRadius: '4px 4px 0 0',
                boxShadow: `0 0 20px ${barColor}44`,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '50%',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)',
                }}
              />
            </div>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.textDim,
                textAlign: 'center',
                maxWidth: barWidth + 20,
              }}
            >
              {bar.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const PulsingNode: React.FC<{
  label: string;
  x: number;
  y: number;
  startFrame?: number;
  size?: number;
  color?: string;
  pulseSpeed?: number;
}> = ({
  label,
  x,
  y,
  startFrame = 0,
  size = 60,
  color = COLORS.green,
  pulseSpeed = 0.08,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const entryProgress = spring({
    frame: Math.max(0, elapsed),
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  const pulse = 1 + Math.sin(elapsed * pulseSpeed) * 0.12;
  const scale = entryProgress * pulse;

  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${scale})`,
        opacity: entryProgress,
      }}
    >
      <div
        style={{
          width: size * 0.7,
          height: size * 0.7,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          backgroundColor: `${color}22`,
          boxShadow: `0 0 ${20 * pulse}px ${color}44, inset 0 0 10px ${color}22`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 20,
          color,
          marginTop: 6,
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </div>
  );
};

export const SceneContainer: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style = {} }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: 1920,
      height: 1080,
      backgroundColor: COLORS.bg,
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);

export const GridOverlay: React.FC<{
  opacity?: number;
}> = ({ opacity = 0.03 }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundImage: `
        linear-gradient(${COLORS.green}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 1px, transparent 1px),
        linear-gradient(90deg, ${COLORS.green}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 1px, transparent 1px)
      `,
      backgroundSize: '40px 40px',
      pointerEvents: 'none',
    }}
  />
);

export const Scanline: React.FC = () => {
  const frame = useCurrentFrame();
  const y = (frame * 3) % 1080;
  return (
    <div
      style={{
        position: 'absolute',
        top: y,
        left: 0,
        width: '100%',
        height: 2,
        background: `linear-gradient(90deg, transparent 0%, ${COLORS.green}15 30%, ${COLORS.green}15 70%, transparent 100%)`,
        pointerEvents: 'none',
      }}
    />
  );
};

export const NoiseTexture: React.FC<{ opacity?: number }> = ({
  opacity = 0.04,
}) => {
  const frame = useCurrentFrame();
  const seed = frame % 3;
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity,
        background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' seed='${seed}' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`,
        backgroundSize: '256px 256px',
        pointerEvents: 'none',
      }}
    />
  );
};

export const Vignette: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)',
      pointerEvents: 'none',
    }}
  />
);

export const GlowOrb: React.FC<{
  x: number;
  y: number;
  size?: number;
  color?: string;
  opacity?: number;
}> = ({ x, y, size = 400, color = COLORS.green, opacity = 0.08 }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame * 0.02) * 20;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2 + drift,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent 70%)`,
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }}
    />
  );
};

export const AnimatedLine: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  startFrame?: number;
  duration?: number;
  color?: string;
  strokeWidth?: number;
}> = ({
  x1,
  y1,
  x2,
  y2,
  startFrame = 0,
  duration = 20,
  color = COLORS.green,
  strokeWidth = 2,
}) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const progress = interpolate(elapsed, [0, duration], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const currentX2 = x1 + (x2 - x1) * progress;
  const currentY2 = y1 + (y2 - y1) * progress;

  const pulseR = 4 + Math.sin(elapsed * 0.3) * 4;

  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, width: 1920, height: 1080, pointerEvents: 'none' }}
      viewBox="0 0 1920 1080"
    >
      <title>Connection line</title>
      <line
        x1={x1}
        y1={y1}
        x2={currentX2}
        y2={currentY2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        opacity={0.6 + progress * 0.4}
      />
      <circle
        cx={currentX2}
        cy={currentY2}
        r={pulseR}
        fill={color}
        opacity={progress}
      />
    </svg>
  );
};
