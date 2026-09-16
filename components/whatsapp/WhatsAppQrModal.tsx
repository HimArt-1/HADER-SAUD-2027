import React, { useEffect, useState, useCallback } from 'react';
import { QrCode, RefreshCw, CheckCircle2, AlertCircle, X, Smartphone, ShieldCheck } from 'lucide-react';
import { whatsappGateway } from '../../services/whatsappGateway';
import type { WhatsAppStatus } from '../../modules/whatsapp';

interface WhatsAppQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: WhatsAppStatus | null;
  onRestartEngine?: () => void;
}

export const WhatsAppQrModal: React.FC<WhatsAppQrModalProps> = ({
  isOpen,
  onClose,
  status,
  onRestartEngine,
}) => {
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQr = useCallback(async () => {
    try {
      if (!whatsappGateway.getQrCode) return;
      const res = await whatsappGateway.getQrCode({ timeoutMs: 4_000 });
      if (res.authenticated || status?.logged_in) {
        setAuthenticated(true);
        setQrImage(null);
        setError(null);
        return;
      }
      if (res.qr) {
        setQrImage(res.qr);
        setError(null);
      }
    } catch (err: any) {
      // Don't show network errors immediately as polling will retry
      if (!qrImage) {
        setError('جاري الاتصال بخادم واتساب لجلب الرمز...');
      }
    } finally {
      setLoading(false);
    }
  }, [qrImage, status?.logged_in]);

  useEffect(() => {
    if (!isOpen) {
      setQrImage(null);
      setAuthenticated(false);
      setError(null);
      return;
    }

    setLoading(true);
    void fetchQr();

    const timer = setInterval(() => {
      void fetchQr();
    }, 2_500);

    return () => clearInterval(timer);
  }, [isOpen, fetchQr]);

  // Auto-close on successful login
  useEffect(() => {
    if (authenticated || status?.logged_in) {
      const closeTimer = setTimeout(() => {
        onClose();
      }, 1_800);
      return () => clearTimeout(closeTimer);
    }
  }, [authenticated, status?.logged_in, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-md p-6 bg-slate-900 border border-slate-700/70 rounded-2xl shadow-2xl overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          title="إغلاق"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 mb-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <QrCode className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white tracking-wide">
            ربط واتساب بنظام حاضر
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            امسح رمز QR من هاتفك لبدء إرسال الإشعارات والرسائل
          </p>
        </div>

        {/* Content Box */}
        <div className="flex flex-col items-center justify-center min-h-[260px] p-4 bg-slate-950/60 border border-slate-800 rounded-xl relative">
          {authenticated || status?.logged_in ? (
            <div className="flex flex-col items-center justify-center py-8 text-center animate-scaleUp">
              <div className="w-16 h-16 mb-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-10 h-10 animate-bounce" />
              </div>
              <h4 className="text-lg font-semibold text-emerald-300">تم تسجيل الدخول بنجاح!</h4>
              <p className="text-sm text-slate-400 mt-1">الجلسة نشطة وجاهزة للإرسال</p>
            </div>
          ) : qrImage ? (
            <div className="flex flex-col items-center">
              <div className="p-3 bg-white rounded-xl shadow-lg border border-slate-200">
                <img
                  src={qrImage}
                  alt="WhatsApp QR Code"
                  className="w-56 h-56 object-contain"
                />
              </div>
              <div className="flex items-center gap-2 mt-4 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                الرمز نشط ومحدث - جاهز للمسح
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center py-10 text-center">
              <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin mb-4" />
              <p className="text-sm font-medium text-slate-300">جاري استخراج رمز QR من واتساب...</p>
              <p className="text-xs text-slate-500 mt-1">قد يستغرق بضع ثوانٍ عند بدء تشغيل المتصفح</p>
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 text-center text-slate-400">
              <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
              <p className="text-sm font-medium text-slate-300">
                {error || 'لم يتم تجهيز الرمز بعد أو المحرك في وضع الاستعداد'}
              </p>
              {onRestartEngine && (
                <button
                  onClick={() => {
                    setLoading(true);
                    onRestartEngine();
                  }}
                  className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  إعادة تشغيل المحرك
                </button>
              )}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-5 p-3.5 bg-slate-800/50 rounded-xl border border-slate-700/40 text-xs text-slate-300 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-slate-200 mb-1">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span>خطوات الربط من هاتفك:</span>
          </div>
          <p className="text-slate-400">1. افتح تطبيق واتساب على هاتفك 📱</p>
          <p className="text-slate-400">2. الإعدادات ⚙️ ← الأجهزة المرتبطة (Linked Devices)</p>
          <p className="text-slate-400">3. اضغط "ربط جهاز" ووجّه الكاميرا نحو الرمز أعلاه</p>
        </div>

        {/* Footer info */}
        <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500 px-1">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            اتصال داخلي مشفر
          </span>
          <span>تحديث تلقائي كل 2.5 ثانية</span>
        </div>
      </div>
    </div>
  );
};
