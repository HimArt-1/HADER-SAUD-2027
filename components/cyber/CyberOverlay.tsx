import React from 'react';

const CyberOverlay: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      {/* Scanlines Overlay */}
      <div className="absolute inset-0 scanlines opacity-30" />
      
      {/* Noise / Vignette */}
      <div className="absolute inset-0 noise-vignette opacity-20" />
      
      {/* Moving CRT Glow (Subtle) */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.02] to-transparent h-20 animate-scan-line" />
    </div>
  );
};

export default CyberOverlay;
