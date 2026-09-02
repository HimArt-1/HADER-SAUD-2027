import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, 
    ChevronLeft, 
    ChevronRight, 
    HelpCircle,
    AlertTriangle,
    LucideIcon
} from 'lucide-react';

export interface GuideStep {
    title: string;
    description: string;
    icon: LucideIcon;
    color: string;
    details: string[];
    actionLabel?: string;
    actionHref?: string;
    isDownload?: boolean;
    /** Suggested save-as filename for the primary download */
    downloadFilename?: string;
    /** Optional secondary download button (e.g. Windows vs Mac) */
    secondaryActionLabel?: string;
    secondaryActionHref?: string;
    secondaryDownloadFilename?: string;
    externalLinks?: { label: string; href: string; icon: LucideIcon; color: string }[];
}

interface UniversalGuideModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    steps: GuideStep[];
    heroImage?: string;
}

export const UniversalGuideModal: React.FC<UniversalGuideModalProps> = ({ 
    isOpen, 
    onClose, 
    title, 
    steps, 
    heroImage 
}) => {
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
                                    <div className="w-10 h-10 rounded-xl bg-secondary-500/20 flex items-center justify-center">
                                        <HelpCircle className="w-6 h-6 text-secondary-400" />
                                    </div>
                                    <h2 className="text-xl font-black text-white">{title}</h2>
                                </div>

                                <div className="space-y-6">
                                    {steps.map((step, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => setCurrentStep(idx)}
                                            className={`flex items-center gap-4 cursor-pointer transition-all ${idx === currentStep ? 'opacity-100' : 'opacity-30 hover:opacity-50'}`}
                                        >
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${idx === currentStep ? 'bg-secondary-600 text-white' : 'bg-white/10 text-white'}`}>
                                                {idx + 1}
                                            </div>
                                            <span className="text-sm font-bold text-gray-200">{step.title.includes(':') ? step.title.split(':')[1] : step.title}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-8 p-4 bg-secondary-500/10 border border-secondary-500/20 rounded-2xl">
                                <p className="text-[10px] text-secondary-200/70 leading-relaxed">
                                    هذا الدليل مصمم لمساعدتك على استخدام النظام بأعلى كفاءة ممكنة.
                                </p>
                            </div>
                        </div>

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col h-[600px] md:h-[650px]">
                            {/* Header */}
                            <div className="p-6 flex items-center justify-between border-b border-white/5">
                                <div className="md:hidden flex items-center gap-2">
                                    <HelpCircle className="w-5 h-5 text-secondary-400" />
                                    <span className="font-bold text-white">{title}</span>
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
                                        {/* Step Image / Graphic - Show hero on first step if provided */}
                                        {currentStep === 0 && heroImage && (
                                            <div className="mb-8 rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl">
                                                <img 
                                                    src={heroImage} 
                                                    alt={title} 
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

                                        {/* Action Buttons (primary + optional secondary) */}
                                        {activeStep.actionLabel && activeStep.actionHref && (
                                            <div className="mt-8 flex flex-wrap gap-3">
                                                <a
                                                    href={activeStep.actionHref}
                                                    download={activeStep.downloadFilename ?? (activeStep.isDownload ? true : undefined)}
                                                    target={activeStep.isDownload ? undefined : "_blank"}
                                                    rel="noreferrer"
                                                    className={`inline-flex items-center gap-3 px-6 py-3 bg-${activeStep.color}-600 text-white rounded-xl font-bold hover:bg-${activeStep.color}-500 transition-all shadow-lg shadow-${activeStep.color}-600/20`}
                                                >
                                                    <activeStep.icon className="w-5 h-5" />
                                                    {activeStep.actionLabel}
                                                </a>
                                                {activeStep.secondaryActionLabel && activeStep.secondaryActionHref && (
                                                    <a
                                                        href={activeStep.secondaryActionHref}
                                                        download={activeStep.secondaryDownloadFilename ?? true}
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-3 px-6 py-3 bg-sky-600 text-white rounded-xl font-bold hover:bg-sky-500 transition-all shadow-lg shadow-sky-600/20"
                                                    >
                                                        <activeStep.icon className="w-5 h-5" />
                                                        {activeStep.secondaryActionLabel}
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* External Links */}
                                        {activeStep.externalLinks && (
                                            <div className="mt-8 flex flex-wrap gap-4">
                                                {activeStep.externalLinks.map((link, i) => (
                                                    <a 
                                                        key={i}
                                                        href={link.href} 
                                                        target="_blank" 
                                                        rel="noreferrer"
                                                        className={`inline-flex items-center gap-2 px-5 py-2.5 bg-${link.color}-600/20 text-${link.color}-400 border border-${link.color}-500/30 rounded-xl text-sm font-bold hover:bg-${link.color}-600/30 transition-all`}
                                                    >
                                                        <link.icon className="w-4 h-4" />
                                                        {link.label}
                                                    </a>
                                                ))}
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
                                            className={`h-1.5 rounded-full transition-all ${i === currentStep ? 'w-8 bg-secondary-500' : 'w-2 bg-white/10'}`}
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
                                            className="px-8 py-3 rounded-xl bg-secondary-600 text-white font-bold hover:bg-secondary-500 transition-all shadow-lg shadow-secondary-600/20"
                                        >
                                            إغلاق الدليل
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={nextStep}
                                            className="p-3 rounded-xl bg-secondary-600 text-white hover:bg-secondary-500 transition-all shadow-lg shadow-secondary-500/20"
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
