import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Link } from 'react-router-dom';
import { Role, type User } from '../types';

const session = vi.hoisted(() => ({ user: null as User | null }));
vi.mock('../services/auth', () => ({ auth: {
  getSession: () => session.user,
  onSessionChange: () => () => undefined,
  checkConnection: async () => true
} }));
vi.mock('../services/db', () => ({ db: { getSettings: async () => ({}) } }));
vi.mock('../services/autoAbsenceService', () => ({ autoAbsenceService: { init: vi.fn(), stop: vi.fn() } }));
vi.mock('../hooks/useElectron', () => ({ useElectronMenu: vi.fn() }));
vi.mock('../services/surveys', () => ({ hasSurveyAdminAccess: () => false }));
vi.mock('../components/PWAInstallPrompt', () => ({ default: () => null }));
vi.mock('../components/Layout', () => ({ default: ({ children }: { children: React.ReactNode }) => (
  <main><Link to="/watcher">Open watcher</Link>{children}</main>
) }));
vi.mock('../pages/Login', () => ({ default: () => <h1>Login page</h1> }));
vi.mock('../pages/Dashboard', () => ({ default: () => <h1>Dashboard page</h1> }));
vi.mock('../pages/Watcher', () => ({ default: () => <h1>Watcher page</h1> }));
vi.mock('../pages/Admin', () => ({ default: () => <h1>Admin page</h1> }));
vi.mock('../pages/Kiosk', () => ({ default: () => <h1>Kiosk page</h1> }));
vi.mock('../pages/Parents', () => ({ default: () => <h1>Parents page</h1> }));
vi.mock('../pages/PublicSurvey', () => ({ default: () => <h1>Public survey</h1> }));
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  session.user = null;
  window.location.hash = '/login';
});
afterEach(cleanup);

const loginAs = (role: Role) => {
  session.user = { id: 'routing-user', name: 'Test', username: 'test', role };
};

describe('application hash routing after the router upgrade', () => {
  it('opens the login route without a session', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeTruthy();
  });

  it('redirects a signed-in watcher from login and navigates inside the layout', async () => {
    loginAs(Role.WATCHER);
    render(<App />);
    await screen.findByRole('heading', { name: 'Dashboard page' });
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    screen.getByRole('link', { name: 'Open watcher' }).click();
    expect(await screen.findByRole('heading', { name: 'Watcher page' })).toBeTruthy();
    expect(window.location.hash).toBe('#/watcher');
  });

  it.each([
    [Role.SITE_ADMIN, '/admin', 'Admin page'],
    [Role.WATCHER, '/admin', 'Dashboard page'],
    [Role.KIOSK, '/', 'Kiosk page'],
    [Role.GUARDIAN, '/', 'Parents page']
  ])('routes %s at %s to the permitted page', async (role, path, heading) => {
    loginAs(role as Role);
    window.location.hash = path;
    render(<App />);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  });

  it('keeps a public survey link accessible without login', async () => {
    window.location.hash = '/survey/example-token';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Public survey' })).toBeTruthy();
  });
});
