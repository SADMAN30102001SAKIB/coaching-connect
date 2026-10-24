import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { phoneSchema } from '@coaching/domain';
import { validationDetails } from '../apps/worker/src/errors';

function details(schema: z.ZodType, input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error('Expected invalid test input');
  return validationDetails(parsed.error);
}

describe('human-readable validation', () => {
  it('identifies contact numbers without exposing dotted paths or submitted values', () => {
    const result = details(z.object({ contacts: z.array(z.object({ phone: phoneSchema })) }), {
      contacts: [{ phone: '0173456789' }, { phone: 'invalid-secret-input' }],
    });
    expect(result).toEqual([
      {
        field: 'Phone number',
        section: 'Contact',
        item: 1,
        message: 'Enter a valid Bangladesh mobile number',
      },
      {
        field: 'Phone number',
        section: 'Contact',
        item: 2,
        message: 'Enter a valid Bangladesh mobile number',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /contacts\.0|invalid-secret-input|expected|received/,
    );
  });

  it('replaces library defaults for required fields, limits, dates, choices and types', () => {
    const result = details(
      z.object({
        name: z.string().min(1),
        password: z.string().min(15),
        body: z.string().max(4),
        exam_date: z.iso.date(),
        audience: z.enum(['guardian', 'student']),
        batch_size: z.number().int().min(1),
        interval_seconds: z.number(),
        role_ids: z.array(z.uuid()).max(1),
      }),
      {
        name: '',
        password: 'short',
        body: 'too long',
        exam_date: 'bad',
        audience: 'bad',
        batch_size: 0,
        interval_seconds: 'bad',
        role_ids: [crypto.randomUUID(), crypto.randomUUID()],
      },
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { field: 'Name', message: 'This field is required.', limit: 1 },
        { field: 'New password', message: 'Use at least {limit} characters.', limit: 15 },
        { field: 'Message', message: 'Use {limit} characters or fewer.', limit: 4 },
        { field: 'Exam date', message: 'Enter a valid date.' },
        { field: 'Recipients', message: 'Choose one of the available options.' },
        {
          field: 'Messages per provider request',
          message: 'Enter a number of at least {limit}.',
          limit: 1,
        },
        { field: 'Seconds between batches', message: 'Enter a valid number.' },
        { field: 'Roles', message: 'Choose no more than {limit} items.', limit: 1 },
      ]),
    );
  });

  it('uses a safe label for unknown fields and readable subject numbering', () => {
    expect(details(z.object({ internal_key: z.string() }), { internal_key: 5 })).toEqual([
      { field: 'Form', message: 'Enter a value for this field.' },
    ]);
    expect(
      details(z.object({ papers: z.array(z.object({ subject_id: z.uuid() })) }), {
        papers: [{ subject_id: 'bad' }],
      }),
    ).toEqual([
      { field: 'Subject', section: 'Subject', item: 1, message: 'Check this value and try again.' },
    ]);
  });
  it('keeps exclusive numeric bounds accurate', () => {
    expect(details(z.object({ score: z.number().positive() }), { score: 0 })).toEqual([
      { field: 'Marks', message: 'Enter a number greater than {limit}.', limit: 0 },
    ]);
  });
});
