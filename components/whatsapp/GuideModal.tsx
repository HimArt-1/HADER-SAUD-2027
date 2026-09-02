import React, { useState } from 'react';
import {
    getWhatsAppMacZipHref,
    getWhatsAppWindowsZipHref,
    WHATSAPP_LAUNCHER_MAC_FILENAME,
    WHATSAPP_LAUNCHER_WINDOWS_FILENAME,
} from '../../constants/whatsappLauncher';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, 
    Download, 
    Terminal, 
    Chrome, 
    Smartphone, 
    CheckCircle2, 
    ExternalLink, 
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    Info,
    HelpCircle
} from 'lucide-react';

interface GuideModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const steps = [
    {
        title: "الخطوة الأولى: تهيئة البيئة",
        description: "يجب التأكد من وجود المتطلبات الأساسية لتشغيل نظام الأتمتة على جهازك الشخصي.",
        icon: Chrome,
        color: "blue",
        details: [
            "تثبيت متصفح Google Chrome (إصدار حديث).",
            "تثبيت لغة Python (إصدار 3.10 أو أعلى).",
            "تفعيل خيار 'Add Python to PATH' أثناء التثبيت."
        ]
    },
    {
        title: "الخطوة الثانية: تحميل المشغل",
        description: "قم بتحميل ملف 'مشغل ويندوز' وفك الضغط عنه في مجلد خاص على جهازك.",
        icon: Download,
        color: "green",
        details: [
            "اضغط على زر 'مشغل ويندوز' في الواجهة الرئيسية.",
            "قم بفك ضغط المجلد في مكان يسهل الوصول إليه.",
            "تأكد من وجود ملف server.py داخل المجلد."
        ]
    },
    {
        title: "الخطوة الثالثة: تشغيل الخادم",
        description: "نقوم الآن بتشغيل المحرك المحلي الذي سيتواصل مع الواتساب.",
        icon: Terminal,
        color: "purple",
        details: [
            "اضغط مرتين على ملف run_windows.bat.",
            "انتظر حتى يتم تثبيت المكتبات (للمرة الأولى فقط).",
            "سيفتح نافذة تيرمنال جديدة، لا تقم بإغلاقها أبداً."
        ]
    },
    {
        title: "الخطوة الرابعة: الربط والتحقق",
        description: "ربط حساب الواتساب الخاص بك بالمحرك الذكي.",
        icon: Smartphone,
        color: "emerald",
        details: [
            "ستفتح نافذة كروم جديدة تطلب مسح رمز QR.",
            "افتح واتساب على جوالك > الأجهزة المرتبطة > ربط جهاز.",
            "بعد المسح، ستتحول الحالة في الموقع إلى 'متصل'."
        ]
    },
    {
        title: "الخطوة الخامسة: الإرسال الذكي",
        description: "أنت الآن جاهز لإرسال الرسائل والأوسمة للطلاب.",
        icon: CheckCircle2,
        color: "amber",
        details: [
            "اختر الطلاب من القوائم أو الإرسال اليدوي.",
            "حدد قالب الرسالة المناسب.",
            "اضغط 'إرسال' وراقب تقدم العملية في الطابور."
        ]
    }
];

