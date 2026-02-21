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
  FadeIn,
  SlideIn,
  NoiseTexture,
} from '../components/shared';

const SlotMachinePrice: React.FC<{
  prices: string[];
  startFrame: number;
  finalIndex: number;
}> = ({ prices, startFrame, finalIndex }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const spinDuration = 40;
  const isSpinning = elapsed < spinDuration;

  const currentIndex = isSpinning
    ? Math.floor(elapsed * 0.5) % prices.length
    : finalIndex;

  const scale = isSpinning
    ? 1 + Math.sin(elapsed * 0.8) * 0.05
    : 1;

  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 72,
        fontWeight: 800,
        color: isSpinning ? COLORS.textDim : COLORS.green,
        textShadow: isSpinning
          ? 'none'
          : `0 0 30px ${COLORS.glow}, 0 0 60px ${COLORS.glow}`,
        transform: `scale(${scale})`,
        transition: 'color 0.1s',
        textAlign: 'center',
        minWidth: 300,
      }}
    >
      {prices[currentIndex]}
    </div>
  );
};

const MatrixScroll: React.FC<{
  startFrame: number;
  endpoints: string[];
}> = ({ startFrame, endpoints }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const scrollY = elapsed * 3;
  const visibleCount = 12;

  return (
    <div
      style={{
        height: 300,
        overflow: 'hidden',
        position: 'relative',
        width: 500,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background: `linear-gradient(180deg, ${COLORS.bg} 0%, transparent 100%)`,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          background: `linear-gradient(0deg, ${COLORS.bg} 0%, transparent 100%)`,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          transform: `translateY(-${scrollY}px)`,
        }}
      >
        {Array.from({ length: 60 }, (_, i) => {
          const ep = endpoints[i % endpoints.length];
          return (
            <div
              key={i}
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.green,
                opacity: 0.4 + (i % 3) * 0.2,
                padding: '3px 0',
                whiteSpace: 'nowrap',
              }}
            >
              {ep}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const RevenueGraph: React.FC<{
  startFrame: number;
}> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const points = Array.from({ length: 20 }, (_, i) => {
    const x = (i / 19) * 400;
    const y = 120 - (Math.pow(i / 19, 1.5) * 100);
    return { x, y };
  });

  const visiblePoints = Math.min(
    Math.floor(interpolate(elapsed, [0, 30], [0, points.length], {
      extrapolateRight: 'clamp',
    })),
    points.length
  );

  const pathD = points
    .slice(0, visiblePoints)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  return (
    <svg width={420} height={140} style={{ overflow: 'visible' }}>
      <title>Revenue growth curve</title>
      <defs>
        <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.green} stopOpacity="0.2" />
          <stop offset="100%" stopColor={COLORS.green} stopOpacity="0" />
        </linearGradient>
      </defs>
      {visiblePoints > 1 && (
        <>
          <path d={pathD} fill="none" stroke={COLORS.green} strokeWidth="3" strokeLinecap="round" />
          <path
            d={`${pathD} L ${points[visiblePoints - 1].x} 120 L 0 120 Z`}
            fill="url(#revFill)"
          />
        </>
      )}
    </svg>
  );
};

const ENDPOINTS = [
  '/api/premium/arbitrage/kimchi',
  '/api/premium/bithumb/orderbook',
  '/api/premium/market/upbit/ticker',
  '/api/premium/market/fx/usdkrw',
  '/api/premium/route/find',
  '/api/premium/morning/brief',
  '/api/premium/crypto/snapshot',
  '/api/premium/market/korea/indices',
  '/api/premium/news/korea/headlines',
  '/api/premium/market/upbit/signals',
  '/api/premium/market/korea/investor-flow',
  '/api/premium/crypto/korea/5exchange',
  '/api/premium/market/korea/etf',
  '/api/premium/kimchi/stats',
  '/api/premium/market/korea/themes',
];

export const Scene4_Business: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <SceneContainer>
      <GridOverlay opacity={0.02} />
      <NoiseTexture opacity={0.03} />
      <GlowOrb x={500} y={400} size={500} color={COLORS.green} opacity={0.06} />
      <GlowOrb x={1400} y={600} size={400} color={COLORS.cyan} opacity={0.04} />

      <Sequence from={0} durationInFrames={60}>
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 40,
          }}
        >
          <SlotMachinePrice
            prices={['$0.01', '$0.02', '$0.05', '$0.10', '$0.15', '$0.20']}
            startFrame={0}
            finalIndex={3}
          />
          <FadeIn startFrame={45} duration={10}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 20,
                color: COLORS.textDim,
              }}
            >
              per API call
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Sequence from={55} durationInFrames={70}>
        <div
          style={{
            position: 'absolute',
            top: 100,
            left: 120,
          }}
        >
          <FadeIn startFrame={0} duration={10}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 36,
                fontWeight: 700,
                color: COLORS.green,
                marginBottom: 16,
              }}
            >
              35 Paid APIs
            </div>
          </FadeIn>
          <MatrixScroll startFrame={8} endpoints={ENDPOINTS} />
        </div>

        <div
          style={{
            position: 'absolute',
            top: 100,
            right: 120,
          }}
        >
          <FadeIn startFrame={15} duration={12}>
            <div
              style={{
                display: 'flex',
                gap: 30,
                marginBottom: 30,
              }}
            >
              {[
                { icon: '⚡', label: 'MCP', color: COLORS.green },
                { icon: '💬', label: 'Telegram', color: COLORS.cyan },
                { icon: '🔗', label: 'REST API', color: COLORS.orange },
              ].map((channel) => (
                <div
                  key={channel.label}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: '16px 24px',
                    backgroundColor: `${channel.color}12`,
                    border: `1px solid ${channel.color}33`,
                    borderRadius: 12,
                  }}
                >
                  <span style={{ fontSize: 32 }}>{channel.icon}</span>
                  <span
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 14,
                      color: channel.color,
                      fontWeight: 600,
                    }}
                  >
                    {channel.label}
                  </span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Sequence from={140} durationInFrames={60}>
        <div
          style={{
            position: 'absolute',
            bottom: 250,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 80,
          }}
        >
          <SlideIn direction="left" startFrame={0} distance={80}>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 36,
                  fontWeight: 700,
                  color: COLORS.cyan,
                  textShadow: `0 0 20px ${COLORS.cyanGlow}`,
                }}
              >
                75M txns/month
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 14,
                  color: COLORS.muted,
                  marginTop: 8,
                  letterSpacing: '0.05em',
                }}
              >
                x402.org
              </div>
            </div>
          </SlideIn>

          <SlideIn direction="right" startFrame={8} distance={80}>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 36,
                  fontWeight: 700,
                  color: COLORS.green,
                  textShadow: `0 0 20px ${COLORS.glow}`,
                }}
              >
                4,256 servers
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 14,
                  color: COLORS.muted,
                  marginTop: 8,
                  letterSpacing: '0.05em',
                }}
              >
                Smithery.ai
              </div>
            </div>
          </SlideIn>
        </div>
      </Sequence>

      <Sequence from={200} durationInFrames={70}>
        <div
          style={{
            position: 'absolute',
            bottom: 160,
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
          }}
        >
          <FadeIn startFrame={0} duration={15}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 38,
                fontWeight: 600,
                color: COLORS.white,
                marginBottom: 20,
              }}
            >
              Agents scale → Revenue scales
            </div>
          </FadeIn>
          <FadeIn startFrame={15} duration={15}>
            <RevenueGraph startFrame={15} />
          </FadeIn>
        </div>
      </Sequence>

      <Vignette />
    </SceneContainer>
  );
};
