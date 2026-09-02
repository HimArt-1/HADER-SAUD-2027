import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminUsersTab from '../components/admin/AdminUsersTab';
import { Role } from '../types';

const baseProps = {
  classes: [],
  visibleUsers: [
    { id: 'current-user', name: 'مدير المدرسة', username: 'schoolAdmin', role: Role.SCHOOL_ADMIN },
    { id: 'watcher-user', name: 'ناصر القحطاني', username: 'nasser.watch', role: Role.WATCHER }
  ],
  newUser: {
    name: '',
    username: '',
    password: '',
    role: Role.SCHOOL_ADMIN,
    assigned_classes: [],
    can_use_whatsapp: false
  },
  setNewUser: vi.fn(),
  handleAddUser: vi.fn(),
  handleDeleteUser: vi.fn(),
  handleStartEditUser: vi.fn(),
  onGoToStructure: vi.fn(),
  currentUserId: 'current-user'
};

afterEach(cleanup);

describe('admin users tab', () => {
  it('keeps a new password hidden until explicitly revealed', () => {
    render(<AdminUsersTab {...baseProps} />);

    const passwordInput = screen.getByPlaceholderText('8 أحرف على الأقل');
    expect(passwordInput.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'إظهار كلمة المرور' }));
    expect(passwordInput.getAttribute('type')).toBe('text');
  });

  it('searches accounts and protects the active account from deletion', () => {
    render(<AdminUsersTab {...baseProps} />);

    expect(screen.getByText('حسابك الحالي')).toBeTruthy();
    expect((screen.getByTitle('لا يمكن حذف الحساب المستخدم حاليًا') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('searchbox', { name: 'بحث في المستخدمين' }), {
      target: { value: 'ناصر' }
    });

    expect(screen.getByText('ناصر القحطاني')).toBeTruthy();
    expect(screen.queryByText('مدير المدرسة')).toBeNull();
    expect(screen.getByText('1 من 2')).toBeTruthy();
  });
});
