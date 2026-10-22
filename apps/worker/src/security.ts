import { scrypt, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context as HonoContext } from 'hono';
import type { Center, User } from '@coaching/domain';
import { permissions } from '@coaching/domain';
import { assert } from './errors';
import { now, one, rows, statement } from './db';

export interface Bindings extends Omit<Env, 'SMS_MODE' | 'DISPATCH_ENABLED' | 'BOOTSTRAP_TOKEN'> {
  SMS_MODE: 'disabled' | 'mock' | 'live';
  DISPATCH_ENABLED: string;
  BOOTSTRAP_TOKEN?: string;
}
export interface AuthContext {
  user: User;
  center: Center;
  grants: string[];
  admin: boolean;
}
export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: User; access: AuthContext; requestId: string; authenticatedAt: number };
};
export type ApiContext = HonoContext<AppEnv>;
const cookieName = 'coaching_session';
export function secret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}
export async function digest(value: string): Promise<string> {
  return Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ).toString('hex');
}
function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      32,
      { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt);
  return `${Buffer.from(salt).toString('hex')}:${key.toString('hex')}`;
}
const dummy = `${'00'.repeat(16)}:${'00'.repeat(32)}`;
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [salt = '', expected = ''] = (stored ?? dummy).split(':');
  const key = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(key, Buffer.from(expected, 'hex')) && stored !== null;
}
export async function throttle(
  db: D1Database,
  key: string,
  maximum: number,
  seconds: number,
): Promise<void> {
  const result = await one<{ count: number }>(
    db,
    'INSERT INTO throttle(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count',
    key,
    now() + seconds * 1000,
    now(),
    now(),
  );
  assert(
    result && result.count <= maximum,
    'RATE_LIMITED',
    'Too many attempts. Please wait before trying again.',
    429,
  );
}
export async function userFrom(c: ApiContext): Promise<User> {
  const token = getCookie(c, cookieName);
  assert(token, 'SESSION_EXPIRED', 'Please sign in to continue.', 401);
  const user = await one<User & { authenticated_at: number }>(
    c.env.DB,
    'SELECT u.id,u.name,u.phone,u.platform,s.created_at AS authenticated_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?',
    await digest(token),
    now(),
  );
  assert(user, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
  c.set('authenticatedAt', user.authenticated_at);
  return user;
}
export function requireRecent(c: ApiContext): void {
  assert(
    now() - c.get('authenticatedAt') < 600000,
    'SIGN_IN_AGAIN',
    'For this sensitive change, sign out and sign in again, then retry.',
    401,
  );
}
export async function newSession(c: ApiContext, user: string): Promise<void> {
  const token = secret();
  await statement(
    c.env.DB,
    'INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES(?,?,?,?)',
    await digest(token),
    user,
    now() + 7 * 86400000,
    now(),
  ).run();
  setCookie(c, cookieName, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: 7 * 86400,
  });
}
export async function logout(c: ApiContext): Promise<void> {
  const token = getCookie(c, cookieName);
  if (token)
    await statement(c.env.DB, 'DELETE FROM sessions WHERE token=?', await digest(token)).run();
  setCookie(c, cookieName, '', {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: 0,
  });
}
export async function accessFor(
  db: D1Database,
  user: User,
  centerId: string,
): Promise<AuthContext> {
  const center = await one<Center>(
    db,
    'SELECT c.* FROM centers c JOIN memberships m ON m.center_id=c.id AND m.user_id=? AND m.active=1 WHERE c.id=? AND c.active=1',
    user.id,
    centerId,
  );
  assert(
    center,
    'CENTER_UNAVAILABLE',
    'This coaching center is unavailable or you no longer have access.',
    403,
  );
  const admin = center.owner_id === user.id;
  const grants = admin
    ? [...permissions]
    : (
        await rows<{ permission: string }>(
          db,
          'SELECT DISTINCT j.value AS permission FROM member_roles mr JOIN roles r ON r.id=mr.role_id AND r.center_id=mr.center_id AND r.active=1 JOIN json_each(r.permissions) j WHERE mr.center_id=? AND mr.user_id=?',
          centerId,
          user.id,
        )
      ).map((v) => v.permission);
  return { user, center, grants, admin };
}
export function requirePermission(c: ApiContext, permission: string): AuthContext {
  const access = c.get('access');
  assert(
    access.grants.includes(permission),
    'PERMISSION_DENIED',
    'Your role does not allow this action. Ask your center admin.',
    403,
  );
  return access;
}
export function requireAdmin(c: ApiContext): AuthContext {
  const access = c.get('access');
  assert(access.admin, 'ADMIN_REQUIRED', 'Only your center admin can do this.', 403);
  return access;
}
