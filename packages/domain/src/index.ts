import { z } from 'zod';

export interface ValidationDetail {
  field: string;
  message: string;
  section?: string;
  item?: number;
  limit?: number;
}

export const features = [
  'students',
  'groups',
  'academic',
  'exams',
  'results',
  'templates',
  'messages',
  'balance',
] as const;
export const actions = ['read', 'create', 'update', 'archive'] as const;
export const permissions = [
  ...features.flatMap((feature) =>
    actions
      .filter((action) =>
        feature === 'balance'
          ? action === 'read'
          : feature === 'results'
            ? ['read', 'update'].includes(action)
            : feature === 'messages'
              ? ['read', 'create'].includes(action)
              : true,
      )
      .map((action) => `${feature}.${action}`),
  ),
  'messages.send',
  'messages.schedule',
  'messages.cancel',
  'messages.retry',
  'messages.read_content',
  'balance.refresh',
  'provider.manage',
] as const;
export const permissionSchema = z
  .string()
  .refine((value) => permissions.includes(value), 'Unknown permission');
export function requiredPermissions(permission: string): string[] {
  const [feature, action] = permission.split('.');
  const required = new Set<string>();
  if (feature && action !== 'read' && permissions.includes(`${feature}.read`))
    required.add(`${feature}.read`);
  if (feature === 'results') required.add('exams.read');
  if (permission === 'exams.create') required.add('academic.read');
  if (permission === 'messages.retry') required.add('messages.read_content');
  for (const dependency of [...required]) {
    for (const nested of requiredPermissions(dependency)) required.add(nested);
  }
  return [...required];
}
export const nameSchema = z.string().trim().min(1).max(160);
export const passwordSchema = z.string().min(15, 'Use at least 15 characters').max(128);
export const localeSchema = z.enum(['en', 'bn']);
export const resultStatus = z.enum(['scored', 'absent', 'pending', 'exempt']);
export type ResultStatus = z.infer<typeof resultStatus>;
export const templateScope = z.enum(['subject', 'summary', 'announcement']);
export type TemplateScope = z.infer<typeof templateScope>;
export const variables = [
  'student_name',
  'exam_name',
  'subject_name',
  'marks',
  'full_marks',
  'results_summary',
  'institute_name',
] as const;
export type Variable = (typeof variables)[number];

export function normalizePhone(input: string): string {
  const clean = input
    .replace(/[\s()-]/g, '')
    .replace(/^\+/, '')
    .replace(/^00880/, '880');
  const phone = clean.startsWith('01') ? `88${clean}` : clean;
  if (!/^8801[3-9]\d{8}$/.test(phone)) throw new Error('Enter a valid Bangladesh mobile number');
  return phone;
}

