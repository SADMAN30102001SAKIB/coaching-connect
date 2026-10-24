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
  Button,
  Dialog,
  Empty,
  Field,
  MoreChoices,
  NextPage,
  Page,
  State,
  useUnsaved,
  useDraftSnapshot,
  useListParams,
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
  groups?: { id: string; name: string; count: number }[];
}
function ExamList() {
  const { params, update } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const status = ['active', 'inactive', 'all'].includes(params.get('status') ?? '')
    ? (params.get('status') ?? 'all')
    : 'all';
  const [deletingExam, setDeletingExam] = useState<Exam | null>(null);
  const list = useData<Paged<Exam>>(`/exams?status=${status}&cursor=${encodeURIComponent(cursor)}`);
  const action = useAction();
  const { permissions } = useCenter();
  const { t } = useLocale();
  return (
    <Page
      eyebrow="LEARNING, IN FOCUS"
      title="Exams"
      action={
        permissions.includes('exams.create') && (
          <Link className="button primary" to="/exams/new">
            <Plus size={18} />
            {t('Create exam')}
          </Link>
        )
      }
    >
      <div className="group-tabs" role="group" aria-label={t('Exam status')}>
        {(['all', 'active', 'inactive'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={status === value ? 'active' : ''}
            aria-pressed={status === value}
            onClick={() => update({ status: value, cursor: '' })}
          >
            {t(value === 'all' ? 'All exams' : value === 'active' ? 'Active' : 'Inactive')}
          </button>
        ))}
      </div>
      <Alert error={action.error} />
      <State query={list}>
        {list.data?.items.length ? (
          <div className="exam-grid">
            {list.data.items.map((exam) => (
              <Link className="panel exam-card" to={`/exams/${exam.id}`} key={exam.id}>
                <div className="exam-card-top">
                  <span className="record-icon">
                    <GraduationCap size={24} />
                  </span>
                  <div className="exam-card-actions">
                    <span className="mini-label">{exam.exam_date}</span>
                    {permissions.includes('exams.archive') && (
                      <Button
                        variant="ghost"
                        className="danger-icon-btn"
                        aria-label={`Delete ${exam.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          action.reset();
                          setDeletingExam(exam);
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </div>
                <h2>{exam.name}</h2>
                {!exam.active && <span className="badge paused">{t('Inactive')}</span>}
                {!exam.active && permissions.includes('exams.update') && (
                  <Button
                    variant="secondary"
                    busy={action.isPending}
                    aria-label={`${t('Reactivate')} ${exam.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      action.mutate({
                        path: `/exams/${exam.id}`,
                        method: 'PATCH',
                        body: {
                          name: exam.name,
                          exam_date: exam.exam_date,
                          version: exam.version,
                          active: true,
                        },
                      });
                    }}
                  >
                    {t('Reactivate')}
                  </Button>
                )}
                <span className="text-link">
                  {t('View exam')} <span>→</span>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty
            title={
              status === 'inactive'
                ? 'No inactive exams'
                : status === 'active'
                  ? 'No active exams'
                  : 'No exams yet'
            }
            description={
              status === 'all'
                ? 'Create your first exam to get started.'
                : 'Try another status filter to see your exams.'
            }
          />
        )}
        <NextPage next={list.data?.next} onNext={(cursor) => update({ cursor })} />
      </State>
      <Dialog
        title="Delete exam"
        open={deletingExam !== null}
        onClose={() => setDeletingExam(null)}
      >
        {deletingExam && (
          <div>
            <p>
              {t('Are you sure you want to delete')} <strong>{deletingExam.name}</strong>?
            </p>
            <p className="muted">
              {t(
                'This will permanently delete this exam, all associated subject papers, and all student results. This cannot be undone.',
              )}
            </p>
            <Alert error={action.error} />
            <div className="actions">
              <Button type="button" variant="secondary" onClick={() => setDeletingExam(null)}>
                {t('Cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={action.isPending}
                onClick={() => {
                  action.mutate(
                    { path: `/exams/${deletingExam.id}`, method: 'DELETE' },
                    {
                      onSuccess: () => {
                        setDeletingExam(null);
                        void list.refetch();
                      },
                    },
                  );
                }}
              >
                <Trash2 size={16} />
                {t('Delete exam')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
function CreateExam() {
  const { permissions } = useCenter();
  const subjects = useChoices<Catalog>(
    '/catalog?kind=subject',
    permissions.includes('academic.read'),
  );
  const action = useAction();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [error, setError] = useState<unknown>(null);
  const [papers, setPapers] = useState([{ subject_id: '', maximum: '' }]);
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
          setError(null);
          try {
            const parsed = papers.map((p) => ({
              subject_id: p.subject_id,
              maximum: toScore(p.maximum),
            }));
            action.mutate(
              {
                path: '/exams',
                body: {
                  name: f.get('name'),
                  exam_date: f.get('date'),
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
        <fieldset className="form-fields form-stack" disabled={action.isPending}>
          <section className="panel">
            <div className="form-grid">
              <Field label="Name">
                <input name="name" required maxLength={160} />
              </Field>
              <Field label="Date">
                <input name="date" type="date" required />
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
                onClick={() => setPapers((all) => [...all, { subject_id: '', maximum: '' }])}
              >
                <Plus size={16} />
                {t('Add subject')}
              </Button>
            </div>
            <State query={subjects} compact>
              <MoreChoices query={subjects} />
            </State>
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
                  <Field label="Maximum marks">
                    <input
                      inputMode="decimal"
                      required
                      value={paper.maximum}
                      onChange={(e) =>
                        setPapers((all) =>
                          all.map((p, index) =>
                            index === i ? { ...p, maximum: e.target.value } : p,
                          ),
                        )
                      }
                    />
                  </Field>
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
            {!subjects.isPending && !subjects.error && !subjects.data?.items.length && (
              <Link to="/academic">{t('Create a subject first')}</Link>
            )}
          </section>
          <Alert error={action.error ?? error} />
          <div className="form-actions">
            <Link to="/exams" className="button secondary">
              {t('Cancel')}
            </Link>
            <Button type="submit" busy={action.isPending}>
              {t('Create exam')}
            </Button>
          </div>
        </fieldset>
      </form>
    </Page>
  );
}
function ExamDetail() {
  const { id = '' } = useParams();
  const exam = useData<ExamDetailData>(`/exams/${id}`);
  const { permissions } = useCenter();
  const groups = useChoices<Catalog>('/catalog?kind=group', permissions.includes('groups.read'));
  const action = useAction();
  const removeAction = useAction();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [confirmDeleteExam, setConfirmDeleteExam] = useState(false);
  const [removeGroup, setRemoveGroup] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  const [paperEdit, setPaperEdit] = useState<Paper | 'new' | null>(null);
  const subjects = useChoices<Catalog>(
    '/catalog?kind=subject',
    permissions.includes('academic.read'),
  );
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
      <State query={exam}>
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
            <section className="panel">
              <div className="section-header">
                <div>
                  <h2>{t('Participants')}</h2>
                  <p className="muted">
                    {t(
                      'Add a batch once. Later group changes will not alter this exam’s participants.',
                    )}
                  </p>
                </div>
              </div>
              {permissions.includes('exams.update') && (
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
                  <div className="actions">
                    <Button type="submit" busy={action.isPending}>
                      <Users size={16} />
                      {t('Add participants')}
                    </Button>
                  </div>
                </form>
              )}
              {permissions.includes('exams.update') && (
                <State query={groups} compact>
                  <MoreChoices query={groups} />
                </State>
              )}
              <Alert error={action.error} />
              {action.isSuccess && (
                <Alert success>
                  {t('Participants added. Existing participants were not duplicated.')}
                </Alert>
              )}
              {exam.data.groups && exam.data.groups.length > 0 && (
                <div className="participating-groups">
                  <h3>
                    {t('Participating groups')} ({exam.data.groups.length})
                  </h3>
                  <div className="group-chips-list">
                    {exam.data.groups.map((g) => (
                      <div className="participating-group-row" key={g.id}>
                        <div className="group-info">
                          <span className="group-icon">
                            <Users size={16} />
                          </span>
                          <div>
                            <strong>{g.name}</strong>
                            <small className="muted">
                              {g.count} {t('students in exam')}
                            </small>
                          </div>
                        </div>
                        {permissions.includes('exams.update') && (
                          <Button
                            variant="danger"
                            onClick={() => {
                              removeAction.reset();
                              setRemoveGroup(g);
                            }}
                            title={t('Remove group from exam')}
                          >
                            <Trash2 size={14} />
                            {t('Remove')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <div className="section-header">
              <div>
                <h2>{t('Subjects')}</h2>
                <p className="muted">{t('Papers and score limits')}</p>
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
            {permissions.includes('exams.archive') && (
              <section className="panel danger-panel">
                <div className="section-header">
                  <div>
                    <h2>{t('Delete exam')}</h2>
                    <p className="muted">
                      {t(
                        'Permanently remove this exam, all papers, participants, and recorded marks.',
                      )}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => {
                      action.reset();
                      setConfirmDeleteExam(true);
                    }}
                  >
                    <Trash2 size={16} />
                    {t('Delete exam')}
                  </Button>
                </div>
              </section>
            )}
            <Dialog
              title={paperEdit === 'new' ? 'Add subject' : 'Edit subject'}
              open={paperEdit !== null}
              onClose={() => setPaperEdit(null)}
              refresh={exam.refetch}
            >
              {paperEdit && (
                <PaperEditor
                  key={paperEdit === 'new' ? 'new' : paperEdit.id}
                  examId={id}
                  paper={
                    paperEdit === 'new'
                      ? null
                      : (exam.data.papers.find((item) => item.id === paperEdit.id) ?? paperEdit)
                  }
                  subjects={subjects.data?.items ?? []}
                  onDone={() => setPaperEdit(null)}
                />
              )}
              {paperEdit === 'new' && permissions.includes('academic.read') && (
                <State query={subjects} compact>
                  <MoreChoices query={subjects} />
                </State>
              )}
            </Dialog>
            <Dialog
              title="Edit"
              open={editing}
              onClose={() => setEditing(false)}
              refresh={exam.refetch}
            >
              <ExamEditor initial={exam.data} onDone={() => setEditing(false)} />
            </Dialog>
            <Dialog
              title="Remove group"
              open={removeGroup !== null}
              onClose={() => setRemoveGroup(null)}
            >
              <p>
                {t('Remove')} <strong>{removeGroup?.name}</strong> {t('from this exam?')}
              </p>
              <p className="muted">
                {t(
                  'Students in this group will be removed from exam participants. Any recorded marks must be cleared first.',
                )}
              </p>
              <Alert error={removeAction.error} />
              <div className="actions">
                <Button variant="secondary" onClick={() => setRemoveGroup(null)}>
                  {t('Cancel')}
                </Button>
                <Button
                  variant="danger"
                  busy={removeAction.isPending}
                  onClick={() => {
                    if (!removeGroup) return;
                    removeAction.mutate(
                      {
                        path: `/exams/${id}/participants/${removeGroup.id}`,
                        method: 'DELETE',
                      },
                      {
                        onSuccess: () => {
                          setRemoveGroup(null);
                        },
                      },
                    );
                  }}
                >
                  <Trash2 size={16} />
                  {t('Remove group')}
                </Button>
              </div>
            </Dialog>
            <Dialog
              title="Delete exam"
              open={confirmDeleteExam}
              onClose={() => setConfirmDeleteExam(false)}
            >
              <p>
                {t('Are you sure you want to delete')} <strong>{exam.data.name}</strong>?
              </p>
              <p className="muted">
                {t(
                  'This will permanently delete this exam, all associated subject papers, and all student results. This cannot be undone.',
                )}
              </p>
              <Alert error={action.error} />
              <div className="actions">
                <Button variant="secondary" onClick={() => setConfirmDeleteExam(false)}>
                  {t('Cancel')}
                </Button>
                <Button
                  variant="danger"
                  busy={action.isPending}
                  onClick={() => {
                    action.mutate(
                      { path: `/exams/${id}`, method: 'DELETE' },
                      {
                        onSuccess: () => {
                          void navigate('/exams');
                        },
                      },
                    );
                  }}
                >
                  <Trash2 size={16} />
                  {t('Delete exam')}
                </Button>
              </div>
            </Dialog>
          </>
        )}
      </State>
    </Page>
  );
}
function ExamEditor({
  initial: incoming,
  onDone,
}: {
  initial: ExamDetailData;
  onDone: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const initial = useDraftSnapshot(incoming, dirty);
  const action = useAction();
  const { t } = useLocale();
  const { permissions } = useCenter();
  return (
    <form
      key={initial.version}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        action.mutate(
          {
            path: `/exams/${initial.id}`,
            method: 'PATCH',
            body: {
              name: form.get('name'),
              exam_date: form.get('date'),
              version: initial.version,
              active:
                initial.active && !permissions.includes('exams.archive')
                  ? true
                  : form.get('active') === 'on',
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Name">
        <input name="name" defaultValue={initial.name} required />
      </Field>
      <Field label="Date">
        <input name="date" type="date" defaultValue={initial.exam_date} required />
      </Field>
      <label className="check">
        <input
          name="active"
          type="checkbox"
          defaultChecked={Boolean(initial.active)}
          disabled={Boolean(initial.active) && !permissions.includes('exams.archive')}
        />
        {t('Active')}
      </label>
      <Alert error={action.error} />
      <div className="actions">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button type="submit" busy={action.isPending}>
          {t('Save')}
        </Button>
      </div>
    </form>
  );
}
function PaperEditor({
  examId,
  paper: incoming,
  subjects,
  onDone,
}: {
  examId: string;
  paper: Paper | null;
  subjects: Catalog[];
  onDone: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const paper = useDraftSnapshot(incoming, dirty);
  const action = useAction();
  const [error, setError] = useState<unknown>();
  const { t } = useLocale();
  return (
    <form
      key={paper?.version ?? 'new'}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        setError(undefined);
        try {
          const maximum = toScore(formText(f, 'maximum'));
          action.mutate(
            {
              path: `/exams/${examId}/papers${paper ? `/${paper.id}` : ''}`,
              method: paper ? 'PATCH' : 'POST',
              body: {
                subject_id: f.get('subject'),
                maximum,
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
      <Alert error={error ?? action.error} />
      <div className="actions">
        <Button type="submit" busy={action.isPending}>
          {t('Save')}
        </Button>
      </div>
    </form>
  );
}
function Marks() {
  const { id = '', paperId = '' } = useParams();
  const { params, update } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const selectedGroup = params.get('group') ?? '';
  const marks = useData<{
    paper: Paper;
    items: Mark[];
    next: string | null;
    groups: { id: string; name: string; count: number }[];
  }>(
    `/exams/${id}/papers/${paperId}/marks?cursor=${cursor}${selectedGroup ? `&group_id=${selectedGroup}` : ''}`,
  );
  return (
    <State query={marks}>
      {marks.data && (
        <MarksForm
          key={`${id}:${paperId}:${cursor}:${selectedGroup}`}
          data={marks.data}
          exam={id}
          paper={paperId}
          selectedGroup={selectedGroup}
          onSelectGroup={(gid) => {
            update({ group: gid, cursor: '' });
          }}
          nextPage={(cursor) => update({ cursor })}
        />
      )}
    </State>
  );
}
function MarksForm({
  data: incoming,
  exam,
  paper,
  selectedGroup,
  onSelectGroup,
  nextPage,
}: {
  data: {
    paper: Paper;
    items: Mark[];
    next: string | null;
    groups: { id: string; name: string; count: number }[];
  };
  exam: string;
  paper: string;
  selectedGroup: string;
  onSelectGroup: (v: string) => void;
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
  const data = useDraftSnapshot(incoming, dirty);
  const unsaved = useUnsaved(dirty);

  const handleGroupChange = (gid: string) => {
    if (gid === selectedGroup) return;
    if (dirty) {
      setError(new Error('Save or discard your marks before switching groups.'));
      return;
    }
    onSelectGroup(gid);
  };
  return (
    <Page
      eyebrow="Exams"
      title="Enter marks"
      description={`Maximum: ${formatScore(data.paper.maximum)} · ${t('Zero and absent are different results.')}`}
    >
      {unsaved.prompt}
      <Alert error={action.error ?? error} />
      {data.groups.length > 0 && (
        <div className="group-tabs" role="tablist" aria-label={t('Filter by group')}>
          <button
            type="button"
            role="tab"
            aria-selected={!selectedGroup}
            className={!selectedGroup ? 'active' : ''}
            onClick={() => handleGroupChange('')}
          >
            <span>{t('All groups')}</span>
          </button>
          {data.groups.map((g) => (
            <button
              type="button"
              key={g.id}
              role="tab"
              aria-selected={selectedGroup === g.id}
              className={selectedGroup === g.id ? 'active' : ''}
              onClick={() => handleGroupChange(g.id)}
            >
              <span>{g.name}</span>
              <span className="chip-count">{g.count}</span>
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
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
        <fieldset disabled={action.isPending} className="form-fields">
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
                        <small>
                          {row.identifier || t('Student')}
                          {row.group_name ? ` · ${row.group_name}` : ''}
                        </small>
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
                          setChanges((all) => ({
                            ...all,
                            [row.student_id]: {
                              ...current,
                              status,
                              value: status === 'scored' ? current.value : '',
                            },
                          }));
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
                            [row.student_id]: {
                              ...current,
                              status: 'scored',
                              value: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty
                title={selectedGroup ? 'No students in this group' : 'No participants'}
                description={
                  selectedGroup
                    ? 'No students from this group are participating in this exam.'
                    : 'Add students from a group on the exam page first.'
                }
                action={
                  !selectedGroup && (
                    <Link className="button primary" to={`/exams/${exam}`}>
                      {t('Add participating groups')}
                    </Link>
                  )
                }
              />
            )}
          </section>
          <div className="form-actions">
            <span aria-live="polite">
              {dirty ? `${Object.keys(changes).length} ${t('Unsaved changes')}` : null}
            </span>
            <div className="actions">
              {dirty && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setChanges({});
                    setError(null);
                    action.reset();
                  }}
                >
                  {t('Discard changes')}
                </Button>
              )}
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
        </fieldset>
      </form>
    </Page>
  );
}