export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
    const [currentStep, setCurrentStep] = useState(0);

    const nextStep = () => {
        if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1);
    };

    const prevStep = () => {
        if (currentStep > 0) setCurrentStep(currentStep - 1);
    };

    const activeStep = steps[currentStep];

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" dir="rtl">
                    {/* Backdrop */}
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div 
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-4xl bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row"
                    >
                        {/* Sidebar / Progress */}
                        <div className="w-full md:w-72 bg-black/40 p-8 border-l border-white/5 hidden md:flex flex-col justify-between">
                            <div>
                                <div className="flex items-center gap-3 mb-10">
                                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                                        <HelpCircle className="w-6 h-6 text-blue-400" />
                                    </div>
                                    <h2 className="text-xl font-black text-white">دليل هادر</h2>
                                </div>

                                <div className="space-y-6">
                                    {steps.map((step, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => setCurrentStep(idx)}
                                            className={`flex items-center gap-4 cursor-pointer transition-all ${idx === currentStep ? 'opacity-100' : 'opacity-30 hover:opacity-50'}`}
                                        >
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${idx === currentStep ? 'bg-blue-600 text-white' : 'bg-white/10 text-white'}`}>
                                                {idx + 1}
                                            </div>
                                            <span className="text-sm font-bold text-gray-200">{step.title.split(':')[1]}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                                <div className="flex items-center gap-2 text-amber-400 mb-2">
                                    <AlertTriangle className="w-4 h-4" />
                                    <span className="text-xs font-bold">تنبيه هام</span>
                                </div>
                                <p className="text-[10px] text-amber-200/70 leading-relaxed">
                                    لا تغلق نافذة المتصفح السوداء (Terminal) أثناء عمل النظام لضمان استمرارية الإرسال.
                                </p>
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col h-[600px] md:h-[650px]">
                            {/* Header */}
                            <div className="p-6 flex items-center justify-between border-b border-white/5">
                                <div className="md:hidden flex items-center gap-2">
                                    <HelpCircle className="w-5 h-5 text-blue-400" />
                                    <span className="font-bold text-white">دليل التشغيل</span>
                                </div>
                                <div className="hidden md:block"></div>
                                <button 
                                    onClick={onClose}
                                    className="p-2 rounded-full bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Scrollable Content */}
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                                <AnimatePresence mode="wait">
                                    <motion.div
                                        key={currentStep}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 20 }}
                                        className="h-full"
                                    >
                                        {/* Step Image / Graphic */}
                                        {currentStep === 0 && (
                                            <div className="mb-8 rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl">
                                                <img 
                                                    src="/images/whatsapp_guide_hero.webp" 
                                                    alt="WhatsApp Automation" 
                                                    className="w-full h-48 object-cover"
                                                />
                                            </div>
                                        )}

                                        <div className={`w-16 h-16 rounded-2xl bg-${activeStep.color}-500/20 flex items-center justify-center mb-6`}>
                                            <activeStep.icon className={`w-8 h-8 text-${activeStep.color}-400`} />
                                        </div>

                                        <h3 className="text-3xl font-black text-white mb-4">{activeStep.title}</h3>
                                        <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                                            {activeStep.description}
                                        </p>

                                        <div className="space-y-4">
                                            {activeStep.details.map((detail, i) => (
                                                <div key={i} className="flex items-start gap-3 p-4 bg-white/5 rounded-2xl border border-white/5 group hover:border-white/10 transition-colors">
                                                    <div className={`mt-1.5 w-2 h-2 rounded-full bg-${activeStep.color}-500 group-hover:scale-125 transition-transform`} />
                                                    <span className="text-gray-200 font-medium leading-relaxed">{detail}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Download buttons — step 2 (Mac + Windows) */}
                                        {currentStep === 1 && (
                                            <div className="mt-8 flex flex-wrap gap-3">
                                                <a
                                                    href={getWhatsAppMacZipHref()}
                                                    download={WHATSAPP_LAUNCHER_MAC_FILENAME}
                                                    className="inline-flex items-center gap-3 px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20"
                                                >
                                                    <Download className="w-5 h-5" />
                                                    تحميل حزمة Mac
                                                </a>
                                                <a
                                                    href={getWhatsAppWindowsZipHref()}
                                                    download={WHATSAPP_LAUNCHER_WINDOWS_FILENAME}
                                                    className="inline-flex items-center gap-3 px-6 py-3 bg-sky-600 text-white rounded-xl font-bold hover:bg-sky-500 transition-all shadow-lg shadow-sky-600/20"
                                                >
                                                    <Download className="w-5 h-5" />
                                                    تحميل حزمة Windows
                                                </a>
                                            </div>
                                        )}
                                        
                                        {currentStep === 0 && (
                                            <div className="mt-8 flex flex-wrap gap-4">
                                                <a 
                                                    href="https://www.python.org/downloads/" 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl text-sm font-bold hover:bg-blue-600/30 transition-all"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                    تحميل Python
                                                </a>
                                                <a 
                                                    href="https://www.google.com/chrome/" 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-sm font-bold hover:bg-emerald-600/30 transition-all"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                    تحميل Chrome
                                                </a>
                                            </div>
                                        )}
                                    </motion.div>
                                </AnimatePresence>
                            </div>

                            {/* Footer / Navigation */}
                            <div className="p-8 border-t border-white/5 flex items-center justify-between bg-black/20">
                                <div className="flex items-center gap-2">
                                    {steps.map((_, i) => (
                                        <div 
                                            key={i} 
                                            className={`h-1.5 rounded-full transition-all ${i === currentStep ? 'w-8 bg-blue-500' : 'w-2 bg-white/10'}`}
                                        />
                                    ))}
                                </div>

                                <div className="flex gap-3">
                                    <button 
                                        onClick={prevStep}
                                        disabled={currentStep === 0}
                                        className="p-3 rounded-xl bg-white/5 text-white disabled:opacity-20 hover:bg-white/10 transition-colors"
                                    >
                                        <ChevronRight className="w-6 h-6" />
                                    </button>
                                    {currentStep === steps.length - 1 ? (
                                        <button 
                                            onClick={onClose}
                                            className="px-8 py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20"
                                        >
                                            فهمت ذلك، ابدأ الآن
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={nextStep}
                                            className="p-3 rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
                                        >
                                            <ChevronLeft className="w-6 h-6" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
