import { Hono } from 'hono';
import { z } from 'zod';
import {
  campaignInput,
  estimateSegments,
  formatScore,
  renderTemplate,
  type Campaign,
  type CampaignInput,
  type Center,
  type Message,
  type ResultStatus,
  type Student,
  type User,
  type Variable,
} from '@coaching/domain';
import { now, one, rows, statement, uid } from './db';
import { AppError, assert } from './errors';
import { accessFor, digest, requirePermission, type AppEnv, type Bindings } from './security';
import { balance, configFor, delivery, submit } from './provider';
import { cleanup } from './cleanup';

interface StoredCampaign extends Campaign {
  center_id: string;
  authorizer: string;
  selection: string;
  revision: number;
  config_id: string | null;
  cursor: string;
  center_name: string;
}
interface Job {
  id: string;
  center_id: string;
  campaign_id: string;
  attempts: number;
  due_at: number;
}
interface ContactRow {
  id: string;
  student_id: string;
  phone: string;
  audience: string;
}
interface ResultRow {
  student_id: string;
  exam_id: string;
  exam_name: string;
  subject_name: string;
  maximum: number;
  score: number | null;
  status: ResultStatus;
  paper_id: string;
  result_version: number;
}
export const campaigns = new Hono<AppEnv>();
const messageColumns = 'id,student_name,phone,body,state,provider_id,reason,segments';
async function createJob(
  db: D1Database,
  center: string,
  campaign: string,
  due: number,
): Promise<void> {
  await statement(
    db,
    'INSERT INTO jobs(id,center_id,campaign_id,due_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,published_at=NULL,attempts=0,exhausted=0',
    campaign,
    center,
    campaign,
    due,
  ).run();
}
campaigns.post('/', async (c) => {
  const a = requirePermission(c, 'messages.create');
  const input = campaignInput.parse(await c.req.json());
  if (input.scope !== 'announcement') {
    assert(input.exam_ids.length, 'EXAM_REQUIRED', 'Choose at least one exam.', 422);
    requirePermission(c, 'results.read');
  }
  if (input.scope === 'subject')
    assert(
      input.exam_ids.length === 1 && input.paper_id,
      'PAPER_REQUIRED',
      'Choose one exam and one subject for a subject message.',
      422,
    );
  for (const exam of input.exam_ids)
    assert(
      await one(
        c.env.DB,
        'SELECT id FROM exams WHERE center_id=? AND id=? AND active=1',
        a.center.id,
        exam,
      ),
      'INVALID_EXAM',
      'Choose active exams from this center.',
      422,
    );
  if (input.paper_id)
    assert(
      await one(
        c.env.DB,
        'SELECT id FROM papers WHERE center_id=? AND id=? AND exam_id IN (SELECT value FROM json_each(?))',
        a.center.id,
        input.paper_id,
        JSON.stringify(input.exam_ids),
      ),
      'INVALID_PAPER',
      'Choose a paper belonging to the selected exam.',
      422,
    );
  const previous = await one<{ id: string }>(
    c.env.DB,
    'SELECT id FROM campaigns WHERE center_id=? AND idempotency_key=?',
    a.center.id,
    input.idempotency_key,
  );
  if (previous) return c.json(previous);
  if (input.resumption_source)
    assert(
      await one(
        c.env.DB,
        "SELECT id FROM campaigns WHERE center_id=? AND id=? AND state='cancelled'",
        a.center.id,
        input.resumption_source,
      ),
      'INVALID_RESUMPTION',
      'This source campaign is unavailable.',
      422,
    );
  const id = uid();
  const config = await configFor(c.env.DB, a.center.id);
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO campaigns(id,center_id,name,authorizer,selection,revision,config_id,created_at,idempotency_key,center_name,source_campaign_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id,
      a.center.id,
      input.name,
      a.user.id,
      JSON.stringify(input),
      a.center.revision,
      config?.id ?? null,
      now(),
      input.idempotency_key,
      a.center.name,
      input.resumption_source,
    ),
    statement(
      c.env.DB,
      'INSERT INTO jobs(id,center_id,campaign_id,due_at) VALUES(?,?,?,?)',
      id,
      a.center.id,
      id,
      now(),
    ),
  ]);
  c.executionCtx.waitUntil(dispatch(c.env));
  await processJob(c.env, id).catch(() => undefined);
  return c.json({ id }, 201);
});
campaigns.get('/', async (c) => {
  const a = requirePermission(c, 'messages.read');
  const cursor = c.req.query('cursor')
    ? z.tuple([z.number(), z.string()]).parse(JSON.parse(c.req.query('cursor') ?? ''))
    : [Number.MAX_SAFE_INTEGER, ''];
  const items = await rows<Campaign>(
    c.env.DB,
    "SELECT id,name,state,created_at,scheduled_at,total,excluded,submitted,delivered,failed,unknown,skipped,reason FROM campaigns WHERE center_id=? AND state!='purging' AND (created_at<? OR (created_at=? AND id>?)) ORDER BY created_at DESC,id LIMIT 31",
    a.center.id,
    cursor[0],
    cursor[0],
    cursor[1],
  );
  const more = items.length > 30;
  if (more) items.pop();
  const last = items.at(-1);
  return c.json({ items, next: more && last ? JSON.stringify([last.created_at, last.id]) : null });
});
campaigns.get('/:id', async (c) => {
  const a = requirePermission(c, 'messages.read');
  const item = await one<StoredCampaign>(
    c.env.DB,
    "SELECT * FROM campaigns WHERE center_id=? AND id=? AND state!='purging'",
    a.center.id,
    c.req.param('id'),
  );
  assert(item, 'NOT_FOUND', 'This campaign is unavailable.', 404);
  return c.json({
    ...item,
    selection: a.grants.includes('messages.read_content')
      ? campaignInput.parse(JSON.parse(item.selection))
      : null,
  });
});
campaigns.get('/:id/messages', async (c) => {
  const a = requirePermission(c, 'messages.read_content');
  const items = await rows<Message>(
    c.env.DB,
    `SELECT ${messageColumns} FROM messages WHERE center_id=? AND campaign_id=? AND id>? ORDER BY id LIMIT 31`,
    a.center.id,
    c.req.param('id'),
    c.req.query('cursor') ?? '',
  );
  const more = items.length > 30;
  if (more) items.pop();
  return c.json({ items, next: more ? items.at(-1)?.id : null });
});
campaigns.get('/:id/exclusions', async (c) => {
  const a = requirePermission(c, 'messages.read_content');
  const items = await rows<{ student_id: string; student_name: string; reason: string }>(
    c.env.DB,
    'SELECT student_id,student_name,reason FROM campaign_exclusions WHERE center_id=? AND campaign_id=? AND student_id>? ORDER BY student_id LIMIT 51',
    a.center.id,
    c.req.param('id'),
    c.req.query('cursor') ?? '',
  );
  const more = items.length > 50;
  if (more) items.pop();
  return c.json({ items, next: more ? items.at(-1)?.student_id : null });
});
campaigns.post('/:id/approve', async (c) => {
  const input = z.object({ scheduled_at: z.number().int().nullable() }).parse(await c.req.json());
  const a = requirePermission(c, input.scheduled_at ? 'messages.schedule' : 'messages.send');
  assert(
    c.env.SMS_MODE !== 'disabled',
    'SMS_DISABLED',
    'Sending is disabled. Configure mock mode for testing or live mode for production.',
    503,
  );
  if (input.scheduled_at)
    assert(
      input.scheduled_at > now() + 60000,
      'SCHEDULE_INVALID',
      'Choose a send time at least one minute in the future.',
      422,
    );
  const config = await configFor(c.env.DB, a.center.id);
  assert(
    config,
    'PROVIDER_REQUIRED',
    'Add your SMS API key and approved sender ID in Settings first.',
    422,
  );
  const funds = await balance(c.env, config, true);
  assert(
    funds.balance !== null && Number(funds.balance) > 0,
    'BALANCE_LOW',
    'Refresh or recharge your SMS balance before sending.',
    422,
  );
  const existing = await one<{ state: string; revision: number; total: number }>(
    c.env.DB,
    'SELECT state,revision,total FROM campaigns WHERE center_id=? AND id=?',
    a.center.id,
    c.req.param('id'),
  );
  if (existing && ['queued', 'processing', 'scheduled', 'completed'].includes(existing.state))
    return c.json({ ok: true });
  assert(
    existing &&
      existing.state === 'ready_for_review' &&
      existing.total > 0 &&
      existing.revision === a.center.revision,
    'PREVIEW_CHANGED',
    'The preview is not ready, is empty, or source data changed. Prepare a fresh campaign.',
    409,
  );
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO campaign_transitions VALUES(?,?)',
      c.req.param('id'),
      a.center.revision,
    ),
    statement(
      c.env.DB,
      'UPDATE campaigns SET state=?,scheduled_at=?,scheduled_timezone=?,authorizer=?,config_id=?,reason=NULL WHERE center_id=? AND id=?',
      input.scheduled_at ? 'scheduled' : 'queued',
      input.scheduled_at,
      a.center.timezone,
      a.user.id,
      config.id,
      a.center.id,
      c.req.param('id'),
    ),
    statement(
      c.env.DB,
      'INSERT INTO jobs(id,center_id,campaign_id,due_at) VALUES(?,?,?,?)',
      c.req.param('id'),
      a.center.id,
      c.req.param('id'),
      input.scheduled_at ?? now(),
    ),
  ]);
  c.executionCtx.waitUntil(dispatch(c.env));
  return c.json({ ok: true });
});
campaigns.post('/:id/cancel', async (c) => {
  const a = requirePermission(c, 'messages.cancel');
  await c.env.DB.batch([
    statement(
      c.env.DB,
      "UPDATE campaigns SET state='cancelled',reason='Cancelled by staff; requests already in flight cannot be recalled.' WHERE center_id=? AND id=? AND state NOT IN ('completed','purging')",
      a.center.id,
      c.req.param('id'),
    ),
    statement(
      c.env.DB,
      "UPDATE messages SET state='cancelled' WHERE center_id=? AND campaign_id=? AND state='pending'",
      a.center.id,
      c.req.param('id'),
    ),
    statement(
      c.env.DB,
      'DELETE FROM jobs WHERE center_id=? AND campaign_id=?',
      a.center.id,
      c.req.param('id'),
    ),
  ]);
  return c.json({ ok: true });
});
campaigns.post('/:id/resume', async (c) => {
  const a = requirePermission(c, 'messages.send');
  const config = await configFor(c.env.DB, a.center.id);
  assert(config, 'PROVIDER_REQUIRED', 'Configure your SMS account first.', 422);
  const funds = await balance(c.env, config, true);
  assert(Number(funds.balance) > 0, 'BALANCE_LOW', 'Recharge the SMS account first.', 422);
  const result = await statement(
    c.env.DB,
    "UPDATE campaigns SET state='queued',reason=NULL,scheduled_at=NULL WHERE center_id=? AND id=? AND state='paused' AND authorizer=? AND revision=? AND config_id=?",
    a.center.id,
    c.req.param('id'),
    a.user.id,
    a.center.revision,
    config.id,
  ).run();
  assert(
    result.meta.changes,
    'RESUME_UNAVAILABLE',
    'Source data, credentials or authorization changed. Prepare a new campaign instead.',
    409,
  );
  await createJob(c.env.DB, a.center.id, c.req.param('id'), now());
  c.executionCtx.waitUntil(dispatch(c.env));
  return c.json({ ok: true });
});
campaigns.post('/:id/messages/:message/refresh', async (c) => {
  const a = requirePermission(c, 'messages.read_content');
  const message = await one<{ id: string; provider_id: string; config_id: string; state: string }>(
    c.env.DB,
    'SELECT m.id,m.provider_id,m.state,c.config_id FROM messages m JOIN campaigns c ON c.id=m.campaign_id AND c.center_id=m.center_id WHERE m.center_id=? AND m.campaign_id=? AND m.id=?',
    a.center.id,
    c.req.param('id'),
    c.req.param('message'),
  );
  assert(
    message?.provider_id,
    'NO_PROVIDER_ID',
    'This message has no confirmed provider ID. Check the SMS provider dashboard.',
    409,
  );
  if (message.state === 'accepted') await checkMessage(c.env, message.id, true);
  return c.json({ ok: true });
});
campaigns.post('/:id/retry', async (c) => {
  const a = requirePermission(c, 'messages.retry');
  requirePermission(c, 'messages.read_content');
  const input = z
    .object({
      message_ids: z.array(z.uuid()).min(1).max(100),
      acknowledge_duplicate_risk: z.literal(true),
      idempotency_key: z.uuid(),
    })
    .parse(await c.req.json());
  const original = await one<StoredCampaign>(
    c.env.DB,
    "SELECT * FROM campaigns WHERE center_id=? AND id=? AND state!='purging'",
    a.center.id,
    c.req.param('id'),
  );
  assert(original, 'NOT_FOUND', 'This campaign is unavailable.', 404);
  const existing = await one<{ id: string }>(
    c.env.DB,
    'SELECT id FROM campaigns WHERE center_id=? AND idempotency_key=?',
    a.center.id,
    input.idempotency_key,
  );
  if (existing) return c.json(existing);
  const selected = await rows<
    Message & {
      student_id: string;
      contact_id: string;
      student_version: number;
      source_signature: string;
    }
  >(
    c.env.DB,
    "SELECT * FROM messages WHERE center_id=? AND campaign_id=? AND id IN (SELECT value FROM json_each(?)) AND state IN ('unknown','failed')",
    a.center.id,
    original.id,
    JSON.stringify(input.message_ids),
  );
  assert(
    selected.length === new Set(input.message_ids).size,
    'RESEND_UNAVAILABLE',
    'Select only failed or uncertain messages from this campaign.',
    422,
  );
  const id = uid();
  const config = await configFor(c.env.DB, a.center.id);
  await c.env.DB.batch([
    statement(
      c.env.DB,
      "INSERT INTO campaigns(id,center_id,name,authorizer,selection,state,revision,config_id,created_at,idempotency_key,center_name,source_campaign_id) VALUES(?,?,?,?,?,'ready_for_review',?,?,?,?,?,?)",
      id,
      a.center.id,
      `${original.name.slice(0, 145)} · Resend`,
      a.user.id,
      JSON.stringify({
        ...campaignInput.parse(JSON.parse(original.selection)),
        student_ids: [...new Set(selected.map((m) => m.student_id))],
        group_ids: [],
        recipient_keys: selected.map((m) => `${m.student_id}:${m.phone}`),
        resumption_source: null,
        idempotency_key: input.idempotency_key,
      }),
      a.center.revision,
      config?.id ?? null,
      now(),
      input.idempotency_key,
      a.center.name,
      original.id,
    ),
    ...selected.map((m) =>
      statement(
        c.env.DB,
        'INSERT INTO messages(id,center_id,campaign_id,student_id,student_name,contact_id,phone,body,segments,logical_key,student_version,source_signature) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        uid(),
        a.center.id,
        id,
        m.student_id,
        m.student_name,
        m.contact_id,
        m.phone,
        m.body,
        m.segments,
        m.id,
        m.student_version,
        m.source_signature,
      ),
    ),
  ]);
  return c.json({ id }, 201);
});
campaigns.post('/:id/rebuild', async (c) => {
  const a = requirePermission(c, 'messages.create');
  const input = z.object({ idempotency_key: z.uuid() }).parse(await c.req.json());
  const existing = await one<{ id: string }>(
    c.env.DB,
    'SELECT id FROM campaigns WHERE center_id=? AND idempotency_key=?',
    a.center.id,
    input.idempotency_key,
  );
  if (existing) return c.json(existing);
  const original = await one<StoredCampaign>(
    c.env.DB,
    "SELECT * FROM campaigns WHERE center_id=? AND id=? AND state IN ('needs_review','paused')",
    a.center.id,
    c.req.param('id'),
  );
  assert(
    original,
    'REFRESH_UNAVAILABLE',
    'Only paused campaigns or campaigns needing review can refresh unsent messages.',
    409,
  );
  const selection = campaignInput.parse({
    ...campaignInput.parse(JSON.parse(original.selection)),
    resumption_source: original.id,
    idempotency_key: input.idempotency_key,
  });
  if (selection.scope !== 'announcement') requirePermission(c, 'results.read');
  const id = uid();
  const config = await configFor(c.env.DB, a.center.id);
  await c.env.DB.batch([
    statement(
      c.env.DB,
      "UPDATE campaigns SET state='cancelled',reason='Unsent messages moved to a fresh review campaign.' WHERE center_id=? AND id=?",
      a.center.id,
      original.id,
    ),
    statement(
      c.env.DB,
      "UPDATE messages SET state='cancelled' WHERE center_id=? AND campaign_id=? AND state='pending'",
      a.center.id,
      original.id,
    ),
    statement(c.env.DB, 'DELETE FROM jobs WHERE id=?', original.id),
    statement(
      c.env.DB,
      'INSERT INTO campaigns(id,center_id,name,authorizer,selection,revision,config_id,created_at,idempotency_key,center_name,source_campaign_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id,
      a.center.id,
      original.name,
      a.user.id,
      JSON.stringify(selection),
      a.center.revision,
      config?.id ?? null,
      now(),
      input.idempotency_key,
      a.center.name,
      original.id,
    ),
    statement(
      c.env.DB,
      'INSERT INTO jobs(id,center_id,campaign_id,due_at) VALUES(?,?,?,?)',
      id,
      a.center.id,
      id,
      now(),
    ),
  ]);
  c.executionCtx.waitUntil(dispatch(c.env));
  await processJob(c.env, id).catch(() => undefined);
  return c.json({ id }, 201);
});

