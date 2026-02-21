import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';

/**
 * Sound effect paths — all .wav files in public/sfx/
 */
const SFX = {
  typing: staticFile('sfx/typing.wav'),
  glitch: staticFile('sfx/glitch.wav'),
  whoosh: staticFile('sfx/whoosh.wav'),
  impact: staticFile('sfx/impact.wav'),
  errorBuzz: staticFile('sfx/error-buzz.wav'),
  success: staticFile('sfx/success.wav'),
  transition: staticFile('sfx/transition.wav'),
} as const;

type SfxName = keyof typeof SFX;

interface SfxEvent {
  name: SfxName;
  frame: number;
  volume?: number;
}

/**
 * Renders a collection of sound effects at specified frames.
 * Usage: <SoundTrack events={[{ name: 'typing', frame: 60 }, ...]} />
 */
export const SoundTrack: React.FC<{ events: SfxEvent[] }> = ({ events }) => {
  return (
    <>
      {events.map((event, i) => (
        <Sequence key={`${event.name}-${event.frame}-${i}`} from={event.frame} durationInFrames={30}>
          <Audio src={SFX[event.name]} volume={event.volume ?? 0.6} />
        </Sequence>
      ))}
    </>
  );
};

/**
 * Scene-level sound effects, pre-mapped to the video timeline.
 * Global frame offsets (cumulative scene starts):
 *   Scene1: 0, Scene2: 360, Scene3: 720, Scene4: 1140, Scene5: 1410, Scene6: 1710
 */
