import React, { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface CyberStatsCardProps {
  label: string;
  value: number;
  suffix?: string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    isUp: boolean;
  };
  color?: 'amber' | 'emerald' | 'cyan';
}

const CyberStatsCard: React.FC<CyberStatsCardProps> = ({
  label,
  value,
  suffix = "",
  icon,
  trend,
  color = 'amber'
}) => {
  const springValue = useSpring(0, { stiffness: 40, damping: 20 });
  const displayValue = useTransform(springValue, (latest) => Math.floor(latest));
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    springValue.set(value);
    const unsubscribe = displayValue.on("change", (latest) => setCurrent(latest));
    return () => unsubscribe();
  }, [value, springValue, displayValue]);

  const colorClasses = {
    amber: 'text-amber-500 border-amber-500/20 shadow-amber-500/5',
    emerald: 'text-emerald-500 border-emerald-500/20 shadow-emerald-500/5',
    cyan: 'text-primary-500 border-primary-500/20 shadow-primary-500/5'
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card p-4 rounded-2xl relative overflow-hidden group ${colorClasses[color]}`}
    >
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 opacity-10 bg-cyber-grid pointer-events-none" />
      
      {/* Top HUD Line */}
      <div className="absolute top-0 left-0 w-8 h-[2px] bg-current" />
      <div className="absolute top-0 left-0 w-[2px] h-4 bg-current" />

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
            {label}
          </span>
          {icon && <div className="opacity-40">{icon}</div>}
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-black font-mono tracking-tighter">
            {current.toLocaleString()}
          </span>
          <span className="text-xs font-bold opacity-40 uppercase">{suffix}</span>
        </div>

        {trend && (
          <div className={`mt-2 text-[10px] font-bold flex items-center gap-1 ${trend.isUp ? 'text-emerald-500' : 'text-red-500'}`}>
            <span className="font-mono">{trend.isUp ? '+' : '-'}{trend.value}%</span>
            <span className="opacity-40">INTELLIGENCE DELTA</span>
          </div>
        )}
      </div>

      {/* Decorative Corner Notch (Bottom Right) */}
      <div className="absolute bottom-0 right-0 w-4 h-4 bg-current opacity-10 cyber-notch" />
    </motion.div>
  );
};

export default CyberStatsCard;
