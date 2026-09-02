import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import React from 'react';

export const ParticleBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { height, width } = useVideoConfig();

  // Generate deterministic particles
  const particles = Array.from({ length: 50 }).map((_, i) => {
    // Pseudo-random deterministic values based on index
    const size = 2 + (i % 4);
    const startX = (i * 47) % width;
    const startY = (i * 73) % height;
    const speedY = 0.5 + (i % 3) * 0.5;
    const speedX = -1 + (i % 3);
    const opacity = 0.1 + (i % 5) * 0.1;
    
    return { size, startX, startY, speedY, speedX, opacity };
  });

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p, i) => {
        // Calculate current position
        const currentY = (p.startY - frame * p.speedY) % height;
        const currentX = (p.startX + frame * p.speedX) % width;
        
        // Handle wrap-around seamlessly
        const y = currentY < -p.size ? height + currentY : currentY;
        const x = currentX < -p.size ? width + currentX : currentX > width ? currentX - width : currentX;

        // Twinkling effect
        const baseOpacity = p.opacity;
        const twinkle = Math.sin((frame + i * 10) / 10) * 0.5 + 0.5; // 0 to 1
        const currentOpacity = baseOpacity * twinkle;

        return (
          <div
            key={i}
            className="absolute rounded-full bg-cyan-400"
            style={{
              width: p.size,
              height: p.size,
              left: x,
              top: y,
              opacity: currentOpacity,
              boxShadow: `0 0 ${p.size * 2}px rgba(34, 211, 238, 0.8)`
            }}
          />
        );
      })}
    </div>
  );
};
