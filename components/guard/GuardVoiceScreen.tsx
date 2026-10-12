import React from 'react';
import { ArrowRight, Check, Mic } from 'lucide-react';
import type { Student } from '../../types';
import type { GuardVoiceState } from '../../hooks/useGuardVoiceInput';

interface Props {
  voice: GuardVoiceState;
  matches: Student[];
  selected: Student | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function GuardVoiceScreen({ voice, matches, selected, onSelect, onClose }: Props) {
  const listening = voice.phase === 'starting' || voice.phase === 'listening';
  const reviewing = voice.phase === 'review';
  return (
    <div className="guard-voice">
      <div className="guard-phone__screen-title">
        <h2>النداء بالصوت</h2>
        <button type="button" onClick={onClose}><ArrowRight size={14} /> إلغاء</button>
      </div>
      <div className="guard-voice__status" role={voice.phase === 'error' ? 'alert' : 'status'} aria-live="polite">
        {listening && <Mic size={24} className="guard-phone__pulse" aria-hidden="true" />}
        <strong>{voice.phase === 'starting' ? 'جارٍ فتح المايك…' : voice.phase === 'listening' ? 'أسمعك… قل اسم الطالب' : voice.phase === 'processing' ? 'جارٍ التعرف على الاسم…' : reviewing ? 'الاسم المسموع' : voice.phase === 'error' ? 'تعذر التسجيل' : 'اضغط المايك لتسجيل الاسم'}</strong>
        {voice.transcript && <p className="guard-voice__transcript">«{voice.transcript}»</p>}
        {voice.error && <p>{voice.error}</p>}
        {reviewing && <p>{matches.length === 0 ? 'لم أجد اسمًا مطابقًا. أعد التسجيل بالاسم الكامل أو اختر الطالب من القائمة.' : matches.length > 1 && !selected ? `يوجد ${matches.length} أسماء مطابقة. اختر الطالب المقصود.` : 'راجع الاسم والصف ثم اضغط «تأكيد وإرسال».'}</p>}
      </div>
      {reviewing && matches.length > 0 && (
        <div className="guard-voice__matches" role="group" aria-label="الأسماء المطابقة للصوت">
          {matches.map(student => (
            <button type="button" key={student.id} className="guard-voice__student" aria-pressed={selected?.id === student.id} onClick={() => onSelect(student.id)}>
              <span><strong>{student.name}</strong><small>{student.class_name} / {student.section || 'بدون فصل'} · <bdi>{student.id}</bdi></small></span>
              {selected?.id === student.id && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
      {listening && <p className="guard-voice__hint">قل الاسم كاملًا، ثم انتظر أو اضغط «إيقاف التسجيل».</p>}
      {reviewing && selected && <p className="guard-voice__hint">بانتظار تأكيدك — لم يُرسل النداء بعد.</p>}
    </div>
  );
}
