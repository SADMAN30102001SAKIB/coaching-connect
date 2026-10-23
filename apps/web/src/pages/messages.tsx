import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowRight, Clock3, MessageSquareText, Plus, Send, Trash2 } from 'lucide-react';
import {
  estimateSegments,
  zonedTimestamp,
  type Campaign,
  type Catalog,
  type Exam,
  type Message,
  type Page as Paged,
  type Paper,
  type Template,
  type TemplateScope,
} from '@coaching/domain';
import { useAction, useCenter, useData, useChoices } from '../api';
import { useLocale } from '../i18n';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Empty,
  Field,
  NextPage,
  Page,
  State,
  dateTime,
  MoreChoices,
  useUnsaved,
} from '../ui';
import { VariableEditor } from './manage';

export default function MessagePages() {
  return (
    <Routes>
      <Route index element={<History />} />
      <Route path="new" element={<Compose />} />
      <Route path=":id" element={<CampaignDetail />} />
    </Routes>
  );
}
function History() {
  const [cursor, setCursor] = useState('');
  const list = useData<Paged<Campaign>>(`/campaigns?cursor=${encodeURIComponent(cursor)}`);
  const { permissions, center } = useCenter();
  const { t, locale } = useLocale();
  return (
    <Page
      eyebrow="EVERY UPDATE, ACCOUNTED FOR"
      title="Messages"
      description="A clear history of what was prepared, submitted, and delivered."
      action={
        permissions.includes('messages.create') && (
          <Link className="button primary" to="/messages/new">
            <Plus size={18} />
            {t('New message')}
          </Link>
        )
      }
    >
      <State pending={list.isPending} error={list.error}>
        {list.data?.items.length ? (
          <section className="panel flush">
            {list.data.items.map((campaign) => (
              <Link className="record-row" key={campaign.id} to={`/messages/${campaign.id}`}>
                <span className="record-icon">
                  <MessageSquareText size={20} />
                </span>
                <div className="grow">
                  <strong>{campaign.name}</strong>
                  <small>
                    {dateTime(campaign.created_at, center.timezone, locale)} · {campaign.total}{' '}
                    {t('messages ·')}
                    {campaign.delivered}
                    {t('delivered')}
                  </small>
                </div>
                <Badge status={campaign.state} />
              </Link>
            ))}
          </section>
        ) : (
          <Empty
            title="No messages yet"
            description="Prepare a result update or an announcement to get started."
          />
        )}
        <NextPage next={list.data?.next} onNext={setCursor} />
      </State>
    </Page>
  );
}
function Compose() {
  const [params] = useSearchParams();
  const { t } = useLocale();
  const { permissions } = useCenter();
  const navigate = useNavigate();
  const [scope, setScope] = useState<TemplateScope>('summary');
  const [body, setBody] = useState('');
  const [selectedExams, setSelectedExams] = useState<string[]>(
    params.get('exam') ? [params.get('exam') ?? ''] : [],
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const targetStudent = params.get('student');
  const [dirty, setDirty] = useState(false);
  const unsaved = useUnsaved(dirty);
  const [audience, setAudience] = useState('guardian');
  const [paper, setPaper] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const action = useAction();
  const exams = useChoices<Exam>(
    '/exams',
    scope !== 'announcement' && permissions.includes('exams.read'),
  );
  const groups = useChoices<Catalog>('/catalog?kind=group', permissions.includes('groups.read'));
  const templates = useChoices<Template>('/templates', permissions.includes('templates.read'));
  const firstExam = selectedExams[0];
  const details = useData<{ papers: Paper[] }>(
    `/exams/${firstExam ?? ''}`,
    scope === 'subject' && Boolean(firstExam),
  );
  return (
    <Page
      eyebrow="PERSONAL, WITHOUT THE REPETITION"
      title="New message"
      description="Choose the audience. Write once. Review every personalized message."
    >
      {unsaved.prompt}
      <form
        className="compose-layout"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          const computedName = (() => {
            if (scope === 'subject') {
              const selectedPaper = details.data?.papers.find((p) => p.id === paper);
              const exam = exams.data?.items.find((item) => item.id === firstExam);
              if (selectedPaper && exam) {
                return `${exam.name} - ${selectedPaper.name}`.slice(0, 160);
              }
              if (selectedPaper) return selectedPaper.name.slice(0, 160);
              if (exam) return exam.name.slice(0, 160);
              return 'Subject result';
            }
            if (scope === 'summary') {
              const chosen =
                exams.data?.items.filter((item) => selectedExams.includes(item.id)) ?? [];
              if (chosen.length > 0) {
                return chosen
                  .map((item) => item.name)
                  .join(', ')
                  .slice(0, 160);
              }
              return 'Combined results';
            }
            return 'Announcement';
          })();
          action.mutate(
            {
              path: '/campaigns',
              body: {
                name: computedName,
                scope,
                body,
                exam_ids: scope === 'announcement' ? [] : selectedExams,
                paper_id: scope === 'subject' ? paper : null,
                group_ids: targetStudent ? [] : selectedGroups,
                student_ids: targetStudent ? [targetStudent] : [],
                audience,
                idempotency_key: idempotencyKey,
              },
            },
            {
              onSuccess: ({ id }) => {
                setDirty(false);
                unsaved.allowNavigation();
                void navigate(`/messages/${id}`);
              },
            },
          );
        }}
      >
        <div>
          <section className="panel">
            <div className="step-title">
              <span>01</span>
              <h2>{t('Choose your update')}</h2>
            </div>
            <Field label="Message type">
              <select
                value={scope}
                onChange={(e) => {
                  const nextScope = e.target.value as TemplateScope;
                  setScope(nextScope);
                  if (nextScope === 'subject') setSelectedExams((all) => all.slice(0, 1));
                  setPaper('');
                  setBody('');
                }}
              >
                <option value="summary">{t('Combined results')}</option>
                <option value="subject">{t('Subject result')}</option>
                <option value="announcement">{t('Announcement')}</option>
              </select>
            </Field>
            {scope !== 'announcement' && (
              <fieldset className="field choice-fieldset">
                <legend>{t('Select exams')}</legend>
                <div className="choice-grid">
                  {exams.data?.items.map((exam) => (
                    <label className="check choice" key={exam.id}>
                      <input
                        type={scope === 'subject' ? 'radio' : 'checkbox'}
                        name="exam"
                        checked={selectedExams.includes(exam.id)}
                        onChange={(e) => {
                          setSelectedExams((all) =>
                            scope === 'subject'
                              ? [exam.id]
                              : e.target.checked
                                ? [...all, exam.id]
                                : all.filter((id) => id !== exam.id),
                          );
                          setPaper('');
                        }}
                      />
                      {exam.name}
                    </label>
                  ))}
                </div>
                <MoreChoices query={exams} />
              </fieldset>
            )}
            {scope === 'subject' && (
              <Field label="Subject">
                <select value={paper} required onChange={(e) => setPaper(e.target.value)}>
                  <option value="">{t('Choose a subject')}</option>
                  {details.data?.papers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Alert error={exams.error ?? details.error} />
          </section>
          <section className="panel">
            <div className="step-title">
              <span>02</span>
              <h2>{t('Recipients')}</h2>
            </div>
            <div className="recipients-section">
              <fieldset className="field choice-fieldset">
                <legend>{t('Send to')}</legend>
                <div className="audience-grid">
                  {(['guardian', 'student', 'both'] as const).map((item) => (
                    <label className="check choice" key={item}>
                      <input
                        type="radio"
                        name="audience"
                        value={item}
                        checked={audience === item}
                        onChange={() => setAudience(item)}
                      />
                      {t(
                        item === 'guardian' ? 'Guardian' : item === 'student' ? 'Student' : 'Both',
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="field choice-fieldset">
                <legend>{t('Groups')}</legend>
                {targetStudent ? (
                  <p className="notice">
                    {t('Only the selected student’s eligible contacts will be included.')}
                  </p>
                ) : (
                  <>
                    <p className="muted">
                      {t('Choose batches, or leave all unchecked for every eligible student.')}
                    </p>
                    <div className="choice-grid">
                      {groups.data?.items.map((group) => (
                        <label className="check choice" key={group.id}>
                          <input
                            type="checkbox"
                            checked={selectedGroups.includes(group.id)}
                            onChange={(event) =>
                              setSelectedGroups((all) =>
                                event.target.checked
                                  ? [...all, group.id]
                                  : all.filter((id) => id !== group.id),
                              )
                            }
                          />
                          {group.name}
                        </label>
                      ))}
                    </div>
                    <MoreChoices query={groups} />
                  </>
                )}
              </fieldset>
            </div>
            <p className="muted recipients-note">
              {t(
                'Only permitted, active contacts are included. Missing or pending results are excluded. Overlapping selections are deduplicated; siblings still get separate results.',
              )}
            </p>
          </section>
          <section className="panel">
            <div className="step-title">
              <span>03</span>
              <h2>{t('Message')}</h2>
            </div>
            <Field label="Templates">
              <select
                defaultValue=""
                onChange={(e) => {
                  const template = templates.data?.items.find((item) => item.id === e.target.value);
                  if (template) setBody(template.body);
                }}
              >
                <option value="">{t('Write a message or choose a saved template')}</option>
                {templates.data?.items
                  .filter((item) => item.scope === scope)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </Field>
            <MoreChoices query={templates} />
            <VariableEditor body={body} setBody={setBody} scope={scope} />
          </section>
          <Alert error={action.error} />
          <div className="sticky-actions">
            <Link className="button secondary" to="/messages">
              {t('Cancel')}
            </Link>
            <Button
              type="submit"
              busy={action.isPending}
              disabled={!body || (scope !== 'announcement' && !selectedExams.length)}
            >
              {t('Prepare preview')}
              <ArrowRight size={17} />
            </Button>
          </div>
        </div>
        <aside className="compose-aside">
          <div className="phone-preview">
            <div className="phone-notch" />
            <p className="mini-label">{t('MESSAGE PREVIEW')}</p>
            {body ? (
              <div className="sms-bubble message-text">{body}</div>
            ) : (
              <p className="muted">
                {t('Your message takes shape here. Real student previews appear in the next step.')}
              </p>
            )}
            <small>
              {body
                ? `${estimateSegments(body).segments} estimated segments before personalization`
                : 'Plain text. Personal details. No busywork.'}
            </small>
          </div>
          <div className="notice">
            <Clock3 size={19} />
            <p>
              {t('Review first. Send now or choose a time. Your phone does not need to stay open.')}
            </p>
          </div>
        </aside>
      </form>
    </Page>
  );
}
interface CampaignData extends Campaign {
  selection: unknown;
  scheduled_timezone: string;
}
function CampaignDetail() {
  const { id = '' } = useParams();
  const { permissions, center } = useCenter();
  const { t, locale } = useLocale();
  const [cursor, setCursor] = useState('');
  const campaign = useData<CampaignData>(`/campaigns/${id}`, true, (data) =>
    !data || ['preparing', 'queued', 'processing'].includes(data.state)
      ? 1000
      : data.state === 'scheduled'
        ? 60000
        : false,
  );
  const messages = useData<Paged<Message>>(
    `/campaigns/${id}/messages?cursor=${cursor}`,
    permissions.includes('messages.read_content'),
    campaign.data?.state === 'preparing' || campaign.data?.state === 'processing'
      ? 1000
      : undefined,
  );
  const action = useAction();
  const retry = useAction();
  const canReadContent = permissions.includes('messages.read_content');
  const campaignState = campaign.data?.state;
  const refreshMessages = messages.refetch;
  useEffect(() => {
    if (canReadContent && campaignState) void refreshMessages();
  }, [canReadContent, campaignState, refreshMessages]);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'send' | 'cancel' | 'retry' | 'delete' | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState('');
  const [localError, setLocalError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [showExclusions, setShowExclusions] = useState(false);
  const [exclusionCursor, setExclusionCursor] = useState('');
  const exclusions = useData<Paged<{ student_id: string; student_name: string; reason: string }>>(
    `/campaigns/${id}/exclusions?cursor=${exclusionCursor}`,
    showExclusions && canReadContent,
  );
  const [rebuildKey] = useState(() => crypto.randomUUID());
  const item = campaign.data;
  return (
    <Page
      eyebrow="Messages"
      title={item?.name ?? 'Review messages'}
      action={item && <Badge status={item.state} />}
    >
      <State pending={campaign.isPending} error={campaign.error}>
        {item && (
          <>
            <Alert error={action.error ?? retry.error ?? localError} />
            {item.reason && <Alert>{item.reason}</Alert>}
            {item.state === 'preparing' && (
              <div className="panel preparation">
                <MessageSquareText size={32} />
                <h2>{t('Preparing your messages…')}</h2>
                <p>
                  {item.total}{' '}
                  {t('personalized messages prepared so far. You can leave this page.')}
                </p>
              </div>
            )}
            <div className="stats-grid compact">
              {[
                { label: 'Recipients', value: item.total },
                { label: 'Accepted', value: item.submitted },
                { label: 'Delivered', value: item.delivered },
                { label: 'Needs checking', value: item.unknown },
                { label: 'Failed', value: item.failed },
                { label: 'Skipped', value: item.skipped },
                { label: 'Excluded students', value: item.excluded },
              ].map((stat) => (
                <div className="stat" key={stat.label}>
                  <span>{t(stat.label)}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
            {item.scheduled_at && (
              <p className="notice">
                {t('Scheduled:')}{' '}
                {dateTime(item.scheduled_at, item.scheduled_timezone || center.timezone, locale)} ·{' '}
                {item.scheduled_timezone || center.timezone}
              </p>
            )}
            {item.excluded > 0 && canReadContent && (
              <section className="panel">
                <Button variant="ghost" onClick={() => setShowExclusions((value) => !value)}>
                  {t('View excluded students (')}
                  {item.excluded})
                </Button>
                {showExclusions && (
                  <State pending={exclusions.isPending} error={exclusions.error}>
                    {exclusions.data?.items.map((student) => (
                      <div className="record-row" key={student.student_id}>
                        <div className="grow">
                          <strong>{student.student_name}</strong>
                          <small>{student.reason}</small>
                        </div>
                        <Link to={`/students/${student.student_id}`}>{t('View')}</Link>
                      </div>
                    ))}
                    <NextPage next={exclusions.data?.next} onNext={setExclusionCursor} />
                  </State>
                )}
              </section>
            )}
            {item.state === 'ready_for_review' && (
              <section className="panel">
                <div className="section-header">
                  <h2>{t('Review messages')}</h2>
                  <span className="mini-label">{t('FINAL CHECK')}</span>
                </div>
                <p>
                  {t(
                    'Check the actual messages below. SMS acceptance is not proof of delivery. Segment counts are estimates; the provider determines final charges.',
                  )}
                </p>
                {permissions.includes('messages.schedule') && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={scheduled}
                      onChange={(e) => setScheduled(e.target.checked)}
                    />
                    {t('Schedule send')}
                  </label>
                )}
                {scheduled && (
                  <Field label="Date" hint={`Timezone: ${center.timezone}`}>
                    <input
                      type="datetime-local"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      required
                    />
                  </Field>
                )}
                <Button
                  disabled={
                    !item.total ||
                    !permissions.includes(scheduled ? 'messages.schedule' : 'messages.send')
                  }
                  onClick={() => setConfirm('send')}
                >
                  <Send size={17} />
                  {t(scheduled ? 'Confirm schedule' : 'Confirm sending')}
                </Button>
              </section>
            )}
            {item.state === 'paused' && permissions.includes('messages.send') && (
              <Button
                variant="secondary"
                busy={action.isPending}
                onClick={() => action.mutate({ path: `/campaigns/${id}/resume` })}
              >
                {t('Resume pending messages')}
              </Button>
            )}
            {item.state === 'needs_review' && permissions.includes('messages.create') && (
              <Button
                variant="secondary"
                busy={retry.isPending}
                onClick={() =>
                  retry.mutate(
                    { path: `/campaigns/${id}/rebuild`, body: { idempotency_key: rebuildKey } },
                    {
                      onSuccess: (result) => {
                        void navigate(`/messages/${result.id}`);
                      },
                    },
                  )
                }
              >
                {t('Refresh unsent messages')}
              </Button>
            )}
            <section className="panel">
              <div className="section-header">
                <h2>{t('Personalized messages')}</h2>
                <span>{item.total}</span>
              </div>
              {permissions.includes('messages.read_content') ? (
                <State pending={messages.isPending} error={messages.error}>
                  {messages.data?.items.length ? (
                    <div className="message-grid">
                      {messages.data.items.map((message) => (
                        <article className="message-card" key={message.id}>
                          <div className="section-header">
                            <div>
                              <strong>{message.student_name}</strong>
                              <small>{message.phone}</small>
                            </div>
                            <Badge status={message.state} />
                          </div>
                          <p className="message-text">{message.body}</p>
                          <small>
                            {message.segments} {t('estimated segments')}
                            {message.provider_id?.startsWith('mock-')
                              ? ' · MOCK TEST — not a real SMS'
                              : ''}
                          </small>
                          {message.reason && <p className="notice">{message.reason}</p>}
                          {message.state === 'accepted' && (
                            <Button
                              variant="ghost"
                              busy={action.isPending}
                              onClick={() =>
                                action.mutate({
                                  path: `/campaigns/${id}/messages/${message.id}/refresh`,
                                })
                              }
                            >
                              {t('Refresh')}
                            </Button>
                          )}
                          {permissions.includes('messages.retry') &&
                            ['unknown', 'failed'].includes(message.state) && (
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={selected.includes(message.id)}
                                  onChange={(e) =>
                                    setSelected((all) =>
                                      e.target.checked
                                        ? [...all, message.id]
                                        : all.filter((v) => v !== message.id),
                                    )
                                  }
                                />
                                {t('Select for a new resend campaign')}
                              </label>
                            )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      {t(
                        'No eligible messages. Check contacts, permission to send, and pending marks.',
                      )}
                    </p>
                  )}
                  <NextPage next={messages.data?.next} onNext={setCursor} />
                </State>
              ) : (
                <p className="muted">{t('Your role does not allow viewing message content.')}</p>
              )}
            </section>
            <div className="actions">
              {permissions.includes('messages.cancel') &&
                !['completed', 'cancelled'].includes(item.state) && (
                  <Button variant="danger" onClick={() => setConfirm('cancel')}>
                    {t('Cancel')}
                  </Button>
                )}
              {selected.length > 0 && (
                <Button variant="secondary" onClick={() => setConfirm('retry')}>
                  {t('Review resend (')}
                  {selected.length})
                </Button>
              )}
            </div>
            {permissions.includes('messages.cancel') && (
              <section className="panel danger-panel">
                <div className="section-header">
                  <div>
                    <h2>{t('Delete campaign')}</h2>
                    <p className="muted">
                      {t(
                        'Permanently remove this message campaign and its recorded delivery history.',
                      )}
                    </p>
                  </div>
                  <Button variant="danger" onClick={() => setConfirm('delete')}>
                    <Trash2 size={16} />
                    {t('Delete campaign')}
                  </Button>
                </div>
              </section>
            )}
            <Dialog
              title={
                confirm === 'send'
                  ? scheduled
                    ? 'Confirm schedule'
                    : 'Confirm sending'
                  : confirm === 'retry'
                    ? 'Review resend'
                    : confirm === 'delete'
                      ? 'Delete campaign'
                      : 'Cancel campaign'
              }
              open={confirm !== null}
              onClose={() => setConfirm(null)}
            >
              <p>
                {confirm === 'send'
                  ? `Approve ${item.total} personalized messages? This uses your center’s SMS balance. Pending/absent records and shared numbers must be reviewed before sending.`
                  : confirm === 'retry'
                    ? 'An uncertain message may already have reached the recipient. Sending again can deliver and charge twice. A new reviewable campaign will be created for only the selected messages.'
                    : confirm === 'delete'
                      ? 'Are you sure you want to permanently delete this message campaign and all its message records? This cannot be undone.'
                      : 'Stop messages that have not started submitting? Accepted or in-flight messages cannot be recalled.'}
              </p>
              <Alert error={action.error ?? retry.error ?? localError} />
              <div className="actions">
                <Button variant="secondary" onClick={() => setConfirm(null)}>
                  {t('Back')}
                </Button>
                <Button
                  busy={action.isPending || retry.isPending}
                  variant={confirm === 'cancel' || confirm === 'delete' ? 'danger' : 'primary'}
                  onClick={() => {
                    if (confirm === 'delete') {
                      action.mutate(
                        { path: `/campaigns/${id}`, method: 'DELETE' },
                        {
                          onSuccess: () => {
                            setConfirm(null);
                            void navigate('/messages');
                          },
                        },
                      );
                      return;
                    }
                    if (confirm === 'retry') {
                      retry.mutate(
                        {
                          path: `/campaigns/${id}/retry`,
                          body: {
                            message_ids: selected,
                            acknowledge_duplicate_risk: true,
                            idempotency_key: crypto.randomUUID(),
                          },
                        },
                        {
                          onSuccess: (result) => {
                            setConfirm(null);
                            void navigate(`/messages/${result.id}`);
                          },
                        },
                      );
                      return;
                    }
                    let scheduledAt: number | null = null;
                    try {
                      if (scheduled && confirm === 'send')
                        scheduledAt = zonedTimestamp(date, center.timezone);
                      setLocalError(null);
                    } catch (error) {
                      setLocalError(error);
                      return;
                    }
                    action.mutate(
                      {
                        path: `/campaigns/${id}/${confirm === 'send' ? 'approve' : 'cancel'}`,
                        body: confirm === 'send' ? { scheduled_at: scheduledAt } : {},
                      },
                      { onSuccess: () => setConfirm(null) },
                    );
                  }}
                >
                  {t(
                    confirm === 'send'
                      ? scheduled
                        ? 'Confirm schedule'
                        : 'Confirm sending'
                      : confirm === 'retry'
                        ? 'Continue'
                        : confirm === 'delete'
                          ? 'Delete campaign'
                          : 'Cancel',
                  )}
                </Button>
              </div>
            </Dialog>
          </>
        )}
      </State>
    </Page>
  );
}
