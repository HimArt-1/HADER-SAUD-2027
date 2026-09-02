import { spring, useCurrentFrame, useVideoConfig, Img, staticFile, interpolate, Easing } from 'remotion';
import React from 'react';

export const Scene1Intro: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // duration 240
  
  const logoScale = spring({ frame: frame - 10, fps, config: { damping: 12 } });
  const textOpacity = interpolate(frame, [40, 70], [0, 1], { extrapolateRight: 'clamp' });
  const textY = interpolate(frame, [40, 70], [50, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.exp) });

  const fadeOut = interpolate(frame, [220, 240], [1, 0], { extrapolateRight: 'clamp' });
  
  // Neon flicker effect for title
  const flicker = frame > 80 && frame < 90 && frame % 3 === 0 ? 0.6 : 1;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeOut }}>
      <Img 
        src={staticFile('hader-logo.png')} 
        style={{ transform: `scale(${logoScale})` }} 
        className={isPortrait ? "w-64 h-64 drop-shadow-[0_0_40px_rgba(6,182,212,0.6)]" : "w-80 h-80 drop-shadow-[0_0_40px_rgba(6,182,212,0.6)]"} 
      />
      
      <div 
        style={{ opacity: textOpacity, transform: `translateY(${textY}px)` }}
        className="mt-12 text-center"
      >
        <h1 
          className={`font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400 pb-2 ${isPortrait ? 'text-6xl' : 'text-8xl'}`}
          style={{ opacity: flicker, filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.4))' }}
        >
          مبادرة منصة حاضر
        </h1>
        <p className={`text-gray-200 mt-6 font-medium tracking-wide ${isPortrait ? 'text-4xl' : 'text-5xl'}`}>
          مستقبل الإدارة المدرسية المتكاملة
        </p>
      </div>
    </div>
  );
};
