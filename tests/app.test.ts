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
import { balance, parseSubmissions, type ProviderConfig } from '../apps/worker/src/provider';
import { cleanup } from '../apps/worker/src/cleanup';

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
        ...(['GET', 'HEAD'].includes(method) && body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
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

describe('platform center deletion', () => {
  async function seed() {
    const ids = {
      center: uid(),
      role: uid(),
      subject: uid(),
      group: uid(),
      student: uid(),
      contact: uid(),
      exam: uid(),
      paper: uid(),
      config: uid(),
      campaign: uid(),
      dependent: uid(),
      message: uid(),
      invitation: uid(),
    };
    await env.DB.batch([
      statement(
        env.DB,
        'INSERT INTO centers(id,name,owner_id,active) VALUES(?,?,?,0)',
        ids.center,
        'Deletion fixture',
        userId,
      ),
      statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', ids.center, userId),
      statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', ids.center, otherId),
      statement(
        env.DB,
        'INSERT INTO roles(id,center_id,name,permissions) VALUES(?,?,?,?)',
        ids.role,
        ids.center,
        'Teacher',
        '[]',
      ),
      statement(env.DB, 'INSERT INTO member_roles VALUES(?,?,?)', ids.center, otherId, ids.role),
      statement(
        env.DB,
        'INSERT INTO invitations(hash,center_id,user_id,created_by,expires_at) VALUES(?,?,?,?,?)',
        ids.invitation,
        ids.center,
        otherId,
        userId,
        now() + 600000,
      ),
      statement(
        env.DB,
        'INSERT INTO auth_claims(hash,created_at) VALUES(?,?)',
        ids.invitation,
        now(),
      ),
      statement(
        env.DB,
        "INSERT INTO catalog(id,center_id,name,kind) VALUES(?,?,?,'subject')",
        ids.subject,
        ids.center,
        'Physics',
      ),
      statement(
        env.DB,
        "INSERT INTO catalog(id,center_id,name,kind) VALUES(?,?,?,'group')",
        ids.group,
        ids.center,
        'Batch',
      ),
      statement(
        env.DB,
        'INSERT INTO students(id,center_id,name) VALUES(?,?,?)',
        ids.student,
        ids.center,
        'Fixture student',
      ),
      statement(
        env.DB,
        'INSERT INTO contacts(id,center_id,phone) VALUES(?,?,?)',
        ids.contact,
        ids.center,
        '8801700000013',
      ),
      statement(
        env.DB,
        "INSERT INTO student_contacts VALUES(?,?,?,'guardian',1)",
        ids.center,
        ids.student,
        ids.contact,
      ),
      statement(
        env.DB,
        'INSERT INTO group_members(center_id,group_id,student_id,joined_at) VALUES(?,?,?,?)',
        ids.center,
        ids.group,
        ids.student,
        now(),
      ),
      statement(
        env.DB,
        'INSERT INTO exams(id,center_id,name,exam_date) VALUES(?,?,?,?)',
        ids.exam,
        ids.center,
        'Fixture exam',
        '2026-10-24',
      ),
      statement(
        env.DB,
        'INSERT INTO papers(id,center_id,exam_id,subject_id,maximum) VALUES(?,?,?,?,100)',
        ids.paper,
        ids.center,
        ids.exam,
        ids.subject,
      ),
      statement(
        env.DB,
        'INSERT INTO participants VALUES(?,?,?)',
        ids.center,
        ids.exam,
        ids.student,
      ),
      statement(
        env.DB,
        "INSERT INTO results(center_id,paper_id,student_id,status,score,updated_by) VALUES(?,?,?,'scored',50,?)",
        ids.center,
        ids.paper,
        ids.student,
        userId,
      ),
      statement(
        env.DB,
        "INSERT INTO templates(id,center_id,name,scope,body) VALUES(?,?,?,'announcement','Hello')",
        uid(),
        ids.center,
        'Fixture template',
      ),
      statement(
        env.DB,
        "INSERT INTO provider_configs(id,center_id,api_key,sender_ids,created_at) VALUES(?,?,'fixture-not-a-real-key','[]',?)",
        ids.config,
        ids.center,
        now(),
      ),
      statement(
        env.DB,
        'INSERT INTO balances(center_id,config_id,balance) VALUES(?,?,?)',
        ids.center,
        ids.config,
        '10.00',
      ),
      statement(
        env.DB,
        "INSERT INTO campaigns(id,center_id,name,authorizer,selection,state,revision,config_id,created_at,idempotency_key) SELECT ?,?,?,?,'{}','ready_for_review',revision,?,?,? FROM centers WHERE id=?",
        ids.campaign,
        ids.center,
        'Fixture campaign',
        userId,
        ids.config,
        now(),
        uid(),
        ids.center,
      ),
      statement(
        env.DB,
        "INSERT INTO campaigns(id,center_id,name,authorizer,selection,state,revision,created_at,idempotency_key,source_campaign_id) VALUES(?,?,?,?,'{}','cancelled',1,?,?,?)",
        ids.dependent,
        ids.center,
        'Dependent campaign',
        userId,
        now(),
        uid(),
        ids.campaign,
      ),
      statement(
        env.DB,
        "INSERT INTO messages(id,center_id,campaign_id,student_id,student_name,contact_id,phone,body,segments,state,logical_key) VALUES(?,?,?,?,?,?,'8801700000013','Fixture message',1,'pending',?)",
        ids.message,
        ids.center,
        ids.campaign,
        ids.student,
        'Fixture student',
        ids.contact,
        uid(),
      ),
      statement(
        env.DB,
        'INSERT INTO campaign_exclusions VALUES(?,?,?,?,?)',
        ids.center,
        ids.campaign,
        ids.student,
        'Fixture student',
        'Fixture exclusion',
      ),
      statement(
        env.DB,
        'INSERT INTO campaign_transitions SELECT id,revision FROM campaigns WHERE id=?',
        ids.campaign,
      ),
      statement(
        env.DB,
        'INSERT INTO jobs(id,center_id,campaign_id,due_at) VALUES(?,?,?,?)',
        ids.campaign,
        ids.center,
        ids.campaign,
        now(),
      ),
      statement(
        env.DB,
        "INSERT INTO attempts VALUES(?,?,?,?,?,'fixture')",
        uid(),
        ids.center,
        ids.campaign,
        ids.message,
        now(),
      ),
    ]);
    return ids;
  }
  it('requires a platform owner, recent sign-in, suspension and the exact name', async () => {
    const id = uid();
    await statement(
      env.DB,
      'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
      id,
      'Protected fixture',
      userId,
    ).run();
    const path = `/platform/centers/${id}`;
    expect((await call(path, 'DELETE', { name: 'Protected fixture' }, '')).status).toBe(401);
    const staffToken = secret();
    const oldToken = secret();
    await env.DB.batch([
      statement(
        env.DB,
        'INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)',
        await digest(staffToken),
        otherId,
        now() + 600000,
        now(),
      ),
      statement(
        env.DB,
        'INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)',
        await digest(oldToken),
        userId,
        now() + 600000,
        now() - 660000,
      ),
    ]);
    expect(
      (await call(path, 'DELETE', { name: 'Protected fixture' }, `coaching_session=${staffToken}`))
        .status,
    ).toBe(403);
    const stale = await call(
      path,
      'DELETE',
      { name: 'Protected fixture' },
      `coaching_session=${oldToken}`,
    );
    expect(stale.status).toBe(401);
    expect(stale.body['error']).toMatchObject({ code: 'SIGN_IN_AGAIN' });
    expect((await call(path, 'DELETE', { name: 'Protected fixture' })).status).toBe(409);
    await expect(statement(env.DB, 'DELETE FROM centers WHERE id=?', id).run()).rejects.toThrow(
      'CENTER_DELETE_BLOCKED',
    );
    await statement(env.DB, 'UPDATE centers SET active=0 WHERE id=?', id).run();
    expect((await call(path, 'DELETE', { name: 'Wrong name' })).status).toBe(422);
    expect((await call(path, 'DELETE', { name: 'Protected fixture' })).status).toBe(200);
    expect((await call(path, 'DELETE', { name: 'Protected fixture' })).status).toBe(404);
  });
  it('blocks in-flight submissions without deleting any records', async () => {
    const ids = await seed();
    await statement(
      env.DB,
      "UPDATE messages SET state='submitting',submitted_at=? WHERE id=?",
      now(),
      ids.message,
    ).run();
    expect(
      (await call(`/platform/centers/${ids.center}`, 'DELETE', { name: 'Deletion fixture' }))
        .status,
    ).toBe(409);
    expect(await one(env.DB, 'SELECT id FROM centers WHERE id=?', ids.center)).not.toBeNull();
    expect(await one(env.DB, 'SELECT id FROM students WHERE id=?', ids.student)).not.toBeNull();
    expect(
      await one(env.DB, 'SELECT hash FROM auth_claims WHERE hash=?', ids.invitation),
    ).not.toBeNull();
    await statement(env.DB, "UPDATE messages SET state='unknown' WHERE id=?", ids.message).run();
    expect(
      (await call(`/platform/centers/${ids.center}`, 'DELETE', { name: 'Deletion fixture' }))
        .status,
    ).toBe(200);
  });
  it('deletes the entire tenant atomically, preserves shared identities and makes old jobs harmless', async () => {
    const ids = await seed();
    await env.DB.exec('CREATE TABLE center_delete_probe(center_id TEXT REFERENCES centers(id));');
    await statement(env.DB, 'INSERT INTO center_delete_probe VALUES(?)', ids.center).run();
    try {
      expect(
        (await call(`/platform/centers/${ids.center}`, 'DELETE', { name: 'Deletion fixture' }))
          .status,
      ).toBe(422);
      expect(await one(env.DB, 'SELECT id FROM students WHERE id=?', ids.student)).not.toBeNull();
      expect(
        await one(env.DB, 'SELECT hash FROM auth_claims WHERE hash=?', ids.invitation),
      ).not.toBeNull();
    } finally {
      await env.DB.exec('DROP TABLE center_delete_probe;');
    }
    expect(
      (await call(`/platform/centers/${ids.center}`, 'DELETE', { name: 'Deletion fixture' }))
        .status,
    ).toBe(200);
    for (const table of [
      'memberships',
      'member_roles',
      'roles',
      'invitations',
      'catalog',
      'students',
      'contacts',
      'student_contacts',
      'group_members',
      'exams',
      'papers',
      'participants',
      'results',
      'templates',
      'provider_configs',
      'balances',
      'campaigns',
      'messages',
      'jobs',
      'attempts',
      'campaign_exclusions',
    ])
      expect(await one(env.DB, `SELECT 1 FROM ${table} WHERE center_id=?`, ids.center)).toBeNull();
    expect(
      await one(env.DB, 'SELECT * FROM campaign_transitions WHERE campaign_id=?', ids.campaign),
    ).toBeNull();
    expect(await one(env.DB, 'SELECT * FROM auth_claims WHERE hash=?', ids.invitation)).toBeNull();
    expect(await one(env.DB, 'SELECT id FROM centers WHERE id=?', otherCenter)).not.toBeNull();
    for (const id of [userId, otherId])
      expect(await one(env.DB, 'SELECT id FROM users WHERE id=?', id)).not.toBeNull();
    expect((await call('/auth/session')).status).toBe(200);
    await expect(processJob(bindings, ids.campaign)).resolves.toBeUndefined();
  });
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
    expect(
      renderTemplate('{{marks}}/{{full_marks}}', 'subject', { marks: '85', full_marks: '100' }),
    ).toBe('85/100');
    expect(
      renderTemplate('{{marks}}/{{full_marks}}', 'subject', {
        marks: 'absent',
        full_marks: '100',
      }),
    ).toBe('absent');
    expect(
      renderTemplate('{{marks}} / {{full_marks}}', 'subject', {
        marks: 'absent',
        full_marks: '100',
      }),
    ).toBe('absent');
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
  it('counts provider checks rather than dashboard visits against the balance refresh limit', async () => {
    const center = uid();
    const config = uid();
    const key = `balance:${center}`;
    await env.DB.batch([
      statement(
        env.DB,
        'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
        center,
        'Balance fixture',
        userId,
      ),
      statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', center, userId),
    ]);
    const path = `/c/${center}/balance/refresh`;
    for (let visit = 0; visit < 6; visit++) expect((await call(path, 'POST', {})).status).toBe(422);
    expect(await one(env.DB, 'SELECT count FROM throttle WHERE key=?', key)).toBeNull();
    await statement(
      env.DB,
      "INSERT INTO provider_configs(id,center_id,api_key,sender_ids,created_at) VALUES(?,?,'fixture-not-a-real-key','[\"TEST\"]',?)",
      config,
      center,
      now(),
    ).run();
    const visits = await Promise.all(Array.from({ length: 12 }, () => call(path, 'POST', {})));
    expect(visits.every((response) => response.status === 200)).toBe(true);
    expect(await one(env.DB, 'SELECT count FROM throttle WHERE key=?', key)).toEqual({ count: 1 });
    const checkedAt = now();
    await env.DB.batch([
      statement(env.DB, 'UPDATE throttle SET count=5 WHERE key=?', key),
      statement(
        env.DB,
        "UPDATE balances SET balance='42.00',checked_at=? WHERE center_id=?",
        checkedAt,
        center,
      ),
    ]);
    for (let visit = 0; visit < 8; visit++) {
      const response = await call(path, 'POST', {});
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ balance: '42.00', checked_at: checkedAt });
    }
    expect(await one(env.DB, 'SELECT count FROM throttle WHERE key=?', key)).toEqual({ count: 5 });
    await statement(
      env.DB,
      'UPDATE balances SET checked_at=? WHERE center_id=?',
      now() - 61000,
      center,
    ).run();
    const limited = await call(path, 'POST', {});
    expect(limited.status).toBe(429);
    expect(limited.body['error']).toMatchObject({ code: 'RATE_LIMITED' });
    expect((await call(`/c/${center}/balance`)).body['balance']).toBe('42.00');
    await env.DB.batch([
      statement(env.DB, 'UPDATE throttle SET expires_at=? WHERE key=?', now() - 1, key),
      statement(env.DB, 'UPDATE balances SET refreshing_until=0 WHERE center_id=?', center),
    ]);
    expect((await call(path, 'POST', {})).body['balance']).toBe('1000.00');
    expect(await one(env.DB, 'SELECT count FROM throttle WHERE key=?', key)).toEqual({ count: 1 });
  });
  it.each([
    [401, 'PROVIDER_REJECTED'],
    [403, 'PROVIDER_REJECTED'],
    [429, 'PROVIDER_RATE_LIMIT'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [200, 'PROVIDER_RESPONSE'],
    [0, 'PROVIDER_UNAVAILABLE'],
  ])('reports balance failures safely for upstream status %i', async (status, code) => {
    const config: ProviderConfig = {
      id: uid(),
      center_id: centerId,
      api_key: 'fake-secret-for-provider-tests',
      sender_ids: '["TEST"]',
      batch_size: 1,
      interval_seconds: 2,
    };
    await statement(
      env.DB,
      'INSERT INTO provider_configs(id,center_id,api_key,sender_ids,active,created_at) VALUES(?,?,?,?,0,?)',
      config.id,
      config.center_id,
      config.api_key,
      config.sender_ids,
      now(),
    ).run();
    const network = vi.spyOn(globalThis, 'fetch');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (status) network.mockResolvedValue(new Response('not JSON', { status }));
    else network.mockRejectedValue(new Error(`Connection failed for ${config.api_key}`));
    try {
      const failure = z
        .object({ code: z.string(), status: z.number(), message: z.string() })
        .parse(
          await balance({ ...bindings, SMS_MODE: 'live' }, config, true).catch(
            (error: unknown) => error,
          ),
        );
      expect(failure.code).toBe(code);
      expect(failure.status).toBe(502);
      expect(failure.message).toContain('No SMS was sent by this balance check.');
      expect(failure.message).not.toContain(config.api_key);
      expect(network).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        JSON.stringify({
          event: 'provider.request_failed',
          operation: 'get-balance',
          code,
          upstreamStatus: status || null,
        }),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(config.api_key);
    } finally {
      network.mockRestore();
      log.mockRestore();
    }
  });
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
      contacts: [{ phone: '01700000003', audience: 'guardian', permitted: true }],
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
      papers: [{ subject_id: subject, maximum: 7500 }],
    });
    expect(created.status).toBe(201);
    exam = z.string().parse(created.body['id']);
    const details = await call(`/c/${centerId}/exams/${exam}`);
    paper = z.array(z.object({ id: z.string() })).parse(details.body['papers'])[0]?.id ?? '';
    await call(`/c/${centerId}/exams/${exam}/participants`, 'POST', { student_ids: [student] });
  });
  it('stores zero, rejects excessive marks, and detects stale edits atomically', async () => {
    const path = `/c/${centerId}/exams/${exam}/papers/${paper}/marks`;
    const initialMarks = await call(path);
    expect(initialMarks.status).toBe(200);
    expect(
      (initialMarks.body['items'] as { student_id: string; status: string }[])[0]?.status,
    ).toBe('scored');
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
    expect((await call(path, 'PATCH', { maximum: 8000, version: 1 })).status).toBe(200);
    expect((await call(path, 'PATCH', { maximum: 8000, version: 1 })).status).toBe(409);
    const second = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'subject',
      name: 'Additional subject',
    });
    const input = {
      subject_id: z.string().parse(second.body['id']),
      maximum: 5000,
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
  it('manages group participants in exams and allows removing mistakenly added groups', async () => {
    const groupRes = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'group',
      name: 'Mistaken batch',
    });
    const testGroup = z.string().parse(groupRes.body['id']);
    const studentRes = await call(`/c/${centerId}/students`, 'POST', {
      name: 'Batch student',
      identifier: '02',
      group_ids: [testGroup],
      contacts: [{ phone: '01799998888', audience: 'guardian', permitted: true }],
    });
    expect(studentRes.status).toBe(200);

    // Add group to exam
    const addRes = await call(`/c/${centerId}/exams/${exam}/participants`, 'POST', {
      group_id: testGroup,
    });
    expect(addRes.status).toBe(200);

    // Verify group appears in exam details
    const details = await call(`/c/${centerId}/exams/${exam}`);
    const groups = z
      .array(z.object({ id: z.string(), name: z.string(), count: z.number() }))
      .parse(details.body['groups']);
    expect(groups.some((g) => g.id === testGroup)).toBe(true);

    // Remove group from exam
    const deleteRes = await call(
      `/c/${centerId}/exams/${exam}/participants/${testGroup}`,
      'DELETE',
    );
    expect(deleteRes.status).toBe(200);

    // Verify group is no longer in exam details
    const afterDelete = await call(`/c/${centerId}/exams/${exam}`);
    const groupsAfter = z
      .array(z.object({ id: z.string(), name: z.string(), count: z.number() }))
      .parse(afterDelete.body['groups']);
    expect(groupsAfter.some((g) => g.id === testGroup)).toBe(false);
  });
  it('deletes student, catalog, and exam records with foreign key cascade and counter updates', async () => {
    const testCatGroup = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'group',
      name: 'Deletable group',
    });
    expect(testCatGroup.status).toBe(201);
    const groupId = z.string().parse(testCatGroup.body['id']);

    const createdStudent = await call(`/c/${centerId}/students`, 'POST', {
      name: 'Deletable Student',
      identifier: 'DEL-01',
      group_ids: [groupId],
      contacts: [{ phone: '01700000099', audience: 'guardian', permitted: true }],
    });
    expect(createdStudent.status).toBe(200);
    const delStudentId = z.string().parse(createdStudent.body['id']);

    expect((await call(`/c/${centerId}/students/${delStudentId}`)).status).toBe(200);

    const deleteStudentRes = await call(`/c/${centerId}/students/${delStudentId}`, 'DELETE');
    expect(deleteStudentRes.status).toBe(200);
    expect((await call(`/c/${centerId}/students/${delStudentId}`)).status).toBe(404);

    const deleteGroupRes = await call(`/c/${centerId}/catalog/${groupId}`, 'DELETE');
    expect(deleteGroupRes.status).toBe(200);

    const examSubject = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'subject',
      name: 'Subject In Exam',
    });
    expect(examSubject.status).toBe(201);
    const examSubjectId = z.string().parse(examSubject.body['id']);

    const newExam = await call(`/c/${centerId}/exams`, 'POST', {
      name: 'Deletable Exam',
      exam_date: '2026-10-23',
      papers: [{ subject_id: examSubjectId, maximum: 5000 }],
    });
    expect(newExam.status).toBe(201);
    const newExamId = z.string().parse(newExam.body['id']);

    // Attempting to delete subject while in paper should fail with 422
    expect((await call(`/c/${centerId}/catalog/${examSubjectId}`, 'DELETE')).status).toBe(422);

    // Deleting exam cascades and removes paper
    expect((await call(`/c/${centerId}/exams/${newExamId}`, 'DELETE')).status).toBe(200);
    expect((await call(`/c/${centerId}/exams/${newExamId}`)).status).toBe(404);

    // Now deleting the subject should succeed
    expect((await call(`/c/${centerId}/catalog/${examSubjectId}`, 'DELETE')).status).toBe(200);

    // Deleting a campaign
    const draftCampaign = await call(`/c/${centerId}/campaigns`, 'POST', {
      name: 'Deletable Campaign',
      scope: 'announcement',
      body: 'Testing delete',
      exam_ids: [],
      paper_id: null,
      group_ids: [],
      student_ids: [],
      audience: 'guardian',
      idempotency_key: uid(),
    });
    expect(draftCampaign.status).toBe(201);
    const delCampaignId = z.string().parse(draftCampaign.body['id']);
    expect((await call(`/c/${centerId}/campaigns/${delCampaignId}`)).status).toBe(200);
    expect((await call(`/c/${centerId}/campaigns/${delCampaignId}`, 'DELETE')).status).toBe(200);
    expect((await call(`/c/${centerId}/campaigns/${delCampaignId}`)).status).toBe(404);
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
        contacts: [{ phone: `0170000006${i}`, audience: 'guardian', permitted: true }],
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
        "INSERT INTO student_contacts SELECT ?,json_extract(value,'$.id'),?,'guardian',1 FROM json_each(?)",
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
        contacts: [{ phone: `0170000004${i}`, audience: 'guardian', permitted: true }],
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
        { phone: '01700000091', audience: 'guardian', permitted: true },
        { phone: '01700000092', audience: 'guardian', permitted: true },
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
        contacts: [{ phone: '01700000088', audience: 'guardian', permitted: true }],
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
          { phone: '01700000030', audience: 'guardian', permitted: true },
          { phone: '01700000030', audience: 'student', permitted: true },
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
    const group = await call(`/c/${centerId}/catalog`, 'POST', {
      kind: 'group',
      name: 'Previous batch',
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
        await call(`/c/${centerId}/catalog/${groupId}`, 'PATCH', {
          name: 'Renamed previous batch',
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
describe('history retention', () => {
  const center = uid();
  const student = uid();
  const contact = uid();
  const month = 30 * 86400000;
  beforeAll(async () => {
    await env.DB.batch([
      statement(
        env.DB,
        'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
        center,
        'Retention',
        userId,
      ),
      statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', center, userId),
      statement(
        env.DB,
        'INSERT INTO students(id,center_id,name) VALUES(?,?,?)',
        student,
        center,
        'Keep student',
      ),
      statement(
        env.DB,
        'INSERT INTO contacts(id,center_id,phone) VALUES(?,?,?)',
        contact,
        center,
        '8801700000099',
      ),
    ]);
  });
  async function campaign(state: string, finishedAt: number | null, source: string | null = null) {
    const id = uid();
    await statement(
      env.DB,
      `INSERT INTO campaigns(id,center_id,name,authorizer,selection,state,revision,created_at,idempotency_key,finished_at,source_campaign_id) SELECT ?,?,'Retention test',?,'{}',?,revision,?,?,?,? FROM centers WHERE id=?`,
      id,
      center,
      userId,
      state,
      now() - 90 * 86400000,
      uid(),
      finishedAt,
      source,
      center,
    ).run();
    return id;
  }
  async function message(campaignId: string, state: string) {
    const id = uid();
    await statement(
      env.DB,
      'INSERT INTO messages(id,center_id,campaign_id,student_id,student_name,contact_id,phone,body,segments,state,logical_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id,
      center,
      campaignId,
      student,
      'Keep student',
      contact,
      '8801700000099',
      'Test',
      1,
      state,
      id,
    ).run();
    return id;
  }
  it('expires only finished campaigns older than 30 days, retaining active and uncertain work', async () => {
    const timestamp = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    try {
      const expired = [
        await campaign('completed', timestamp - month - 1),
        await campaign('cancelled', timestamp - month - 1),
      ];
      const keep = [
        await campaign('completed', timestamp - month),
        await campaign('completed', timestamp - 1000),
      ];
      for (const state of [
        'preparing',
        'ready_for_review',
        'queued',
        'scheduled',
        'processing',
        'paused',
        'needs_review',
      ])
        keep.push(await campaign(state, timestamp - month - 1));
      for (const state of ['pending', 'submitting', 'unknown', 'accepted']) {
        const id = await campaign('completed', timestamp - month - 1);
        await message(id, state);
        keep.push(id);
      }
      const source = await campaign('completed', timestamp - month - 1);
      keep.push(source, await campaign('preparing', null, source));
      const withJob = await campaign('completed', timestamp - month - 1);
      await statement(
        env.DB,
        'INSERT INTO jobs(id,center_id,campaign_id,due_at) VALUES(?,?,?,?)',
        withJob,
        center,
        withJob,
        timestamp,
      ).run();
      keep.push(withJob);
      await cleanup(env.DB);
      await cleanup(env.DB);
      for (const id of expired)
        expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', id)).toBeNull();
      for (const id of keep)
        expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', id)).not.toBeNull();
      expect(await one(env.DB, 'SELECT id FROM students WHERE id=?', student)).not.toBeNull();
      expect(await one(env.DB, 'SELECT id FROM contacts WHERE id=?', contact)).not.toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
  it('purges large histories in resumable bounded batches and blocks new dependencies during deletion', async () => {
    const id = await campaign('ready_for_review', null);
    await statement(
      env.DB,
      `WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO messages(id,center_id,campaign_id,student_id,student_name,contact_id,phone,body,segments,state,logical_key) SELECT ?||x,?,?,?,'Keep student',?,'8801700000099','Test',1,'delivered',?||x FROM n`,
      id,
      center,
      id,
      student,
      contact,
      id,
    ).run();
    await statement(
      env.DB,
      `WITH RECURSIVE n(x) AS(SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO attempts SELECT ?||x,?,?,?||x,?,'accepted' FROM n`,
      id,
      center,
      id,
      id,
      now() - month - 1000,
    ).run();
    await env.DB.batch([
      statement(
        env.DB,
        'INSERT INTO campaign_transitions SELECT ?,revision FROM centers WHERE id=?',
        id,
        center,
      ),
      statement(
        env.DB,
        'INSERT INTO campaign_exclusions VALUES(?,?,?,?,?)',
        center,
        id,
        student,
        'Keep student',
        'Test',
      ),
      statement(env.DB, "UPDATE campaigns SET state='completed' WHERE id=?", id),
      statement(env.DB, 'UPDATE campaigns SET finished_at=? WHERE id=?', now() - month - 1000, id),
    ]);
    await cleanup(env.DB);
    expect(await one(env.DB, 'SELECT state FROM campaigns WHERE id=?', id)).toEqual({
      state: 'purging',
    });
    expect(
      await one(env.DB, 'SELECT COUNT(*) AS count FROM messages WHERE campaign_id=?', id),
    ).toEqual({ count: 1 });
    expect(
      await one(env.DB, 'SELECT COUNT(*) AS count FROM attempts WHERE campaign_id=?', id),
    ).toEqual({ count: 1 });
    expect((await call(`/c/${center}/campaigns/${id}`)).status).toBe(404);
    expect(
      (
        await call(`/c/${center}/campaigns/${id}/retry`, 'POST', {
          message_ids: [uid()],
          acknowledge_duplicate_risk: true,
          idempotency_key: uid(),
        })
      ).status,
    ).toBe(404);
    await call(`/c/${center}/campaigns/${id}/cancel`, 'POST', {});
    expect(await one(env.DB, 'SELECT state FROM campaigns WHERE id=?', id)).toEqual({
      state: 'purging',
    });
    await expect(campaign('preparing', null, id)).rejects.toThrow('PREVIEW_CHANGED');
    await cleanup(env.DB);
    await cleanup(env.DB);
    for (const table of ['messages', 'attempts', 'campaign_exclusions', 'campaign_transitions'])
      expect(
        await one(env.DB, `SELECT COUNT(*) AS count FROM ${table} WHERE campaign_id=?`, id),
      ).toEqual({ count: 0 });
    expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', id)).toBeNull();
  });
  it('starts a fresh retention window when delivery status changes', async () => {
    const id = await campaign('completed', now() - month - 1000);
    const sent = await message(id, 'accepted');
    await statement(env.DB, "UPDATE messages SET state='delivered' WHERE id=?", sent).run();
    const result = await one<{ finished_at: number }>(
      env.DB,
      'SELECT finished_at FROM campaigns WHERE id=?',
      id,
    );
    expect(result?.finished_at).toBeGreaterThan(now() - 10000);
    await cleanup(env.DB);
    expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', id)).not.toBeNull();
  });
  it('removes expired dependent history before its source', async () => {
    const source = await campaign('completed', now() - month - 2000);
    const dependent = await campaign('completed', now() - month - 1000, source);
    await cleanup(env.DB);
    expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', dependent)).toBeNull();
    expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', source)).not.toBeNull();
    await cleanup(env.DB);
    expect(await one(env.DB, 'SELECT id FROM campaigns WHERE id=?', source)).toBeNull();
  });
  it('cleans expired temporary records and inactive balance caches while dispatch is disabled', async () => {
    const expired = uid();
    const fresh = uid();
    for (const [key, expiry] of [
      [expired, now() - 1000],
      [fresh, now() + 60000],
    ] as const)
      await env.DB.batch([
        statement(
          env.DB,
          'INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)',
          key,
          userId,
          expiry,
          now(),
        ),
        statement(
          env.DB,
          'INSERT INTO invitations VALUES(?,?,?,?,?,?)',
          key,
          center,
          userId,
          userId,
          expiry,
          '[]',
        ),
        statement(env.DB, 'INSERT INTO throttle VALUES(?,1,?)', key, expiry),
      ]);
    const inactive = uid();
    const active = uid();
    const refreshing = uid();
    for (const [id, enabled, lease] of [
      [inactive, 0, 0],
      [active, 1, 0],
      [refreshing, 0, now() + 60000],
    ] as const)
      await env.DB.batch([
        statement(
          env.DB,
          'INSERT INTO provider_configs(id,center_id,api_key,sender_ids,active,created_at) VALUES(?,?,?,?,?,?)',
          id,
          center,
          'fake-retention-key',
          '["TEST"]',
          enabled,
          now(),
        ),
        statement(
          env.DB,
          'INSERT INTO balances(center_id,config_id,refreshing_until) VALUES(?,?,?)',
          center,
          id,
          lease,
        ),
      ]);
    await scheduled(bindings);
    for (const [table, column] of [
      ['sessions', 'token'],
      ['invitations', 'hash'],
      ['throttle', 'key'],
    ] as const) {
      expect(
        await one(env.DB, `SELECT ${column} FROM ${table} WHERE ${column}=?`, expired),
      ).toBeNull();
      expect(
        await one(env.DB, `SELECT ${column} FROM ${table} WHERE ${column}=?`, fresh),
      ).not.toBeNull();
    }
    expect(
      await one(env.DB, 'SELECT config_id FROM balances WHERE config_id=?', inactive),
    ).toBeNull();
    for (const id of [active, refreshing])
      expect(
        await one(env.DB, 'SELECT config_id FROM balances WHERE config_id=?', id),
      ).not.toBeNull();
    expect(await one(env.DB, 'SELECT id FROM provider_configs WHERE id=?', inactive)).toBeNull();
    const plan = await rows<{ detail: string }>(
      env.DB,
      "EXPLAIN QUERY PLAN SELECT id FROM campaigns INDEXED BY campaigns_retention WHERE state IN ('completed','cancelled') AND finished_at<? ORDER BY finished_at,id LIMIT 1",
      now() - month,
    );
    expect(plan.some((row) => row.detail.includes('campaigns_retention'))).toBe(true);
  });
  it('keeps inactive credentials referenced by a campaign until its history is removed', async () => {
    const config = uid();
    await statement(
      env.DB,
      'INSERT INTO provider_configs(id,center_id,api_key,sender_ids,active,created_at) VALUES(?,?,?,?,0,?)',
      config,
      center,
      'fake-referenced-key',
      '["TEST"]',
      now(),
    ).run();
    const id = await campaign('paused', null);
    await statement(env.DB, 'UPDATE campaigns SET config_id=? WHERE id=?', config, id).run();
    await cleanup(env.DB);
    expect(await one(env.DB, 'SELECT id FROM provider_configs WHERE id=?', config)).not.toBeNull();
    await statement(env.DB, "UPDATE campaigns SET state='cancelled' WHERE id=?", id).run();
    await statement(
      env.DB,
      'UPDATE campaigns SET finished_at=? WHERE id=?',
      now() - month - 1,
      id,
    ).run();
    await cleanup(env.DB);
    await cleanup(env.DB);
    expect(await one(env.DB, 'SELECT id FROM provider_configs WHERE id=?', config)).toBeNull();
  });
  it('removes expired recovery codes and orphan claims but preserves valid underlying tokens', async () => {
    const timestamp = now();
    const personal = uid();
    const assisted = uid();
    const expired = uid();
    const invitation = uid();
    const expiredInvite = uid();
    const consumed = uid();
    for (const [hash, expiry] of [
      [personal, null],
      [assisted, timestamp + 60000],
      [expired, timestamp - 1000],
      [consumed, null],
    ] as const)
      await env.DB.batch([
        statement(
          env.DB,
          'INSERT INTO recovery_codes(hash,user_id,expires_at) VALUES(?,?,?)',
          hash,
          userId,
          expiry,
        ),
        statement(
          env.DB,
          'INSERT INTO auth_claims(hash,created_at) VALUES(?,?)',
          hash,
          timestamp - 10000,
        ),
      ]);
    for (const [hash, expiry] of [
      [invitation, timestamp + 60000],
      [expiredInvite, timestamp - 1000],
    ] as const)
      await env.DB.batch([
        statement(
          env.DB,
          'INSERT INTO invitations VALUES(?,?,?,?,?,?)',
          hash,
          center,
          userId,
          userId,
          expiry,
          '[]',
        ),
        statement(
          env.DB,
          'INSERT INTO auth_claims(hash,created_at) VALUES(?,?)',
          hash,
          timestamp - 10000,
        ),
      ]);
    await statement(env.DB, 'DELETE FROM recovery_codes WHERE hash=?', consumed).run();
    await cleanup(env.DB);
    for (const hash of [personal, assisted])
      expect(
        await one(env.DB, 'SELECT hash FROM recovery_codes WHERE hash=?', hash),
      ).not.toBeNull();
    expect(await one(env.DB, 'SELECT hash FROM recovery_codes WHERE hash=?', expired)).toBeNull();
    for (const hash of [personal, assisted, invitation])
      expect(await one(env.DB, 'SELECT hash FROM auth_claims WHERE hash=?', hash)).not.toBeNull();
    for (const hash of [expired, expiredInvite, consumed])
      expect(await one(env.DB, 'SELECT hash FROM auth_claims WHERE hash=?', hash)).toBeNull();
    await expect(
      statement(
        env.DB,
        'INSERT INTO auth_claims(hash,created_at) VALUES(?,?)',
        consumed,
        now(),
      ).run(),
    ).rejects.toThrow('INVALID_AUTH_TOKEN');
  });
});

describe('unchanged provider settings', () => {
  it('does not create revisions or pause campaigns for identical concurrent saves', async () => {
    const center = uid();
    await env.DB.batch([
      statement(
        env.DB,
        'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
        center,
        'Settings test',
        userId,
      ),
      statement(env.DB, 'INSERT INTO memberships VALUES(?,?,1)', center, userId),
    ]);
    const input = {
      api_key: 'fake-unchanged-settings-key',
      sender_ids: ['09610000000'],
      batch_size: 1,
      interval_seconds: 2,
    };
    const saved = await Promise.all([
      call(`/c/${center}/provider`, 'PUT', input),
      call(`/c/${center}/provider`, 'PUT', input),
    ]);
    expect(saved.map((r) => r.status)).toEqual([200, 200]);
    const original = await one<{ id: string }>(
      env.DB,
      'SELECT id FROM provider_configs WHERE center_id=? AND active=1',
      center,
    );
    const revision = await one(env.DB, 'SELECT revision FROM centers WHERE id=?', center);
    const id = uid();
    await statement(
      env.DB,
      `INSERT INTO campaigns(id,center_id,name,authorizer,selection,state,revision,config_id,created_at,idempotency_key) SELECT ?,?,'Unchanged',?,'{}','ready_for_review',revision,?,?,? FROM centers WHERE id=?`,
      id,
      center,
      userId,
      original?.id,
      now(),
      uid(),
      center,
    ).run();
    const repeated = await Promise.all([
      call(`/c/${center}/provider`, 'PUT', input),
      call(`/c/${center}/provider`, 'PUT', input),
    ]);
    expect(repeated.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await one(env.DB, 'SELECT COUNT(*) AS count FROM provider_configs WHERE center_id=?', center),
    ).toEqual({ count: 1 });
    expect(await one(env.DB, 'SELECT revision FROM centers WHERE id=?', center)).toEqual(revision);
    expect(await one(env.DB, 'SELECT state FROM campaigns WHERE id=?', id)).toEqual({
      state: 'ready_for_review',
    });
    expect((await call(`/c/${center}/provider`, 'PUT', { ...input, batch_size: 2 })).status).toBe(
      200,
    );
    expect(
      await one(env.DB, 'SELECT COUNT(*) AS count FROM provider_configs WHERE center_id=?', center),
    ).toEqual({ count: 2 });
    expect(await one(env.DB, 'SELECT state FROM campaigns WHERE id=?', id)).toEqual({
      state: 'needs_review',
    });
  });
});

describe('bounded database access', () => {
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
