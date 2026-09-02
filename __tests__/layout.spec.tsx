import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Layout from '../components/Layout';
import { Role, STORAGE_KEYS, User } from '../types';

const baseSettings = {
  system_ready: true,
  school_active: true,
  assembly_time: '07:00',
  grace_period: 10,
  logo_url: '',
  dark_mode: true
};

const makeUser = (role: Role): User => ({
  id: `${role}-user`,
  username: `${role}-username`,
  name: 'Tester',
  role
});

const renderLayout = (role: Role) =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Layout user={makeUser(role)} onLogout={() => {}}>
        <div>child</div>
      </Layout>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(baseSettings));
});

describe('Role-based navigation', () => {
  it('hides admin-only routes for watcher role', () => {
    renderLayout(Role.WATCHER);
    expect(screen.getByText('الرئيسية')).toBeTruthy();
    expect(screen.queryByText('الدعم الفني')).toBeNull();
    expect(screen.queryByText('الإدارة')).toBeNull();
  });

  it('shows full navigation for site admin role', () => {
    renderLayout(Role.SITE_ADMIN);
    expect(screen.getByText('الدعم الفني')).toBeTruthy();
    expect(screen.getByText('الإدارة')).toBeTruthy();
    const kioskLinks = screen.getAllByText('كشك الحضور');
    expect(kioskLinks.length).toBeGreaterThan(0);
  });
});
