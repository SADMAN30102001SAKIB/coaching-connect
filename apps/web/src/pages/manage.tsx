import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Copy, Pencil, Plus, Settings2 } from 'lucide-react';
import {
  actions,
  features,
  permissions as permissionCatalog,
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
import {
  Alert,
  Button,
  Dialog,
  Empty,
  Field,
  NextPage,
  Page,
  State,
  dateTime,
  MoreChoices,
} from '../ui';

export default function ManagePages({
  section,
}: {
  section: 'group' | 'academic' | 'templates' | 'staff' | 'settings';
}) {
  switch (section) {
    case 'group':
      return <CatalogPage groups />;
    case 'academic':
      return <CatalogPage />;
    case 'templates':
      return <Templates />;
    case 'staff':
      return <Staff />;
    case 'settings':
      return <SettingsPage />;
  }
}
function CatalogPage({ groups = false }: { groups?: boolean }) {
  const { permissions } = useCenter();
  const { t } = useLocale();
  const [kind, setKind] = useState<Catalog['kind']>(groups ? 'group' : 'subject');
  const [cursor, setCursor] = useState('');
  const [edit, setEdit] = useState<Catalog | 'new' | null>(null);
  const [selected, setSelected] = useState<Catalog | null>(null);
  const list = useData<Paged<Catalog>>(
    `/catalog?kind=${kind}&cursor=${encodeURIComponent(cursor)}`,
  );
  const members = useChoices<Student>(`/groups/${selected?.id ?? ''}/members`, Boolean(selected));
  const action = useAction();
  const prefix = groups ? 'groups' : 'academic';
  const classes = useChoices<Catalog>(
    '/catalog?kind=class',
    groups && permissions.includes('academic.read'),
  );
  const sessions = useChoices<Catalog>(
    '/catalog?kind=session',
    groups && permissions.includes('academic.read'),
  );
  return (
    <Page
      eyebrow="MAKE IT YOURS"
      title={groups ? 'Groups' : 'Academic setup'}
      description={
        groups
          ? 'The right students, together. Reuse a batch across exams.'
          : 'Your classes, subjects, sessions and exam series. No fixed curriculum.'
      }
      action={
        permissions.includes(`${prefix}.create`) && (
          <Button onClick={() => setEdit('new')}>
            <Plus size={18} />
            {t(groups ? 'Add group' : 'Add')}
          </Button>
        )
      }
    >
      {!groups && (
        <div className="tabs" role="group" aria-label="Academic category">
          {(['subject', 'class', 'session', 'series'] as const).map((item) => (
            <button
              key={item}
              className={kind === item ? 'active' : ''}
              onClick={() => {
                setKind(item);
                setCursor('');
              }}
            >
              {t(item.charAt(0).toUpperCase() + item.slice(1))}
            </button>
          ))}
        </div>
      )}
      <State pending={list.isPending} error={list.error}>
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
              </div>
            ))}
          </section>
        ) : (
          <Empty />
        )}
        <NextPage next={list.data?.next} onNext={setCursor} />
      </State>
      <Dialog
        title={edit === 'new' ? 'Add' : 'Edit'}
        open={edit !== null}
        onClose={() => setEdit(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate(
              {
                path: edit && edit !== 'new' ? `/catalog/${edit.id}` : '/catalog',
                method: edit && edit !== 'new' ? 'PATCH' : 'POST',
                body: {
                  name: f.get('name'),
                  kind,
                  class_id: groups ? f.get('class') || null : null,
                  session_id: groups ? f.get('session') || null : null,
                  ...(edit && edit !== 'new'
                    ? { version: edit.version, active: f.get('active') === 'on' ? 1 : 0 }
                    : {}),
                },
              },
              { onSuccess: () => setEdit(null) },
            );
          }}
          key={edit && edit !== 'new' ? edit.id : 'new'}
        >
          <Field label="Name">
            <input
              name="name"
              defaultValue={edit && edit !== 'new' ? edit.name : ''}
              required
              maxLength={160}
            />
          </Field>
          {groups && (
            <>
              <Field label="Class">
                <select
                  name="class"
                  defaultValue={edit && edit !== 'new' ? (edit.class_id ?? '') : ''}
                >
                  {edit &&
                    edit !== 'new' &&
                    edit.class_id &&
                    !classes.data?.items.some((item) => item.id === edit.class_id) && (
                      <option value={edit.class_id}>{t('Current class')}</option>
                    )}
                  <option value="">{t('None')}</option>
                  {classes.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <MoreChoices query={classes} />
              <Field label="Session">
                <select
                  name="session"
                  defaultValue={edit && edit !== 'new' ? (edit.session_id ?? '') : ''}
                >
                  {edit &&
                    edit !== 'new' &&
                    edit.session_id &&
                    !sessions.data?.items.some((item) => item.id === edit.session_id) && (
                      <option value={edit.session_id}>{t('Current session')}</option>
                    )}
                  <option value="">{t('None')}</option>
                  {sessions.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <MoreChoices query={sessions} />
            </>
          )}
          {edit && edit !== 'new' && (
            <label className="check">
              <input type="checkbox" name="active" defaultChecked />
              {t('Active')} <small>{t('Uncheck to archive.')}</small>
            </label>
          )}
          <Alert error={action.error} />
          <div className="actions">
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" busy={action.isPending}>
              {t('Save')}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        title={selected?.name ?? 'Groups'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        <MoreChoices query={members} />
        <State pending={members.isPending} error={members.error}>
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
function Templates() {
  const [cursor, setCursor] = useState('');
  const templates = useData<Paged<Template>>(`/templates?cursor=${encodeURIComponent(cursor)}`);
  const { permissions } = useCenter();
  const { t } = useLocale();
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  return (
    <Page
      eyebrow="WRITE ONCE. MAKE IT PERSONAL."
      title="Templates"
      description="Keep your voice consistent. Let the student details change."
      action={
        permissions.includes('templates.create') && (
          <Button onClick={() => setEdit('new')}>
            <Plus size={18} />
            {t('Create template')}
          </Button>
        )
      }
    >
      <State pending={templates.isPending} error={templates.error}>
        {templates.data?.items.length ? (
          <div className="exam-grid">
            {templates.data.items.map((template) => (
              <section className="panel template-card" key={template.id}>
                <div className="section-header">
                  <span className="mini-label">{template.scope}</span>
                  {permissions.includes('templates.update') && (
                    <Button
                      variant="ghost"
                      onClick={() => setEdit(template)}
                      aria-label={`Edit ${template.name}`}
                    >
                      <Pencil size={17} />
                    </Button>
                  )}
                </div>
                <h2>{template.name}</h2>
                <p className="message-text">{template.body}</p>
              </section>
            ))}
          </div>
        ) : (
          <Empty />
        )}
        <NextPage next={templates.data?.next} onNext={setCursor} />
      </State>
      <Dialog
        title={edit === 'new' ? 'Create template' : 'Edit'}
        open={edit !== null}
        onClose={() => setEdit(null)}
      >
        {edit && (
          <TemplateForm
            key={edit === 'new' ? 'new' : edit.id}
            initial={edit === 'new' ? undefined : edit}
            onDone={() => setEdit(null)}
          />
        )}
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
function TemplateForm({ initial, onDone }: { initial: Template | undefined; onDone: () => void }) {
  const [scope, setScope] = useState<TemplateScope>(initial?.scope ?? 'summary');
  const [body, setBody] = useState(initial?.body ?? '');
  const action = useAction();
  const { t } = useLocale();
  return (
    <form
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
              ...(initial
                ? { version: initial.version, active: f.get('active') === 'on' ? 1 : 0 }
                : {}),
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
      <VariableEditor body={body} setBody={setBody} scope={scope} />
      {initial && (
        <label className="check">
          <input type="checkbox" name="active" defaultChecked />
          {t('Active')}
        </label>
      )}
      <Alert error={action.error} />
      <Button type="submit" busy={action.isPending}>
        {t('Save')}
      </Button>
    </form>
  );
}
interface StaffMember {
  id: string;
  name: string;
  phone: string;
  active: number;
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
  const [member, setMember] = useState<StaffMember | 'new' | null>(null);
  const [token, setToken] = useState('');
  const [transfer, setTransfer] = useState(false);
  if (!admin) return <Alert>{t('Only your center admin can manage staff and roles.')}</Alert>;
  return (
    <Page
      eyebrow="CLEAR ROLES. SHARED PROGRESS."
      title="Staff & roles"
      action={
        <Button onClick={() => setMember('new')}>
          <Plus size={18} />
          {t('Invite staff')}
        </Button>
      }
    >
      <Alert error={update.error} />
      <MoreChoices query={staff} />
      <State pending={staff.isPending} error={staff.error}>
        <section className="panel">
          <h2>{t('Staff & roles')}</h2>
          {staff.data?.items.map((person) => (
            <div className="record-row" key={person.id}>
              <span className="initial-avatar">{person.name.slice(0, 1)}</span>
              <div className="grow">
                <strong>{person.name}</strong>
                <small>
                  {person.phone} · {person.active ? t('Active') : t('Suspended')}
                </small>
              </div>
              {person.id === center.owner_id ? (
                <span className="badge accepted">{t('Admin')}</span>
              ) : (
                <Button variant="secondary" onClick={() => setMember(person)}>
                  {t('Edit')}
                </Button>
              )}
            </div>
          ))}
        </section>
      </State>
      <section className="panel">
        <div className="section-header">
          <h2>{t('Permissions')}</h2>
          <Button variant="secondary" onClick={() => setRole('new')}>
            <Plus size={17} />
            {t('Create role')}
          </Button>
        </div>
        <MoreChoices query={roles} />
        <State pending={roles.isPending} error={roles.error}>
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
      <Button variant="secondary" onClick={() => setTransfer(true)}>
        {t('Transfer ownership')}
      </Button>
      <Dialog
        title={member === 'new' ? 'Invite staff' : 'Edit'}
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
                    body: { name: f.get('name'), phone: f.get('phone'), role_ids },
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
            {member === 'new' && (
              <>
                <Field label="Name">
                  <input name="name" required />
                </Field>
                <Field label="Phone number">
                  <input type="tel" name="phone" required />
                </Field>
              </>
            )}
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
                {r.name}
              </label>
            ))}
            {member !== 'new' && (
              <label className="check">
                <input type="checkbox" name="active" defaultChecked={Boolean(member.active)} />
                {t('Active')}
              </label>
            )}
            <Alert error={action.error ?? update.error} />
            <Button type="submit" busy={action.isPending || update.isPending}>
              {t(member === 'new' ? 'Invite staff' : 'Save')}
            </Button>
          </form>
        )}
      </Dialog>
      <Dialog
        title={role === 'new' ? 'Create role' : 'Edit'}
        open={role !== null}
        onClose={() => setRole(null)}
      >
        {role && (
          <RoleEditor
            key={role === 'new' ? 'new' : role.id}
            initial={role === 'new' ? undefined : role}
            onDone={() => setRole(null)}
          />
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
                  location.reload();
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
          <Button type="submit" variant="danger" busy={update.isPending}>
            {t('Transfer ownership')}
          </Button>
        </form>
      </Dialog>
    </Page>
  );
}
function RoleEditor({ initial, onDone }: { initial: Role | undefined; onDone: () => void }) {
  const [grants, setGrants] = useState(initial?.permissions ?? []);
  const action = useAction();
  const { t } = useLocale();
  const grant = (permission: string, checked: boolean) =>
    setGrants((all) => (checked ? [...all, permission] : all.filter((p) => p !== permission)));
  return (
    <form
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
              ...(initial
                ? { version: initial.version, active: f.get('active') === 'on' ? 1 : 0 }
                : {}),
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
        {features.map((feature) => (
          <fieldset key={feature}>
            <legend>{t(feature.charAt(0).toUpperCase() + feature.slice(1))}</legend>
            <div className="permission-actions">
              {actions.map((actionName) => {
                const permission = `${feature}.${actionName}`;
                return permissionCatalog.includes(permission) ? (
                  <label className="check" key={permission}>
                    <input
                      type="checkbox"
                      checked={grants.includes(permission)}
                      onChange={(e) => grant(permission, e.target.checked)}
                    />
                    {t(actionName.charAt(0).toUpperCase() + actionName.slice(1))}
                  </label>
                ) : null;
              })}
            </div>
          </fieldset>
        ))}
        <fieldset>
          <legend>{t('Sending & sensitive actions')}</legend>
          {permissionCatalog
            .filter((p) => !actions.some((a) => p.endsWith(`.${a}`)))
            .map((permission) => (
              <label className="check" key={permission}>
                <input
                  type="checkbox"
                  checked={grants.includes(permission)}
                  onChange={(e) => grant(permission, e.target.checked)}
                />
                {permission.replaceAll('.', ' · ').replaceAll('_', ' ')}
              </label>
            ))}
        </fieldset>
      </div>
      {initial && (
        <label className="check">
          <input type="checkbox" name="active" defaultChecked />
          {t('Active')}
        </label>
      )}
      <Alert error={action.error} />
      <Button type="submit" busy={action.isPending}>
        {t('Save role')}
      </Button>
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
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => setCopied(true));
        }}
      >
        <Copy size={17} />
        {copied ? 'Copied' : t('Copy')}
      </Button>
    </>
  );
}
function SettingsPage() {
  const { center, admin, permissions } = useCenter();
  const { t, locale } = useLocale();
  const provider = useData<ProviderSettings>('/provider', permissions.includes('provider.manage'));
  const action = useAction();
  const [replace, setReplace] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditCursor, setAuditCursor] = useState('');
  const audit = useData<Paged<{ id: string; action: string; name: string; created_at: number }>>(
    `/audit?cursor=${encodeURIComponent(auditCursor)}`,
    showAudit && admin,
  );
  const locationKey = useLocation();
  return (
    <Page eyebrow="YOUR WORKSPACE, YOUR WAY" title="Settings">
      <Alert error={action.error} />
      {admin && (
        <form
          className="panel"
          key={`${locationKey.pathname}:${center.revision}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate({
              path: '/settings',
              method: 'PATCH',
              body: {
                name: f.get('name'),
                timezone: f.get('timezone'),
                locale: f.get('locale'),
                late_minutes: Number(f.get('late')),
              },
            });
          }}
        >
          <h2>{t('Center name')}</h2>
          <div className="form-grid">
            <Field label="Center name">
              <input name="name" defaultValue={center.name} required />
            </Field>
            <Field label="Timezone">
              <input name="timezone" defaultValue={center.timezone} required list="timezones" />
            </Field>
            <datalist id="timezones">
              {Intl.supportedValuesOf('timeZone').map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </datalist>
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
            <Field label="Language">
              <select name="locale" defaultValue={center.locale}>
                <option value="en">English</option>
                <option value="bn">বাংলা</option>
              </select>
            </Field>
          </div>
          <Button type="submit" busy={action.isPending}>
            {t('Save changes')}
          </Button>
        </form>
      )}
      <BalanceCard />
      {permissions.includes('provider.manage') && (
        <section className="panel">
          <div className="section-header">
            <h2>{t('SMS account')}</h2>
            <span className="badge accepted">{provider.data?.mode ?? 'disabled'}</span>
          </div>
          <State pending={provider.isPending} error={provider.error}>
            <p className="muted">
              {provider.data?.configured
                ? `API key configured · ending ${provider.data.suffix}`
                : 'Connect this center’s own SMS account. Your key is never displayed again.'}
            </p>
            {provider.data?.configured && !replace ? (
              <>
                <p>
                  {t('Sender IDs:')} {provider.data.sender_ids.join(', ')}
                </p>
                <Button variant="secondary" onClick={() => setReplace(true)}>
                  {t('Replace account settings')}
                </Button>
              </>
            ) : (
              <form
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
                <Button type="submit" busy={action.isPending}>
                  {t('Save SMS account')}
                </Button>
              </form>
            )}
          </State>
        </section>
      )}
      {admin && (
        <section className="panel">
          <Button variant="ghost" onClick={() => setShowAudit((v) => !v)}>
            {t('Audit history')}
          </Button>
          {showAudit && (
            <State pending={audit.isPending} error={audit.error}>
              {audit.data?.items.map((event) => (
                <div className="record-row" key={event.id}>
                  <div className="grow">
                    <strong>{event.action}</strong>
                    <small>
                      {event.name} · {dateTime(event.created_at, center.timezone, locale)}
                    </small>
                  </div>
                </div>
              ))}
              <NextPage next={audit.data?.next} onNext={setAuditCursor} />
            </State>
          )}
        </section>
      )}
    </Page>
  );
}
