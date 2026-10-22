import { Hono } from 'hono';
import { z } from 'zod';
import {
  nameSchema,
  phoneSchema,
  permissionSchema,
  templateScope,
  renderTemplate,
  variables,
  type Student,
} from '@coaching/domain';
import { audit, now, one, rows, statement, uid } from './db';
import { assert } from './errors';
import { invite } from './auth';
import {
  requireAdmin,
  requirePermission,
  requireRecent,
  type ApiContext,
  type AppEnv,
} from './security';

export const records = new Hono<AppEnv>();
const version = z.number().int().positive();
const idList = z
  .array(z.uuid())
  .max(50)
  .transform((ids) => [...new Set(ids)]);
const catalogSchema = z.object({
  name: nameSchema,
  kind: z.enum(['class', 'session', 'subject', 'group', 'series']),
  class_id: z.string().nullable().default(null),
  session_id: z.string().nullable().default(null),
});
const templateSchema = z
  .object({
    name: nameSchema,
    scope: templateScope,
    body: z.string().trim().min(1).max(4000),
  })
  .superRefine((value, ctx) => {
    try {
      renderTemplate(
        value.body,
        value.scope,
        Object.fromEntries(variables.map((key) => [key, 'example'])),
      );
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: error instanceof Error ? error.message : 'Check the message variables.',
      });
    }
  });

