/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Welcome / First-run page bundled with every desktop download
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  When the user opens `Open-In-Browser.html` (or runs the launcher with
 *  no Chromium engine installed) we present a polished landing page that
 *  redirects to the live deployment after a brief countdown. The page is
 *  fully self-contained — no remote dependencies, no JavaScript bundlers
 *  — so it works even on the strictest air-gapped network until the
 *  browser is online.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface WelcomePageOptions {
  appUrl: string;
  appLaunchUrl: string;
  productName: string;
  version: string;
  buildId: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function buildWelcomeHtml(opts: WelcomePageOptions): string {
  const url = escapeHtml(opts.appLaunchUrl);
  const product = escapeHtml(opts.productName);
  const version = escapeHtml(opts.version);
  const build = escapeHtml(opts.buildId);

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#0f172a" />
<meta http-equiv="refresh" content="3;url=${url}" />
<title>${product} — Desktop</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100vh; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Cairo", "Tajawal", sans-serif;
    background:
      radial-gradient(ellipse 80% 60% at 20% 0%, rgba(34,211,238,0.18), transparent 60%),
      radial-gradient(ellipse 60% 50% at 80% 100%, rgba(56,189,248,0.18), transparent 60%),
      linear-gradient(180deg, #020617 0%, #0b1220 100%);
    color: #e2e8f0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: min(560px, 100%);
    padding: 36px 32px;
    border-radius: 28px;
    background: linear-gradient(180deg, rgba(15,23,42,0.85), rgba(15,23,42,0.65));
    border: 1px solid rgba(34,211,238,0.25);
    box-shadow:
      0 30px 80px rgba(8,145,178,0.18),
      inset 0 1px 0 rgba(255,255,255,0.04);
    backdrop-filter: blur(18px);
  }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
    background: rgba(34,211,238,0.12); color: #67e8f9;
    border: 1px solid rgba(34,211,238,0.35);
  }
  h1 {
    margin: 16px 0 6px;
    font-size: 26px;
    font-weight: 800;
    background: linear-gradient(90deg, #67e8f9, #38bdf8);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  p { line-height: 1.7; color: #cbd5f5; font-size: 15px; }
  .meta { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: #94a3b8; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
  .pill {
    background: rgba(2,6,23,0.5); border: 1px solid rgba(148,163,184,0.15);
    border-radius: 14px; padding: 10px 12px; font-size: 12px;
  }
  .pill b { display: block; color: #67e8f9; font-size: 11px; margin-bottom: 4px; }
  .actions { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
  .btn {
    flex: 1 1 200px;
    text-align: center; text-decoration: none;
    padding: 14px 20px; border-radius: 16px;
    font-weight: 700; font-size: 14px;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }
  .btn-primary {
    color: #0b1220;
    background: linear-gradient(135deg, #22d3ee, #38bdf8);
    box-shadow: 0 12px 30px rgba(56,189,248,0.35);
  }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 18px 36px rgba(56,189,248,0.45); }
  .btn-ghost {
    color: #cbd5f5;
    background: rgba(148,163,184,0.08);
    border: 1px solid rgba(148,163,184,0.18);
  }
  .btn-ghost:hover { background: rgba(148,163,184,0.16); }
  .progress {
    margin-top: 22px;
    height: 4px; border-radius: 999px;
    background: rgba(148,163,184,0.15); overflow: hidden;
  }
  .progress > span {
    display: block; height: 100%;
    background: linear-gradient(90deg, #22d3ee, #38bdf8);
    animation: fill 3s linear forwards;
  }
  @keyframes fill { from { width: 0; } to { width: 100%; } }
  footer { margin-top: 22px; font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <main class="card">
    <span class="badge">Desktop · App Mode</span>
    <h1>${product}</h1>
    <p>سيتم نقلك تلقائيًا إلى التطبيق الحيّ خلال ثوانٍ. التطبيق يعمل في وضع
    سطح المكتب مع مزامنة لحظية مع نفس قاعدة البيانات السحابية.</p>

    <div class="grid">
      <div class="pill"><b>الخادم الحيّ</b><span class="meta">${escapeHtml(new URL(opts.appLaunchUrl).host)}</span></div>
      <div class="pill"><b>الإصدار</b><span class="meta">v${version} · ${build}</span></div>
      <div class="pill"><b>القناة</b><span class="meta">App-Mode (Lightweight)</span></div>
      <div class="pill"><b>المزامنة</b><span class="meta">Supabase Realtime</span></div>
    </div>

    <div class="actions">
      <a class="btn btn-primary" href="${url}">فتح ${product} الآن</a>
      <a class="btn btn-ghost" href="${url}#/support">صفحة الدعم</a>
    </div>

    <div class="progress" aria-hidden="true"><span></span></div>
    <footer>صُنع بعناية لفريق نظام حاضر · build ${build}</footer>
  </main>
</body>
</html>
`;
}
