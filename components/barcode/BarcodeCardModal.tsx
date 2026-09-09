import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Loader2, ScanLine, Send, X } from 'lucide-react';
import type { Student } from '../../types';
import { barcodeCardFileName, renderBarcodeCardPng } from '../../services/barcodeCard';
import { buildBarcodeMessage } from '../../services/barcodeDelivery';
import { resolveStudentWhatsAppPhone } from '../supervision/supervisionCommunication';

// ═══════════════════════════════════════════════════════════════
// 🎫 بطاقة باركود الطالب — عرض وتحميل وإرسال لولي الأمر
// ═══════════════════════════════════════════════════════════════

export interface BarcodeCardModalProps {
  student: Student;
  schoolName?: string;
  /** Sending is hidden entirely when the viewer may not use the WhatsApp gateway. */
  canSend?: boolean;
  /** Receives the rendered card plus the (possibly edited) message. */
  onSend?: (file: File, message: string) => Promise<void>;
  onClose: () => void;
  surfaceClass?: string;
}

const DEFAULT_SURFACE =
  'border border-white/10 bg-slate-950/55 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.95)] backdrop-blur-2xl';

const BarcodeCardModal: React.FC<BarcodeCardModalProps> = ({
  student,
  schoolName,
  canSend = false,
  onSend,
  onClose,
  surfaceClass = DEFAULT_SURFACE
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState(() => buildBarcodeMessage(student));
  const blobRef = useRef<Blob | null>(null);

  const guardianPhone = resolveStudentWhatsAppPhone(student);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setIsRendering(true);
    setError(null);
    renderBarcodeCardPng(student, { schoolName })
      .then(blob => {
        if (cancelled) return;
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((renderError: unknown) => {
        if (cancelled) return;
        setError(renderError instanceof Error ? renderError.message : 'تعذر إنشاء صورة الباركود');
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [student, schoolName]);

  useEffect(() => {
    setMessage(buildBarcodeMessage(student));
  }, [student]);

  const handleDownload = useCallback(() => {
    if (!previewUrl) return;
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = barcodeCardFileName(student);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [previewUrl, student]);

  const handleSend = useCallback(async () => {
    if (!blobRef.current || !onSend) return;
    setIsSending(true);
    setError(null);
    try {
      const file = new File([blobRef.current], barcodeCardFileName(student), { type: 'image/png' });
      await onSend(file, message.trim());
      onClose();
    } catch (sendError: unknown) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر إرسال الباركود');
    } finally {
      setIsSending(false);
    }
  }, [message, onSend, onClose, student]);

  const sendDisabled = isRendering || isSending || !previewUrl || !guardianPhone || !message.trim();

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      data-testid="barcode-card-modal"
      dir="rtl"
    >
      <div className={`w-full max-w-lg max-h-[92vh] overflow-y-auto animate-fade-in-up rounded-[1.75rem] p-6 ${surfaceClass}`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ScanLine className="w-5 h-5 text-teal-400" />
              باركود الطالب
            </h3>
            <p className="text-sm text-gray-400 mt-1 truncate">{student.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            title="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 mb-4 flex items-center justify-center min-h-[220px]">
          {isRendering && (
            <span className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري تجهيز الباركود...
            </span>
          )}
          {!isRendering && previewUrl && (
            <img
              src={previewUrl}
              alt={`باركود الطالب ${student.name}`}
              data-testid="barcode-preview"
              className="max-h-[46vh] w-auto rounded-xl shadow-lg"
            />
          )}
          {!isRendering && !previewUrl && (
            <span className="text-sm text-red-300">تعذر عرض الباركود</span>
          )}
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span data-testid="barcode-error">{error}</span>
          </div>
        )}

        {canSend && (
          <div className="space-y-3 mb-4">
            <label className="block text-xs font-medium text-gray-400">نص الرسالة المرافقة</label>
            <textarea
              value={message}
              onChange={event => setMessage(event.target.value)}
              rows={4}
              data-testid="barcode-message"
              className="w-full input-glass p-3 rounded-xl text-sm leading-relaxed resize-none"
            />
            <p className="text-xs text-gray-500">
              {guardianPhone
                ? <>سيصل إلى رقم ولي الأمر <span className="font-mono text-gray-300" dir="ltr">{guardianPhone}</span></>
                : 'لا يوجد رقم واتساب صالح لولي الأمر — يمكنك تحميل الصورة وإرسالها يدوياً.'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownload}
            disabled={!previewUrl}
            data-testid="barcode-download"
            className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-200 text-sm font-bold hover:bg-white/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            تحميل الصورة
          </button>

          {canSend && (
            <button
              onClick={handleSend}
              disabled={sendDisabled}
              data-testid="barcode-send"
              className="flex-1 min-w-[170px] py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white text-sm font-bold shadow-lg shadow-emerald-600/20 hover:shadow-emerald-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              إرسال لولي الأمر
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeCardModal;
