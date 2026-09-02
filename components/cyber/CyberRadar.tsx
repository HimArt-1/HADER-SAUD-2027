import React, { useEffect, useRef } from 'react';

interface Blip {
  id: string;
  x: number;
  y: number;
  opacity: number;
  size: number;
  type: 'PHANTOM' | 'VERIFIED' | 'CRITICAL';
}

interface CyberRadarProps {
  color?: string;
  speed?: number;
  className?: string;
}

const CyberRadar: React.FC<CyberRadarProps> = ({ 
  color = '#f59e0b', 
  speed = 0.05,
  className = "" 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blipsRef = useRef<Blip[]>([]);
  const angleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    window.addEventListener('resize', resize);
    resize();

    // Initialize some random blips
    const initBlips = () => {
      const types: Blip['type'][] = ['PHANTOM', 'VERIFIED', 'CRITICAL'];
      blipsRef.current = Array.from({ length: 5 }, (_, i) => ({
        id: i.toString(),
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        opacity: 0,
        size: Math.random() * 4 + 2,
        type: types[Math.floor(Math.random() * types.length)]
      }));
    };
    initBlips();

    const resolveColor = () => {
      const fallback = [245, 158, 11];
      const raw = color.trim();

      if (raw.startsWith('var(')) {
        const variableName = raw.slice(4, -1).trim();
        const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        const parts = value.split(/\s+/).map(Number);
        return parts.length >= 3 && parts.every(Number.isFinite) ? parts.slice(0, 3) : fallback;
      }

      if (raw.startsWith('#')) {
        const hex = raw.replace('#', '');
        const normalized = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
        const value = Number.parseInt(normalized, 16);
        if (Number.isFinite(value)) {
          return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
        }
      }

      const rgbMatch = raw.match(/rgba?\(([^)]+)\)/);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(/[,\s/]+/).map(Number).filter(Number.isFinite);
        if (parts.length >= 3) return parts.slice(0, 3);
      }

      return fallback;
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radius = Math.min(cx, cy) * 0.9;
      const [r, g, b] = resolveColor();
      const rgba = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

      // 1. Draw Static Rings
      ctx.strokeStyle = rgba(0.14);
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (i / 4), 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2. Draw Crosshair
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      // 3. Draw Sweep
      angleRef.current += speed;
      const gradient = ctx.createConicGradient(angleRef.current, cx, cy);
      gradient.addColorStop(0, rgba(0.53));
      gradient.addColorStop(0.1, rgba(0.27));
      gradient.addColorStop(0.2, rgba(0));
      gradient.addColorStop(1, rgba(0));

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, angleRef.current - 0.5, angleRef.current);
      ctx.fill();

      // 4. Update and Draw Blips
      blipsRef.current.forEach(blip => {
        // Simple logic: if sweep angle hits blip angle, boost opacity
        const blipAngle = Math.atan2(blip.y - cy, blip.x - cx);
        const normalizedSweep = angleRef.current % (Math.PI * 2);
        const diff = Math.abs(normalizedSweep - (blipAngle < 0 ? blipAngle + Math.PI * 2 : blipAngle));
        
        if (diff < 0.1) blip.opacity = 1;
        blip.opacity *= 0.98; // decay

        if (blip.opacity > 0.01) {
          ctx.shadowBlur = 10 * blip.opacity;
          ctx.shadowColor = blip.type === 'CRITICAL' ? '#ef4444' : rgba(1);
          ctx.fillStyle = blip.type === 'CRITICAL' ? `rgba(239, 68, 68, ${blip.opacity})` : rgba(blip.opacity);
          ctx.beginPath();
          ctx.arc(blip.x, blip.y, blip.size, 0, Math.PI * 2);
          ctx.fill();
          
          // Outer ring for blip
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          ctx.arc(blip.x, blip.y, blip.size * (1 + (1 - blip.opacity) * 2), 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      ctx.shadowBlur = 0;
      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [color, speed]);

  return (
    <canvas 
      ref={canvasRef} 
      className={`w-full h-full pointer-events-none opacity-50 ${className}`}
    />
  );
};

export default CyberRadar;
