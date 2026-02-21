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
  TypingText,
  AnimatedLine,
  NoiseTexture,
} from '../components/shared';

const ShatterParticles: React.FC<{
  startFrame: number;
  count?: number;
}> = ({ startFrame, count = 40 }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0 || elapsed > 45) return null;

  const particles = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + i * 0.3;
    const speed = 3 + (i % 7) * 2;
    const size = 2 + (i % 5) * 2;
    const x = 960 + Math.cos(angle) * speed * elapsed;
    const y = 540 + Math.sin(angle) * speed * elapsed - elapsed * 0.5;
    const opacity = interpolate(elapsed, [0, 30, 45], [1, 0.6, 0], {
      extrapolateRight: 'clamp',
    });
    const rotation = elapsed * (10 + i * 3);

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: size,
          height: size,
          backgroundColor: i % 3 === 0 ? COLORS.green : i % 3 === 1 ? COLORS.cyan : COLORS.white,
          opacity,
          transform: `rotate(${rotation}deg)`,
          boxShadow: `0 0 ${size * 2}px ${i % 2 === 0 ? COLORS.green : COLORS.cyan}`,
        }}
      />
    );
  });

  return <>{particles}</>;
};

const BridgeCoinChip: React.FC<{
  symbol: string;
  index: number;
  totalCoins: number;
  startFrame: number;
  centerX: number;
  centerY: number;
  radius: number;
}> = ({ symbol, index, totalCoins, startFrame, centerX, centerY, radius }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const angle = (index / totalCoins) * Math.PI * 2 - Math.PI / 2;
  const targetX = centerX + Math.cos(angle) * radius;
  const targetY = centerY + Math.sin(angle) * radius;

  const entry = spring({
    frame: Math.max(0, elapsed),
    fps,
    config: { damping: 12, stiffness: 150, mass: 0.5 },
  });

  const hover = Math.sin((frame + index * 10) * 0.06) * 3;

  const coinColors: Record<string, string> = {
    BTC: '#f7931a',
    ETH: '#627eea',
    XRP: '#00aae4',
    SOL: '#9945ff',
    DOGE: '#c2a633',
    ADA: '#0033ad',
    DOT: '#e6007a',
    LINK: '#2a5ada',
    AVAX: '#e84142',
    TRX: '#ff0013',
    KAIA: COLORS.green,
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: targetX - 32,
        top: targetY - 32 + hover,
        width: 64,
        height: 64,
        borderRadius: '50%',
        backgroundColor: `${coinColors[symbol] ?? COLORS.green}22`,
        border: `2px solid ${coinColors[symbol] ?? COLORS.green}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONTS.mono,
        fontSize: 13,
        fontWeight: 700,
        color: coinColors[symbol] ?? COLORS.green,
        transform: `scale(${entry})`,
        opacity: entry,
        boxShadow: `0 0 15px ${coinColors[symbol] ?? COLORS.green}33`,
      }}
    >
      {symbol}
    </div>
  );
};

const ChatBubble: React.FC<{
  text: string;
  startFrame: number;
  isUser?: boolean;
  style?: React.CSSProperties;
}> = ({ text, startFrame, isUser = true, style = {} }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const entry = spring({
    frame: Math.max(0, elapsed),
    fps,
    config: { damping: 14, stiffness: 120 },
  });

  return (
    <div
      style={{
        maxWidth: 500,
        padding: '14px 20px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        backgroundColor: isUser ? `${COLORS.cyan}20` : `${COLORS.green}20`,
        border: `1px solid ${isUser ? COLORS.cyan : COLORS.green}44`,
        fontFamily: FONTS.mono,
        fontSize: 18,
        color: isUser ? COLORS.cyan : COLORS.green,
        lineHeight: 1.5,
        transform: `scale(${entry}) translateY(${(1 - entry) * 20}px)`,
        opacity: entry,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

const RouteGraph: React.FC<{
  startFrame: number;
}> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const nodes = [
    { label: 'Bithumb', x: 150, y: 60, color: COLORS.cyan },
    { label: 'AVAX', x: 370, y: 60, color: '#e84142' },
    { label: 'Binance', x: 590, y: 60, color: COLORS.green },
  ];

  return (
    <div style={{ position: 'relative', width: 740, height: 120 }}>
      {elapsed > 0 && (
        <AnimatedLine
          x1={210}
          y1={60}
          x2={340}
          y2={60}
          startFrame={0}
          duration={15}
          color={COLORS.cyan}
          strokeWidth={3}
        />
      )}
      {elapsed > 15 && (
        <AnimatedLine
          x1={430}
          y1={60}
          x2={560}
          y2={60}
          startFrame={15}
          duration={15}
          color={COLORS.green}
          strokeWidth={3}
        />
      )}
      {nodes.map((node, i) => {
        const nodeEntry = spring({
          frame: Math.max(0, elapsed - i * 8),
          fps,
          config: { damping: 12, stiffness: 120 },
        });

        return (
          <div
            key={node.label}
            style={{
              position: 'absolute',
              left: node.x - 50,
              top: node.y - 22,
              width: 100,
              height: 44,
              borderRadius: 22,
              backgroundColor: `${node.color}22`,
              border: `2px solid ${node.color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONTS.mono,
              fontSize: 15,
              fontWeight: 600,
              color: node.color,
              transform: `scale(${nodeEntry})`,
              opacity: nodeEntry,
            }}
          >
            {node.label}
          </div>
        );
      })}
    </div>
  );
};

