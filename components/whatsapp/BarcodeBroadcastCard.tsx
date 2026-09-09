import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ScanLine, Users } from 'lucide-react';
import type { Student } from '../../types';
import { whatsappGateway } from '../../services/whatsappGateway';
import { renderBarcodeCardFile } from '../../services/barcodeCard';
import { resolveBarcodeAudience, sendBarcodeCards } from '../../services/barcodeDelivery';

// ═══════════════════════════════════════════════════════════════
// 🎫 إرسال الباركود لأولياء الأمور — إرسال جماعي من أداة واتساب
// ═══════════════════════════════════════════════════════════════

type ConfirmFn = (options: {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}) => Promise<boolean>;

export interface BarcodeBroadcastCardProps {
  students: readonly Student[];
  /** When the operator has picked students manually, only those receive the barcode. */
  selectedIds?: readonly string[];
  disabled?: boolean;
  confirm: ConfirmFn;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onCompleted?: () => void;
  className?: string;
}

const BarcodeBroadcastCard: React.FC<BarcodeBroadcastCardProps> = ({
  students,
  selectedIds = [],
  disabled = false,
  confirm,
  onNotify,
  onCompleted,
  className = ''
}) => {
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const targets = useMemo(() => {
    if (selectedIds.length === 0) return students;
    const wanted = new Set(selectedIds);
    return students.filter(student => wanted.has(student.id));
  }, [students, selectedIds]);

  const audience = useMemo(() => resolveBarcodeAudience(targets as Student[]), [targets]);
  const reachable = audience.recipients.length;
  const scopeLabel = selectedIds.length > 0 ? 'الطلاب المحددين' : 'جميع الطلاب';

  const handleSend = useCallback(async () => {
    if (reachable === 0) {
      onNotify('لا يوجد طلاب لديهم رقم واتساب صالح لولي الأمر', 'error');
      return;
    }

    const warnings: string[] = [];
    if (audience.missingPhone.length > 0) {
      warnings.push(`${audience.missingPhone.length} طالباً بلا رقم واتساب صالح سيتم تخطيهم`);
    }
    if (audience.inactive.length > 0) {
      warnings.push(`${audience.inactive.length} طالباً غير نشط سيتم تخطيهم`);
    }

    const confirmed = await confirm({
      title: 'إرسال الباركود لأولياء الأمور',
      message: `سيتم تجهيز باركود لكل طالب وإضافته إلى طابور واتساب.\n\n`
        + `عدد المستفيدين: ${reachable} من ${targets.length} (${scopeLabel}).`
        + (warnings.length > 0 ? `\n\n${warnings.join('\n')}` : ''),
      confirmText: `إرسال إلى ${reachable}`,
      cancelText: 'إلغاء',
      variant: 'info'
    });
    if (!confirmed) return;

    setIsSending(true);
    setProgress({ done: 0, total: reachable });
    try {
      const result = await sendBarcodeCards(targets as Student[], {
        renderFile: student => renderBarcodeCardFile(student),
        gateway: whatsappGateway,
        onProgress: (done, total) => setProgress({ done, total })
      });

      if (result.queued > 0) {
        const failedNote = result.failed.length > 0 ? ` (فشل ${result.failed.length})` : '';
        onNotify(`تمت إضافة ${result.queued} باركود إلى طابور واتساب${failedNote}`, 'success');
      } else {
        onNotify(result.failed[0]?.reason ?? 'تعذر إضافة أي باركود إلى الطابور', 'error');
      }
      onCompleted?.();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'تعذر إرسال الباركود', 'error');
    } finally {
      setIsSending(false);
      setProgress(null);
    }
  }, [audience, confirm, onCompleted, onNotify, reachable, scopeLabel, targets]);

  const percent = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div
      className={`glass-card p-6 rounded-3xl border border-white/10 relative overflow-hidden ${className}`}
      data-testid="barcode-broadcast-card"
    >
      <div className="absolute top-0 left-0 w-32 h-32 bg-teal-500/10 rounded-full blur-3xl -z-10" />

      <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
        <ScanLine className="w-5 h-5 text-teal-400" />
        باركود الطلاب
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        يُنشئ بطاقة باركود لكل طالب ويرسلها إلى ولي أمره
      </p>

      <div className="rounded-2xl bg-black/20 border border-white/5 px-4 py-3 mb-4 space-y-2 text-xs">
        <div className="flex items-center justify-between text-gray-300">
          <span className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-gray-500" />
            {scopeLabel}
          </span>
          <span className="font-bold text-teal-300" data-testid="barcode-reachable">{reachable}</span>
        </div>
        {audience.missingPhone.length > 0 && (
          <div className="flex items-center justify-between text-amber-300/80">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              بلا رقم صالح
            </span>
            <span className="font-bold">{audience.missingPhone.length}</span>
          </div>
        )}
      </div>

      {progress && (
        <div className="mb-4" data-testid="barcode-progress">
          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1.5">
            <span>جاري التجهيز والإرسال</span>
            <span className="font-mono">{progress.done}/{progress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-900/70 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => { void handleSend(); }}
        disabled={disabled || isSending || reachable === 0}
        data-testid="barcode-broadcast-send"
        className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-teal-500 to-emerald-600 text-white font-bold shadow-lg shadow-teal-600/20 hover:shadow-teal-500/30 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isSending
          ? <Loader2 className="w-5 h-5 animate-spin" />
          : reachable > 0 ? <ScanLine className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
        إرسال الباركود لأولياء الأمور
        {reachable > 0 && !isSending && (
          <span className="text-xs font-bold bg-white/20 rounded-full px-2 py-0.5">{reachable}</span>
        )}
      </button>

      {disabled && (
        <p className="text-[11px] text-gray-500 mt-2 text-center">معطّل في وضع المحاكاة</p>
      )}
    </div>
  );
};

export default BarcodeBroadcastCard;
