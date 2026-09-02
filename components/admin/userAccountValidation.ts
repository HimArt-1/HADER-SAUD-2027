import { Role, User } from '../../types';

export type UserAccountField = 'name' | 'username' | 'password' | 'assigned_classes';

export interface UserAccountDraft {
    id?: string;
    name: string;
    username: string;
    password?: string;
    role: Role;
    assigned_classes?: User['assigned_classes'];
}

export interface UserAccountIssue {
    field: UserAccountField;
    message: string;
}

export interface PasswordStrength {
    score: number;
    label: 'غير مكتملة' | 'ضعيفة' | 'مقبولة' | 'قوية';
}

const USERNAME_PATTERN = /^[\p{L}\p{N}._-]+$/u;
const LETTER_PATTERN = /\p{L}/u;
const NUMBER_PATTERN = /\p{N}/u;
const SPECIAL_PATTERN = /[^\p{L}\p{N}\s]/u;

export const normalizeAccountUsername = (value: unknown): string =>
    String(value ?? '').trim().toLocaleLowerCase('ar');

export const getPasswordStrength = (password: string): PasswordStrength => {
    const value = password.trim();
    if (!value) return { score: 0, label: 'غير مكتملة' };

    const score = [
        value.length >= 8,
        value.length >= 12,
        LETTER_PATTERN.test(value) && NUMBER_PATTERN.test(value),
        SPECIAL_PATTERN.test(value)
    ].filter(Boolean).length;

    if (score <= 1) return { score, label: 'ضعيفة' };
    if (score <= 2) return { score, label: 'مقبولة' };
    return { score, label: 'قوية' };
};

export const validateUserAccountDraft = (
    draft: UserAccountDraft,
    existingUsers: Pick<User, 'id' | 'username'>[],
    options: { passwordRequired?: boolean; excludeUserId?: string } = {}
): UserAccountIssue[] => {
    const issues: UserAccountIssue[] = [];
    const name = draft.name.trim();
    const username = draft.username.trim();
    const normalizedUsername = normalizeAccountUsername(username);
    const password = draft.password?.trim() ?? '';
    const passwordRequired = options.passwordRequired ?? true;

    if (!name) {
        issues.push({ field: 'name', message: 'أدخل الاسم الكامل.' });
    }

    if (!username) {
        issues.push({ field: 'username', message: 'أدخل اسم المستخدم.' });
    } else if (username.length < 3) {
        issues.push({ field: 'username', message: 'اسم المستخدم يجب أن يتكون من 3 أحرف على الأقل.' });
    } else if (!USERNAME_PATTERN.test(username)) {
        issues.push({ field: 'username', message: 'استخدم حروفًا أو أرقامًا أو النقطة والشرطة فقط، دون مسافات.' });
    } else if (existingUsers.some(user =>
        user.id !== options.excludeUserId && normalizeAccountUsername(user.username) === normalizedUsername
    )) {
        issues.push({ field: 'username', message: 'اسم المستخدم مستخدم في حساب آخر.' });
    }

    if (passwordRequired && !password) {
        issues.push({ field: 'password', message: 'أدخل كلمة المرور.' });
    } else if (password && password.length < 8) {
        issues.push({ field: 'password', message: 'كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.' });
    } else if (password && (!LETTER_PATTERN.test(password) || !NUMBER_PATTERN.test(password))) {
        issues.push({ field: 'password', message: 'استخدم حرفًا واحدًا ورقمًا واحدًا على الأقل.' });
    }

    if (draft.role === Role.SUPERVISOR_CLASS && !(draft.assigned_classes?.length)) {
        issues.push({ field: 'assigned_classes', message: 'حدد صفًا واحدًا على الأقل لمشرف الصف.' });
    }

    return issues;
};
