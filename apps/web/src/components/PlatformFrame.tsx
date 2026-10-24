import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button, Loading, Page } from '../ui';
import { useLocale } from '../i18n';

export function PlatformFrame({ action, children }: { action?: ReactNode; children: ReactNode }) {
  return (
    <div className="platform-page">
      <Page
        eyebrow="PLATFORM OWNER"
        title="Coaching centers"
        description="Provision independent workspaces. Center data stays inside each center."
        action={action}
      >
        {children}
      </Page>
    </div>
  );
}

export function PlatformLoading() {
  const { t } = useLocale();
  return (
    <PlatformFrame
      action={
        <Button disabled>
          <Plus size={18} />
          {t('Create center')}
        </Button>
      }
    >
      <Loading />
    </PlatformFrame>
  );
}
