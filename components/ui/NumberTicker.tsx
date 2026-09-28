import React, { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

interface NumberTickerProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export const NumberTicker: React.FC<NumberTickerProps> = ({
  value,
  duration = 1.5,
  className = '',
  prefix = '',
  suffix = '',
  decimals = 0
}) => {
  const springValue = useSpring(value, {
    duration: duration * 1000,
    bounce: 0.1,
  });

  const display = useTransform(springValue, (current) => {
    return prefix + Number(current).toFixed(decimals) + suffix;
  });

  useEffect(() => {
    // Zero is a real measurement too (for example after changing the period).
    springValue.set(value);
  }, [value, springValue]);

  return <motion.span className={className}>{display}</motion.span>;
};

export default NumberTicker;
