import React, { useEffect, useRef, useState } from 'react';
import { toBlob } from 'html-to-image';
import { Award, Crown, Shield, Star, Download, Send, MessageSquare, CheckCircle2 } from 'lucide-react';

import StudentGenderSelect, { type StudentGender } from './StudentGenderSelect';

export type BadgeType = 'king' | 'hero' | 'star' | 'diamond';

interface BadgeStudioProps {
    studentName: string;
    gender?: StudentGender;
    onSend: (file: File, message: string) => Promise<void>;
    onManualSend?: (message: string) => boolean;
    canSend?: boolean;
    onBusyChange?: (busy: boolean) => void;
}

const getTemplates = (gender: StudentGender) => {
    const female = gender === 'female';
    return {
        king: { name: female ? 'وسام الملكة' : 'وسام الملك', title: female ? 'ملكة الأسبوع' : 'ملك الأسبوع', reason: female ? 'تقديرًا لتميزك واجتهادك، واصلي التألق' : 'تقديرًا لتميزك واجتهادك، واصل التألق', color: '#92400e', light: '#fffbeb', icon: Crown },
        hero: { name: female ? 'درع البطلة' : 'درع البطل', title: female ? 'بطلة الحضور' : 'بطل الحضور', reason: 'شكرًا لالتزامك بالحضور وانضباطك اليومي', color: '#065f46', light: '#ecfdf5', icon: Shield },
        star: { name: female ? 'النجمة الساطعة' : 'النجم الساطع', title: female ? 'نجمة الفصل' : 'نجم الفصل', reason: 'تميزك وتعاونك مصدر فخر لنا', color: '#075985', light: '#f0f9ff', icon: Star },
        diamond: { name: 'الماسة', title: 'الماسة النادرة', reason: gender === 'female' ? 'بأخلاقك ومثابرتك تصنعين الفرق كل يوم' : 'بأخلاقك ومثابرتك تصنع الفرق كل يوم', color: '#475569', light: '#f8fafc', icon: Award }
    };
};

