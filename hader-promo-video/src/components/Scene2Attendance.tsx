import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import React from 'react';
import { GlassCard } from './GlassCard';
import { ScanFace, QrCode, Fingerprint } from 'lucide-react';

export const Scene2Attendance: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // from 210, duration 390. Local frame 0 to 390.
  
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [360, 390], [1, 0], { extrapolateRight: 'clamp' });

  const cardScale = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  
  const scanLineY = interpolate(frame, [60, 180, 200, 320], [0, 100, 100, 0], { extrapolateRight: 'clamp' });

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeIn * fadeOut }}>
      <h2 
        style={{ transform: `translateY(${interpolate(frame, [0, 30], [-50, 0], { extrapolateRight: 'clamp' })}px)` }}
        className={`font-bold text-white mb-16 text-glow ${isPortrait ? 'text-6xl' : 'text-7xl'}`}
      >
        حضور وانصراف ذكي
      </h2>

      <GlassCard 
        style={{ transform: `scale(${cardScale})` }}
        className={`relative flex flex-col items-center justify-center border-primary-500/40 p-12 ${isPortrait ? 'w-full max-w-sm h-96' : 'w-[600px] h-[400px]'}`}
      >
        <div className="absolute inset-0 overflow-hidden rounded-3xl">
          <div 
            className="absolute left-0 right-0 h-1 bg-primary-400 shadow-[0_0_20px_rgba(34,211,238,1)] z-10"
            style={{ top: `${scanLineY}%` }}
          />
        </div>
        
        <div className="flex gap-8 mb-8">
          <QrCode size={80} className="text-primary-400 opacity-80" />
          <ScanFace size={80} className="text-secondary-400 opacity-80" />
        </div>
        
        <h3 className="text-4xl font-bold text-white mb-4">آلي وسريع</h3>
        <p className="text-2xl text-gray-300 text-center">
          دعم الباركود والـ QR Code مع احتساب تلقائي لحالات التأخير
        </p>
      </GlassCard>
    </div>
  );
};
