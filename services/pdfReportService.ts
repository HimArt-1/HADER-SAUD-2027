/**
 * ═══════════════════════════════════════════════════════════════
 * 📄 PDFReportService - Advanced PDF Report Generation
 * ═══════════════════════════════════════════════════════════════
 * 
 * Features:
 * - Professional Arabic PDF reports
 * - Charts and statistics visualization
 * - Custom headers with school branding
 * - Multi-page support with pagination
 * - Attendance, violations, and exits reports
 * - Summary statistics and analytics
 */

import { Student, AttendanceRecord, ViolationRecord, ExitRecord, SystemSettings } from '../types';
import { getExitRequesterRelationLabel } from './exitRequester';

declare const jspdf: any;
declare const jspdfAutoTable: any;

export interface ReportOptions {
  title: string;
  subtitle?: string;
  dateRange?: { from: string; to: string };
  showLogo?: boolean;
  showFooter?: boolean;
  showStatistics?: boolean;
  showCharts?: boolean;
  orientation?: 'portrait' | 'landscape';
  pageSize?: 'a4' | 'a3' | 'letter';
}

export interface AttendanceReportData {
  students: Student[];
  attendance: AttendanceRecord[];
  summary: {
    totalStudents: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    attendanceRate: number;
  };
}

export interface ViolationReportData {
  violations: ViolationRecord[];
  summary: {
    totalViolations: number;
    byType: Record<string, number>;
    byLevel: Record<number, number>;
  };
}

export interface ExitReportData {
  exits: ExitRecord[];
  summary: {
    totalExits: number;
    byReason: Record<string, number>;
  };
}

class PDFReportService {
  private settings: SystemSettings | null = null;

  /**
   * 🔧 Set system settings for branding
   */
  setSettings(settings: SystemSettings): void {
    this.settings = settings;
  }

  /**
   * 📊 Generate Attendance Report
   */
  async generateAttendanceReport(
    data: AttendanceReportData,
    options: ReportOptions
  ): Promise<Blob> {
    const { jsPDF } = jspdf;
    const doc = new jsPDF({
      orientation: options.orientation || 'portrait',
      unit: 'mm',
      format: options.pageSize || 'a4'
    });

    // Configure Arabic font
    doc.setFont('Amiri', 'normal');
    doc.setR2L(true);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;

    // Add Header
    this.addHeader(doc, options, pageWidth, margin);

    // Add Summary Statistics
    if (options.showStatistics) {
      this.addAttendanceStatistics(doc, data.summary, pageWidth, margin);
    }

    // Add Data Table
    const tableData = data.students.map((student, idx) => {
      const record = data.attendance.find(a => a.student_id === student.id);
      return [
        idx + 1,
        student.name,
        student.class_name,
        student.section,
        record ? this.formatTime(record.timestamp) : '-',
        record ? (record.status === 'late' ? 'متأخر' : 'حاضر') : 'غائب',
        record?.minutes_late ? `${record.minutes_late} دقيقة` : '-'
      ];
    });

    doc.autoTable({
      head: [['#', 'اسم الطالب', 'الصف', 'الفصل', 'وقت الحضور', 'الحالة', 'التأخير']],
      body: tableData,
      startY: 90,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        font: 'Amiri',
        fontSize: 10,
        halign: 'right',
        cellPadding: 3
      },
      headStyles: {
        fillColor: [6, 182, 212], // Cyan
        textColor: 255,
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: [240, 249, 255]
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        5: { halign: 'center' },
        6: { halign: 'center' }
      },
      didDrawPage: (data: any) => {
        this.addFooter(doc, pageWidth, pageHeight, margin);
      }
    });

