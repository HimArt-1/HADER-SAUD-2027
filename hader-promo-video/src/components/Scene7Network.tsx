import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import React from 'react';
import { GlassCard } from './GlassCard';
import { Smartphone, ScanLine, Database } from 'lucide-react';

export const Scene7Network: React.FC<{ isPortrait: boolean }> = ({ isPortrait }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig(); // Duration 420
  
  const fadeIn = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [390, 420], [1, 0], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [0, 20], [-50, 0], { extrapolateRight: 'clamp' });

  // Spring animations for nodes
  const node1 = spring({ frame: frame - 20, fps, config: { damping: 14 } });
  const node2 = spring({ frame: frame - 40, fps, config: { damping: 14 } });
  const node3 = spring({ frame: frame - 60, fps, config: { damping: 14 } });

  // Laser beam timing
  const showBeam1 = frame > 45;
  const showBeam2 = frame > 65;

  // 3D rotation based on frame for dynamic perspective
  const rotateX = interpolate(frame, [0, 420], [10, -10], { extrapolateRight: 'clamp' });
  const rotateY = interpolate(frame, [0, 420], [-10, 10], { extrapolateRight: 'clamp' });

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-8" style={{ opacity: fadeIn * fadeOut, perspective: '1000px' }}>
      <h2 
        style={{ transform: `translateY(${titleY}px)` }}
        className={`font-bold text-white mb-20 text-glow-blue text-center ${isPortrait ? 'text-5xl' : 'text-6xl'}`}
      >
        ربط لحظي للبيانات
      </h2>

      <div className={`relative flex items-center justify-between w-full max-w-4xl px-10 ${isPortrait ? 'flex-col h-[500px]' : 'flex-row'}`} style={{ transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`, transformStyle: 'preserve-3d' }}>
        
        {/* Connection Lines (SVGs behind) */}
        {!isPortrait && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0" style={{ transform: 'translateZ(-20px)' }}>
            <svg width="100%" height="20" className="absolute left-[10%] right-[10%] overflow-visible">
               <defs>
                 <filter id="glow">
                   <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                   <feMerge>
                     <feMergeNode in="coloredBlur"/>
                     <feMergeNode in="SourceGraphic"/>
                   </feMerge>
                 </filter>
               </defs>
               {/* Line 1 */}
               <line x1="15%" y1="10" x2="40%" y2="10" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
               <line x1="15%" y1="10" x2="40%" y2="10" stroke="#06b6d4" strokeWidth="2" opacity="0.3" filter="url(#glow)" />
               {showBeam1 && (
                 <>
                   <line x1="15%" y1="10" x2="40%" y2="10" stroke="#22d3ee" strokeWidth="6" strokeDasharray="50 150" strokeLinecap="round" filter="url(#glow)" opacity="0.8">
                      <animate attributeName="stroke-dashoffset" from="200" to="0" dur="1.5s" repeatCount="indefinite" />
                   </line>
                   <line x1="15%" y1="10" x2="40%" y2="10" stroke="#ffffff" strokeWidth="2" strokeDasharray="50 150" strokeLinecap="round">
                      <animate attributeName="stroke-dashoffset" from="200" to="0" dur="1.5s" repeatCount="indefinite" />
                   </line>
                 </>
               )}
               {/* Line 2 */}
               <line x1="60%" y1="10" x2="85%" y2="10" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
               <line x1="60%" y1="10" x2="85%" y2="10" stroke="#2563eb" strokeWidth="2" opacity="0.3" filter="url(#glow)" />
               {showBeam2 && (
                 <>
                   <line x1="60%" y1="10" x2="85%" y2="10" stroke="#60a5fa" strokeWidth="6" strokeDasharray="50 150" strokeLinecap="round" filter="url(#glow)" opacity="0.8">
                      <animate attributeName="stroke-dashoffset" from="200" to="0" dur="1.5s" repeatCount="indefinite" />
                   </line>
                   <line x1="60%" y1="10" x2="85%" y2="10" stroke="#ffffff" strokeWidth="2" strokeDasharray="50 150" strokeLinecap="round">
                      <animate attributeName="stroke-dashoffset" from="200" to="0" dur="1.5s" repeatCount="indefinite" />
                   </line>
                 </>
               )}
            </svg>
          </div>
        )}

        {/* Nodes */}
        <div style={{ transform: `scale(${node1})` }} className="z-10 flex flex-col items-center">
          <GlassCard className="p-8 shadow-[0_0_40px_rgba(34,211,238,0.4)] rounded-full border-primary-500">
            <ScanLine size={64} className="text-primary-400" />
          </GlassCard>
          <span className="mt-4 text-xl font-bold bg-app/80 px-4 py-1 rounded-full border border-white/10">الماسح الضوئي</span>
        </div>

        <div style={{ transform: `scale(${node2})` }} className="z-10 flex flex-col items-center">
          <GlassCard className="p-8 shadow-[0_0_40px_rgba(37,99,235,0.4)] rounded-full border-secondary-500">
            <Database size={64} className="text-secondary-400" />
          </GlassCard>
          <span className="mt-4 text-xl font-bold bg-app/80 px-4 py-1 rounded-full border border-white/10">سيرفر حاضر</span>
        </div>

        <div style={{ transform: `scale(${node3})` }} className="z-10 flex flex-col items-center">
          <GlassCard className="p-8 shadow-[0_0_40px_rgba(34,211,238,0.4)] rounded-full border-primary-400">
            <Smartphone size={64} className="text-primary-400" />
          </GlassCard>
          <span className="mt-4 text-xl font-bold bg-app/80 px-4 py-1 rounded-full border border-white/10">ولي الأمر</span>
        </div>

      </div>
      
      <p style={{ opacity: interpolate(frame, [80, 100], [0, 1]) }} className="mt-20 text-3xl font-medium text-gray-300">
        دقة • سرعة • شفافية
      </p>
    </div>
  );
};
