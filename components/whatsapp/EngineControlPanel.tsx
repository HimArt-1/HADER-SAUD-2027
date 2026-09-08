import React, { useMemo } from 'react';
import {
  Play, Square, Send, Pause, AppWindow, RotateCcw, Loader2, QrCode,
  CheckCircle2, AlertTriangle, Repeat, Power, Radio, Inbox, Sparkles
} from 'lucide-react';
import type { WhatsAppCommand, WhatsAppEngineState, WhatsAppStatus } from '../../modules/whatsapp';
import { isEngineAlive, normalizeEngineState } from '../../modules/whatsapp';

// ═══════════════════════════════════════════════════════════════
// 🧭 Engine Control Panel — بطاقة "التحكم بالنظام"
//
//  1) تشغيل المحرك   → يفتح واتساب ويب في نافذة منبثقة وينتظر تسجيل الدخول
//  2) إبدأ الإرسال   → يُظهر آخر نافذة واتساب ويب ويبدأ إرسال الطابور
//  + إيقاف مؤقت / استكمال / إيقاف الإرسال / إيقاف اضطراري
// ═══════════════════════════════════════════════════════════════

export type EngineTone = 'idle' | 'busy' | 'ready' | 'sending' | 'paused' | 'error';

export type EngineStateMeta = Readonly<{
  state: WhatsAppEngineState;
  label: string;
  tone: EngineTone;
}>;

const STATE_META: Record<WhatsAppEngineState, Omit<EngineStateMeta, 'state'>> = {
  idle: { label: 'المحرك متوقف', tone: 'idle' },
  initializing: { label: 'جاري تهيئة المتصفح', tone: 'busy' },
  waiting_login: { label: 'بانتظار مسح رمز QR', tone: 'busy' },
  ready: { label: 'جاهز للإرسال', tone: 'ready' },
  sending: { label: 'جاري الإرسال', tone: 'sending' },
  paused: { label: 'متوقف مؤقتاً', tone: 'paused' },
  error: { label: 'خطأ في المحرك', tone: 'error' },
  stopped: { label: 'تم إيقاف المحرك', tone: 'idle' }
};

