import type {
  IntegrationAdapter,
  IntegrationAdapterInspection,
  IntegrationChange,
  IntegrationInspectRequest
} from './index';
import {
  isAllowedAutomationUrl,
  type BrowserAutomationPolicy
} from './browserPolicy';

export type NoorPageSnapshot = Readonly<{
  url: string;
  title: string;
  html: string;
  capturedAt: string;
}>;

export type NoorBrowserPort = Readonly<{
  captureRosterPage(policy: BrowserAutomationPolicy): Promise<NoorPageSnapshot>;
}>;

type NoorBrowserAdapterEnvironment = Readonly<{
  now?: () => Date;
  maxSnapshotAgeMs?: number;
}>;

type NoorRosterRow = Readonly<{
  externalId: string;
  name: string;
  className: string;
  section: string;
}>;

type LocalStudent = Readonly<{
  externalId: string;
  name: string;
  className: string;
  section: string;
}>;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

const normalizeDigits = (value: string): string => value.replace(/[٠-٩۰-۹]/g, digit => {
  const arabicIndex = ARABIC_DIGITS.indexOf(digit);
  if (arabicIndex >= 0) return String(arabicIndex);
  return String(PERSIAN_DIGITS.indexOf(digit));
});

const normalizeText = (value: string): string => normalizeDigits(value)
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeHeader = (value: string): string => normalizeText(value)
  .replace(/[ـ:：]/g, '')
  .toLowerCase();

const HEADER_ALIASES = Object.freeze({
  externalId: ['رقم الطالب', 'رقم الهوية', 'السجل المدني', 'رقم السجل المدني', 'رقم المستخدم'],
  name: ['اسم الطالب', 'الطالب', 'الاسم'],
  className: ['الصف', 'الصف الدراسي', 'المرحلة'],
  section: ['الفصل', 'الشعبة', 'القسم']
});

const resolveColumn = (headers: readonly string[], aliases: readonly string[]): number => {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex(header => normalizedAliases.includes(normalizeHeader(header)));
};

const fingerprint = async (value: string): Promise<string> => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure SHA-256 fingerprinting is unavailable; automation stopped safely');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

const toChangeIdSegment = (value: string): string => encodeURIComponent(value);

const readString = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return normalizeText(String(value));
  }
  return '';
};

const readLocalStudents = (input: IntegrationInspectRequest['input']): readonly LocalStudent[] => {
  const candidates = input?.localStudents;
  if (!Array.isArray(candidates)) return Object.freeze([]);

  const byExternalId = new Map<string, LocalStudent>();
  candidates.forEach(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Hader local roster is malformed or contains duplicate identifiers');
    }
    const record = candidate as Readonly<Record<string, unknown>>;
    const externalId = readString(record.external_id ?? record.externalId ?? record.id);
    const name = readString(record.name);
    const className = readString(record.class_name ?? record.className);
    const section = readString(record.section);
    if (!externalId || !name || !className || !section || byExternalId.has(externalId)) {
      throw new Error('Hader local roster is malformed or contains duplicate identifiers');
    }
    byExternalId.set(externalId, Object.freeze({
      externalId,
      name,
      className,
      section
    }));
  });
  return Object.freeze([...byExternalId.values()]);
};

const toStudentRecord = (
  student: NoorRosterRow | LocalStudent
): Readonly<Record<string, unknown>> => Object.freeze({
  external_id: student.externalId,
  name: student.name,
  class_name: student.className,
  section: student.section
});

const studentsMatch = (left: NoorRosterRow, right: LocalStudent): boolean => (
  left.externalId === right.externalId
  && left.name === right.name
  && left.className === right.className
  && left.section === right.section
);

