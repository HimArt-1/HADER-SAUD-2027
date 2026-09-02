import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/db';
import { Student, AttendanceRecord, SchoolClass, DismissalRecord, User, SystemSettings } from '../types';
import { accessPolicy } from '../modules/access';
import { FileText, Download, Calendar, User as UserIcon, Search, Filter, Loader2, BarChart2, AlertCircle, CheckCircle2, Clock, DoorOpen, BrainCircuit } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfYear, isAfter, startOfWeek, endOfWeek, subWeeks, parseISO } from 'date-fns';
import { arSA } from 'date-fns/locale';
import AttendanceIntelligenceReport from '../components/reports/AttendanceIntelligenceReport';

const {
  filterStudentsBySupervisorScope,
  filterSchoolClassesBySupervisorScope,
  isSupervisorScopedRole
} = accessPolicy;

const getAttendanceIntelligencePeriod = (weekStartDate: string) => {
    const weekStart = startOfWeek(parseISO(weekStartDate), { weekStartsOn: 0 });
    return {
        startDate: format(subWeeks(weekStart, 7), 'yyyy-MM-dd'),
        endDate: format(endOfWeek(weekStart, { weekStartsOn: 0 }), 'yyyy-MM-dd')
    };
};

// Report Types
type ReportType = 'monthly' | 'student_profile' | 'chronic_absence' | 'dismissal' | 'attendance_intelligence';

