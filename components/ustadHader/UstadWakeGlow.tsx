// =============================================================================
// نظام حاضر (Hader) - توهج أطراف الشاشة عند سماع «يا أستاذ حاضر»
// =============================================================================
// إشارة الاستجابة: تضيء حواف الشاشة لحظة ثم تخبو، بينما تظهر البطاقة.

import React, { useEffect, useState } from 'react';

const GLOW_MS = 1500;

export const UstadWakeGlow: React.FC<{ signal: number }> = ({ signal }) => {
  const [activeSignal, setActiveSignal] = useState(0);

  useEffect(() => {
    if (!signal) return;
    setActiveSignal(signal);
    const timer = setTimeout(() => setActiveSignal(0), GLOW_MS);
    return () => clearTimeout(timer);
  }, [signal]);

  if (!activeSignal) return null;
  return <div key={activeSignal} className="ustad-edge-glow" aria-hidden="true" />;
};

export default UstadWakeGlow;
