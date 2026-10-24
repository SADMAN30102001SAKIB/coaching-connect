import { useEffect, useRef } from 'react';
import { Wallet } from 'lucide-react';
import type { Balance } from '@coaching/domain';
import { ApiError, useAction, useCenter, useData } from '../api';
import { useLocale } from '../i18n';
import { Alert, Button, State, dateTime } from '../ui';

export function BalanceCard({ autoRefresh = false }: { autoRefresh?: boolean }) {
  const { center, permissions } = useCenter();
  const { t, locale } = useLocale();
  const allowed = permissions.includes('balance.read');
  const query = useData<Balance>('/balance', allowed);
  const refresh = useAction<Balance>();
  const automatic = useAction<Balance>();
  const attempted = useRef(false);
  const canRefresh = permissions.includes('balance.refresh');
  const autoMutate = automatic.mutate;
  useEffect(() => {
    if (!autoRefresh || !allowed || !canRefresh || !query.isSuccess || attempted.current) return;
    attempted.current = true;
    autoMutate({ path: '/balance/refresh' });
  }, [autoRefresh, allowed, canRefresh, query.isSuccess, autoMutate]);
  if (!allowed) return null;
  const data = query.data;
  return (
    <section className="panel balance-panel">
      <div className="balance-content">
        <p className="eyebrow">
          <Wallet size={15} /> {t('SMS balance')}
        </p>
        <State query={query} compact>
          <strong className="balance-number">
            {data?.balance === null || data?.balance === undefined ? '—' : `৳${data.balance}`}
          </strong>
          <p className="muted">
            {data?.checked_at
              ? dateTime(data.checked_at, center.timezone, locale)
              : t('Not checked yet')}
          </p>
          {data?.estimate_sms === null || data?.estimate_sms === undefined ? (
            <p className="muted">{t('Provider estimate unavailable.')}</p>
          ) : (
            <p className="muted">
              Estimate: {data.estimate_sms} SMS. Long or Bangla messages may use more.
            </p>
          )}
        </State>
        <Alert error={refresh.error} />
        <Alert
          error={
            automatic.error instanceof ApiError && automatic.error.code === 'PROVIDER_REQUIRED'
              ? null
              : automatic.error
          }
        />
      </div>
      {canRefresh && (
        <div className="balance-actions">
          <Button
            variant="secondary"
            busy={refresh.isPending || automatic.isPending}
            onClick={() => {
              automatic.reset();
              refresh.mutate({ path: '/balance/refresh' });
            }}
          >
            {t('Refresh balance')}
          </Button>
        </div>
      )}
    </section>
  );
}
