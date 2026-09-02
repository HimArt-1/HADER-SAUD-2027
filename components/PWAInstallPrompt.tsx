/**
 * ═══════════════════════════════════════════════════════════════
 * 📲 PWA Install Prompt Component
 * ═══════════════════════════════════════════════════════════════
 * 
 * Shows a beautiful install banner when the app is installable.
 * Dismissible and remembers user choice for 7 days.
 */

import React, { useState, useEffect } from 'react';
import { Download, Share2, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const PWAInstallPrompt: React.FC = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showBanner, setShowBanner] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    const [isIOSInstall, setIsIOSInstall] = useState(false);

    useEffect(() => {
        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

        // Check if already installed
        if (isStandalone) {
            setIsInstalled(true);
            return;
        }

        // Check if dismissed recently
        const dismissed = localStorage.getItem('pwa_prompt_dismissed');
        if (dismissed) {
            const dismissedAt = new Date(dismissed).getTime();
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - dismissedAt < sevenDays) return;
        }

        const ua = window.navigator.userAgent;
        const isIOS = /iphone|ipad|ipod/i.test(ua);
        const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
        const iosTimer = isIOS && isSafari
            ? window.setTimeout(() => {
                setIsIOSInstall(true);
                setShowBanner(true);
            }, 2500)
            : null;

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setIsIOSInstall(false);
            // Delay showing the banner for better UX
            setTimeout(() => setShowBanner(true), 3000);
        };

        const handleInstalled = () => {
            setIsInstalled(true);
            setShowBanner(false);
            setDeferredPrompt(null);
            setIsIOSInstall(false);
        };

        window.addEventListener('beforeinstallprompt', handler);
        window.addEventListener('appinstalled', handleInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handler);
            window.removeEventListener('appinstalled', handleInstalled);
            if (iosTimer) window.clearTimeout(iosTimer);
        };
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setIsInstalled(true);
        }
        setDeferredPrompt(null);
        setShowBanner(false);
    };

    const handleDismiss = () => {
        setShowBanner(false);
        localStorage.setItem('pwa_prompt_dismissed', new Date().toISOString());
    };

    if (!showBanner || isInstalled) return null;

    return (
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-[150] animate-fade-in-up md:left-auto md:right-6 md:max-w-sm">
            <div className="glass-card rounded-2xl border border-primary-500/30 p-4 shadow-2xl shadow-primary-500/10 relative overflow-hidden">
                {/* Glow effect */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-500 via-secondary-500 to-secondary-500"></div>

                <button
                    onClick={handleDismiss}
                    className="absolute top-3 left-3 p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all"
                    aria-label="إخفاء تنبيه تثبيت التطبيق"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-primary-500/20 to-secondary-500/20 border border-primary-500/20 flex-shrink-0">
                        <Smartphone className="w-8 h-8 text-primary-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-white text-sm mb-1">ثبّت تطبيق حاضر 📲</h4>
                        <p className="text-xs text-slate-400 leading-relaxed mb-3">
                            {isIOSInstall
                                ? 'من Safari اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية.'
                                : 'أضف التطبيق لشاشتك الرئيسية للوصول السريع والعمل كتطبيق مستقل.'}
                        </p>

                        {isIOSInstall ? (
                            <div className="flex items-center justify-center gap-2 rounded-xl border border-primary-300/20 bg-primary-300/10 px-3 py-2.5 text-xs font-bold text-primary-50">
                                <Share2 className="w-4 h-4" />
                                مشاركة ثم إضافة للشاشة الرئيسية
                            </div>
                        ) : (
                            <button
                                onClick={handleInstall}
                                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 text-white text-sm font-bold shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40 transition-all flex items-center justify-center gap-2 active:scale-95"
                            >
                                <Download className="w-4 h-4" />
                                تثبيت الآن
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PWAInstallPrompt;
