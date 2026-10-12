import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Delete, Hash, Loader2, LogOut, Megaphone, Mic, ScanLine, Settings2, Square, Users } from 'lucide-react';
import { db } from '../services/db';
import { dismissals } from '../services/dismissals';
import { auth } from '../services/auth';
import { normalizeStudentId } from '../services/dbHelpers';
import { Role, type Student } from '../types';
import { logError } from '../types/errors';
import { useToast } from '../components/Toast';
import GuardListSelector from '../components/guard/GuardListSelector';
import GuardScanner from '../components/guard/GuardScanner';
import GuardVoiceScreen from '../components/guard/GuardVoiceScreen';
import { matchSpokenStudents } from '../components/guard/guardVoiceMatching';
import { useGuardVoiceInput } from '../hooks/useGuardVoiceInput';
import { buildDismissalStudentDirectory, resolveDismissalStudent } from '../components/dismissal/dismissalUiRules';
import '../components/guard/GuardPhone.css';

type PhoneScreen = 'numpad' | 'list' | 'admin' | 'voice';
type CallFeedback = { kind: 'success' | 'error'; message: string };
const keypad = [
  { digit: '1', letters: '.,؟' }, { digit: '2', letters: 'أ ب ت' }, { digit: '3', letters: 'ج ح خ' },
  { digit: '4', letters: 'د ذ ر' }, { digit: '5', letters: 'س ش ص' }, { digit: '6', letters: 'ط ظ ع' },
  { digit: '7', letters: 'ف ق ك' }, { digit: '8', letters: 'ل م ن' }, { digit: '9', letters: 'ه و ي' }
];
const stationTime = () => new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

