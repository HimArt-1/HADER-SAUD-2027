// =============================================================================
// نظام حاضر (Hader) - الكرة الضوئية لـ «أستاذ حاضر»
// =============================================================================
// تدور بهدوء في السكون، وتتموج حلقاتها عند الاستماع، وتتنفس عند الرد، وتنبض عند النداء.

import React from 'react';

export type UstadOrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface UstadOrbProps {
  state: UstadOrbState;
  size?: 'xs' | 'md' | 'lg';
  awake?: boolean;
  className?: string;
}

export const UstadOrb: React.FC<UstadOrbProps> = ({ state, size = 'md', awake = false, className = '' }) => (
  <div className={`ustad-orb ${className}`} data-state={state} data-size={size} data-awake={awake || undefined} aria-hidden="true">
    <span className="ustad-orb__ring" />
    <span className="ustad-orb__ring" />
    <span className="ustad-orb__body">
      <span className="ustad-orb__core" />
      <span className="ustad-orb__glass" />
    </span>
  </div>
);

export default UstadOrb;
