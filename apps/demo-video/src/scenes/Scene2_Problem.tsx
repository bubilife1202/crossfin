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
  TypingText,
  GlitchText,
  FadeIn,
  SlideIn,
  NoiseTexture,
} from '../components/shared';

const BrickWall: React.FC<{
  bricks: string[];
  startFrame: number;
  color?: string;
}> = ({ bricks, startFrame, color = COLORS.red }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: 800 }}>
      {bricks.map((brick, i) => {
        const brickEntry = spring({
          frame: Math.max(0, frame - startFrame - i * 4),
          fps,
          config: { damping: 10, stiffness: 200, mass: 0.6 },
        });

        if (frame < startFrame + i * 4) return null;

        return (
          <div
            key={brick}
            style={{
              padding: '12px 20px',
              backgroundColor: `${color}18`,
              border: `1px solid ${color}66`,
              borderRadius: 6,
              fontFamily: FONTS.mono,
              fontSize: 18,
              color,
              transform: `scale(${brickEntry}) translateY(${(1 - brickEntry) * -30}px)`,
              opacity: brickEntry,
              whiteSpace: 'nowrap',
            }}
          >
            {brick}
          </div>
        );
      })}
    </div>
  );
};

const TerminalBlock: React.FC<{
  startFrame: number;
}> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const commandChars = 'requests.get("api.upbit.com")';
  const charsVisible = Math.min(Math.floor(elapsed / 1.5), commandChars.length);
  const showError = elapsed > commandChars.length * 1.5 + 10;
  const errorFlash = showError && elapsed % 6 < 3;

  return (
    <div
      style={{
        backgroundColor: '#0d0d14',
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: 24,
        fontFamily: FONTS.mono,
        fontSize: 20,
        width: 600,
      }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: COLORS.red }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: COLORS.yellow }} />
        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: COLORS.green }} />
      </div>
      <div style={{ color: COLORS.muted, marginBottom: 4 }}>
        <span style={{ color: COLORS.green }}>$</span>{' '}
        <span style={{ color: COLORS.text }}>
          {commandChars.slice(0, charsVisible)}
          {charsVisible < commandChars.length && (
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 20,
                backgroundColor: COLORS.green,
                verticalAlign: 'text-bottom',
                marginLeft: 1,
              }}
            />
          )}
        </span>
      </div>
      {showError && (
        <div
          style={{
            color: errorFlash ? COLORS.white : COLORS.red,
            backgroundColor: errorFlash ? `${COLORS.red}33` : 'transparent',
            padding: '4px 8px',
            marginTop: 8,
            borderRadius: 4,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          → 403 Forbidden
        </div>
      )}
    </div>
  );
};

const PriceGapDisplay: React.FC<{
  startFrame: number;
}> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = frame - startFrame;
  if (elapsed < 0) return null;

  const entry = spring({
    frame: Math.max(0, elapsed),
    fps,
    config: { damping: 15, stiffness: 100 },
  });

  const premiumBlink = elapsed > 20 && Math.floor(elapsed / 8) % 2 === 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 40,
        opacity: entry,
        transform: `scale(${0.8 + entry * 0.2})`,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 14, color: COLORS.muted, marginBottom: 6 }}>
          Upbit (KRW)
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 36, fontWeight: 700, color: COLORS.cyan }}>
          ₩141,250,000
        </div>
      </div>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 28,
          fontWeight: 700,
          color: premiumBlink ? COLORS.white : COLORS.red,
          backgroundColor: premiumBlink ? `${COLORS.red}44` : 'transparent',
          padding: '8px 16px',
          borderRadius: 8,
          textShadow: `0 0 20px ${COLORS.redGlow}`,
        }}
      >
        +3.7%
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 14, color: COLORS.muted, marginBottom: 6 }}>
          Binance (USD)
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 36, fontWeight: 700, color: COLORS.green }}>
          $97,420
        </div>
      </div>
    </div>
  );
};

export const Scene2_Problem: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneContainer>
      <GridOverlay opacity={0.02} />
      <NoiseTexture opacity={0.04} />
      <GlowOrb x={960} y={540} size={500} color={COLORS.red} opacity={0.06} />

      <Sequence from={0} durationInFrames={60}>
        <div
          style={{
            position: 'absolute',
            top: '40%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <GlitchText
            text="But AI agents can't touch it."
            startFrame={0}
            glitchIntensity={12}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 52,
              fontWeight: 700,
              color: COLORS.white,
            }}
            color={COLORS.red}
          />
        </div>
      </Sequence>

      <Sequence from={55} durationInFrames={70}>
        <div
          style={{
            position: 'absolute',
            top: 120,
            left: 120,
          }}
        >
          <FadeIn startFrame={0} duration={8}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 16,
                color: COLORS.muted,
                marginBottom: 16,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Barriers to Entry
            </div>
          </FadeIn>
          <BrickWall
            bricks={[
              '한국어 전용 API',
              'IP 차단',
              '실명인증 필수',
              'JFSA License',
              '30% Tax + 1% TDS',
              'KYC 실명확인',
              'OTP 인증',
            ]}
            startFrame={5}
            color={COLORS.red}
          />
        </div>
      </Sequence>

      <Sequence from={120} durationInFrames={80}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <TerminalBlock startFrame={0} />
        </div>
      </Sequence>

      <Sequence from={200} durationInFrames={70}>
        <div
          style={{
            position: 'absolute',
            top: '35%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <PriceGapDisplay startFrame={0} />
        </div>
        <FadeIn startFrame={30} duration={12}>
          <div
            style={{
              position: 'absolute',
              top: '55%',
              left: '50%',
              transform: 'translateX(-50%)',
              fontFamily: FONTS.mono,
              fontSize: 32,
              fontWeight: 600,
              color: COLORS.white,
              textAlign: 'center',
            }}
          >
            Real money. No agent can reach it.
          </div>
        </FadeIn>
      </Sequence>

      <Sequence from={280} durationInFrames={80}>
        <div
          style={{
            position: 'absolute',
            bottom: 200,
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
          }}
        >
          <SlideIn direction="bottom" startFrame={0} distance={80}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 42,
                fontWeight: 700,
                color: COLORS.cyan,
                textShadow: `0 0 30px ${COLORS.cyanGlow}`,
              }}
            >
              Agent Economy → $30T by 2030
            </div>
          </SlideIn>
          <FadeIn startFrame={20} duration={12}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 14,
                color: COLORS.muted,
                marginTop: 16,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              Gartner, 2025
            </div>
          </FadeIn>
        </div>
      </Sequence>

      <Vignette />
    </SceneContainer>
  );
};
