import { interpolate, spring, useCurrentFrame, useVideoConfig, Img, staticFile } from 'remotion';
import React from 'react';

export const Scene5Outro: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // duration: 450
  
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const scaleIn = spring({ frame: frame - 10, fps, config: { damping: 12 } });

  const textOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeIn }}>
      <div 
        style={{ transform: `scale(${scaleIn})` }}
        className="flex flex-col items-center justify-center"
      >
        <div className="relative">
          <div className="absolute inset-0 bg-primary-400/40 blur-[100px] rounded-full animate-pulse-glow"></div>
          <Img 
            src={staticFile('hader-logo.png')} 
            className={`relative drop-shadow-[0_0_50px_rgba(34,211,238,0.8)] ${isPortrait ? 'w-80 h-80' : 'w-96 h-96'}`}
          />
        </div>

        <div style={{ opacity: textOpacity }} className="mt-16 text-center max-w-4xl">
          <h1 className={`font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-500 pb-4 ${isPortrait ? 'text-6xl' : 'text-8xl'}`}>
            منصة حاضر
          </h1>
          <p className={`text-white/90 mt-6 font-semibold tracking-wide leading-relaxed ${isPortrait ? 'text-4xl' : 'text-5xl'}`}>
            رؤية تكنولوجية طموحة <br/> لمستقبل تعليمي أكثر انضباطاً وابتكاراً
          </p>
          
          <div className="mt-16 py-4 border-t border-white/10">
            <p className="text-primary-300 text-2xl font-medium tracking-[0.2em] uppercase opacity-70 mb-6">
              إنجاز مدرسة الأمير سعود بن جلوي بالدمام
            </p>
            <div className="flex flex-col gap-3">
              <p className={`text-white/80 font-medium ${isPortrait ? 'text-2xl' : 'text-3xl'}`}>
                إعداد وتنفيذ: أ.هيثم بن غرم الله الزهراني
              </p>
              <p className={`text-white/80 font-medium ${isPortrait ? 'text-2xl' : 'text-3xl'}`}>
                مدير المدرسة: أ. حسام بن محمد يار
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
