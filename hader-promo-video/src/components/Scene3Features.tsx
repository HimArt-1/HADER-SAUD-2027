import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import React from 'react';
import { GlassCard } from './GlassCard';
import { BellRing, ShieldAlert, MessageCircle } from 'lucide-react';

export const Scene3Features: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // Duration 420.
  
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [390, 420], [1, 0], { extrapolateRight: 'clamp' });

  // Staggered entry for cards
  const titleY = interpolate(frame, [0, 30], [-50, 0], { extrapolateRight: 'clamp' });
  
  const card1Y = spring({ frame: frame - 30, fps, config: { damping: 12 } });
  const card2Y = spring({ frame: frame - 60, fps, config: { damping: 12 } });
  
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeIn * fadeOut }}>
      <h2 
        style={{ transform: `translateY(${titleY}px)` }}
        className={`font-bold text-white mb-16 text-glow-blue text-center ${isPortrait ? 'text-6xl' : 'text-7xl'}`}
      >
        طفرة في المتابعة والإشعار
      </h2>

      <div className={`flex w-full max-w-5xl gap-8 ${isPortrait ? 'flex-col items-center' : 'flex-row justify-center'}`}>
        
        <GlassCard 
          style={{ transform: `scale(${card1Y})` }}
          className="flex-1 flex flex-col items-center p-10 w-full max-w-sm"
        >
          <div className="p-6 bg-red-500/20 rounded-full mb-6">
            <ShieldAlert size={64} className="text-red-400" />
          </div>
          <h3 className="text-3xl font-bold text-white mb-4">متابعة سلوكية</h3>
          <p className="text-xl text-gray-300 text-center">
            رصد الانتهاكات السلوكية وتصنيفها بنظام مكافآت وعقوبات ذكي.
          </p>
        </GlassCard>

        <GlassCard 
          style={{ transform: `scale(${card2Y})` }}
          className="flex-1 flex flex-col items-center p-10 w-full max-w-sm"
        >
          <div className="relative p-6 bg-green-500/20 rounded-full mb-6">
            <MessageCircle size={64} className="text-green-400" />
            <BellRing size={24} className="absolute top-4 right-4 text-white animate-bounce" />
          </div>
          <h3 className="text-3xl font-bold text-white mb-4">إشعارات فورية</h3>
          <p className="text-xl text-gray-300 text-center">
            رسائل واتساب تلقائية لأولياء الأمور لحظة التسجيل.
          </p>
        </GlassCard>

      </div>
    </div>
  );
};
