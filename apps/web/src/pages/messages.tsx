import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
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
import { request, useAction, useCenter, useData, useChoices, resetInputError } from '../api';
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
  SearchableSelect,
  useUnsaved,
  useListParams,
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
  const { params, update } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const [deletingCampaign, setDeletingCampaign] = useState<Campaign | null>(null);
  const list = useData<Paged<Campaign>>(
    `/campaigns?cursor=${encodeURIComponent(cursor)}`,
    true,
    undefined,
    true,
  );
  const action = useAction();
  const { permissions, center } = useCenter();
  const { t, locale } = useLocale();
  return (
    <Page
      eyebrow="EVERY UPDATE, ACCOUNTED FOR"
      title="Messages"
      action={
        permissions.includes('messages.create') && (
          <Link className="button primary" to="/messages/new">
            <Plus size={18} />
            {t('New message')}
          </Link>
        )
      }
    >
      <State query={list}>
        {list.data?.items.length ? (
          <section className="panel flush">
            {list.data.items.map((campaign) => (
              <div className="record-row message-record" key={campaign.id}>
                <Link className="record-row-content grow" to={`/messages/${campaign.id}`}>
                  <span className="record-icon">
                    <MessageSquareText size={20} />
                  </span>
                  <div className="grow">
                    <div className="message-title-line">
                      <strong title={campaign.name}>{campaign.name}</strong>
                      <Badge status={campaign.state} />
                    </div>
                    <small>
                      {dateTime(campaign.created_at, center.timezone, locale)} · {campaign.total}{' '}
                      {t('messages ·')} {campaign.delivered} {t('delivered')}
                    </small>
                  </div>
                </Link>
                {permissions.includes('messages.cancel') &&
                  !['queued', 'processing'].includes(campaign.state) && (
                    <Button
                      variant="ghost"
                      className="danger-icon-btn"
                      aria-label={`Delete ${campaign.name}`}
                      onClick={() => {
                        action.reset();
                        setDeletingCampaign(campaign);
                      }}
                    >
                      <Trash2 size={17} />
                    </Button>
                  )}
                <Link
                  to={`/messages/${campaign.id}`}
                  className="row-arrow"
                  aria-label={`View ${campaign.name}`}
                >
                  →
                </Link>
              </div>
            ))}
          </section>
        ) : (
          <Empty
            title="No messages yet"
            description="Prepare a result update or an announcement to get started."
          />
        )}
        <NextPage next={list.data?.next} onNext={(cursor) => update({ cursor })} />
      </State>
      <Dialog
        title="Delete campaign"
        open={deletingCampaign !== null}
        onClose={() => setDeletingCampaign(null)}
      >
        {deletingCampaign && (
          <div>
            <p>
              {t('Are you sure you want to permanently delete')}{' '}
              <strong>{deletingCampaign.name}</strong>?
            </p>
            <p className="muted">
              {t(
                'This will permanently remove this message campaign and all its message records. This action cannot be undone.',
              )}
            </p>
            <Alert error={action.error} />
            <div className="actions">
              <Button type="button" variant="secondary" onClick={() => setDeletingCampaign(null)}>
                {t('Cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={action.isPending}
                onClick={() =>
                  action.mutate(
                    { path: `/campaigns/${deletingCampaign.id}`, method: 'DELETE' },
                    {
                      onSuccess: () => {
                        setDeletingCampaign(null);
                        void list.refetch();
                      },
                    },
                  )
                }
              >
                <Trash2 size={16} />
                {t('Delete campaign')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
function Compose() {
  const [params] = useSearchParams();
  const { t } = useLocale();
  const { permissions, centerId } = useCenter();
  const navigate = useNavigate();
  const [scope, setScope] = useState<TemplateScope>(
    permissions.includes('results.read') && permissions.includes('exams.read')
      ? 'summary'
      : 'announcement',
  );
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
  const groups = useChoices<Catalog>(
    '/catalog?kind=group',
    scope === 'announcement' && permissions.includes('groups.read'),
  );
  const examGroups = useQueries({
    queries: (scope !== 'announcement' && !targetStudent ? selectedExams : []).map((id) => ({
      queryKey: ['data', centerId, `/exams/${id}`],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        request<{ papers: Paper[]; groups: { id: string; name: string }[] }>(
          `/c/${centerId}/exams/${id}`,
          'GET',
          undefined,
          signal,
        ),
    })),
  });
  const groupOptions =
    scope === 'announcement'
      ? (groups.data?.items ?? [])
      : Array.from(
          new Map(examGroups.flatMap((query) => query.data?.groups ?? []).map((g) => [g.id, g])),
          ([, group]) => group,
        ).sort((a, b) => a.name.localeCompare(b.name));
  const allGroupsLabel =
    scope === 'announcement'
      ? t('All students included (no batch filter)')
      : t('All exam participants');
  const templates = useChoices<Template>('/templates', permissions.includes('templates.read'));
  const firstExam = selectedExams[0];
  const details = useData<{ papers: Paper[] }>(
    `/exams/${firstExam ?? ''}`,
    scope === 'subject' && Boolean(firstExam),
  );
  return (
    <Page eyebrow="PERSONAL, WITHOUT THE REPETITION" title="New message">
      {unsaved.prompt}
      <form
        className="compose-layout"
        onChange={() => {
          resetInputError(action);
          setDirty(true);
        }}
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
        <fieldset className="form-fields" disabled={action.isPending}>
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
                  setSelectedGroups([]);
                  if (nextScope === 'subject') setSelectedExams((all) => all.slice(0, 1));
                  setPaper('');
                  setBody('');
                }}
              >
                <option
                  value="summary"
                  disabled={
                    !permissions.includes('results.read') || !permissions.includes('exams.read')
                  }
                >
                  {t('Combined results')}
                </option>
                <option
                  value="subject"
                  disabled={
                    !permissions.includes('results.read') || !permissions.includes('exams.read')
                  }
                >
                  {t('Subject result')}
                </option>
                <option value="announcement">{t('Announcement')}</option>
              </select>
            </Field>
            {scope !== 'announcement' && (
              <Field label="Select exams">
                <SearchableSelect
                  items={exams.data?.items ?? []}
                  selected={selectedExams}
                  onChange={(next) => {
                    resetInputError(action);
                    setSelectedExams(next);
                    setSelectedGroups([]);
                    setPaper('');
                    setDirty(true);
                  }}
                  single={scope === 'subject'}
                  placeholder={t('Search exams…')}
                  query={exams}
                  emptyLabel={scope === 'subject' ? t('Choose an exam…') : t('Choose exams…')}
                  summaryFormatter={(chosen) => {
                    if (chosen.length === 0) {
                      return scope === 'subject' ? t('Choose an exam…') : t('Choose exams…');
                    }
                    if (chosen.length === 1) return chosen[0]?.name ?? '';
                    const names = chosen
                      .map((c) => c.name)
                      .slice(0, 2)
                      .join(', ');
                    return `${chosen.length} ${t('exams selected')} (${names}${chosen.length > 2 ? ', …' : ''})`;
                  }}
                />
              </Field>
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
            {scope !== 'announcement' && permissions.includes('exams.read') && (
              <State query={exams} compact>
                {null}
              </State>
            )}
            {scope === 'subject' && firstExam && (
              <State query={details} compact>
                {null}
              </State>
            )}
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
              {targetStudent ? (
                <p className="notice">
                  {t('Only the selected student’s eligible contacts will be included.')}
                </p>
              ) : (
                <>
                  {examGroups.map((query, index) => (
                    <State key={selectedExams[index]} query={query} compact>
                      {null}
                    </State>
                  ))}
                  <Field
                    label="Groups"
                    hint={
                      scope === 'announcement'
                        ? 'Leave empty to include all eligible students.'
                        : 'Leave empty to include all participants in the selected exams.'
                    }
                  >
                    <SearchableSelect
                      items={examGroups.every((query) => query.isSuccess) ? groupOptions : []}
                      selected={selectedGroups}
                      onChange={(next) => {
                        resetInputError(action);
                        setSelectedGroups(next);
                        setDirty(true);
                      }}
                      single={false}
                      placeholder={t('Search batches…')}
                      {...(scope === 'announcement' ? { query: groups } : {})}
                      emptyLabel={allGroupsLabel}
                      summaryFormatter={(chosen) => {
                        if (chosen.length === 0) return allGroupsLabel;
                        if (chosen.length === 1) return chosen[0]?.name ?? '';
                        const names = chosen
                          .map((c) => c.name)
                          .slice(0, 2)
                          .join(', ');
                        return `${chosen.length} ${t('batches selected')} (${names}${chosen.length > 2 ? ', …' : ''})`;
                      }}
                    />
                  </Field>
                </>
              )}
            </div>
            <p className="muted recipients-note">
              {t('Active permitted contacts only. Pending marks excluded, duplicates auto-merged.')}
            </p>
          </section>
          <section className="panel">
            <div className="step-title">
              <span>03</span>
              <h2>{t('Message')}</h2>
            </div>
            <Field label="Templates">
              <select
                key={scope}
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
            {permissions.includes('templates.read') && (
              <State query={templates} compact>
                <MoreChoices query={templates} />
              </State>
            )}
            <VariableEditor
              body={body}
              setBody={(value) => {
                setBody(value);
                setDirty(true);
              }}
              scope={scope}
            />
          </section>
          <Alert error={action.error} />
          <div className="form-actions">
            <Link className="button secondary" to="/messages">
              {t('Cancel')}
            </Link>
            <Button
              type="submit"
              busy={action.isPending}
              disabled={
                !body ||
                (scope !== 'announcement' && !selectedExams.length) ||
                (scope === 'subject' && !paper)
              }
            >
              {t('Prepare preview')}
              <ArrowRight size={17} />
            </Button>
          </div>
        </fieldset>
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
  estimated_segments: number;
  selection: unknown;
  scheduled_timezone: string;
  delivery_checking: number;
  delivery_unconfirmed: number;
}
function CampaignDetail() {
  const { id = '' } = useParams();
  const { permissions, center } = useCenter();
  const { t, locale } = useLocale();
  const { params, update } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const campaign = useData<CampaignData>(`/campaigns/${id}`, true, (data) =>
    !data || ['preparing', 'queued', 'processing'].includes(data.state)
      ? 5000
      : data.state === 'scheduled'
        ? 60000
        : data.delivery_checking > 0
          ? 60000
          : false,
  );
  const messages = useData<Paged<Message>>(
    `/campaigns/${id}/messages?cursor=${cursor}`,
    permissions.includes('messages.read_content'),
    campaign.data?.state === 'preparing' || campaign.data?.state === 'processing'
      ? 5000
      : campaign.data && campaign.data.delivery_checking > 0
        ? 60000
        : undefined,
    true,
  );
  const action = useAction();
  const retry = useAction();
  const canReadContent = permissions.includes('messages.read_content');
  const campaignState = campaign.data?.state;
  const refreshMessages = messages.refetch;
  useEffect(() => {
    if (canReadContent && campaignState) void refreshMessages();
  }, [
    canReadContent,
    campaignState,
    campaign.data?.delivered,
    campaign.data?.failed,
    campaign.data?.delivery_checking,
    refreshMessages,
  ]);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'send' | 'retry' | 'delete' | 'cancel' | null>(null);
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState('');
  const [localError, setLocalError] = useState<unknown>(null);
  function clearFeedback() {
    setLocalError(null);
    action.reset();
    retry.reset();
  }
  function changeConfirmation(next: typeof confirm) {
    clearFeedback();
    setConfirm(next);
  }
  const [selected, setSelected] = useState<string[]>([]);
  const [showExclusions, setShowExclusions] = useState(false);
  const edit = useAction();
  const [editing, setEditing] = useState<{ message: Message; body: string } | null>(null);
  const editUnsaved = useUnsaved(editing !== null);
  const [exclusionCursor, setExclusionCursor] = useState('');
  const exclusions = useData<Paged<{ student_id: string; student_name: string; reason: string }>>(
    `/campaigns/${id}/exclusions?cursor=${exclusionCursor}`,
    showExclusions && canReadContent,
    undefined,
    true,
  );
  const [rebuildKey] = useState(() => crypto.randomUUID());
  const [resend, setResend] = useState(() => ({ selection: '', key: crypto.randomUUID() }));
  const resendSelection = [...selected].sort().join(',');
  if (resend.selection !== resendSelection)
    setResend({ selection: resendSelection, key: crypto.randomUUID() });
  const item = campaign.data;
  return (
    <Page
      eyebrow="Messages"
      title={item?.name ?? 'Review messages'}
      action={item && <Badge status={item.state} />}
    >
      <State query={campaign}>
        {item && (
          <>
            {confirm === null && <Alert error={action.error ?? retry.error ?? localError} />}
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
            {item.delivery_unconfirmed > 0 && (
              <p className="notice">
                {item.delivery_unconfirmed} ·{' '}
                {t(
                  'Accepted · delivery unconfirmed. Automatic checks have ended; these messages will not be resent.',
                )}
              </p>
            )}
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
                  <State query={exclusions}>
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
              <section className="panel send-review" aria-labelledby="send-review-title">
                <div>
                  <h2 id="send-review-title">{t('Review messages')}</h2>
                  <p className="muted">
                    {t('Review the personalized messages below before sending.')}
                  </p>
                </div>
                <div className="send-controls">
                  {permissions.includes('messages.schedule') && (
                    <fieldset className="send-timing">
                      <legend>{t('Send timing')}</legend>
                      <label className="choice">
                        <input
                          type="radio"
                          name="send-timing"
                          checked={!scheduled}
                          disabled={!permissions.includes('messages.send')}
                          onChange={() => {
                            clearFeedback();
                            setScheduled(false);
                          }}
                        />
                        {t('Send now')}
                      </label>
                      <label className="choice">
                        <input
                          type="radio"
                          name="send-timing"
                          checked={scheduled}
                          onChange={() => {
                            clearFeedback();
                            setScheduled(true);
                          }}
                        />
                        {t('Schedule')}
                      </label>
                    </fieldset>
                  )}
                  {scheduled && (
                    <Field
                      label="Send date and time"
                      hint={
                        center.timezone === 'Asia/Dhaka'
                          ? t('Bangladesh time (UTC+6)')
                          : `${t('Timezone:')} ${center.timezone}`
                      }
                    >
                      <input
                        type="datetime-local"
                        value={date}
                        onChange={(e) => {
                          clearFeedback();
                          setDate(e.target.value);
                        }}
                        required
                      />
                    </Field>
                  )}
                  <Button
                    className="send-review-submit"
                    disabled={
                      editing !== null ||
                      !item.total ||
                      (scheduled && !date) ||
                      !permissions.includes(scheduled ? 'messages.schedule' : 'messages.send')
                    }
                    onClick={() => changeConfirmation('send')}
                  >
                    <Send size={17} />
                    {t(scheduled ? 'Schedule messages' : 'Send messages')}
                  </Button>
                </div>
                <details className="sms-details">
                  <summary>{t('SMS details')}</summary>
                  <p className="muted">
                    {t(
                      'SMS acceptance is not proof of delivery. Segment counts are estimates; the provider determines final charges.',
                    )}
                  </p>
                </details>
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
                <State query={messages}>
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
                          {item.state === 'ready_for_review' &&
                            message.state === 'pending' &&
                            permissions.includes('messages.create') && (
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  edit.reset();
                                  setEditing({ message, body: message.body });
                                }}
                              >
                                {t('Edit message')}
                              </Button>
                            )}
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
                              busy={
                                action.isPending &&
                                action.variables?.path ===
                                  `/campaigns/${id}/messages/${message.id}/refresh`
                              }
                              disabled={action.isPending}
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
                  <NextPage next={messages.data?.next} onNext={(cursor) => update({ cursor })} />
                </State>
              ) : (
                <p className="muted">{t('Your role does not allow viewing message content.')}</p>
              )}
            </section>
            {selected.length > 0 && (
              <div className="actions">
                <Button variant="secondary" onClick={() => changeConfirmation('retry')}>
                  {t('Review resend (')}
                  {selected.length})
                </Button>
              </div>
            )}
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
                  <div className="actions">
                    {!['completed', 'cancelled'].includes(item.state) && (
                      <Button variant="secondary" onClick={() => changeConfirmation('cancel')}>
                        {t('Cancel sending')}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      disabled={['queued', 'processing'].includes(item.state)}
                      onClick={() => changeConfirmation('delete')}
                    >
                      <Trash2 size={16} />
                      {t('Delete campaign')}
                    </Button>
                  </div>
                </div>
              </section>
            )}
            {editUnsaved.prompt}
            <Dialog
              title="Edit message"
              open={editing !== null}
              onClose={() => {
                if (!edit.isPending) setEditing(null);
              }}
            >
              {editing && (
                <form
                  onChange={() => resetInputError(edit)}
                  onSubmit={(event) => {
                    event.preventDefault();
                    edit.mutate(
                      {
                        path: `/campaigns/${id}/messages/${editing.message.id}`,
                        method: 'PUT',
                        body: { body: editing.body, original_body: editing.message.body },
                      },
                      {
                        onSuccess: () => {
                          void Promise.all([campaign.refetch(), messages.refetch()]).then(() => {
                            setEditing(null);
                          });
                        },
                      },
                    );
                  }}
                >
                  <p>
                    {editing.message.student_name} · {editing.message.phone}
                  </p>
                  <p className="muted">
                    {t(
                      'Only this outgoing message changes. Recorded marks and saved templates stay unchanged.',
                    )}
                  </p>
                  <Field label="Message">
                    <textarea
                      value={editing.body}
                      onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                      rows={8}
                      maxLength={4000}
                      required
                      disabled={edit.isPending}
                    />
                  </Field>
                  <small>
                    {estimateSegments(editing.body).segments} {t('estimated segments')}
                  </small>
                  <Alert error={edit.error} />
                  <div className="actions">
                    <Button
                      variant="secondary"
                      disabled={edit.isPending}
                      onClick={() => setEditing(null)}
                    >
                      {t('Cancel')}
                    </Button>
                    <Button
                      type="submit"
                      busy={edit.isPending}
                      disabled={!editing.body.trim() || item.state !== 'ready_for_review'}
                    >
                      {t('Save message')}
                    </Button>
                  </div>
                </form>
              )}
            </Dialog>
            <Dialog
              title={
                confirm === 'send'
                  ? scheduled
                    ? 'Confirm schedule'
                    : 'Confirm sending'
                  : confirm === 'retry'
                    ? 'Review resend'
                    : confirm === 'cancel'
                      ? 'Cancel sending'
                      : 'Delete campaign'
              }
              open={confirm !== null}
              onClose={() => changeConfirmation(null)}
            >
              {confirm === 'send' ? (
                <div>
                  <p>
                    {t('Messages')}: {item.total}
                  </p>
                  <p>
                    <strong>
                      {t('Estimated cost')}: ৳
                      {new Intl.NumberFormat(locale, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format((item.estimated_segments * 35) / 100)}
                    </strong>
                  </p>
                  <p className="muted">
                    {t('Based on ৳0.35 per segment. Final charges depend on the provider.')}
                  </p>
                </div>
              ) : (
                <p>
                  {confirm === 'retry'
                    ? 'An uncertain message may already have reached the recipient. Sending again can deliver and charge twice. A new reviewable campaign will be created for only the selected messages.'
                    : confirm === 'cancel'
                      ? t('Stop unsent messages? Already submitted messages cannot be recalled.')
                      : 'Are you sure you want to permanently delete this message campaign and all its message records? This cannot be undone.'}
                </p>
              )}
              <Alert error={action.error ?? retry.error ?? localError} />
              <div className="actions">
                <Button variant="secondary" onClick={() => changeConfirmation(null)}>
                  {t('Back')}
                </Button>
                <Button
                  busy={action.isPending || retry.isPending}
                  disabled={confirm === 'send' && editing !== null}
                  variant={confirm === 'delete' || confirm === 'cancel' ? 'danger' : 'primary'}
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
                            idempotency_key: resend.key,
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
                        path: `/campaigns/${id}/${confirm === 'cancel' ? 'cancel' : 'approve'}`,
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
                        : confirm === 'cancel'
                          ? 'Cancel sending'
                          : 'Delete campaign',
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
