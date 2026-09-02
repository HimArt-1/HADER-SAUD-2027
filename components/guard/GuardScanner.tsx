import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, X, RefreshCw } from 'lucide-react';

interface GuardScannerProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  disabled?: boolean;
}

const GuardScanner: React.FC<GuardScannerProps> = ({ onScan, onClose, disabled }) => {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const onScanRef = useRef(onScan);
  const scanLockedRef = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);
  const containerId = "guard-scanner-container";

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!scannerRef.current) {
      const scanner = new Html5QrcodeScanner(
        containerId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.CODE_39
          ]
        },
        /* verbose= */ false
      );

      scanner.render(
        (decodedText) => {
          if (scanLockedRef.current || disabled) return;
          scanLockedRef.current = true;
          onScanRef.current(decodedText.trim());
          // Optional: Vibrate on success
          if (navigator.vibrate) navigator.vibrate(100);
          unlockTimerRef.current = window.setTimeout(() => { scanLockedRef.current = false; }, 1500);
        },
        (errorMessage) => {
          if (/permission|notallowed|not found|notfound/i.test(errorMessage)) {
            setError('تعذر الوصول إلى الكاميرا. تحقق من الإذن ثم أعد فتح الماسح.');
          }
        }
      );

      scannerRef.current = scanner;
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => undefined);
        scannerRef.current = null;
      }
      if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
    };
  }, [disabled]);

  return (
    <div dir="rtl" className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white font-bold text-sm">وضع مسح الباركود</span>
        </div>
        <button 
          onClick={onClose}
          className="p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-all active:scale-90"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="w-full max-w-sm aspect-square relative rounded-3xl overflow-hidden border-2 border-primary-500/50 shadow-[0_0_50px_rgb(var(--color-primary-500)_/_0.2)]">
        <div id={containerId} className="w-full h-full bg-gray-900" />
        
        {/* Scanner Overlay Grids */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary-500/30" />
          <div className="absolute left-0 right-0 top-1/2 h-px bg-primary-500/30" />
          <div className="absolute inset-0 border-[40px] border-black/40" />
          <div className="absolute inset-[40px] border border-primary-500/50 rounded-lg">
             <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary-400 rounded-tl-md" />
             <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary-400 rounded-tr-md" />
             <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary-400 rounded-bl-md" />
             <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary-400 rounded-br-md" />
             
             {/* Scanning Line Animation */}
             <div className="absolute left-0 right-0 h-1 bg-primary-400/80 shadow-[0_0_15px_rgb(var(--color-primary-400)_/_0.8)] animate-scan-line" />
          </div>
        </div>
      </div>

      <div className="mt-8 text-center px-6">
        <p className="text-gray-400 text-sm mb-2 font-medium">وجه الكاميرا نحو باركود الطالب للتوجيه السريع</p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10">
          <Camera className="w-4 h-4 text-primary-400" />
          <span className="text-xs text-gray-300 font-bold">التركيز التلقائي مفعّل</span>
        </div>
      </div>
      
      {error && (
        <div className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2 max-w-xs text-center">
          {error}
          <button onClick={() => { setError(null); onClose(); }} aria-label="إغلاق الماسح وإعادة المحاولة"><RefreshCw className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  );
};

export default GuardScanner;
