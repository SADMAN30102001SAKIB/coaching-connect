import { Hono } from 'hono';
import { z } from 'zod';
import { nameSchema, passwordSchema, phoneSchema, type User } from '@coaching/domain';
import { now, one, rows, statement, uid } from './db';
import { assert } from './errors';
import {
  digest,
  hashPassword,
  logout,
  newSession,
  secret,
  throttle,
  userFrom,
  verifyPassword,
  type AppEnv,
} from './security';

export const auth = new Hono<AppEnv>();
const credentials = z.object({ phone: phoneSchema, password: z.string().min(1).max(128) });
async function recovery(
  db: D1Database,
  user: string,
): Promise<{ codes: string[]; statements: D1PreparedStatement[] }> {
  const codes = Array.from({ length: 8 }, () => secret().slice(0, 24));
  return {
    codes,
    statements: await Promise.all(
      codes.map(async (code) =>
        statement(
          db,
          'INSERT INTO recovery_codes(hash,user_id) VALUES(?,?)',
          await digest(code),
          user,
        ),
      ),
    ),
  };
}
auth.post('/auth/bootstrap', async (c) => {
  await throttle(c.env.DB, `bootstrap:${c.req.header('cf-connecting-ip') ?? 'local'}`, 5, 900);
  const input = z
    .object({
      token: z.string().min(32).max(256),
      name: nameSchema,
      phone: phoneSchema,
      password: passwordSchema,
    })
    .parse(await c.req.json());
  assert(
    c.env.BOOTSTRAP_TOKEN && (await digest(input.token)) === (await digest(c.env.BOOTSTRAP_TOKEN)),
    'BOOTSTRAP_DENIED',
    'The setup key is incorrect or platform setup is unavailable.',
    403,
  );
  assert(
    !(await one(c.env.DB, 'SELECT id FROM users WHERE platform=1')),
    'ALREADY_CONFIGURED',
    'The platform owner has already been created.',
    409,
  );
  const id = uid();
  const hash = await hashPassword(input.password);
  const codes = await recovery(c.env.DB, id);
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO users VALUES(?,?,?,?,1,?)',
      id,
      input.name,
      input.phone,
      hash,
      now(),
    ),
    ...codes.statements,
  ]);
  await newSession(c, id);
  return c.json({ recovery_codes: codes.codes }, 201);
});
auth.post('/auth/login', async (c) => {
  const input = credentials.parse(await c.req.json());
  await throttle(c.env.DB, `login-ip:${c.req.header('cf-connecting-ip') ?? 'local'}`, 30, 900);
  await throttle(c.env.DB, `login-phone:${await digest(input.phone)}`, 10, 900);
  const user = await one<User & { password: string | null }>(
    c.env.DB,
    'SELECT * FROM users WHERE phone=?',
    input.phone,
  );
  const valid = await verifyPassword(input.password, user?.password ?? null);
  assert(valid && user, 'LOGIN_FAILED', 'The phone number or password is incorrect.', 401);
  await newSession(c, user.id);
  return c.json({ ok: true });
});
auth.post('/auth/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});
auth.get('/auth/session', async (c) => {
  const user = await userFrom(c);
  const centers = await rows(
    c.env.DB,
    'SELECT c.* FROM centers c JOIN memberships m ON m.center_id=c.id WHERE m.user_id=? AND m.active=1 AND c.active=1 ORDER BY c.name',
    user.id,
  );
  return c.json({ user, centers });
});
auth.get('/auth/invitation', async (c) => {
  const token = z.string().length(64).parse(c.req.query('token'));
  const invitation = await one<{ name: string; existing: number }>(
    c.env.DB,
    "SELECT COALESCE(c.name,'Your account') AS name, u.password IS NOT NULL AS existing FROM invitations i JOIN users u ON u.id=i.user_id LEFT JOIN centers c ON c.id=i.center_id WHERE i.hash=? AND i.expires_at>?",
    await digest(token),
    now(),
  );
  assert(
    invitation,
    'INVITATION_EXPIRED',
    'This setup link has expired or was already used. Ask the admin for a new link.',
    404,
  );
  return c.json(invitation);
});
auth.post('/auth/activate', async (c) => {
  const input = z
    .object({ token: z.string().length(64), name: nameSchema, password: passwordSchema.optional() })
    .parse(await c.req.json());
  const tokenHash = await digest(input.token);
  const invitation = await one<{
    user_id: string;
    center_id: string;
    password: string | null;
    role_ids: string;
  }>(
    c.env.DB,
    'SELECT i.*,u.password FROM invitations i JOIN users u ON u.id=i.user_id JOIN centers c ON c.id=i.center_id JOIN users author ON author.id=i.created_by WHERE i.hash=? AND i.expires_at>? AND c.active=1 AND (c.owner_id=i.created_by OR author.platform=1)',
    tokenHash,
    now(),
  );
  assert(
    invitation,
    'INVITATION_EXPIRED',
    'This setup link has expired or is no longer authorized.',
    409,
  );
  if (invitation.password) {
    const user = await userFrom(c);
    assert(
      user.id === invitation.user_id,
      'INVITATION_ACCOUNT',
      'Sign in with the account this invitation was created for.',
      403,
    );
  }
  const codes = invitation.password
    ? { codes: [], statements: [] }
    : await recovery(c.env.DB, invitation.user_id);
  const hash = invitation.password
    ? null
    : await hashPassword(passwordSchema.parse(input.password));
  const condition = 'EXISTS(SELECT 1 FROM invitations WHERE hash=? AND expires_at>?)';
  const batch = [
    statement(
      c.env.DB,
      'INSERT INTO auth_claims(hash,created_at,new_identity) VALUES(?,?,?)',
      tokenHash,
      now(),
      Number(!invitation.password),
    ),
    statement(
      c.env.DB,
      `INSERT INTO memberships(center_id,user_id) SELECT ?,? WHERE ${condition} ON CONFLICT(center_id,user_id) DO UPDATE SET active=1`,
      invitation.center_id,
      invitation.user_id,
      tokenHash,
      now(),
    ),
    ...z
      .array(z.string())
      .parse(JSON.parse(invitation.role_ids))
      .map((role) =>
        statement(
          c.env.DB,
          `INSERT OR IGNORE INTO member_roles SELECT ?,?,? WHERE ${condition}`,
          invitation.center_id,
          invitation.user_id,
          role,
          tokenHash,
          now(),
        ),
      ),
  ];
  if (hash)
    batch.push(
      statement(
        c.env.DB,
        `UPDATE users SET password=?,name=? WHERE id=? AND password IS NULL AND ${condition}`,
        hash,
        input.name,
        invitation.user_id,
        tokenHash,
        now(),
      ),
      ...codes.statements,
    );
  batch.push(
    statement(c.env.DB, 'DELETE FROM invitations WHERE hash=? AND expires_at>?', tokenHash, now()),
  );
  const result = await c.env.DB.batch(batch);
  assert(result[1]?.meta.changes, 'INVITATION_EXPIRED', 'This setup link was already used.', 409);
  await newSession(c, invitation.user_id);
  return c.json({ recovery_codes: codes.codes });
});
auth.post('/auth/recover', async (c) => {
  const input = z
    .object({ phone: phoneSchema, code: z.string().min(16).max(128), password: passwordSchema })
    .parse(await c.req.json());
  await throttle(c.env.DB, `recover:${c.req.header('cf-connecting-ip') ?? 'local'}`, 5, 900);
  const codeHash = await digest(input.code.replaceAll('-', '').trim());
  const user = await one<{ id: string }>(
    c.env.DB,
    'SELECT u.id FROM users u JOIN recovery_codes r ON r.user_id=u.id WHERE u.phone=? AND r.hash=? AND (r.expires_at IS NULL OR r.expires_at>?)',
    input.phone,
    codeHash,
    now(),
  );
  assert(
    user,
    'RECOVERY_FAILED',
    'The phone number or recovery code is incorrect or the code was already used.',
    401,
  );
  const hash = await hashPassword(input.password);
  const result = await c.env.DB.batch([
    statement(c.env.DB, 'INSERT INTO auth_claims(hash,created_at) VALUES(?,?)', codeHash, now()),
    statement(
      c.env.DB,
      'UPDATE users SET password=? WHERE id=? AND EXISTS(SELECT 1 FROM recovery_codes WHERE hash=? AND user_id=?)',
      hash,
      user.id,
      codeHash,
      user.id,
    ),
    statement(
      c.env.DB,
      'DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM recovery_codes WHERE hash=? AND user_id=?)',
      user.id,
      codeHash,
      user.id,
    ),
    statement(c.env.DB, 'DELETE FROM recovery_codes WHERE hash=? AND user_id=?', codeHash, user.id),
  ]);
  assert(result[1]?.meta.changes, 'RECOVERY_USED', 'This recovery code was already used.', 409);
  return c.json({ ok: true });
});
auth.post('/auth/security', async (c) => {
  const user = await userFrom(c);
  const input = z
    .object({ current: z.string().max(128), password: passwordSchema.optional() })
    .parse(await c.req.json());
  await throttle(c.env.DB, `security:${user.id}`, 5, 900);
  const stored = await one<{ password: string }>(
    c.env.DB,
    'SELECT password FROM users WHERE id=?',
    user.id,
  );
  assert(
    await verifyPassword(input.current, stored?.password ?? null),
    'PASSWORD_INCORRECT',
    'Your current password is incorrect.',
    401,
  );
  const codes = await recovery(c.env.DB, user.id);
  const batch = [
    statement(c.env.DB, 'DELETE FROM recovery_codes WHERE user_id=?', user.id),
    ...codes.statements,
    statement(c.env.DB, 'DELETE FROM sessions WHERE user_id=?', user.id),
  ];
  if (input.password)
    batch.push(
      statement(
        c.env.DB,
        'UPDATE users SET password=? WHERE id=?',
        await hashPassword(input.password),
        user.id,
      ),
    );
  await c.env.DB.batch(batch);
  await newSession(c, user.id);
  return c.json({ recovery_codes: codes.codes });
});

export async function invite(
  db: D1Database,
  center: string,
  creator: string,
  phone: string,
  name: string,
  roles: string[],
): Promise<string> {
  let user = await one<{ id: string }>(db, 'SELECT id FROM users WHERE phone=?', phone);
  if (!user) {
    const id = uid();
    await statement(
      db,
      'INSERT INTO users(id,name,phone,created_at) VALUES(?,?,?,?) ON CONFLICT(phone) DO NOTHING',
      id,
      name,
      phone,
      now(),
    ).run();
    user = await one<{ id: string }>(db, 'SELECT id FROM users WHERE phone=?', phone);
  }
  assert(user, 'ACCOUNT_SETUP_FAILED', 'Could not create this account. Please retry.', 503);
  const token = secret();
  await statement(
    db,
    'INSERT INTO invitations VALUES(?,?,?,?,?,?)',
    await digest(token),
    center,
    user.id,
    creator,
    now() + 86400000,
    JSON.stringify(roles),
  ).run();
  return token;
}
