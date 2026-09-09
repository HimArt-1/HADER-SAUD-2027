import React from 'react';

/** The same native dialog controller serves the landing page and this portal. */
const EntryIntro: React.FC<{ variant: 'landing' | 'system'; focusTarget: string }> = ({ variant, focusTarget }) =>
  React.createElement('hader-entry-intro', { variant, 'focus-target': focusTarget });

export default EntryIntro;
