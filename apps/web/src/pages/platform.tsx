import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Center, Page as Paged } from '@coaching/domain';
import { request } from '../api';
import { useLocale } from '../i18n';
import { Alert, Button, Dialog, Empty, Field, NextPage, Page, State } from '../ui';
import { Invitation } from './manage';

export default function Platform() {
  const { t } = useLocale();
  const client = useQueryClient();
  const [cursor, setCursor] = useState('');
  const centers = useQuery({
    queryKey: ['platform', cursor],
    queryFn: () =>
      request<Paged<Center & { owner_phone: string; owner_name: string }>>(
        `/platform/centers?cursor=${encodeURIComponent(cursor)}`,
      ),
  });
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState('');
  const [recovery, setRecovery] = useState('');
  const [confirm, setConfirm] = useState<Center | null>(null);
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
    <Page
      eyebrow="PLATFORM OWNER"
      title="Coaching centers"
      description="Provision independent workspaces. Center data stays inside each center."
      action={
        <Button onClick={() => setCreating(true)}>
          <Plus size={18} />
          {t('Create center')}
        </Button>
      }
    >
      <Alert error={action.error} />
      <State pending={centers.isPending} error={centers.error}>
        {centers.data?.items.length ? (
          <section className="panel">
            {centers.data.items.map((center) => (
              <div className="record-row" key={center.id}>
                <div className="grow">
                  <strong>{center.name}</strong>
                  <small>
                    {center.owner_name} · {center.owner_phone}
                  </small>
                </div>
                <span className={`badge ${center.active ? 'accepted' : 'paused'}`}>
                  {t(center.active ? 'Active' : 'Suspended')}
                </span>
                <Button variant="secondary" onClick={() => setConfirm(center)}>
                  {center.active ? 'Suspend' : 'Restore'}
                </Button>
              </div>
            ))}
          </section>
        ) : (
          <Empty
            title="Create your first coaching center"
            description="Its admin receives a one-use account setup link."
          />
        )}
        <NextPage next={centers.data?.next} onNext={setCursor} />
      </State>
      <section className="panel">
        <h2>{t('Platform-assisted recovery')}</h2>
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
          <Button type="submit" variant="secondary" busy={action.isPending}>
            {t('Issue one-use recovery code')}
          </Button>
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
      </section>
      <Dialog title="Create center" open={creating} onClose={() => setCreating(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action.mutate({
              path: '/platform/centers',
              body: {
                name: f.get('name'),
                admin_name: f.get('admin'),
                phone: f.get('phone'),
                timezone: f.get('timezone'),
              },
            });
          }}
        >
          <Field label="Center name">
            <input name="name" required />
          </Field>
          <Field label="Admin name">
            <input name="admin" required />
          </Field>
          <Field label="Phone number">
            <input name="phone" type="tel" required />
          </Field>
          <Field label="Timezone">
            <input name="timezone" defaultValue="Asia/Dhaka" required />
          </Field>
          <Alert error={action.error} />
          <Button type="submit" busy={action.isPending}>
            {t('Create center')}
          </Button>
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
    </Page>
  );
}
