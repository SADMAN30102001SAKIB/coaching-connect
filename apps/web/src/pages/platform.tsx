import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { Center, Page as Paged } from '@coaching/domain';
import { request } from '../api';
import { useLocale } from '../i18n';
import { Alert, Button, Dialog, Empty, Field, NextPage, State, useListParams } from '../ui';
import { PlatformFrame } from '../components/PlatformFrame';
import { Invitation } from './manage';

export default function Platform() {
  const { t } = useLocale();
  const client = useQueryClient();
  const { params, update } = useListParams();
  const cursor = params.get('cursor') ?? '';
  const centers = useQuery({
    queryKey: ['platform', cursor],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      request<Paged<Center & { owner_phone: string; owner_name: string }>>(
        `/platform/centers?cursor=${encodeURIComponent(cursor)}`,
        'GET',
        undefined,
        signal,
      ),
  });
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState('');
  const [recovery, setRecovery] = useState('');
  const [confirm, setConfirm] = useState<Center | null>(null);
  const [deleting, setDeleting] = useState<Center | null>(null);
  const [deleteName, setDeleteName] = useState('');
  const deletion = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      request(`/platform/centers/${id}`, 'DELETE', { name }),
    onSuccess: (_result, { id }) => {
      setDeleting(null);
      setDeleteName('');
      if (cursor && centers.data?.items.length === 1) update({ cursor: '' });
      client.removeQueries({ queryKey: ['data', id], type: 'inactive' });
      void client.invalidateQueries({ queryKey: ['data', id] });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['platform'] });
    },
  });
  const action = useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: string;
      body: unknown;
    }) => request<{ token?: string; recovery_code?: string }>(path, method, body),
    onSuccess: async (value) => {
      if (value.token) {
        setToken(value.token);
        setCreating(false);
      }
      if (value.recovery_code) setRecovery(value.recovery_code);
      setConfirm(null);
      await client.invalidateQueries({ queryKey: ['platform'] });
    },
  });
  return (
    <PlatformFrame
      action={
        <Button
          onClick={() => {
            action.reset();
            setCreating(true);
          }}
        >
          <Plus size={18} />
          {t('Create center')}
        </Button>
      }
    >
      <Alert error={action.error} />
      <State query={centers}>
        {centers.data?.items.length ? (
          <section className="panel flush platform-centers">
            {centers.data.items.map((center) => (
              <article className="platform-center" key={center.id}>
                <div className="platform-center-info">
                  <div className="platform-center-headline">
                    <h2>{center.name}</h2>
                    <span className={`badge ${center.active ? 'accepted' : 'paused'}`}>
                      {t(center.active ? 'Active' : 'Suspended')}
                    </span>
                  </div>
                  <p className="muted">
                    {center.owner_name || t('Awaiting activation')}
                    <span className="center-contact-separator"> · </span>
                    <span className="center-phone">{center.owner_phone}</span>
                  </p>
                </div>
                <div className="platform-center-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      action.reset();
                      setConfirm(center);
                    }}
                  >
                    {t(center.active ? 'Suspend' : 'Restore')}
                  </Button>
                  {!center.active && (
                    <Button
                      variant="ghost"
                      className="danger-icon-btn record-icon-action"
                      aria-label={`${t('Delete center')} ${center.name}`}
                      title={t('Delete center')}
                      onClick={() => {
                        deletion.reset();
                        setDeleteName('');
                        setDeleting(center);
                      }}
                    >
                      <Trash2 size={17} />
                    </Button>
                  )}
                  <small className="muted platform-center-hint">
                    {center.active ? t('Suspend before deleting.') : ''}
                  </small>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <Empty
            title="Create your first coaching center"
            description="Its admin receives a one-use account setup link."
          />
        )}
        <NextPage next={centers.data?.next} onNext={(cursor) => update({ cursor })} />
      </State>
      <details className="panel platform-recovery">
        <summary>{t('Platform-assisted recovery')}</summary>
        <p className="muted">
          {t(
            'Verify identity through established onboarding records first. Center-admin status alone does not prove ownership of a personal account.',
          )}
        </p>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate({
              path: '/platform/recovery',
              body: {
                phone: f.get('phone'),
                evidence: f.get('evidence'),
                confirmed: f.get('confirmed') === 'on',
              },
            });
          }}
        >
          <div className="form-grid">
            <Field label="Phone number">
              <input type="tel" name="phone" required />
            </Field>
            <Field
              label="Verification reference"
              hint="Record a support reference, not sensitive documents."
            >
              <input name="evidence" required minLength={20} maxLength={300} />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" name="confirmed" required />
            {t('I independently verified this person’s account ownership.')}
          </label>
          <div className="actions">
            <Button type="submit" variant="secondary" busy={action.isPending}>
              {t('Issue one-use recovery code')}
            </Button>
          </div>
        </form>
        {recovery && (
          <div className="notice">
            <p>
              {t('Share privately with the verified person. This is shown only in this session.')}
            </p>
            <code className="break-all">{recovery}</code>
            <Button variant="ghost" onClick={() => setRecovery('')}>
              {t('Hide code')}
            </Button>
          </div>
        )}
      </details>
      <Dialog title="Delete center" open={deleting !== null} onClose={() => setDeleting(null)}>
        {deleting && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (deleteName === deleting.name)
                deletion.mutate({ id: deleting.id, name: deleteName });
            }}
          >
            <p>
              {t(
                'Permanently delete this coaching center and all its students, results, messages, staff access and SMS settings? This cannot be undone. User accounts and other coaching centers are kept. SMS already sent cannot be recalled.',
              )}
            </p>
            <p className="notice">
              <strong>{deleting.name}</strong>
            </p>
            <p className="muted break-all">
              {t('Center ID')}: {deleting.id}
            </p>
            <Field label="Type the coaching center name to confirm">
              <input
                value={deleteName}
                onChange={(event) => setDeleteName(event.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            <Alert error={deletion.error} />
            <div className="actions">
              <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
                {t('Cancel')}
              </Button>
              <Button
                type="submit"
                variant="danger"
                busy={deletion.isPending}
                disabled={deleteName !== deleting.name}
              >
                {t('Delete permanently')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog title="Create center" open={creating} onClose={() => setCreating(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate({
              path: '/platform/centers',
              body: {
                name: f.get('name'),
                phone: f.get('phone'),
              },
            });
          }}
        >
          <Field label="Center name">
            <input name="name" required />
          </Field>
          <Field label="Phone number">
            <input name="phone" type="tel" required />
          </Field>
          <Alert error={action.error} />
          <div className="actions">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" busy={action.isPending}>
              {t('Create center')}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog title="Invitation link" open={Boolean(token)} onClose={() => setToken('')}>
        <Invitation token={token} />
      </Dialog>
      <Dialog
        title={confirm?.active ? 'Suspend center' : 'Restore center'}
        open={confirm !== null}
        onClose={() => setConfirm(null)}
      >
        <p>
          {confirm?.active
            ? 'This blocks center access and stops unsent campaigns. Already-submitted SMS cannot be recalled.'
            : 'Restore access to this coaching center?'}
        </p>
        <Button
          variant="danger"
          busy={action.isPending}
          onClick={() => {
            if (confirm)
              action.mutate({
                path: `/platform/centers/${confirm.id}`,
                method: 'PATCH',
                body: { active: !confirm.active },
              });
          }}
        >
          {t('Continue')}
        </Button>
      </Dialog>
    </PlatformFrame>
  );
}
