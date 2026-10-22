import { z } from 'zod';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import {
  estimateSegments,
  formatScore,
  normalizePhone,
  renderTemplate,
  toScore,
  zonedTimestamp,
} from '@coaching/domain';
import { app } from '../apps/worker/src/index';
import { digest, hashPassword, secret, type Bindings } from '../apps/worker/src/security';
import { now, one, rows, statement, uid } from '../apps/worker/src/db';
import { processJob, scheduled, checkMessage } from '../apps/worker/src/campaigns';
import { parseSubmissions } from '../apps/worker/src/provider';

declare module 'vitest' {
  interface ProvidedContext {
    migration: string;
  }
}
const bindings: Bindings = {
  ...env,
  SMS_MODE: 'mock',
  DISPATCH_ENABLED: 'false',
  BOOTSTRAP_TOKEN: 'test-only-bootstrap-key-not-a-real-secret-0001',
};
const userId = uid();
const otherId = uid();
const centerId = uid();
const otherCenter = uid();
let cookie = '';
async function call(path: string, method = 'GET', body?: unknown, session = cookie) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: {
        ...(session ? { Cookie: session } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    bindings,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return {
    status: response.status,
    body: z.record(z.string(), z.unknown()).parse(await response.json()),
    headers: response.headers,
  };
}
beforeAll(async () => {
  await env.DB.exec(inject('migration'));
  const token = secret();
  cookie = `coaching_session=${token}`;
  await env.DB.batch([
    statement(
      env.DB,
      'INSERT INTO users VALUES(?,?,?,?,?,?)',
      userId,
      'Teacher',
      '8801700000001',
      await hashPassword('a long test password 123'),
      1,
      now(),
    ),
    statement(
      env.DB,
      'INSERT INTO users VALUES(?,?,?,?,?,?)',
      otherId,
      'Other teacher',
      '8801700000002',
      null,
      0,
      now(),
    ),
    statement(
      env.DB,
      'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
      centerId,
      'First coaching',
      userId,
    ),
    statement(
      env.DB,
      'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
      otherCenter,
      'Other coaching',
      otherId,
    ),
    statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', centerId, userId),
    statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', otherCenter, otherId),
    statement(
      env.DB,
      'INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)',
      await digest(token),
      userId,
      now() + 86400000,
      now(),
    ),
  ]);
});

describe('domain rules', () => {
  it('converts center-local schedules and rejects skipped or repeated times', () => {
    expect(zonedTimestamp('2030-01-15T12:30', 'Asia/Dhaka')).toBe(
      Date.parse('2030-01-15T06:30:00Z'),
    );
    expect(() => zonedTimestamp('2030-03-10T02:30', 'America/New_York')).toThrow();
    expect(() => zonedTimestamp('2030-11-03T01:30', 'America/New_York')).toThrow();
    expect(() => zonedTimestamp('2020-01-01T12:00', 'Asia/Dhaka')).toThrow();
  });
  it('normalizes Bangladesh numbers without merging identities', () => {
    expect(normalizePhone('+880 1700-000001')).toBe('8801700000001');
    expect(normalizePhone('01700000001')).toBe('8801700000001');
    expect(() => normalizePhone('123')).toThrow();
  });
  it('keeps decimal marks exact and rejects excess precision', () => {
    expect(toScore('12.05')).toBe(1205);
    expect(toScore('0')).toBe(0);
    expect(formatScore(1205)).toBe('12.05');
    expect(() => toScore('1.005')).toThrow();
    expect(() => toScore('-1')).toThrow();
  });
  it('validates template scope, missing values and literal braces', () => {
    expect(
      renderTemplate('Hello {{student_name}}', 'announcement', { student_name: 'Ayesha' }),
    ).toBe('Hello Ayesha');
    expect(() => renderTemplate('{{marks}}', 'announcement', { marks: '50' })).toThrow();
    expect(() => renderTemplate('{{student_name}}', 'summary', {})).toThrow();
    expect(() => renderTemplate('{oops}', 'summary', {})).toThrow();
  });
  it('estimates extended GSM and Unicode segments separately', () => {
    expect(estimateSegments('a'.repeat(160)).segments).toBe(1);
    expect(estimateSegments('a'.repeat(161)).segments).toBe(2);
    expect(estimateSegments('^'.repeat(81)).segments).toBe(2);
    expect(estimateSegments('বাংলা').encoding).toBe('Unicode');
    expect(estimateSegments('🙂'.repeat(36)).segments).toBe(2);
  });
});
describe('provider contracts', () => {
  it('never invents success from an empty or malformed acknowledgement', () => {
    expect(parseSubmissions({ ErrorCode: 202 }, [{ phone: '8801700000001' }])[0]?.state).toBe(
      'unknown',
    );
    expect(parseSubmissions('ok', [{ phone: '8801700000001' }])[0]?.state).toBe('unknown');
  });
  it('requires message IDs and maps bulk outcomes by destination, not array order', () => {
    const response = {
      ErrorCode: 202,
      Data: [
        { MobileNumber: '8801700000002', MessageId: 'provider-2' },
        { MobileNumber: '8801700000001', MessageId: 'provider-1' },
      ],
    };
    expect(
      parseSubmissions(response, [{ phone: '8801700000001' }, { phone: '8801700000002' }]),
    ).toEqual([
      { state: 'accepted', id: 'provider-1' },
      { state: 'accepted', id: 'provider-2' },
    ]);
  });
  it('does not treat low balance as acceptance', () => {
    expect(parseSubmissions({ ErrorCode: 1007 }, [{ phone: '8801700000001' }])[0]?.state).toBe(
      'low_balance',
    );
  });
  it('does not accept an acknowledgement for a different destination', () => {
    expect(
      parseSubmissions(
        { ErrorCode: 202, Data: { Number: '8801700000002', MessageId: 'different-recipient-id' } },
        [{ phone: '8801700000001' }],
      )[0]?.state,
    ).toBe('unknown');
  });
});
describe('isolation and permissions', () => {
  it('requires a session and blocks another center even for a platform operator', async () => {
    expect((await call(`/c/${centerId}/students`, 'GET', undefined, '')).status).toBe(401);
    expect((await call(`/c/${otherCenter}/students`)).status).toBe(403);
  });
  it('blocks browser cross-site writes', async () => {
    const response = await app.fetch(
      new Request(`http://localhost/api/c/${centerId}/students`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://attacker.invalid',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      bindings,
      createExecutionContext(),
    );
    expect(response.status).toBe(403);
  });
  it('never leaks a center API key', async () => {
    await call(`/c/${centerId}/provider`, 'PUT', {
      api_key: 'test-only-provider-key',
      sender_ids: ['09610000000'],
      batch_size: 1,
      interval_seconds: 1,
    });
    const response = await call(`/c/${centerId}/provider`);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('test-only-provider-key');
    expect(response.body.suffix).toBe('-key');
  });
  it('enforces cross-center references in the database', async () => {
    await expect(
      statement(env.DB, 'INSERT INTO member_roles VALUES(?,?,?)', centerId, otherId, uid()).run(),
    ).rejects.toThrow();
  });
});
describe('academic records and sending', () => {
  let student = '';
  let subject = '';
  let exam = '';
  let paper = '';
  it('creates a student and one reusable guardian record', async () => {
    const result = await call(`/c/${centerId}/students`, 'POST', {
      name: 'Ayesha',
      identifier: '01',
      group_ids: [],
      contacts: [{ phone: '01700000003', label: 'Mother', audience: 'guardian', permitted: true }],
    });
    expect(result.status).toBe(200);
    student = z.string().parse(result.body['id']);
    expect((await call(`/c/${centerId}/students`)).body['items']).toHaveLength(1);
  });
  it('creates dynamic subjects and papers without a 100-mark assumption', async () => {
    subject = z.string().parse(
      (
        await call(`/c/${centerId}/catalog`, 'POST', {
          name: 'Physics',
          kind: 'subject',
        })
      ).body['id'],
    );
    const created = await call(`/c/${centerId}/exams`, 'POST', {
      name: 'October test',
      exam_date: '2026-10-22',
      series_id: null,
      papers: [{ subject_id: subject, maximum: 7500, pass_mark: null }],
    });
    expect(created.status).toBe(201);
    exam = z.string().parse(created.body['id']);
    const details = await call(`/c/${centerId}/exams/${exam}`);
    paper = z.array(z.object({ id: z.string() })).parse(details.body['papers'])[0]?.id ?? '';
    await call(`/c/${centerId}/exams/${exam}/participants`, 'POST', { student_ids: [student] });
  });
  it('stores zero, rejects excessive marks, and detects stale edits atomically', async () => {
    const path = `/c/${centerId}/exams/${exam}/papers/${paper}/marks`;
    expect(
      (await call(path, 'PUT', [{ student_id: student, status: 'scored', score: 0, version: 0 }]))
        .status,
    ).toBe(200);
    expect(
      (
        await call(path, 'PUT', [
          { student_id: student, status: 'scored', score: 7501, version: 1 },
        ])
      ).status,
    ).toBe(422);
    expect(
      (
        await call(path, 'PUT', [
          { student_id: student, status: 'scored', score: 5000, version: 0 },
        ])
      ).status,
    ).toBe(409);
    const result = await one<{ score: number }>(
      env.DB,
      'SELECT score FROM results WHERE center_id=? AND paper_id=? AND student_id=?',
      centerId,
      paper,
      student,
    );
    expect(result?.score).toBe(0);
  });
  it('prepares, reviews and sends a mock campaign with durable duplicate suppression', async () => {
    const input = {
      name: 'Result update',
      scope: 'summary',
      body: '{{student_name}}\n{{results_summary}}',
      exam_ids: [exam],
      paper_id: null,
      group_ids: [],
      student_ids: [],
      audience: 'guardian',
      idempotency_key: uid(),
    };
    const created = await call(`/c/${centerId}/campaigns`, 'POST', input);
    expect(created.status).toBe(201);
    const campaign = z.string().parse(created.body['id']);
    const duplicate = await call(`/c/${centerId}/campaigns`, 'POST', input);
    expect(duplicate.body.id).toBe(campaign);
    await processJob(bindings, campaign);
    await processJob(bindings, campaign);
    const preview = await call(`/c/${centerId}/campaigns/${campaign}`);
    expect(preview.body.state).toBe('ready_for_review');
    expect(preview.body.total).toBe(1);
    expect(
      (await call(`/c/${centerId}/campaigns/${campaign}/approve`, 'POST', { scheduled_at: null }))
        .status,
    ).toBe(200);
    await processJob(bindings, campaign);
    await processJob(bindings, campaign);
    const messages = await rows<{ state: string; provider_id: string }>(
      env.DB,
      'SELECT state,provider_id FROM messages WHERE campaign_id=?',
      campaign,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.state).toBe('accepted');
    expect(messages[0]?.provider_id).toMatch(/^mock-/);
    expect(
      (
        await one<{ count: number }>(
          env.DB,
          'SELECT COUNT(*) AS count FROM attempts WHERE campaign_id=?',
          campaign,
        )
      )?.count,
    ).toBe(1);
  });
  it('allows paper edits with conflict checks and adding another subject', async () => {
    const path = `/c/${centerId}/exams/${exam}/papers/${paper}`;
    expect((await call(path, 'PATCH', { maximum: 7500, pass_mark: 2500, version: 1 })).status).toBe(
      200,
    );
    expect((await call(path, 'PATCH', { maximum: 7500, pass_mark: 2500, version: 1 })).status).toBe(
      409,
    );
    expect((await call(path, 'PATCH', { maximum: 7500, pass_mark: 8000, version: 2 })).status).toBe(
      422,
    );
    const second = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'subject',
      name: 'Additional subject',
    });
    const input = {
      subject_id: z.string().parse(second.body['id']),
      maximum: 5000,
      pass_mark: null,
    };
    expect((await call(`/c/${centerId}/exams/${exam}/papers`, 'POST', input)).status).toBe(201);
    expect((await call(`/c/${centerId}/exams/${exam}/papers`, 'POST', input)).status).toBe(409);
  });
  it('invalidates preview after source data changes', async () => {
    const campaign = z.string().parse(
      (
        await call(`/c/${centerId}/campaigns`, 'POST', {
          name: 'Stale preview',
          scope: 'announcement',
          body: 'Hello {{student_name}}',
          exam_ids: [],
          paper_id: null,
          group_ids: [],
          student_ids: [],
          audience: 'guardian',
          idempotency_key: uid(),
        })
      ).body['id'],
    );
    await processJob(bindings, campaign);
    await processJob(bindings, campaign);
    await statement(
      env.DB,
      "UPDATE students SET name='Changed',version=version+1 WHERE id=?",
      student,
    ).run();
    expect(
      (await call(`/c/${centerId}/campaigns/${campaign}/approve`, 'POST', { scheduled_at: null }))
        .status,
    ).toBe(409);
  });
});

