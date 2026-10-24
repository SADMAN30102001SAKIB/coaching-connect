import type { z } from 'zod';
import type { ValidationDetail } from '@coaching/domain';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503 = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503 = 400,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
const fieldLabels: Record<string, string> = {
  name: 'Name',
  phone: 'Phone number',
  identifier: 'Identifier / roll',
  contacts: 'Contacts',
  audience: 'Recipients',
  permitted: 'SMS permission',
  group_ids: 'Groups',
  group_id: 'Group',
  student_ids: 'Students',
  student_id: 'Student',
  exam_ids: 'Exams',
  exam_date: 'Exam date',
  papers: 'Subjects',
  subject_id: 'Subject',
  paper_id: 'Subject',
  maximum: 'Maximum marks',
  score: 'Marks',
  status: 'Status',
  body: 'Message',
  scope: 'Message type',
  permissions: 'Permissions',
  role_ids: 'Roles',
  user_id: 'Staff member',
  password: 'New password',
  current: 'Current password',
  token: 'Setup or invitation code',
  code: 'Recovery code',
  api_key: 'API key',
  sender_ids: 'Sender IDs',
  batch_size: 'Messages per provider request',
  interval_seconds: 'Seconds between batches',
  late_minutes: 'Late-send window (minutes)',
  evidence: 'Verification reference',
  confirmed: 'Confirmation',
  scheduled_at: 'Send date and time',
  active: 'Status',
  kind: 'Record type',
  message_ids: 'Messages',
  acknowledge_duplicate_risk: 'Duplicate-send confirmation',
  version: 'Saved record',
  idempotency_key: 'Submission',
  recipient_keys: 'Recipients',
};

export function validationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => {
    const key = [...issue.path].reverse().find((part) => typeof part === 'string');
    const field = typeof key === 'string' ? (fieldLabels[key] ?? 'Form') : 'Form';
    const index = issue.path.find((part) => typeof part === 'number');
    const section =
      issue.path[0] === 'contacts' ? 'Contact' : issue.path[0] === 'papers' ? 'Subject' : 'Item';
    let message = 'Check this value and try again.';
    let limit: number | undefined;
    if (issue.code === 'custom') message = issue.message;
    else if (issue.code === 'too_small' || issue.code === 'too_big') {
      const small = issue.code === 'too_small';
      limit = Number(small ? issue.minimum : issue.maximum);
      if (issue.origin === 'string') {
        message = small
          ? limit === 1
            ? 'This field is required.'
            : 'Use at least {limit} characters.'
          : 'Use {limit} characters or fewer.';
      } else if (issue.origin === 'array') {
        message = small ? 'Choose at least {limit} items.' : 'Choose no more than {limit} items.';
      } else {
        message = small
          ? issue.inclusive
            ? 'Enter a number of at least {limit}.'
            : 'Enter a number greater than {limit}.'
          : issue.inclusive
            ? 'Enter a number no greater than {limit}.'
            : 'Enter a number less than {limit}.';
      }
    } else if (issue.code === 'invalid_type') {
      message =
        issue.expected === 'number' || issue.expected === 'int'
          ? 'Enter a valid number.'
          : issue.expected === 'string'
            ? 'Enter a value for this field.'
            : 'Check this value and try again.';
    } else if (issue.code === 'invalid_format') {
      message = issue.format === 'date' ? 'Enter a valid date.' : 'Check this value and try again.';
    } else if (issue.code === 'invalid_value') message = 'Choose one of the available options.';
    return {
      field,
      message,
      ...(typeof index === 'number' ? { section, item: index + 1 } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
  });
}