async function namedPage(c: ApiContext, sql: string, args: unknown[]) {
  const q = (c.req.query('q') ?? '').trim().slice(0, 160);
  const cursor = c.req.query('cursor');
  const after = cursor
    ? z.tuple([z.string().max(160), z.uuid()]).parse(JSON.parse(cursor))
    : ['', ''];
  const items = await rows<{ id: string; name: string }>(
    c.env.DB,
    `${sql} AND name>=? AND name<? AND (name>? OR (name=? AND id>?)) ORDER BY name,id LIMIT 51`,
    ...args,
    q,
    `${q}\uffff`,
    after[0],
    after[0],
    after[1],
  );
  const more = items.length > 50;
  if (more) items.pop();
  const last = items.at(-1);
  return c.json({ items, next: more && last ? JSON.stringify([last.name, last.id]) : null });
}
async function checkCatalogLinks(
  c: ApiContext,
  center: string,
  kind: string,
  classId: string | null,
  sessionId: string | null,
  current?: { class_id: string | null; session_id: string | null },
) {
  assert(
    kind === 'group' || (!classId && !sessionId),
    'INVALID_REFERENCE',
    'Only a batch can be linked to a class or session.',
    422,
  );
  const ids = [classId, sessionId].filter((id) => id !== null);
  if (!ids.length) return;
  const matches = await rows<{ id: string; kind: string; active: number }>(
    c.env.DB,
    'SELECT id,kind,active FROM catalog WHERE center_id=? AND id IN (SELECT value FROM json_each(?))',
    center,
    JSON.stringify(ids),
  );
  assert(
    (!classId ||
      matches.some(
        (r) => r.id === classId && r.kind === 'class' && (r.active || current?.class_id === r.id),
      )) &&
      (!sessionId ||
        matches.some(
          (r) =>
            r.id === sessionId &&
            r.kind === 'session' &&
            (r.active || current?.session_id === r.id),
        )),
    'INVALID_REFERENCE',
    'Choose an active class and session from this center.',
    422,
  );
}
async function changed(c: ApiContext, result: D1Result, resource: string, id: string) {
  assert(
    result.meta.changes,
    'EDIT_CONFLICT',
    'This record changed or is unavailable. Reload it before saving again.',
    409,
  );
  await audit(c.env.DB, c.get('access').center.id, c.get('user').id, resource, id).run();
  return c.json({ id });
}
records.get('/catalog', (c) => {
  const kind = catalogSchema.shape.kind.parse(c.req.query('kind'));
  requirePermission(c, kind === 'group' ? 'groups.read' : 'academic.read');
  return namedPage(c, 'SELECT * FROM catalog WHERE center_id=? AND kind=? AND active=1', [
    c.get('access').center.id,
    kind,
  ]);
});
records.post('/catalog', async (c) => {
  const input = catalogSchema.parse(await c.req.json());
  const a = requirePermission(c, input.kind === 'group' ? 'groups.create' : 'academic.create');
  await checkCatalogLinks(c, a.center.id, input.kind, input.class_id, input.session_id);
  const id = uid();
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO catalog(id,center_id,kind,name,class_id,session_id) VALUES(?,?,?,?,?,?)',
      id,
      a.center.id,
      input.kind,
      input.name,
      input.class_id,
      input.session_id,
    ),
    audit(c.env.DB, a.center.id, a.user.id, 'catalog.create', id),
  ]);
  return c.json({ id }, 201);
});
records.patch('/catalog/:id', async (c) => {
  const input = z
    .object({
      name: nameSchema,
      version,
      active: z.number().int().min(0).max(1).default(1),
      class_id: z.uuid().nullable().default(null),
      session_id: z.uuid().nullable().default(null),
    })
    .parse(await c.req.json());
  const item = await one<{ kind: string; class_id: string | null; session_id: string | null }>(
    c.env.DB,
    'SELECT kind,class_id,session_id FROM catalog WHERE center_id=? AND id=?',
    c.get('access').center.id,
    c.req.param('id'),
  );
  assert(item, 'NOT_FOUND', 'This record is unavailable.', 404);
  const a = requirePermission(
    c,
    `${item.kind === 'group' ? 'groups' : 'academic'}.${input.active ? 'update' : 'archive'}`,
  );
  await checkCatalogLinks(c, a.center.id, item.kind, input.class_id, input.session_id, item);
  return changed(
    c,
    await statement(
      c.env.DB,
      'UPDATE catalog SET name=?,active=?,class_id=?,session_id=?,version=version+1 WHERE center_id=? AND id=? AND version=?',
      input.name,
      input.active,
      input.class_id,
      input.session_id,
      a.center.id,
      c.req.param('id'),
      input.version,
    ).run(),
    'catalog.update',
    c.req.param('id'),
  );
});
records.get('/students', (c) => {
  const a = requirePermission(c, 'students.read');
  return namedPage(c, 'SELECT * FROM students WHERE center_id=? AND active=1', [a.center.id]);
});
const studentSchema = z.object({
  name: nameSchema,
  identifier: z.string().trim().max(80).default(''),
  contacts: z
    .array(
      z.object({
        phone: phoneSchema,
        label: z.string().trim().max(160).default(''),
        audience: z.enum(['student', 'guardian']),
        permitted: z.boolean().default(true),
      }),
    )
    .max(10),
  group_ids: idList,
});
records.get('/students/:id', async (c) => {
  const a = requirePermission(c, 'students.read');
  const item = await one<Student>(
    c.env.DB,
    'SELECT * FROM students WHERE center_id=? AND id=?',
    a.center.id,
    c.req.param('id'),
  );
  assert(item, 'NOT_FOUND', 'This student is unavailable.', 404);
  const result = await c.env.DB.batch([
    statement(
      c.env.DB,
      'SELECT ct.id,ct.phone,ct.suppressed,sc.label,sc.audience,sc.permitted FROM student_contacts sc JOIN contacts ct ON ct.center_id=sc.center_id AND ct.id=sc.contact_id WHERE sc.center_id=? AND sc.student_id=?',
      a.center.id,
      item.id,
    ),
    statement(
      c.env.DB,
      'SELECT group_id FROM group_members WHERE center_id=? AND student_id=? AND left_at IS NULL',
      a.center.id,
      item.id,
    ),
  ]);
  return c.json({ ...item, contacts: result[0]?.results, groups: result[1]?.results });
});
records.patch('/contacts/:id/suppression', async (c) => {
  const a = requirePermission(c, 'students.update');
  const input = z
    .object({ suppressed: z.boolean(), expected: z.boolean() })
    .parse(await c.req.json());
  const result = await statement(
    c.env.DB,
    'UPDATE contacts SET suppressed=? WHERE center_id=? AND id=? AND suppressed=?',
    Number(input.suppressed),
    a.center.id,
    c.req.param('id'),
    Number(input.expected),
  ).run();
  return changed(
    c,
    result,
    input.suppressed ? 'contact.suppress' : 'contact.unsuppress',
    c.req.param('id'),
  );
});
async function saveStudent(c: ApiContext, editing: boolean) {
  const raw: unknown = await c.req.json();
  const input = studentSchema.parse(raw);
  const a = requirePermission(c, `students.${editing ? 'update' : 'create'}`);
  const id = editing ? z.string().parse(c.req.param('id')) : uid();
  const expected = editing ? z.object({ version }).parse(raw).version : 0;
  for (const group of input.group_ids)
    assert(
      await one(
        c.env.DB,
        "SELECT id FROM catalog WHERE center_id=? AND id=? AND kind='group' AND (active=1 OR EXISTS(SELECT 1 FROM group_members gm WHERE gm.center_id=catalog.center_id AND gm.group_id=catalog.id AND gm.student_id=? AND gm.left_at IS NULL))",
        a.center.id,
        group,
        id,
      ),
      'INVALID_GROUP',
      'Choose an active group from this center.',
      422,
    );
  const batch = [
    editing
      ? statement(
          c.env.DB,
          'UPDATE students SET name=?,identifier=?,version=? WHERE center_id=? AND id=?',
          input.name,
          input.identifier,
          expected + 1,
          a.center.id,
          id,
        )
      : statement(
          c.env.DB,
          'INSERT INTO students(id,center_id,name,identifier) VALUES(?,?,?,?)',
          id,
          a.center.id,
          input.name,
          input.identifier,
        ),
  ];
  if (editing) {
    const current = await one<Student>(
      c.env.DB,
      'SELECT * FROM students WHERE center_id=? AND id=? AND version=?',
      a.center.id,
      id,
      expected,
    );
    assert(current, 'EDIT_CONFLICT', 'Student details changed. Reload before saving.', 409);
    batch.push(
      statement(
        c.env.DB,
        'DELETE FROM student_contacts WHERE center_id=? AND student_id=?',
        a.center.id,
        id,
      ),
      statement(
        c.env.DB,
        'UPDATE group_members SET left_at=? WHERE center_id=? AND student_id=? AND left_at IS NULL AND group_id NOT IN (SELECT value FROM json_each(?))',
        now(),
        a.center.id,
        id,
        JSON.stringify(input.group_ids),
      ),
    );
  }
  for (const contact of input.contacts) {
    batch.push(
      statement(
        c.env.DB,
        'INSERT INTO contacts(id,center_id,phone) VALUES(?,?,?) ON CONFLICT(center_id,phone) DO NOTHING',
        uid(),
        a.center.id,
        contact.phone,
      ),
    );
    batch.push(
      statement(
        c.env.DB,
        'INSERT OR IGNORE INTO student_contacts SELECT ?,?,id,?,?,? FROM contacts WHERE center_id=? AND phone=?',
        a.center.id,
        id,
        contact.label,
        contact.audience,
        Number(contact.permitted),
        a.center.id,
        contact.phone,
      ),
    );
  }
  for (const group of input.group_ids)
    batch.push(
      statement(
        c.env.DB,
        'INSERT INTO group_members VALUES(?,?,?,?,NULL) ON CONFLICT(center_id,group_id,student_id) DO UPDATE SET left_at=NULL,joined_at=excluded.joined_at WHERE group_members.left_at IS NOT NULL',
        a.center.id,
        group,
        id,
        now(),
      ),
    );
  batch.push(audit(c.env.DB, a.center.id, a.user.id, 'students.save', id));
  await c.env.DB.batch(batch);
  return c.json({ id });
}
records.post('/students', (c) => saveStudent(c, false));
records.put('/students/:id', (c) => saveStudent(c, true));
records.delete('/students/:id', async (c) => {
  const a = requirePermission(c, 'students.archive');
  return changed(
    c,
    await statement(
      c.env.DB,
      'UPDATE students SET active=0,version=version+1 WHERE center_id=? AND id=? AND active=1',
      a.center.id,
      c.req.param('id'),
    ).run(),
    'students.archive',
    c.req.param('id'),
  );
});
records.get('/groups/:id/members', async (c) => {
  const a = requirePermission(c, 'groups.read');
  return namedPage(
    c,
    'SELECT s.* FROM students s WHERE s.center_id=? AND s.active=1 AND EXISTS(SELECT 1 FROM group_members gm WHERE gm.center_id=s.center_id AND gm.student_id=s.id AND gm.group_id=? AND gm.left_at IS NULL)',
    [a.center.id, c.req.param('id')],
  );
});
records.get('/templates', (c) => {
  const a = requirePermission(c, 'templates.read');
  return namedPage(c, 'SELECT * FROM templates WHERE center_id=? AND active=1', [a.center.id]);
});
records.post('/templates', async (c) => {
  const a = requirePermission(c, 'templates.create');
  const input = templateSchema.parse(await c.req.json());
  const id = uid();
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO templates(id,center_id,name,scope,body) VALUES(?,?,?,?,?)',
      id,
      a.center.id,
      input.name,
      input.scope,
      input.body,
    ),
    audit(c.env.DB, a.center.id, a.user.id, 'templates.create', id),
  ]);
  return c.json({ id }, 201);
});
records.patch('/templates/:id', async (c) => {
  const input = templateSchema
    .safeExtend({ version, active: z.number().int().min(0).max(1).default(1) })
    .parse(await c.req.json());
  const a = requirePermission(c, `templates.${input.active ? 'update' : 'archive'}`);
  return changed(
    c,
    await statement(
      c.env.DB,
      'UPDATE templates SET name=?,scope=?,body=?,active=?,version=version+1 WHERE center_id=? AND id=? AND version=?',
      input.name,
      input.scope,
      input.body,
      input.active,
      a.center.id,
      c.req.param('id'),
      input.version,
    ).run(),
    'templates.update',
    c.req.param('id'),
  );
});
records.get('/roles', async (c) => {
  const a = requireAdmin(c);
  const items = await rows<{ id: string; name: string; permissions: string; version: number }>(
    c.env.DB,
    'SELECT id,name,permissions,version FROM roles WHERE center_id=? AND active=1 AND id>? ORDER BY id LIMIT 51',
    a.center.id,
    c.req.query('cursor') ?? '',
  );
  const more = items.length > 50;
  if (more) items.pop();
  return c.json({
    items: items.map((r) => ({
      ...r,
      permissions: z.array(permissionSchema).parse(JSON.parse(r.permissions)),
    })),
    next: more ? items.at(-1)?.id : null,
  });
});
const roleSchema = z.object({ name: nameSchema, permissions: z.array(permissionSchema).max(100) });
records.post('/roles', async (c) => {
  const a = requireAdmin(c);
  const input = roleSchema.parse(await c.req.json());
  const id = uid();
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO roles(id,center_id,name,permissions) VALUES(?,?,?,?)',
      id,
      a.center.id,
      input.name,
      JSON.stringify([...new Set(input.permissions)]),
    ),
    audit(c.env.DB, a.center.id, a.user.id, 'roles.create', id),
  ]);
  return c.json({ id }, 201);
});
records.patch('/roles/:id', async (c) => {
  const a = requireAdmin(c);
  const input = roleSchema
    .extend({ version, active: z.number().int().min(0).max(1).default(1) })
    .parse(await c.req.json());
  return changed(
    c,
    await statement(
      c.env.DB,
      'UPDATE roles SET name=?,permissions=?,active=?,version=version+1 WHERE center_id=? AND id=? AND version=?',
      input.name,
      JSON.stringify([...new Set(input.permissions)]),
      input.active,
      a.center.id,
      c.req.param('id'),
      input.version,
    ).run(),
    'roles.update',
    c.req.param('id'),
  );
});
records.get('/staff', async (c) => {
  const a = requireAdmin(c);
  const items = await rows(
    c.env.DB,
    "SELECT u.id,u.name,u.phone,m.active,COALESCE((SELECT json_group_array(mr.role_id) FROM member_roles mr JOIN roles r ON r.center_id=mr.center_id AND r.id=mr.role_id AND r.active=1 WHERE mr.center_id=m.center_id AND mr.user_id=m.user_id),'[]') AS role_ids FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.center_id=? AND m.user_id>? ORDER BY m.user_id LIMIT 51",
    a.center.id,
    c.req.query('cursor') ?? '',
  );
  const more = items.length > 50;
  if (more) items.pop();
  return c.json({ items, next: more ? z.object({ id: z.string() }).parse(items.at(-1)).id : null });
});
async function checkRoles(c: ApiContext, roles: string[]) {
  if (!roles.length) return;
  const valid = await rows<{ id: string }>(
    c.env.DB,
    'SELECT id FROM roles WHERE center_id=? AND active=1 AND id IN (SELECT value FROM json_each(?))',
    c.get('access').center.id,
    JSON.stringify(roles),
  );
  assert(
    valid.length === roles.length,
    'INVALID_ROLE',
    'Select active roles belonging to this center.',
    422,
  );
}
records.post('/staff/invite', async (c) => {
  const a = requireAdmin(c);
  const input = z
    .object({ phone: phoneSchema, name: nameSchema, role_ids: idList })
    .parse(await c.req.json());
  await checkRoles(c, input.role_ids);
  const token = await invite(
    c.env.DB,
    a.center.id,
    a.user.id,
    input.phone,
    input.name,
    input.role_ids,
  );
  await audit(c.env.DB, a.center.id, a.user.id, 'staff.invite', input.phone.slice(-4)).run();
  return c.json({ token }, 201);
});
records.put('/staff/:id', async (c) => {
  const a = requireAdmin(c);
  const input = z.object({ role_ids: idList, active: z.boolean() }).parse(await c.req.json());
  assert(
    c.req.param('id') !== a.center.owner_id,
    'OWNER_PROTECTED',
    'Transfer center ownership before changing the admin membership.',
    409,
  );
  await checkRoles(c, input.role_ids);
  assert(
    await one(
      c.env.DB,
      'SELECT user_id FROM memberships WHERE center_id=? AND user_id=?',
      a.center.id,
      c.req.param('id'),
    ),
    'NOT_FOUND',
    'This staff account is unavailable.',
    404,
  );
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'UPDATE memberships SET active=? WHERE center_id=? AND user_id=?',
      Number(input.active),
      a.center.id,
      c.req.param('id'),
    ),
    statement(
      c.env.DB,
      'DELETE FROM member_roles WHERE center_id=? AND user_id=?',
      a.center.id,
      c.req.param('id'),
    ),
    ...input.role_ids.map((role) =>
      statement(
        c.env.DB,
        'INSERT INTO member_roles VALUES(?,?,?)',
        a.center.id,
        c.req.param('id'),
        role,
      ),
    ),
    audit(c.env.DB, a.center.id, a.user.id, 'staff.update', c.req.param('id')),
  ]);
  return c.json({ ok: true });
});
records.post('/ownership', async (c) => {
  const a = requireAdmin(c);
  requireRecent(c);
  const input = z.object({ user_id: z.uuid() }).parse(await c.req.json());
  const result = await statement(
    c.env.DB,
    'UPDATE centers SET owner_id=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM memberships WHERE center_id=? AND user_id=? AND active=1)',
    input.user_id,
    a.center.id,
    a.user.id,
    a.center.id,
    input.user_id,
  ).run();
  return changed(c, result, 'ownership.transfer', input.user_id);
});
records.get('/audit', async (c) => {
  const a = requireAdmin(c);
  const cursor = c.req.query('cursor');
  const [before, after] = cursor
    ? z.tuple([z.number(), z.uuid()]).parse(JSON.parse(cursor))
    : [now() + 1, ''];
  const items = await rows<{ id: string; created_at: number; action: string; name: string }>(
    c.env.DB,
    'SELECT a.id,a.action,a.target,a.created_at,u.name FROM audit a JOIN users u ON u.id=a.user_id WHERE a.center_id=? AND (a.created_at<? OR (a.created_at=? AND a.id>?)) ORDER BY a.created_at DESC,a.id LIMIT 51',
    a.center.id,
    before,
    before,
    after,
  );
  const more = items.length > 50;
  if (more) items.pop();
  const last = items.at(-1);
  return c.json({ items, next: more && last ? JSON.stringify([last.created_at, last.id]) : null });
});
