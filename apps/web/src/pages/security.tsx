import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formText, request } from '../api';
import { RecoveryCodes } from '../auth-screen';
import { useLocale } from '../i18n';
import { Alert, Button, Field, Page } from '../ui';

export default function Security() {
  const { t } = useLocale();
  const [codes, setCodes] = useState<string[]>([]);
  const action = useMutation({
    mutationFn: (body: { current: string; password?: string }) =>
      request<{ recovery_codes: string[] }>('/auth/security', 'POST', body),
    onSuccess: (result) => setCodes(result.recovery_codes),
  });
  return (
    <Page eyebrow="YOUR PERSONAL ACCOUNT" title="Account security">
      {codes.length ? (
        <RecoveryCodes codes={codes} onDone={() => setCodes([])} />
      ) : (
        <section className="panel narrow">
          <h2>{t('Password')}</h2>
          <p className="muted">
            {t(
              'Changing your password or recovery codes signs out other sessions. Center admins cannot access your recovery codes.',
            )}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = formText(f, 'password');
              action.mutate({
                current: formText(f, 'current'),
                ...(password ? { password } : {}),
              });
            }}
          >
            <Field label="Current password">
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </Field>
            <Field label="New password" hint="Leave blank to regenerate recovery codes only.">
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={128}
              />
            </Field>
            <Alert error={action.error} />
            <Button type="submit" busy={action.isPending}>
              {t('Save changes')}
            </Button>
          </form>
        </section>
      )}
    </Page>
  );
}
