import { env } from 'cloudflare:workers';
import { expect, inject, it } from 'vitest';
import { one, rows, statement, uid } from '../apps/worker/src/db';

it('backfills existing participants without losing marks or ungrouped students', async () => {
  const [before, migration] = inject('migration').split('CREATE TABLE exam_groups ');
  if (!before || !migration) throw new Error('Exam enrollment migration is missing');
  await env.DB.exec(before);
  const owner = uid(),
    center = uid(),
    exam = uid(),
    a = uid(),
    b = uid(),
    subject = uid(),
    paper = uid();
  const students = [uid(), uid(), uid()];
  await env.DB.batch([
    statement(
      env.DB,
      'INSERT INTO users(id,name,phone,created_at) VALUES(?,?,?,0)',
      owner,
      'Owner',
      '8801700000001',
    ),
    statement(
      env.DB,
      'INSERT INTO centers(id,name,owner_id) VALUES(?,?,?)',
      center,
      'Legacy center',
      owner,
    ),
    statement(
      env.DB,
      "INSERT INTO catalog(id,center_id,name,kind) VALUES(?,?,?,'group')",
      a,
      center,
      'Class 3',
    ),
    statement(
      env.DB,
      "INSERT INTO catalog(id,center_id,name,kind) VALUES(?,?,?,'group')",
      b,
      center,
      'Class 4',
    ),
    statement(
      env.DB,
      "INSERT INTO catalog(id,center_id,name,kind) VALUES(?,?,?,'subject')",
      subject,
      center,
      'English',
    ),
    statement(
      env.DB,
      'INSERT INTO exams(id,center_id,name,exam_date) VALUES(?,?,?,?)',
      exam,
      center,
      'Legacy exam',
      '2026-10-25',
    ),
    statement(
      env.DB,
      'INSERT INTO papers(id,center_id,exam_id,subject_id,maximum) VALUES(?,?,?,?,10000)',
      paper,
      center,
      exam,
      subject,
    ),
    ...students.map((id) =>
      statement(env.DB, 'INSERT INTO students(id,center_id,name) VALUES(?,?,?)', id, center, id),
    ),
    ...students.map((id) =>
      statement(env.DB, 'INSERT INTO participants VALUES(?,?,?)', center, exam, id),
    ),
    statement(env.DB, 'INSERT INTO group_members VALUES(?,?,?,?,NULL)', center, a, students[0], 0),
    statement(env.DB, 'INSERT INTO group_members VALUES(?,?,?,?,NULL)', center, a, students[1], 0),
    statement(env.DB, 'INSERT INTO group_members VALUES(?,?,?,?,NULL)', center, b, students[1], 0),
    statement(
      env.DB,
      "INSERT INTO results VALUES(?,?,?,'scored',7500,1,?)",
      center,
      paper,
      students[1],
      owner,
    ),
  ]);
  await env.DB.exec(`CREATE TABLE exam_groups ${migration}`);
  expect(await one(env.DB, 'SELECT COUNT(*) AS n FROM participants')).toEqual({ n: 3 });
  expect(await one(env.DB, 'SELECT score FROM results')).toEqual({ score: 7500 });
  expect(
    await one(
      env.DB,
      "SELECT COUNT(*) AS n FROM exam_group_members WHERE group_id='' AND student_id=?",
      students[2],
    ),
  ).toEqual({ n: 1 });
  expect(
    await one(
      env.DB,
      'SELECT COUNT(*) AS n FROM exam_group_members WHERE student_id=?',
      students[1],
    ),
  ).toEqual({ n: 2 });
  expect(await rows(env.DB, 'PRAGMA foreign_key_check')).toEqual([]);
});
