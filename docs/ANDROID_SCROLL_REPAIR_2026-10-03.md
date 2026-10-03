# HADER-SAUD-2027 mobile scrolling repair

At mobile widths, `body` grows with the content but is a scroll container because
of `overflow-x: hidden`. Its mobile `overscroll-behavior-y: contain` rule blocks
scroll chaining to the document even though body itself has no scroll range.
Move that rule to `html`, the actual document scroller. Keep existing touch
handling, pinch zoom and horizontal clipping unchanged.

## Regression check

Run `npm run dev -- --host 127.0.0.1 --port 5174` and open
`http://127.0.0.1:5174/__tests__/browser/mobile-scroll.html` below 768 CSS pixels.
Click **إعادة الاختبار** and use a real scroll gesture over the outlined paragraph.
The status must say `PASS` and show a document offset increase. Repeat above
768 CSS pixels. Do not replace the gesture with `scrollTo` or a synthetic event;
those do not test browser scroll chaining. The reset button only resets the
starting position. The fixture uses the real application CSS and is excluded
from production output.

## Verification on 2026-10-03

- Production login at 393 × 650 CSS pixels: a native scroll over visible content
  stayed at 367.5px before the fix, despite a 531px document scroll range.
- Minimal fixture at 357 CSS pixels: `FAIL: document scroll 0 → 0` before the fix,
  then `PASS: document scroll 0 → 90.90908813476562` after it.
- Desktop fixture at 1242 CSS pixels: 0 → 90.91px, with overscroll still `auto`.
- `npm run build` passed, including TypeScript validation. Existing bundler
  warnings about chunk size and mixed imports remain.

Checks used desktop Chrome at mobile viewport widths. A physical Android
one-finger/two-finger gesture test still requires confirmation on the device.

The equivalent fix was verified separately in HimArt-1/Hader-ma PR #2. This
change is based on HADER-SAUD-2027 main at 70272f15ca0dd6388a35dddb45970052d9d1df68.
