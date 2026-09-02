import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { Scene1Intro } from './components/Scene1Intro';
import { Scene2Attendance } from './components/Scene2Attendance';
import { Scene3Features } from './components/Scene3Features';
import { Scene6Analytics } from './components/Scene6Analytics';
import { Scene7Network } from './components/Scene7Network';
import { Scene4Roles } from './components/Scene4Roles';
import { Scene5Outro } from './components/Scene5Outro';
import { ParticleBackground } from './components/ParticleBackground';
import React from 'react';

export const MainVideo: React.FC = () => {
  const { width } = useVideoConfig();
  const isPortrait = width <= 1080;

  return (
    <AbsoluteFill className="bg-app text-white overflow-hidden" style={{ perspective: '1000px' }}>
      {/* Ambient Backdrops */}
      <div className="absolute inset-0 bg-gradient-to-br from-app to-app-secondary"></div>
      <ParticleBackground />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary-500/20 blur-[120px] animate-blob"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-secondary-500/20 blur-[150px] animate-blob" style={{ animationDelay: '2s' }}></div>

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA0MCAwIEwgMCAwIDAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjA1KSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50"></div>

      {/* Intro */}
      <Sequence from={0} durationInFrames={240}>
        <Scene1Intro isPortrait={isPortrait} />
      </Sequence>

      {/* Smart Attendance */}
      <Sequence from={210} durationInFrames={390}>
        <Scene2Attendance isPortrait={isPortrait} />
      </Sequence>

      {/* Behavior & Features */}
      <Sequence from={570} durationInFrames={420}>
        <Scene3Features isPortrait={isPortrait} />
      </Sequence>

      {/* Analytics Infographic */}
      <Sequence from={960} durationInFrames={420}>
        <Scene6Analytics isPortrait={isPortrait} />
      </Sequence>

      {/* Network Sync Infographic */}
      <Sequence from={1350} durationInFrames={420}>
        <Scene7Network isPortrait={isPortrait} />
      </Sequence>

      {/* Roles & Security */}
      <Sequence from={1740} durationInFrames={420}>
        <Scene4Roles isPortrait={isPortrait} />
      </Sequence>

      {/* Outro */}
      <Sequence from={2130} durationInFrames={470}>
        <Scene5Outro isPortrait={isPortrait} />
      </Sequence>
    </AbsoluteFill>
  );
};
