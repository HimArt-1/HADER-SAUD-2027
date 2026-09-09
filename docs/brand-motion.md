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

## Entry introductions

`public/brand/entry-intro.js` defines a shared `hader-entry-intro` custom element.
The landing document uses it directly; `components/EntryIntro.tsx` mounts it in
Login. `entry-intro.css` keeps the landing opening light and the sign-in opening
technical and dark. These are brand introductions, not authentication checks.

Each variant runs once per tab session (2.2 s landing / 2.6 s portal, plus a
320 ms exit). The `data-replay-intro` buttons can replay it. Native dialogs handle
background inertness and focus containment; Skip and Escape dismiss immediately.
Focus returns to the replay button or the designated page heading. Disconnecting
the element clears timers and restores scrolling. Reduced motion bypasses
an automatic intro; a deliberate replay shows a static version. Landing section
links also bypass the automatic opening. Missing storage or unsupported dialogs
never prevent using the page. Neither intro submits or delays an auth request.