export const Scene3_Solution: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoEntry = spring({
    frame: Math.max(0, frame),
    fps,
    config: { damping: 8, stiffness: 60, mass: 1.2 },
  });

  return (
    <SceneContainer>
      <GridOverlay opacity={0.025} />
      <NoiseTexture opacity={0.03} />
      <GlowOrb x={960} y={540} size={800} color={COLORS.green} opacity={0.08} />
      <GlowOrb x={400} y={300} size={400} color={COLORS.cyan} opacity={0.05} />

      <Sequence from={0} durationInFrames={50}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) scale(${logoEntry})`,
            opacity: logoEntry,
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 96,
              fontWeight: 800,
              color: COLORS.green,
              textShadow: `0 0 60px ${COLORS.glow}, 0 0 120px ${COLORS.glow}`,
              letterSpacing: '-0.04em',
            }}
          >
            CrossFin
          </div>
        </div>
        <ShatterParticles startFrame={5} count={50} />
      </Sequence>

      <Sequence from={50} durationInFrames={60}>
        <div
          style={{
            position: 'absolute',
            top: 100,
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
          }}
        >
          <SlideIn direction="bottom" startFrame={0} distance={50}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 36,
                fontWeight: 600,
                color: COLORS.white,
              }}
            >
              <span style={{ color: COLORS.green }}>1</span> MCP Server →{' '}
              <span style={{ color: COLORS.cyan }}>9</span> Exchanges
            </div>
          </SlideIn>
        </div>

        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'DOT', 'LINK', 'AVAX', 'TRX', 'KAIA'].map(
            (coin, i) => (
              <BridgeCoinChip
                key={coin}
                symbol={coin}
                index={i}
                totalCoins={11}
                startFrame={10 + i * 3}
                centerX={0}
                centerY={50}
                radius={200}
              />
            )
          )}
        </div>
      </Sequence>

      <Sequence from={120} durationInFrames={100}>
        <div
          style={{
            position: 'absolute',
            top: 100,
            left: 120,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <FadeIn startFrame={0} duration={8}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 16,
                color: COLORS.muted,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Live Demo
            </div>
          </FadeIn>
          <ChatBubble
            text="빗썸→바이낸스 500만원"
            startFrame={10}
            isUser={true}
          />
          <FadeIn startFrame={30} duration={10}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                backgroundColor: `${COLORS.yellow}18`,
                border: `1px solid ${COLORS.yellow}44`,
                borderRadius: 20,
                fontFamily: FONTS.mono,
                fontSize: 15,
                color: COLORS.yellow,
                marginLeft: 20,
              }}
            >
              ⚡ find_optimal_route
            </div>
          </FadeIn>
          <ChatBubble
            text="AVAX 브릿지, 비용 0.07%"
            startFrame={50}
            isUser={false}
          />
        </div>

        <FadeIn startFrame={60} duration={15}>
          <div
            style={{
              position: 'absolute',
              bottom: 200,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <RouteGraph startFrame={60} />
          </div>
        </FadeIn>
      </Sequence>

      <Sequence from={240} durationInFrames={80}>
        <div
          style={{
            position: 'absolute',
            top: 120,
            right: 120,
            textAlign: 'right',
          }}
        >
          <SlideIn direction="right" startFrame={0} distance={100}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 16,
                color: COLORS.muted,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              x402 Protocol
            </div>
          </SlideIn>

          <FadeIn startFrame={10} duration={12}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 24,
                justifyContent: 'flex-end',
              }}
            >
              {['Agent', 'USDC', 'Data'].map((step, i) => (
                <React.Fragment key={step}>
                  {i > 0 && (
                    <div
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 24,
                        color: COLORS.green,
                      }}
                    >
                      →
                    </div>
                  )}
                  <div
                    style={{
                      padding: '12px 24px',
                      backgroundColor: `${COLORS.green}15`,
                      border: `1px solid ${COLORS.green}44`,
                      borderRadius: 8,
                      fontFamily: FONTS.mono,
                      fontSize: 22,
                      fontWeight: 600,
                      color: COLORS.green,
                    }}
                  >
                    {step}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </FadeIn>

          <FadeIn startFrame={30} duration={12}>
            <div style={{ marginTop: 30 }}>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 28,
                  fontWeight: 600,
                  color: COLORS.white,
                  marginBottom: 8,
                }}
              >
                No API key. No subscription.
              </div>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 24,
                  color: COLORS.cyan,
                }}
              >
                Pay per call.
              </div>
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Sequence from={330} durationInFrames={90}>
        <div
          style={{
            position: 'absolute',
            bottom: 120,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 60,
          }}
        >
          {[
            { label: 'Bithumb', flag: '🇰🇷' },
            { label: 'Upbit', flag: '🇰🇷' },
            { label: 'bitFlyer', flag: '🇯🇵' },
            { label: 'WazirX', flag: '🇮🇳' },
            { label: 'Binance', flag: '🌐' },
            { label: 'OKX', flag: '🌐' },
            { label: 'Bybit', flag: '🌐' },
          ].map((ex, i) => (
            <FadeIn key={ex.label} startFrame={i * 5} duration={10}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>{ex.flag}</div>
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 14,
                    color: COLORS.textDim,
                  }}
                >
                  {ex.label}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </Sequence>

      <Vignette />
    </SceneContainer>
  );
};
