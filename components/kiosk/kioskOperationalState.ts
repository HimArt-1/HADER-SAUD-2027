import {
    AcademicHoliday,
    ATTENDANCE_DEFAULTS,
    KioskSettings,
    SystemSettings
} from '../../types';
import {
    getHolidayInfo,
    isDateHoliday,
    normalizeAcademicHolidays
} from '../../services/academicCalendarService';

export interface KioskOperatingPolicy {
    systemReady: boolean;
    schoolActive: boolean;
    workDays: number[];
    holidays: AcademicHoliday[];
}

export interface KioskOperationalConfig {
    kioskSettings: KioskSettings;
    policy: KioskOperatingPolicy;
}

export interface KioskDayState {
    allowsAttendance: boolean;
    kind: 'school-day' | 'weekly-off' | 'academic-holiday' | 'system-not-ready' | 'school-inactive';
    title: string;
    helper: string;
}

const normalizeWorkDays = (value: unknown): number[] => {
    if (!Array.isArray(value)) return [...ATTENDANCE_DEFAULTS.WORK_DAYS];
    const days = [...new Set(value.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) as number[])]
        .sort((a, b) => a - b);
    return days.length > 0 ? days : [...ATTENDANCE_DEFAULTS.WORK_DAYS];
};

export const buildKioskOperationalConfig = (systemSettings: SystemSettings = {}): KioskOperationalConfig => {
    const savedKioskSettings = systemSettings.kiosk_settings || {};
    const attendanceSettings = systemSettings.attendance_settings || {};
    const assemblyTime = systemSettings.assembly_time || savedKioskSettings.assembly_time || ATTENDANCE_DEFAULTS.ASSEMBLY_TIME;
    const gracePeriod = systemSettings.grace_period ?? savedKioskSettings.grace_period ?? ATTENDANCE_DEFAULTS.GRACE_PERIOD;
    const absenceTime = systemSettings.absence_time || savedKioskSettings.absence_time || ATTENDANCE_DEFAULTS.ABSENCE_TIME;
    const schoolName = systemSettings.school_name || savedKioskSettings.school_name || '';
    const principalName = systemSettings.principal_name || savedKioskSettings.principal_name || '';

    return {
        kioskSettings: {
            main_title: 'مرحباً في نظام الحضور الذكي',
            sub_title: 'لطفاً انتظر التعليمات أو مرر البطاقة',
            early_message: 'أهلًا بك، وصلت في الوقت المناسب',
            late_message: 'لقد تأخرت عن التجمع، راجع الإدارة',
            show_stats: true,
            show_school_name: true,
            show_principal_name: true,
            theme: 'dark-neon',
            camera_scan_enabled: false,
            camera_scan_auto_open: false,
            display_settings: {
                clock_size: 'lg',
                title_size: 'lg',
                card_size: 'md',
                input_size: 'lg'
            },
            ...savedKioskSettings,
            school_name: schoolName,
            principal_name: principalName,
            assembly_time: assemblyTime,
            grace_period: gracePeriod,
            absence_time: absenceTime
        },
        policy: {
            systemReady: systemSettings.system_ready !== false,
            schoolActive: systemSettings.school_active !== false,
            workDays: normalizeWorkDays(attendanceSettings.work_days ?? systemSettings.work_days),
            holidays: normalizeAcademicHolidays(attendanceSettings.academic_holidays)
        }
    };
};

export const resolveKioskDayState = (
    date: string,
    policy: KioskOperatingPolicy
): KioskDayState => {
    if (!policy.systemReady) {
        return {
            allowsAttendance: false,
            kind: 'system-not-ready',
            title: 'الكشك غير مهيأ للتشغيل',
            helper: 'أكمل تهيئة النظام من لوحة الإدارة قبل استقبال الطلاب.'
        };
    }
    if (!policy.schoolActive) {
        return {
            allowsAttendance: false,
            kind: 'school-inactive',
            title: 'المدرسة متوقفة مؤقتًا',
            helper: 'أعد تفعيل المدرسة من لوحة الإدارة لاستقبال سجلات الحضور.'
        };
    }
    if (!isDateHoliday(date, policy.workDays, policy.holidays)) {
        return {
            allowsAttendance: true,
            kind: 'school-day',
            title: 'يوم دراسي',
            helper: 'الكشك يستقبل سجلات الحضور.'
        };
    }

    const holiday = getHolidayInfo(date, policy.holidays);
    if (holiday) {
        return {
            allowsAttendance: false,
            kind: 'academic-holiday',
            title: holiday.label,
            helper: 'عطلة مسجلة في التقويم الدراسي؛ أوقفنا استقبال الحضور لهذا اليوم.'
        };
    }

    return {
        allowsAttendance: false,
        kind: 'weekly-off',
        title: 'عطلة أسبوعية',
        helper: 'هذا اليوم غير مدرج ضمن أيام الدوام المدرسي.'
    };
};
