import React, { HTMLAttributes } from 'react';

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'default' | 'neon' | 'panel';
  hoverEffect?: boolean;
}

export function GlassCard({
  children,
  variant = 'default',
  hoverEffect = false,
  className = '',
  ...props
}: GlassCardProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'neon':
        return 'glass-card border-primary-500/50 hover:border-primary-400 hover:shadow-neon-lg';
      case 'panel':
        return 'glass-panel';
      case 'default':
      default:
        return 'glass-card border-white/10';
    }
  };

  const baseClasses = `rounded-3xl p-6 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-2xl transition-all duration-300 shadow-xl overflow-hidden relative`;
  
  const hoverClasses = hoverEffect ? 'hover:scale-[1.02] hover:bg-gradient-to-br hover:from-slate-800/90 hover:to-slate-900/90 hover:z-10 cursor-default' : '';

  return (
    <div
      className={`${baseClasses} ${getVariantClasses()} ${hoverClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