describe('account activation and recovery', () => {
  it('does not issue two unauthenticated sessions for concurrent setup of one identity', async () => {
    const invitation = await call(`/c/${centerId}/staff/invite`, 'POST', {
      name: 'Concurrent identity',
      phone: '01700000022',
      role_ids: [],
    });
    const second = await call(`/c/${centerId}/staff/invite`, 'POST', {
      name: 'Concurrent identity',
      phone: '01700000022',
      role_ids: [],
    });
    const responses = await Promise.all(
      [invitation, second].map((item) =>
        call(
          '/auth/activate',
          'POST',
          {
            token: item.body['token'],
            name: 'Concurrent identity',
            password: 'a concurrent activation password 123',
          },
          '',
        ),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409 || response.status === 401),
    ).toHaveLength(1);
  });
  it('activates one invitation once and protects the resulting global identity', async () => {
    const invited = await call(`/c/${centerId}/staff/invite`, 'POST', {
      name: 'New colleague',
      phone: '01700000020',
      role_ids: [],
    });
    expect(invited.status).toBe(201);
    const token = z.string().parse(invited.body['token']);
    const activated = await call(
      '/auth/activate',
      'POST',
      { token, name: 'New colleague', password: 'a strong colleague password 123' },
      '',
    );
    expect(activated.status).toBe(200);
    const codes = z.array(z.string()).parse(activated.body['recovery_codes']);
    expect(codes).toHaveLength(8);
    expect(
      (
        await call(
          '/auth/activate',
          'POST',
          { token, name: 'Attacker', password: 'a different strong password 123' },
          '',
        )
      ).status,
    ).toBe(409);
    const sessionCookie = activated.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect((await call(`/c/${centerId}/students`, 'GET', undefined, sessionCookie)).status).toBe(
      403,
    );
    const code = codes[0];
    expect(code).toBeDefined();
    const recovered = await call(
      '/auth/recover',
      'POST',
      { phone: '01700000020', code, password: 'a replacement colleague password 456' },
      '',
    );
    expect(recovered.status).toBe(200);
    expect((await call('/auth/session', 'GET', undefined, sessionCookie)).status).toBe(401);
    expect(
      (
        await call(
          '/auth/recover',
          'POST',
          { phone: '01700000020', code, password: 'another replacement password 789' },
          '',
        )
      ).status,
    ).toBe(401);
  });
  it('rejects expired assisted-recovery codes', async () => {
    const code = secret();
    await statement(
      env.DB,
      'INSERT INTO recovery_codes(hash,user_id,expires_at) VALUES(?,?,?)',
      await digest(code),
      otherId,
      now() - 1,
    ).run();
    expect(
      (
        await call(
          '/auth/recover',
          'POST',
          { phone: '01700000002', code, password: 'a replacement password not accepted' },
          '',
        )
      ).status,
    ).toBe(401);
  });
  it('allows dynamic role grants and revokes them on the next request', async () => {
    const colleague = await one<{ id: string }>(
      env.DB,
      'SELECT id FROM users WHERE phone=?',
      '8801700000020',
    );
    expect(colleague).not.toBeNull();
    if (!colleague) return;
    const role = await call(`/c/${centerId}/roles`, 'POST', {
      name: 'Student reader',
      permissions: ['students.read'],
    });
    const roleId = z.string().parse(role.body['id']);
    await call(`/c/${centerId}/staff/${colleague.id}`, 'PUT', { active: true, role_ids: [roleId] });
    const login = await call(
      '/auth/login',
      'POST',
      { phone: '01700000020', password: 'a replacement colleague password 456' },
      '',
    );
    expect(login.status).toBe(200);
    const staffCookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect((await call(`/c/${centerId}/students`, 'GET', undefined, staffCookie)).status).toBe(200);
    expect((await call(`/c/${centerId}/roles`, 'GET', undefined, staffCookie)).status).toBe(403);
    expect((await call(`/c/${centerId}/provider`, 'GET', undefined, staffCookie)).status).toBe(403);
    await call(`/c/${centerId}/roles/${roleId}`, 'PATCH', {
      name: 'No student access',
      permissions: [],
      version: 1,
      active: 1,
    });
    expect((await call(`/c/${centerId}/students`, 'GET', undefined, staffCookie)).status).toBe(403);
  });
});
describe('campaign edge states', () => {
  async function draft(name: string, studentIds: string[] = []) {
    const response = await call(`/c/${centerId}/campaigns`, 'POST', {
      name,
      scope: 'announcement',
      body: 'Hello {{student_name}}',
      exam_ids: [],
      paper_id: null,
      group_ids: [],
      student_ids: studentIds,
      audience: 'guardian',
      idempotency_key: uid(),
    });
    expect(response.status).toBe(201);
    const id = z.string().parse(response.body['id']);
    for (let step = 0; step < 16; step++) {
      await processJob(bindings, id);
      if (!(await one(env.DB, 'SELECT id FROM jobs WHERE id=?', id))) break;
    }
    return id;
  }
  it('continues beyond five successful sending chunks', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const created = await call(`/c/${centerId}/students`, 'POST', {
        name: `Many recipients ${i}`,
        identifier: '',
        group_ids: [],
        contacts: [
          { phone: `0170000006${i}`, label: 'Guardian', audience: 'guardian', permitted: true },
        ],
      });
      ids.push(z.string().parse(created.body['id']));
    }
    const id = await draft('Seven submission chunks', ids);
    expect(
      (await call(`/c/${centerId}/campaigns/${id}/approve`, 'POST', { scheduled_at: null })).status,
    ).toBe(200);
    for (let step = 0; step < 8; step++) {
      await statement(
        env.DB,
        'UPDATE jobs SET due_at=?,published_at=NULL WHERE id=?',
        now(),
        id,
      ).run();
      await processJob(bindings, id);
    }
    const campaign = await call(`/c/${centerId}/campaigns/${id}`);
    expect(campaign.body['state']).toBe('completed');
    expect(campaign.body['submitted']).toBe(7);
  });
  it('prepares audiences spanning more than five preparation chunks', async () => {
    const group = uid();
    const contact = uid();
    const records = Array.from({ length: 105 }, (_, i) => ({
      id: uid(),
      name: `Large audience ${i}`,
    }));
    await env.DB.batch([
      statement(
        env.DB,
        "INSERT INTO catalog(id,center_id,kind,name) VALUES(?,?,'group','Large audience')",
        group,
        centerId,
      ),
      statement(
        env.DB,
        "INSERT INTO contacts(id,center_id,phone) VALUES(?,?,'8801700000099')",
        contact,
        centerId,
      ),
      statement(
        env.DB,
        "INSERT INTO students(id,center_id,name) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.name') FROM json_each(?)",
        centerId,
        JSON.stringify(records),
      ),
      statement(
        env.DB,
        "INSERT INTO group_members SELECT ?,?,json_extract(value,'$.id'),?,NULL FROM json_each(?)",
        centerId,
        group,
        now(),
        JSON.stringify(records),
      ),
      statement(
        env.DB,
        "INSERT INTO student_contacts SELECT ?,json_extract(value,'$.id'),?,'Guardian','guardian',1 FROM json_each(?)",
        centerId,
        contact,
        JSON.stringify(records),
      ),
    ]);
    const created = await call(`/c/${centerId}/campaigns`, 'POST', {
      name: 'Large preview',
      scope: 'announcement',
      body: 'Hello {{student_name}}',
      exam_ids: [],
      paper_id: null,
      group_ids: [group],
      student_ids: [],
      audience: 'guardian',
      idempotency_key: uid(),
    });
    const id = z.string().parse(created.body['id']);
    for (let step = 0; step < 8; step++) await processJob(bindings, id);
    const campaign = await call(`/c/${centerId}/campaigns/${id}`);
    expect(campaign.body['state']).toBe('ready_for_review');
    expect(campaign.body['total']).toBe(105);
    await call(`/c/${centerId}/campaigns/${id}/cancel`, 'POST', {});
  });
  it('refreshes only unsent recipients after a partial campaign changes', async () => {
    const students: string[] = [];
    for (const [i, name] of ['First partial', 'Second partial'].entries()) {
      const created = await call(`/c/${centerId}/students`, 'POST', {
        name,
        identifier: '',
        group_ids: [],
        contacts: [
          { phone: `0170000004${i}`, label: 'Guardian', audience: 'guardian', permitted: true },
        ],
      });
      students.push(z.string().parse(created.body['id']));
    }
    const id = await draft('Partial campaign', students);
    expect(
      (await call(`/c/${centerId}/campaigns/${id}/approve`, 'POST', { scheduled_at: null })).status,
    ).toBe(200);
    await processJob(bindings, id);
    const pending = await one<{ student_id: string }>(
      env.DB,
      "SELECT student_id FROM messages WHERE campaign_id=? AND state='pending'",
      id,
    );
    expect(pending).not.toBeNull();
    if (!pending) return;
    await statement(
      env.DB,
      "UPDATE students SET name='Updated partial',version=version+1 WHERE id=?",
      pending.student_id,
    ).run();
    await statement(
      env.DB,
      'UPDATE jobs SET due_at=?,published_at=NULL WHERE id=?',
      now(),
      id,
    ).run();
    await processJob(bindings, id);
    expect((await call(`/c/${centerId}/campaigns/${id}`)).body['state']).toBe('needs_review');
    const rebuilt = await call(`/c/${centerId}/campaigns/${id}/rebuild`, 'POST', {
      idempotency_key: uid(),
    });
    expect(rebuilt.status).toBe(201);
    let replacement = z.string().parse(rebuilt.body['id']);
    await processJob(bindings, replacement);
    await processJob(bindings, replacement);
    const messages = await rows<{ student_id: string; body: string }>(
      env.DB,
      'SELECT student_id,body FROM messages WHERE campaign_id=?',
      replacement,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.student_id).toBe(pending.student_id);
    expect(messages[0]?.body).toContain('Updated partial');
    expect(
      (
        await call(`/c/${centerId}/campaigns/${replacement}/approve`, 'POST', {
          scheduled_at: null,
        })
      ).status,
    ).toBe(200);
    await statement(
      env.DB,
      "UPDATE students SET name='Changed a second time',version=version+1 WHERE id=?",
      pending.student_id,
    ).run();
    await processJob(bindings, replacement);
    expect((await call(`/c/${centerId}/campaigns/${replacement}`)).body['state']).toBe(
      'needs_review',
    );
    const twice = await call(`/c/${centerId}/campaigns/${replacement}/rebuild`, 'POST', {
      idempotency_key: uid(),
    });
    replacement = z.string().parse(twice.body['id']);
    await processJob(bindings, replacement);
    await processJob(bindings, replacement);
    expect((await call(`/c/${centerId}/campaigns/${replacement}`)).body['total']).toBe(1);
    expect(
      (
        await call(`/c/${centerId}/campaigns/${replacement}/approve`, 'POST', {
          scheduled_at: null,
        })
      ).status,
    ).toBe(200);
    await processJob(bindings, replacement);
    await processJob(bindings, replacement);
    expect(
      (
        await one<{ n: number }>(
          env.DB,
          'SELECT COUNT(*) AS n FROM attempts WHERE campaign_id IN (?,?)',
          id,
          replacement,
        )
      )?.n,
    ).toBe(2);
  });
  it('keeps an explicit resend narrowed to selected contacts when refreshed', async () => {
    const student = await call(`/c/${centerId}/students`, 'POST', {
      name: 'Retry contact test',
      identifier: '',
      group_ids: [],
      contacts: [
        { phone: '01700000091', label: 'First guardian', audience: 'guardian', permitted: true },
        { phone: '01700000092', label: 'Second guardian', audience: 'guardian', permitted: true },
      ],
    });
    const studentId = z.string().parse(student.body['id']);
    const original = await draft('Selective retry', [studentId]);
    await env.DB.batch([
      statement(
        env.DB,
        "UPDATE messages SET state='accepted',provider_id='mock-previously-accepted',submitted_at=? WHERE campaign_id=? AND phone='8801700000091'",
        now(),
        original,
      ),
      statement(
        env.DB,
        "UPDATE messages SET state='failed' WHERE campaign_id=? AND phone='8801700000092'",
        original,
      ),
    ]);
    const failed = await one<{ id: string }>(
      env.DB,
      "SELECT id FROM messages WHERE campaign_id=? AND state='failed'",
      original,
    );
    expect(failed).not.toBeNull();
    if (!failed) return;
    const retry = await call(`/c/${centerId}/campaigns/${original}/retry`, 'POST', {
      message_ids: [failed.id],
      acknowledge_duplicate_risk: true,
      idempotency_key: uid(),
    });
    const retryId = z.string().parse(retry.body['id']);
    expect(
      (await call(`/c/${centerId}/campaigns/${retryId}/approve`, 'POST', { scheduled_at: null }))
        .status,
    ).toBe(200);
    await statement(
      env.DB,
      "UPDATE students SET name='Updated retry name',version=version+1 WHERE id=?",
      studentId,
    ).run();
    await processJob(bindings, retryId);
    expect((await call(`/c/${centerId}/campaigns/${retryId}`)).body['state']).toBe('needs_review');
    const refreshed = await call(`/c/${centerId}/campaigns/${retryId}/rebuild`, 'POST', {
      idempotency_key: uid(),
    });
    const refreshedId = z.string().parse(refreshed.body['id']);
    await processJob(bindings, refreshedId);
    await processJob(bindings, refreshedId);
    const messages = await rows<{ phone: string }>(
      env.DB,
      'SELECT phone FROM messages WHERE campaign_id=?',
      refreshedId,
    );
    expect(messages).toEqual([{ phone: '8801700000092' }]);
  });
  it('records excluded students with actionable reasons', async () => {
    const student = await call(`/c/${centerId}/students`, 'POST', {
      name: 'Missing contact',
      identifier: '',
      contacts: [],
      group_ids: [],
    });
    const id = await draft('Exclusion check', [z.string().parse(student.body['id'])]);
    const exclusions = await call(`/c/${centerId}/campaigns/${id}/exclusions`);
    expect(
      z.array(z.object({ reason: z.string() })).parse(exclusions.body['items'])[0]?.reason,
    ).toContain('No permitted contact');
    expect(
      (await call(`/c/${centerId}/campaigns/${id}/approve`, 'POST', { scheduled_at: null })).status,
    ).toBe(409);
  });
  it('blocks a shared number before submission without charging either sibling', async () => {
    const ids: string[] = [];
    for (const name of ['Blocked sibling one', 'Blocked sibling two']) {
      const created = await call(`/c/${centerId}/students`, 'POST', {
        name,
        identifier: '',
        group_ids: [],
        contacts: [
          { phone: '01700000088', label: 'Guardian', audience: 'guardian', permitted: true },
        ],
      });
      ids.push(z.string().parse(created.body['id']));
    }
    const id = await draft('Suppression check', ids);
    expect(
      (await call(`/c/${centerId}/campaigns/${id}/approve`, 'POST', { scheduled_at: null })).status,
    ).toBe(200);
    const contact = await one<{ id: string }>(
      env.DB,
      "SELECT id FROM contacts WHERE center_id=? AND phone='8801700000088'",
      centerId,
    );
    expect(contact).not.toBeNull();
    if (!contact) return;
    expect(
      (
        await call(`/c/${centerId}/contacts/${contact.id}/suppression`, 'PATCH', {
          suppressed: true,
          expected: false,
        })
      ).status,
    ).toBe(200);
    for (let step = 0; step < 3; step++) await processJob(bindings, id);
    expect((await call(`/c/${centerId}/campaigns/${id}`)).body['skipped']).toBe(2);
    expect(
      (
        await one<{ n: number }>(
          env.DB,
          'SELECT COUNT(*) AS n FROM attempts WHERE campaign_id=?',
          id,
        )
      )?.n,
    ).toBe(0);
    expect(
      (
        await call(`/c/${centerId}/contacts/${contact.id}/suppression`, 'PATCH', {
          suppressed: false,
          expected: true,
        })
      ).status,
    ).toBe(200);
  });
  it('preserves siblings but deduplicates identical contact selections', async () => {
    const students: string[] = [];
    for (const name of ['Sibling one', 'Sibling two']) {
      const created = await call(`/c/${centerId}/students`, 'POST', {
        name,
        identifier: '',
        group_ids: [],
        contacts: [
          { phone: '01700000030', label: 'Guardian', audience: 'guardian', permitted: true },
          { phone: '01700000030', label: 'Same number', audience: 'student', permitted: true },
        ],
      });
      students.push(z.string().parse(created.body['id']));
    }
    const id = await draft('Sibling update', students);
    expect((await call(`/c/${centerId}/campaigns/${id}`)).body['total']).toBe(2);
  });
  it('creates a durable scheduled job atomically and does not send early', async () => {
    const id = await draft('Scheduled update');
    const due = now() + 3600000;
    expect(
      (await call(`/c/${centerId}/campaigns/${id}/approve`, 'POST', { scheduled_at: due })).status,
    ).toBe(200);
    expect(
      (await one<{ due_at: number }>(env.DB, 'SELECT due_at FROM jobs WHERE id=?', id))?.due_at,
    ).toBe(due);
    await processJob(bindings, id);
    expect(
      (
        await one<{ count: number }>(
          env.DB,
          'SELECT COUNT(*) AS count FROM attempts WHERE campaign_id=?',
          id,
        )
      )?.count,
    ).toBe(0);
    await call(`/c/${centerId}/campaigns/${id}/cancel`, 'POST', {});
    expect(await one(env.DB, 'SELECT id FROM jobs WHERE id=?', id)).toBeNull();
  });
  it('reconciles mock delivery without incrementing counters twice', async () => {
    const message = await one<{ id: string; campaign_id: string }>(
      env.DB,
      "SELECT id,campaign_id FROM messages WHERE state='accepted' LIMIT 1",
    );
    expect(message).not.toBeNull();
    if (!message) return;
    await statement(
      env.DB,
      'UPDATE messages SET next_check_at=? WHERE id=?',
      now() - 1,
      message.id,
    ).run();
    await checkMessage(bindings, message.id);
    await checkMessage(bindings, message.id);
    expect(
      (
        await one<{ delivered: number }>(
          env.DB,
          'SELECT delivered FROM campaigns WHERE id=?',
          message.campaign_id,
        )
      )?.delivered,
    ).toBe(1);
  });
  it('turns stale in-flight submissions into unknown, never pending', async () => {
    const target = await one<{ id: string }>(
      env.DB,
      "SELECT id FROM students WHERE center_id=? AND name='Many recipients 0'",
      centerId,
    );
    expect(target).not.toBeNull();
    if (!target) return;
    const id = await draft('Interrupted request', [target.id]);
    await statement(
      env.DB,
      "UPDATE messages SET state='submitting',submitted_at=? WHERE campaign_id=?",
      now() - 180000,
      id,
    ).run();
    await scheduled({ ...bindings, DISPATCH_ENABLED: 'true' });
    const states = await rows<{ state: string }>(
      env.DB,
      'SELECT state FROM messages WHERE campaign_id=?',
      id,
    );
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((m) => m.state === 'unknown')).toBe(true);
    expect(await one(env.DB, 'SELECT id FROM jobs WHERE id=?', id)).toBeNull();
  });
});
describe('preserving academic relationships', () => {
  it('keeps existing archived links and membership dates without allowing new archived assignments', async () => {
    const parent = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'class',
      name: 'Previous class',
    });
    const classId = z.string().parse(parent.body['id']);
    const group = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'group',
      name: 'Previous batch',
      class_id: classId,
    });
    const groupId = z.string().parse(group.body['id']);
    const input = {
      name: 'Continuing student',
      identifier: '',
      contacts: [],
      group_ids: [groupId],
    };
    const student = await call(`/c/${centerId}/students`, 'POST', input);
    const studentId = z.string().parse(student.body['id']);
    await statement(
      env.DB,
      'UPDATE group_members SET joined_at=1 WHERE center_id=? AND student_id=?',
      centerId,
      studentId,
    ).run();
    expect(
      (
        await call(`/c/${centerId}/catalog/${classId}`, 'PATCH', {
          name: 'Previous class',
          active: 0,
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/c/${centerId}/catalog/${groupId}`, 'PATCH', {
          name: 'Renamed previous batch',
          class_id: classId,
          active: 0,
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/c/${centerId}/students/${studentId}`, 'PUT', {
          ...input,
          name: 'Updated continuing student',
          version: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      await one<{ joined_at: number; left_at: number | null }>(
        env.DB,
        'SELECT joined_at,left_at FROM group_members WHERE center_id=? AND group_id=? AND student_id=?',
        centerId,
        groupId,
        studentId,
      ),
    ).toEqual({ joined_at: 1, left_at: null });
    expect(
      (await call(`/c/${centerId}/students`, 'POST', { ...input, name: 'New student' })).status,
    ).toBe(422);
    expect(
      (
        await call(`/c/${centerId}/students/${studentId}`, 'PUT', {
          ...input,
          version: 2,
          group_ids: [],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await one<{ left_at: number | null }>(
          env.DB,
          'SELECT left_at FROM group_members WHERE center_id=? AND group_id=? AND student_id=?',
          centerId,
          groupId,
          studentId,
        )
      )?.left_at,
    ).not.toBeNull();
  });
});
describe('bounded database access', () => {
  it('removes audit entries older than seven days in indexed batches while dispatch is disabled', async () => {
    const timestamp = Date.now();
    const cutoff = timestamp - 7 * 86400000;
    const target = uid();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    try {
      await statement(
        env.DB,
        `WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO audit SELECT ?||x,CASE x%3 WHEN 0 THEN NULL WHEN 1 THEN ? ELSE ? END,?,'account.assisted_recovery:test',?,? FROM n`,
        target,
        centerId,
        otherCenter,
        userId,
        target,
        cutoff - 1,
      ).run();
      await env.DB.batch(
        [cutoff, cutoff + 1, timestamp].map((createdAt) =>
          statement(
            env.DB,
            'INSERT INTO audit VALUES(?,?,?,?,?,?)',
            uid(),
            centerId,
            userId,
            'provider.replace',
            target,
            createdAt,
          ),
        ),
      );
      const plan = await rows<{ detail: string }>(
        env.DB,
        'EXPLAIN QUERY PLAN SELECT id FROM audit WHERE created_at<? ORDER BY created_at LIMIT 1000',
        cutoff,
      );
      expect(plan.some((row) => row.detail.includes('audit_created_at'))).toBe(true);
      await scheduled(bindings);
      expect(
        await one(env.DB, 'SELECT COUNT(*) AS count FROM audit WHERE target=?', target),
      ).toEqual({ count: 4 });
      await scheduled(bindings);
      expect(
        await one(env.DB, 'SELECT COUNT(*) AS count FROM audit WHERE target=?', target),
      ).toEqual({ count: 3 });
      await scheduled(bindings);
      expect(
        await one(env.DB, 'SELECT COUNT(*) AS count FROM audit WHERE target=?', target),
      ).toEqual({ count: 3 });
    } finally {
      clock.mockRestore();
    }
  });
  it('uses the student prefix index instead of scanning unrelated records', async () => {
    await statement(
      env.DB,
      `WITH RECURSIVE n(x) AS(SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO students(id,center_id,name) SELECT 'benchmark-'||x,?,printf('Benchmark %04d',x) FROM n`,
      centerId,
    ).run();
    const result = await statement(
      env.DB,
      'SELECT id,name FROM students WHERE center_id=? AND active=1 AND name>=? AND name<? ORDER BY name,id LIMIT 20',
      centerId,
      'Benchmark 099',
      'Benchmark 099\uffff',
    ).all();
    expect(result.results).toHaveLength(10);
    expect(result.meta.rows_read).toBeLessThan(40);
    const plan = await rows<{ detail: string }>(
      env.DB,
      'EXPLAIN QUERY PLAN SELECT id,name FROM students WHERE center_id=? AND active=1 AND name>=? AND name<? ORDER BY name,id LIMIT 20',
      centerId,
      'Benchmark 099',
      'Benchmark 099\uffff',
    );
    expect(plan.some((row) => row.detail.includes('students_list'))).toBe(true);
  });
});
