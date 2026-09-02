import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import React from 'react';
import { GlassCard } from './GlassCard';
import { BarChart3, TrendingUp, PieChart } from 'lucide-react';

export const Scene6Analytics: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // Duration 420
  
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [390, 420], [1, 0], { extrapolateRight: 'clamp' });

  const titleY = interpolate(frame, [0, 20], [-50, 0], { extrapolateRight: 'clamp' });

  const scaleChart = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  
  // Progress stroke
  const progress = spring({ frame: frame - 40, fps, config: { damping: 200, mass: 2, stiffness: 20 } });
  const dashoffset = interpolate(progress, [0, 1], [314, 314 * 0.05]); // Stroke length is 2*pi*50 = 314. Target is 95% filled.

  const countUpValue = Math.floor(interpolate(progress, [0, 1], [0, 95]));

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeIn * fadeOut }}>
      <h2 
        style={{ transform: `translateY(${titleY}px)` }}
        className={`font-bold text-white mb-12 text-glow text-center ${isPortrait ? 'text-5xl' : 'text-6xl'}`}
      >
        إحصائيات تمنحك الرؤية الكاملة
      </h2>

      <div className={`flex w-full items-center justify-center gap-10 ${isPortrait ? 'flex-col' : 'flex-row max-w-6xl'}`}>
        
        {/* Animated Doughnut Chart */}
        <GlassCard 
          style={{ transform: `scale(${scaleChart})` }}
          className="flex flex-col items-center justify-center p-8 w-[350px] relative"
        >
          <div className="relative w-48 h-48 flex items-center justify-center">
            {/* Background Circle */}
            <svg className="absolute inset-0" width="100%" height="100%" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="12" />
            </svg>
            {/* Progress Circle */}
            <svg className="absolute inset-0 transform -rotate-90" width="100%" height="100%" viewBox="0 0 120 120">
              <circle 
                cx="60" cy="60" r="50" fill="none" 
                stroke="url(#gradient)" strokeWidth="12" 
                strokeLinecap="round"
                strokeDasharray="314"
                strokeDashoffset={dashoffset}
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#2563eb" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-5xl font-bold text-white drop-shadow-lg">{countUpValue}%</span>
            </div>
          </div>
          <h3 className="text-2xl font-bold mt-6 text-gray-200">نسبة الانضباط</h3>
        </GlassCard>

        {/* Bar chart / numbers */}
        <div className={`flex flex-col gap-6 ${isPortrait ? 'w-full' : 'w-[400px]'}`}>
          <GlassCard style={{ transform: `translateX(${interpolate(frame, [50, 70], [100, 0], { extrapolateRight: 'clamp' })}px)`, opacity: interpolate(frame, [50, 70], [0, 1]) }} className="p-6 flex items-center gap-4">
            <div className="p-4 bg-primary-500/20 rounded-xl">
              <TrendingUp className="text-primary-400" size={32} />
            </div>
            <div>
              <p className="text-gray-300 text-lg">توفير الوقت للإدارة</p>
              <p className="text-3xl font-bold text-white">+80%</p>
            </div>
          </GlassCard>
          
          <GlassCard style={{ transform: `translateX(${interpolate(frame, [60, 80], [100, 0], { extrapolateRight: 'clamp' })}px)`, opacity: interpolate(frame, [60, 80], [0, 1]) }} className="p-6 flex items-center gap-4">
            <div className="p-4 bg-secondary-500/20 rounded-xl">
              <BarChart3 className="text-secondary-400" size={32} />
            </div>
            <div>
              <p className="text-gray-300 text-lg">إدارة الطلاب بالآلاف</p>
              <p className="text-3xl font-bold text-white">سرعة استجابة فائقة</p>
            </div>
          </GlassCard>
        </div>

      </div>
    </div>
  );
};
