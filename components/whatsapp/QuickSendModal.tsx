import React, { useState, useEffect } from 'react';
import { X, MessageSquare, Send, CheckCircle, Award, AlertCircle } from 'lucide-react';
import { Student } from '../../types';
import BadgeStudio from './BadgeStudio';
import { useToast } from '../Toast';
import { whatsappGateway } from '../../services/whatsappGateway';
import { resolveStudentWhatsAppPhone } from '../supervision/supervisionCommunication';

interface QuickSendModalProps {
    isOpen: boolean;
    onClose: () => void;
    student: Student | null;
    defaultTemplateId?: string;
    onQueued?: (event: { student: Student; message: string; phone: string; kind: 'message' | 'badge' }) => void;
    onFailed?: (event: { student: Student; error: string; kind: 'message' | 'badge' }) => void;
}

const TEMPLATES = [
    { id: 'custom', name: 'رسالة مخصصة', content: '' },
    { id: 'late_warning', name: 'تنبيه تأخر', content: 'السلام عليكم، نود تذكيركم بأن الطالب {StudentName} قد تأخر عن الحضور اليوم. نرجو الحرص على الحضور في الوقت المحدد.' },
    { id: 'absent_warning', name: 'تنبيه غياب', content: 'السلام عليكم، نفيدكم بغياب الطالب {StudentName} اليوم. نرجو تزويدنا بالمبرر إن وجد.' },
    { id: 'behavior_warning', name: 'تنبيه سلوكي', content: 'السلام عليكم، نود تنبيهكم بخصوص سلوك الطالب {StudentName} اليوم. نرجو التواصل معنا لمناقشة الأمر.' },
    { id: 'praise', name: 'شكر وتقدير', content: 'السلام عليكم، نشكر الطالب {StudentName} على تميزه والتزامه اليوم. بارك الله في جهودكم.' },
    { id: 'exam_reminder', name: 'تذكير اختبار', content: 'السلام عليكم، تذكير بموعد اختبار {StudentName} غداً. نرجو الاستعداد الجيد.' },
    { id: 'event_invitation', name: 'دعوة ولي أمر', content: 'السلام عليكم، ندعوكم لحضور مجلس الآباء الخاص بالطالب {StudentName} يوم ...' },
];

