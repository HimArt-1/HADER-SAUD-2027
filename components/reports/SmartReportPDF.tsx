import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { db, getLocalISODate } from '../../services/db';
import { Student, AttendanceRecord } from '../../types';
import { Download, CheckCircle, Clock, AlertTriangle, Printer } from 'lucide-react';

interface SmartReportPDFProps {
  studentId: string;
  onClose?: () => void;
}

const formatPercent = (value: number) => `${Math.round(value)}%`;

export const SmartReportPDF: React.FC<SmartReportPDFProps> = ({ studentId, onClose }) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [attendanceStats, setAttendanceStats] = useState({ present: 0, late: 0, absent: 0, total: 0 });

  React.useEffect(() => {
    // Load student data and calculate stats
    const loadData = async () => {
      const students = await db.getStudents();
      const attendance = await db.getAttendance();
      
      const foundStudent = students.find(s => s.id === studentId);
      if (foundStudent) setStudent(foundStudent);

      const studentAttendance = attendance.filter(a => a.student_id === studentId);
      const present = studentAttendance.filter(a => a.status === 'present').length;
      const late = studentAttendance.filter(a => a.status === 'late').length;
      const absent = studentAttendance.filter(a => a.status === 'absent').length;

      setAttendanceStats({ present, late, absent, total: studentAttendance.length });
    };
    loadData();
  }, [studentId]);

  const handleDownload = async () => {
    if (!reportRef.current) return;
    setDownloading(true);

    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2, // High resolution
        useCORS: true,
        logging: false,
        backgroundColor: '#0f172a' // match bg-slate-900 / dark theme
      });

      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`حاضر_تقرير_الطالب_${student?.name || 'ذكية'}.pdf`);
    } catch (error) {
      console.error('Failed to generate PDF', error);
    } finally {
      setDownloading(false);
    }
  };

  if (!student) return <div className="text-white p-4">جاري التحميل...</div>;

  return (
    <div className="relative w-full max-w-3xl mx-auto rounded-3xl overflow-hidden shadow-2xl">
      {/* Control Bar (Not printed in PDF) */}
      <div className="flex items-center justify-between p-4 bg-slate-800/80 backdrop-blur-md border-b border-white/5 relative z-10 rounded-t-3xl">
        <h2 className="text-lg font-bold text-white">التقرير الذكي</h2>
        <div className="flex gap-2">
          {onClose && (
            <button onClick={onClose} className="px-4 py-2 rounded-xl text-slate-300 hover:bg-white/5 transition-all">إغلاق</button>
          )}
          <button 
            onClick={handleDownload} 
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-secondary-600 rounded-xl text-white font-bold hover:shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.4)] transition-all"
          >
            {downloading ? <span className="animate-spin text-lg">⚙</span> : <Download className="w-4 h-4" />}
            {downloading ? 'جاري التحميل...' : 'تحميل PDF'}
          </button>
        </div>
      </div>

      {/* 
        PDF Canvas Body
        Note: We scale it up or layout explicitly so it looks like an A4 document.
      */}
      <div className="bg-slate-900 relative max-h-[80vh] overflow-y-auto custom-scrollbar">
        <div 
          ref={reportRef} 
          className="bg-[#0f172a] text-white p-8 w-full min-h-[800px] flex flex-col gap-6"
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-primary-500/20 pb-6">
            <div>
              <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-l from-primary-400 to-secondary-500 mb-2">تقرير الانضباط الذكي</h1>
              <p className="text-slate-400">تاريخ الإصدار: {getLocalISODate()}</p>
            </div>
            <div className="text-left">
               <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 mb-2 flex items-center justify-center font-bold text-white text-2xl shadow-[0_0_15px_rgb(var(--color-primary-500)_/_0.4)]">
                 H
               </div>
               <p className="text-xs text-slate-500 font-mono">HADER SYSTEM</p>
            </div>
          </div>

          {/* Student Profile Info */}
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 flex flex-col md:flex-row items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-primary-500/30 flex items-center justify-center text-4xl shadow-inner">
               👦🏻
            </div>
            <div className="flex-1">
               <h2 className="text-2xl font-bold text-white mb-1">{student.name}</h2>
               <p className="text-slate-400 mb-3">الصف: <span className="text-primary-400">{student.class_name}</span></p>
               <div className="flex gap-4">
                  <div className="px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> نشط
                  </div>
                  <div className="px-3 py-1 rounded bg-secondary-500/10 border border-secondary-500/20 text-secondary-400 text-xs flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> بدون مخالفات مؤخرًا
                  </div>
               </div>
            </div>
          </div>

          {/* Statistics Grid */}
          <h3 className="text-xl font-bold text-white mt-4 border-r-4 border-primary-500 pr-3">الإحصائيات العامة</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-800/50 border border-white/5 flex flex-col items-center justify-center text-center">
               <div className="p-2 bg-emerald-500/10 rounded-full mb-2"><CheckCircle className="w-5 h-5 text-emerald-400" /></div>
               <div className="text-3xl font-bold text-emerald-400">{attendanceStats.present}</div>
               <div className="text-xs text-slate-400 mt-1">حاضر</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/50 border border-white/5 flex flex-col items-center justify-center text-center">
               <div className="p-2 bg-amber-500/10 rounded-full mb-2"><Clock className="w-5 h-5 text-amber-400" /></div>
               <div className="text-3xl font-bold text-amber-400">{attendanceStats.late}</div>
               <div className="text-xs text-slate-400 mt-1">متأخر</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/50 border border-white/5 flex flex-col items-center justify-center text-center">
               <div className="p-2 bg-red-500/10 rounded-full mb-2"><AlertTriangle className="w-5 h-5 text-red-400" /></div>
               <div className="text-3xl font-bold text-red-400">{attendanceStats.absent}</div>
               <div className="text-xs text-slate-400 mt-1">غائب</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/50 border border-primary-500/20 flex flex-col items-center justify-center text-center">
               <div className="p-2 bg-primary-500/10 rounded-full mb-2"><Printer className="w-5 h-5 text-primary-400" /></div>
               <div className="text-3xl font-bold text-primary-400">
                  {formatPercent(attendanceStats.total > 0 ? (attendanceStats.present + attendanceStats.late) / attendanceStats.total * 100 : 0)}
               </div>
               <div className="text-xs text-primary-400/70 mt-1">نسبة الحضور</div>
            </div>
          </div>

          <h3 className="text-xl font-bold text-white mt-8 border-r-4 border-emerald-500 pr-3">تحليل الأداء والملاحظات</h3>
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-slate-300 leading-relaxed">
             الطالب يتمتع بنسبة حضور ممتازة تعكس التزامه المستمر. لم يُلاحظ أي تجاوزات سلوكية خلال الفترة المحددة، مما يدل على مستوى انضباط عالٍ. نوصي بالاستمرار في هذا النهج للحفاظ على التفوق.
          </div>

          <div className="mt-auto pt-10 text-center text-xs text-slate-600 font-mono">
            Generated by Hader System ({getLocalISODate()})
          </div>
        </div>
      </div>
    </div>
  );
};
