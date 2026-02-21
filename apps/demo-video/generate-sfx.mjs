/**
 * Generate sound effect WAV files for CrossFin demo video.
 * No external deps — pure Node.js WAV generation.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SAMPLE_RATE = 44100;
const DIR = join(import.meta.dirname, 'public', 'sfx');
mkdirSync(DIR, { recursive: true });

function createWav(samples, sampleRate = SAMPLE_RATE) {
  const numSamples = samples.length;
  const byteRate = sampleRate * 2; // 16-bit mono
  const blockAlign = 2;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const val = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
  }

  return buffer;
}

function generateSamples(durationSec, fn) {
  const numSamples = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Float64Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = fn(t, i, durationSec);
  }
  return samples;
}

// 1. Typing click — short 30ms burst at 3500Hz with fast decay
const typing = generateSamples(0.06, (t) => {
  const env = Math.exp(-t * 120);
  return Math.sin(2 * Math.PI * 3500 * t) * env * 0.7 +
         Math.sin(2 * Math.PI * 7000 * t) * env * 0.2 +
         (Math.random() * 2 - 1) * env * 0.1;
});

// 2. Glitch — 200ms harsh noise + digital artifacts
const glitch = generateSamples(0.22, (t, i, dur) => {
  const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 8);
  const noise = Math.random() * 2 - 1;
  const square = Math.sign(Math.sin(2 * Math.PI * 150 * t));
  const bitcrush = Math.round(noise * 8) / 8;
  const buzz = Math.sin(2 * Math.PI * 60 * t + Math.sin(2 * Math.PI * 1200 * t) * 3);
  return (bitcrush * 0.4 + square * 0.3 + buzz * 0.3) * env * 0.8;
});

// 3. Whoosh — 350ms frequency sweep with noise
const whoosh = generateSamples(0.35, (t, i, dur) => {
  const env = Math.sin(Math.PI * t / dur);
  const freq = 200 + (t / dur) * 3000;
  const noise = (Math.random() * 2 - 1) * 0.6;
  const sine = Math.sin(2 * Math.PI * freq * t) * 0.4;
  return (noise + sine) * env * 0.5;
});

// 4. Impact — 200ms low thud with sub-bass
const impact = generateSamples(0.25, (t) => {
  const env = Math.exp(-t * 15);
  const sub = Math.sin(2 * Math.PI * 45 * t) * 0.6;
  const mid = Math.sin(2 * Math.PI * 120 * t) * 0.3;
  const click = t < 0.005 ? (Math.random() * 2 - 1) * 0.8 : 0;
  const noise = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.3;
  return (sub + mid + click + noise) * env * 0.9;
});

// 5. Error buzz — 300ms harsh low buzz
const errorBuzz = generateSamples(0.3, (t, i, dur) => {
  const env = t < 0.01 ? t / 0.01 : t > dur - 0.05 ? (dur - t) / 0.05 : 1;
  const buzz1 = Math.sign(Math.sin(2 * Math.PI * 80 * t)) * 0.4;
  const buzz2 = Math.sign(Math.sin(2 * Math.PI * 120 * t)) * 0.3;
  const modulation = Math.sin(2 * Math.PI * 5 * t);
  return (buzz1 + buzz2) * env * (0.6 + modulation * 0.2) * 0.7;
});

// 6. Success chime — 150ms pleasant dual-tone
const success = generateSamples(0.2, (t) => {
  const env = Math.exp(-t * 12);
  const tone1 = Math.sin(2 * Math.PI * 880 * t) * 0.5;
  const tone2 = Math.sin(2 * Math.PI * 1320 * t) * 0.3;
  const tone3 = Math.sin(2 * Math.PI * 1760 * t) * 0.15;
  return (tone1 + tone2 + tone3) * env * 0.8;
});

// 7. Transition sweep — 400ms cinematic transition
const transition = generateSamples(0.4, (t, i, dur) => {
  const env = Math.sin(Math.PI * t / dur);
  const freq = 100 + Math.pow(t / dur, 2) * 5000;
  const sine = Math.sin(2 * Math.PI * freq * t);
  const sub = Math.sin(2 * Math.PI * 40 * t) * 0.3;
  const noise = (Math.random() * 2 - 1) * 0.15;
  return (sine * 0.4 + sub + noise) * env * 0.6;
});

function padToMinDuration(samples, minDurationSec = 1.0) {
  const minSamples = Math.floor(SAMPLE_RATE * minDurationSec);
  if (samples.length >= minSamples) return samples;
  const padded = new Float64Array(minSamples);
  padded.set(samples);
  return padded;
}

const effects = [
  { name: 'typing', samples: padToMinDuration(typing) },
  { name: 'glitch', samples: padToMinDuration(glitch) },
  { name: 'whoosh', samples: padToMinDuration(whoosh) },
  { name: 'impact', samples: padToMinDuration(impact) },
  { name: 'error-buzz', samples: padToMinDuration(errorBuzz) },
  { name: 'success', samples: padToMinDuration(success) },
  { name: 'transition', samples: padToMinDuration(transition) },
];

for (const { name, samples } of effects) {
  const wav = createWav(Array.from(samples));
  const path = join(DIR, `${name}.wav`);
  writeFileSync(path, wav);
  console.log(`✓ ${name}.wav (${(wav.length / 1024).toFixed(1)} KB, ${(samples.length / SAMPLE_RATE * 1000).toFixed(0)}ms)`);
}

console.log(`\nAll ${effects.length} sound effects generated in ${DIR}`);
