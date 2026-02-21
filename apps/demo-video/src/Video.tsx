import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { Scene1_Background } from './scenes/Scene1_Background';
import { Scene2_Problem } from './scenes/Scene2_Problem';
import { Scene3_Solution } from './scenes/Scene3_Solution';
import { Scene4_Business } from './scenes/Scene4_Business';
import { Scene5_Story } from './scenes/Scene5_Story';
import { Scene6_CTA } from './scenes/Scene6_CTA';
import { AllSoundEffects } from './components/SoundEffects';

export const Video: React.FC = () => {
  return (
    <AbsoluteFill>
      <Series>
        <Series.Sequence durationInFrames={360}>
          <Scene1_Background />
        </Series.Sequence>
        <Series.Sequence durationInFrames={360}>
          <Scene2_Problem />
        </Series.Sequence>
        <Series.Sequence durationInFrames={420}>
          <Scene3_Solution />
        </Series.Sequence>
        <Series.Sequence durationInFrames={270}>
          <Scene4_Business />
        </Series.Sequence>
        <Series.Sequence durationInFrames={300}>
          <Scene5_Story />
        </Series.Sequence>
        <Series.Sequence durationInFrames={90}>
          <Scene6_CTA />
        </Series.Sequence>
      </Series>
      <AllSoundEffects />
    </AbsoluteFill>
  );
};
