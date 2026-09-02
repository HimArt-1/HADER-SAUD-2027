import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import React from 'react';
import { GlassCard } from './GlassCard';
import { ShieldCheck, Users, UsersRound, UserCog, KeyRound } from 'lucide-react';

export const Scene4Roles: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // Duration: 420
  
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [390, 420], [1, 0], { extrapolateRight: 'clamp' });

  const titleY = interpolate(frame, [0, 20], [-50, 0], { extrapolateRight: 'clamp' });

  // Grid spring
  const gridScale = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  
  // Security icon pop
  const lockPop = spring({ frame: frame - 60, fps, config: { stiffness: 100, damping: 10 } });

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeIn * fadeOut }}>
      <h2 
        style={{ transform: `translateY(${titleY}px)` }}
        className={`font-bold text-white mb-12 text-glow ${isPortrait ? 'text-5xl' : 'text-6xl'} text-center`}
      >
        حماية شاملة. أدوار متعددة.
      </h2>

      <div className={`flex w-full items-center justify-center gap-10 ${isPortrait ? 'flex-col' : 'flex-row max-w-6xl'}`}>
        
        {/* Roles Grid */}
        <GlassCard 
          style={{ transform: `scale(${gridScale})` }}
          className="flex-1 p-8 grid grid-cols-2 gap-6 w-full max-w-lg"
        >
          <div className="flex flex-col items-center p-4 bg-white/5 rounded-2xl border border-white/10">
            <UserCog size={40} className="text-secondary-400 mb-2" />
            <span className="text-lg font-bold">إدارة</span>
          </div>
          <div className="flex flex-col items-center p-4 bg-white/5 rounded-2xl border border-white/10">
            <UsersRound size={40} className="text-primary-400 mb-2" />
            <span className="text-lg font-bold">إشراف</span>
          </div>
          <div className="flex flex-col items-center p-4 bg-white/5 rounded-2xl border border-white/10">
            <Users size={40} className="text-purple-400 mb-2" />
            <span className="text-lg font-bold">أولياء أمور</span>
          </div>
          <div className="flex flex-col items-center p-4 bg-white/5 rounded-2xl border border-white/10">
            <KeyRound size={40} className="text-green-400 mb-2" />
            <span className="text-lg font-bold">9 صلاحيات</span>
          </div>
        </GlassCard>

        {/* Security Badge */}
        <div style={{ transform: `scale(${lockPop})` }} className="flex flex-col items-center justify-center">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-primary-500 blur-2xl opacity-50 rounded-full animate-pulse-glow"></div>
            <div className="relative bg-app/80 p-8 rounded-full border-2 border-primary-500 glass">
              <ShieldCheck size={80} className="text-primary-400" />
            </div>
          </div>
          <h3 className="text-4xl font-bold text-white mb-2 text-glow">آمن ومشفر</h3>
          <p className="text-xl text-primary-200">حماية عالية للبيانات</p>
        </div>

      </div>
    </div>
  );
};
