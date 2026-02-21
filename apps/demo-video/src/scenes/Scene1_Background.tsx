import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Easing,
} from 'remotion';
import { COLORS, FONTS, BEAT } from '../styles';
import {
  SceneContainer,
  GridOverlay,
  Vignette,
  GlowOrb,
  CursorBlink,
  CountUp,
  SlideIn,
  FadeIn,
  PulsingNode,
  BarChart,
  NoiseTexture,
} from '../components/shared';

const SparklineGraph: React.FC<{
  startFrame: number;
  width?: number;
  height?: number;
}> = ({ startFrame, width = 500, height = 120 }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const dataPoints = [
    0.2, 0.25, 0.3, 0.28, 0.35, 0.4, 0.38, 0.5, 0.55, 0.6,
    0.58, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0, 0.95, 0.92,
  ];

  const visiblePoints = Math.min(
    Math.floor(interpolate(elapsed, [0, 40], [0, dataPoints.length], {
      extrapolateRight: 'clamp',
    })),
    dataPoints.length
  );

  const points = dataPoints
    .slice(0, visiblePoints)
    .map((v, i) => {
      const x = (i / (dataPoints.length - 1)) * width;
      const y = height - v * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <title>Market growth sparkline</title>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.green} stopOpacity="0.3" />
          <stop offset="100%" stopColor={COLORS.green} stopOpacity="0" />
        </linearGradient>
      </defs>
      {visiblePoints > 1 && (
        <>
          <polyline
            points={points}
            fill="none"
            stroke={COLORS.green}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon
            points={`0,${height} ${points} ${((visiblePoints - 1) / (dataPoints.length - 1)) * width},${height}`}
            fill="url(#sparkFill)"
          />
        </>
      )}
      {visiblePoints > 0 && (
        <circle
          cx={((visiblePoints - 1) / (dataPoints.length - 1)) * width}
          cy={height - dataPoints[visiblePoints - 1] * height}
          r={5}
          fill={COLORS.green}
        />
      )}
    </svg>
  );
};

export const Scene1_Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneContainer>
      <GridOverlay opacity={0.025} />
      <NoiseTexture opacity={0.03} />
      <GlowOrb x={960} y={400} size={600} color={COLORS.green} opacity={0.06} />
      <GlowOrb x={300} y={700} size={400} color={COLORS.cyan} opacity={0.04} />

      <Sequence from={0} durationInFrames={60}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <CursorBlink color={COLORS.green} width={16} height={32} />
        </div>
      </Sequence>

      <Sequence from={60} durationInFrames={120}>
        <div
          style={{
            position: 'absolute',
            top: '30%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 120,
              fontWeight: 800,
              color: COLORS.green,
              textShadow: `0 0 40px ${COLORS.glow}, 0 0 80px ${COLORS.glow}`,
              letterSpacing: '-0.04em',
            }}
          >
            $<CountUp
              target={2.3}
              startFrame={0}
              duration={50}
              decimals={1}
              style={{
                fontFamily: FONTS.mono,
                fontSize: 120,
                fontWeight: 800,
                color: COLORS.green,
              }}
            />
            <span style={{ marginLeft: 10 }}>TRILLION</span>
          </div>
          <FadeIn startFrame={30} duration={15}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 24,
                color: COLORS.textDim,
                marginTop: 16,
                letterSpacing: '0.1em',
              }}
            >
              Global Crypto Market Cap
            </div>
          </FadeIn>
          <FadeIn startFrame={40} duration={15}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.muted,
                marginTop: 8,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              CoinGecko, 2026
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Sequence from={130} durationInFrames={60}>
        <SlideIn direction="right" startFrame={0} distance={200}>
          <div
            style={{
              position: 'absolute',
              top: '55%',
              right: 120,
              textAlign: 'right',
            }}
          >
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 72,
                fontWeight: 700,
                color: COLORS.cyan,
                textShadow: `0 0 30px ${COLORS.cyanGlow}`,
              }}
            >
              $82B+
            </div>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 22,
                color: COLORS.textDim,
                marginTop: 8,
              }}
            >
              DAILY TRADING VOLUME
            </div>
          </div>
        </SlideIn>
      </Sequence>

      <Sequence from={180} durationInFrames={80}>
        <FadeIn startFrame={0} duration={15}>
          <div
            style={{
              position: 'absolute',
              top: 100,
              left: 120,
            }}
          >
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 18,
                color: COLORS.muted,
                marginBottom: 24,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Asia-Pacific Hub
            </div>
            <PulsingNode label="🇰🇷 Korea" x={80} y={80} startFrame={5} color={COLORS.green} size={70} />
            <PulsingNode label="🇯🇵 Japan" x={240} y={60} startFrame={12} color={COLORS.cyan} size={70} />
            <PulsingNode label="🇮🇳 India" x={160} y={180} startFrame={19} color={COLORS.orange} size={70} />
          </div>
        </FadeIn>
      </Sequence>

      <Sequence from={220} durationInFrames={80}>
        <div
          style={{
            position: 'absolute',
            bottom: 140,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <BarChart
            bars={[
              { label: 'Upbit', value: 18182, color: COLORS.cyan },
              { label: 'Coinbase', value: 23549, color: COLORS.green },
            ]}
            startFrame={0}
            barWidth={160}
            barGap={60}
            height={240}
          />
          <FadeIn startFrame={25}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.muted,
                textAlign: 'center',
                marginTop: 12,
              }}
            >
              24h BTC Volume (BTC) — CoinGecko, 2026
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Sequence from={270} durationInFrames={45}>
        {['Bithumb', 'bitFlyer', 'WazirX'].map((name, i) => (
          <SlideIn key={name} direction="bottom" startFrame={i * 8} distance={60}>
            <div
              style={{
                position: 'absolute',
                top: 480 + i * 60,
                right: 200,
                fontFamily: FONTS.mono,
                fontSize: 28,
                fontWeight: 600,
                color: [COLORS.green, COLORS.cyan, COLORS.orange][i],
                textShadow: `0 0 15px ${[COLORS.glow, COLORS.cyanGlow, `${COLORS.orange}44`][i]}`,
              }}
            >
              {name}
            </div>
          </SlideIn>
        ))}
      </Sequence>

      <Sequence from={310} durationInFrames={50}>
        <div
          style={{
            position: 'absolute',
            bottom: 200,
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
          }}
        >
          <FadeIn startFrame={0} duration={12}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 42,
                fontWeight: 600,
                color: COLORS.white,
                marginBottom: 20,
              }}
            >
              And it's growing.
            </div>
          </FadeIn>
          <FadeIn startFrame={15} duration={15}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 30 }}>
              <SparklineGraph startFrame={15} width={400} height={100} />
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 20,
                  color: COLORS.green,
                }}
              >
                2025: $4T peak
              </div>
            </div>
          </FadeIn>
          <FadeIn startFrame={30} duration={10}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.muted,
                marginTop: 12,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              CoinGecko Global Charts, 2025
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Vignette />
    </SceneContainer>
  );
};
