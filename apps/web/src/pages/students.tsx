import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { Plus, Search, Trash2, Users, Send } from 'lucide-react';
import type { Catalog, Contact, Page as Paged, Student } from '@coaching/domain';
import { useAction, useCenter, useData, useChoices, resetInputError } from '../api';
import { useLocale } from '../i18n';
import {
  Alert,
  Button,
  Dialog,
  Empty,
  Field,
  NextPage,
  Page,
  State,
  useUnsaved,
  useDraftSnapshot,
  useListParams,
  SearchableSelect,
} from '../ui';

export default function StudentPages() {
  return (
    <Routes>
      <Route index element={<Students />} />
      <Route path="new" element={<Editor />} />
      <Route path=":id" element={<StudentDetail />} />
      <Route path=":id/edit" element={<Editor />} />
    </Routes>
  );
}
interface StudentsData extends Paged<Student> {
  groups?: { id: string; name: string; count: number }[];
}
function Students() {
  const { permissions } = useCenter();
  const { t } = useLocale();
  const action = useAction();
  const { params, update } = useListParams();
  const query = params.get('q') ?? '';
  const cursor = params.get('cursor') ?? '';
  const selectedGroup = params.get('group') ?? '';
  const [search, setSearch] = useState(query);
  const [appliedSearch, setAppliedSearch] = useState(query);
  if (appliedSearch !== query) {
    setAppliedSearch(query);
    setSearch(query);
  }
  const [deletingStudent, setDeletingStudent] = useState<Student | null>(null);
  const students = useData<StudentsData>(
    `/students?q=${encodeURIComponent(query)}&group_id=${encodeURIComponent(selectedGroup)}&cursor=${encodeURIComponent(cursor)}`,
    true,
    undefined,
    true,
  );

  const handleGroupChange = (gid: string) => {
    update({ group: gid, cursor: '' });
  };

  return (
    <Page
      eyebrow="YOUR COMMUNITY"
      title="Students"
      action={
        permissions.includes('students.create') && (
          <Link className="button primary" to="/students/new">
            <Plus size={18} />
            {t('Add student')}
          </Link>
        )
      }
    >
      <form
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: search, cursor: '' });
        }}
      >
        <Search size={20} />
        <input
          aria-label={t('Search')}
          placeholder="Search by student name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="secondary" type="submit">
          {t('Search')}
        </Button>
      </form>
      {(students.data?.groups?.length ?? 0) > 0 && (
        <div className="group-tabs" role="tablist" aria-label={t('Filter by group')}>
          <button
            type="button"
            role="tab"
            aria-selected={!selectedGroup}
            className={!selectedGroup ? 'active' : ''}
            onClick={() => handleGroupChange('')}
          >
            <span>{t('All students')}</span>
          </button>
          {students.data?.groups?.map((g) => (
            <button
              type="button"
              key={g.id}
              role="tab"
              aria-selected={selectedGroup === g.id}
              className={selectedGroup === g.id ? 'active' : ''}
              onClick={() => handleGroupChange(g.id)}
            >
              <span>{g.id === 'unassigned' ? t('No group') : g.name}</span>
              <span className="chip-count">{g.count}</span>
            </button>
          ))}
        </div>
      )}
      <State query={students}>
        {students.data?.items.length ? (
          <section className="panel flush">
            <div className="record-list">
              {students.data.items.map((student) => (
                <div className="record-row" key={student.id}>
                  <Link className="record-row-content grow" to={`/students/${student.id}`}>
                    <span className="initial-avatar">{student.name.slice(0, 1)}</span>
                    <div className="grow">
                      <strong>{student.name}</strong>
                      <small>
                        {student.identifier || t('No identifier')}
                        {student.group_name ? ` · ${student.group_name}` : ''}
                      </small>
                    </div>
                  </Link>
                  {permissions.includes('students.archive') && (
                    <Button
                      variant="ghost"
                      className="danger-icon-btn"
                      aria-label={`Delete ${student.name}`}
                      onClick={() => {
                        action.reset();
                        setDeletingStudent(student);
                      }}
                    >
                      <Trash2 size={17} />
                    </Button>
                  )}
                  <Link
                    to={`/students/${student.id}`}
                    className="row-arrow"
                    aria-label={`View ${student.name}`}
                  >
                    →
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <Empty
            title={
              query
                ? 'No matching records'
                : selectedGroup
                  ? 'No students in this group'
                  : 'No records yet'
            }
            description={
              query
                ? 'Clear your search or try another name.'
                : selectedGroup
                  ? 'No students have been assigned to this group yet.'
                  : 'Create your first record to get started.'
            }
          />
        )}
        <NextPage next={students.data?.next} onNext={(cursor) => update({ cursor })} />
      </State>
      <Dialog
        title="Delete student"
        open={deletingStudent !== null}
        onClose={() => setDeletingStudent(null)}
      >
        {deletingStudent && (
          <div>
            <p>
              {t('Are you sure you want to permanently delete')}{' '}
              <strong>{deletingStudent.name}</strong>?{' '}
              {t(
                'All their contacts, group memberships, and recorded exam marks will be permanently removed. This action cannot be undone.',
              )}
            </p>
            <Alert error={action.error} />
            <div className="actions">
              <Button type="button" variant="secondary" onClick={() => setDeletingStudent(null)}>
                {t('Cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={action.isPending}
                onClick={() =>
                  action.mutate(
                    { path: `/students/${deletingStudent.id}`, method: 'DELETE' },
                    {
                      onSuccess: () => {
                        setDeletingStudent(null);
                        void students.refetch();
                      },
                    },
                  )
                }
              >
                <Trash2 size={16} />
                {t('Delete student')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Page>
  );
}
interface Detail extends Student {
  contacts: Contact[];
  groups: { group_id: string }[];
}
function StudentDetail() {
  const { id = '' } = useParams();
  const student = useData<Detail>(`/students/${id}`);
  const { permissions } = useCenter();
  const { t } = useLocale();
  const [confirm, setConfirm] = useState(false);
  const [suppression, setSuppression] = useState<Contact | null>(null);
  const action = useAction();
  const navigate = useNavigate();
  return (
    <Page
      eyebrow="Student"
      title={student.data?.name ?? 'Profile'}
      action={
        <div className="page-actions">
          {permissions.includes('students.update') && (
            <Link className="button secondary" to={`/students/${id}/edit`}>
              {t('Edit')}
            </Link>
          )}
          {permissions.includes('messages.create') && (
            <Link className="button primary" to={`/messages/new?student=${id}`}>
              <Send size={16} />
              {t('Send message')}
            </Link>
          )}
        </div>
      }
    >
      <State query={student}>
        {student.data && (
          <>
            <section className="panel profile-summary">
              <span className="initial-avatar large">{student.data.name.slice(0, 1)}</span>
              <div>
                <h2>{student.data.name}</h2>
                <p className="muted">
                  {student.data.identifier || t('No identifier')} · {student.data.groups.length}{' '}
                  {t('groups')}
                </p>
              </div>
            </section>
            <section className="panel">
              <div className="section-header">
                <div>
                  <h2>{t('Contacts')}</h2>
                  <p className="muted">
                    {t('Phone numbers for SMS notifications and guardian updates')}
                  </p>
                </div>
              </div>
              {student.data.contacts.length ? (
                student.data.contacts.map((contact) => (
                  <div
                    className="record-row contact-record-row"
                    key={`${contact.id}-${contact.audience}`}
                  >
                    <div className="contact-headline">
                      <strong>{t(contact.audience === 'student' ? 'Student' : 'Guardian')}</strong>
                      <span
                        className={`badge ${contact.permitted && !contact.suppressed ? 'accepted' : 'paused'}`}
                      >
                        {t(
                          contact.suppressed
                            ? 'Number blocked'
                            : contact.permitted
                              ? 'SMS permitted'
                              : 'No SMS permission',
                        )}
                      </span>
                    </div>
                    <small className="contact-phone">{contact.phone}</small>
                    {permissions.includes('students.update') && (
                      <Button
                        variant="ghost"
                        className="contact-action-btn"
                        onClick={() => {
                          action.reset();
                          setSuppression(contact);
                        }}
                      >
                        {t(contact.suppressed ? 'Unblock number' : 'Block number')}
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <p className="muted">
                  {t('Add a contact with permission before sending results.')}
                </p>
              )}
            </section>
            {permissions.includes('students.archive') && (
              <section className="panel danger-panel">
                <div className="section-header">
                  <div>
                    <h2>{t('Delete student')}</h2>
                    <p className="muted">
                      {t(
                        'Permanently delete this student record. All their contacts, group memberships, and recorded exam marks will be removed.',
                      )}
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => {
                      action.reset();
                      setConfirm(true);
                    }}
                  >
                    <Trash2 size={16} />
                    {t('Delete student')}
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </State>
      <Dialog
        title={suppression?.suppressed ? 'Unblock number' : 'Block number'}
        open={suppression !== null}
        onClose={() => setSuppression(null)}
      >
        <p>{suppression?.phone}</p>
        <p>
          {t(
            'Blocking this number stops SMS for every student sharing it in this center. Unblocking does not override each student’s contact permission.',
          )}
        </p>
        <Alert error={action.error} />
        <Button
          variant="danger"
          busy={action.isPending}
          onClick={() => {
            if (suppression)
              action.mutate(
                {
                  path: `/contacts/${suppression.id}/suppression`,
                  method: 'PATCH',
                  body: {
                    suppressed: !suppression.suppressed,
                    expected: Boolean(suppression.suppressed),
                  },
                },
                { onSuccess: () => setSuppression(null) },
              );
          }}
        >
          {t('Continue')}
        </Button>
      </Dialog>
      <Dialog title="Delete student" open={confirm} onClose={() => setConfirm(false)}>
        <p>
          {t('Are you sure you want to permanently delete')} <strong>{student.data?.name}</strong>?{' '}
          {t(
            'All their contacts, group memberships, and recorded exam marks will be permanently removed. This action cannot be undone.',
          )}
        </p>
        <Alert error={action.error} />
        <div className="actions">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="danger"
            busy={action.isPending}
            onClick={() =>
              action.mutate(
                { path: `/students/${id}`, method: 'DELETE' },
                {
                  onSuccess: () => {
                    void navigate('/students');
                  },
                },
              )
            }
          >
            {t('Delete student')}
          </Button>
        </div>
      </Dialog>
    </Page>
  );
}
function Editor() {
  const { id } = useParams();
  const student = useData<Detail>(`/students/${id ?? ''}`, Boolean(id));
  return id ? (
    <State query={student}>
      {student.data && <StudentForm key={student.data.id} initial={student.data} />}
    </State>
  ) : (
    <StudentForm />
  );
}
function StudentForm({ initial: incoming }: { initial?: Detail }) {
  const [dirty, setDirty] = useState(false);
  const initial = useDraftSnapshot(incoming, dirty);
  const [contacts, setContacts] = useState(
    () =>
      initial?.contacts.map((c) => ({
        phone: c.phone,
        audience: c.audience,
        permitted: Boolean(c.permitted),
      })) ?? [{ phone: '', audience: 'guardian' as const, permitted: true }],
  );
  const [groups, setGroups] = useState<string[]>(initial?.groups.map((g) => g.group_id) ?? []);
  const [loaded, setLoaded] = useState(initial);
  if (loaded !== initial) {
    setLoaded(initial);
    setContacts(
      initial?.contacts.map((c) => ({
        phone: c.phone,
        audience: c.audience,
        permitted: Boolean(c.permitted),
      })) ?? [{ phone: '', audience: 'guardian', permitted: true }],
    );
    setGroups(initial?.groups.map((g) => g.group_id) ?? []);
  }
  const unsaved = useUnsaved(dirty);
  const { permissions } = useCenter();
  const available = useChoices<Catalog>('/catalog?kind=group', permissions.includes('groups.read'));
  const { t } = useLocale();
  const action = useAction();
  const navigate = useNavigate();
  const writable = permissions.includes(`students.${initial ? 'update' : 'create'}`);
  const updateContact = (index: number, patch: Partial<(typeof contacts)[number]>) => {
    resetInputError(action);
    setContacts((all) => all.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setDirty(true);
  };
  return (
    <Page eyebrow="Students" title={initial ? 'Edit student' : 'Add student'}>
      {unsaved.prompt}
      <form
        key={initial?.version ?? 'new'}
        className="form-stack"
        onChange={() => {
          resetInputError(action);
          setDirty(true);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          action.mutate(
            {
              path: initial ? `/students/${initial.id}` : '/students',
              method: initial ? 'PUT' : 'POST',
              body: {
                name: form.get('name'),
                identifier: form.get('identifier'),
                contacts,
                group_ids: groups,
                ...(initial ? { version: initial.version } : {}),
              },
            },
            {
              onSuccess: ({ id }) => {
                setDirty(false);
                unsaved.allowNavigation();
                void navigate(`/students/${id}`);
              },
            },
          );
        }}
      >
        <fieldset disabled={action.isPending || !writable} className="form-fields">
          <section className="panel">
            <div className="section-header">
              <h2>{t('Profile')}</h2>
              <Users size={21} />
            </div>
            <div className="form-grid">
              <Field label="Name">
                <input name="name" defaultValue={initial?.name} required maxLength={160} />
              </Field>
              <Field label="Identifier / roll (optional)">
                <input name="identifier" defaultValue={initial?.identifier} maxLength={80} />
              </Field>
            </div>
          </section>
          <section className="panel">
            <div className="section-header">
              <h2>{t('Contacts')}</h2>
              <Button
                type="button"
                variant="secondary"
                disabled={contacts.length >= 10}
                onClick={() => {
                  setContacts((all) => [
                    ...all,
                    { phone: '', audience: 'guardian', permitted: true },
                  ]);
                  setDirty(true);
                }}
              >
                <Plus size={16} />
                {t('Add contact')}
              </Button>
            </div>
            {contacts.map((contact, i) => (
              <div className="contact-editor" key={i}>
                <div className="form-grid">
                  <Field label="Phone number">
                    <input
                      type="tel"
                      value={contact.phone}
                      required
                      onChange={(e) => updateContact(i, { phone: e.target.value })}
                    />
                  </Field>
                  <Field label="Recipients">
                    <select
                      value={contact.audience}
                      onChange={(e) =>
                        updateContact(i, {
                          audience: e.target.value === 'student' ? 'student' : 'guardian',
                        })
                      }
                    >
                      <option value="guardian">{t('Guardian')}</option>
                      <option value="student">{t('Student')}</option>
                    </select>
                  </Field>
                </div>
                <div className="contact-bottom">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={contact.permitted}
                      onChange={(event) => updateContact(i, { permitted: event.target.checked })}
                    />
                    {t('SMS permitted')}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Remove contact"
                    onClick={() => {
                      setContacts((all) => all.filter((_, index) => index !== i));
                      setDirty(true);
                    }}
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <section className="panel">
            <div className="section-header">
              <div>
                <h2>{t('Groups')}</h2>
                <p className="muted">
                  {t('Select the groups or batches this student belongs to.')}
                </p>
              </div>
            </div>
            <State query={available} compact>
              {available.data?.items.length ? (
                <SearchableSelect
                  items={available.data.items}
                  selected={groups}
                  onChange={(next) => {
                    resetInputError(action);
                    setGroups(next);
                    setDirty(true);
                  }}
                  single={false}
                  placeholder={t('Search groups…')}
                  query={available}
                  emptyLabel={t('No groups selected')}
                  summaryFormatter={(chosen) => {
                    if (chosen.length === 0) return t('No groups selected');
                    if (chosen.length === 1) return chosen[0]?.name ?? '';
                    const names = chosen
                      .map((c) => c.name)
                      .slice(0, 2)
                      .join(', ');
                    return `${chosen.length} ${t('groups selected')} (${names}${chosen.length > 2 ? ', …' : ''})`;
                  }}
                />
              ) : (
                <Link to="/groups">{t('Create a group first')}</Link>
              )}
            </State>
          </section>
          <Alert error={action.error} />
          <div className="form-actions">
            <span>{t(dirty ? 'Unsaved changes' : 'Saved')}</span>
            <div className="actions">
              <Link
                className="button secondary"
                to={initial ? `/students/${initial.id}` : '/students'}
              >
                {t('Cancel')}
              </Link>
              <Button type="submit" busy={action.isPending} disabled={!writable}>
                {t('Save')}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </Page>
  );
}
