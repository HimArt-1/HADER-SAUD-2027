import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { User, SystemSettings } from '../types';
import { auth } from '../services/auth';
import { ArrowLeft, Building2, Loader2, LockKeyhole, ShieldCheck, UserCircle, UsersRound } from 'lucide-react';
import { validateBootstrapAdmin } from '../services/bootstrapAdmin';
import { logError, getErrorMessage } from '../types/errors';
import { useAdminTheme } from '../hooks/useAdminTheme';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [activeTab, setActiveTab] = useState<'staff' | 'guardian'>('staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLocalMode, setIsLocalMode] = useState(false);
  const [bootstrapStatus] = useState(() => validateBootstrapAdmin());

  useAdminTheme();

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const { db } = await import('../services/db');
        if (cancelled) return;

        setIsLocalMode(db.getMode() === 'local');
        const s = await db.getSettings();
        if (cancelled) return;
        setSettings(s);
      } catch (error) {
        logError(error, 'Login - Load Settings');
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await auth.login(username, password, activeTab);

      if (result.success && result.user) {
        onLogin(result.user);
      } else {
        setError(result.message || 'بيانات الدخول غير صحيحة');
      }
    } catch (err) {
      logError(err, 'Login - Handle Login');
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const school_name = settings?.school_name || settings?.kiosk_settings?.school_name;
  const principal_name = settings?.principal_name || settings?.kiosk_settings?.principal_name;
  const shouldShowBootstrapPanel = activeTab === 'staff' && isLocalMode && (bootstrapStatus.errors.length > 0 || bootstrapStatus.warnings.length > 0);
  const loginTone = activeTab === 'staff' ? 'primary' : 'guardian';

  return (
    <main className="hader-auth relative min-h-[100dvh] overflow-hidden bg-[#06191e] text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(6,25,30,0.98),rgba(10,85,93,0.76)_52%,rgba(6,47,53,0.96))]" />
      <div className="absolute inset-0 opacity-[0.11] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-7xl grid-cols-1 items-center gap-10 px-5 py-8 md:grid-cols-[1.05fr_0.95fr] md:px-10 lg:px-12">
        <section className="hidden md:block">
          <div className="max-w-xl">
            <div className="mb-10 flex items-center gap-4">
              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
                <img
                  src="/images/hader-logo.png"
                  alt="حاضر"
                  className="h-24 w-auto object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary-100">نظام حاضر</p>
                <h1 className="mt-1 text-3xl font-extrabold leading-tight text-slate-50">دخول آمن لإدارة اليوم الدراسي</h1>
              </div>
            </div>

            <div className="space-y-6">
              <div className="border-r-2 border-primary-300/70 pr-5">
                <p className="text-sm font-semibold text-primary-100">اليوم الدراسي يبدأ من هنا</p>
                <p className="mt-2 max-w-[42ch] text-base leading-8 text-slate-300">
                  حضور واضح، وصول منضبط، وبيانات مدرسية في مكان واحد.
                </p>
              </div>

              {(school_name || principal_name) && (
                <div className="max-w-md rounded-[1.75rem] border border-white/10 bg-white/[0.055] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_24px_70px_-42px_rgb(var(--color-primary-600)_/_0.55)]">
                  {school_name && (
                    <div className="flex items-center gap-3">
                      <Building2 className="h-5 w-5 text-primary-200" />
                      <h2 className="text-lg font-bold text-slate-50">{school_name}</h2>
                    </div>
                  )}
                  {principal_name && (
                    <div className="mt-3 flex items-center gap-3 text-sm text-slate-300">
                      <UserCircle className="h-4 w-4 text-slate-400" />
                      <span>مدير المدرسة: <span className="font-semibold text-primary-100">{principal_name}</span></span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="w-full">
          <div className="mx-auto w-full max-w-[440px] rounded-[2rem] border border-white/10 bg-[#06191e]/85 md:bg-[#06191e]/72 p-2 shadow-[0_30px_90px_-42px_rgb(var(--color-primary-500)_/_0.42),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md md:backdrop-blur-xl">
            <div className="rounded-[1.55rem] border border-white/10 bg-[#0b272d]/90 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-7">
              <div className="mb-7 md:hidden">
                <img
                  src="/images/hader-logo.png"
                  alt="حاضر"
                  className="mx-auto h-28 w-auto object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>

              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-primary-100">تسجيل الدخول</p>
                  <h2 className="mt-2 text-2xl font-extrabold leading-tight text-slate-50">
                    {activeTab === 'staff' ? 'بوابة الموظفين' : 'بوابة ولي الأمر'}
                  </h2>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary-200/15 bg-primary-200/10">
                  {activeTab === 'staff'
                    ? <ShieldCheck className="h-5 w-5 text-primary-100" />
                    : <UsersRound className="h-5 w-5 text-emerald-100" />}
                </div>
              </div>

              <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.035] p-1.5">
                <button
                  type="button"
                  className={`rounded-xl px-3 py-3 text-sm font-bold transition duration-300 active:scale-[0.98] ${activeTab === 'staff'
                    ? 'bg-primary-100 text-slate-950 shadow-[0_12px_30px_-18px_rgb(var(--color-primary-300)_/_0.8)]'
                    : 'text-slate-300 hover:bg-white/[0.06] hover:text-slate-50'
                    }`}
                  onClick={() => setActiveTab('staff')}
                >
                  الموظفين
                </button>
                <button
                  type="button"
                  className={`rounded-xl px-3 py-3 text-sm font-bold transition duration-300 active:scale-[0.98] ${activeTab === 'guardian'
                    ? 'bg-emerald-100 text-slate-950 shadow-[0_12px_30px_-18px_rgba(110,231,183,0.72)]'
                    : 'text-slate-300 hover:bg-white/[0.06] hover:text-slate-50'
                    }`}
                  onClick={() => setActiveTab('guardian')}
                >
                  أولياء الأمور
                </button>
              </div>

              {shouldShowBootstrapPanel && (
                <div className="mb-6 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-amber-50">
                  <div className="flex items-start gap-3">
                    <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold">تهيئة حساب المدير مطلوبة قبل أول تسجيل دخول.</p>
                      <p className="text-xs leading-6 text-amber-50/80">
                        اضبط متغيرات bootstrap بقيم قوية ثم أعد تشغيل التطبيق.
                      </p>
                    </div>
                  </div>

                  {bootstrapStatus.errors.length > 0 && (
                    <div className="mt-3 rounded-xl bg-slate-950/35 p-3">
                      <p className="mb-2 text-xs font-bold text-red-100">أسباب حجب تسجيل الدخول:</p>
                      <ul className="list-inside list-disc space-y-1 text-xs text-red-50">
                        {bootstrapStatus.errors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {bootstrapStatus.warnings.length > 0 && (
                    <div className="mt-3 rounded-xl bg-slate-950/25 p-3">
                      <p className="mb-2 text-xs font-bold text-amber-100">مقترحات تقوية كلمة المرور:</p>
                      <ul className="list-inside list-disc space-y-1 text-xs text-amber-50">
                        {bootstrapStatus.warnings.map((warn, idx) => (
                          <li key={idx}>{warn}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                  <div className="rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-100">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="login-username" className="block text-sm font-semibold text-slate-200">
                    {activeTab === 'staff' ? 'اسم المستخدم' : 'رقم الجوال'}
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 text-base text-slate-50 outline-none transition duration-300 placeholder:text-slate-500 focus:border-primary-200/60 focus:bg-white/[0.075] focus:ring-4 focus:ring-primary-300/10"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={activeTab === 'staff' ? 'مثال: admin' : '05xxxxxxxx'}
                    autoComplete={activeTab === 'staff' ? 'username' : 'tel'}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="login-password" className="block text-sm font-semibold text-slate-200">
                    {activeTab === 'staff' ? 'كلمة المرور' : 'آخر 4 أرقام من معرف الطالب'}
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    required
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-4 text-base text-slate-50 outline-none transition duration-300 placeholder:text-slate-500 focus:border-primary-200/60 focus:bg-white/[0.075] focus:ring-4 focus:ring-primary-300/10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={activeTab === 'staff' ? 'current-password' : 'one-time-code'}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`group flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-extrabold transition duration-300 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${loginTone === 'primary'
                    ? 'bg-primary-100 text-slate-950 hover:bg-primary-50'
                    : 'bg-emerald-100 text-slate-950 hover:bg-emerald-50'
                    }`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      جاري التحقق
                    </>
                  ) : (
                    <>
                      <span>تسجيل الدخول</span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/10 transition duration-300 group-hover:-translate-x-1">
                        <ArrowLeft className="h-4 w-4" />
                      </span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <Link
                  to="/landing"
                  className="font-semibold text-primary-100 transition duration-300 hover:text-slate-50"
                >
                  تعرّف على حاضر
                </Link>
                <Link
                  to="/demo"
                  className="font-semibold text-slate-300 transition duration-300 hover:text-primary-100"
                >
                  مشاهدة الديمو
                </Link>
                <span className="font-mono text-[11px] text-slate-500">HADER</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Login;