const TONE_STYLES: Record<EngineTone, { dot: string; pill: string; ping: boolean }> = {
  idle: { dot: 'bg-gray-500', pill: 'bg-gray-800/70 border-gray-700 text-gray-300', ping: false },
  busy: { dot: 'bg-amber-400', pill: 'bg-amber-500/10 border-amber-500/30 text-amber-300', ping: true },
  ready: { dot: 'bg-emerald-400', pill: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', ping: false },
  sending: { dot: 'bg-cyan-400', pill: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300', ping: true },
  paused: { dot: 'bg-orange-400', pill: 'bg-orange-500/10 border-orange-500/30 text-orange-300', ping: false },
  error: { dot: 'bg-red-500', pill: 'bg-red-500/10 border-red-500/30 text-red-300', ping: false }
};

export const describeEngineState = (status: WhatsAppStatus | null | undefined): EngineStateMeta => {
  const state = normalizeEngineState(status?.state);
  return { state, ...STATE_META[state] };
};

export interface EngineControlPanelProps {
  status: WhatsAppStatus | null;
  /** Local bridge reachable (connection monitor). */
  serverOnline: boolean;
  /** Pending messages known to the dashboard (fallback when the bridge omits `pending`). */
  pendingCount: number;
  /** A control request is in flight. */
  busy?: boolean;
  /** Simulation mode disables all engine controls. */
  simulation?: boolean;
  /** Keep the mission alive to pick up new queue items automatically. */
  continuous: boolean;
  onContinuousChange: (value: boolean) => void;
  onCommand: (command: WhatsAppCommand) => void;
  onResetCounters: () => void;
  className?: string;
}

const EngineControlPanel: React.FC<EngineControlPanelProps> = ({
  status,
  serverOnline,
  pendingCount,
  busy = false,
  simulation = false,
  continuous,
  onContinuousChange,
  onCommand,
  onResetCounters,
  className = ''
}) => {
  const meta = describeEngineState(status);
  const tone = TONE_STYLES[meta.tone];
  const alive = isEngineAlive(status);
  const loggedIn = Boolean(status?.logged_in);
  const sending = meta.state === 'sending';
  const paused = meta.state === 'paused';
  const dispatching = sending || paused;
  const pending = status?.pending ?? pendingCount;
  const progress = status?.progress;
  const locked = busy || simulation;

  const canStartEngine = serverOnline && !alive && !locked;
  const canFocus = alive && meta.state !== 'initializing' && !locked;
  const canStartSending = alive && loggedIn && !dispatching && !locked && (pending > 0 || continuous);
  const canStop = alive && !locked;

  const steps = useMemo(() => ([
    {
      key: 'engine',
      label: 'تشغيل المحرك',
      icon: Power,
      done: alive && meta.state !== 'initializing',
      active: meta.state === 'initializing'
    },
    {
      key: 'login',
      label: 'مسح رمز QR',
      icon: QrCode,
      done: loggedIn,
      active: meta.state === 'waiting_login'
    },
    {
      key: 'send',
      label: 'إبدأ الإرسال',
      icon: Send,
      done: meta.state === 'ready' && Boolean(progress && progress.total > 0 && progress.current >= progress.total),
      active: dispatching
    }
  ]), [alive, loggedIn, meta.state, dispatching, progress]);

  const sendingHint = (() => {
    if (simulation) return 'وضع المحاكاة مفعّل — أزرار المحرك معطلة';
    if (!serverOnline && !alive) return 'الخادم المحلي غير متصل — شغّل server.py أولاً';
    if (!alive) return 'اضغط "تشغيل المحرك" لفتح واتساب ويب في نافذة منبثقة';
    if (meta.state === 'initializing') return 'يتم الآن فتح Google Chrome...';
    if (!loggedIn) return 'افتح نافذة واتساب ويب وامسح رمز QR من جوالك';
    if (dispatching) return 'يتم إرسال الرسائل من آخر نافذة واتساب مفتوحة';
    if (pending === 0 && !continuous) return 'الطابور فارغ — أضف رسائل ثم اضغط "إبدأ الإرسال"';
    return `جاهز لإرسال ${pending} رسالة عند الضغط على "إبدأ الإرسال"`;
  })();

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <div
      className={`glass-card p-6 rounded-3xl border border-white/10 relative overflow-hidden ${className}`}
      data-testid="engine-control-panel"
      data-engine-state={meta.state}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 left-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl -z-10" />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-xl font-bold text-white">التحكم بالنظام</h3>
          <p className="text-xs text-gray-500 mt-1">محرك واتساب ويب — نافذة منبثقة مستقلة</p>
        </div>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold ${tone.pill}`}
          data-testid="engine-state-pill"
          title={status?.state_message}
        >
          <span className="relative flex h-2.5 w-2.5">
            {tone.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${tone.dot} opacity-75`} />}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tone.dot}`} />
          </span>
          {meta.label}
        </div>
      </div>

      {/* Stepper */}
      <ol className="grid grid-cols-3 gap-2 mb-4" aria-label="خطوات التشغيل">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const classes = step.done
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : step.active
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 animate-pulse'
              : 'border-white/5 bg-black/20 text-gray-500';
          return (
            <li key={step.key} className={`rounded-2xl border px-2 py-2.5 flex flex-col items-center gap-1 text-center transition-all ${classes}`}>
              <span className="text-[10px] font-mono opacity-70">{index + 1}</span>
              {step.done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
              <span className="text-[11px] font-bold leading-tight">{step.label}</span>
            </li>
          );
        })}
      </ol>

      {/* Status message */}
      <div className="rounded-2xl bg-black/25 border border-white/5 px-4 py-3 mb-4">
        <div className="flex items-start gap-2 text-xs text-gray-300 leading-relaxed">
          {meta.tone === 'error'
            ? <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            : meta.tone === 'ready'
              ? <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              : <Radio className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />}
          <span data-testid="engine-state-message">{status?.state_message || sendingHint}</span>
        </div>
        {status?.state_message && status.state_message !== sendingHint && (
          <div className="text-[11px] text-gray-500 mt-2 pr-6">{sendingHint}</div>
        )}
      </div>

      {/* Progress */}
      {dispatching && progress && (
        <div className="mb-4" data-testid="engine-progress">
          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1.5">
            <span className="font-bold text-cyan-300">
              {progress.current}/{progress.total || pending}
            </span>
            <span className="truncate max-w-[60%]" dir="auto">
              {progress.lastName || progress.lastPhone || ''}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-900/70 overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-500 ${paused ? '' : 'animate-progress-pulse'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-center text-[10px]">
            <span className="rounded-lg bg-emerald-500/10 text-emerald-300 py-1">نجحت {progress.sent}</span>
            <span className="rounded-lg bg-red-500/10 text-red-300 py-1">فشلت {progress.failed}</span>
            <span className="rounded-lg bg-gray-500/10 text-gray-300 py-1">تخطي {progress.skipped}</span>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="space-y-3">
        {!alive ? (
          <button
            type="button"
            data-testid="engine-start"
            onClick={() => onCommand('start')}
            disabled={!canStartEngine}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
            تشغيل المحرك
          </button>
        ) : (
          <button
            type="button"
            data-testid="engine-focus"
            onClick={() => onCommand('window:focus')}
            disabled={!canFocus}
            className="w-full py-3 rounded-2xl bg-slate-800/80 border border-slate-700 text-gray-200 font-bold hover:bg-slate-700 hover:border-slate-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            <AppWindow className="w-5 h-5 text-sky-400" />
            فتح نافذة واتساب ويب
          </button>
        )}

        {alive && !dispatching && (
          <button
            type="button"
            data-testid="sending-start"
            onClick={() => onCommand({ type: 'sending:start', options: { continuous } })}
            disabled={!canStartSending}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black text-lg shadow-lg shadow-cyan-600/20 hover:shadow-cyan-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            إبدأ الإرسال
            {pending > 0 && (
              <span className="text-xs font-bold bg-white/20 rounded-full px-2 py-0.5">{pending}</span>
            )}
            {pending === 0 && loggedIn && !continuous && <Inbox className="w-4 h-4 opacity-70" />}
          </button>
        )}

        {alive && dispatching && (
          <div className="grid grid-cols-2 gap-3">
            {sending ? (
              <button
                type="button"
                data-testid="sending-pause"
                onClick={() => onCommand('sending:pause')}
                disabled={locked}
                className="py-3 rounded-2xl bg-orange-500/15 border border-orange-500/40 text-orange-200 font-bold hover:bg-orange-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Pause className="w-4 h-4 fill-current" /> إيقاف مؤقت
              </button>
            ) : (
              <button
                type="button"
                data-testid="sending-resume"
                onClick={() => onCommand('sending:resume')}
                disabled={locked}
                className="py-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 font-bold hover:bg-emerald-500/25 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" /> استكمال الإرسال
              </button>
            )}
            <button
              type="button"
              data-testid="sending-stop"
              onClick={() => onCommand('sending:stop')}
              disabled={locked}
              className="py-3 rounded-2xl bg-slate-800/80 border border-slate-700 text-gray-200 font-bold hover:bg-slate-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Square className="w-4 h-4 fill-current" /> إيقاف الإرسال
            </button>
          </div>
        )}

        <button
          type="button"
          data-testid="engine-stop"
          onClick={() => onCommand('stop')}
          disabled={!canStop}
          className="w-full py-3 rounded-2xl bg-red-500/10 text-red-400 border border-red-500/30 font-bold hover:bg-red-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          <Power className="w-5 h-5" /> إيقاف اضطراري
        </button>

        {/* Continuous mode toggle */}
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 border border-white/5 px-4 py-3 cursor-pointer">
          <span className="flex items-center gap-2 text-xs text-gray-300">
            <Repeat className="w-4 h-4 text-purple-400" />
            متابعة الرسائل الجديدة تلقائياً
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={continuous}
            data-testid="continuous-toggle"
            onClick={() => onContinuousChange(!continuous)}
            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${continuous ? 'bg-purple-600' : 'bg-gray-600'}`}
          >
            <span className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${continuous ? 'left-1' : 'right-1'}`} />
          </button>
        </label>

        <button
          type="button"
          onClick={onResetCounters}
          className="w-full py-2 text-sm text-gray-400 hover:text-white flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" /> تصفير العدادات
        </button>
      </div>
    </div>
  );
};

export default EngineControlPanel;
