import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@coaching/domain';
import { formText, request } from '../api';
import { useLocale } from '../i18n';
import { Alert, Button, Field, Page, State, useDraftSnapshot, useUnsaved } from '../ui';

export function ProfileSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => request<Session>('/auth/session', 'GET', undefined, signal),
  });
  const [dirty, setDirty] = useState(false);
  const user = useDraftSnapshot(session.data?.user, dirty);
  const action = useMutation({
    mutationFn: (name: string) => request('/auth/profile', 'PATCH', { name }),
    onSuccess: async () => {
      setDirty(false);
      onDirtyChange(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['session'] }),
        client.invalidateQueries({ queryKey: ['platform'] }),
        client.invalidateQueries({
          queryKey: ['data'],
          predicate: (query) => String(query.queryKey[2]).startsWith('/staff'),
        }),
      ]);
    },
  });
  return (
    <section className="panel">
      <h2>{t('Your profile')}</h2>
      <p className="muted">
        {t('Your name is shared across your coaching centers. Only you can change it.')}
      </p>
      <State query={session}>
        <form
          key={user?.name}
          onChange={() => {
            setDirty(true);
            onDirtyChange(true);
            action.reset();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate(formText(new FormData(event.currentTarget), 'name'));
          }}
        >
          <Field label="Display name">
            <input
              name="name"
              autoComplete="name"
              defaultValue={user?.name}
              required
              maxLength={160}
              disabled={action.isPending}
            />
          </Field>
          <Alert error={action.error} />
          {action.isSuccess && <Alert success>{t('Your name has been updated.')}</Alert>}
          <div className="actions">
            <Button type="submit" busy={action.isPending}>
              {t('Save name')}
            </Button>
          </div>
        </form>
      </State>
    </section>
  );
}

export function AccountSettingsPage() {
  const [dirty, setDirty] = useState(false);
  const unsaved = useUnsaved(dirty);
  return (
    <Page title="Settings">
      {unsaved.prompt}
      <ProfileSettings onDirtyChange={setDirty} />
    </Page>
  );
}