    return doc.output('blob');
  }

  /**
   * 🚨 Generate Violations Report
   */
  async generateViolationsReport(
    data: ViolationReportData,
    options: ReportOptions
  ): Promise<Blob> {
    const { jsPDF } = jspdf;
    const doc = new jsPDF({
      orientation: options.orientation || 'portrait',
      unit: 'mm',
      format: options.pageSize || 'a4'
    });

    doc.setFont('Amiri', 'normal');
    doc.setR2L(true);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;

    this.addHeader(doc, { ...options, title: options.title || 'تقرير المخالفات' }, pageWidth, margin);

    // Violations Summary
    if (options.showStatistics) {
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('ملخص المخالفات', pageWidth - margin, 55, { align: 'right' });

      doc.setFontSize(11);
      doc.setTextColor(107, 114, 128);

      let yPos = 65;
      doc.text(`إجمالي المخالفات: ${data.summary.totalViolations}`, pageWidth - margin, yPos, { align: 'right' });

      yPos += 8;
      Object.entries(data.summary.byType).forEach(([type, count]) => {
        doc.text(`${type}: ${count}`, pageWidth - margin, yPos, { align: 'right' });
        yPos += 6;
      });
    }

    // Violations Table
    const tableData = data.violations.map((v, idx) => [
      idx + 1,
      v.student_id,
      v.type,
      this.getLevelText(v.level),
      v.description || '-',
      v.action_taken || '-',
      this.formatDate(v.created_at)
    ]);

    doc.autoTable({
      head: [['#', 'رقم الطالب', 'نوع المخالفة', 'المستوى', 'الوصف', 'الإجراء', 'التاريخ']],
      body: tableData,
      startY: options.showStatistics ? 95 : 55,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        font: 'Amiri',
        fontSize: 9,
        halign: 'right',
        cellPadding: 2
      },
      headStyles: {
        fillColor: [239, 68, 68], // Red
        textColor: 255,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        3: { halign: 'center', cellWidth: 18 }
      },
      didDrawPage: () => {
        this.addFooter(doc, pageWidth, pageHeight, margin);
      }
    });

    return doc.output('blob');
  }

  /**
   * 🚪 Generate Exits Report
   */
  async generateExitsReport(
    data: ExitReportData,
    options: ReportOptions
  ): Promise<Blob> {
    const { jsPDF } = jspdf;
    const doc = new jsPDF({
      orientation: options.orientation || 'portrait',
      unit: 'mm',
      format: options.pageSize || 'a4'
    });

    doc.setFont('Amiri', 'normal');
    doc.setR2L(true);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;

    this.addHeader(doc, { ...options, title: options.title || 'تقرير الاستئذان' }, pageWidth, margin);

    // Summary
    if (options.showStatistics) {
      doc.setFontSize(14);
      doc.setTextColor(31, 41, 55);
      doc.text('ملخص الاستئذان', pageWidth - margin, 55, { align: 'right' });

      doc.setFontSize(11);
      doc.setTextColor(107, 114, 128);
      doc.text(`إجمالي طلبات الخروج: ${data.summary.totalExits}`, pageWidth - margin, 65, { align: 'right' });
    }

    // Exits Table
    const tableData = data.exits.map((e, idx) => [
      idx + 1,
      e.student_id,
      e.reason,
      getExitRequesterRelationLabel(e),
      e.supervisor_name || '-',
      this.formatTime(e.exit_time),
      e.notes || '-'
    ]);

    doc.autoTable({
      head: [['#', 'رقم الطالب', 'السبب', 'المستأذن', 'المشرف', 'وقت الخروج', 'ملاحظات']],
      body: tableData,
      startY: options.showStatistics ? 75 : 55,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: {
        font: 'Amiri',
        fontSize: 10,
        halign: 'right',
        cellPadding: 3
      },
      headStyles: {
        fillColor: [245, 158, 11], // Amber
        textColor: 255,
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 }
      },
      didDrawPage: () => {
        this.addFooter(doc, pageWidth, pageHeight, margin);
      }
    });

    return doc.output('blob');
  }

  /**
   * 📈 Generate Comprehensive Analytics Report
   */
  async generateAnalyticsReport(
    data: {
      attendance: AttendanceReportData;
      violations: ViolationReportData;
      exits: ExitReportData;
      trends: any[];
    },
    options: ReportOptions
  ): Promise<Blob> {
    const { jsPDF } = jspdf;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    doc.setFont('Amiri', 'normal');
    doc.setR2L(true);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;

    // Page 1: Summary Dashboard
    this.addHeader(doc, { ...options, title: 'التقرير التحليلي الشامل' }, pageWidth, margin);

    // Key Metrics Cards
    const metrics = [
      { label: 'نسبة الحضور', value: `${data.attendance.summary.attendanceRate}%`, color: [16, 185, 129] },
      { label: 'حالات التأخير', value: data.attendance.summary.lateCount.toString(), color: [245, 158, 11] },
      { label: 'حالات الغياب', value: data.attendance.summary.absentCount.toString(), color: [239, 68, 68] },
      { label: 'المخالفات', value: data.violations.summary.totalViolations.toString(), color: [139, 92, 246] },
      { label: 'الاستئذان', value: data.exits.summary.totalExits.toString(), color: [6, 182, 212] }
    ];

    let xPos = pageWidth - margin - 45;
    metrics.forEach(metric => {
      // Card background
      doc.setFillColor(...metric.color as [number, number, number]);
      doc.roundedRect(xPos, 50, 45, 35, 3, 3, 'F');

      // Value
      doc.setFontSize(22);
      doc.setTextColor(255, 255, 255);
      doc.text(metric.value, xPos + 22.5, 68, { align: 'center' });

      // Label
      doc.setFontSize(10);
      doc.text(metric.label, xPos + 22.5, 78, { align: 'center' });

      xPos -= 50;
    });

    // Add footer
    this.addFooter(doc, pageWidth, pageHeight, margin);

    // Page 2: Detailed Tables (if needed)
    // Additional pages can be added here

    return doc.output('blob');
  }

  // ═══════════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════════

  private addHeader(
    doc: any,
    options: ReportOptions,
    pageWidth: number,
    margin: number
  ): void {
    // Header background
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 40, 'F');

    // Gradient accent line
    doc.setFillColor(6, 182, 212);
    doc.rect(0, 40, pageWidth, 2, 'F');

    // School name
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    const schoolName = this.settings?.school_name || 'نظام حاضر';
    doc.text(schoolName, pageWidth - margin, 18, { align: 'right' });

    // Report title
    doc.setFontSize(14);
    doc.setTextColor(6, 182, 212);
    doc.text(options.title, pageWidth - margin, 30, { align: 'right' });

    // Date range
    if (options.dateRange) {
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `من ${options.dateRange.from} إلى ${options.dateRange.to}`,
        margin,
        30,
        { align: 'left' }
      );
    }

    // Current date/time
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}`,
      margin,
      18,
      { align: 'left' }
    );
  }

  private addFooter(
    doc: any,
    pageWidth: number,
    pageHeight: number,
    margin: number
  ): void {
    const pageNumber = doc.internal.getNumberOfPages();

    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);

    // Page number
    doc.text(
      `صفحة ${pageNumber}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );

    // System credit
    doc.text(
      'نظام حاضر - إدارة الحضور الذكية',
      pageWidth - margin,
      pageHeight - 8,
      { align: 'right' }
    );
  }

  private addAttendanceStatistics(
    doc: any,
    summary: AttendanceReportData['summary'],
    pageWidth: number,
    margin: number
  ): void {
    doc.setFontSize(14);
    doc.setTextColor(31, 41, 55);
    doc.text('إحصائيات الحضور', pageWidth - margin, 55, { align: 'right' });

    // Stats boxes
    const stats = [
      { label: 'إجمالي الطلاب', value: summary.totalStudents, color: [59, 130, 246] },
      { label: 'الحضور', value: summary.presentCount, color: [16, 185, 129] },
      { label: 'المتأخرين', value: summary.lateCount, color: [245, 158, 11] },
      { label: 'الغياب', value: summary.absentCount, color: [239, 68, 68] }
    ];

    let xPos = pageWidth - margin - 35;
    stats.forEach(stat => {
      doc.setFillColor(...stat.color as [number, number, number]);
      doc.roundedRect(xPos, 60, 35, 20, 2, 2, 'F');

      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text(stat.value.toString(), xPos + 17.5, 71, { align: 'center' });

      doc.setFontSize(8);
      doc.text(stat.label, xPos + 17.5, 77, { align: 'center' });

      xPos -= 40;
    });
  }

  private formatTime(timestamp: string): string {
    try {
      return new Date(timestamp).toLocaleTimeString('ar-SA', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '-';
    }
  }

  private formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleDateString('ar-SA');
    } catch {
      return '-';
    }
  }

  private getLevelText(level: number): string {
    const levels: Record<number, string> = {
      1: 'خفيف',
      2: 'متوسط',
      3: 'مرتفع',
      4: 'خطير',
      5: 'حرج'
    };
    return levels[level] || `مستوى ${level}`;
  }

  /**
   * 💾 Download PDF
   */
  downloadPDF(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🏭 Singleton Instance
// ═══════════════════════════════════════════════════════════════

export const pdfReportService = new PDFReportService();
export default pdfReportService;
