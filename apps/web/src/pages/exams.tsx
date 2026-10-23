import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { Plus, GraduationCap, Trash2, BookOpen, Calendar, Send, Users } from 'lucide-react';
import {
  formatScore,
  toScore,
  type Catalog,
  type Exam,
  type Mark,
  type Page as Paged,
  type Paper,
  type ResultStatus,
} from '@coaching/domain';
import { formText, useAction, useCenter, useData, useChoices } from '../api';
import { useLocale } from '../i18n';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  MoreChoices,
  NextPage,
  Page,
  State,
  useUnsaved,
} from '../ui';

export default function ExamPages() {
  return (
    <Routes>
      <Route index element={<ExamList />} />
      <Route path="new" element={<CreateExam />} />
      <Route path=":id" element={<ExamDetail />} />
      <Route path=":id/marks/:paperId" element={<Marks />} />
    </Routes>
  );
}
interface ExamDetailData extends Exam {
  papers: Paper[];
  participants: number;
}
function ExamList() {
  const [cursor, setCursor] = useState('');
  const list = useData<Paged<Exam>>(`/exams?cursor=${encodeURIComponent(cursor)}`);
  const { permissions } = useCenter();
  const { t } = useLocale();
  return (
    <Page
      eyebrow="LEARNING, IN FOCUS"
      title="Exams"
      description="Set the exam once. Keep every result in its place."
      action={
        permissions.includes('exams.create') && (
          <Link className="button primary" to="/exams/new">
            <Plus size={18} />
            {t('Create exam')}
          </Link>
        )
      }
    >
      <State pending={list.isPending} error={list.error}>
        {list.data?.items.length ? (
          <div className="exam-grid">
            {list.data.items.map((exam) => (
              <Link className="panel exam-card" to={`/exams/${exam.id}`} key={exam.id}>
                <div className="exam-card-top">
                  <span className="record-icon">
                    <GraduationCap size={24} />
                  </span>
                  <span className="mini-label">{exam.exam_date}</span>
                </div>
                <h2>{exam.name}</h2>
                <span className="text-link">
                  {t('Enter marks')} <span>→</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty />
        )}
        <NextPage next={list.data?.next} onNext={setCursor} />
      </State>
    </Page>
  );
}
function CreateExam() {
  const subjects = useChoices<Catalog>('/catalog?kind=subject');
  const series = useChoices<Catalog>('/catalog?kind=series');
  const action = useAction();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [error, setError] = useState<unknown>(null);
  const [papers, setPapers] = useState([{ subject_id: '', maximum: '', pass_mark: '' }]);
  const [dirty, setDirty] = useState(false);
  const unsaved = useUnsaved(dirty);
  return (
    <Page eyebrow="Exams" title="Create exam">
      {unsaved.prompt}
      <form
        className="form-stack"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            const parsed = papers.map((p) => ({
              subject_id: p.subject_id,
              maximum: toScore(p.maximum),
              pass_mark: p.pass_mark ? toScore(p.pass_mark) : null,
            }));
            action.mutate(
              {
                path: '/exams',
                body: {
                  name: f.get('name'),
                  exam_date: f.get('date'),
                  series_id: f.get('series') || null,
                  papers: parsed,
                },
              },
              {
                onSuccess: ({ id }) => {
                  setDirty(false);
                  unsaved.allowNavigation();
                  void navigate(`/exams/${id}`);
                },
              },
            );
          } catch (err) {
            setError(err);
          }
        }}
      >
        <section className="panel">
          <div className="form-grid">
            <Field label="Name">
              <input name="name" required maxLength={160} />
            </Field>
            <Field label="Date">
              <input name="date" type="date" required />
            </Field>
            <Field label="Series">
              <select name="series">
                <option value="">{t('None')}</option>
                {series.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>
        <section className="panel">
          <div className="section-header">
            <h2>{t('Subject')}</h2>
            <Button
              type="button"
              variant="secondary"
              disabled={papers.length >= 30}
              onClick={() =>
                setPapers((all) => [...all, { subject_id: '', maximum: '', pass_mark: '' }])
              }
            >
              <Plus size={16} />
              {t('Add subject')}
            </Button>
          </div>
          <MoreChoices query={series} />
          <Alert error={subjects.error} />
          <MoreChoices query={subjects} />
          {papers.map((paper, i) => (
            <div className="contact-editor" key={i}>
              <div className="form-grid">
                <Field label="Subject">
                  <select
                    required
                    value={paper.subject_id}
                    onChange={(e) =>
                      setPapers((all) =>
                        all.map((p, index) =>
                          index === i ? { ...p, subject_id: e.target.value } : p,
                        ),
                      )
                    }
                  >
                    <option value="">{t('Choose a subject')}</option>
                    {subjects.data?.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                {(['maximum', 'pass_mark'] as const).map((key) => (
                  <Field
                    label={key === 'maximum' ? 'Maximum marks' : 'Pass mark (optional)'}
                    key={key}
                  >
                    <input
                      inputMode="decimal"
                      required={key === 'maximum'}
                      value={paper[key]}
                      onChange={(e) =>
                        setPapers((all) =>
                          all.map((p, index) =>
                            index === i ? { ...p, [key]: e.target.value } : p,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
              {papers.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Remove subject"
                  onClick={() => setPapers((all) => all.filter((_, index) => index !== i))}
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </div>
          ))}
          {!subjects.data?.items.length && (
            <Link to="/academic">{t('Create a subject first')}</Link>
          )}
        </section>
        <Alert error={action.error ?? error} />
        <div className="sticky-actions">
          <Link to="/exams" className="button secondary">
            {t('Cancel')}
          </Link>
          <Button type="submit" busy={action.isPending}>
            {t('Create exam')}
          </Button>
        </div>
      </form>
    </Page>
  );
}
function ExamDetail() {
  const { id = '' } = useParams();
  const exam = useData<ExamDetailData>(`/exams/${id}`);
  const groups = useChoices<Catalog>('/catalog?kind=group');
  const action = useAction();
  const { permissions } = useCenter();
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [paperEdit, setPaperEdit] = useState<Paper | 'new' | null>(null);
  const subjects = useChoices<Catalog>(
    '/catalog?kind=subject',
    permissions.includes('academic.read'),
  );
  const series = useChoices<Catalog>('/catalog?kind=series', permissions.includes('academic.read'));
  return (
    <Page
      eyebrow="Exams"
      title={exam.data?.name ?? 'Exam'}
      action={
        <div className="page-actions">
          {permissions.includes('exams.update') && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('Edit')}
            </Button>
          )}
          {permissions.includes('messages.create') && (
            <Link className="button primary" to={`/messages/new?exam=${id}`}>
              <Send size={16} />
              {t('Send results')}
            </Link>
          )}
        </div>
      }
    >
      <State pending={exam.isPending} error={exam.error}>
        {exam.data && (
          <>
            <div className="detail-strip">
              <span className="detail-chip">
                <Calendar size={15} />
                {exam.data.exam_date}
              </span>
              <span className="detail-chip">
                <Users size={15} />
                <strong>{exam.data.participants}</strong> {t('Participants')}
              </span>
              <span className="detail-chip">
                <BookOpen size={15} />
                <strong>{exam.data.papers.length}</strong> {t('subjects')}
              </span>
            </div>
            {permissions.includes('exams.update') && (
              <section className="panel">
                <h2>{t('Add participants')}</h2>
                <p className="muted">
                  {t(
                    'Add a batch once. Later group changes will not alter this exam’s participants.',
                  )}
                </p>
                <form
                  className="inline-form add-participants-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    action.mutate({
                      path: `/exams/${id}/participants`,
                      body: { group_id: f.get('group') },
                    });
                  }}
                >
                  <Field label="Groups">
                    <select name="group" required>
                      <option value="">{t('Choose a group')}</option>
                      {groups.data?.items.map((g) => (
                        <option value={g.id} key={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button type="submit" busy={action.isPending}>
                    <Users size={16} />
                    {t('Add participants')}
                  </Button>
                </form>
                <MoreChoices query={groups} />
                <Alert error={action.error} />
                {action.isSuccess && (
                  <Alert success>
                    {t('Participants added. Existing participants were not duplicated.')}
                  </Alert>
                )}
              </section>
            )}
            <div className="section-header">
              <div>
                <h2>{t('Subjects')}</h2>
                <p className="muted">{t('Configure subject papers and score limits')}</p>
              </div>
              {permissions.includes('exams.update') && (
                <Button variant="secondary" onClick={() => setPaperEdit('new')}>
                  <Plus size={16} />
                  {t('Add subject')}
                </Button>
              )}
            </div>
            {exam.data.papers.length === 0 && !permissions.includes('exams.update') ? (
              <Empty
                title="No subjects added yet"
                description="This exam does not have any subjects configured."
              />
            ) : (
              <div className="exam-grid">
                {exam.data.papers.map((paper) => (
                  <section className="panel exam-card" key={paper.id}>
                    <div className="exam-card-header">
                      <div className="exam-card-title">
                        <span className="exam-subject-badge">
                          <BookOpen size={18} />
                        </span>
                        <h2>{paper.name}</h2>
                      </div>
                      {permissions.includes('exams.update') && (
                        <Button variant="ghost" onClick={() => setPaperEdit(paper)}>
                          {t('Edit')}
                        </Button>
                      )}
                    </div>
                    <div className="exam-card-body">
                      <div className="exam-metric">
                        <span className="muted">{t('Maximum marks')}</span>
                        <strong>{formatScore(paper.maximum)}</strong>
                      </div>
                      {paper.pass_mark !== null && (
                        <div className="exam-metric">
                          <span className="muted">{t('Pass mark')}</span>
                          <strong>{formatScore(paper.pass_mark)}</strong>
                        </div>
                      )}
                    </div>
                    {permissions.includes('results.read') && (
                      <Link
                        className="button secondary exam-enter-marks"
                        to={`/exams/${id}/marks/${paper.id}`}
                      >
                        {t('Enter marks')} →
                      </Link>
                    )}
                  </section>
                ))}
                {permissions.includes('exams.update') && (
                  <button
                    type="button"
                    className="add-subject-card"
                    onClick={() => setPaperEdit('new')}
                  >
                    <div className="add-subject-icon">
                      <Plus size={22} />
                    </div>
                    <strong>{t('Add subject')}</strong>
                    <span className="muted">{t('Add another subject paper')}</span>
                  </button>
                )}
              </div>
            )}
            {permissions.includes('messages.create') && exam.data.papers.length > 0 && (
              <div className="exam-results-bar">
                <div>
                  <h3>{t('Publish Results')}</h3>
                  <p className="muted">
                    {t('Ready to share scores with students and parents via SMS?')}
                  </p>
                </div>
                <Link className="button primary" to={`/messages/new?exam=${id}`}>
                  <Send size={16} />
                  {t('Send results')}
                </Link>
              </div>
            )}
            <Dialog
              title={paperEdit === 'new' ? 'Add subject' : 'Edit subject'}
              open={paperEdit !== null}
              onClose={() => setPaperEdit(null)}
            >
              {paperEdit && (
                <PaperEditor
                  key={paperEdit === 'new' ? 'new' : paperEdit.id}
                  examId={id}
                  paper={paperEdit === 'new' ? null : paperEdit}
                  subjects={subjects.data?.items ?? []}
                  onDone={() => setPaperEdit(null)}
                />
              )}
              <MoreChoices query={subjects} />
            </Dialog>
            <Dialog title="Edit" open={editing} onClose={() => setEditing(false)}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  action.mutate(
                    {
                      path: `/exams/${id}`,
                      method: 'PATCH',
                      body: {
                        name: f.get('name'),
                        exam_date: f.get('date'),
                        series_id: f.get('series') || null,
                        version: exam.data.version,
                        active: f.get('active') === 'on',
                      },
                    },
                    { onSuccess: () => setEditing(false) },
                  );
                }}
              >
                <Field label="Name">
                  <input name="name" defaultValue={exam.data.name} required />
                </Field>
                <Field label="Date">
                  <input type="date" name="date" defaultValue={exam.data.exam_date} required />
                </Field>
                <Field label="Exam series">
                  <select name="series" defaultValue={exam.data.series_id ?? ''}>
                    <option value="">{t('None')}</option>
                    {series.data?.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <MoreChoices query={series} />
                <label className="check">
                  <input type="checkbox" name="active" defaultChecked={Boolean(exam.data.active)} />
                  {t('Active')}
                </label>
                <Alert error={action.error} />
                <Button type="submit" busy={action.isPending}>
                  {t('Save')}
                </Button>
              </form>
            </Dialog>
          </>
        )}
      </State>
    </Page>
  );
}
function PaperEditor({
  examId,
  paper,
  subjects,
  onDone,
}: {
  examId: string;
  paper: Paper | null;
  subjects: Catalog[];
  onDone: () => void;
}) {
  const action = useAction();
  const [error, setError] = useState<unknown>();
  const { t } = useLocale();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        try {
          const maximum = toScore(formText(f, 'maximum'));
          const pass = formText(f, 'pass');
          action.mutate(
            {
              path: `/exams/${examId}/papers${paper ? `/${paper.id}` : ''}`,
              method: paper ? 'PATCH' : 'POST',
              body: {
                subject_id: f.get('subject'),
                maximum,
                pass_mark: pass ? toScore(pass) : null,
                ...(paper ? { version: paper.version } : {}),
              },
            },
            { onSuccess: onDone },
          );
        } catch (err) {
          setError(err);
        }
      }}
    >
      {!paper && (
        <Field label="Subject">
          <select name="subject" required>
            <option value="">{t('Choose a subject')}</option>
            {subjects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Maximum marks">
        <input
          name="maximum"
          type="text"
          inputMode="decimal"
          defaultValue={paper ? formatScore(paper.maximum) : ''}
          required
        />
      </Field>
      <Field label="Pass marks">
        <input
          name="pass"
          type="text"
          inputMode="decimal"
          defaultValue={paper?.pass_mark == null ? '' : formatScore(paper.pass_mark)}
        />
      </Field>
      <Alert error={error ?? action.error} />
      <Button type="submit" busy={action.isPending}>
        {t('Save')}
      </Button>
    </form>
  );
}
function Marks() {
  const { id = '', paperId = '' } = useParams();
  const [cursor, setCursor] = useState('');
  const marks = useData<{ paper: Paper; items: Mark[]; next: string | null }>(
    `/exams/${id}/papers/${paperId}/marks?cursor=${cursor}`,
  );
  return (
    <State pending={marks.isPending} error={marks.error}>
      {marks.data && (
        <MarksForm
          key={`${paperId}:${cursor}:${marks.dataUpdatedAt}`}
          data={marks.data}
          exam={id}
          paper={paperId}
          nextPage={setCursor}
        />
      )}
    </State>
  );
}
function MarksForm({
  data,
  exam,
  paper,
  nextPage,
}: {
  data: { paper: Paper; items: Mark[]; next: string | null };
  exam: string;
  paper: string;
  nextPage: (v: string) => void;
}) {
  const [changes, setChanges] = useState<Record<string, { status: ResultStatus; value: string }>>(
    {},
  );
  const action = useAction();
  const { permissions } = useCenter();
  const { t } = useLocale();
  const [error, setError] = useState<unknown>(null);
  const dirty = Object.keys(changes).length > 0;
  const unsaved = useUnsaved(dirty);
  return (
    <Page
      eyebrow="Exams"
      title="Enter marks"
      description={`Maximum: ${formatScore(data.paper.maximum)} · Zero, absent and pending are different results.`}
      action={
        <Link className="button secondary" to={`/exams/${exam}`}>
          {t('Back')}
        </Link>
      }
    >
      {unsaved.prompt}
      <Alert error={action.error ?? error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const values = data.items
              .filter((row) => changes[row.student_id])
              .map((row) => {
                const input = changes[row.student_id];
                if (!input) throw new Error('Missing edited result');
                return {
                  student_id: row.student_id,
                  status: input.status,
                  score: input.status === 'scored' ? toScore(input.value) : null,
                  version: row.version,
                };
              });
            action.mutate(
              { path: `/exams/${exam}/papers/${paper}/marks`, method: 'PUT', body: values },
              { onSuccess: () => setChanges({}) },
            );
          } catch (err) {
            setError(err);
          }
        }}
      >
        <section className="panel flush">
          {data.items.length ? (
            <div className="marks-list">
              {data.items.map((row, index) => {
                const current = changes[row.student_id] ?? {
                  status: row.status,
                  value: row.score === null ? '' : formatScore(row.score),
                };
                return (
                  <div
                    className={`mark-row ${changes[row.student_id] ? 'changed' : ''}`}
                    key={row.student_id}
                  >
                    <span className="roll-number">{index + 1}</span>
                    <div className="mark-student">
                      <strong>{row.name}</strong>
                      <small>{row.identifier || t('Student')}</small>
                    </div>
                    <label className="sr-only" htmlFor={`status-${row.student_id}`}>
                      {t('Result status for')} {row.name}
                    </label>
                    <select
                      id={`status-${row.student_id}`}
                      value={current.status}
                      disabled={!permissions.includes('results.update')}
                      onChange={(e) => {
                        const status = e.target.value as ResultStatus;
                        setChanges((all) => ({ ...all, [row.student_id]: { ...current, status } }));
                      }}
                    >
                      {(['scored', 'absent', 'pending', 'exempt'] as const).map((status) => (
                        <option key={status} value={status}>
                          {t(status.charAt(0).toUpperCase() + status.slice(1))}
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor={`score-${row.student_id}`}>
                      {t('Marks for')} {row.name}
                    </label>
                    <input
                      id={`score-${row.student_id}`}
                      className="score-input"
                      inputMode="decimal"
                      placeholder="—"
                      value={current.value}
                      disabled={
                        !permissions.includes('results.update') || current.status !== 'scored'
                      }
                      onChange={(e) =>
                        setChanges((all) => ({
                          ...all,
                          [row.student_id]: { ...current, value: e.target.value },
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No participants"
              description="Add students from a group on the exam page first."
            />
          )}
        </section>
        <div className="sticky-actions">
          <span aria-live="polite">
            {dirty ? (
              `${Object.keys(changes).length} ${t('Unsaved changes')}`
            ) : (
              <Badge status="scored" />
            )}
          </span>
          <div className="actions">
            {data.next && (
              <Button
                type="button"
                variant="secondary"
                disabled={dirty}
                onClick={() => {
                  if (data.next) nextPage(data.next);
                }}
              >
                {t('Next')}
              </Button>
            )}
            <Button
              type="submit"
              busy={action.isPending}
              disabled={!dirty || !permissions.includes('results.update')}
            >
              {t('Save marks')}
            </Button>
          </div>
        </div>
      </form>
    </Page>
  );
}
