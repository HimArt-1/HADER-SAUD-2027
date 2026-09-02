/**
 * ═══════════════════════════════════════════════════════════════
 * 🔐 AuthService - Authentication with Security Enhancements
 * ═══════════════════════════════════════════════════════════════
 * 
 * Features:
 * - Password hashing (PBKDF2)
 * - Rate limiting protection
 * - Session management
 * - Auto password migration
 * - Comprehensive error handling
 */

import { User, Role, STORAGE_KEYS } from '../types';
import {
  verifyPassword,
  hashPassword,
  needsHashMigration,
  loginRateLimiter,
  generateSessionToken
} from './security';
import { appCache } from './cache';
import { secureSessionStorage, SecureSessionPayload } from './secureStorage';
import { logAuthEvent } from './telemetry';
import {
  bootstrapAdminConfig,
  buildBootstrapAdminUser,
  validateBootstrapAdmin
} from './bootstrapAdmin';
import {
  AuthenticationError,
  DatabaseError,
  NetworkError,
  ValidationError,
  logError
} from '../types/errors';
import { normalizeAssignedClasses, normalizeAssignedSections } from './userAssignments';

// Session configuration
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_RENEW_THRESHOLD = 5 * 60 * 1000; // renew if <5 mins
const GUARDIAN_LOCKOUT_ATTEMPTS = 5;
const GUARDIAN_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const GUARDIAN_LOCAL_LOCKOUT_KEY = 'hader:guardian:lockout';

type GuardianSecurityState = {
  attempts: number;
  lockedUntil?: string | null;
  updatedAt?: string;
};

const bootstrapAdminStatus = validateBootstrapAdmin();
const isBootstrapAdminSecure = bootstrapAdminStatus.ok;

type SessionListener = (user: User | null) => void;
const sessionListeners = new Set<SessionListener>();

const getDb = async () => (await import('./db')).db;

const getSupabaseServices = async () => {
  const mod = await import('./supabase');
  return {
    supabase: mod.supabase,
    supabaseStatus: mod.supabaseStatus,
    revokeSurveySessionKeepalive: mod.revokeSurveySessionKeepalive
  };
};

const notifySessionListeners = (user: User | null) => {
  sessionListeners.forEach(listener => {
    try {
      listener(user);
    } catch (error) {
      logError(error, 'Auth - Session Listener');
    }
  });
};

const createSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(36).slice(2)}-${Date.now()}`;
};

const readGuardianLocalSecurity = (phone: string): GuardianSecurityState | null => {
  try {
    const raw = localStorage.getItem(GUARDIAN_LOCAL_LOCKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, GuardianSecurityState>;
    return parsed[phone] || null;
  } catch (error) {
    logError(error, 'Auth - Read Guardian Lockout State');
    return null;
  }
};

const writeGuardianLocalSecurity = (phone: string, state: GuardianSecurityState) => {
  try {
    const raw = localStorage.getItem(GUARDIAN_LOCAL_LOCKOUT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, GuardianSecurityState>) : {};
    parsed[phone] = state;
    localStorage.setItem(GUARDIAN_LOCAL_LOCKOUT_KEY, JSON.stringify(parsed));
  } catch (error) {
    logError(error, 'Auth - Write Guardian Lockout State');
  }
};

const isGuardianLocked = (lockedUntil?: string | null) => {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
};

export const auth = {
  /**
   * Check connection based on mode
   */
  async checkConnection(): Promise<boolean> {
    const db = await getDb();
    if (db.getMode() === 'local') {
      return true;
    }

    try {
      const { supabase } = await getSupabaseServices();
      const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true });
      return !error;
    } catch (e) {
      console.warn("Connection check failed");
      return false;
    }
  },

  /**
   * 🔐 Login with security checks
   */
  async login(
    username: string,
    password: string,
    type: 'staff' | 'guardian' = 'staff',
    turnstileToken?: string
  ): Promise<{ success: boolean; user?: User; message?: string }> {
    try {
      const db = await getDb();
      const mode = db.getMode();
      const identifier = `${type}:${username}`;

      // ═══════════════════════════════════════════════════════════════
      // 🚧 Rate Limiting Check
      // ═══════════════════════════════════════════════════════════════
      const rateCheck = loginRateLimiter.isAllowed(identifier);
      if (!rateCheck.allowed) {
        return {
          success: false,
          message: `تم تجاوز عدد المحاولات المسموحة. انتظر ${rateCheck.retryAfter} ثانية`
        };
      }

      // ═══════════════════════════════════════════════════════════════
      // 🛡️ BOOTSTRAP ADMIN (Emergency Access)
      // ═══════════════════════════════════════════════════════════════
      if (
        type === 'staff' &&
        mode === 'local' &&
        isBootstrapAdminSecure &&
        username === bootstrapAdminConfig.username &&
        password === bootstrapAdminConfig.password
      ) {
        const user: User = buildBootstrapAdminUser();
        loginRateLimiter.recordSuccess(identifier);
        this.setSession(user);
        void logAuthEvent({
          action: 'LOGIN',
          user,
          meta: { mode, type, bootstrap: true }
        });
        return { success: true, user };
      }

      // ═══════════════════════════════════════════════════════════════
      // 🏠 LOCAL MODE LOGIC
      // ═══════════════════════════════════════════════════════════════
      if (mode === 'local') {
        // 1. Try to find user in stored local users
        if (type === 'staff') {
          const localUsers = await db.getUsers();
          const found = localUsers.find(u => u.username === username);

          if (found) {
            // Check password (support both hashed and plain text)
            const isValid = await this.verifyUserPassword(found.password || '', password);

            if (isValid) {
              // Migrate password if needed
              if (needsHashMigration(found.password || '')) {
                await this.migrateUserPassword(found, password);
              }

              loginRateLimiter.recordSuccess(identifier);
              this.setSession(found);
              void logAuthEvent({
                action: 'LOGIN',
                user: found,
                meta: { mode, type }
              });
              return { success: true, user: found };
            }
          }
        }

        // 2. Guardian login with phone + last 4 digits of student ID
        if (type === 'guardian') {
          const localSecurity = readGuardianLocalSecurity(username);
          if (localSecurity?.lockedUntil && isGuardianLocked(localSecurity.lockedUntil)) {
            return { success: false, message: 'الحساب مغلق مؤقتاً. حاول لاحقاً.' };
          }

          const students = await db.getStudentsByGuardian(username);
          const activeStudents = students.filter(s => s.is_active !== false);
          const matched = activeStudents.filter(s => String(s.id).slice(-4) === password);

          if (matched.length > 0) {
            const sessionChildren = activeStudents.map(child => ({
              id: child.id,
              name: child.name,
              grade: child.class_name,
              class: child.section
            }));
            const activeStudentId = sessionChildren.length === 1 ? sessionChildren[0].id : undefined;
            const user: User = {
              id: `g_${matched[0].id}`,
              username,
              name: `ولي أمر ${matched[0].name}`,
              role: Role.GUARDIAN
            };
            loginRateLimiter.recordSuccess(identifier);
            writeGuardianLocalSecurity(username, { attempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() });
            this.setSession(user, { children: sessionChildren, activeStudentId });
            void logAuthEvent({
              action: 'LOGIN',
              user,
              meta: { mode, type }
            });
            return { success: true, user };
          }

          const nextAttempts = (localSecurity?.attempts ?? 0) + 1;
          const lockedUntil = nextAttempts >= GUARDIAN_LOCKOUT_ATTEMPTS
            ? new Date(Date.now() + GUARDIAN_LOCKOUT_WINDOW_MS).toISOString()
            : null;
          writeGuardianLocalSecurity(username, {
            attempts: nextAttempts,
            lockedUntil,
            updatedAt: new Date().toISOString()
          });
          return { success: false, message: lockedUntil ? 'الحساب مغلق مؤقتاً. حاول لاحقاً.' : 'بيانات غير صحيحة' };
        }

        return { success: false, message: 'بيانات الدخول غير صحيحة' };
      }

      // ═══════════════════════════════════════════════════════════════
      // ☁️ CLOUD MODE LOGIC (SUPABASE)
      // ═══════════════════════════════════════════════════════════════
      const { supabase, supabaseStatus } = await getSupabaseServices();

      if (type === 'staff') {
        const { data: loginData, error } = await supabase.functions.invoke('hader-auth', {
          body: {
            username,
            password,
            turnstileToken
          }
        });
        const data = loginData?.user ?? loginData;
        if (error || !data?.id) {
          const message = supabaseStatus.isConfigured
            ? 'بيانات الدخول غير صحيحة.'
            : 'Supabase غير مهيأ. تأكد من إعدادات الاتصال ثم أعد المحاولة.';
          return {
            success: false,
            message
          };
        }

        const user: User = {
          id: data.id,
          username: data.username,
          name: data.name,
          role: data.role as Role,
          assigned_classes: normalizeAssignedClasses(data.assigned_classes),
          assigned_sections: normalizeAssignedSections(data.assigned_sections),
          email: data.email ?? undefined,
          phone: data.phone ?? undefined,
          is_active: data.is_active,
          can_use_whatsapp: data.can_use_whatsapp === true
        };

        let surveyAdminToken: string | undefined;
        let surveyAdminExpiresAt: number | undefined;
        if ([Role.SITE_ADMIN, Role.SCHOOL_ADMIN].includes(user.role) && loginData?.surveySession) {
          const sessionResult = loginData.surveySession;
          if (typeof sessionResult === 'string') {
            surveyAdminToken = sessionResult;
            surveyAdminExpiresAt = Date.now() + SESSION_TIMEOUT;
          } else if (typeof sessionResult === 'object') {
            const token = String(sessionResult.token ?? '');
            const expiresAt = new Date(String(sessionResult.expiresAt ?? '')).getTime();
            if (token && Number.isFinite(expiresAt)) {
              surveyAdminToken = token;
              surveyAdminExpiresAt = expiresAt;
            }
          }
        }

        loginRateLimiter.recordSuccess(identifier);
        this.setSession(user, undefined, surveyAdminToken, surveyAdminExpiresAt);
        void logAuthEvent({
          action: 'LOGIN',
          user,
          meta: { mode, type, provider: 'supabase' }
        });
        return { success: true, user };

      } else {
        // Guardian login
        const guardianPhoneColumn = 'guardian_phone';
        const studentIdColumn = 'id';
        const studentNameColumn = 'name';
        const studentClassColumn = 'class_name';
        const studentSectionColumn = 'section';
        const studentActiveColumn = 'is_active';

        const securityState = readGuardianLocalSecurity(username);

        if (securityState?.lockedUntil && isGuardianLocked(securityState.lockedUntil)) {
          return { success: false, message: 'الحساب مغلق مؤقتاً. حاول لاحقاً.' };
        }

        const { data, error } = await supabase
          .from('students')
          .select([
            studentIdColumn,
            studentNameColumn,
            studentClassColumn,
            studentSectionColumn,
            guardianPhoneColumn,
            studentActiveColumn
          ].join(','))
          .eq(guardianPhoneColumn, username);

        if (error || !data || data.length === 0) {
          const nextAttempts = (securityState?.attempts ?? 0) + 1;
          const lockedUntil = nextAttempts >= GUARDIAN_LOCKOUT_ATTEMPTS
            ? new Date(Date.now() + GUARDIAN_LOCKOUT_WINDOW_MS).toISOString()
            : null;
          writeGuardianLocalSecurity(username, {
            attempts: nextAttempts,
            lockedUntil,
            updatedAt: new Date().toISOString()
          });
          return { success: false, message: 'رقم الجوال غير مسجل' };
        }

        const activeStudents = data.filter((student: any) => student[studentActiveColumn] !== false);
        const matchedStudent = activeStudents.filter((student: any) =>
          String(student[studentIdColumn]).slice(-4) === password
        );

        if (matchedStudent.length === 0) {
          const nextAttempts = (securityState?.attempts ?? 0) + 1;
          const lockedUntil = nextAttempts >= GUARDIAN_LOCKOUT_ATTEMPTS
            ? new Date(Date.now() + GUARDIAN_LOCKOUT_WINDOW_MS).toISOString()
            : null;
          writeGuardianLocalSecurity(username, {
            attempts: nextAttempts,
            lockedUntil,
            updatedAt: new Date().toISOString()
          });
          return { success: false, message: 'كلمة المرور غير صحيحة (آخر 4 أرقام من معرف الطالب)' };
        }

        const sessionChildren = activeStudents.map((student: any) => ({
          id: student[studentIdColumn],
          name: student[studentNameColumn],
          grade: student[studentClassColumn],
          class: student[studentSectionColumn]
        }));
        const activeStudentId = sessionChildren.length === 1 ? sessionChildren[0].id : undefined;
        const user: User = {
          id: `guardian_${matchedStudent[0][studentIdColumn]}`,
          username: username,
          name: `ولي أمر ${matchedStudent[0][studentNameColumn]}`,
          role: Role.GUARDIAN
        };

        loginRateLimiter.recordSuccess(identifier);
        writeGuardianLocalSecurity(username, {
          attempts: 0,
          lockedUntil: null,
          updatedAt: new Date().toISOString()
        });
        this.setSession(user, { children: sessionChildren, activeStudentId });
        void logAuthEvent({
          action: 'LOGIN',
          user,
          meta: { mode, type, provider: 'supabase' }
        });
        return { success: true, user };
      }

    } catch (error) {
      logError(error, 'Auth - Login');

      // Handle specific error types
      if (error instanceof AuthenticationError || error instanceof ValidationError) {
        return { success: false, message: error.message };
      }

      if (error instanceof NetworkError) {
        return {
          success: false,
          message: 'فشل الاتصال بالشبكة. يرجى التحقق من اتصال الإنترنت.'
        };
      }

      if (error instanceof DatabaseError) {
        return {
          success: false,
          message: 'حدث خطأ في قاعدة البيانات. يرجى المحاولة لاحقاً.'
        };
      }

      return { success: false, message: 'حدث خطأ غير متوقع' };
    }
  },

  /**
   * 👤 Retrieve the current authenticated user (local-first)
   */
  async getCurrentUser(): Promise<User | null> {
    const sessionUser = this.getSession();
    if (sessionUser) return sessionUser;

    try {
      const { supabase } = await getSupabaseServices();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) return null;
      const role = (data.user.user_metadata as Record<string, unknown>)?.role as Role | undefined;
      const user = {
        id: data.user.id,
        username: data.user.email || data.user.id,
        name: data.user.user_metadata?.name || 'مستخدم',
        role: role || Role.WATCHER
      } as User;
      void logAuthEvent({
        action: 'SESSION_RESTORE',
        user,
        meta: { source: 'getCurrentUser' }
      });
      return user;
    } catch (error) {
      logError(error, 'Auth - Get Current User');
      return null;
    }
  },

  /**
   * 🔑 Verify password (supports both hashed and plain text)
   */
  async verifyUserPassword(storedPassword: string, inputPassword: string): Promise<boolean> {
    if (!storedPassword) return false;

    try {
      // Check if password is hashed (contains PBKDF2 format)
      if (storedPassword.includes(':')) {
        return await verifyPassword(inputPassword, storedPassword);
      }

      // Legacy plain text comparison
      return storedPassword === inputPassword;
    } catch (error) {
      logError(error, 'Auth - Verify Password');
      return false;
    }
  },

  /**
   * 🔄 Migrate user password to hashed format
   */
  async migrateUserPassword(user: User, plainPassword: string): Promise<void> {
    try {
      const hashedPassword = await hashPassword(plainPassword);
      const db = await getDb();

      if (db.getMode() === 'local') {
        // Update in local storage
        const users = await db.getUsers();
        const userIndex = users.findIndex(u => u.id === user.id);
        if (userIndex >= 0) {
          users[userIndex].password = hashedPassword;
          // Save updated users list
          localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        }
      } else {
        // Update in Supabase
        const { supabase } = await getSupabaseServices();
        await supabase
          .from('users')
          .update({ password: hashedPassword, password_hash_version: 1 })
          .eq('id', user.id);
      }

      // Password migration completed (not logging username for security)
    } catch (error) {
      logError(error, 'Auth - Migrate Password');
    }
  },

  /**
   * 💾 Set session with token
   */
  setSession(user: User, guardian?: SecureSessionPayload['guardian'], surveyAdminToken?: string, surveyAdminExpiresAt?: number) {
    const appExpiry = Date.now() + SESSION_TIMEOUT;
    const session: SecureSessionPayload = {
      user,
      token: generateSessionToken(),
      expiresAt: surveyAdminExpiresAt ? Math.min(appExpiry, surveyAdminExpiresAt) : appExpiry,
      createdAt: Date.now(),
      sessionId: createSessionId(),
      surveyAdminToken,
      surveyAdminExpiresAt,
      guardian
    };
    secureSessionStorage.save(session);
    notifySessionListeners(user);
  },

  /**
   * 📖 Get current session
   */
  getSession(): User | null {
    const session = secureSessionStorage.get();
    if (!session) return null;
    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.logout({ reason: 'SESSION_EXPIRED' });
      return null;
    }
    // Note: logAuthEvent removed to prevent telemetry spam.
    // getSession() is called by hasRole(), requireRole(), etc. dozens of times per page load.
    return session.user;
  },

  /**
   * 🔄 Refresh session (extend timeout)
   */
  refreshSession(force = false) {
    const session = secureSessionStorage.get();
    if (!session) return;
    const timeLeft = session.expiresAt - Date.now();
    if (!force && timeLeft > SESSION_RENEW_THRESHOLD) return;
    const renewedExpiry = Date.now() + SESSION_TIMEOUT;
    secureSessionStorage.save({
      ...session,
      expiresAt: session.surveyAdminExpiresAt
        ? Math.min(renewedExpiry, session.surveyAdminExpiresAt)
        : renewedExpiry
    });
    notifySessionListeners(session.user);
  },

  /**
   * 🚪 Logout
   */
  logout(options?: { reason?: 'LOGOUT' | 'SESSION_EXPIRED'; skipLog?: boolean }) {
    const reason = options?.reason ?? 'LOGOUT';
    const session = secureSessionStorage.get();
    let reloadStarted = false;
    const reload = () => {
      if (reloadStarted) return;
      reloadStarted = true;
      window.location.reload();
    };
    const revocation = session?.surveyAdminToken
      ? getSupabaseServices().then(({ supabaseStatus, revokeSurveySessionKeepalive }) => (
          supabaseStatus.isConfigured
            ? revokeSurveySessionKeepalive(session.surveyAdminToken!)
            : undefined
        )).catch(() => undefined)
      : null;
    if (!options?.skipLog && session?.user) {
      void logAuthEvent({
        action: reason,
        user: session.user,
        meta: { source: 'logout' }
      });
    }
    secureSessionStorage.clear();
    appCache.clear();
    notifySessionListeners(null);
    if (revocation) {
      void revocation.finally(reload);
      window.setTimeout(reload, 1000);
    } else {
      reload();
    }
  },

  /**
   * 🛡️ Require specific roles
   */
  requireRole(allowedRoles: Role[]): User | null {
    const user = this.getSession();

    if (!user) {
      window.location.reload();
      return null;
    }

    if (!allowedRoles.includes(user.role)) {
      alert('عفواً، ليس لديك صلاحية للوصول لهذه الصفحة.');

      if (user.role === Role.GUARDIAN) {
        window.location.hash = '/parents';
      } else {
        window.location.hash = '/';
      }
      return user;
    }

    // Refresh session on activity
    this.refreshSession();

    return user;
  },

  /**
   * 🔐 Check if current user has role
   */
  hasRole(role: Role): boolean {
    const user = this.getSession();
    return user?.role === role;
  },

  /**
   * 🔐 Check if current user has any of the roles
   */
  hasAnyRole(roles: Role[]): boolean {
    const user = this.getSession();
    return user ? roles.includes(user.role) : false;
  },

  /**
   * 📊 Get rate limiter stats
   */
  getRateLimitStats() {
    return loginRateLimiter.getStats();
  },

  /**
   * 👂 Subscribe to session changes
   */
  onSessionChange(listener: SessionListener) {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  }
};

secureSessionStorage.onChange((event) => {
  if (event === 'updated') {
    const session = secureSessionStorage.get();
    notifySessionListeners(session ? session.user : null);
  } else {
    notifySessionListeners(null);
  }
});
