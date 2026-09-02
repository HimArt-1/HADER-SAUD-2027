import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor, Clock, Palette, Check, Settings as SettingsIcon,
  Maximize2, ImageIcon, X, Upload, Camera, FileText, Plus,
  Type, Megaphone, CheckCircle, Trash2, RefreshCw, ArrowRight,
  AlertTriangle, Zap, Users, ArrowUp, ArrowDown
} from 'lucide-react';
import { KioskSettings, ATTENDANCE_DEFAULTS } from '../../types';
import { appSettings } from '../../services/settings';
import { logError } from '../../types/errors';
import { useToast } from '../Toast';

export interface AdminKioskTabProps {
  kiosk_settings: KioskSettings;
  setKioskSettings: React.Dispatch<React.SetStateAction<KioskSettings>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  fetchKioskSettings: () => Promise<void>;
}

const AdminKioskTab: React.FC<AdminKioskTabProps> = ({
  kiosk_settings,
  setKioskSettings,
  loading,
  setLoading,
  fetchKioskSettings,
}) => {
  const toast = useToast();



  // --- Handlers ---
  const handleImageUpload = async (type: 'header' | 'screensaver' | 'announcement', file: File) => {
    const MAX_SIZE = 2 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast.error('حجم الصورة كبير جداً. الحد الأقصى 2MB.');
      return;
    }
    try {
      const compressed = await compressImage(file, 1280, 0.7);
      if (type === 'header') {
        setKioskSettings({ ...kiosk_settings, header_image: compressed });
      } else if (type === 'screensaver') {
        setKioskSettings({
          ...kiosk_settings,
          screensaver_images: [...(kiosk_settings.screensaver_images || []), compressed]
        });
      } else if (type === 'announcement') {
        setKioskSettings({
          ...kiosk_settings,
          announcements_images: [...(kiosk_settings.announcements_images || []), compressed]
        });
      }
      toast.success('تم رفع الصورة بنجاح ✓');
    } catch (e) {
      logError(e, 'Admin - Image Upload');
      toast.error('فشل في رفع الصورة');
    }
  };

  const compressImage = (file: File, maxWidth: number, quality: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxHeight = 720;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas context not available')); return; }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    const newImages = [...(kiosk_settings.screensaver_images || [])];
    newImages.splice(index, 1);
    setKioskSettings({ ...kiosk_settings, screensaver_images: newImages });
  };

  // Core save logic (used by both direct save and post-recalc save)
  const doSaveKioskSettings = useCallback(async () => {
    setLoading(true);
    try {
      await appSettings.execute({
        type: 'patch',
        changes: {
          kiosk_settings,
          school_name: kiosk_settings.school_name,
          principal_name: kiosk_settings.principal_name,
          assembly_time: kiosk_settings.assembly_time,
          grace_period: kiosk_settings.grace_period
        }
      });
      await fetchKioskSettings();
      toast.success('تم حفظ إعدادات الكشك بنجاح ✓');
    } catch (e: any) {
      logError(e, 'Admin - Operation');
      if (e?.name === 'QuotaExceededError' || e?.message?.includes('quota')) {
        toast.error('مساحة التخزين ممتلئة. يرجى حذف بعض الصور أو تقليل حجمها.');
      } else {
        toast.error('حدث خطأ أثناء الحفظ. يرجى المحاولة مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  }, [kiosk_settings, fetchKioskSettings, setLoading, toast]);



  return (
    <>
      <div className="space-y-6 animate-fade-in">
        <div className="glass-card p-8 rounded-3xl border border-white/10">
          <h2 className="text-3xl font-bold font-serif text-white mb-6 flex items-center gap-3">
            <Monitor className="w-8 h-8 text-primary-400" />
            إعدادات كشك الحضور
          </h2>



          {/* Theme Selection - اختيار نمط الكشك */}
          <div className="mb-8 p-6 bg-gradient-to-br from-secondary-500/10 to-secondary-500/10 rounded-2xl border border-secondary-500/20">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Palette className="w-5 h-5 text-secondary-400" />
              نمط شاشة الكشك
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Dark Neon */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'dark-neon' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'dark-neon'
                  ? 'border-primary-400 ring-2 ring-primary-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 mb-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,255,0.15),transparent_70%)]" />
                  <div className="absolute bottom-2 right-2 w-8 h-1 bg-primary-400 rounded-full shadow-[0_0_10px_rgb(var(--color-primary-400)_/_0.8)]" />
                  <div className="absolute top-2 left-2 w-4 h-4 rounded bg-primary-400/20 border border-primary-400/50" />
                </div>
                <p className="text-white text-sm font-bold">داكن نيون</p>
                <p className="text-gray-500 text-xs">Dark Neon</p>
                {kiosk_settings.theme === 'dark-neon' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-primary-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-black" />
                  </div>
                )}
              </button>

              {/* Dark Gradient */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'dark-gradient' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'dark-gradient'
                  ? 'border-secondary-400 ring-2 ring-secondary-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-secondary-900 via-secondary-900 to-fuchsia-900 mb-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--color-secondary-500)_/_0.3),transparent_50%)]" />
                </div>
                <p className="text-white text-sm font-bold">داكن متدرج</p>
                <p className="text-gray-500 text-xs">Dark Gradient</p>
                {kiosk_settings.theme === 'dark-gradient' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-secondary-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-black" />
                  </div>
                )}
              </button>

              {/* Light Clean */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'light-clean' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'light-clean'
                  ? 'border-secondary-400 ring-2 ring-secondary-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-gray-100 to-white mb-2 relative overflow-hidden border border-gray-200">
                  <div className="absolute bottom-2 right-2 w-8 h-1 bg-secondary-500 rounded-full" />
                  <div className="absolute top-2 left-2 w-4 h-4 rounded bg-secondary-100 border border-secondary-200" />
                </div>
                <p className="text-white text-sm font-bold">فاتح نظيف</p>
                <p className="text-gray-500 text-xs">Light Clean</p>
                {kiosk_settings.theme === 'light-clean' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-secondary-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>

              {/* Light Soft */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'light-soft' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'light-soft'
                  ? 'border-rose-400 ring-2 ring-rose-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-rose-50 via-amber-50 to-sky-50 mb-2 relative overflow-hidden border border-rose-100">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(251,207,232,0.5),transparent_50%)]" />
                </div>
                <p className="text-white text-sm font-bold">فاتح ناعم</p>
                <p className="text-gray-500 text-xs">Light Soft</p>
                {kiosk_settings.theme === 'light-soft' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-rose-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>

              {/* Ocean Blue */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'ocean-blue' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'ocean-blue'
                  ? 'border-sky-400 ring-2 ring-sky-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-sky-600 via-secondary-700 to-indigo-800 mb-2 relative overflow-hidden">
                  <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-sky-400/30 to-transparent" />
                  <div className="absolute top-3 left-3 w-3 h-3 rounded-full bg-white/30" />
                </div>
                <p className="text-white text-sm font-bold">أزرق محيطي</p>
                <p className="text-gray-500 text-xs">Ocean Blue</p>
                {kiosk_settings.theme === 'ocean-blue' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-sky-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>

              {/* Sunset Warm */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'sunset-warm' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'sunset-warm'
                  ? 'border-orange-400 ring-2 ring-orange-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-orange-500 via-rose-500 to-secondary-600 mb-2 relative overflow-hidden">
                  <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-yellow-400/20 to-transparent" />
                </div>
                <p className="text-white text-sm font-bold">غروب دافئ</p>
                <p className="text-gray-500 text-xs">Sunset Warm</p>
                {kiosk_settings.theme === 'sunset-warm' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-orange-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>

              {/* Forest Green */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'forest-green' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'forest-green'
                  ? 'border-emerald-400 ring-2 ring-emerald-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-emerald-700 via-green-800 to-teal-900 mb-2 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_70%,rgba(52,211,153,0.2),transparent_50%)]" />
                </div>
                <p className="text-white text-sm font-bold">أخضر طبيعي</p>
                <p className="text-gray-500 text-xs">Forest Green</p>
                {kiosk_settings.theme === 'forest-green' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-emerald-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>

              {/* Royal Purple */}
              <button
                onClick={() => setKioskSettings({ ...kiosk_settings, theme: 'royal-purple' })}
                className={`relative p-4 rounded-2xl border-2 transition-all hover:scale-105 ${kiosk_settings.theme === 'royal-purple'
                  ? 'border-fuchsia-400 ring-2 ring-fuchsia-400/30'
                  : 'border-white/10 hover:border-white/30'
                  }`}
              >
                <div className="h-20 rounded-xl bg-gradient-to-br from-secondary-800 via-fuchsia-800 to-secondary-800 mb-2 relative overflow-hidden">
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-yellow-300 shadow-[0_0_8px_yellow]" />
                  <div className="absolute bottom-2 left-4 w-6 h-0.5 bg-fuchsia-300/50 rounded" />
                </div>
                <p className="text-white text-sm font-bold">بنفسجي ملكي</p>
                <p className="text-gray-500 text-xs">Royal Purple</p>
                {kiosk_settings.theme === 'royal-purple' && (
                  <div className="absolute top-2 left-2 w-5 h-5 bg-fuchsia-400 rounded-full flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-4 text-center">اختر النمط المناسب لشاشة الكشك • يتم تطبيقه فوراً عند الحفظ</p>
          </div>

          {/* Basic Settings */}
          <div className="space-y-6 mb-8 p-6 bg-white/5 rounded-2xl border border-white/10">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-gray-400" />
              الإعدادات الأساسية
            </h3>
            <div>
              <label className="block text-gray-300 mb-2 font-medium">العنوان الرئيسي</label>
              <input type="text" className="w-full input-glass p-3 rounded-xl" value={kiosk_settings.main_title} onChange={e => setKioskSettings({ ...kiosk_settings, main_title: e.target.value })} placeholder="مثال: مرحباً في نظام الحضور الذكي" />
            </div>
            <div>
              <label className="block text-gray-300 mb-2 font-medium">العنوان الفرعي</label>
              <input type="text" className="w-full input-glass p-3 rounded-xl" value={kiosk_settings.sub_title} onChange={e => setKioskSettings({ ...kiosk_settings, sub_title: e.target.value })} placeholder="مثال: لطفاً انتظر التعليمات" />
            </div>
            {/* Motivational Message Banks */}
            <div className="pt-4 border-t border-white/10">
              <h4 className="text-lg font-bold text-white mb-4">بنك الرسائل التحفيزية</h4>
              <p className="text-xs text-gray-400 mb-6">أضف عدة رسائل ليتم اختيار واحدة منها عشوائياً عند تسجيل حضور الطالب.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Early Messages Bank */}
                <div className="p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/20">
                  <label className="block text-emerald-400 mb-3 font-medium flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    رسائل الحضور المبكر ({kiosk_settings.early_messages?.length || 0})
                  </label>
                  <div className="space-y-2 mb-4 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                    {kiosk_settings.early_messages?.map((msg, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-3 bg-black/20 rounded-xl border border-white/5 group">
                        <span className="text-emerald-400/50 font-mono text-xs mt-0.5">{idx + 1}.</span>
                        <span className="flex-1 text-gray-200 text-sm leading-relaxed">{msg}</span>
                        <button
                          onClick={() => {
                            const newMsgs = [...(kiosk_settings.early_messages || [])];
                            newMsgs.splice(idx, 1);
                            setKioskSettings({ ...kiosk_settings, early_messages: newMsgs });
                          }}
                          className="p-1 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {(!kiosk_settings.early_messages || kiosk_settings.early_messages.length === 0) && (
                      <div className="text-center p-4 text-gray-500 text-sm border border-dashed border-white/10 rounded-xl">
                        لا توجد رسائل. سيتم استخدام النص الافتراضي أو الرسالة الثابتة.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="newEarlyMsg"
                      className="flex-1 input-glass p-3 rounded-xl text-sm"
                      placeholder="أضف رسالة مبكر جديدة..."
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          const input = e.target as HTMLInputElement;
                          if (input.value.trim()) {
                            setKioskSettings({
                              ...kiosk_settings,
                              early_messages: [...(kiosk_settings.early_messages || []), input.value.trim()]
                            });
                            input.value = '';
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById('newEarlyMsg') as HTMLInputElement;
                        if (input?.value.trim()) {
                          setKioskSettings({
                            ...kiosk_settings,
                            early_messages: [...(kiosk_settings.early_messages || []), input.value.trim()]
                          });
                          input.value = '';
                        }
                      }}
                      className="px-4 py-2 bg-emerald-600/80 hover:bg-emerald-500 rounded-xl text-white font-bold transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  {/* Fallback old setting if needed */}
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <label className="block text-gray-400 mb-2 text-xs font-medium">الرسالة الثابتة (احتياطي)</label>
                    <input type="text" className="w-full input-glass p-2 rounded-xl text-sm" value={kiosk_settings.early_message || ''} onChange={e => setKioskSettings({ ...kiosk_settings, early_message: e.target.value })} placeholder="مثال: بطل، حضورك مبكر!" />
                  </div>
                </div>

                {/* Late Messages Bank */}
                <div className="p-4 bg-rose-500/5 rounded-2xl border border-rose-500/20">
                  <label className="block text-rose-400 mb-3 font-medium flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    رسائل التأخير ({kiosk_settings.late_messages?.length || 0})
                  </label>
                  <div className="space-y-2 mb-4 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                    {kiosk_settings.late_messages?.map((msg, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-3 bg-black/20 rounded-xl border border-white/5 group">
                        <span className="text-rose-400/50 font-mono text-xs mt-0.5">{idx + 1}.</span>
                        <span className="flex-1 text-gray-200 text-sm leading-relaxed">{msg}</span>
                        <button
                          onClick={() => {
                            const newMsgs = [...(kiosk_settings.late_messages || [])];
                            newMsgs.splice(idx, 1);
                            setKioskSettings({ ...kiosk_settings, late_messages: newMsgs });
                          }}
                          className="p-1 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {(!kiosk_settings.late_messages || kiosk_settings.late_messages.length === 0) && (
                      <div className="text-center p-4 text-gray-500 text-sm border border-dashed border-white/10 rounded-xl">
                        لا توجد رسائل. سيتم استخدام النص الافتراضي أو الرسالة الثابتة.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="newLateMsg"
                      className="flex-1 input-glass p-3 rounded-xl text-sm"
                      placeholder="أضف رسالة تأخير جديدة..."
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          const input = e.target as HTMLInputElement;
                          if (input.value.trim()) {
                            setKioskSettings({
                              ...kiosk_settings,
                              late_messages: [...(kiosk_settings.late_messages || []), input.value.trim()]
                            });
                            input.value = '';
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById('newLateMsg') as HTMLInputElement;
                        if (input?.value.trim()) {
                          setKioskSettings({
                            ...kiosk_settings,
                            late_messages: [...(kiosk_settings.late_messages || []), input.value.trim()]
                          });
                          input.value = '';
                        }
                      }}
                      className="px-4 py-2 bg-rose-600/80 hover:bg-rose-500 rounded-xl text-white font-bold transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  {/* Fallback old setting if needed */}
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <label className="block text-gray-400 mb-2 text-xs font-medium">الرسالة الثابتة (احتياطي)</label>
                    <input type="text" className="w-full input-glass p-2 rounded-xl text-sm" value={kiosk_settings.late_message || ''} onChange={e => setKioskSettings({ ...kiosk_settings, late_message: e.target.value })} placeholder="مثال: نأمل الالتزام بالوقت مستقبلاً" />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={kiosk_settings.show_stats} onChange={e => setKioskSettings({ ...kiosk_settings, show_stats: e.target.checked })} className="w-5 h-5 rounded" />
              <label className="text-gray-300 font-medium">عرض الإحصائيات</label>
            </div>

            {/* School info visibility */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-black/20 border border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">اسم المدرسة</p>
                    <p className="text-xs text-gray-400">إظهار اسم المدرسة أعلى شاشة الكشك</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={kiosk_settings.show_school_name !== false}
                    onChange={e => setKioskSettings({ ...kiosk_settings, show_school_name: e.target.checked })}
                    className="w-5 h-5 rounded cursor-pointer"
                  />
                </div>
                {kiosk_settings.show_school_name !== false && (
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="مثال: ثانوية الأمير محمد بن فهد"
                    value={kiosk_settings.school_name || ''}
                    onChange={e => setKioskSettings({ ...kiosk_settings, school_name: e.target.value })}
                  />
                )}
              </div>

              <div className="p-4 rounded-2xl bg-black/20 border border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">اسم المدير</p>
                    <p className="text-xs text-gray-400">تحكم في ظهور اسم مدير المدرسة</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={kiosk_settings.show_principal_name !== false}
                    onChange={e => setKioskSettings({ ...kiosk_settings, show_principal_name: e.target.checked })}
                    className="w-5 h-5 rounded cursor-pointer"
                  />
                </div>
                {kiosk_settings.show_principal_name !== false && (
                  <input
                    type="text"
                    className="w-full input-glass p-3 rounded-xl text-sm"
                    placeholder="مثال: أ. عبدالله محمد القحطاني"
                    value={kiosk_settings.principal_name || ''}
                    onChange={e => setKioskSettings({ ...kiosk_settings, principal_name: e.target.value })}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Display Size Settings */}
          <div className="mb-8 p-6 bg-gradient-to-br from-secondary-500/10 to-primary-500/10 rounded-2xl border border-secondary-500/20">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Maximize2 className="w-5 h-5 text-secondary-400" />
              أحجام العرض
            </h3>
            <p className="text-xs text-gray-400 mb-4">تحكم في حجم العناصر المختلفة في شاشة الكشك</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Clock Size */}
              <div>
                <label className="block text-gray-300 mb-2 font-medium text-sm">حجم الساعة</label>
                <select
                  className="w-full input-glass p-3 rounded-xl"
                  value={kiosk_settings.display_settings?.clock_size || 'lg'}
                  onChange={e => setKioskSettings({
                    ...kiosk_settings,
                    display_settings: {
                      ...kiosk_settings.display_settings,
                      clock_size: e.target.value as any,
                      title_size: kiosk_settings.display_settings?.title_size || 'lg',
                      card_size: kiosk_settings.display_settings?.card_size || 'md',
                      input_size: kiosk_settings.display_settings?.input_size || 'lg'
                    }
                  })}
                >
                  <option value="sm">صغير</option>
                  <option value="md">متوسط</option>
                  <option value="lg">كبير</option>
                </select>
              </div>

              {/* Title Size */}
              <div>
                <label className="block text-gray-300 mb-2 font-medium text-sm">حجم العناوين</label>
                <select
                  className="w-full input-glass p-3 rounded-xl"
                  value={kiosk_settings.display_settings?.title_size || 'lg'}
                  onChange={e => setKioskSettings({
                    ...kiosk_settings,
                    display_settings: {
                      ...kiosk_settings.display_settings,
                      clock_size: kiosk_settings.display_settings?.clock_size || 'lg',
                      title_size: e.target.value as any,
                      card_size: kiosk_settings.display_settings?.card_size || 'md',
                      input_size: kiosk_settings.display_settings?.input_size || 'lg'
                    }
                  })}
                >
                  <option value="sm">صغير</option>
                  <option value="md">متوسط</option>
                  <option value="lg">كبير</option>
                </select>
              </div>

              {/* Card Size */}
              <div>
                <label className="block text-gray-300 mb-2 font-medium text-sm">حجم البطاقات</label>
                <select
                  className="w-full input-glass p-3 rounded-xl"
                  value={kiosk_settings.display_settings?.card_size || 'md'}
                  onChange={e => setKioskSettings({
                    ...kiosk_settings,
                    display_settings: {
                      ...kiosk_settings.display_settings,
                      clock_size: kiosk_settings.display_settings?.clock_size || 'lg',
                      title_size: kiosk_settings.display_settings?.title_size || 'lg',
                      card_size: e.target.value as any,
                      input_size: kiosk_settings.display_settings?.input_size || 'lg'
                    }
                  })}
                >
                  <option value="sm">صغير</option>
                  <option value="md">متوسط</option>
                  <option value="lg">كبير</option>
                </select>
              </div>

              {/* Input Size */}
              <div>
                <label className="block text-gray-300 mb-2 font-medium text-sm">حجم حقل الإدخال</label>
                <select
                  className="w-full input-glass p-3 rounded-xl"
                  value={kiosk_settings.display_settings?.input_size || 'lg'}
                  onChange={e => setKioskSettings({
                    ...kiosk_settings,
                    display_settings: {
                      ...kiosk_settings.display_settings,
                      clock_size: kiosk_settings.display_settings?.clock_size || 'lg',
                      title_size: kiosk_settings.display_settings?.title_size || 'lg',
                      card_size: kiosk_settings.display_settings?.card_size || 'md',
                      input_size: e.target.value as any
                    }
                  })}
                >
                  <option value="sm">صغير</option>
                  <option value="md">متوسط</option>
                  <option value="lg">كبير</option>
                </select>
              </div>
            </div>

            {/* Size Preview */}
            <div className="mt-4 p-4 bg-black/30 rounded-xl border border-white/10">
              <p className="text-xs text-gray-500 mb-2 text-center">معاينة الأحجام:</p>
              <div className="flex items-center justify-center gap-4">
                <div className="text-center">
                  <div className={`font-mono font-bold mb-1 ${kiosk_settings.display_settings?.clock_size === 'sm' ? 'text-lg' :
                    kiosk_settings.display_settings?.clock_size === 'md' ? 'text-2xl' : 'text-3xl'
                    } text-emerald-400`}>
                    ٠٧:٣٠
                  </div>
                  <span className="text-xs text-gray-500">الساعة</span>
                </div>
                <div className="text-center">
                  <div className={`font-bold mb-1 ${kiosk_settings.display_settings?.title_size === 'sm' ? 'text-sm' :
                    kiosk_settings.display_settings?.title_size === 'md' ? 'text-lg' : 'text-xl'
                    } text-white`}>
                    عنوان
                  </div>
                  <span className="text-xs text-gray-500">العنوان</span>
                </div>
              </div>
            </div>
          </div>

          {/* Camera Scan Settings */}
          <div className="mb-8 p-6 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-2xl border border-emerald-500/20">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Camera className="w-5 h-5 text-emerald-400" />
              مسح الباركود بالكاميرا
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-black/20 border border-white/10">
                <div>
                  <p className="text-sm font-semibold text-white">تفعيل المسح بالكاميرا</p>
                  <p className="text-xs text-gray-400">يظهر زر المسح بالكاميرا داخل واجهة الكشك</p>
                </div>
                <input
                  type="checkbox"
                  checked={kiosk_settings.camera_scan_enabled || false}
                  onChange={e => setKioskSettings({ ...kiosk_settings, camera_scan_enabled: e.target.checked })}
                  className="w-5 h-5 rounded cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-black/20 border border-white/10">
                <div>
                  <p className="text-sm font-semibold text-white">فتح الكاميرا تلقائياً</p>
                  <p className="text-xs text-gray-400">يفتح نافذة المسح تلقائياً عند تشغيل الكشك</p>
                </div>
                <input
                  type="checkbox"
                  checked={kiosk_settings.camera_scan_auto_open || false}
                  onChange={e => setKioskSettings({ ...kiosk_settings, camera_scan_auto_open: e.target.checked })}
                  className="w-5 h-5 rounded cursor-pointer"
                  disabled={!kiosk_settings.camera_scan_enabled}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                يعتمد المسح على دعم المتصفح لكاميرا الجوال وميزة BarcodeDetector.
              </p>
            </div>
          </div>

          {/* Header Image */}
          <div className="mb-8 p-6 bg-white/5 rounded-2xl border border-white/10">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><ImageIcon className="w-5 h-5 text-primary-400" /> صورة الهيدر</h3>
            {kiosk_settings.header_image && (
              <div className="mb-4 relative inline-block">
                <img src={kiosk_settings.header_image} alt="Header" className="max-h-32 rounded-xl border border-white/20" />
                <button onClick={() => setKioskSettings({ ...kiosk_settings, header_image: undefined })} className="absolute top-2 left-2 p-1 bg-red-500 rounded-full text-white"><X className="w-4 h-4" /></button>
              </div>
            )}
            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-white/20 rounded-xl p-6 text-center hover:border-primary-500 transition-colors">
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <span className="text-gray-300">اضغط لرفع صورة الهيدر</span>
              </div>
              <input type="file" className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload('header', e.target.files[0])} />
            </label>
          </div>

          {/* Screensaver Settings */}
          <div className="mb-8 p-6 bg-white/5 rounded-2xl border border-white/10">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2"><SettingsIcon className="w-5 h-5 text-secondary-400" /> إعدادات شاشة التوقف</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={kiosk_settings.screensaver_enabled} onChange={e => setKioskSettings({ ...kiosk_settings, screensaver_enabled: e.target.checked })} className="w-5 h-5 rounded" />
                <label className="text-gray-300 font-medium">تفعيل شاشة التوقف</label>
              </div>
              {kiosk_settings.screensaver_enabled && (
                <>
                  <div>
                    <label className="block text-gray-300 mb-2 font-medium">مدة عدم النشاط (بالثواني)</label>
                    <div className="flex items-center gap-4">
                      <input
                        type="number"
                        className="flex-1 input-glass p-3 rounded-xl"
                        value={Math.round((kiosk_settings.screensaver_timeout || 300000) / 1000)}
                        onChange={e => setKioskSettings({ ...kiosk_settings, screensaver_timeout: Number(e.target.value) * 1000 })}
                        placeholder="300"
                        min="10"
                      />
                      <span className="text-gray-400 text-sm">ثانية</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">({Math.round((kiosk_settings.screensaver_timeout || 300000) / 60000)} دقيقة)</p>
                  </div>

                  {/* Screensaver Images */}
                  <div className="pt-4 border-t border-white/10">
                    <label className="block text-gray-300 mb-3 font-medium flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-secondary-400" />
                      صور شاشة التوقف ({kiosk_settings.screensaver_images?.length || 0}/15)
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                      {kiosk_settings.screensaver_images?.map((img, idx) => (
                        <div key={idx} className="relative group aspect-video">
                          <img src={img} alt={`Screensaver ${idx + 1}`} className="w-full h-full object-cover rounded-xl border border-white/20" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                            <button onClick={() => handleRemoveImage(idx)} className="p-2 bg-red-500 rounded-full text-white hover:bg-red-400 transition-colors">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-2 py-0.5 rounded">{idx + 1}</span>
                        </div>
                      ))}
                    </div>
                    {(kiosk_settings.screensaver_images?.length || 0) < 15 && (
                      <label className="block cursor-pointer">
                        <div className="border-2 border-dashed border-white/20 rounded-xl p-4 text-center hover:border-secondary-500 transition-colors">
                          <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                          <span className="text-gray-300 text-sm">إضافة صورة لشاشة التوقف</span>
                        </div>
                        <input type="file" className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && handleImageUpload('screensaver', e.target.files[0])} />
                      </label>
                    )}
                  </div>

                  {/* Screensaver Phrases */}
                  <div className="pt-4 border-t border-white/10">
                    <label className="block text-gray-300 mb-3 font-medium flex items-center gap-2">
                      <FileText className="w-5 h-5 text-primary-400" />
                      عبارات شاشة التوقف ({kiosk_settings.screensaver_phrases?.length || 0})
                    </label>
                    <div className="space-y-2 mb-4">
                      {kiosk_settings.screensaver_phrases?.map((phrase, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-3 bg-white/5 rounded-xl border border-white/10 group">
                          <span className="text-primary-400 font-mono text-sm">{idx + 1}.</span>
                          <span className="flex-1 text-white">{phrase}</span>
                          <button
                            onClick={() => {
                              const newPhrases = [...(kiosk_settings.screensaver_phrases || [])];
                              newPhrases.splice(idx, 1);
                              setKioskSettings({ ...kiosk_settings, screensaver_phrases: newPhrases });
                            }}
                            className="p-1 text-red-400 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        id="newPhrase"
                        className="flex-1 input-glass p-3 rounded-xl"
                        placeholder="أدخل عبارة جديدة..."
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            const input = e.target as HTMLInputElement;
                            if (input.value.trim()) {
                              setKioskSettings({
                                ...kiosk_settings,
                                screensaver_phrases: [...(kiosk_settings.screensaver_phrases || []), input.value.trim()]
                              });
                              input.value = '';
                            }
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const input = document.getElementById('newPhrase') as HTMLInputElement;
                          if (input?.value.trim()) {
                            setKioskSettings({
                              ...kiosk_settings,
                              screensaver_phrases: [...(kiosk_settings.screensaver_phrases || []), input.value.trim()]
                            });
                            input.value = '';
                          }
                        }}
                        className="px-4 py-3 bg-primary-600 hover:bg-primary-500 rounded-xl text-white font-bold transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">💡 أمثلة: "مرحباً بكم في مدرستنا" - "العلم نور" - "التميز هدفنا"</p>
                  </div>

                  {/* Custom Screensaver Text */}
                  <div className="pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-gray-300 font-medium flex items-center gap-2">
                        <Type className="w-5 h-5 text-amber-400" />
                        نص مخصص على شاشة التوقف
                      </label>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={kiosk_settings.screensaver_custom_text?.enabled || false}
                          onChange={e => setKioskSettings({
                            ...kiosk_settings,
                            screensaver_custom_text: {
                              ...kiosk_settings.screensaver_custom_text,
                              text: kiosk_settings.screensaver_custom_text?.text || '',
                              position: kiosk_settings.screensaver_custom_text?.position || 'center',
                              size: kiosk_settings.screensaver_custom_text?.size || 'lg',
                              enabled: e.target.checked
                            }
                          })}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:right-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                      </label>
                    </div>

                    {kiosk_settings.screensaver_custom_text?.enabled && (
                      <div className="space-y-4 p-4 bg-amber-500/5 rounded-xl border border-amber-500/20">
                        {/* Text Input */}
                        <div>
                          <label className="block text-gray-400 text-sm mb-2">النص</label>
                          <textarea
                            className="w-full input-glass p-3 rounded-xl resize-none"
                            rows={2}
                            placeholder="اكتب النص الذي سيظهر على شاشة التوقف..."
                            value={kiosk_settings.screensaver_custom_text?.text || ''}
                            onChange={e => setKioskSettings({
                              ...kiosk_settings,
                              screensaver_custom_text: {
                                ...kiosk_settings.screensaver_custom_text!,
                                text: e.target.value
                              }
                            })}
                          />
                        </div>

                        {/* Position & Size Grid */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Position */}
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">موضع النص</label>
                            <select
                              className="w-full input-glass p-3 rounded-xl"
                              value={kiosk_settings.screensaver_custom_text?.position || 'center'}
                              onChange={e => setKioskSettings({
                                ...kiosk_settings,
                                screensaver_custom_text: {
                                  ...kiosk_settings.screensaver_custom_text!,
                                  position: e.target.value as any
                                }
                              })}
                            >
                              <option value="top">أعلى الشاشة ⬆️</option>
                              <option value="center">وسط الشاشة ⬌</option>
                              <option value="bottom">أسفل الشاشة ⬇️</option>
                            </select>
                          </div>

                          {/* Size */}
                          <div>
                            <label className="block text-gray-400 text-sm mb-2">حجم النص</label>
                            <select
                              className="w-full input-glass p-3 rounded-xl"
                              value={kiosk_settings.screensaver_custom_text?.size || 'lg'}
                              onChange={e => setKioskSettings({
                                ...kiosk_settings,
                                screensaver_custom_text: {
                                  ...kiosk_settings.screensaver_custom_text!,
                                  size: e.target.value as any
                                }
                              })}
                            >
                              <option value="sm">صغير</option>
                              <option value="md">متوسط</option>
                              <option value="lg">كبير</option>
                            </select>
                          </div>
                        </div>

                        {/* Preview */}
                        <div className="p-4 bg-black/40 rounded-xl border border-white/10">
                          <p className="text-xs text-gray-500 mb-2 text-center">معاينة:</p>
                          <div className={`
                                                            flex min-h-[100px] rounded-lg bg-gradient-to-br from-slate-800 to-slate-900
                                                            ${kiosk_settings.screensaver_custom_text?.position === 'top' ? 'items-start pt-4' : ''}
                                                            ${kiosk_settings.screensaver_custom_text?.position === 'center' ? 'items-center' : ''}
                                                            ${kiosk_settings.screensaver_custom_text?.position === 'bottom' ? 'items-end pb-4' : ''}
                                                            justify-center
                                                        `}>
                            <p className={`
                                                                text-white font-bold text-center px-4
                                                                ${kiosk_settings.screensaver_custom_text?.size === 'sm' ? 'text-sm' : ''}
                                                                ${kiosk_settings.screensaver_custom_text?.size === 'md' ? 'text-lg' : ''}
                                                                ${kiosk_settings.screensaver_custom_text?.size === 'lg' ? 'text-2xl' : ''}
                                                            `}>
                              {kiosk_settings.screensaver_custom_text?.text || 'النص سيظهر هنا...'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Announcements / Carousel System */}
          <div className="mb-8 p-6 bg-gradient-to-br from-rose-500/10 to-secondary-500/10 rounded-2xl border border-rose-500/20">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-rose-400" />
              نظام الإعلانات والعروض الدورية
            </h3>
            <div className="space-y-6">
              {/* Enable Announcements Toggle */}
              <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/10">
                <input
                  type="checkbox"
                  checked={kiosk_settings.announcements_enabled}
                  onChange={e => setKioskSettings({ ...kiosk_settings, announcements_enabled: e.target.checked })}
                  className="w-5 h-5 rounded"
                />
                <label className="text-gray-300 font-medium">تفعيل نظام الإعلانات</label>
              </div>

              {kiosk_settings.announcements_enabled && (
                <>
                  {/* Announcement Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Auto-play */}
                    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                      <input
                        type="checkbox"
                        checked={kiosk_settings.announcements_autoplay ?? true}
                        onChange={e => setKioskSettings({ ...kiosk_settings, announcements_autoplay: e.target.checked })}
                        className="w-4 h-4 rounded"
                      />
                      <label className="text-gray-300 text-sm">تشغيل تلقائي</label>
                    </div>

                    {/* Interval */}
                    <div>
                      <label className="block text-gray-300 mb-2 text-sm font-medium">مدة عرض كل إعلان (بالثواني)</label>
                      <input
                        type="number"
                        className="w-full input-glass p-3 rounded-xl"
                        value={kiosk_settings.announcements_interval || 5}
                        onChange={e => setKioskSettings({ ...kiosk_settings, announcements_interval: Number(e.target.value) })}
                        min="2"
                        max="30"
                      />
                    </div>

                    {/* Transition Type */}
                    <div>
                      <label className="block text-gray-300 mb-2 text-sm font-medium">نوع الانتقال</label>
                      <select
                        className="w-full input-glass p-3 rounded-xl"
                        value={kiosk_settings.announcements_transition || 'slide'}
                        onChange={e => setKioskSettings({ ...kiosk_settings, announcements_transition: e.target.value as 'slide' | 'fade' | 'zoom' })}
                      >
                        <option value="slide">انزلاق (Slide)</option>
                        <option value="fade">تلاشي (Fade)</option>
                        <option value="zoom">تكبير (Zoom)</option>
                      </select>
                    </div>

                    {/* Position */}
                    <div>
                      <label className="block text-gray-300 mb-2 text-sm font-medium">موضع العرض</label>
                      <select
                        className="w-full input-glass p-3 rounded-xl"
                        value={kiosk_settings.announcements_position || 'bottom'}
                        onChange={e => setKioskSettings({ ...kiosk_settings, announcements_position: e.target.value as 'top' | 'bottom' | 'center' })}
                      >
                        <option value="top">أعلى (Top)</option>
                        <option value="center">وسط (Center)</option>
                        <option value="bottom">أسفل (Bottom)</option>
                      </select>
                    </div>
                  </div>

                  {/* Announcements List */}
                  <div className="pt-4 border-t border-white/10">
                    <label className="block text-gray-300 mb-3 font-medium flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-rose-400" />
                      الإعلانات ({(kiosk_settings.announcements_images?.length || 0)}/10)
                    </label>

                    {/* Existing Announcements */}
                    {(kiosk_settings.announcements_images?.length || 0) > 0 && (
                      <div className="space-y-3 mb-4">
                        {kiosk_settings.announcements_images?.map((img, idx) => (
                          <div key={idx} className="p-4 bg-white/5 rounded-xl border border-white/10 group">
                            <div className="flex gap-4">
                              {/* Image Preview */}
                              <div className="relative w-32 h-20 flex-shrink-0">
                                <img src={img} alt={`Announcement ${idx + 1}`} className="w-full h-full object-cover rounded-lg border border-white/20" />
                                <span className="absolute top-1 left-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded">{idx + 1}</span>
                              </div>

                              {/* Info */}
                              <div className="flex-1 space-y-2">
                                <input
                                  type="text"
                                  className="w-full input-glass p-2 rounded-lg text-sm"
                                  placeholder="عنوان الإعلان (اختياري)"
                                  value={kiosk_settings.announcements_titles?.[idx] || ''}
                                  onChange={e => {
                                    const titles = [...(kiosk_settings.announcements_titles || [])];
                                    titles[idx] = e.target.value;
                                    setKioskSettings({ ...kiosk_settings, announcements_titles: titles });
                                  }}
                                />
                                <textarea
                                  className="w-full input-glass p-2 rounded-lg text-sm"
                                  placeholder="وصف الإعلان (اختياري)"
                                  rows={2}
                                  value={kiosk_settings.announcements_descriptions?.[idx] || ''}
                                  onChange={e => {
                                    const descs = [...(kiosk_settings.announcements_descriptions || [])];
                                    descs[idx] = e.target.value;
                                    setKioskSettings({ ...kiosk_settings, announcements_descriptions: descs });
                                  }}
                                />
                              </div>

                              {/* Delete Button */}
                              <button
                                onClick={() => {
                                  const newImages = [...(kiosk_settings.announcements_images || [])];
                                  const newTitles = [...(kiosk_settings.announcements_titles || [])];
                                  const newDescs = [...(kiosk_settings.announcements_descriptions || [])];
                                  newImages.splice(idx, 1);
                                  newTitles.splice(idx, 1);
                                  newDescs.splice(idx, 1);
                                  setKioskSettings({
                                    ...kiosk_settings,
                                    announcements_images: newImages,
                                    announcements_titles: newTitles,
                                    announcements_descriptions: newDescs
                                  });
                                }}
                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 self-start"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add New Announcement */}
                    {(kiosk_settings.announcements_images?.length || 0) < 10 && (
                      <label className="block cursor-pointer">
                        <div className="border-2 border-dashed border-white/20 rounded-xl p-6 text-center hover:border-rose-500 transition-colors hover:bg-rose-500/5">
                          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                          <span className="text-gray-300 font-medium">إضافة إعلان جديد</span>
                          <p className="text-gray-500 text-xs mt-1">يمكنك إضافة حتى 10 إعلانات</p>
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={e => e.target.files?.[0] && handleImageUpload('announcement', e.target.files[0])}
                        />
                      </label>
                    )}

                    {(kiosk_settings.announcements_images?.length || 0) === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        <Megaphone className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">لم يتم إضافة أي إعلانات بعد</p>
                      </div>
                    )}
                  </div>

                  {/* Preview Info */}
                  {(kiosk_settings.announcements_images?.length || 0) > 0 && (
                    <div className="mt-4 p-4 bg-rose-900/20 rounded-xl border border-rose-500/30">
                      <p className="text-sm text-rose-300 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        سيتم عرض الإعلانات في شاشة الكشك بشكل {kiosk_settings.announcements_autoplay ? 'تلقائي' : 'يدوي'} كل {kiosk_settings.announcements_interval || 5} ثواني
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Save Button */}
          <button onClick={doSaveKioskSettings} className="w-full py-4 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl text-white font-bold hover:from-primary-500 hover:to-secondary-500 transition-all shadow-lg text-lg">
            حفظ الإعدادات
          </button>
        </div>
      </div>


    </>
  );
};

export default AdminKioskTab;