async function pause(
  db: D1Database,
  campaign: StoredCampaign,
  state: 'paused' | 'needs_review',
  reason: string,
) {
  await db.batch([
    statement(
      db,
      "UPDATE campaigns SET state=?,reason=? WHERE center_id=? AND id=? AND state NOT IN ('completed','cancelled')",
      state,
      reason,
      campaign.center_id,
      campaign.id,
    ),
    statement(db, 'DELETE FROM jobs WHERE id=?', campaign.id),
  ]);
}
async function resultsFor(
  db: D1Database,
  center: string,
  input: CampaignInput,
  students: string,
): Promise<ResultRow[]> {
  return input.scope === 'announcement'
    ? []
    : rows<ResultRow>(
        db,
        "SELECT pt.student_id,e.id AS exam_id,e.name AS exam_name,s.name AS subject_name,p.maximum,r.score,COALESCE(r.status,'pending') AS status,p.id AS paper_id,COALESCE(r.version,0) AS result_version FROM participants pt JOIN exams e ON e.center_id=pt.center_id AND e.id=pt.exam_id JOIN papers p ON p.center_id=e.center_id AND p.exam_id=e.id JOIN catalog s ON s.center_id=p.center_id AND s.id=p.subject_id LEFT JOIN results r ON r.center_id=p.center_id AND r.paper_id=p.id AND r.student_id=pt.student_id WHERE pt.center_id=? AND pt.student_id IN (SELECT value FROM json_each(?)) AND e.id IN (SELECT value FROM json_each(?)) AND (? IS NULL OR p.id=?) ORDER BY e.exam_date,e.id,p.position,p.id",
        center,
        students,
        JSON.stringify(input.exam_ids),
        input.paper_id,
        input.paper_id,
      );
}
async function prepare(env: Bindings, campaign: StoredCampaign, input: CampaignInput) {
  const center = await one<Center>(env.DB, 'SELECT * FROM centers WHERE id=?', campaign.center_id);
  if (!center || !center.active || center.revision !== campaign.revision) {
    await pause(
      env.DB,
      campaign,
      'needs_review',
      'Student, result or configuration data changed while preparing. Create a fresh preview.',
    );
    return;
  }
  const students = await rows<Student>(
    env.DB,
    `SELECT s.* FROM students s WHERE s.center_id=? AND s.active=1 AND s.id>? AND (?='announcement' OR EXISTS(SELECT 1 FROM participants p WHERE p.center_id=s.center_id AND p.student_id=s.id AND p.exam_id IN (SELECT value FROM json_each(?)))) AND (?='[]' OR s.id IN (SELECT value FROM json_each(?))) AND (?='[]' OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.center_id=s.center_id AND gm.student_id=s.id AND gm.left_at IS NULL AND gm.group_id IN (SELECT value FROM json_each(?)))) ORDER BY s.id LIMIT 20`,
    center.id,
    campaign.cursor,
    input.scope,
    JSON.stringify(input.exam_ids),
    JSON.stringify(input.student_ids),
    JSON.stringify(input.student_ids),
    JSON.stringify(input.group_ids),
    JSON.stringify(input.group_ids),
  );
  if (!students.length) {
    await env.DB.batch([
      statement(
        env.DB,
        "UPDATE campaigns SET state='ready_for_review' WHERE id=? AND state='preparing'",
        campaign.id,
      ),
      statement(env.DB, 'DELETE FROM jobs WHERE id=?', campaign.id),
    ]);
    return;
  }
  const studentIds = JSON.stringify(students.map((s) => s.id));
  const contacts = await rows<ContactRow>(
    env.DB,
    "WITH RECURSIVE prior(id) AS (SELECT ? WHERE ?!='' UNION SELECT json_extract(c.selection,'$.resumption_source') FROM campaigns c JOIN prior p ON c.id=p.id WHERE c.center_id=? AND json_extract(c.selection,'$.resumption_source') IS NOT NULL) SELECT ct.id,ct.phone,sc.student_id,sc.audience FROM student_contacts sc JOIN contacts ct ON ct.id=sc.contact_id AND ct.center_id=sc.center_id WHERE sc.center_id=? AND sc.student_id IN (SELECT value FROM json_each(?)) AND sc.permitted=1 AND ct.suppressed=0 AND (?='both' OR sc.audience=?) AND (?='[]' OR (sc.student_id||':'||ct.phone) IN (SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM messages previous WHERE previous.center_id=sc.center_id AND previous.campaign_id IN (SELECT id FROM prior) AND previous.phone=ct.phone AND (?=1 OR previous.student_id=sc.student_id) AND previous.state IN ('accepted','delivered','failed','unknown','submitting'))",
    input.resumption_source ?? '',
    input.resumption_source ?? '',
    center.id,
    center.id,
    studentIds,
    input.audience,
    input.audience,
    JSON.stringify(input.recipient_keys),
    JSON.stringify(input.recipient_keys),
    Number(input.scope === 'announcement' && !input.body.includes('student_name')),
  );
  const results = await resultsFor(env.DB, center.id, input, studentIds);
  const batch: D1PreparedStatement[] = [];
  let excluded = 0;
  for (const student of students) {
    const scores = results.filter((r) => r.student_id === student.id);
    const eligible = contacts.filter((contact) => contact.student_id === student.id);
    if (
      !eligible.length ||
      (input.scope !== 'announcement' &&
        (!scores.length || scores.some((r) => r.status === 'pending')))
    ) {
      excluded++;
      batch.push(
        statement(
          env.DB,
          'INSERT OR IGNORE INTO campaign_exclusions VALUES(?,?,?,?,?)',
          center.id,
          campaign.id,
          student.id,
          student.name,
          eligible.length
            ? 'Pending or missing results. Complete this student’s marks before preparing a new campaign.'
            : 'No permitted contact. Add a phone number with SMS permission to the student profile.',
        ),
      );
      continue;
    }
    const first = scores[0];
    const values: Partial<Record<Variable, string>> = {
      student_name: student.name,
      institute_name: center.name,
    };
    if (first) {
      const distinctExams = new Set(scores.map((r) => r.exam_name));
      const multipleExams = distinctExams.size > 1;
      Object.assign(values, {
        exam_name: [...distinctExams].join(', '),
        subject_name: first.subject_name,
        marks: first.score === null ? first.status : formatScore(first.score),
        full_marks: formatScore(first.maximum),
        results_summary: scores
          .map((r) => {
            const score =
              r.score === null ? r.status : `${formatScore(r.score)}/${formatScore(r.maximum)}`;
            return multipleExams
              ? `${r.exam_name} · ${r.subject_name}: ${score}`
              : `${r.subject_name}: ${score}`;
          })
          .join('\n'),
      });
    }
    let body: string;
    try {
      body = renderTemplate(input.body, input.scope, values);
    } catch (error) {
      await pause(
        env.DB,
        campaign,
        'needs_review',
        error instanceof Error ? error.message : 'The message template is invalid.',
      );
      return;
    }
    const signature = input.scope === 'announcement' ? '' : await digest(JSON.stringify(scores));
    for (const contact of eligible)
      batch.push(
        statement(
          env.DB,
          "INSERT OR IGNORE INTO messages(id,center_id,campaign_id,student_id,student_name,contact_id,phone,body,segments,logical_key,student_version,source_signature) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=? AND state='preparing')",
          uid(),
          center.id,
          campaign.id,
          student.id,
          student.name,
          contact.id,
          contact.phone,
          body,
          estimateSegments(body).segments,
          input.scope === 'announcement' && !input.body.includes('student_name')
            ? contact.phone
            : `${student.id}:${contact.phone}`,
          student.version,
          signature,
          campaign.id,
        ),
      );
  }
  const isFinished = students.length < 20;
  if (isFinished) {
    batch.push(
      statement(
        env.DB,
        "UPDATE campaigns SET state='ready_for_review',cursor=?,excluded=excluded+? WHERE id=? AND state='preparing'",
        students.at(-1)?.id,
        excluded,
        campaign.id,
      ),
      statement(env.DB, 'DELETE FROM jobs WHERE id=?', campaign.id),
    );
  } else {
    batch.push(
      statement(
        env.DB,
        "UPDATE campaigns SET cursor=?,excluded=excluded+? WHERE id=? AND state='preparing'",
        students.at(-1)?.id,
        excluded,
        campaign.id,
      ),
      statement(
        env.DB,
        'UPDATE jobs SET due_at=?,published_at=NULL,attempts=0 WHERE id=?',
        now(),
        campaign.id,
      ),
    );
  }
  await env.DB.batch(batch);
}

