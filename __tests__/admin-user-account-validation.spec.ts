import { describe, expect, it } from 'vitest';
import { Role } from '../types';
import { getPasswordStrength, validateUserAccountDraft } from '../components/admin/userAccountValidation';

const validDraft = {
  name: 'أحمد العتيبي',
  username: 'ahmed.school',
  password: 'School5000@',
  role: Role.WATCHER,
  assigned_classes: []
};

describe('admin user account validation', () => {
  it('rejects duplicate usernames regardless of letter case', () => {
    const issues = validateUserAccountDraft(validDraft, [
      { id: 'existing', username: 'Ahmed.School' }
    ]);

    expect(issues).toContainEqual({
      field: 'username',
      message: 'اسم المستخدم مستخدم في حساب آخر.'
    });
  });

  it('requires a letter, number, and minimum password length', () => {
    const shortIssues = validateUserAccountDraft({ ...validDraft, password: '1234' }, []);
    const numericIssues = validateUserAccountDraft({ ...validDraft, password: '12345678' }, []);

    expect(shortIssues.some(issue => issue.field === 'password')).toBe(true);
    expect(numericIssues.some(issue => issue.field === 'password')).toBe(true);
    expect(getPasswordStrength('School5000@').label).toBe('قوية');
  });

  it('requires a class scope only for class supervisors', () => {
    const issues = validateUserAccountDraft({
      ...validDraft,
      role: Role.SUPERVISOR_CLASS,
      assigned_classes: []
    }, []);

    expect(issues.some(issue => issue.field === 'assigned_classes')).toBe(true);
    expect(validateUserAccountDraft({
      ...validDraft,
      role: Role.SUPERVISOR_CLASS,
      assigned_classes: [{ class_name: 'أول ثانوي', sections: [] }]
    }, [])).toEqual([]);
  });

  it('allows an unchanged password while editing', () => {
    expect(validateUserAccountDraft(
      { ...validDraft, id: 'user-1', password: '' },
      [{ id: 'user-1', username: validDraft.username }],
      { passwordRequired: false, excludeUserId: 'user-1' }
    )).toEqual([]);
  });
});