const BadgeStudio: React.FC<BadgeStudioProps> = ({ studentName, gender: controlledGender, onSend, onManualSend, canSend = true, onBusyChange }) => {
    const [localGender, setLocalGender] = useState<StudentGender>('male');
    const gender = controlledGender ?? localGender;
    const templates = getTemplates(gender);
    const previousGender = useRef(gender);
    const [activeTemplate, setActiveTemplate] = useState<BadgeType>('king');
    const [title, setTitle] = useState(templates.king.title);
    const [customMessage, setCustomMessage] = useState(templates.king.reason);
    const [isGenerating, setIsGenerating] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [error, setError] = useState('');
    const [manualMessage, setManualMessage] = useState<string | null>(null);
    const [scale, setScale] = useState(0.5);
    const previewRef = useRef<HTMLDivElement>(null);
    const badgeRef = useRef<HTMLDivElement>(null);
    const busyRef = useRef(false);
    const currentTemplate = templates[activeTemplate];
    const Icon = currentTemplate.icon;

    useEffect(() => {
        const node = previewRef.current;
        if (!node) return;
        const resize = () => setScale(node.clientWidth / 600);
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const resetFeedback = () => { setFeedback(''); setError(''); setManualMessage(null); };
    useEffect(() => {
        if (previousGender.current === gender) return;
        const oldTemplate = getTemplates(previousGender.current)[activeTemplate];
        const nextTemplate = getTemplates(gender)[activeTemplate];
        // Preserve personally written text; only translate the unchanged defaults.
        setTitle(value => value === oldTemplate.title ? nextTemplate.title : value);
        setCustomMessage(value => value === oldTemplate.reason ? nextTemplate.reason : value);
        resetFeedback();
        previousGender.current = gender;
    }, [gender, activeTemplate]);

    const handleGenerate = async (action: 'queue' | 'download' | 'manual') => {
        if (!badgeRef.current || busyRef.current || !title.trim() || !customMessage.trim()) return;
        busyRef.current = true;
        setIsGenerating(true);
        onBusyChange?.(true);
        resetFeedback();
        try {
            await document.fonts?.ready;
            const blob = await toBlob(badgeRef.current, {
                width: 600, height: 600, pixelRatio: 2,
                style: { transform: 'none', position: 'static', margin: '0', right: 'auto', top: 'auto' },
                backgroundColor: currentTemplate.light
            });
            if (!blob) throw new Error('تعذر إنشاء صورة الوسام. حاول مرة أخرى.');
            const message = `السلام عليكم ولي أمر ${gender === 'female' ? 'الطالبة' : 'الطالب'} *${studentName}*،\nيسرنا منح ${gender === 'female' ? 'ابنتكم' : 'ابنكم'} وسام *${title.trim()}*.\n${customMessage.trim()}\nشكرًا لدعمكم وتشجيعكم المستمر.`;
            const file = new File([blob], `وسام-${studentName.replace(/[\\/:*?"<>|]/g, '-')}.png`, { type: 'image/png' });
            if (action === 'queue') {
                await onSend(file, message);
            } else {
                const url = URL.createObjectURL(file);
                const link = document.createElement('a');
                link.href = url;
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                setFeedback('تم تجهيز صورة الوسام للتحميل.');
                if (action === 'manual') setManualMessage(message);
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'تعذر تجهيز الوسام. حاول مرة أخرى.');
        } finally {
            busyRef.current = false;
            setIsGenerating(false);
            onBusyChange?.(false);
        }
    };

    const invalid = !title.trim() || !customMessage.trim();
    const buttonClass = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

    return (
        <div className="space-y-5 text-slate-800" dir="rtl">
            <div>
                <p className="mb-2 text-xs font-bold text-slate-500">اختر تصميم الوسام</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(Object.keys(templates) as BadgeType[]).map(type => (
                        <button key={type} disabled={isGenerating} aria-pressed={activeTemplate === type}
                            onClick={() => { setActiveTemplate(type); setTitle(templates[type].title); setCustomMessage(templates[type].reason); resetFeedback(); }}
                            className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-colors ${activeTemplate === type ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                            {templates[type].name}
                        </button>
                    ))}
                </div>
            </div>
            <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="min-w-0">
                    <div ref={previewRef} className="relative mx-auto aspect-square w-full max-w-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="معاينة الوسام">
                        <div ref={badgeRef} dir="rtl" style={{ width: 600, height: 600, transform: `scale(${scale})`, transformOrigin: 'top right', color: currentTemplate.color, background: currentTemplate.light, padding: 24, position: 'absolute', right: 0, top: 0 }}>
                            <div style={{ height: '100%', border: '2px solid currentColor', borderRadius: 20, padding: '26px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', textAlign: 'center' }}>
                                <div style={{ fontSize: 16, fontWeight: 700 }}>حاضر · شهادة تقدير وتميز</div>
                                <div style={{ border: '1px solid currentColor', borderRadius: '50%', padding: 18, background: '#ffffff' }}><Icon size={56} strokeWidth={1.5} /></div>
                                <h2 style={{ fontSize: 32, fontWeight: 900, lineHeight: 1.4, overflowWrap: 'anywhere', maxWidth: '100%' }}>{title}</h2>
                                <div style={{ width: '100%' }}>
                                    <p style={{ fontSize: 18, marginBottom: 8 }}>{gender === 'female' ? 'نفتخر بالطالبة' : 'نفتخر بالطالب'}</p>
                                    <h3 style={{ fontSize: studentName.length > 35 ? 27 : 34, fontWeight: 800, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{studentName}</h3>
                                </div>
                                <p style={{ fontSize: 20, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '100%' }}>{customMessage}</p>
                                <div style={{ width: '100%', borderTop: '1px solid currentColor', paddingTop: 12, fontSize: 15 }}>كل إنجاز يستحق التقدير · {new Date().toLocaleDateString('ar-SA', { timeZone: 'Asia/Riyadh' })}</div>
                            </div>
                        </div>
                    </div>
                    <p className="mt-2 text-center text-xs text-slate-500">معاينة مباشرة · صورة PNG عالية الدقة</p>
                </div>
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                    <h4 className="font-bold">تخصيص الوسام</h4>
                    {controlledGender === undefined && (
                        <StudentGenderSelect id="badge-gender" value={gender} onChange={setLocalGender} disabled={isGenerating} />
                    )}
                    <div>
                        <label htmlFor="badge-title" className="mb-2 block text-xs font-bold text-slate-600">عنوان الوسام</label>
                        <input id="badge-title" value={title} maxLength={32} disabled={isGenerating} onChange={e => { setTitle(e.target.value.slice(0, 32)); resetFeedback(); }} className="w-full rounded-lg border border-slate-200 p-2.5 text-sm focus:ring-2 focus:ring-amber-500" />
                    </div>
                    <div>
                        <label htmlFor="badge-message" className="mb-2 block text-xs font-bold text-slate-600">رسالة التقدير</label>
                        <textarea id="badge-message" value={customMessage} maxLength={90} rows={3} disabled={isGenerating} onChange={e => { setCustomMessage(e.target.value.replace(/\s+/g, ' ').slice(0, 90)); resetFeedback(); }} className="w-full resize-none rounded-lg border border-slate-200 p-2.5 text-sm focus:ring-2 focus:ring-amber-500" />
                        <p className="mt-1 text-xs text-slate-500">{customMessage.length}/90 · تظهر في الصورة ورسالة ولي الأمر</p>
                    </div>
                    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                    {feedback && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} />{feedback}</p>}
                    {isGenerating && <p role="status" className="animate-pulse text-sm text-slate-500">جارٍ تجهيز الوسام…</p>}
                    <div className="space-y-2 border-t border-slate-100 pt-4">
                        {onManualSend && <>
                        <button onClick={() => void handleGenerate('manual')} disabled={isGenerating || invalid || !canSend} className={`${buttonClass} bg-emerald-700 text-white hover:bg-emerald-800`}><MessageSquare size={16} />إرسال الوسام يدويًا</button>
                        <p className="text-xs leading-6 text-slate-500">حمّل الصورة، ثم افتح محادثة ولي الأمر وأرفق الصورة من التنزيلات. لا تُرفق الصورة تلقائيًا.</p>
                        {manualMessage && <button onClick={() => { if (onManualSend(manualMessage)) setFeedback('فُتحت المحادثة بالنص الجاهز. أرفق صورة الوسام وأكمل الإرسال في واتساب.'); }} className={`${buttonClass} border border-emerald-700 text-emerald-800`}>فتح محادثة ولي الأمر</button>}
                        </>}
                        <button onClick={() => void handleGenerate('queue')} disabled={isGenerating || invalid || !canSend} className={`${buttonClass} border border-slate-300 text-slate-700 hover:bg-slate-50`}><Send size={16} />إضافة الوسام للطابور</button>
                        <button onClick={() => void handleGenerate('download')} disabled={isGenerating || invalid} className={`${buttonClass} text-slate-600 hover:bg-slate-50`}><Download size={16} />تحميل صورة الوسام</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BadgeStudio;