function inputInstituteChanged(campaign: StoredCampaign, center: Center): boolean {
  const input = campaignInput.parse(JSON.parse(campaign.selection));
  return input.body.includes('institute_name') && campaign.center_name !== center.name;
}
async function sendChunk(env: Bindings, campaign: StoredCampaign) {
  const user = await one<User>(
    env.DB,
    'SELECT id,name,phone,platform FROM users WHERE id=?',
    campaign.authorizer,
  );
  if (!user) {
    await pause(env.DB, campaign, 'needs_review', 'The authorizing account is unavailable.');
    return;
  }
  let access;
  try {
    access = await accessFor(env.DB, user, campaign.center_id);
  } catch {
    await pause(
      env.DB,
      campaign,
      'needs_review',
      'Center access changed. Ask an authorized staff member to review.',
    );
    return;
  }
  if (
    !access.grants.includes(campaign.scheduled_at ? 'messages.schedule' : 'messages.send') ||
    inputInstituteChanged(campaign, access.center)
  ) {
    await pause(
      env.DB,
      campaign,
      'needs_review',
      'Academic data or sending permission changed. Prepare a fresh preview.',
    );
    return;
  }
  if (
    campaign.scheduled_at &&
    campaign.submitted === 0 &&
    now() - campaign.scheduled_at > access.center.late_minutes * 60000
  ) {
    await pause(
      env.DB,
      campaign,
      'paused',
      'This schedule started later than the permitted window. Review before resuming.',
    );
    return;
  }
  const config = await configFor(env.DB, campaign.center_id);
  if (!config || config.id !== campaign.config_id) {
    await pause(
      env.DB,
      campaign,
      'needs_review',
      'Your SMS account settings changed. Review before sending.',
    );
    return;
  }
  if (env.SMS_MODE === 'disabled') {
    await pause(env.DB, campaign, 'paused', 'Sending is disabled in this environment.');
    return;
  }
  const messages = await rows<
    Message & {
      contact_id: string;
      student_id: string;
      student_version: number;
      source_signature: string;
    }
  >(
    env.DB,
    "SELECT * FROM messages WHERE center_id=? AND campaign_id=? AND state='pending' ORDER BY id LIMIT ?",
    campaign.center_id,
    campaign.id,
    config.batch_size,
  );
  if (!messages.length) {
    await env.DB.batch([
      statement(
        env.DB,
        "UPDATE campaigns SET state='completed' WHERE id=? AND state!='cancelled'",
        campaign.id,
      ),
      statement(env.DB, 'DELETE FROM jobs WHERE id=?', campaign.id),
    ]);
    return;
  }
  const input = campaignInput.parse(JSON.parse(campaign.selection));
  const studentIds = JSON.stringify(messages.map((message) => message.student_id));
  const currentStudents = await rows<Student>(
    env.DB,
    'SELECT id,version,name FROM students WHERE center_id=? AND id IN (SELECT value FROM json_each(?))',
    campaign.center_id,
    studentIds,
  );
  const currentResults = await resultsFor(env.DB, campaign.center_id, input, studentIds);
  for (const message of messages) {
    const student = currentStudents.find((student) => student.id === message.student_id);
    if (
      !student ||
      student.version !== message.student_version ||
      (input.scope !== 'announcement' &&
        (await digest(
          JSON.stringify(
            currentResults.filter((result) => result.student_id === message.student_id),
          ),
        )) !== message.source_signature)
    ) {
      await pause(
        env.DB,
        campaign,
        'needs_review',
        'A remaining student’s details or results changed. Refresh unsent messages; already submitted messages will not be included.',
      );
      return;
    }
  }
  const eligibility =
    'EXISTS(SELECT 1 FROM students s JOIN student_contacts sc ON sc.center_id=s.center_id AND sc.student_id=s.id JOIN contacts ct ON ct.center_id=sc.center_id AND ct.id=sc.contact_id WHERE s.center_id=messages.center_id AND s.id=messages.student_id AND s.active=1 AND sc.contact_id=messages.contact_id AND sc.permitted=1 AND ct.suppressed=0 AND ct.phone=messages.phone)';
  await env.DB.batch(
    messages.map((m) =>
      statement(
        env.DB,
        `UPDATE messages SET state='skipped',reason='This student or contact is no longer eligible for SMS.' WHERE center_id=? AND id=? AND state='pending' AND NOT ${eligibility}`,
        campaign.center_id,
        m.id,
      ),
    ),
  );
  const claim = uid();
  await env.DB.batch(
    messages.map((m) =>
      statement(
        env.DB,
        "UPDATE messages SET state='submitting',claim=?,submitted_at=? WHERE center_id=? AND id=? AND state='pending' AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND state IN ('queued','processing','scheduled'))",
        claim,
        now(),
        campaign.center_id,
        m.id,
        campaign.id,
      ),
    ),
  );
  const claimed = await rows<Message>(
    env.DB,
    "SELECT * FROM messages WHERE center_id=? AND campaign_id=? AND claim=? AND state='submitting'",
    campaign.center_id,
    campaign.id,
    claim,
  );
  if (!claimed.length) {
    await statement(
      env.DB,
      'UPDATE jobs SET due_at=?,published_at=NULL,attempts=0 WHERE id=?',
      now(),
      campaign.id,
    ).run();
    return;
  }
  const outcomes = await submit(env, config, claimed);
  const batch: D1PreparedStatement[] = [];
  let unknown = 0;
  let low = false;
  for (const [index, message] of claimed.entries()) {
    const outcome = outcomes[index];
    assert(outcome, 'PROVIDER_RESPONSE', 'No response was recorded for a message.', 502);
    const state = outcome.state === 'low_balance' ? 'pending' : outcome.state;
    if (state === 'unknown') unknown++;
    if (outcome.state === 'low_balance') low = true;
    batch.push(
      statement(
        env.DB,
        "UPDATE messages SET state=?,provider_id=?,reason=?,next_check_at=?,claim=NULL WHERE center_id=? AND id=? AND claim=? AND state='submitting'",
        state,
        outcome.state === 'accepted' ? outcome.id : null,
        outcome.state === 'accepted' ? null : outcome.reason,
        outcome.state === 'accepted' ? now() + 60000 : null,
        campaign.center_id,
        message.id,
        claim,
      ),
      statement(
        env.DB,
        'INSERT INTO attempts VALUES(?,?,?,?,?,?)',
        uid(),
        campaign.center_id,
        campaign.id,
        message.id,
        now(),
        outcome.state,
      ),
    );
  }
  batch.push(
    statement(
      env.DB,
      "UPDATE campaigns SET state=CASE WHEN state='cancelled' THEN state ELSE ? END,reason=? WHERE id=?",
      low ? 'paused' : unknown ? 'paused' : 'processing',
      low
        ? 'Insufficient SMS balance.'
        : unknown
          ? 'A submission could not be confirmed. Check the provider before continuing.'
          : null,
      campaign.id,
    ),
  );
  batch.push(
    low || unknown
      ? statement(env.DB, 'DELETE FROM jobs WHERE id=?', campaign.id)
      : statement(
          env.DB,
          'UPDATE jobs SET due_at=?,published_at=NULL,attempts=0 WHERE id=?',
          now() + config.interval_seconds * 1000,
          campaign.id,
        ),
  );
  if (low)
    batch.push(
      statement(
        env.DB,
        'UPDATE balances SET checked_at=NULL WHERE center_id=? AND config_id=?',
        campaign.center_id,
        config.id,
      ),
    );
  await env.DB.batch(batch);
}

