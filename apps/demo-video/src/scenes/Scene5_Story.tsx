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
  NoiseTexture,
} from '../components/shared';

const WaveExpansion: React.FC<{
  startFrame: number;
}> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const regions = [
    { label: '🇰🇷 Korea', x: 960, y: 350, delay: 0, color: COLORS.green },
    { label: '🇯🇵 Japan', x: 1120, y: 320, delay: 12, color: COLORS.cyan },
    { label: '🇮🇳 India', x: 800, y: 480, delay: 24, color: COLORS.orange },
    { label: 'SE Asia?', x: 900, y: 560, delay: 36, color: COLORS.yellow },
    { label: 'Global?', x: 1060, y: 560, delay: 48, color: COLORS.white },
  ];

  return (
    <div style={{ position: 'relative', width: 1920, height: 600 }}>
      {regions.map((region) => {
        const regionElapsed = elapsed - region.delay;
        if (regionElapsed < 0) return null;

        const entry = spring({
          frame: Math.max(0, regionElapsed),
          fps,
          config: { damping: 12, stiffness: 80 },
        });

        const rippleSize = regionElapsed > 10 ? 30 + regionElapsed * 1.5 : 0;
        const rippleOpacity = interpolate(
          regionElapsed,
          [10, 50],
          [0.4, 0],
          { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
        );

        return (
          <React.Fragment key={region.label}>
            {rippleSize > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: region.x - rippleSize,
                  top: region.y - rippleSize,
                  width: rippleSize * 2,
                  height: rippleSize * 2,
                  borderRadius: '50%',
                  border: `2px solid ${region.color}`,
                  opacity: rippleOpacity,
                  pointerEvents: 'none',
                }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                left: region.x - 50,
                top: region.y - 20,
                transform: `scale(${entry})`,
                opacity: entry,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 22,
                  fontWeight: 600,
                  color: region.color,
                  textShadow: `0 0 15px ${region.color}44`,
                }}
              >
                {region.label}
              </div>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: region.color,
                  margin: '6px auto 0',
                  boxShadow: `0 0 12px ${region.color}`,
                }}
              />
            </div>
          </React.Fragment>
        );
      })}

      {elapsed > 12 && (
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          viewBox="0 0 1920 600"
        >
          <title>Region connections</title>
          {[
            { from: regions[0], to: regions[1], delay: 12 },
            { from: regions[0], to: regions[2], delay: 24 },
            { from: regions[2], to: regions[3], delay: 36 },
            { from: regions[1], to: regions[4], delay: 48 },
          ].map((connection, i) => {
            const lineElapsed = elapsed - connection.delay;
            if (lineElapsed < 0) return null;
            const lineProgress = interpolate(lineElapsed, [0, 15], [0, 1], {
              extrapolateRight: 'clamp',
            });
            const midX = connection.from.x + (connection.to.x - connection.from.x) * lineProgress;
            const midY = connection.from.y + (connection.to.y - connection.from.y) * lineProgress;
            return (
              <line
                key={i}
                x1={connection.from.x}
                y1={connection.from.y}
                x2={midX}
                y2={midY}
                stroke={COLORS.green}
                strokeWidth="1.5"
                strokeDasharray="6 4"
                opacity={0.4}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
};

const CodeScroll: React.FC<{
  startFrame: number;
}> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const codeLines = [
    'export async function findOptimalRoute(params: RouteParams) {',
    '  const exchanges = await getExchangeStatus();',
    '  const prices = await Promise.all(',
    '    BRIDGE_COINS.map(coin => fetchLivePrices(coin, exchanges))',
    '  );',
    '  const routes = evaluateAllPaths(prices, params);',
    '  const optimal = routes.sort((a, b) => a.totalCost - b.totalCost)[0];',
    '  return { route: optimal, alternatives: routes.slice(1, 4) };',
    '}',
    '',
    'const BRIDGE_COINS = ["BTC","ETH","XRP","SOL","DOGE","ADA","DOT","LINK","AVAX","TRX","KAIA"];',
    '',
    'async function evaluateAllPaths(prices: PriceMap, params: RouteParams) {',
    '  return BRIDGE_COINS.flatMap(coin => {',
    '    const buyFee = getExchangeFee(params.source, coin, "buy");',
    '    const withdrawFee = getWithdrawalFee(params.source, coin);',
    '    const depositTime = getTransferTime(coin);',
    '    const sellFee = getExchangeFee(params.target, coin, "sell");',
    '    const spread = calculateSpread(prices, coin, params);',
    '    return { coin, totalCost: buyFee + withdrawFee + sellFee + spread, time: depositTime };',
    '  });',
    '}',
    '',
    'export const x402Handler = async (req: Request) => {',
    '  const payment = await verifyX402Payment(req);',
    '  if (!payment.valid) return new Response("Payment Required", { status: 402 });',
    '  const result = await processRequest(req, payment);',
    '  return Response.json(result);',
    '};',
  ];

  const scrollY = elapsed * 4;

  return (
    <div
      style={{
        width: 800,
        height: 400,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: 8,
        backgroundColor: '#0d0d14',
        border: `1px solid ${COLORS.border}`,
        padding: 20,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 40,
          background: `linear-gradient(180deg, #0d0d14 0%, transparent 100%)`,
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 40,
          background: `linear-gradient(0deg, #0d0d14 0%, transparent 100%)`,
          zIndex: 2,
        }}
      />
      <div
        style={{
          transform: `translateY(-${scrollY}px)`,
          paddingTop: 20,
        }}
      >
        {codeLines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 14,
              lineHeight: 1.8,
              color: line.includes('export') || line.includes('async') || line.includes('const') || line.includes('return')
                ? COLORS.cyan
                : line.includes('//') || line === ''
                  ? COLORS.muted
                  : COLORS.text,
              whiteSpace: 'pre',
              opacity: 0.7,
            }}
          >
            <span style={{ color: COLORS.muted, marginRight: 16, fontSize: 12 }}>
              {String(i + 1).padStart(2, ' ')}
            </span>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

export const Scene5_Story: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneContainer>
      <GridOverlay opacity={0.02} />
      <NoiseTexture opacity={0.03} />
      <GlowOrb x={960} y={540} size={600} color={COLORS.green} opacity={0.05} />

      <Sequence from={0} durationInFrames={80}>
        <WaveExpansion startFrame={0} />
        <FadeIn startFrame={60} duration={15}>
          <div
            style={{
              position: 'absolute',
              bottom: 120,
              left: '50%',
              transform: 'translateX(-50%)',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 32,
                fontWeight: 600,
                color: COLORS.cyan,
              }}
            >
              Stablecoins: $46T/year
            </div>
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
              a16z, 2025
            </div>
          </div>
        </FadeIn>
      </Sequence>

      <Sequence from={80} durationInFrames={15}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1920,
            height: 1080,
            backgroundColor: COLORS.bg,
          }}
        />
      </Sequence>

      <Sequence from={95} durationInFrames={40}>
        <div
          style={{
            position: 'absolute',
            top: '45%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <TypingText
            text="Built in 1 week."
            startFrame={0}
            framesPerChar={2}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 48,
              fontWeight: 600,
              color: COLORS.white,
            }}
            cursorColor={COLORS.green}
          />
        </div>
      </Sequence>

      <Sequence from={135} durationInFrames={40}>
        <div
          style={{
            position: 'absolute',
            top: '45%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 48,
              fontWeight: 600,
              color: COLORS.white,
              marginBottom: 20,
            }}
          >
            Built in 1 week.
          </div>
          <TypingText
            text="By a non-developer."
            startFrame={0}
            framesPerChar={2}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 42,
              color: COLORS.textDim,
            }}
            cursorColor={COLORS.green}
          />
        </div>
      </Sequence>

      <Sequence from={175} durationInFrames={60}>
        <div
          style={{
            position: 'absolute',
            top: '42%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 48,
              fontWeight: 600,
              color: COLORS.white,
              marginBottom: 20,
            }}
          >
            Built in 1 week.
          </div>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 42,
              color: COLORS.textDim,
              marginBottom: 20,
            }}
          >
            By a non-developer.
          </div>
          <TypingText
            text="With AI as co-founder."
            startFrame={0}
            framesPerChar={2}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 52,
              fontWeight: 700,
              color: COLORS.green,
              textShadow: `0 0 40px ${COLORS.glow}, 0 0 80px ${COLORS.glow}`,
            }}
            cursorColor={COLORS.green}
          />
        </div>
      </Sequence>

      <Sequence from={240} durationInFrames={60}>
        <FadeIn startFrame={0} duration={10}>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <CodeScroll startFrame={0} />
          </div>
        </FadeIn>
      </Sequence>

      <Vignette />
    </SceneContainer>
  );
};
