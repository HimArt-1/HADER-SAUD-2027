import React, { useState, useRef } from 'react';
import { toBlob } from 'html-to-image';
import { Eye, Send, Download, Sparkles, CheckCircle2, Award, Crown, Shield, Star, Hexagon, Pencil } from 'lucide-react';

// Types
export type BadgeType = 'king' | 'hero' | 'star' | 'diamond';

interface BadgeStudioProps {
    studentName: string;
    onSend: (file: File, message: string) => Promise<void>;
    onCancel: () => void;
}

const BadgeStudio: React.FC<BadgeStudioProps> = ({ studentName, onSend, onCancel }) => {
    const [activeTemplate, setActiveTemplate] = useState<BadgeType>('king');
    const [customMessage, setCustomMessage] = useState<string>('بطل الأسبوع');
    const [isGenerating, setIsGenerating] = useState<boolean>(false);
    const badgeRef = useRef<HTMLDivElement>(null);

    // Template Data
    const templates = {
        king: {
            name: 'وسام الملك',
            bgGradient: 'from-amber-200 via-yellow-100 to-amber-200',
            border: 'border-amber-500',
            accent: 'text-amber-800',
            icon: <Crown className="w-32 h-32 text-amber-600 drop-shadow-lg" strokeWidth={1.5} />,
            title: 'ملك الأسبوع',
            shape: 'rounded-full'
        },
        hero: {
            name: 'درع البطل',
            bgGradient: 'from-slate-200 via-gray-100 to-slate-200',
            border: 'border-slate-500',
            accent: 'text-slate-800',
            icon: <Shield className="w-32 h-32 text-slate-600 drop-shadow-lg" strokeWidth={1.5} />,
            title: 'بطل الحضور',
            shape: 'rounded-[3rem]' // Shield-ish soft square
        },
        star: {
            name: 'النجم الساطع',
            bgGradient: 'from-blue-200 via-sky-100 to-blue-200',
            border: 'border-blue-500',
            accent: 'text-blue-800',
            icon: <Star className="w-32 h-32 text-blue-600 drop-shadow-lg fill-blue-400" strokeWidth={1.5} />,
            title: 'نجم الفصل',
            shape: 'rounded-3xl'
        },
        diamond: {
            name: 'الماسة',
            bgGradient: 'from-purple-200 via-fuchsia-100 to-purple-200',
            border: 'border-purple-500',
            accent: 'text-purple-900',
            icon: <Award className="w-32 h-32 text-purple-600 drop-shadow-lg" strokeWidth={1.5} />,
            title: 'الماسة النادرة',
            shape: 'rounded-xl rotate-0' // Hexagon implementation is tricky with css borders, keeping simple box
        }
    };

    const currentTemplate = templates[activeTemplate];

    // Helper: Generate Image
    const handleGenerate = async (action: 'send' | 'download') => {
        if (!badgeRef.current) return;

        setIsGenerating(true);
        try {
            // Force loading of fonts if needed, wait a tick
            await new Promise(resolve => setTimeout(resolve, 100));

            const blob = await toBlob(badgeRef.current, {
                quality: 0.95,
                backgroundColor: 'transparent', // Badges should ideally have transparent bg but standard jpg/png is fine
                width: 800, // Square Badge
                height: 800
            });

            if (!blob) throw new Error("Failed to generate badge image");

            if (action === 'download') {
                const link = document.createElement('a');
                link.download = `Badge_${studentName}_${activeTemplate}.png`;
                link.href = URL.createObjectURL(blob);
                link.click();
            } else {
                const file = new File([blob], `badge_${Date.now()}.png`, { type: 'image/png' });
                // Default message related to badge
                const waMessage = `✨ مبروك للطالب البطل *${studentName}* حصوله على ${currentTemplate.name} 🏆`;
                await onSend(file, waMessage);
            }
        } catch (err) {
            console.error("Badge Generation Error:", err);
            alert("حدث خطأ أثناء توليد الوسام.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50/50 rounded-xl overflow-hidden shadow-inner border border-slate-200/50 backdrop-blur-sm">

            {/* 1. Toolbar */}
            <div className="flex items-center justify-between p-3 bg-white/80 border-b border-slate-200">
                <div className="flex gap-2">
                    {(Object.keys(templates) as BadgeType[]).map((type) => (
                        <button
                            key={type}
                            onClick={() => setActiveTemplate(type)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTemplate === type
                                ? 'bg-indigo-600 text-white shadow-md scale-105'
                                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                                }`}
                        >
                            {activeTemplate === type && <CheckCircle2 className="w-3 h-3" />}
                            {templates[type].name}
                        </button>
                    ))}
                </div>
                <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1 tracking-wider">
                    <Sparkles className="w-3 h-3" />
                    Badge Studio
                </div>
            </div>

            {/* 2. Workspace */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-6 relative">

                {/* Left: Live Preview (The Badge) */}
                <div className="flex-1 flex items-center justify-center bg-slate-200/30 rounded-2xl border-2 border-dashed border-slate-300/50 p-8">
                    <div className="transform origin-center scale-[0.6] md:scale-75 lg:scale-90 xl:scale-100 transition-all duration-500">

                        {/* --- BADGE CANVAS (800x800) --- */}
                        <div
                            ref={badgeRef}
                            className={`w-[800px] h-[800px] relative flex items-center justify-center p-12`}
                            style={{ background: 'transparent' }} // Transparent wrapper
                        >
                            {/* The Badge Itself */}
                            <div className={`w-full h-full bg-gradient-to-br ${currentTemplate.bgGradient} ${currentTemplate.shape} shadow-2xl flex flex-col items-center justify-center relative overflow-hidden border-[16px] ${currentTemplate.border} ring-8 ring-white/50`}>

                                {/* Shimmer/Gloss Effect */}
                                <div className="absolute -inset-[500px] bg-gradient-to-r from-transparent via-white/40 to-transparent rotate-45 transform translate-x-[120%] animate-[shimmer_3s_infinite]" />

                                {/* Top Decoration */}
                                <div className="absolute top-12 flex gap-4 opacity-60">
                                    <Sparkles className={`w-12 h-12 ${currentTemplate.accent}`} />
                                </div>

                                {/* Icon */}
                                <div className="mb-8 z-10 transform hover:scale-110 transition-transform duration-300">
                                    {currentTemplate.icon}
                                </div>

                                {/* Title Badge */}
                                <div className="bg-black/10 backdrop-blur-sm px-12 py-4 rounded-full mb-8 border border-white/20 shadow-inner">
                                    <h2 className={`text-6xl font-black tracking-tight ${currentTemplate.accent}`}>
                                        {currentTemplate.title}
                                    </h2>
                                </div>

                                {/* Text Content */}
                                <div className="text-center z-10 w-full px-8">
                                    <p className={`text-3xl font-bold mb-4 ${currentTemplate.accent} opacity-75`}>تُمنح للطالب البطل</p>
                                    <div className="relative inline-block">
                                        <h1 className={`text-7xl font-black ${currentTemplate.accent} text-shadow-sm`}>
                                            {studentName}
                                        </h1>
                                        {/* Underline decoration */}
                                        <div className={`h-2 w-full mt-2 rounded-full opacity-50 bg-current ${currentTemplate.accent}`}></div>
                                    </div>

                                    <p className={`mt-12 text-4xl font-semibold opacity-90 ${currentTemplate.accent}`}>
                                        "{customMessage}"
                                    </p>
                                </div>

                                {/* Bottom Date */}
                                <div className={`absolute bottom-12 font-mono text-2xl font-bold opacity-60 ${currentTemplate.accent}`}>
                                    {new Date().toLocaleDateString('en-GB')}
                                </div>

                                {/* Texture Overlay */}
                                <div className="absolute inset-0 bg-[url('/patterns/stardust.png')] opacity-20 pointer-events-none mix-blend-overlay"></div>
                            </div>

                            {/* Ribbon Effect (Optional, behind or below) */}
                            <div className="absolute -bottom-16 w-64 h-32 bg-red-600 shadow-xl transform -skew-x-12 -z-10 hidden"></div>
                        </div>
                        {/* --- END CANVAS --- */}

                    </div>
                </div>

                {/* Right: Controls Panel */}
                <div className="w-full md:w-72 bg-white/90 backdrop-blur rounded-2xl p-5 border border-white/20 shadow-xl flex flex-col gap-5 h-fit md:sticky md:top-4">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
                            <Pencil className="w-4 h-4 text-indigo-500" />
                            تخصيص الوسام
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">اكتب رسالة قصيرة تظهر على الوسام</p>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-slate-600 uppercase mb-1 block">رسالة التقدير</label>
                                <input
                                    type="text"
                                    value={customMessage}
                                    onChange={(e) => setCustomMessage(e.target.value)}
                                    maxLength={25}
                                    className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 font-bold focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-center placeholder-slate-300"
                                    placeholder="مثال: مجهود رائع"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="h-px bg-slate-100 my-1"></div>

                    <div className="space-y-3">
                        <button
                            onClick={() => handleGenerate('send')}
                            disabled={isGenerating}
                            className={`w-full py-4 rounded-xl font-black text-lg shadow-lg flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] ${isGenerating
                                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_auto] hover:bg-[position:right_center] animate-gradient text-white shadow-indigo-500/30'
                                }`}
                        >
                            {isGenerating ? (
                                <div className="flex items-center gap-2">
                                    <span className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>جاري الصك...</span>
                                </div>
                            ) : (
                                <>
                                    <Send className="w-5 h-5" />
                                    <span>صك وإرسال الوسام</span>
                                </>
                            )}
                        </button>

                        <button
                            onClick={() => handleGenerate('download')}
                            disabled={isGenerating}
                            className="w-full py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 hover:border-slate-300 transition-colors flex items-center justify-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            تحميل للصورة
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default BadgeStudio;