export const AllSoundEffects: React.FC = () => {
  const events: SfxEvent[] = [
    // === Scene 1: Background (0-360) ===
    // Cursor appears
    { name: 'typing', frame: 5, volume: 0.3 },
    // $2.3T counter starts
    { name: 'whoosh', frame: 60, volume: 0.4 },
    // Counter reaches target
    { name: 'success', frame: 110, volume: 0.3 },
    // $82B slides in
    { name: 'whoosh', frame: 130, volume: 0.5 },
    // Asia nodes pulse in
    { name: 'typing', frame: 185, volume: 0.25 },
    { name: 'typing', frame: 192, volume: 0.25 },
    { name: 'typing', frame: 199, volume: 0.25 },
    // Bar chart appears
    { name: 'impact', frame: 220, volume: 0.35 },
    // Exchange names slide
    { name: 'whoosh', frame: 270, volume: 0.3 },
    // "And it's growing" + sparkline
    { name: 'transition', frame: 310, volume: 0.4 },

    // === Scene 2: Problem (360-720) ===
    // Glitch text: "But AI agents can't touch it"
    { name: 'glitch', frame: 360, volume: 0.7 },
    // Brick wall barriers appear (staggered)
    { name: 'impact', frame: 420, volume: 0.3 },
    { name: 'impact', frame: 428, volume: 0.25 },
    { name: 'impact', frame: 436, volume: 0.25 },
    { name: 'impact', frame: 444, volume: 0.2 },
    // Terminal typing
    { name: 'typing', frame: 480, volume: 0.3 },
    { name: 'typing', frame: 485, volume: 0.3 },
    { name: 'typing', frame: 490, volume: 0.3 },
    { name: 'typing', frame: 495, volume: 0.3 },
    { name: 'typing', frame: 500, volume: 0.3 },
    // 403 Forbidden error
    { name: 'errorBuzz', frame: 530, volume: 0.7 },
    // Price gap display
    { name: 'whoosh', frame: 560, volume: 0.4 },
    // "Agent Economy $30T"
    { name: 'impact', frame: 640, volume: 0.5 },
    // Scene transition
    { name: 'transition', frame: 700, volume: 0.5 },

    // === Scene 3: Solution (720-1140) ===
    // CrossFin logo burst
    { name: 'impact', frame: 720, volume: 0.8 },
    // Shatter particles
    { name: 'glitch', frame: 725, volume: 0.3 },
    // "1 MCP → 9 Exchanges"
    { name: 'whoosh', frame: 770, volume: 0.5 },
    // Bridge coins appear (staggered success chimes)
    { name: 'success', frame: 790, volume: 0.2 },
    { name: 'success', frame: 800, volume: 0.2 },
    { name: 'success', frame: 810, volume: 0.2 },
    // Chat bubbles
    { name: 'typing', frame: 850, volume: 0.3 },
    { name: 'whoosh', frame: 870, volume: 0.3 },
    { name: 'success', frame: 890, volume: 0.35 },
    // Route graph
    { name: 'whoosh', frame: 900, volume: 0.3 },
    // x402 section
    { name: 'transition', frame: 960, volume: 0.4 },
    // "No API key. No subscription."
    { name: 'impact', frame: 990, volume: 0.35 },
    // Exchange flags
    { name: 'typing', frame: 1050, volume: 0.2 },
    { name: 'typing', frame: 1060, volume: 0.2 },
    { name: 'typing', frame: 1070, volume: 0.2 },

    // === Scene 4: Business (1140-1410) ===
    // Slot machine spinning
    { name: 'glitch', frame: 1140, volume: 0.3 },
    // Slot machine stops — $0.10
    { name: 'impact', frame: 1180, volume: 0.5 },
    // "35 Paid APIs" + matrix scroll
    { name: 'whoosh', frame: 1195, volume: 0.4 },
    // Channel cards (MCP, Telegram, REST)
    { name: 'success', frame: 1210, volume: 0.25 },
    // x402 / Smithery stats
    { name: 'whoosh', frame: 1280, volume: 0.4 },
    { name: 'whoosh', frame: 1288, volume: 0.4 },
    // Revenue graph
    { name: 'transition', frame: 1340, volume: 0.4 },

    // === Scene 5: Story (1410-1710) ===
    // Map expansion — Korea
    { name: 'impact', frame: 1410, volume: 0.35 },
    // Japan
    { name: 'whoosh', frame: 1422, volume: 0.3 },
    // India
    { name: 'whoosh', frame: 1434, volume: 0.3 },
    // SE Asia / Global
    { name: 'whoosh', frame: 1446, volume: 0.25 },
    { name: 'whoosh', frame: 1458, volume: 0.25 },
    // Stablecoins $46T
    { name: 'success', frame: 1470, volume: 0.35 },
    // "Built in 1 week." typing
    { name: 'typing', frame: 1505, volume: 0.35 },
    { name: 'typing', frame: 1509, volume: 0.35 },
    { name: 'typing', frame: 1513, volume: 0.35 },
    { name: 'typing', frame: 1517, volume: 0.35 },
    { name: 'typing', frame: 1521, volume: 0.35 },
    // "By a non-developer." typing
    { name: 'typing', frame: 1545, volume: 0.3 },
    { name: 'typing', frame: 1549, volume: 0.3 },
    { name: 'typing', frame: 1553, volume: 0.3 },
    { name: 'typing', frame: 1557, volume: 0.3 },
    // "With AI as co-founder." — dramatic
    { name: 'impact', frame: 1585, volume: 0.5 },
    { name: 'typing', frame: 1589, volume: 0.35 },
    { name: 'typing', frame: 1595, volume: 0.35 },
    { name: 'typing', frame: 1601, volume: 0.35 },
    // Code scroll appears
    { name: 'transition', frame: 1650, volume: 0.35 },

    // === Scene 6: CTA (1710-1800) ===
    // Terminal appears
    { name: 'impact', frame: 1710, volume: 0.5 },
    // "npx -y crossfin-mcp" typing
    { name: 'typing', frame: 1720, volume: 0.4 },
    { name: 'typing', frame: 1724, volume: 0.4 },
    { name: 'typing', frame: 1728, volume: 0.4 },
    { name: 'typing', frame: 1732, volume: 0.4 },
    { name: 'typing', frame: 1736, volume: 0.4 },
    { name: 'typing', frame: 1740, volume: 0.4 },
    // CrossFin logo + links
    { name: 'success', frame: 1735, volume: 0.5 },
    // Final cursor blink
    { name: 'typing', frame: 1770, volume: 0.2 },
  ];

  return <SoundTrack events={events} />;
};