export const phoneSchema = z.string().transform((value, ctx) => {
  try {
    return normalizePhone(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladesh mobile number' });
    return z.NEVER;
  }
});

export function toScore(value: string): number {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value))
    throw new Error('Enter a positive number with at most two decimal places');
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function formatScore(value: number): string {
  return (value / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

export function renderTemplate(
  text: string,
  scope: TemplateScope,
  values: Partial<Record<Variable, string>>,
): string {
  if (/[{}]/.test(text.replace(/\{\{\s*\w+\s*\}\}/g, '')))
    throw new Error('Use the variable buttons to insert valid placeholders');
  const allowed =
    scope === 'announcement'
      ? ['student_name', 'institute_name']
      : scope === 'summary'
        ? ['student_name', 'exam_name', 'results_summary', 'institute_name']
        : variables.filter((v) => v !== 'results_summary');
  let prepared = text;
  if (values.marks && ['absent', 'pending', 'exempt'].includes(values.marks)) {
    prepared = prepared.replace(
      /\{\{\s*marks\s*\}\}\s*\/\s*\{\{\s*full_marks\s*\}\}/g,
      '{{marks}}',
    );
  }
  const rendered = prepared.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => {
    if (!allowed.includes(token))
      throw new Error(`Variable ${token} is not available for this message type`);
    const value = values[token as Variable];
    if (value === undefined || value === '')
      throw new Error(`Missing ${token.replaceAll('_', ' ')}`);
    return value;
  });
  if (!rendered.trim()) throw new Error('The message cannot be empty');
  if (rendered.length > 4000) throw new Error('Shorten this message to 4,000 characters or fewer');
  return rendered;
}

const gsm = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const extended = new Set('^{}\\[~]|€');
export function estimateSegments(text: string): {
  encoding: 'GSM-7' | 'Unicode';
  units: number;
  segments: number;
} {
  let units = 0;
  for (const char of text) {
    if (gsm.has(char)) units++;
    else if (extended.has(char)) units += 2;
    else
      return {
        encoding: 'Unicode',
        units: text.length,
        segments: Math.ceil(text.length / (text.length <= 70 ? 70 : 67)),
      };
  }
  return { encoding: 'GSM-7', units, segments: Math.ceil(units / (units <= 160 ? 160 : 153)) };
}

export interface User {
  id: string;
  name: string;
  phone: string;
  platform: number;
}
export interface Center {
  id: string;
  name: string;
  timezone: string;
  locale: 'en' | 'bn';
  owner_id: string;
  active: number;
  revision: number;
  late_minutes: number;
  students_count: number;
  groups_count: number;
  exams_count: number;
}
export interface Catalog {
  id: string;
  kind: 'subject' | 'group';
  name: string;
  active: number;
  version: number;
}
export interface Student {
  id: string;
  name: string;
  identifier: string;
  active: number;
  version: number;
  group_name?: string | null;
}
export interface Contact {
  suppressed: number;
  id: string;
  phone: string;
  audience: 'student' | 'guardian';
  permitted: number;
}
export interface Exam {
  id: string;
  name: string;
  exam_date: string;
  active: number;
  version: number;
}
export interface Paper {
  version: number;
  id: string;
  name: string;
  exam_id: string;
  subject_id: string;
  maximum: number;
  position: number;
}
export interface Mark {
  student_id: string;
  name: string;
  identifier: string;
  status: ResultStatus;
  score: number | null;
  version: number;
  group_name?: string | null;
}
export interface Template {
  id: string;
  name: string;
  scope: TemplateScope;
  body: string;
  active: number;
  version: number;
}
export interface Role {
  id: string;
  name: string;
  permissions: string[];
  version: number;
}
export interface Campaign {
  id: string;
  name: string;
  state: string;
  created_at: number;
  scheduled_at: number | null;
  total: number;
  excluded: number;
  submitted: number;
  delivered: number;
  failed: number;
  unknown: number;
  skipped: number;
  reason: string | null;
}
export interface Message {
  id: string;
  student_name: string;
  phone: string;
  body: string;
  state: string;
  provider_id: string | null;
  reason: string | null;
  segments: number;
}
export interface Page<T> {
  items: T[];
  next: string | null;
}
export interface Session {
  user: User;
  centers: Center[];
}
export interface Context {
  center: Center;
  permissions: string[];
  admin: boolean;
}
export interface ProviderSettings {
  configured: boolean;
  suffix: string;
  sender_ids: string[];
  batch_size: number;
  interval_seconds: number;
  revision: number;
  mode: string;
}
export interface Balance {
  balance: string | null;
  estimate_sms: number | null;
  checked_at: number | null;
}
export const campaignInput = z.object({
  name: nameSchema.default('Update'),
  scope: templateScope,
  body: z.string().min(1).max(4000),
  exam_ids: z.array(z.string()).max(50),
  paper_id: z.string().nullable(),
  group_ids: z.array(z.string()).max(50),
  student_ids: z.array(z.string()).max(100),
  audience: z.enum(['student', 'guardian', 'both']),
  idempotency_key: z.uuid(),
  resumption_source: z.uuid().nullable().default(null),
  recipient_keys: z.array(z.string().max(100)).max(100).default([]),
});
export type CampaignInput = z.infer<typeof campaignInput>;

export function zonedTimestamp(local: string, timezone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error('Choose a valid date and time.');
  const utc = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(utc)) throw new Error('Choose a valid date and time.');
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const offset = (time: number) =>
    Date.parse(`${formatter.format(time).replace(' ', 'T')}:00Z`) - time;
  const guess = utc - offset(utc);
  const candidates = [
    ...new Set(
      [0, -7200000, -3600000, -1800000, 1800000, 3600000, 7200000].map((delta) => guess + delta),
    ),
  ].filter((time) => formatter.format(time).replace(' ', 'T') === local);
  if (candidates.length !== 1)
    throw new Error('This time is skipped or repeated by daylight saving. Choose another time.');
  const candidate = candidates[0];
  if (candidate === undefined || candidate <= Date.now() + 60000)
    throw new Error('Choose a time at least one minute in the future.');
  return candidate;
}