export async function processJob(env: Bindings, id: string): Promise<void> {
  const job = await one<Job>(
    env.DB,
    'SELECT * FROM jobs WHERE id=? AND exhausted=0 AND due_at<=?',
    id,
    now(),
  );
  if (!job) return;
  const campaign = await one<StoredCampaign>(
    env.DB,
    'SELECT * FROM campaigns WHERE center_id=? AND id=?',
    job.center_id,
    job.campaign_id,
  );
  if (
    !campaign ||
    ['cancelled', 'completed', 'paused', 'needs_review', 'ready_for_review'].includes(
      campaign.state,
    )
  ) {
    await statement(env.DB, 'DELETE FROM jobs WHERE id=?', id).run();
    return;
  }
  if (job.attempts >= 5) {
    await pause(
      env.DB,
      campaign,
      'paused',
      'Background processing stopped after repeated failures. Review pending work before resuming.',
    );
    return;
  }
  const lease = await statement(
    env.DB,
    'UPDATE jobs SET published_at=?,attempts=attempts+1 WHERE id=? AND (published_at IS NULL OR published_at<=?)',
    now() + 120000,
    id,
    now(),
  ).run();
  if (!lease.meta.changes) return;
  if (campaign.state === 'preparing')
    await prepare(env, campaign, campaignInput.parse(JSON.parse(campaign.selection)));
  else await sendChunk(env, campaign);
}
export async function dispatch(env: Bindings): Promise<void> {
  if (env.DISPATCH_ENABLED !== 'true') return;
  const jobs = await rows<Job>(
    env.DB,
    'SELECT * FROM jobs WHERE exhausted=0 AND due_at<=? AND (published_at IS NULL OR published_at<?) ORDER BY due_at,id LIMIT 10',
    now() + 60000,
    now() - 120000,
  );
  for (const job of jobs) {
    await env.JOBS.send(
      { id: job.id },
      { delaySeconds: Math.max(0, Math.ceil((job.due_at - now()) / 1000)) },
    );
    await statement(
      env.DB,
      'UPDATE jobs SET published_at=? WHERE id=? AND (published_at IS NULL OR published_at<?)',
      now(),
      job.id,
      now() - 120000,
    ).run();
  }
}
export async function checkMessage(env: Bindings, id: string, manual = false): Promise<void> {
  const message = await one<{
    id: string;
    center_id: string;
    campaign_id: string;
    provider_id: string;
    config_id: string;
    check_count: number;
    submitted_at: number;
  }>(
    env.DB,
    "SELECT m.*,c.config_id FROM messages m JOIN campaigns c ON c.center_id=m.center_id AND c.id=m.campaign_id WHERE m.id=? AND m.state='accepted' AND (m.next_check_at<=? OR ?=1) AND m.last_check_at<=?",
    id,
    now(),
    Number(manual),
    now() - 60000,
  );
  if (!message) return;
  const claim = await statement(
    env.DB,
    "UPDATE messages SET next_check_at=?,last_check_at=? WHERE id=? AND last_check_at<=? AND state='accepted'",
    now() + 60000,
    now(),
    id,
    now() - 60000,
  ).run();
  if (!claim.meta.changes) return;
  const config = await configFor(env.DB, message.center_id, message.config_id);
  let state: 'accepted' | 'delivered' | 'failed' = 'accepted';
  if (config) {
    try {
      state = await delivery(env, config, message.provider_id);
    } catch {
      if (manual)
        throw new AppError(
          'STATUS_UNAVAILABLE',
          'The provider could not confirm delivery status. The message was not resent. Try again after a minute or check the provider dashboard.',
          502,
        );
    }
  }
  const next =
    now() - message.submitted_at >= 86400000
      ? null
      : now() + Math.min(3600000, 60000 * 2 ** Math.min(message.check_count, 6));
  await env.DB.batch([
    statement(
      env.DB,
      "UPDATE messages SET state=?,check_count=check_count+1,next_check_at=? WHERE id=? AND state='accepted'",
      state,
      state === 'accepted' ? next : null,
      id,
    ),
  ]);
}
export async function scheduled(env: Bindings): Promise<void> {
  await cleanup(env.DB);
  if (env.DISPATCH_ENABLED !== 'true') return;
  const stale = await rows<{ id: string; campaign_id: string; center_id: string }>(
    env.DB,
    "SELECT id,campaign_id,center_id FROM messages WHERE state='submitting' AND submitted_at<? LIMIT 50",
    now() - 120000,
  );
  for (const m of stale)
    await env.DB.batch([
      statement(
        env.DB,
        "UPDATE messages SET state='unknown',reason='The sender stopped before saving confirmation. Check the provider before resending.' WHERE id=? AND state='submitting'",
        m.id,
      ),
      statement(
        env.DB,
        "UPDATE campaigns SET state='paused',reason='A submission needs checking.' WHERE center_id=? AND id=? AND state!='cancelled'",
        m.center_id,
        m.campaign_id,
      ),
      statement(env.DB, 'DELETE FROM jobs WHERE id=?', m.campaign_id),
    ]);
  await dispatch(env);
  const checks = await rows<{ id: string }>(
    env.DB,
    "SELECT id FROM messages WHERE state='accepted' AND next_check_at<=? ORDER BY next_check_at LIMIT 20",
    now(),
  );
  for (const message of checks) await checkMessage(env, message.id);
}
