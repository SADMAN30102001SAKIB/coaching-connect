import { z } from 'zod';
import { AppError, assert } from './errors';
import type { Bindings } from './security';
import { now, one, statement } from './db';

export interface ProviderConfig {
  id: string;
  center_id: string;
  api_key: string;
  sender_ids: string;
  batch_size: number;
  interval_seconds: number;
}
export type Submission =
  | { state: 'accepted'; id: string }
  | { state: 'failed' | 'unknown' | 'low_balance'; reason: string };
const base = 'https://sms.ocs-api.top/api/';
const object = z.record(z.string(), z.unknown());
function scalar(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}
export const senderSchema = z
  .array(
    z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[a-zA-Z0-9+ -]+$/),
  )
  .min(1)
  .max(10);
export async function providerJson(
  path: 'get-balance' | 'send-bulk-sms' | 'sms-check',
  config: ProviderConfig,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(path, base);
  if (path === 'get-balance') url.searchParams.set('api_key', config.api_key);
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify({ api_key: config.api_key, ...body }) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const reader = response.body?.getReader();
    assert(reader, 'PROVIDER_RESPONSE', 'The SMS provider returned an empty response.', 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        throw new AppError(
          'PROVIDER_RESPONSE',
          'The SMS provider returned an unexpectedly large response.',
          502,
        );
      }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    assert(
      response.ok,
      'PROVIDER_UNAVAILABLE',
      'The SMS provider could not complete this request. Check again later.',
      502,
    );
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'The SMS provider did not return a usable response. A sending request may still have been accepted.',
      502,
    );
  }
}
export async function configFor(
  db: D1Database,
  center: string,
  id?: string,
): Promise<ProviderConfig | null> {
  return id
    ? one(db, 'SELECT * FROM provider_configs WHERE center_id=? AND id=?', center, id)
    : one(db, 'SELECT * FROM provider_configs WHERE center_id=? AND active=1', center);
}
export function parseSubmissions(raw: unknown, recipients: { phone: string }[]): Submission[] {
  const parsed = object.safeParse(raw);
  if (!parsed.success)
    return recipients.map(() => ({
      state: 'unknown',
      reason: 'The provider response format was not recognized.',
    }));
  const data = parsed.data;
  const code = scalar(data['ErrorCode'] ?? data['error_code'] ?? data['code']);
  if (code === '1007')
    return recipients.map(() => ({
      state: 'low_balance',
      reason: 'The provider reported insufficient balance.',
    }));
  const content = data['Data'] ?? data['data'];
  const entries = Array.isArray(content)
    ? z.array(object).safeParse(content)
    : object.safeParse(content);
  const items = entries.success
    ? Array.isArray(entries.data)
      ? entries.data
      : [entries.data]
    : [];
  return recipients.map((recipient) => {
    const item =
      items.find((x) => scalar(x['MobileNumber'] ?? x['Number']) === recipient.phone) ??
      (recipients.length === 1 &&
      items.length === 1 &&
      !scalar(items[0]?.['MobileNumber'] ?? items[0]?.['Number'])
        ? items[0]
        : undefined);
    const id = item?.['MessageId'];
    const itemCode = scalar(item?.['ErrorCode'] ?? code);
    if (
      typeof id === 'string' &&
      id.length >= 8 &&
      id.length <= 200 &&
      ['0', '000', '202'].includes(itemCode)
    )
      return { state: 'accepted', id };
    return {
      state: 'unknown',
      reason:
        'Acceptance could not be matched to a provider message ID. Check the provider dashboard before resending.',
    };
  });
}
export async function submit(
  env: Bindings,
  config: ProviderConfig,
  recipients: { phone: string; body: string }[],
): Promise<Submission[]> {
  if (env.SMS_MODE === 'mock')
    return recipients.map(() => ({ state: 'accepted', id: `mock-${crypto.randomUUID()}` }));
  assert(
    env.SMS_MODE === 'live',
    'SMS_DISABLED',
    'Live sending is disabled in this environment.',
    503,
  );
  const senders = senderSchema.parse(JSON.parse(config.sender_ids));
  const sender = senders[Number.parseInt(crypto.randomUUID().slice(-8), 16) % senders.length];
  try {
    return parseSubmissions(
      await providerJson('send-bulk-sms', config, {
        senderid: sender,
        MessageParameters: recipients.map((r) => ({ Number: r.phone, Text: r.body })),
      }),
      recipients,
    );
  } catch {
    return recipients.map(() => ({
      state: 'unknown',
      reason:
        'No reliable acknowledgement was received. Do not resend without checking the provider.',
    }));
  }
}
export async function balance(env: Bindings, config: ProviderConfig, force = false) {
  const cached = await one<{
    balance: string | null;
    estimate_sms: number | null;
    checked_at: number | null;
  }>(
    env.DB,
    'SELECT balance,estimate_sms,checked_at FROM balances WHERE center_id=? AND config_id=?',
    config.center_id,
    config.id,
  );
  if (!force || (cached?.checked_at && now() - cached.checked_at < 60000))
    return cached ?? { balance: null, estimate_sms: null, checked_at: null };
  assert(
    env.SMS_MODE !== 'disabled',
    'SMS_DISABLED',
    'Provider access is disabled in this environment.',
    503,
  );
  const claim = await statement(
    env.DB,
    'INSERT INTO balances(center_id,config_id,refreshing_until) VALUES(?,?,?) ON CONFLICT(center_id,config_id) DO UPDATE SET refreshing_until=excluded.refreshing_until WHERE refreshing_until<?',
    config.center_id,
    config.id,
    now() + 20000,
    now(),
  ).run();
  if (!claim.meta.changes) return cached ?? { balance: null, estimate_sms: null, checked_at: null };
  const raw =
    env.SMS_MODE === 'mock'
      ? { balance: '1000.00', estimate_sms: 1500 }
      : await providerJson('get-balance', config);
  const input = z
    .object({
      balance: z.string().regex(/^\d+(?:\.\d+)?$/),
      estimate_sms: z.coerce.number().int().nonnegative(),
    })
    .safeParse(raw);
  assert(
    input.success,
    'BALANCE_UNAVAILABLE',
    'The provider did not return a usable balance. Check your SMS account settings and refresh again after a minute.',
    502,
  );
  const value = { ...input.data, checked_at: now() };
  await statement(
    env.DB,
    'UPDATE balances SET balance=?,estimate_sms=?,checked_at=?,refreshing_until=0 WHERE center_id=? AND config_id=?',
    value.balance,
    value.estimate_sms,
    value.checked_at,
    config.center_id,
    config.id,
  ).run();
  return value;
}
export async function delivery(
  env: Bindings,
  config: ProviderConfig,
  id: string,
): Promise<'delivered' | 'failed' | 'accepted'> {
  if (id.startsWith('mock-')) return 'delivered';
  assert(env.SMS_MODE === 'live', 'SMS_DISABLED', 'Provider access is disabled.', 503);
  const data = z
    .object({
      ErrorCode: z.union([z.string(), z.number()]),
      Data: z.object({ MessageId: z.string(), Status: z.string() }),
    })
    .parse(await providerJson('sms-check', config, { MessageId: id }));
  assert(
    String(data.ErrorCode) === '0' && data.Data.MessageId === id,
    'STATUS_UNAVAILABLE',
    'Delivery status is not available yet.',
    502,
  );
  const status = data.Data.Status.split('-').at(-1)?.trim().toLowerCase();
  return status === 'delivered'
    ? 'delivered'
    : status === 'failed' || status === 'undelivered' || status === 'rejected'
      ? 'failed'
      : 'accepted';
}