const Reports: React.FC<{ user: User }> = ({ user }) => {
    const [activeTab, setActiveTab] = useState<ReportType>('monthly');
    const [loading, setLoading] = useState(false);
    const [students, setStudents] = useState<Student[]>([]);
    const [classes, setClasses] = useState<SchoolClass[]>([]);
    const [settings, setSettings] = useState<SystemSettings | null>(null);

    // Filters
    const [selectedClass, setSelectedClass] = useState<string>('all');
    const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
    const [selectedWeekStart, setSelectedWeekStart] = useState(() =>
        format(startOfWeek(new Date(), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    );

    // Student Profile Filters
    const [selectedStudentId, setSelectedStudentId] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');

    // Chronic Absence Filters
    const [absenceThreshold, setAbsenceThreshold] = useState<number>(3); // Days

    // Data
    const [attendanceData, setAttendanceData] = useState<AttendanceRecord[]>([]);
    const [dismissalData, setDismissalData] = useState<DismissalRecord[]>([]);

    useEffect(() => {
        void loadInitialData();
    }, [user]);

    const loadInitialData = async () => {
        setLoading(true);
        try {
            const [s, c, systemSettings] = await Promise.all([
                db.getStudents(),
                db.getClasses(),
                db.getSettings()
            ]);
            let nextStudents = s;
            let nextClasses = c;
            if (isSupervisorScopedRole(user)) {
                nextStudents = filterStudentsBySupervisorScope(s, user);
                nextClasses = filterSchoolClassesBySupervisorScope(c, user);
            }
            setStudents(nextStudents);
            setClasses(nextClasses);
            setSettings(systemSettings);
        } catch (error) {
            console.error('Error loading report data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateReport = async () => {
        setLoading(true);
        setAttendanceData([]); // Clear previous data
        try {
            let startStr = '';
            let endStr = '';

            if (activeTab === 'monthly') {
                const start = startOfMonth(selectedMonth);
                const end = endOfMonth(selectedMonth);
                startStr = format(start, 'yyyy-MM-dd');
                endStr = format(end, 'yyyy-MM-dd');
            } else if (activeTab === 'student_profile' || activeTab === 'chronic_absence') {
                // Fetch academic year data (approximate start from Aug/Sept or just start of current year)
                // For simplicity, let's fetch current year to now. 
                // In a real app, this might be configured per academic year.
                const start = startOfYear(new Date());
                const end = new Date(); // To today
                startStr = format(start, 'yyyy-MM-dd');
                endStr = format(end, 'yyyy-MM-dd');
            } else if (activeTab === 'attendance_intelligence') {
                const intelligencePeriod = getAttendanceIntelligencePeriod(selectedWeekStart);
                startStr = intelligencePeriod.startDate;
                endStr = intelligencePeriod.endDate;
            }

            if (startStr && endStr) {
                const records = await db.getAttendanceRange(startStr, endStr);
                setAttendanceData(records);

                // Also fetch dismissal data
                const dismissals = await db.getDismissalsByDateRange(startStr, endStr);
                setDismissalData(dismissals);
            }

        } catch (error) {
            console.error('Error generating report:', error);
        } finally {
            setLoading(false);
        }
    };

    // Helper to get days in month
    const getDaysInMonth = () => {
        return eachDayOfInterval({
            start: startOfMonth(selectedMonth),
            end: endOfMonth(selectedMonth)
        });
    };

    // --- RENDERERS ---

    // Pre-compute attendance lookup map for O(1) access: Map<student_id, Map<date, record>>
    const attendanceLookup = useMemo(() => {
        const map = new Map<string, Map<string, AttendanceRecord>>();
        for (const r of attendanceData) {
            let studentMap = map.get(r.student_id);
            if (!studentMap) {
                studentMap = new Map();
                map.set(r.student_id, studentMap);
            }
            studentMap.set(r.date, r);
        }
        return map;
    }, [attendanceData]);

    const intelligencePeriod = useMemo(
        () => getAttendanceIntelligencePeriod(selectedWeekStart),
        [selectedWeekStart]
    );

    const intelligenceStudents = useMemo(() => selectedClass === 'all'
        ? students
        : students.filter(student => student.class_name === selectedClass), [selectedClass, students]);

    const renderMonthlyReport = () => {
        const days = getDaysInMonth();
        const now = new Date(); // hoist outside loop
        const filteredStudents = selectedClass === 'all'
            ? students
            : students.filter(s => s.class_name === selectedClass);

        if (filteredStudents.length === 0) {
            return <div className="text-center p-8 text-slate-400">لا يوجد طلاب في هذا الفصل</div>;
        }

        return (
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                    <thead className="bg-slate-800 text-slate-200">
                        <tr>
                            <th className="p-3 sticky right-0 bg-slate-800 min-w-[200px] z-10">الطالب</th>
                            {days.map(day => (
                                <th key={day.toISOString()} className="p-2 min-w-[40px] text-center border-l border-slate-700">
                                    <div className="text-[10px] opacity-70">{format(day, 'EEE', { locale: arSA })}</div>
                                    <div className="font-bold">{format(day, 'd')}</div>
                                </th>
                            ))}
                            <th className="p-3 min-w-[80px] text-center bg-red-900/20">غياب</th>
                            <th className="p-3 min-w-[80px] text-center bg-amber-900/20">تأخير</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700 bg-slate-900/50">
                        {filteredStudents.map(student => {
                            const studentMap = attendanceLookup.get(student.id);
                            let absenceCount = 0;
                            let lateCount = 0;

                            return (
                                <tr key={student.id} className="hover:bg-primary-500/5 transition-colors group">
                                    <td className="p-3 sticky right-0 bg-slate-900/95 group-hover:bg-slate-800 font-medium text-white border-l border-primary-500/10 z-10">
                                        {student.name}
                                        <div className="text-[10px] text-primary-400">{student.class_name} - {student.section}</div>
                                    </td>
                                    {days.map(day => {
                                        const dateStr = format(day, 'yyyy-MM-dd');
                                        const record = studentMap?.get(dateStr);
                                        const status = record?.status;

                                        if (status === 'absent') absenceCount++;
                                        if (status === 'late') lateCount++;

                                        return (
                                            <td key={day.toISOString()} className="p-1 text-center border-l border-slate-800">
                                                {status === 'present' ? <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto transition-transform hover:scale-150" title={`حاضر (${dateStr})`} /> :
                                                    status === 'late' ? <div className="w-2 h-2 rounded-full bg-amber-500 mx-auto transition-transform hover:scale-150" title={`تأخير ${record?.minutes_late}د (${dateStr})`} /> :
                                                        status === 'absent' ? <div className="w-2 h-2 rounded-full bg-red-500 mx-auto transition-transform hover:scale-150" title={`غائب (${dateStr})`} /> :
                                                            (isAfter(day, now) ? <div className="w-1 h-1 rounded-full bg-slate-800 mx-auto" /> : <div className="w-1 h-1 rounded-full bg-slate-700 mx-auto" />)}
                                            </td>
                                        );
                                    })}
                                    <td className="p-3 text-center font-bold text-red-400 bg-red-900/10">{absenceCount}</td>
                                    <td className="p-3 text-center font-bold text-amber-400 bg-amber-900/10">{lateCount}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderStudentProfileReport = () => {
        const filteredStudents = students.filter(s =>
            s.name.includes(searchTerm) || s.id.includes(searchTerm)
        ).slice(0, 10); // Limit results

        const selectedStudent = students.find(s => s.id === selectedStudentId);

        // Stats
        const studentRecords = attendanceData.filter(r => r.student_id === selectedStudentId);
        const absenceCount = studentRecords.filter(r => r.status === 'absent').length;
        const lateCount = studentRecords.filter(r => r.status === 'late').length;
        const lateMinutes = studentRecords.reduce((acc, curr) => acc + (curr.minutes_late || 0), 0);
        const presentCount = studentRecords.filter(r => r.status === 'present').length;

        return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Sidebar Selection */}
                <div className="md:col-span-1 space-y-4 border-l border-slate-700 pl-4">
                    <div>
                        <label className="text-xs text-slate-400 mb-1 block">بحث عن طالب</label>
                        <div className="relative">
                            <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="اسم الطالب..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg pr-10 pl-4 py-2 text-white focus:outline-none focus:border-primary-500"
                            />
                        </div>
                    </div>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {filteredStudents.map(student => (
                            <button
                                key={student.id}
                                onClick={() => setSelectedStudentId(student.id)}
                                className={`w-full text-right p-3 rounded-lg transition-all flex items-center justify-between ${selectedStudentId === student.id
                                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                    }`}
                            >
                                <div>
                                    <div className="font-bold text-sm">{student.name}</div>
                                    <div className="text-[10px] opacity-70">{student.class_name}</div>
                                </div>
                                {selectedStudentId === student.id && <CheckCircle2 className="w-4 h-4" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Main Content */}
                <div className="md:col-span-3">
                    {!selectedStudent ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50">
                            <UserIcon className="w-16 h-16 mb-4" />
                            <p>اختر طالباً لعرض ملفه الشخصي</p>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-fade-in-up">
                            {/* Profile Header */}
                            <div className="flex justify-between items-start bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-2xl border border-slate-700">
                                <div className="flex gap-4">
                                    <div className="w-16 h-16 rounded-full bg-primary-900/30 flex items-center justify-center border-2 border-primary-500/30 text-2xl font-bold text-primary-400">
                                        {selectedStudent.name.charAt(0)}
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-white mb-1">{selectedStudent.name}</h2>
                                        <div className="flex gap-4 text-sm text-slate-400">
                                            <span>{selectedStudent.class_name}</span>
                                            <span>•</span>
                                            <span>{selectedStudent.section}</span>
                                            <span>•</span>
                                            <span>ID: {selectedStudent.id}</span>
                                        </div>
                                    </div>
                                </div>
                                {/* Stats Cards */}
                                <div className="flex gap-4">
                                    <div className="text-center px-4 py-2 bg-red-500/10 rounded-xl border border-red-500/20">
                                        <div className="text-2xl font-bold text-red-400">{absenceCount}</div>
                                        <div className="text-[10px] text-red-200 uppercase">غياب</div>
                                    </div>
                                    <div className="text-center px-4 py-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
                                        <div className="text-2xl font-bold text-amber-400">{lateCount}</div>
                                        <div className="text-[10px] text-amber-200 uppercase">تأخير</div>
                                    </div>
                                    <div className="text-center px-4 py-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                                        <div className="text-2xl font-bold text-emerald-400">{presentCount}</div>
                                        <div className="text-[10px] text-emerald-200 uppercase">حضور</div>
                                    </div>
                                </div>
                            </div>

                            {/* Timeline / Records */}
                            <div>
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-primary-400" />
                                    سجل الحضور
                                </h3>
                                {studentRecords.length === 0 ? (
                                    <div className="p-8 text-center bg-slate-800/50 rounded-xl border border-slate-700 border-dashed text-slate-400">
                                        لا توجد سجلات لهذا الطالب في الفترة المحددة
                                    </div>
                                ) : (
                                    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                                        <table className="w-full text-right text-sm">
                                            <thead className="bg-slate-900 text-slate-400">
                                                <tr>
                                                    <th className="p-4">التاريخ</th>
                                                    <th className="p-4">اليوم</th>
                                                    <th className="p-4">الحالة</th>
                                                    <th className="p-4">الوقت</th>
                                                    <th className="p-4">ملاحظات</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-700/50">
                                                {studentRecords
                                                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                                    .map(record => (
                                                        <tr key={record.id} className="hover:bg-slate-700/30 transition-colors">
                                                            <td className="p-4 font-mono text-slate-300">{record.date}</td>
                                                            <td className="p-4 text-slate-300">{format(new Date(record.date), 'EEEE', { locale: arSA })}</td>
                                                            <td className="p-4">
                                                                {record.status === 'present' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">حاضر</span>}
                                                                {record.status === 'absent' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">غائب</span>}
                                                                {record.status === 'late' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">تأخير</span>}
                                                            </td>
                                                            <td className="p-4 text-slate-300">
                                                                {record.timestamp ? format(new Date(record.timestamp), 'hh:mm a') : '-'}
                                                            </td>
                                                            <td className="p-4 text-slate-400 truncate max-w-[200px]">
                                                                {record.status === 'late' && record.minutes_late && record.minutes_late > 0 ?
                                                                    <span className="text-amber-400">تأخير {record.minutes_late} دقيقة</span>
                                                                    : '-'
                                                                }
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Chronic absence analysis — must be at top level (React hooks rules)
    const chronicAnalysis = useMemo(() => {
        const map = new Map<string, { student: Student; absences: number; lates: number }>();

        attendanceData.forEach(record => {
            if (!map.has(record.student_id)) {
                const student = students.find(s => s.id === record.student_id);
                if (student) {
                    map.set(record.student_id, { student, absences: 0, lates: 0 });
                }
            }

            const entry = map.get(record.student_id);
            if (entry) {
                if (record.status === 'absent') entry.absences++;
                if (record.status === 'late') entry.lates++;
            }
        });

        return Array.from(map.values())
            .filter(item => item.absences >= absenceThreshold)
            .sort((a, b) => b.absences - a.absences);
    }, [attendanceData, students, absenceThreshold]);

    const renderChronicAbsenceReport = () => {

        return (
            <div className="space-y-6">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-4 bg-red-900/10 border border-red-500/20 p-4 rounded-xl">
                    <AlertCircle className="w-5 h-5 text-red-400" />
                    <span className="text-red-200 font-bold">تنبيه الحالات الحرجة</span>
                    <div className="h-6 w-px bg-red-500/20 mx-2" />
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-300">عرض الطلاب الذين تجاوزوا</span>
                        <input
                            type="number"
                            min="1"
                            value={absenceThreshold}
                            onChange={(e) => setAbsenceThreshold(parseInt(e.target.value) || 1)}
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-center text-white focus:border-red-500 focus:outline-none"
                        />
                        <span className="text-sm text-slate-300">أيام غياب</span>
                    </div>
                </div>

                {/* Results Table */}
                <div className="glass-card overflow-hidden">
                    <table className="w-full text-right">
                        <thead className="bg-slate-900/80 text-slate-300 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="p-4">الطالب</th>
                                <th className="p-4">الفصل</th>
                                <th className="p-4 text-center">أيام الغياب</th>
                                <th className="p-4 text-center">نسبة الحضور التقديرية</th>
                                <th className="p-4 text-center">الإجراء</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                            {chronicAnalysis.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-500">
                                        رائع! لا توجد حالات تجاوزت الحد المسموح ({absenceThreshold} أيام)
                                    </td>
                                </tr>
                            ) : (
                                chronicAnalysis.map(({ student, absences, lates }) => {
                                    // Rough calculation assuming 20 days per month * number of months loaded... 
                                    // or just relative to total records found for this student if we assume constant logging.
                                    // Better: Just show counts.
                                    return (
                                        <tr key={student.id} className="hover:bg-red-500/5 transition-colors">
                                            <td className="p-4 font-bold text-white">{student.name}</td>
                                            <td className="p-4 text-slate-400">{student.class_name}</td>
                                            <td className="p-4 text-center">
                                                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500 text-white font-bold shadow-lg shadow-red-500/30">
                                                    {absences}
                                                </span>
                                            </td>
                                            <td className="p-4 text-center text-slate-400">
                                                {lates > 0 && <span className="text-amber-400 text-xs">({lates} تأخير)</span>}
                                            </td>
                                            <td className="p-4 text-center">
                                                <button
                                                    onClick={() => {
                                                        setActiveTab('student_profile');
                                                        setSelectedStudentId(student.id);
                                                    }}
                                                    className="text-primary-400 hover:text-primary-300 text-sm font-medium underline"
                                                >
                                                    عرض الملف
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════════
    // Dismissal Report Renderer
    // ═══════════════════════════════════════════════════════════════
    const renderDismissalReport = () => {
        const filteredDismissals = selectedClass === 'all'
            ? dismissalData
            : dismissalData.filter(d => {
                const student = students.find(s => s.id === d.student_id);
                return student?.class_name === selectedClass;
            });

        // Stats
        const totalDismissals = filteredDismissals.length;
        const byKiosk = filteredDismissals.filter(d => d.method === 'kiosk').length;
        const byScanner = filteredDismissals.filter(d => d.method === 'scanner').length;
        const byWatcher = filteredDismissals.filter(d => d.method === 'watcher').length;

        // Group by date
        const byDate = new Map<string, DismissalRecord[]>();
        filteredDismissals.forEach(d => {
            const existing = byDate.get(d.date) || [];
            existing.push(d);
            byDate.set(d.date, existing);
        });

        return (
            <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-4 text-center">
                        <div className="text-3xl font-bold text-amber-400">{totalDismissals}</div>
                        <div className="text-xs text-amber-200 mt-1">إجمالي الانصراف</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 text-center">
                        <div className="text-2xl font-bold text-primary-400">{byKiosk}</div>
                        <div className="text-xs text-slate-400 mt-1">عبر الكشك</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 text-center">
                        <div className="text-2xl font-bold text-emerald-400">{byScanner}</div>
                        <div className="text-xs text-slate-400 mt-1">عبر الماسح</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4 text-center">
                        <div className="text-2xl font-bold text-secondary-400">{byWatcher}</div>
                        <div className="text-xs text-slate-400 mt-1">عبر المراقب</div>
                    </div>
                </div>

                {/* Table */}
                {filteredDismissals.length === 0 ? (
                    <div className="text-center p-12 text-slate-400 border border-dashed border-slate-700 rounded-xl">
                        <DoorOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                        <p>لا توجد سجلات انصراف في الفترة المحددة</p>
                        <p className="text-xs text-slate-500 mt-1">اختر فترة زمنية واضغط "عرض التقرير"</p>
                    </div>
                ) : (
                    <div className="glass-card overflow-hidden rounded-xl">
                        <table className="w-full text-right text-sm">
                            <thead className="bg-slate-900/80 text-slate-300 text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="p-4">الطالب</th>
                                    <th className="p-4">الصف</th>
                                    <th className="p-4">التاريخ</th>
                                    <th className="p-4">الوقت</th>
                                    <th className="p-4 text-center">طريقة التسجيل</th>
                                    <th className="p-4">المستلم</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {filteredDismissals
                                    .sort((a, b) => new Date(b.exit_time).getTime() - new Date(a.exit_time).getTime())
                                    .map(record => {
                                        const student = students.find(s => s.id === record.student_id);
                                        const methodLabels: Record<string, { label: string; color: string }> = {
                                            kiosk: { label: 'كشك', color: 'bg-primary-500/20 text-primary-300' },
                                            scanner: { label: 'ماسح', color: 'bg-emerald-500/20 text-emerald-300' },
                                            watcher: { label: 'مراقب', color: 'bg-secondary-500/20 text-secondary-300' },
                                        };
                                        const method = methodLabels[record.method] || { label: record.method, color: 'bg-slate-500/20 text-slate-300' };

                                        return (
                                            <tr key={record.id} className="hover:bg-amber-500/5 transition-colors">
                                                <td className="p-4 font-bold text-white">
                                                    {student?.name || record.student_id}
                                                </td>
                                                <td className="p-4 text-slate-400">
                                                    {student?.class_name || '-'} {student?.section ? `- ${student.section}` : ''}
                                                </td>
                                                <td className="p-4 text-slate-300 font-mono text-xs">{record.date}</td>
                                                <td className="p-4 text-slate-300">
                                                    {new Date(record.exit_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${method.color}`}>
                                                        {method.label}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-slate-400">{record.picked_up_by || '-'}</td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-fade-in-up pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-500 font-serif mb-2">
                        مركز التقارير 📊
                    </h1>
                    <p className="text-slate-400">تحليل بيانات الحضور واستخراج تقارير تفصيلية</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 border-b border-primary-500/20 hide-scrollbar">
                {[
                    { id: 'monthly', label: 'التقرير الشهري', icon: Calendar },
                    { id: 'student_profile', label: 'ملف الطالب', icon: UserIcon },
                    { id: 'chronic_absence', label: 'الغياب المتكرر', icon: AlertCircle },
                    { id: 'attendance_intelligence', label: 'ذكاء الحضور', icon: BrainCircuit },
                    { id: 'dismissal', label: 'تقرير الانصراف', icon: DoorOpen },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => {
                            setActiveTab(tab.id as ReportType);
                            setAttendanceData([]); // Reset data on tab switch to force fresh load if needed
                        }}
                        className={`flex items-center gap-2 px-6 py-3 rounded-t-xl transition-all relative whitespace-nowrap ${activeTab === tab.id
                            ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-400'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        <tab.icon className="w-4 h-4" />
                        <span className="font-medium">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Filters Bar */}
            <div className="glass-card p-4 rounded-xl flex flex-wrap gap-4 items-end shadow-lg shadow-primary-500/5">

                {(activeTab === 'monthly' || activeTab === 'attendance_intelligence') && (
                    <>
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-xs text-slate-400 mb-1">الصف الدراسي</label>
                            <select
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-primary-500 focus:outline-none"
                            >
                                <option value="all">كل الصفوف</option>
                                {classes.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>

                        {activeTab === 'monthly' ? (
                            <div className="flex-1 min-w-[200px]">
                                <label className="block text-xs text-slate-400 mb-1">الشهر</label>
                                <input
                                    type="month"
                                    value={format(selectedMonth, 'yyyy-MM')}
                                    onChange={(e) => setSelectedMonth(new Date(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-primary-500 focus:outline-none"
                                />
                            </div>
                        ) : (
                            <div className="flex-1 min-w-[200px]">
                                <label className="block text-xs text-slate-400 mb-1">بداية الأسبوع</label>
                                <input
                                    type="date"
                                    value={selectedWeekStart}
                                    onChange={(event) => {
                                        if (!event.target.value) return;
                                        setSelectedWeekStart(
                                            format(startOfWeek(parseISO(event.target.value), { weekStartsOn: 0 }), 'yyyy-MM-dd')
                                        );
                                    }}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:border-primary-500 focus:outline-none"
                                />
                                <p className="mt-1 text-[11px] text-slate-500">يُحلّل النظام ثمانية أسابيع تنتهي بهذا الأسبوع.</p>
                            </div>
                        )}
                    </>
                )}

                {/* Generate Button (Visible and primary for all tabs) */}
                <button
                    onClick={handleGenerateReport}
                    disabled={loading}
                    className="px-6 py-2 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-500 hover:to-secondary-500 text-white rounded-lg font-bold shadow-lg shadow-primary-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed h-[42px] min-w-[120px]"
                >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'عرض التقرير'}
                </button>
            </div>

            {/* Report Content */}
            <div className="glass-card p-4 rounded-xl min-h-[500px] border border-primary-500/10 bg-slate-900/40">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-[400px]">
                        <Loader2 className="w-16 h-16 text-primary-500 animate-spin mb-4" />
                        <p className="text-slate-400 animate-pulse">جاري تحليل البيانات...</p>
                    </div>
                ) : (
                    <>
                        {activeTab === 'monthly' && renderMonthlyReport()}
                        {activeTab === 'student_profile' && renderStudentProfileReport()}
                        {activeTab === 'chronic_absence' && renderChronicAbsenceReport()}
                        {activeTab === 'attendance_intelligence' && (
                            <AttendanceIntelligenceReport
                                students={intelligenceStudents}
                                attendanceRecords={attendanceData}
                                period={intelligencePeriod}
                                weekStartDate={selectedWeekStart}
                                workDays={settings?.attendance_settings?.work_days || settings?.work_days}
                                holidays={settings?.attendance_settings?.academic_holidays}
                            />
                        )}
                        {activeTab === 'dismissal' && renderDismissalReport()}
                    </>
                )}
            </div>
        </div>
    );
};

export default Reports;
