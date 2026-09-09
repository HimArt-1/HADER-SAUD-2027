# Hader logo motion

The logo PNG is copied unchanged from `hadir-logo.png` in the supplied
`أداة استنساخ وتحريك اللوقو.zip`. Motion is adapted from `hadir-scene.jsx`:
its five clipped slices, light reveal, small settling pulse and masked shine.
The editor's animation engine and support scripts are not runtime dependencies.

- `public/brand/hader-motion.css` serves both the standalone landing page and the React app.
- `components/AnimatedLogo.tsx` supplies the shared accessible React markup.
- `draw`: a brief reveal for landing and app navigation, followed by one shine.
- `assemble`: five staggered slices on boot and login, settling in under one second.
- `quiet`: a static mark with a single shine on pointer hover or parent-link keyboard focus.
- `tone`: brand colour, inverse white, or the current root theme.
- Reduced motion immediately displays the complete static logo.

All animations finish within two seconds; none loops or delays navigation.
Ordinary React updates, theme switches and sidebar resizing keep the same component
mounted and do not restart the entrance. Page loading uses the quiet variant.
The logo reserves its aspect ratio and exposes a single accessible name. Image
failure in React displays the word حاضر instead of removing the brand.

The original source logo is retained as `public/brand/hader-logo.png`. The landing
page keeps the original favicon and social image URLs for compatibility.
