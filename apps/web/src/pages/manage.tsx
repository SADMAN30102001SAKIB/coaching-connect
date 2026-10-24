import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Copy, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  features,
  permissions as permissionCatalog,
  requiredPermissions,
  variables,
  type Catalog,
  type Page as Paged,
  type ProviderSettings,
  type Role,
  type Student,
  type Template,
  type TemplateScope,
} from '@coaching/domain';
import { formText, useAction, useCenter, useData, useChoices } from '../api';
import { useLocale } from '../i18n';
import { BalanceCard } from '../components/BalanceCard';
import { ProfileSettings } from '../components/ProfileSettings';
import {
  Alert,
  Button,
  Dialog,
  Empty,
  Field,
  NextPage,
  Page,
  State,
  MoreChoices,
  useDraftSnapshot,
  useUnsaved,
  useListParams,
} from '../ui';

export default function ManagePages({
  section,
}: {
  section: 'group' | 'academic' | 'templates' | 'staff' | 'settings';
}) {
  switch (section) {
    case 'group':
      return <CatalogPage key="group" groups />;
    case 'academic':
      return <CatalogPage key="academic" />;
    case 'templates':
      return <Templates key="templates" />;
    case 'staff':
      return <Staff key="staff" />;
    case 'settings':
      return <SettingsPage key="settings" />;
  }
}
function CatalogPage({ groups = false }: { groups?: boolean }) {
  const { permissions } = useCenter();
  const { t } = useLocale();
  const kind: Catalog['kind'] = groups ? 'group' : 'subject';
  const { params, update: updateParams } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const [edit, setEdit] = useState<Catalog | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<Catalog | null>(null);
  const list = useData<Paged<Catalog>>(
    `/catalog?kind=${kind}&cursor=${encodeURIComponent(cursor)}`,
  );
  const members = useChoices<Student>(`/groups/${selected?.id ?? ''}/members`, Boolean(selected));
  const action = useAction();
  const prefix = groups ? 'groups' : 'academic';
  return (
    <Page
      eyebrow="MAKE IT YOURS"
      title={groups ? 'Groups' : 'Subjects'}
      action={
        permissions.includes(`${prefix}.create`) && (
          <Button onClick={() => setEdit('new')}>
            <Plus size={18} />
            {t(groups ? 'Add group' : 'Add subject')}
          </Button>
        )
      }
    >
      <State query={list}>
        {list.data?.items.length ? (
          <section className="panel flush">
            {list.data.items.map((item) => (
              <div className="record-row" key={item.id}>
                <span className="record-icon">
                  <Settings2 size={19} />
                </span>
                <strong className="grow">{item.name}</strong>
                {groups && (
                  <Button variant="ghost" onClick={() => setSelected(item)}>
                    {t('View')}
                  </Button>
                )}
                {permissions.includes(`${prefix}.update`) && (
                  <Button
                    variant="ghost"
                    aria-label={`Edit ${item.name}`}
                    onClick={() => setEdit(item)}
                  >
                    <Pencil size={17} />
                  </Button>
                )}
                {permissions.includes(`${prefix}.archive`) && (
                  <Button
                    variant="ghost"
                    className="danger-icon-btn"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => {
                      action.reset();
                      setDeleting(item);
                    }}
                  >
                    <Trash2 size={17} />
                  </Button>
                )}
              </div>
            ))}
          </section>
        ) : (
          <Empty
            title={groups ? 'No groups yet' : 'No subjects yet'}
            description={
              groups
                ? 'Create your first group to organize students into batches.'
                : 'Add your first subject to start creating exams.'
            }
          />
        )}
        <NextPage next={list.data?.next} onNext={(cursor) => updateParams({ cursor })} />
      </State>
      <Dialog
        title={
          edit === 'new'
            ? groups
              ? 'Add group'
              : 'Add subject'
            : groups
              ? 'Edit group'
              : 'Edit subject'
        }
        open={edit !== null}
        onClose={() => setEdit(null)}
        refresh={list.refetch}
      >
        {edit && (
          <CatalogForm
            key={edit === 'new' ? 'new' : edit.id}
            kind={kind}
            initial={
              edit === 'new'
                ? undefined
                : (list.data?.items.find((item) => item.id === edit.id) ?? edit)
            }
            onDone={() => setEdit(null)}
          />
        )}
      </Dialog>
      <Dialog
        title={groups ? 'Delete group' : 'Delete subject'}
        open={deleting !== null}
        onClose={() => setDeleting(null)}
      >
        <p>
          {groups
            ? t(
                'Are you sure you want to delete this group? Students will remain in the center but will no longer be assigned to this group.',
              )
            : t(
                'Are you sure you want to delete this subject? It cannot be deleted if used in any exam.',
              )}
        </p>
        <Alert error={action.error} />
        <div className="actions">
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="danger"
            busy={action.isPending}
            onClick={() => {
              if (!deleting) return;
              action.mutate(
                { path: `/catalog/${deleting.id}`, method: 'DELETE' },
                { onSuccess: () => setDeleting(null) },
              );
            }}
          >
            {t(groups ? 'Delete group' : 'Delete subject')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        title={selected?.name ?? 'Groups'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        <MoreChoices query={members} />
        <State query={members}>
          {members.data?.items.length ? (
            members.data.items.map((student) => (
              <Link className="record-row" to={`/students/${student.id}`} key={student.id}>
                {student.name}
              </Link>
            ))
          ) : (
            <p>
              {t(
                'No students in this group yet. Add group memberships from each student’s profile.',
              )}
            </p>
          )}
        </State>
      </Dialog>
    </Page>
  );
}
function CatalogForm({
  initial: incoming,
  kind,
  onDone,
}: {
  initial: Catalog | undefined;
  kind: Catalog['kind'];
  onDone: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const initial = useDraftSnapshot(incoming, dirty);
  const action = useAction();
  const { t } = useLocale();
  return (
    <form
      key={initial?.version ?? 'new'}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        action.mutate(
          {
            path: initial ? `/catalog/${initial.id}` : '/catalog',
            method: initial ? 'PATCH' : 'POST',
            body: {
              name: form.get('name'),
              kind,
              ...(initial ? { version: initial.version, active: initial.active } : {}),
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Name">
        <input name="name" defaultValue={initial?.name ?? ''} required maxLength={160} />
      </Field>
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
function Templates() {
  const { params, update: updateParams } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const templates = useData<Paged<Template>>(`/templates?cursor=${encodeURIComponent(cursor)}`);
  const { permissions } = useCenter();
  const { t } = useLocale();
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const action = useAction();
  return (
    <Page
      eyebrow="WRITE ONCE. MAKE IT PERSONAL."
      title="Templates"
      action={
        permissions.includes('templates.create') && (
          <Button onClick={() => setEdit('new')}>
            <Plus size={18} />
            {t('Create template')}
          </Button>
        )
      }
    >
      <State query={templates}>
        {templates.data?.items.length ? (
          <div className="exam-grid">
            {templates.data.items.map((template) => (
              <section className="panel template-card" key={template.id}>
                <div className="section-header">
                  <span className="mini-label">{template.scope}</span>
                  <div className="template-actions">
                    {permissions.includes('templates.update') && (
                      <Button
                        variant="ghost"
                        onClick={() => setEdit(template)}
                        aria-label={`Edit ${template.name}`}
                      >
                        <Pencil size={17} />
                      </Button>
                    )}
                    {permissions.includes('templates.archive') && (
                      <Button
                        variant="ghost"
                        className="danger-icon-btn"
                        onClick={() => {
                          action.reset();
                          setDeleting(template);
                        }}
                        aria-label={`Delete ${template.name}`}
                      >
                        <Trash2 size={17} />
                      </Button>
                    )}
                  </div>
                </div>
                <h2>{template.name}</h2>
                <p className="message-text">{template.body}</p>
              </section>
            ))}
          </div>
        ) : (
          <Empty />
        )}
        <NextPage next={templates.data?.next} onNext={(cursor) => updateParams({ cursor })} />
      </State>
      <Dialog
        title={edit === 'new' ? 'Create template' : 'Edit'}
        open={edit !== null}
        onClose={() => setEdit(null)}
        refresh={templates.refetch}
      >
        {edit && (
          <TemplateForm
            key={edit === 'new' ? 'new' : edit.id}
            initial={
              edit === 'new'
                ? undefined
                : (templates.data?.items.find((item) => item.id === edit.id) ?? edit)
            }
            onDone={() => setEdit(null)}
          />
        )}
      </Dialog>
      <Dialog title="Delete template" open={deleting !== null} onClose={() => setDeleting(null)}>
        <p>{t('Are you sure you want to delete this template?')}</p>
        <Alert error={action.error} />
        <div className="actions">
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="danger"
            busy={action.isPending}
            onClick={() => {
              if (!deleting) return;
              action.mutate(
                { path: `/templates/${deleting.id}`, method: 'DELETE' },
                { onSuccess: () => setDeleting(null) },
              );
            }}
          >
            {t('Delete template')}
          </Button>
        </div>
      </Dialog>
    </Page>
  );
}
export function VariableEditor({
  body,
  setBody,
  scope,
}: {
  body: string;
  setBody: (v: string) => void;
  scope: TemplateScope;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { t } = useLocale();
  const available =
    scope === 'announcement'
      ? variables.filter((v) => ['student_name', 'institute_name'].includes(v))
      : scope === 'summary'
        ? variables.filter((v) =>
            ['student_name', 'exam_name', 'results_summary', 'institute_name'].includes(v),
          )
        : variables.filter((v) => v !== 'results_summary');
  return (
    <>
      <Field label="Message">
        <textarea
          ref={ref}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={4000}
        />
      </Field>
      <p className="field-caption">{t('Insert variable')}</p>
      <div className="variable-list">
        {available.map((variable) => (
          <button
            type="button"
            key={variable}
            data-edits-form
            onClick={() => {
              const start = ref.current?.selectionStart ?? body.length;
              const end = ref.current?.selectionEnd ?? start;
              const insert = `{{${variable}}}`;
              setBody(body.slice(0, start) + insert + body.slice(end));
              requestAnimationFrame(() => {
                ref.current?.focus();
                ref.current?.setSelectionRange(start + insert.length, start + insert.length);
              });
            }}
          >
            {variable.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
    </>
  );
}
function TemplateForm({
  initial: incoming,
  onDone,
}: {
  initial: Template | undefined;
  onDone: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const initial = useDraftSnapshot(incoming, dirty);
  const [scope, setScope] = useState<TemplateScope>(initial?.scope ?? 'summary');
  const [body, setBody] = useState(initial?.body ?? '');
  const [loaded, setLoaded] = useState(initial);
  if (initial !== loaded) {
    setLoaded(initial);
    setScope(initial?.scope ?? 'summary');
    setBody(initial?.body ?? '');
  }
  const action = useAction();
  const { t } = useLocale();
  return (
    <form
      key={initial?.version ?? 'new'}
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        action.mutate(
          {
            path: initial ? `/templates/${initial.id}` : '/templates',
            method: initial ? 'PATCH' : 'POST',
            body: {
              name: f.get('name'),
              scope,
              body,
              ...(initial ? { version: initial.version } : {}),
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Template name">
        <input name="name" defaultValue={initial?.name} required maxLength={160} />
      </Field>
      <Field label="Message type">
        <select value={scope} onChange={(e) => setScope(e.target.value as TemplateScope)}>
          <option value="summary">{t('Combined results')}</option>
          <option value="subject">{t('Subject result')}</option>
          <option value="announcement">{t('Announcement')}</option>
        </select>
      </Field>
      <VariableEditor
        body={body}
        setBody={(value) => {
          setBody(value);
          setDirty(true);
        }}
        scope={scope}
      />
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
interface StaffMember {
  id: string;
  name: string;
  phone: string;
  active: number;
  pending: number;
  role_ids: string;
}
function Staff() {
  const { admin, center } = useCenter();
  const { t } = useLocale();
  const staff = useChoices<StaffMember>('/staff', admin);
  const roles = useChoices<Role>('/roles', admin);
  const action = useAction<{ token: string }>();
  const update = useAction();
  const [role, setRole] = useState<Role | 'new' | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [member, setMember] = useState<StaffMember | 'new' | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [token, setToken] = useState('');
  const [transfer, setTransfer] = useState(false);
  if (!admin) return <Alert>{t('Only your center admin can manage staff and roles.')}</Alert>;
  return (
    <Page
      eyebrow="CLEAR ROLES. SHARED PROGRESS."
      title="Staff & roles"
      action={
        <Button
          onClick={() => {
            action.reset();
            update.reset();
            setMember('new');
          }}
        >
          <Plus size={18} />
          {t('Invite')}
        </Button>
      }
    >
      <Alert error={update.error} />
      <MoreChoices query={staff} />
      <State query={staff}>
        <section className="panel staff-panel">
          <h2>{t('Staff')}</h2>
          {staff.data?.items.map((person) => (
            <div className="record-row staff-row" key={person.id}>
              <span className="initial-avatar">{person.name.slice(0, 1) || '?'}</span>
              <div className="grow">
                <div className="staff-headline">
                  <strong>{person.name || t('Awaiting activation')}</strong>
                  <span
                    className={`badge ${person.pending || !person.active ? 'paused' : 'accepted'}`}
                  >
                    {t(
                      person.id === center.owner_id
                        ? 'Admin'
                        : person.pending
                          ? 'Invited'
                          : person.active
                            ? 'Active'
                            : 'Suspended',
                    )}
                  </span>
                </div>
                <small className="staff-phone">{person.phone}</small>
              </div>
              {person.id !== center.owner_id && (
                <div className="record-actions">
                  {!person.pending && (
                    <Button
                      variant="ghost"
                      className="record-icon-action"
                      aria-label={`${t('Edit staff access')} ${person.name}`}
                      title={t('Edit staff access')}
                      onClick={() => {
                        action.reset();
                        update.reset();
                        setMember(person);
                      }}
                    >
                      <Pencil size={17} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="danger-icon-btn record-icon-action"
                    aria-label={`${t(person.pending ? 'Revoke invitation' : 'Remove from center')} ${person.name || person.phone}`}
                    onClick={() => {
                      update.reset();
                      setRemoving(person);
                    }}
                  >
                    <Trash2 size={17} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      </State>
      <section className="panel">
        <div className="section-header">
          <h2>{t('Roles')}</h2>
          <Button variant="secondary" onClick={() => setRole('new')}>
            <Plus size={17} />
            {t('Create role')}
          </Button>
        </div>
        <MoreChoices query={roles} />
        <State query={roles}>
          {roles.data?.items.length ? (
            roles.data.items.map((item) => (
              <div className="record-row" key={item.id}>
                <div className="grow">
                  <strong>{item.name}</strong>
                  <small>
                    {item.permissions.length} {t('allowed actions')}
                  </small>
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Edit ${item.name}`}
                  onClick={() => setRole(item)}
                >
                  <Pencil size={17} />
                </Button>
                <Button
                  variant="ghost"
                  className="danger-icon-btn"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => {
                    update.reset();
                    setDeletingRole(item);
                  }}
                >
                  <Trash2 size={17} />
                </Button>
              </div>
            ))
          ) : (
            <p className="muted">
              {t(
                'Create a role, then assign it to staff. Staff have no access until permissions are granted.',
              )}
            </p>
          )}
        </State>
      </section>
      <Button
        variant="secondary"
        onClick={() => {
          update.reset();
          setTransfer(true);
        }}
      >
        {t('Transfer ownership')}
      </Button>
      <Dialog
        title={member === 'new' ? 'Invite staff' : 'Edit staff access'}
        size="compact"
        open={member !== null}
        onClose={() => setMember(null)}
      >
        {member && (
          <form
            key={member === 'new' ? 'new' : member.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const loaded = new Set(roles.data?.items.map((r) => r.id));
              const role_ids = [
                ...f.getAll('role'),
                ...(member !== 'new'
                  ? (JSON.parse(member.role_ids) as string[]).filter((id) => !loaded.has(id))
                  : []),
              ];
              if (member === 'new')
                action.mutate(
                  {
                    path: '/staff/invite',
                    body: { phone: f.get('phone'), role_ids },
                  },
                  {
                    onSuccess: (result) => {
                      setToken(result.token);
                      setMember(null);
                    },
                  },
                );
              else
                update.mutate(
                  {
                    path: `/staff/${member.id}`,
                    method: 'PUT',
                    body: { role_ids, active: f.get('active') === 'on' },
                  },
                  { onSuccess: () => setMember(null) },
                );
            }}
          >
            {member !== 'new' && (
              <div className="member-summary">
                <strong>{member.name}</strong>
                <small>{member.phone}</small>
              </div>
            )}
            {member === 'new' && (
              <>
                <Field label="Phone number">
                  <input type="tel" name="phone" required />
                </Field>
              </>
            )}
            <fieldset className="role-choices">
              <legend>{t('Roles')}</legend>
              <p className="muted">
                {t('Choose what this person can access in this coaching center.')}
              </p>
              {roles.data?.items.map((r) => (
                <label className="check choice" key={r.id}>
                  <input
                    type="checkbox"
                    name="role"
                    value={r.id}
                    defaultChecked={
                      member !== 'new' && (JSON.parse(member.role_ids) as string[]).includes(r.id)
                    }
                  />
                  <span>{r.name}</span>
                </label>
              ))}
              {!roles.data?.items.length && (
                <p className="muted">{t('No roles yet. Create a role to assign access.')}</p>
              )}
            </fieldset>
            {member !== 'new' && (
              <label className="check access-control">
                <input type="checkbox" name="active" defaultChecked={Boolean(member.active)} />
                <span>
                  {t('Allow center access')}
                  <small>{t('Turn off to suspend access to this center only.')}</small>
                </span>
              </label>
            )}
            <Alert error={action.error ?? update.error} />
            <div className="actions">
              <Button type="button" variant="secondary" onClick={() => setMember(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" busy={action.isPending || update.isPending}>
                {t(member === 'new' ? 'Invite staff' : 'Save access')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        title={removing?.pending ? 'Revoke invitation' : 'Remove from center'}
        open={removing !== null}
        onClose={() => setRemoving(null)}
      >
        <p>
          {t(
            'Remove this person’s access and outstanding invitations to this center? Their account, other centers, and historical records are kept.',
          )}
        </p>
        <p>
          <strong>{removing?.name || removing?.phone}</strong>
        </p>
        <Alert error={update.error} />
        <div className="actions">
          <Button variant="secondary" onClick={() => setRemoving(null)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="danger"
            busy={update.isPending}
            onClick={() => {
              if (removing)
                update.mutate(
                  { path: `/staff/${removing.id}`, method: 'DELETE' },
                  { onSuccess: () => setRemoving(null) },
                );
            }}
          >
            {t(removing?.pending ? 'Revoke invitation' : 'Remove from center')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        title={role === 'new' ? 'Create role' : 'Edit'}
        open={role !== null}
        onClose={() => setRole(null)}
        refresh={roles.refetch}
      >
        {role && (
          <RoleEditor
            key={role === 'new' ? 'new' : role.id}
            initial={
              role === 'new'
                ? undefined
                : (roles.data?.items.find((item) => item.id === role.id) ?? role)
            }
            onDone={() => setRole(null)}
          />
        )}
      </Dialog>
      <Dialog
        title="Delete role"
        open={deletingRole !== null}
        onClose={() => setDeletingRole(null)}
      >
        {deletingRole && (
          <div>
            <p>
              {t(
                'Are you sure you want to delete this role? It cannot be deleted if staff members are currently assigned to it.',
              )}
            </p>
            <Alert error={update.error} />
            <div className="actions">
              <Button type="button" variant="secondary" onClick={() => setDeletingRole(null)}>
                {t('Cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                busy={update.isPending}
                onClick={() => {
                  update.mutate(
                    { path: `/roles/${deletingRole.id}`, method: 'DELETE' },
                    { onSuccess: () => setDeletingRole(null) },
                  );
                }}
              >
                {t('Delete role')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog title="Invitation link" open={Boolean(token)} onClose={() => setToken('')}>
        <Invitation token={token} />
      </Dialog>
      <Dialog title="Transfer ownership" open={transfer} onClose={() => setTransfer(false)}>
        <p>
          {t(
            'The selected staff member becomes the only center admin. Your access will depend on your assigned staff roles.',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            update.mutate(
              { path: '/ownership', body: { user_id: f.get('user') } },
              {
                onSuccess: () => {
                  setTransfer(false);
                },
              },
            );
          }}
        >
          <Field label="Staff & roles">
            <select name="user" required>
              <option value="">{t('Choose an active staff member')}</option>
              {staff.data?.items
                .filter((s) => s.active && s.id !== center.owner_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Alert error={update.error} />
          <div className="actions">
            <Button type="button" variant="secondary" onClick={() => setTransfer(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="danger" busy={update.isPending}>
              {t('Transfer ownership')}
            </Button>
          </div>
        </form>
      </Dialog>
    </Page>
  );
}
function RoleEditor({
  initial: incoming,
  onDone,
}: {
  initial: Role | undefined;
  onDone: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const initial = useDraftSnapshot(incoming, dirty);
  const [grants, setGrants] = useState(initial?.permissions ?? []);
  const [loaded, setLoaded] = useState(initial);
  if (initial !== loaded) {
    setLoaded(initial);
    setGrants(initial?.permissions ?? []);
  }
  const action = useAction();
  const { t } = useLocale();
  const grant = (permission: string, checked: boolean) =>
    setGrants((all) =>
      checked
        ? [...new Set([...all, permission, ...requiredPermissions(permission)])]
        : all.filter((p) => p !== permission && !requiredPermissions(p).includes(permission)),
    );
  const labels: Record<string, string> = {
    academic: 'Subjects',
    results: 'Marks & results',
    balance: 'SMS balance',
    'exams.archive': 'Archive or delete exams',
    'exams.update': 'Edit or restore exams',
    'messages.read': 'View campaigns',
    'messages.create': 'Create drafts',
    'messages.send': 'Send messages',
    'messages.schedule': 'Schedule messages',
    'messages.cancel': 'Cancel or delete campaigns',
    'messages.retry': 'Retry selected messages',
    'messages.read_content': 'View message content',
    'balance.refresh': 'Refresh balance',
    'provider.manage': 'Manage SMS account',
  };
  return (
    <form
      key={initial?.version ?? 'new'}
      onChange={() => setDirty(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        action.mutate(
          {
            path: initial ? `/roles/${initial.id}` : '/roles',
            method: initial ? 'PATCH' : 'POST',
            body: {
              name: f.get('name'),
              permissions: grants,
              ...(initial ? { version: initial.version } : {}),
            },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <Field label="Role name">
        <input name="name" defaultValue={initial?.name} required />
      </Field>
      <div className="permission-matrix">
        <p className="muted">
          {t(
            'Required viewing permissions are selected automatically. Removing one also removes actions that depend on it.',
          )}
        </p>
        {([...features, 'provider'] as const).map((feature) => (
          <fieldset key={feature}>
            <legend>
              {t(
                feature === 'provider'
                  ? 'SMS account'
                  : (labels[feature] ?? feature.charAt(0).toUpperCase() + feature.slice(1)),
              )}
            </legend>
            <div className="permission-actions">
              {permissionCatalog
                .filter((permission) => permission.startsWith(`${feature}.`))
                .map((permission) => {
                  const actionName = permission.split('.')[1] ?? '';
                  return (
                    <label className="check" key={permission}>
                      <input
                        type="checkbox"
                        checked={grants.includes(permission)}
                        onChange={(e) => grant(permission, e.target.checked)}
                      />
                      {labels[permission]
                        ? t(labels[permission])
                        : actionName === 'archive'
                          ? t('Delete')
                          : t(actionName.charAt(0).toUpperCase() + actionName.slice(1))}
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}
        <p className="muted">
          {t('Staff, roles, ownership and center settings are managed only by the coaching admin.')}
        </p>
      </div>
      <Alert error={action.error} />
      <div className="actions">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button type="submit" busy={action.isPending}>
          {t('Save role')}
        </Button>
      </div>
    </form>
  );
}
export function Invitation({ token }: { token: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/?invite=${encodeURIComponent(token)}`;
  return (
    <>
      <p>
        {t(
          'Share this private, one-use link directly with the intended person. It expires in 24 hours. Existing users must sign in to accept.',
        )}
      </p>
      <input aria-label="Invitation link" readOnly value={url} />
      <div className="actions">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => setCopied(true));
          }}
        >
          <Copy size={17} />
          {copied ? 'Copied' : t('Copy')}
        </Button>
      </div>
    </>
  );
}
function SettingsPage() {
  const { center: incoming, admin, permissions } = useCenter();
  const [centerDirty, setCenterDirty] = useState(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const center = useDraftSnapshot(incoming, centerDirty);
  const unsaved = useUnsaved(centerDirty || providerDirty || profileDirty);
  const { t } = useLocale();
  const provider = useData<ProviderSettings>('/provider', permissions.includes('provider.manage'));
  const action = useAction();
  const [replace, setReplace] = useState(false);
  return (
    <Page eyebrow="YOUR WORKSPACE, YOUR WAY" title="Settings">
      {unsaved.prompt}
      <ProfileSettings onDirtyChange={setProfileDirty} />
      <Alert error={action.error} />
      {admin && (
        <form
          className="panel"
          key={center.revision}
          onChange={() => setCenterDirty(true)}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate(
              {
                path: '/settings',
                method: 'PATCH',
                body: {
                  name: f.get('name'),
                  late_minutes: Number(f.get('late')),
                },
              },
              { onSuccess: () => setCenterDirty(false) },
            );
          }}
        >
          <h2>{t('Center settings')}</h2>
          <div className="form-grid">
            <Field label="Center name">
              <input name="name" defaultValue={center.name} required />
            </Field>
            <Field label="Late-send window (minutes)">
              <input
                name="late"
                type="number"
                min="1"
                max="1440"
                defaultValue={center.late_minutes}
                required
              />
            </Field>
          </div>
          <div className="actions">
            <Button type="submit" busy={action.isPending}>
              {t('Save changes')}
            </Button>
          </div>
        </form>
      )}
      <BalanceCard />
      {permissions.includes('provider.manage') && (
        <section className="panel">
          <div className="section-header">
            <h2>{t('SMS account')}</h2>
            <span className="badge accepted">{provider.data?.mode ?? 'disabled'}</span>
          </div>
          <State query={provider}>
            <p className="muted">
              {provider.data?.configured
                ? `API key configured · ending ${provider.data.suffix}`
                : 'Connect this center’s own SMS account. Your key is never displayed again.'}
            </p>
            {provider.data?.configured && !replace ? (
              <div className="provider-info">
                <p>
                  <strong>{t('Sender IDs:')}</strong> {provider.data.sender_ids.join(', ')}
                </p>
                <div className="actions">
                  <Button variant="secondary" onClick={() => setReplace(true)}>
                    {t('Replace account settings')}
                  </Button>
                </div>
              </div>
            ) : (
              <form
                onChange={() => setProviderDirty(true)}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  action.mutate(
                    {
                      path: '/provider',
                      method: 'PUT',
                      body: {
                        api_key: f.get('key'),
                        sender_ids: formText(f, 'senders')
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                        batch_size: Number(f.get('batch')),
                        interval_seconds: Number(f.get('interval')),
                      },
                    },
                    {
                      onSuccess: () => {
                        form.reset();
                        setReplace(false);
                        setProviderDirty(false);
                      },
                    },
                  );
                }}
              >
                <Field label="API key">
                  <input name="key" type="password" required autoComplete="off" minLength={8} />
                </Field>
                <Field label="Sender IDs" hint="Comma-separated approved IDs from your provider.">
                  <input
                    name="senders"
                    required
                    defaultValue={provider.data?.sender_ids.join(', ')}
                  />
                </Field>
                <div className="form-grid">
                  <Field
                    label="Messages per provider request"
                    hint="Keep 1 until your provider confirms larger batch limits."
                  >
                    <input
                      name="batch"
                      type="number"
                      min="1"
                      max="100"
                      defaultValue={provider.data?.batch_size ?? 1}
                      required
                    />
                  </Field>
                  <Field label="Seconds between batches">
                    <input
                      name="interval"
                      type="number"
                      min="1"
                      max="300"
                      defaultValue={provider.data?.interval_seconds ?? 2}
                      required
                    />
                  </Field>
                </div>
                <p className="notice">
                  {t(
                    'Replacing credentials pauses affected unsent campaigns. Old credentials are retained only to check previously submitted messages. API keys are stored in the database as requested; database exports must be protected.',
                  )}
                </p>
                <div className="actions">
                  {provider.data?.configured && (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => {
                        setReplace(false);
                        setProviderDirty(false);
                      }}
                    >
                      {t('Cancel')}
                    </Button>
                  )}
                  <Button type="submit" busy={action.isPending}>
                    {t('Save SMS account')}
                  </Button>
                </div>
              </form>
            )}
          </State>
        </section>
      )}
    </Page>
  );
}