const GuardDispatcher: React.FC = () => {
  const [screen, setScreen] = useState<PhoneScreen>('numpad');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [lastCall, setLastCall] = useState<{ name: string; time: string } | null>(null);
  const [feedback, setFeedback] = useState<CallFeedback | null>(null);
  const [dataError, setDataError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [currentTime, setCurrentTime] = useState(stationTime);
  const [voiceSelection, setVoiceSelection] = useState<string | null>(null);
  const voice = useGuardVoiceInput();
  const sendingRef = useRef(false);
  const toast = useToast();
  const navigate = useNavigate();
  const session = auth.getSession();
  const directory = useMemo(() => buildDismissalStudentDirectory(students), [students]);
  const selectedStudent = resolveDismissalStudent(directory.studentById, inputCode);
  const unavailable = loading || Boolean(dataError) || sending;
  const voiceMatches = useMemo(() => voice.phase === 'review'
    ? matchSpokenStudents(directory.students, voice.transcript) : [], [directory.students, voice.phase, voice.transcript]);
  const voiceStudent = (voiceSelection ? voiceMatches.find(student => student.id === voiceSelection)
    : voiceMatches.length === 1 ? voiceMatches[0] : null) || null;
  const canSubmit = !unavailable && (screen === 'voice' ? Boolean(voiceStudent) && !voice.busy
    : screen === 'numpad' && Boolean(inputCode));

  const changeScreen = (next: PhoneScreen) => {
    voice.cancel();
    setVoiceSelection(null);
    setScreen(next);
  };
  const handleVoiceButton = () => {
    if (unavailable) return;
    if (voice.recording) { voice.stop(); return; }
    setVoiceSelection(null);
    setInputCode('');
    setFeedback(null);
    setScreen('voice');
    voice.start();
  };

  useEffect(() => {
    if (!auth.getSession()) { navigate('/login'); return; }
    let cancelled = false;
    const fetchStudents = async () => {
      setLoading(true);
      try {
        const result = await db.getStudents();
        if (cancelled) return;
        setStudents(result);
        setDataError('');
      } catch (error) {
        if (cancelled) return;
        logError(error, 'GuardDispatcher - Load Students');
        setDataError('تعذر تحميل دليل الطلاب. تحقق من الاتصال ثم أعد المحاولة.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchStudents();
    return () => { cancelled = true; };
  }, [loadAttempt, navigate]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(stationTime()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const vibrate = (pattern: number | number[]) => {
    try { navigator.vibrate?.(pattern); } catch { /* Optional device feedback. */ }
  };

  const handleSendCall = async (student: Student) => {
    if (sendingRef.current || unavailable) return;
    const user = auth.getSession();
    if (!user) { navigate('/login'); return; }
    voice.cancel();
    setVoiceSelection(null);
    if (screen === 'voice') {
      setScreen('numpad');
      setInputCode(normalizeStudentId(student.id));
    }
    sendingRef.current = true;
    setSending(true);
    setFeedback(null);
    try {
      const result = await dismissals.execute({
        type: 'request-call', student, requester: { id: user.id, name: user.name }
      });
      const message = result.outcome === 'already-requested'
        ? `يوجد نداء نشط مسبقًا: ${student.name}` : `تم إرسال نداء: ${student.name}`;
      setLastCall({ name: student.name, time: stationTime() });
      setFeedback({ kind: 'success', message });
      setInputCode('');
      setScreen('numpad');
      vibrate([100, 50, 100]);
      toast.success(message);
    } catch (error) {
      logError(error, 'GuardDispatcher - Send Call');
      setFeedback({ kind: 'error', message: 'فشل إرسال النداء. حاول مرة أخرى.' });
      setScreen('numpad');
      // Retain the selected code for retry, including calls from the list/scanner.
      setInputCode(normalizeStudentId(student.id));
      toast.error('فشل في إرسال النداء');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const showInvalidCode = () => {
    setFeedback({ kind: 'error', message: 'رقم الطالب غير موجود في الدليل النشط.' });
    setScreen('numpad');
    vibrate(200);
  };
  const handleSubmit = () => {
    if (!canSubmit) return;
    if (screen === 'voice') {
      // A recognition result only selects a candidate; this explicit click sends it.
      if (voiceStudent && voice.phase === 'review') void handleSendCall(voiceStudent);
      return;
    }
    if (selectedStudent) void handleSendCall(selectedStudent);
    else showInvalidCode();
  };
  const updateCode = (value: string) => {
    if (unavailable) return;
    setInputCode(normalizeStudentId(value).replace(/[^0-9]/g, '').slice(0, 10));
    setFeedback(null);
    changeScreen('numpad');
  };
  const handleDigit = (digit: string) => { updateCode(inputCode + digit); vibrate(20); };
  const statusLabel = loading ? 'تحميل الدليل' : dataError ? 'تعذر الاتصال' : sending ? 'جارٍ الإرسال'
    : voice.recording ? 'المايك مفتوح' : voice.phase === 'processing' ? 'جارٍ التعرف على الصوت'
      : screen === 'voice' && voiceStudent ? 'بانتظار التأكيد' : 'جاهزة للنداء';

  return (
    <main dir="rtl" className="guard-phone-page">
      <section className="guard-phone" aria-label="محطة النداء">
        <header className="guard-phone__brand">
          <div className="guard-phone__speaker" aria-hidden="true" />
          <h1>نداء المدرسة</h1>
        </header>
        <div className="guard-phone__bezel">
          <div className="guard-phone__lcd" aria-busy={loading || sending}>
            <div className="guard-phone__statusbar">
              <span className="guard-phone__badge">محطة النداء</span>
              <time>{currentTime}</time>
              <span className="guard-phone__signal" aria-hidden="true" data-active={!loading && !dataError}><i /><i /><i /><i /></span>
            </div>
            {screen === 'admin' ? (
              <div className="guard-phone__menu">
                <div className="guard-phone__screen-title">
                  <h2>إدارة المحطة</h2>
                  <button type="button" onClick={() => changeScreen('numpad')}><ArrowRight size={14} /> رجوع</button>
                </div>
                <p className="guard-phone__operator">{session?.name || 'محطة النداء'}</p>
                <p>{directory.students.length} طالب في الدليل النشط</p>
                <button type="button" className="guard-phone__lcd-button" disabled={unavailable} onClick={() => setScannerOpen(true)}><ScanLine size={18} /> مسح باركود الطالب</button>
                {session && session.role !== Role.CALL_STATION && (
                  <button type="button" className="guard-phone__lcd-button" disabled={sending} onClick={() => navigate('/')}><ArrowRight size={18} /> العودة للرئيسية</button>
                )}
                <button type="button" className="guard-phone__lcd-button" disabled={sending} onClick={() => auth.logout()}><LogOut size={18} /> تسجيل الخروج</button>
              </div>
            ) : loading ? (
              <div className="guard-phone__notice" role="status"><Loader2 size={30} className="guard-phone__spinner" /><strong>جارٍ تحميل دليل الطلاب…</strong><span>لحظات وتكون المحطة جاهزة</span></div>
            ) : dataError ? (
              <div className="guard-phone__notice" role="alert">
                <strong>تعذر تحميل الدليل</strong><p>{dataError}</p>
                <button type="button" className="guard-phone__lcd-button" onClick={() => setLoadAttempt(value => value + 1)}>إعادة المحاولة</button>
              </div>
            ) : screen === 'voice' ? (
              <GuardVoiceScreen voice={voice} matches={voiceMatches} selected={voiceStudent} onSelect={setVoiceSelection} onClose={() => changeScreen('numpad')} />
            ) : screen === 'list' ? (
              <GuardListSelector students={directory.students} onSelect={handleSendCall} disabled={sending} />
            ) : (
              <form className="guard-phone__dial-screen" onSubmit={event => { event.preventDefault(); handleSubmit(); }}>
                <label htmlFor="guard-student-code">أدخل رقم الطالب</label>
                <input id="guard-student-code" className={`guard-phone__number ${inputCode.length > 6 ? 'guard-phone__number--long' : ''}`}
                  dir="ltr" type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="----" value={inputCode} disabled={sending}
                  onChange={event => updateCode(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') updateCode(''); }} />
                <div className="guard-phone__feedback" role={feedback?.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
                  <div className="guard-phone__headline">
                    <span aria-hidden="true">&gt;</span>
                    <strong>{sending ? 'جارٍ إرسال النداء…' : feedback?.kind === 'error' ? 'تعذر النداء' : feedback?.kind === 'success' ? 'تم تسجيل الطلب' : selectedStudent ? 'جاهز لإرسال النداء' : 'بانتظار رقم الطالب'}</strong>
                    <span className="guard-phone__cursor" aria-hidden="true" />
                  </div>
                  <p>{feedback?.message || (selectedStudent ? `${selectedStudent.name} · ${selectedStudent.class_name} / ${selectedStudent.section}` : 'اكتب الرقم ثم اضغط زر النداء الأخضر')}</p>
                </div>
                <div className="guard-phone__blocks" aria-hidden="true">
                  {Array.from({ length: 12 }, (_, index) => <span key={index} data-on={sending || Boolean(selectedStudent) || feedback?.kind === 'success' || index < 3} className={sending ? 'guard-phone__pulse' : undefined} />)}
                </div>
                <div className="guard-phone__last-call">
                  <span>{lastCall ? 'آخر نداء' : 'دليل الطلاب'}</span><strong>{lastCall?.name || `${directory.students.length} طالب`}</strong>{lastCall && <time>{lastCall.time}</time>}
                </div>
                <div className="guard-phone__screen-actions">
                  <button type="button" onClick={() => updateCode(inputCode.slice(0, -1))} disabled={!inputCode || sending} aria-label="حذف آخر رقم"><Delete size={15} /> حذف</button>
                  <button type="button" onClick={() => setScannerOpen(true)} disabled={sending}><ScanLine size={15} /> مسح الباركود</button>
                </div>
              </form>
            )}
            <div className="guard-phone__screen-footer"><span>{statusLabel}</span><span>حاضر</span></div>
          </div>
        </div>
        <div className="guard-phone__soft-keys">
          <button type="button" className="guard-phone__soft-key guard-phone__soft-key--call" disabled={!canSubmit} onClick={handleSubmit}>
            {sending ? <Loader2 size={22} className="guard-phone__spinner" /> : <Megaphone size={22} />}<span>{sending ? 'جارٍ النداء' : screen === 'voice' ? 'تأكيد وإرسال' : 'إرسال نداء'}</span>
          </button>
          <button type="button" className="guard-phone__soft-key" aria-pressed={screen === 'admin'} disabled={sending} onClick={() => changeScreen(screen === 'admin' ? 'numpad' : 'admin')}><Settings2 size={22} /><span>الإدارة</span></button>
        </div>
        <div className="guard-phone__tools">
          <button type="button" className="guard-phone__menu-key" disabled={unavailable} aria-pressed={screen === 'list'} onClick={() => changeScreen(screen === 'list' ? 'numpad' : 'list')}>
            {screen === 'list' ? <Hash size={17} /> : <Users size={17} />}{screen === 'list' ? 'لوحة الأرقام' : 'الطلاب'}
          </button>
          <button type="button" className="guard-phone__menu-key guard-phone__voice-key" data-recording={voice.recording} aria-pressed={voice.recording}
            aria-label={voice.recording ? 'إيقاف التسجيل' : 'تسجيل اسم الطالب'} disabled={unavailable || voice.phase === 'processing'} onClick={handleVoiceButton}>
            {voice.recording ? <Square size={16} /> : <Mic size={18} />}{voice.recording ? 'إيقاف التسجيل' : 'تسجيل الاسم'}
          </button>
        </div>
        <div className="guard-phone__keypad" dir="ltr" role="group" aria-label="لوحة أرقام الطالب">
          {keypad.map(({ digit, letters }) => (
            <button type="button" key={digit} className={`guard-phone__key ${digit === '5' ? 'guard-phone__key--center' : ''}`} disabled={unavailable} onClick={() => handleDigit(digit)} aria-label={digit}>
              <span className="guard-phone__digit">{digit}</span><span className="guard-phone__letters" dir="rtl">{letters}</span>
            </button>
          ))}
          <button type="button" className="guard-phone__key" aria-label="مسح الرقم" disabled={unavailable || !inputCode} onClick={() => updateCode('')}><span className="guard-phone__digit">*</span><span className="guard-phone__letters">مسح</span></button>
          <button type="button" className="guard-phone__key" aria-label="0" disabled={unavailable} onClick={() => handleDigit('0')}><span className="guard-phone__digit">0</span><span className="guard-phone__letters">+</span></button>
          <button type="button" className="guard-phone__key" aria-label="تأكيد النداء" disabled={!canSubmit} onClick={handleSubmit}><span className="guard-phone__digit">#</span><span className="guard-phone__letters">نداء</span></button>
        </div>
        <div className="guard-phone__signature" aria-hidden="true">HADER · SCHOOL CALL</div>
      </section>
      {scannerOpen && <GuardScanner disabled={unavailable} onClose={() => setScannerOpen(false)} onScan={code => {
        if (unavailable || sendingRef.current) return;
        setScannerOpen(false);
        setScreen('numpad');
        setInputCode(normalizeStudentId(code));
        const student = resolveDismissalStudent(directory.studentById, code);
        if (student) void handleSendCall(student);
        else showInvalidCode();
      }} />}
    </main>
  );
};
export default GuardDispatcher;
