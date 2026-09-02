import React, { useState, useEffect, useCallback } from 'react';
import {
  Apple,
  Monitor,
  Download,
  Terminal,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Cpu,
  FileCode,
  FolderArchive,
  PlayCircle,
  RefreshCw,
  Radio,
  HelpCircle,
  Sparkles,
  Layers,
  AlertCircle,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  getWhatsAppMacZipHref,
  getWhatsAppWindowsZipHref,
  getWhatsAppLauncherZipHref,
  WHATSAPP_LAUNCHER_MAC_FILENAME,
  WHATSAPP_LAUNCHER_WINDOWS_FILENAME,
  WHATSAPP_LAUNCHER_ZIP_FILENAME
} from '../../constants/whatsappLauncher';
import { whatsappGateway } from '../../services/whatsappGateway';

interface WhatsAppPackageSectionProps {
  showToast?: (message: string, type: 'success' | 'error' | string) => void;
}

export const WhatsAppPackageSection: React.FC<WhatsAppPackageSectionProps> = ({ showToast }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isCheckingServer, setIsCheckingServer] = useState(false);
  const [serverStatus, setServerStatus] = useState<{
    online: boolean;
    running?: boolean;
    state?: string;
    state_message?: string;
    version?: string;
  } | null>(null);

  // Check WhatsApp server status on localhost:5001
  const checkServerStatus = useCallback(async () => {
    setIsCheckingServer(true);
    try {
      const res = await whatsappGateway.getStatus({ timeoutMs: 3000 });
      setServerStatus({
        online: true,
        running: res.running,
        state: res.state,
        state_message: res.state_message,
        version: res.version || 'v3.0'
      });
      if (showToast) {
        showToast('خادم الواتساب المحلي متصل ويعمل بنجاح', 'success');
      }
    } catch {
      setServerStatus({
        online: false
      });
      if (showToast) {
        showToast('الخادم المحلي غير نشط على المنفذ 5001 (يرجى تشغيل المشغل)', 'error');
      }
    } finally {
      setIsCheckingServer(false);
    }
  }, [showToast]);

  // Initial silent check on mount
  useEffect(() => {
    whatsappGateway.getStatus({ timeoutMs: 2500 })
      .then((res) => {
        setServerStatus({
          online: true,
          running: res.running,
          state: res.state,
          state_message: res.state_message,
          version: res.version || 'v3.0'
        });
      })
      .catch(() => {
        setServerStatus({ online: false });
      });
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    if (showToast) {
      showToast('تم نسخ الأمر إلى الحافظة', 'success');
    }
    setTimeout(() => {
      setCopiedKey(null);
    }, 2500);
  };

  const macFilesList = [
    { name: 'server.py', desc: 'خادم API المحلي (Flask Engine)', tag: 'خادم رئيسي' },
    { name: 'whatsapp_pro_tool.py', desc: 'محرك الأتمتة والتحكم بمتصفح Chrome', tag: 'محرك الأتمتة' },
    { name: 'sqlite_db.py', desc: 'قاعدة بيانات الطابور وسجلات الإرسال', tag: 'قاعدة البيانات' },
    { name: 'requirements.txt', desc: 'حزمة المكتبات والاعتماديات البرمجية', tag: 'المكتبات' },
    { name: 'run_mac.sh', desc: 'سكربت التشغيل والإصلاح الذاتي لماك ولينكس', tag: 'مشغل الماك' },
    { name: 'bridge.py', desc: 'جسر نقل الوسائط والأوسمة والشهادات', tag: 'جسر وسائط' },
    { name: 'contacts.csv', desc: 'ملف جهات الاتصال النموذجي', tag: 'ملف اختياري' },
    { name: 'INSTRUCTIONS.md', desc: 'دليل التشغيل وحل المشكلات الشامل', tag: 'دليل إرشادي' }
  ];

  const winFilesList = [
    { name: 'server.py', desc: 'خادم API المحلي (Flask Engine)', tag: 'خادم رئيسي' },
    { name: 'whatsapp_pro_tool.py', desc: 'محرك الأتمتة والتحكم بمتصفح Chrome', tag: 'محرك الأتمتة' },
    { name: 'sqlite_db.py', desc: 'قاعدة بيانات الطابور وسجلات الإرسال', tag: 'قاعدة البيانات' },
    { name: 'requirements.txt', desc: 'حزمة المكتبات والاعتماديات البرمجية', tag: 'المكتبات' },
    { name: 'run_windows.bat', desc: 'مشغل ويندوز التلقائي (Double-Click)', tag: 'مشغل ويندوز' },
    { name: 'bridge.py', desc: 'جسر نقل الوسائط والأوسمة والشهادات', tag: 'جسر وسائط' },
    { name: 'contacts.csv', desc: 'ملف جهات الاتصال النموذجي', tag: 'ملف اختياري' },
    { name: 'INSTRUCTIONS.md', desc: 'دليل التشغيل وحل المشكلات الشامل', tag: 'دليل إرشادي' }
  ];

  return (
    <div className="space-y-6 max-w-full">
      {/* Header Container */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 via-slate-950/70 to-slate-900/60 p-6 md:p-8 backdrop-blur-xl shadow-[0_20px_60px_-15px_rgba(16,185,129,0.15)]">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-8 -ml-8 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>الإصدار الماستر v3.0 (Master Edition)</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <h3 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
              <FolderArchive className="w-8 h-8 text-emerald-400" />
              <span>حزم تشغيل خادم أتمتة الواتساب</span>
            </h3>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              قم بتحميل حزمة التشغيل المناسبة لنظامك لتشغيل محرك أتمتة الواتساب محلياً على جهازك. تحتوي كل حزمة على خادم بايثون الكامل، وقاعدة البيانات، ومحرك الأتمتة وسكربتات التشغيل الذاتي بنقرة واحدة.
            </p>
          </div>

          {/* Server Status Monitor Card */}
          <div className="shrink-0 flex flex-col gap-2 p-4 rounded-2xl bg-black/40 border border-white/10 backdrop-blur-md min-w-[240px]">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-slate-400" />
                حالة الخادم المحلي:
              </span>
              <button
                onClick={checkServerStatus}
                disabled={isCheckingServer}
                className="p-1 rounded-lg hover:bg-white/10 text-emerald-400 transition-colors"
                title="إعادة فحص الاتصال"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingServer ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              {serverStatus?.online ? (
                <>
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] animate-pulse" />
                  <span className="text-sm font-bold text-emerald-300">متصل (Port 5001)</span>
                </>
              ) : (
                <>
                  <div className="w-3 h-3 rounded-full bg-slate-500" />
                  <span className="text-sm font-medium text-slate-400">غير متصل حالياً</span>
                </>
              )}
            </div>

            {serverStatus?.online && (
              <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-white/5">
                <span>الحالة: {serverStatus.state === 'ready' || serverStatus.state === 'authenticated' ? '✅ جاهز ومصادق' : (serverStatus.state_message || '⏳ قيد التشغيل')}</span>
                <span>{serverStatus.version}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid of Two Dedicated Packages (Mac & Windows) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 🍎 MACINTOSH / LINUX PACKAGE CARD */}
        <div className="group relative rounded-3xl border border-sky-500/25 bg-gradient-to-b from-slate-900/90 via-slate-950/80 to-slate-950 p-6 sm:p-8 backdrop-blur-xl shadow-xl hover:border-sky-400/40 transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-sky-500/15 transition-all" />

          {/* Card Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-600/30 to-blue-500/20 border border-sky-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.15)]">
                <Apple className="w-8 h-8 text-sky-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xl font-bold text-white">حزمة نظام ماك ولينكس</h4>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                    macOS Edition
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">تدعم معالجات Apple Silicon (M1/M2/M3/M4) ومعالجات Intel</p>
              </div>
            </div>
            <span className="hidden sm:inline-flex text-[11px] font-mono text-sky-300/80 bg-sky-950/60 border border-sky-800/40 px-2.5 py-1 rounded-lg">
              ZIP • 8 ملفات
            </span>
          </div>

          {/* Download Action Button */}
          <div className="mb-6">
            <a
              href={getWhatsAppMacZipHref()}
              download={WHATSAPP_LAUNCHER_MAC_FILENAME}
              className="flex w-full items-center justify-center gap-3 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-base shadow-[0_10px_30px_rgba(14,165,233,0.3)] active:scale-[0.98] transition-all"
            >
              <Download className="w-5 h-5" />
              <span>تحميل حزمة ماك (hader_whatsapp_mac.zip)</span>
            </a>
          </div>

          {/* Included Files in Package */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-sky-400" />
                محتويات الحزمة المكتملة (8 ملفات):
              </span>
              <span className="text-emerald-400 text-[11px]">مكتملة 100%</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {macFilesList.map((file) => (
                <div
                  key={file.name}
                  className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-sky-500/20 transition-all flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-xs font-bold text-sky-200 truncate">{file.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 shrink-0">
                      {file.tag}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 leading-tight">{file.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Command Execution for Mac */}
          <div className="p-4 rounded-2xl bg-black/60 border border-sky-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-sky-400" />
                أمر التشغيل المباشر من التيرمنال (Terminal):
              </span>
              <button
                onClick={() => copyToClipboard('chmod +x run_mac.sh && ./run_mac.sh', 'mac_cmd')}
                className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200 bg-sky-500/10 border border-sky-500/30 px-2 py-1 rounded-lg transition-colors"
              >
                {copiedKey === 'mac_cmd' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>تم النسخ</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ الأمر</span>
                  </>
                )}
              </button>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 font-mono text-xs text-sky-300/90 border border-white/5 overflow-x-auto text-left" dir="ltr">
              chmod +x run_mac.sh && ./run_mac.sh
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              💡 يمكنك أيضاً سحب ملف <code className="text-sky-300 font-mono">run_mac.sh</code> وإفلاته داخل التيرمنال والضغط على Enter.
            </p>
          </div>
        </div>

        {/* 🪟 WINDOWS PACKAGE CARD */}
        <div className="group relative rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-slate-900/90 via-slate-950/80 to-slate-950 p-6 sm:p-8 backdrop-blur-xl shadow-xl hover:border-emerald-400/40 transition-all duration-300">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-emerald-500/15 transition-all" />

          {/* Card Header */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600/30 to-teal-500/20 border border-emerald-400/30 flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.15)]">
                <Monitor className="w-8 h-8 text-emerald-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xl font-bold text-white">حزمة نظام ويندوز</h4>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Windows Edition
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">متوافقة مع Windows 10 و Windows 11 (64-bit)</p>
              </div>
            </div>
            <span className="hidden sm:inline-flex text-[11px] font-mono text-emerald-300/80 bg-emerald-950/60 border border-emerald-800/40 px-2.5 py-1 rounded-lg">
              ZIP • 8 ملفات
            </span>
          </div>

          {/* Download Action Button */}
          <div className="mb-6">
            <a
              href={getWhatsAppWindowsZipHref()}
              download={WHATSAPP_LAUNCHER_WINDOWS_FILENAME}
              className="flex w-full items-center justify-center gap-3 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-base shadow-[0_10px_30px_rgba(16,185,129,0.3)] active:scale-[0.98] transition-all"
            >
              <Download className="w-5 h-5" />
              <span>تحميل حزمة ويندوز (hader_whatsapp_windows.zip)</span>
            </a>
          </div>

          {/* Included Files in Package */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-emerald-400" />
                محتويات الحزمة المكتملة (8 ملفات):
              </span>
              <span className="text-emerald-400 text-[11px]">مكتملة 100%</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {winFilesList.map((file) => (
                <div
                  key={file.name}
                  className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:border-emerald-500/20 transition-all flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-xs font-bold text-emerald-200 truncate">{file.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 shrink-0">
                      {file.tag}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 leading-tight">{file.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Execution for Windows */}
          <div className="p-4 rounded-2xl bg-black/60 border border-emerald-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                طريقة التشغيل السريع (Double-Click):
              </span>
              <span className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md font-mono">
                run_windows.bat
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              1. فك ضغط المجلد في مكان مناسب (مثل سطح المكتب).<br />
              2. انقر نقراً مزدوجاً على ملف <code className="text-emerald-300 font-mono font-bold">run_windows.bat</code>.<br />
              3. سيقوم المشغل بتنظيف الجلسات، إنشاء البيئة وتثبيت المكتبات وتشغيل الخادم تلقائياً.
            </p>
          </div>
        </div>

      </div>

      {/* Prerequisites & Quick Tips Box */}
      <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 backdrop-blur-xl space-y-4">
        <h4 className="text-base font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-amber-400" />
          <span>المتطلبات الأساسية للتشغيل على كلا النظامين (Prerequisites)</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white">1. متصفح Google Chrome</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-xs text-slate-400">ضروري لفتح جلسة واتساب ويب والتحكم الآلي المستقر.</p>
            </div>
            <a
              href="https://www.google.com/chrome/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 pt-1"
            >
              <span>تحميل Chrome</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white">2. لغة Python 3.10+</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-xs text-slate-400">لتشغيل خادم الـ API (تأكد من تفعيل Add to PATH في ويندوز).</p>
            </div>
            <a
              href="https://www.python.org/downloads/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 pt-1"
            >
              <span>تحميل Python</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col justify-between space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-white">3. المنفذ المحلي 5001</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-xs text-slate-400">يقوم المشغل الذكي بتحرير المنفذ تلقائياً والتنظيف الذاتي.</p>
            </div>
            <span className="text-xs text-slate-500 pt-1">يُدار ذاتياً عبر المشغل</span>
          </div>
        </div>

        {/* Local Folder Shortcut Tip */}
        <div className="p-3.5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 leading-relaxed">
            <span className="font-bold text-white">ملاحظة للمطورين ومستخدمي النسخة المحلية:</span> المجلد <code className="text-emerald-300 font-mono px-1 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/40">whatsapp/</code> في مشروعك يحتوي بالفعل على كل هذه الملفات جاهزة ويمكنك تشغيلها مباشرة دون فك ضغط.
          </div>
        </div>
      </div>
    </div>
  );
};
