import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Easing,
} from 'remotion';
import { COLORS, FONTS } from '../styles';
import {
  SceneContainer,
  GridOverlay,
  Vignette,
  GlowOrb,
  FadeIn,
  TypingText,
  CursorBlink,
  NoiseTexture,
} from '../components/shared';

export const Scene6_CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeOut = interpolate(frame, [70, 90], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <SceneContainer>
      <GridOverlay opacity={0.02} />
      <NoiseTexture opacity={0.03} />
      <GlowOrb x={960} y={540} size={700} color={COLORS.green} opacity={0.1} />
      <GlowOrb x={600} y={400} size={400} color={COLORS.cyan} opacity={0.05} />

      <div style={{ opacity: fadeOut }}>
        <Sequence from={0} durationInFrames={90}>
          <div
            style={{
              position: 'absolute',
              top: 200,
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
            <div
              style={{
                backgroundColor: '#0d0d14',
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: '20px 32px',
                display: 'inline-block',
              }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: COLORS.red }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: COLORS.yellow }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: COLORS.green }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 18,
                    color: COLORS.green,
                    marginRight: 10,
                  }}
                >
                  $
                </span>
                <TypingText
                  text="npx -y crossfin-mcp"
                  startFrame={5}
                  framesPerChar={2}
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 28,
                    fontWeight: 600,
                    color: COLORS.green,
                    textShadow: `0 0 20px ${COLORS.glow}`,
                  }}
                  cursorColor={COLORS.green}
                />
              </div>
            </div>
          </div>
        </Sequence>

        <Sequence from={25} durationInFrames={65}>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
            }}
          >
            <FadeIn startFrame={0} duration={10}>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 80,
                  fontWeight: 800,
                  color: COLORS.green,
                  textShadow: `0 0 60px ${COLORS.glow}, 0 0 120px ${COLORS.glow}`,
                  letterSpacing: '-0.04em',
                  marginBottom: 12,
                }}
              >
                CrossFin
              </div>
            </FadeIn>

            <FadeIn startFrame={10} duration={10}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 40,
                  marginBottom: 30,
                }}
              >
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 22,
                    color: COLORS.cyan,
                    padding: '8px 20px',
                    backgroundColor: `${COLORS.cyan}12`,
                    border: `1px solid ${COLORS.cyan}33`,
                    borderRadius: 8,
                  }}
                >
                  crossfin.dev
                </div>
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 22,
                    color: COLORS.green,
                    padding: '8px 20px',
                    backgroundColor: `${COLORS.green}12`,
                    border: `1px solid ${COLORS.green}33`,
                    borderRadius: 8,
                  }}
                >
                  live.crossfin.dev
                </div>
              </div>
            </FadeIn>

            <FadeIn startFrame={20} duration={15}>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 24,
                  color: COLORS.textDim,
                  lineHeight: 1.5,
                  maxWidth: 700,
                  margin: '0 auto',
                }}
              >
                The only way AI agents
                <br />
                access Asian crypto markets.
              </div>
            </FadeIn>

            <FadeIn startFrame={35} duration={10}>
              <div style={{ marginTop: 30 }}>
                <CursorBlink color={COLORS.green} width={16} height={28} />
              </div>
            </FadeIn>
          </div>
        </Sequence>
      </div>

      <Vignette />
    </SceneContainer>
  );
};
