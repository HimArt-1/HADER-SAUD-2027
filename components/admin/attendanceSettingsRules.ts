import { ATTENDANCE_DEFAULTS, AttendanceSettings } from '../../types';

export type AttendanceSettingsDraft = AttendanceSettings & {
    mode: 'traditional' | 'hybrid';
};

export interface AttendanceTimingDraft {
    assembly_time: string;
    grace_period: number;
    absence_time: string;
}

export interface AttendanceTimingValidation {
    error: string | null;
    lateCutoffTime: string | null;
}

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettingsDraft = {
    mode: 'traditional',
    auto_mark_time: ATTENDANCE_DEFAULTS.ABSENCE_TIME,
    unmarked_default: 'present',
    work_days: [...ATTENDANCE_DEFAULTS.WORK_DAYS]
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const parseTimeToMinutes = (value: string): number | null => {
    const match = TIME_PATTERN.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
};

export const formatMinutesAsTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const normalizeWorkDays = (value: unknown, fallback: number[] = [...ATTENDANCE_DEFAULTS.WORK_DAYS]): number[] => {
    if (!Array.isArray(value)) return [...fallback];
    const normalized = [...new Set(value.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) as number[])].sort((a, b) => a - b);
    return normalized.length > 0 ? normalized : [...fallback];
};

export const validateWorkDays = (workDays: number[]): string | null => {
    if (workDays.length === 0) return 'يجب اختيار يوم دوام واحد على الأقل.';
    if (workDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
        return 'تتضمن أيام الدوام قيمة غير صالحة.';
    }
    return null;
};

export const validateAttendanceTiming = ({
    assembly_time,
    grace_period,
    absence_time
}: AttendanceTimingDraft): AttendanceTimingValidation => {
    const assemblyMinutes = parseTimeToMinutes(assembly_time);
    const absenceMinutes = parseTimeToMinutes(absence_time);

    if (assemblyMinutes === null || absenceMinutes === null) {
        return { error: 'أدخل وقتًا صالحًا للطابور واحتساب الغياب.', lateCutoffTime: null };
    }
    if (!Number.isInteger(grace_period) || grace_period < 0 || grace_period > 120) {
        return { error: 'مدة السماح يجب أن تكون عددًا صحيحًا من 0 إلى 120 دقيقة.', lateCutoffTime: null };
    }

    const lateCutoffMinutes = assemblyMinutes + grace_period;
    if (lateCutoffMinutes >= 24 * 60) {
        return { error: 'وقت الطابور مع مدة السماح يجب أن يبقى ضمن اليوم نفسه.', lateCutoffTime: null };
    }
    if (absenceMinutes <= lateCutoffMinutes) {
        return {
            error: 'وقت احتساب الغياب يجب أن يكون بعد نهاية مدة السماح.',
            lateCutoffTime: formatMinutesAsTime(lateCutoffMinutes)
        };
    }

    return { error: null, lateCutoffTime: formatMinutesAsTime(lateCutoffMinutes) };
};

export const normalizeAttendanceSettings = (
    value: unknown,
    fallback: AttendanceSettingsDraft = DEFAULT_ATTENDANCE_SETTINGS
): AttendanceSettingsDraft => {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const mode = raw.mode === 'hybrid' || raw.mode === 'traditional' ? raw.mode : fallback.mode;
    const autoMarkTime = typeof raw.auto_mark_time === 'string' && parseTimeToMinutes(raw.auto_mark_time) !== null
        ? raw.auto_mark_time
        : fallback.auto_mark_time;
    const unmarkedDefault = raw.unmarked_default === 'absent' || raw.unmarked_default === 'present'
        ? raw.unmarked_default
        : fallback.unmarked_default;

    return {
        mode,
        auto_mark_time: autoMarkTime,
        unmarked_default: unmarkedDefault,
        work_days: normalizeWorkDays(raw.work_days, fallback.work_days)
    };
};
