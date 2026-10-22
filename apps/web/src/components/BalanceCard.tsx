import { Wallet } from 'lucide-react';
import type { Balance } from '@coaching/domain';
import { useAction, useCenter, useData } from '../api';
import { useLocale } from '../i18n';
import { Alert, Button, dateTime } from '../ui';

export function BalanceCard() {
  const { center, permissions } = useCenter();
  const { t, locale } = useLocale();
  const allowed = permissions.includes('balance.read');
  const query = useData<Balance>('/balance', allowed);
  const refresh = useAction<Balance>();
  if (!allowed) return null;
  const data = query.data;
  return (
    <section className="panel balance-panel">
      <div>
        <p className="eyebrow">
          <Wallet size={15} /> {t('SMS balance')}
        </p>
        <strong className="balance-number">
          {data?.balance === null || data?.balance === undefined ? '—' : `৳${data.balance}`}
        </strong>
        <p className="muted">
          {data?.checked_at
            ? dateTime(data.checked_at, center.timezone, locale)
            : t('Not checked yet')}
        </p>
        {data?.estimate_sms !== null && data?.estimate_sms !== undefined && (
          <p className="muted">
            Provider estimate: {data.estimate_sms} SMS. Long or Bangla messages may use more.
          </p>
        )}
        <small>{t('Balance is cached, not a reservation.')}</small>
        <Alert error={refresh.error ?? query.error} />
      </div>
      {permissions.includes('balance.refresh') && (
        <Button
          variant="secondary"
          busy={refresh.isPending}
          onClick={() => refresh.mutate({ path: '/balance/refresh' })}
        >
          {t('Refresh balance')}
        </Button>
      )}
    </section>
  );
}
