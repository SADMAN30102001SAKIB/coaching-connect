import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, MessageSquareText, ShieldCheck } from 'lucide-react';
import { formText, request } from './api';
import { useLocale } from './i18n';
import { ThemePicker } from './components/ThemePicker';
import { Alert, Button, Field, State } from './ui';

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useLocale();
  const [saved, setSaved] = useState(false);
  return (
    <section className="panel recovery">
      <ShieldCheck size={30} />
      <h2>{t('Save recovery codes')}</h2>
      <p>
        {t('Keep these somewhere private. Each code works once. They will not be shown again.')}
      </p>
      <div className="code-grid">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          const blob = new Blob([codes.join('\n')], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'coaching-recovery-codes.txt';
          a.click();
          URL.revokeObjectURL(url);
          setSaved(true);
        }}
      >
        {t('Save recovery codes')}
      </Button>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('I saved my codes')}
      </label>
      <Button disabled={!saved} onClick={onDone}>
        <Check size={18} />
        {t('Continue')}
      </Button>
    </section>
  );
}
export function AuthScreen({ onDone }: { onDone: () => void }) {
  const token = new URLSearchParams(location.search).get('invite');
  const [mode, setMode] = useState<'login' | 'recover' | 'bootstrap' | 'activate'>(
    token ? 'activate' : 'login',
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);
  const { t, locale, toggle } = useLocale();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: ({ signal }) =>
      request<{ name: string; existing: number }>(
        `/auth/invitation?token=${encodeURIComponent(token ?? '')}`,
        'GET',
        undefined,
        signal,
      ),
    enabled: Boolean(token),
  });
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const phone = formText(form, 'phone');
      const password = formText(form, 'password');
      const name = formText(form, 'name');
      if (mode === 'activate') {
        if (invitation.data?.existing) await request('/auth/login', 'POST', { phone, password });
        return request<{ recovery_codes: string[] }>('/auth/activate', 'POST', {
          token,
          name,
          ...(invitation.data?.existing ? {} : { password }),
        });
      }
      if (mode === 'bootstrap')
        return request<{ recovery_codes: string[] }>('/auth/bootstrap', 'POST', {
          name,
          phone,
          password,
          token: form.get('token'),
        });
      if (mode === 'recover') {
        await request('/auth/recover', 'POST', { phone, password, code: form.get('code') });
        return { recovery_codes: [] };
      }
      await request('/auth/login', 'POST', { phone, password });
      return { recovery_codes: [] };
    },
    onSuccess: (result) => {
      if (result.recovery_codes.length) setCodes(result.recovery_codes);
      else if (mode === 'recover') {
        setMode('login');
        setSuccess(true);
      } else onDone();
    },
  });
  const title =
    mode === 'bootstrap'
      ? 'Set up platform'
      : mode === 'activate'
        ? 'Activate account'
        : mode === 'recover'
          ? 'Reset password'
          : 'Sign in';
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <a className="brand" href="/">
          <span className="brand-icon">
            <MessageSquareText size={25} />
          </span>
          coaching<span>connect</span>
        </a>
        <div>
          <p className="eyebrow">{t('LESS ADMIN. MORE TEACHING.')}</p>
          <h1>
            {t('Your next result.')}
            <br />
            {t('Their next milestone.')}
          </h1>
          <p>
            {t(
              'Bring your students, results, and family updates together. Thoughtfully simple. Always personal.',
            )}
          </p>
          <div className="story-note">
            <span className="story-line" />
            <p>
              {t('One message template.')}
              <br />
              <strong>{t('A personal update for every family.')}</strong>
            </p>
          </div>
        </div>
        <p className="story-footer">
          <ShieldCheck size={17} />
          {t('Separate centers. Private records. Clear control.')}
        </p>
      </aside>
      <section className="auth-main">
        <div className="auth-tools">
          <ThemePicker />
          <Button variant="ghost" onClick={toggle}>
            {locale === 'en' ? 'বাংলা' : 'English'}
          </Button>
        </div>
        <div className="auth-content">
          {codes.length ? (
            <RecoveryCodes codes={codes} onDone={onDone} />
          ) : (
            <>
              <div className="auth-mark">
                <MessageSquareText size={26} />
              </div>
              <p className="eyebrow">COACHING CONNECT</p>
              <h1>{t(title)}</h1>
              <p className="muted">
                {mode === 'activate'
                  ? invitation.data?.name
                  : t('Your coaching center, connected.')}
              </p>
              <Alert error={mutation.error} />
              {mode === 'activate' && (
                <State query={invitation} compact>
                  {null}
                </State>
              )}
              {success && (
                <Alert success>{t('Password reset. Sign in with your new password.')}</Alert>
              )}
              <form
                key={mode}
                onSubmit={(e) => {
                  e.preventDefault();
                  mutation.mutate(new FormData(e.currentTarget));
                }}
              >
                <fieldset
                  className="form-fields"
                  disabled={mutation.isPending || (mode === 'activate' && !invitation.data)}
                >
                  {(mode === 'bootstrap' || mode === 'activate') && (
                    <Field label="Your name">
                      <input name="name" autoComplete="name" required maxLength={160} />
                    </Field>
                  )}
                  {mode === 'bootstrap' && (
                    <Field label="Setup key">
                      <input
                        name="token"
                        type="password"
                        required
                        minLength={32}
                        autoComplete="off"
                      />
                    </Field>
                  )}
                  {(mode !== 'activate' || invitation.data?.existing === 1) && (
                    <Field label="Phone number">
                      <input
                        name="phone"
                        type="tel"
                        autoComplete="username"
                        placeholder="01XXXXXXXXX"
                        required
                      />
                    </Field>
                  )}
                  {mode === 'recover' && (
                    <Field label="Recovery code">
                      <input name="code" autoComplete="off" required minLength={16} />
                    </Field>
                  )}
                  <Field
                    label={
                      mode === 'recover' || mode === 'activate' || mode === 'bootstrap'
                        ? 'New password'
                        : 'Password'
                    }
                    hint={
                      mode === 'login' || invitation.data?.existing
                        ? undefined
                        : 'Use at least 15 characters.'
                    }
                  >
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        mode === 'login' || invitation.data?.existing
                          ? 'current-password'
                          : 'new-password'
                      }
                      required
                      minLength={mode === 'login' || invitation.data?.existing ? 1 : 15}
                      maxLength={128}
                    />
                  </Field>
                  <Button type="submit" busy={mutation.isPending} className="full">
                    {t(invitation.data?.existing ? 'Sign in to accept' : title)}
                    <ArrowRight size={18} />
                  </Button>
                </fieldset>
              </form>
              {mode === 'login' ? (
                <div className="auth-links">
                  <button
                    onClick={() => {
                      mutation.reset();
                      setMode('recover');
                    }}
                  >
                    {t('Forgot password?')}
                  </button>
                  <button
                    onClick={() => {
                      mutation.reset();
                      setMode('bootstrap');
                    }}
                  >
                    {t('Set up platform')}
                  </button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    mutation.reset();
                    setMode('login');
                  }}
                >
                  <ArrowLeft size={16} />
                  {t('Back to sign in')}
                </Button>
              )}
              {mode === 'recover' && (
                <p className="muted">
                  {t(
                    'Lost your recovery codes? Contact the platform owner. A center admin cannot reset your personal password.',
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
