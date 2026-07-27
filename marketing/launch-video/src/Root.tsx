import React from 'react';
import { Composition } from 'remotion';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import { SpardaVideo, T } from './Video';

export const Root: React.FC = () => (
  <>
    <Composition
      id="sparda-fr"
      component={SpardaVideo}
      durationInFrames={T.end}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ lang: 'fr' as const }}
    />
    <Composition
      id="sparda-en"
      component={SpardaVideo}
      durationInFrames={T.end}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ lang: 'en' as const }}
    />
  </>
);
