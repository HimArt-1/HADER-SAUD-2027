import React, { useEffect, useState } from 'react';
import { motion, useSpring, useTransform, useInView } from 'framer-motion';
import { useRef } from 'react';

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
  const ref = useRef<HTMLSpanElement>(null);
  // ❌ Old: once: true + margin: "-50px" — broke on mobile portrait because
  //    the element wasn't in view during initial render (data arrived late)
  //    and the negative margin shrunk the detection zone.
  // ✅ New: no once constraint, no negative margin. Re-triggers on every
  //    visibility change so late-arriving data still animates correctly.
  const isInView = useInView(ref, { once: false, margin: "0px" });
  const hasAnimated = useRef(false);
  
  const springValue = useSpring(0, {
    duration: duration * 1000,
    bounce: 0.1,
  });

  const display = useTransform(springValue, (current) => {
    return prefix + Number(current).toFixed(decimals) + suffix;
  });

  useEffect(() => {
    if (isInView && value !== 0) {
      springValue.set(value);
      hasAnimated.current = true;
    } else if (value !== 0 && !hasAnimated.current) {
      // Fallback: if the element is mounted but IntersectionObserver
      // hasn't fired yet (common on mobile), set value directly after
      // a microtask to ensure the DOM has settled.
      const id = requestAnimationFrame(() => {
        springValue.set(value);
        hasAnimated.current = true;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isInView, value, springValue]);

  // When value changes (e.g. data loaded after mount), always update
  useEffect(() => {
    if (hasAnimated.current && value !== 0) {
      springValue.set(value);
    }
  }, [value, springValue]);

  return <motion.span ref={ref} className={className}>{display}</motion.span>;
};

export default NumberTicker;
