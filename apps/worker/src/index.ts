import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { localeSchema, nameSchema, phoneSchema } from '@coaching/domain';
import { auth, invite } from './auth';
import { campaigns, dispatch, processJob, scheduled } from './campaigns';
import { now, one, rows, statement, uid } from './db';
import { AppError, assert } from './errors';
import { exams } from './exams';
import { balance, configFor, senderSchema } from './provider';
import { records } from './records';
import {
  accessFor,
  digest,
  requireAdmin,
  requirePermission,
  requireRecent,
  throttle,
  userFrom,
  type AppEnv,
  type Bindings,
} from './security';

export const app = new Hono<AppEnv>();
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
  }),
);
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 65536,
    onError: (c) =>
      c.json(
        {
          error: {
            code: 'REQUEST_TOO_LARGE',
            message: 'Save a smaller batch of records at a time.',
          },
        },
        413,
      ),
  }),
);
app.use('/api/*', async (c, next) => {
  c.set('requestId', uid());
  c.header('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    assert(
      !origin || origin === new URL(c.req.url).origin,
      'ORIGIN_DENIED',
      'This request came from an untrusted page.',
      403,
    );
    assert(
      c.req.header('Sec-Fetch-Site') !== 'cross-site',
      'ORIGIN_DENIED',
      'This request came from another website.',
      403,
    );
    assert(
      c.req.header('Content-Type')?.startsWith('application/json'),
      'JSON_REQUIRED',
      'Send this request as JSON.',
      422,
    );
  }
  await next();
});
app.route('/api', auth);
const platformAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await userFrom(c);
  assert(
    user.platform,
    'PLATFORM_REQUIRED',
    'Only the platform owner can manage coaching centers.',
    403,
  );
  c.set('user', user);
  await next();
};
app.use('/api/platform/*', platformAccess);
app.get('/api/platform/centers', async (c) => {
  const items = await rows<{ id: string }>(
    c.env.DB,
    'SELECT c.*,u.phone AS owner_phone,u.name AS owner_name FROM centers c JOIN users u ON u.id=c.owner_id WHERE c.id>? ORDER BY c.id LIMIT 51',
    c.req.query('cursor') ?? '',
  );
  const more = items.length > 50;
  if (more) items.pop();
  return c.json({ items, next: more ? items.at(-1)?.id : null });
});
app.post('/api/platform/centers', async (c) => {
  const input = z
    .object({
      name: nameSchema,
      admin_name: nameSchema,
      phone: phoneSchema,
      timezone: z.string().max(80).default('Asia/Dhaka'),
    })
    .parse(await c.req.json());
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone });
  } catch {
    throw new AppError('TIMEZONE_INVALID', 'Choose a valid timezone.', 422);
  }
  let owner = await one<{ id: string }>(
    c.env.DB,
    'SELECT id FROM users WHERE phone=?',
    input.phone,
  );
  if (!owner) {
    const id = uid();
    await statement(
      c.env.DB,
      'INSERT INTO users(id,name,phone,created_at) VALUES(?,?,?,?)',
      id,
      input.admin_name,
      input.phone,
      now(),
    ).run();
    owner = { id };
  }
  const id = uid();
  await statement(
    c.env.DB,
    'INSERT INTO centers(id,name,owner_id,timezone) VALUES(?,?,?,?)',
    id,
    input.name,
    owner.id,
    input.timezone,
  ).run();
  const token = await invite(c.env.DB, id, c.get('user').id, input.phone, input.admin_name, []);
  return c.json({ id, token }, 201);
});
app.patch('/api/platform/centers/:id', async (c) => {
  const input = z.object({ active: z.boolean() }).parse(await c.req.json());
  await statement(
    c.env.DB,
    'UPDATE centers SET active=? WHERE id=?',
    Number(input.active),
    c.req.param('id'),
  ).run();
  return c.json({ ok: true });
});
app.post('/api/platform/recovery', async (c) => {
  requireRecent(c);
  const input = z
    .object({
      phone: phoneSchema,
      evidence: z.string().trim().min(20).max(300),
      confirmed: z.literal(true),
    })
    .parse(await c.req.json());
  const user = await one<{ id: string }>(
    c.env.DB,
    'SELECT id FROM users WHERE phone=?',
    input.phone,
  );
  assert(
    user && user.id !== c.get('user').id,
    'RECOVERY_UNAVAILABLE',
    'Use recovery codes for the platform owner. Check the requested staff account.',
    422,
  );
  const code = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  await statement(
    c.env.DB,
    'INSERT INTO recovery_codes(hash,user_id,expires_at) VALUES(?,?,?)',
    await digest(code),
    user.id,
    now() + 3600000,
  ).run();
  return c.json({ recovery_code: code });
});
const centerAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await userFrom(c);
  c.set('user', user);
  c.set('access', await accessFor(c.env.DB, user, z.uuid().parse(c.req.param('center'))));
  await next();
};
app.use('/api/c/:center/*', centerAccess);
const centerApi = new Hono<AppEnv>();
centerApi.get('/context', (c) => {
  const a = c.get('access');
  return c.json({ center: a.center, permissions: a.grants, admin: a.admin });
});
centerApi.get('/home', async (c) => {
  const a = c.get('access');
  const campaigns = a.grants.includes('messages.read')
    ? await rows(
        c.env.DB,
        "SELECT id,name,state,total,submitted,delivered,failed,unknown,created_at,scheduled_at FROM campaigns WHERE center_id=? AND state!='purging' ORDER BY created_at DESC LIMIT 5",
        a.center.id,
      )
    : [];
  return c.json({
    students: a.grants.includes('students.read') ? a.center.students_count : null,
    groups: a.grants.includes('groups.read') ? a.center.groups_count : null,
    exams: a.grants.includes('exams.read') ? a.center.exams_count : null,
    campaigns,
  });
});
centerApi.patch('/settings', async (c) => {
  const a = requireAdmin(c);
  const input = z
    .object({
      name: nameSchema,
      timezone: z.string().max(80),
      locale: localeSchema,
      late_minutes: z.number().int().min(1).max(1440),
    })
    .parse(await c.req.json());
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone });
  } catch {
    throw new AppError('TIMEZONE_INVALID', 'Choose a valid timezone.', 422);
  }
  await statement(
    c.env.DB,
    'UPDATE centers SET name=?,timezone=?,locale=?,late_minutes=?,revision=revision+1 WHERE id=?',
    input.name,
    input.timezone,
    input.locale,
    input.late_minutes,
    a.center.id,
  ).run();
  return c.json({ ok: true });
});
centerApi.get('/provider', async (c) => {
  const a = requirePermission(c, 'provider.manage');
  const config = await configFor(c.env.DB, a.center.id);
  return c.json({
    configured: Boolean(config),
    suffix: config?.api_key.slice(-4) ?? '',
    sender_ids: config ? senderSchema.parse(JSON.parse(config.sender_ids)) : [],
    batch_size: config?.batch_size ?? 1,
    interval_seconds: config?.interval_seconds ?? 2,
    revision: config?.id ?? '',
    mode: c.env.SMS_MODE,
  });
});
centerApi.put('/provider', async (c) => {
  const a = requirePermission(c, 'provider.manage');
  requireRecent(c);
  const input = z
    .object({
      api_key: z.string().trim().min(8).max(512),
      sender_ids: senderSchema,
      batch_size: z.number().int().min(1).max(100),
      interval_seconds: z.number().int().min(1).max(300),
    })
    .parse(await c.req.json());
  const current = await configFor(c.env.DB, a.center.id);
  const senders = JSON.stringify(input.sender_ids);
  if (
    current?.api_key === input.api_key &&
    current.sender_ids === senders &&
    current.batch_size === input.batch_size &&
    current.interval_seconds === input.interval_seconds
  )
    return c.json({ ok: true });
  const configId = uid();
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'UPDATE provider_configs SET active=0 WHERE center_id=? AND active=1 AND NOT(api_key=? AND sender_ids=? AND batch_size=? AND interval_seconds=?)',
      a.center.id,
      input.api_key,
      senders,
      input.batch_size,
      input.interval_seconds,
    ),
    statement(
      c.env.DB,
      'INSERT INTO provider_configs(id,center_id,api_key,sender_ids,batch_size,interval_seconds,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM provider_configs WHERE center_id=? AND active=1)',
      configId,
      a.center.id,
      input.api_key,
      senders,
      input.batch_size,
      input.interval_seconds,
      now(),
      a.center.id,
    ),
    statement(
      c.env.DB,
      "UPDATE campaigns SET state='needs_review',reason='SMS credentials changed. Prepare a new preview.' WHERE center_id=? AND state IN ('queued','scheduled','paused','ready_for_review') AND EXISTS(SELECT 1 FROM provider_configs WHERE id=?)",
      a.center.id,
      configId,
    ),
  ]);
  return c.json({ ok: true });
});
centerApi.get('/balance', async (c) => {
  const a = requirePermission(c, 'balance.read');
  const config = await configFor(c.env.DB, a.center.id);
  return c.json(
    config ? await balance(c.env, config) : { balance: null, estimate_sms: null, checked_at: null },
  );
});
centerApi.post('/balance/refresh', async (c) => {
  const a = requirePermission(c, 'balance.refresh');
  await throttle(c.env.DB, `balance:${a.center.id}`, 5, 300);
  const config = await configFor(c.env.DB, a.center.id);
  assert(config, 'PROVIDER_REQUIRED', 'Add your SMS API account in Settings first.', 422);
  return c.json(await balance(c.env, config, true));
});
centerApi.route('/', records);
centerApi.route('/exams', exams);
centerApi.route('/campaigns', campaigns);
app.route('/api/c/:center', centerApi);
app.all('/api/*', () => {
  throw new AppError('NOT_FOUND', 'This API endpoint does not exist.', 404);
});
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  const requestId = c.get('requestId');
  if (error instanceof AppError)
    return c.json({ error: { code: error.code, message: error.message, requestId } }, error.status);
  if (error instanceof z.ZodError)
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: error.issues
            .map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`)
            .join('; '),
          requestId,
        },
      },
      422,
    );
  if (error.message.includes('PREVIEW_CHANGED'))
    return c.json(
      {
        error: {
          code: 'PREVIEW_CHANGED',
          message: 'Source data changed. Prepare a fresh preview before sending.',
          requestId,
        },
      },
      409,
    );
  if (error.message.includes('IDENTITY_ALREADY_ACTIVATED'))
    return c.json(
      {
        error: {
          code: 'IDENTITY_ALREADY_ACTIVATED',
          message:
            'This account was activated in another window. Reload and sign in before accepting this invitation.',
          requestId,
        },
      },
      409,
    );
  if (error.message.includes('INVALID_AUTH_TOKEN'))
    return c.json(
      {
        error: {
          code: 'TOKEN_USED',
          message: 'This setup or recovery code expired or was already used.',
          requestId,
        },
      },
      409,
    );
  if (error.message.includes('RESULT_CONFLICT'))
    return c.json(
      {
        error: {
          code: 'RESULT_CONFLICT',
          message: 'Another teacher saved these marks. Reload before making changes.',
          requestId,
        },
      },
      409,
    );
  if (error.message.includes('MARK_EXCEEDS_MAX'))
    return c.json(
      {
        error: {
          code: 'MARK_EXCEEDS_MAX',
          message: 'The maximum cannot be lower than an existing score.',
          requestId,
        },
      },
      422,
    );
  if (error.message.includes('UNIQUE constraint'))
    return c.json(
      {
        error: {
          code: 'DUPLICATE_RECORD',
          message: 'This record already exists. Refresh and use the existing record.',
          requestId,
        },
      },
      409,
    );
  if (error.message.includes('FOREIGN KEY') || error.message.includes('INVALID_PARTICIPANT'))
    return c.json(
      {
        error: {
          code: 'INVALID_REFERENCE',
          message: 'A selected record is unavailable or does not belong to this center.',
          requestId,
        },
      },
      422,
    );
  console.error(JSON.stringify({ event: 'request.failed', requestId }));
  return c.json(
    {
      error: {
        code: 'REQUEST_FAILED',
        message:
          'This operation could not finish. Your screen may be out of date; reload before retrying. Use the reference ID if you contact support.',
        requestId,
      },
    },
    503,
  );
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, env: Bindings) {
    if (env.DISPATCH_ENABLED !== 'true') {
      batch.retryAll({ delaySeconds: 120 });
      return;
    }
    for (const message of batch.messages) {
      const parsed = z.object({ id: z.uuid() }).safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        continue;
      }
      try {
        await processJob(env, parsed.data.id);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 120 });
      }
    }
    await dispatch(env);
  },
  async scheduled(_controller: ScheduledController, env: Bindings) {
    await scheduled(env);
  },
} satisfies ExportedHandler<Bindings>;