const QuickSendModal: React.FC<QuickSendModalProps> = ({ isOpen, onClose, student, defaultTemplateId = 'custom', onQueued, onFailed }) => {
    const toast = useToast();
    const [message, setMessage] = useState('');
    const [templateId, setTemplateId] = useState(defaultTemplateId);
    const [sending, setSending] = useState(false);
    const [status, setStatus] = useState<'idle' | 'queued' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [mode, setMode] = useState<'message' | 'badge'>('message');

    useEffect(() => {
        if (isOpen && student) {
            setTemplateId(defaultTemplateId);
            setStatus('idle');
            setErrorMessage('');
            setMode('message');
            // Initialize message based on default template
            const tpl = TEMPLATES.find(t => t.id === defaultTemplateId);
            if (tpl && tpl.id !== 'custom') {
                setMessage(tpl.content.replace('{StudentName}', student.name));
            } else {
                setMessage('');
            }
        }
    }, [isOpen, student, defaultTemplateId]);

    const handleTemplateChange = (id: string) => {
        setTemplateId(id);
        setStatus('idle');
        setErrorMessage('');
        const tpl = TEMPLATES.find(t => t.id === id);
        if (tpl && student) {
            if (id === 'custom') setMessage('');
            else setMessage(tpl.content.replace('{StudentName}', student.name));
        }
    };

    const handleSendMessage = async () => {
        if (!student) return;
        if (!message.trim()) {
            setStatus('error');
            setErrorMessage('اكتب نص الرسالة قبل إضافتها للطابور.');
            return;
        }
        setSending(true);
        setStatus('idle');
        setErrorMessage('');
        try {
            const phone = resolveStudentWhatsAppPhone(student);
            if (!phone) throw new Error('لا يوجد رقم واتساب سعودي صالح للطالب');

            const payload = {
                phone: phone,
                message: message.trim(),
                student_name: student.name
            };

            await whatsappGateway.enqueue([payload]);
            setStatus('queued');
            onQueued?.({ student, message: payload.message, phone, kind: 'message' });
        } catch (e) {
            setStatus('error');
            const failureMessage = e instanceof Error ? e.message : 'تعذر الاتصال بخادم واتساب';
            setErrorMessage(failureMessage);
            onFailed?.({ student, error: failureMessage, kind: 'message' });
        } finally {
            setSending(false);
        }
    };

    // Handler for Badge Studio
    const handleBadgeSend = async (file: File, certMessage: string) => {
        if (!student) return;
        setSending(true);
        setStatus('idle');
        setErrorMessage('');
        try {
            const filePath = await whatsappGateway.upload(file);

            // 2. Queue for Sending
            const phone = resolveStudentWhatsAppPhone(student);
            if (!phone) throw new Error('لا يوجد رقم واتساب سعودي صالح للطالب');

            const payload = {
                phone: phone,
                message: certMessage,
                student_name: student.name,
                attachment: filePath, // Use the uploaded file path
                status_label: 'وسام'
            };

            await whatsappGateway.enqueue([payload]);
            setStatus('queued');
            onQueued?.({ student, message: certMessage, phone, kind: 'badge' });

        } catch (e) {
            setStatus('error');
            const message = e instanceof Error ? e.message : 'تعذر الاتصال بخادم واتساب';
            setErrorMessage(message);
            toast.error(message);
            onFailed?.({ student, error: message, kind: 'badge' });
        } finally {
            setSending(false);
        }
    };

    if (!isOpen || !student) return null;
    const resolvedPhone = resolveStudentWhatsAppPhone(student);

    return (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 backdrop-blur-sm bg-black/60 animate-in fade-in duration-200">
            <div
                className={`bg-[#f8fafc] dark:bg-[#1a1f2e] border border-white/10 w-full rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col transition-all ${mode === 'badge' ? 'max-w-5xl h-[85vh]' : 'max-w-md'
                    }`}
                dir="rtl"
            >

                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-white/10 flex justify-between items-center bg-white dark:bg-[#1e2538]">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${mode === 'badge' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
                            {mode === 'badge' ? <Award className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 dark:text-white text-lg">{student.name}</h3>
                            <p className="text-xs text-gray-500">{mode === 'badge' ? 'استوديو الأوسمة' : 'إرسال رسالة واتساب'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Tab Switcher in Header */}
                        <div className="flex bg-slate-100 dark:bg-black/20 p-1 rounded-lg">
                            <button
                                onClick={() => setMode('message')}
                                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'message' ? 'bg-white shadow text-slate-800' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                رسالة
                            </button>
                            <button
                                onClick={() => setMode('badge')}
                                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${mode === 'badge' ? 'bg-white shadow text-amber-600' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                وسام
                            </button>
                        </div>
                        <button onClick={onClose} disabled={sending} className="p-2 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full text-gray-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40" aria-label="إغلاق الإرسال الذكي">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden relative bg-slate-50 dark:bg-[#1a1f2e]">
                    {mode === 'message' ? (
                        <div className="p-5 space-y-4">
                            {/* Template Select */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 mb-2 block">القالب</label>
                                <div className="flex flex-wrap gap-2">
                                    {TEMPLATES.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => handleTemplateChange(t.id)}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${templateId === t.id
                                                ? 'bg-green-500/10 border-green-500 text-green-600'
                                                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                                }`}
                                        >
                                            {t.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Message Area */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 mb-2 block">نص الرسالة</label>
                                <textarea
                                    value={message}
                                    onChange={(e) => { setMessage(e.target.value); setStatus('idle'); setErrorMessage(''); }}
                                    className="w-full h-32 bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-green-500/50 transition-shadow"
                                    placeholder="اكتب رسالتك هنا..."
                                />
                            </div>

                            {status === 'error' && (
                                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{errorMessage}</span>
                                </div>
                            )}

                            {status === 'queued' && (
                                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700" role="status">
                                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>أضيفت الرسالة إلى طابور واتساب. تابع حالة التسليم من إدارة الرسائل.</span>
                                </div>
                            )}

                            {/* Footer for Message Mode */}
                            <div className="pt-4 flex justify-between items-center">
                                <span className="text-xs text-slate-400 font-mono">
                                    {resolvedPhone || 'رقم واتساب غير صالح'}
                                </span>
                                <button
                                    onClick={handleSendMessage}
                                    disabled={sending || !message.trim() || !resolvedPhone || status === 'queued'}
                                    className={`px-6 py-2 rounded-xl font-bold flex items-center gap-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${status === 'queued'
                                        ? 'bg-green-500 text-white'
                                        : status === 'error'
                                            ? 'bg-red-500 text-white'
                                            : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-600/20'
                                        }`}
                                >
                                    {sending ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> :
                                        status === 'queued' ? <><CheckCircle className="w-4 h-4" /> أضيف للطابور</> :
                                            status === 'error' ? <><Send className="w-4 h-4" /> إعادة المحاولة</> :
                                                <><Send className="w-4 h-4" /> إضافة للطابور</>}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full p-4">
                            <BadgeStudio
                                studentName={student.name}
                                onSend={handleBadgeSend}
                                onCancel={onClose}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default QuickSendModal;