/** Parses only complete, unambiguous roster tables and derives a content revision. */
const parseRoster = async (snapshot: NoorPageSnapshot): Promise<Readonly<{
  rows: readonly NoorRosterRow[];
  revision: string;
}>> => {
  const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
  const normalizedTitle = normalizeText(snapshot.title);
  const hasPasswordField = document.querySelector('input[type="password"]') !== null;
  if (
    hasPasswordField
    || normalizedTitle.includes('تسجيل الدخول')
  ) {
    throw new Error('Noor authentication is required; complete sign-in manually');
  }

  const candidates = [...document.querySelectorAll('table')].map(table => {
    const headerCells = [...table.querySelectorAll('thead th')];
    const fallbackHeaders = headerCells.length > 0
      ? headerCells
      : [...(table.querySelector('tr')?.querySelectorAll('th,td') ?? [])];
    const headers = fallbackHeaders.map(cell => normalizeText(cell.textContent ?? ''));
    const columns = {
      externalId: resolveColumn(headers, HEADER_ALIASES.externalId),
      name: resolveColumn(headers, HEADER_ALIASES.name),
      className: resolveColumn(headers, HEADER_ALIASES.className),
      section: resolveColumn(headers, HEADER_ALIASES.section)
    };
    const score = Object.values(columns).filter(index => index >= 0).length;
    return { table, headers, columns, score };
  }).sort((left, right) => right.score - left.score);

  const match = candidates[0];
  if (
    !match
    || match.score < 4
    || match.columns.externalId < 0
    || match.columns.name < 0
    || match.columns.className < 0
    || match.columns.section < 0
  ) {
    throw new Error('Noor roster layout is not recognized; automation stopped safely');
  }

  const bodyRows = [...match.table.querySelectorAll('tbody tr')];
  const sourceRows = bodyRows.length > 0
    ? bodyRows
    : [...match.table.querySelectorAll('tr')].slice(1);
  const byExternalId = new Map<string, NoorRosterRow>();

  sourceRows.forEach(row => {
    const cells = [...row.querySelectorAll('td')].map(cell => normalizeText(cell.textContent ?? ''));
    const externalId = cells[match.columns.externalId] ?? '';
    const name = cells[match.columns.name] ?? '';
    const className = cells[match.columns.className] ?? '';
    const section = cells[match.columns.section] ?? '';
    if (cells.join(' ').includes('لا توجد بيانات')) return;
    if (!externalId || !name || !className || !section) {
      throw new Error('Noor roster contains an incomplete student row; automation stopped safely');
    }
    if (byExternalId.has(externalId)) {
      throw new Error('Noor roster contains a duplicate student identifier; automation stopped safely');
    }
    byExternalId.set(externalId, Object.freeze({
      externalId,
      name,
      className,
      section
    }));
  });

  if (byExternalId.size === 0) {
    throw new Error('Noor roster is unexpectedly empty; automation stopped safely');
  }

  return Object.freeze({
    rows: Object.freeze([...byExternalId.values()]),
    revision: `noor-roster:${await fingerprint([
      normalizeText(snapshot.title),
      match.headers.join('|'),
      ...[...byExternalId.values()].map(row => [
        row.externalId,
        row.name,
        row.className,
        row.section
      ].join('|'))
    ].join('::'))}`
  });
};

const reconcileRoster = (
  remoteRows: readonly NoorRosterRow[],
  localStudents: readonly LocalStudent[]
): readonly IntegrationChange[] => {
  const localByExternalId = new Map(
    localStudents.map(student => [student.externalId, student] as const)
  );
  const seenExternalIds = new Set<string>();
  const changes = remoteRows.map((remote): IntegrationChange => {
    seenExternalIds.add(remote.externalId);
    const local = localByExternalId.get(remote.externalId);
    const base = {
      id: `noor-student-${toChangeIdSegment(remote.externalId)}`,
      entityType: 'student',
      entityLabel: remote.name,
      after: toStudentRecord(remote),
      warnings: Object.freeze([])
    };
    if (!local) return Object.freeze({ ...base, action: 'create' as const });
    return Object.freeze({
      ...base,
      action: studentsMatch(remote, local) ? 'unchanged' as const : 'update' as const,
      before: toStudentRecord(local)
    });
  });

  localStudents.forEach(local => {
    if (seenExternalIds.has(local.externalId)) return;
    changes.push(Object.freeze({
      id: `hader-student-${toChangeIdSegment(local.externalId)}`,
      entityType: 'student',
      entityLabel: local.name,
      action: 'delete',
      before: toStudentRecord(local),
      after: null,
      blocked: true,
      warnings: Object.freeze([
        'الطالب غير ظاهر في كشف نور الحالي؛ لا يُحذف تلقائياً ويتطلب تحققاً يدوياً'
      ])
    }));
  });

  return Object.freeze(changes);
};

export const createNoorBrowserAdapter = (
  port: NoorBrowserPort,
  policy: BrowserAutomationPolicy,
  environment: NoorBrowserAdapterEnvironment = {}
): IntegrationAdapter => {
  const now = environment.now ?? (() => new Date());
  const maxSnapshotAgeMs = environment.maxSnapshotAgeMs ?? 10 * 60 * 1000;
  if (!Number.isFinite(maxSnapshotAgeMs) || maxSnapshotAgeMs < 1_000 || maxSnapshotAgeMs > 60 * 60 * 1000) {
    throw new Error('Noor snapshot age limit must be between 1 second and 1 hour');
  }

  return Object.freeze({
    platform: 'noor',
    capabilities: Object.freeze([
      Object.freeze({ operation: 'pull-roster', effect: 'read' as const })
    ]),

    async inspect(request: IntegrationInspectRequest): Promise<IntegrationAdapterInspection> {
      if (request.operation !== 'pull-roster') {
        throw new Error(`Unsupported Noor operation: ${request.operation}`);
      }
      const snapshot = await port.captureRosterPage(policy);
      if (!isAllowedAutomationUrl(policy, snapshot.url)) {
        throw new Error('Noor page host is not explicitly allowed');
      }
      const capturedAt = Date.parse(snapshot.capturedAt);
      const snapshotAge = now().getTime() - capturedAt;
      if (!Number.isFinite(capturedAt) || snapshotAge < -60_000 || snapshotAge > maxSnapshotAgeMs) {
        throw new Error('Noor snapshot is stale or has an invalid capture time; automation stopped safely');
      }
      const roster = await parseRoster(snapshot);
      const localStudents = readLocalStudents(request.input);
      return Object.freeze({
        remoteRevision: roster.revision,
        changes: reconcileRoster(roster.rows, localStudents),
        warnings: Object.freeze([])
      });
    },

    async apply() {
      throw new Error('Noor browser adapter is read-only');
    }
  });
};
