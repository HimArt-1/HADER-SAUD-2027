import React, { useState } from 'react';

interface AnimatedLogoProps {
  motion?: 'draw' | 'assemble' | 'quiet';
  size?: 'compact' | 'navigation' | 'login' | 'splash';
  tone?: 'auto' | 'brand' | 'inverse';
  className?: string;
}

/** A finite entrance adapted from the supplied logo animation project. */
const AnimatedLogo: React.FC<AnimatedLogoProps> = ({
  motion = 'quiet',
  size = 'navigation',
  tone = 'auto',
  className = '',
}) => {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={`hader-mark ${className}`}
      data-motion={motion}
      data-size={size}
      data-tone={tone}
      data-failed={failed || undefined}
      role="img"
      aria-label="حاضر"
    >
      <img
        className="hader-mark-image"
        src={`${import.meta.env.BASE_URL}brand/hader-logo.png`}
        width="1024"
        height="490"
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
      {motion === 'assemble' && (
        <span className="hader-mark-pieces" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <span className="hader-mark-piece" key={index} />)}
        </span>
      )}
      <span className="hader-mark-light" aria-hidden="true" />
      {failed && <span className="hader-mark-fallback" aria-hidden="true">حاضر</span>}
    </span>
  );
};

export default AnimatedLogo;
