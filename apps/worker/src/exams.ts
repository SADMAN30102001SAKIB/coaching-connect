import { Hono } from 'hono';
import { z } from 'zod';
import { nameSchema, resultStatus, type Exam, type Mark, type Paper } from '@coaching/domain';
import { audit, one, rows, statement, uid } from './db';
import { assert } from './errors';
import { requirePermission, type AppEnv } from './security';

export const exams = new Hono<AppEnv>();
const paperMarks = z
  .object({
    maximum: z.number().int().min(1).max(999999999),
    pass_mark: z.number().int().nonnegative().nullable(),
  })
  .refine(
    (x) => x.pass_mark === null || x.pass_mark <= x.maximum,
    'Pass mark cannot exceed the maximum',
  );
const paperInput = paperMarks.safeExtend({ subject_id: z.uuid() });
const examInput = z.object({
  name: nameSchema,
  exam_date: z.iso.date(),
  series_id: z.uuid().nullable(),
  papers: z.array(paperInput).min(1).max(30),
});
exams.get('/', async (c) => {
  const a = requirePermission(c, 'exams.read');
  const cursor = c.req.query('cursor');
  const [before, after] = cursor
    ? z.tuple([z.string(), z.uuid()]).parse(JSON.parse(cursor))
    : ['9999-99-99', ''];
  const items = await rows<Exam>(
    c.env.DB,
    'SELECT * FROM exams WHERE center_id=? AND active=1 AND (exam_date<? OR (exam_date=? AND id>?)) ORDER BY exam_date DESC,id LIMIT 51',
    a.center.id,
    before,
    before,
    after,
  );
  const more = items.length > 50;
  if (more) items.pop();
  const last = items.at(-1);
  return c.json({ items, next: more && last ? JSON.stringify([last.exam_date, last.id]) : null });
});
exams.post('/', async (c) => {
  const a = requirePermission(c, 'exams.create');
  const input = examInput.parse(await c.req.json());
  const id = uid();
  assert(
    new Set(input.papers.map((p) => p.subject_id)).size === input.papers.length,
    'DUPLICATE_SUBJECT',
    'Each subject can appear once in an exam.',
    422,
  );
  for (const p of input.papers)
    assert(
      await one(
        c.env.DB,
        "SELECT id FROM catalog WHERE center_id=? AND id=? AND kind='subject' AND active=1",
        a.center.id,
        p.subject_id,
      ),
      'INVALID_SUBJECT',
      'Choose an active subject from this center.',
      422,
    );
  if (input.series_id)
    assert(
      await one(
        c.env.DB,
        "SELECT id FROM catalog WHERE center_id=? AND id=? AND kind='series' AND active=1",
        a.center.id,
        input.series_id,
      ),
      'INVALID_SERIES',
      'Choose a series from this center.',
      422,
    );
  await c.env.DB.batch([
    statement(
      c.env.DB,
      'INSERT INTO exams(id,center_id,name,exam_date,series_id) VALUES(?,?,?,?,?)',
      id,
      a.center.id,
      input.name,
      input.exam_date,
      input.series_id,
    ),
    ...input.papers.map((p, position) =>
      statement(
        c.env.DB,
        'INSERT INTO papers(id,center_id,exam_id,subject_id,maximum,pass_mark,position) VALUES(?,?,?,?,?,?,?)',
        uid(),
        a.center.id,
        id,
        p.subject_id,
        p.maximum,
        p.pass_mark,
        position,
      ),
    ),
    audit(c.env.DB, a.center.id, a.user.id, 'exams.create', id),
  ]);
  return c.json({ id }, 201);
});
exams.get('/:id', async (c) => {
  const a = requirePermission(c, 'exams.read');
  const item = await one<Exam>(
    c.env.DB,
    'SELECT * FROM exams WHERE center_id=? AND id=?',
    a.center.id,
    c.req.param('id'),
  );
  assert(item, 'NOT_FOUND', 'This exam is unavailable.', 404);
  const papers = await rows<Paper>(
    c.env.DB,
    'SELECT p.*,s.name FROM papers p JOIN catalog s ON s.center_id=p.center_id AND s.id=p.subject_id WHERE p.center_id=? AND p.exam_id=? ORDER BY p.position,p.id',
    a.center.id,
    item.id,
  );
  const count = await one<{ count: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS count FROM participants WHERE center_id=? AND exam_id=?',
    a.center.id,
    item.id,
  );
  return c.json({ ...item, papers, participants: count?.count ?? 0 });
});
exams.patch('/:id', async (c) => {
  const input = z
    .object({
      name: nameSchema,
      exam_date: z.iso.date(),
      version: z.number().int(),
      active: z.boolean(),
      series_id: z.uuid().nullable(),
    })
    .parse(await c.req.json());
  const a = requirePermission(c, `exams.${input.active ? 'update' : 'archive'}`);
  const result = await statement(
    c.env.DB,
    'UPDATE exams SET name=?,exam_date=?,series_id=?,active=?,version=version+1 WHERE center_id=? AND id=? AND version=?',
    input.name,
    input.exam_date,
    input.series_id,
    Number(input.active),
    a.center.id,
    c.req.param('id'),
    input.version,
  ).run();
  assert(result.meta.changes, 'EDIT_CONFLICT', 'The exam changed. Reload before saving.', 409);
  await audit(c.env.DB, a.center.id, a.user.id, 'exams.update', c.req.param('id')).run();
  return c.json({ ok: true });
});
exams.patch('/:id/papers/:paper', async (c) => {
  const a = requirePermission(c, 'exams.update');
  const input = paperMarks
    .safeExtend({ version: z.number().int().positive() })
    .parse(await c.req.json());
  const result = await statement(
    c.env.DB,
    'UPDATE papers SET maximum=?,pass_mark=?,version=version+1 WHERE center_id=? AND exam_id=? AND id=? AND version=?',
    input.maximum,
    input.pass_mark,
    a.center.id,
    c.req.param('id'),
    c.req.param('paper'),
    input.version,
  ).run();
  assert(
    result.meta.changes,
    'EDIT_CONFLICT',
    'This paper changed or is unavailable. Reload before saving.',
    409,
  );
  await audit(c.env.DB, a.center.id, a.user.id, 'exams.paper.update', c.req.param('paper')).run();
  return c.json({ ok: true });
});
exams.post('/:id/papers', async (c) => {
  const a = requirePermission(c, 'exams.update');
  const input = paperInput.parse(await c.req.json());
  const id = uid();
  const result = await statement(
    c.env.DB,
    "INSERT INTO papers(id,center_id,exam_id,subject_id,maximum,pass_mark,position) SELECT ?,e.center_id,e.id,s.id,?,?,COALESCE((SELECT MAX(position)+1 FROM papers WHERE center_id=e.center_id AND exam_id=e.id),0) FROM exams e JOIN catalog s ON s.center_id=e.center_id AND s.id=? AND s.kind='subject' AND s.active=1 WHERE e.center_id=? AND e.id=? AND e.active=1 AND (SELECT COUNT(*) FROM papers WHERE center_id=e.center_id AND exam_id=e.id)<30",
    id,
    input.maximum,
    input.pass_mark,
    input.subject_id,
    a.center.id,
    c.req.param('id'),
  ).run();
  assert(
    result.meta.changes,
    'PAPER_UNAVAILABLE',
    'Choose an active exam and subject. An exam can contain up to 30 subjects.',
    422,
  );
  await audit(c.env.DB, a.center.id, a.user.id, 'exams.paper.create', id).run();
  return c.json({ id }, 201);
});
exams.post('/:id/participants', async (c) => {
  const a = requirePermission(c, 'exams.update');
  const input = z
    .object({
      group_id: z.uuid().optional(),
      student_ids: z.array(z.uuid()).max(100).default([]),
    })
    .parse(await c.req.json());
  assert(
    await one(
      c.env.DB,
      'SELECT id FROM exams WHERE center_id=? AND id=? AND active=1',
      a.center.id,
      c.req.param('id'),
    ),
    'NOT_FOUND',
    'Choose an active exam.',
    404,
  );
  const result = input.group_id
    ? await statement(
        c.env.DB,
        'INSERT OR IGNORE INTO participants SELECT s.center_id,?,s.id FROM students s JOIN group_members gm ON gm.center_id=s.center_id AND gm.student_id=s.id WHERE s.center_id=? AND s.active=1 AND gm.group_id=? AND gm.left_at IS NULL',
        c.req.param('id'),
        a.center.id,
        input.group_id,
      ).run()
    : await statement(
        c.env.DB,
        'INSERT OR IGNORE INTO participants SELECT center_id,?,id FROM students WHERE center_id=? AND active=1 AND id IN (SELECT value FROM json_each(?))',
        c.req.param('id'),
        a.center.id,
        JSON.stringify(input.student_ids),
      ).run();
  await audit(c.env.DB, a.center.id, a.user.id, 'exams.participants', c.req.param('id')).run();
  return c.json({ added: result.meta.changes });
});
exams.get('/:id/papers/:paper/marks', async (c) => {
  const a = requirePermission(c, 'results.read');
  const paper = await one<Paper>(
    c.env.DB,
    'SELECT * FROM papers WHERE center_id=? AND exam_id=? AND id=?',
    a.center.id,
    c.req.param('id'),
    c.req.param('paper'),
  );
  assert(paper, 'NOT_FOUND', 'This paper is unavailable.', 404);
  const items = await rows<Mark>(
    c.env.DB,
    "SELECT s.id AS student_id,s.name,s.identifier,COALESCE(r.status,'pending') AS status,r.score,COALESCE(r.version,0) AS version FROM participants p JOIN students s ON s.center_id=p.center_id AND s.id=p.student_id LEFT JOIN results r ON r.center_id=p.center_id AND r.student_id=p.student_id AND r.paper_id=? WHERE p.center_id=? AND p.exam_id=? AND p.student_id>? ORDER BY p.student_id LIMIT 51",
    paper.id,
    a.center.id,
    paper.exam_id,
    c.req.query('cursor') ?? '',
  );
  const more = items.length > 50;
  if (more) items.pop();
  return c.json({ paper, items, next: more ? items.at(-1)?.student_id : null });
});
exams.put('/:id/papers/:paper/marks', async (c) => {
  const a = requirePermission(c, 'results.update');
  const input = z
    .array(
      z
        .object({
          student_id: z.uuid(),
          status: resultStatus,
          score: z.number().int().nonnegative().nullable(),
          version: z.number().int().nonnegative(),
        })
        .refine(
          (x) => (x.status === 'scored' ? x.score !== null : x.score === null),
          'Select a score or a non-scored status',
        ),
    )
    .min(1)
    .max(50)
    .parse(await c.req.json());
  const paper = await one<Paper>(
    c.env.DB,
    'SELECT * FROM papers WHERE center_id=? AND exam_id=? AND id=?',
    a.center.id,
    c.req.param('id'),
    c.req.param('paper'),
  );
  assert(paper, 'NOT_FOUND', 'This paper is unavailable.', 404);
  assert(
    new Set(input.map((r) => r.student_id)).size === input.length,
    'DUPLICATE_RESULT',
    'Each student can appear once in a save.',
    422,
  );
  for (const r of input)
    assert(
      r.score === null || r.score <= paper.maximum,
      'MARK_EXCEEDS_MAX',
      'Marks cannot exceed this paper’s maximum.',
      422,
    );
  await c.env.DB.batch([
    ...input.map((r) =>
      statement(
        c.env.DB,
        'INSERT INTO results(center_id,paper_id,student_id,status,score,version,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(center_id,paper_id,student_id) DO UPDATE SET status=excluded.status,score=excluded.score,version=excluded.version,updated_by=excluded.updated_by',
        a.center.id,
        paper.id,
        r.student_id,
        r.status,
        r.score,
        r.version + 1,
        a.user.id,
      ),
    ),
    audit(c.env.DB, a.center.id, a.user.id, 'results.save', paper.id),
  ]);
  return c.json({ saved: input.length });
});
