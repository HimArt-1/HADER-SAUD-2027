import React from 'react';

export const GlassCard: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style }) => {
  return (
    <div 
      style={{
        transformStyle: 'preserve-3d',
        ...style
      }}
      className={`bg-[#0f172a]/60 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_8px_32px_0_rgba(0,0,0,0.4)] ${className}`}
    >
      <div 
        className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none"
        style={{ transform: 'translateZ(10px)' }} // Lift the glare off the background card slightly
      ></div>
      <div style={{ transform: 'translateZ(30px)' }} className="w-full h-full flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
};
