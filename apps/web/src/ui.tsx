import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Inbox, LoaderCircle, X } from 'lucide-react';
import { useLocale } from './i18n';
import { useBlocker } from 'react-router';

export function Button({
  busy = false,
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return (
    <button
      {...props}
      className={`button ${variant} ${props.className ?? ''}`}
      disabled={props.disabled || busy}
      aria-busy={busy}
    >
      {busy && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string | undefined }>;
  hint?: string | undefined;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{t(label)}</label>
      {cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint && <small id={`${id}-hint`}>{t(hint)}</small>}
    </div>
  );
}
export function Alert({
  error,
  children,
  success = false,
}: {
  error?: unknown;
  children?: ReactNode;
  success?: boolean;
}) {
  const { t } = useLocale();
  if (!error && !children) return null;
  return (
    <div className={`alert ${success ? 'success' : 'error'}`} role={success ? 'status' : 'alert'}>
      {success ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
      <div>{error instanceof Error ? t(error.message) : children}</div>
    </div>
  );
}
export function Page({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <>
      <header className="page-header">
        <div>
          {eyebrow && <p className="eyebrow">{t(eyebrow)}</p>}
          <h1>{t(title)}</h1>
          {description && <p className="muted">{t(description)}</p>}
        </div>
        {action}
      </header>
      {children}
    </>
  );
}
export function Empty({
  title = 'No records yet',
  description = 'Create your first record to get started.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={28} />
      </div>
      <h2>{t(title)}</h2>
      <p>{t(description)}</p>
      {action}
    </div>
  );
}
export function Loading() {
  const { t } = useLocale();
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} />
      {t('Loading…')}
    </div>
  );
}
export function State({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error?: unknown;
  children: ReactNode;
}) {
  return pending ? <Loading /> : error ? <Alert error={error} /> : children;
}
const statuses: Record<string, string> = {
  ready_for_review: 'Ready for review',
  needs_review: 'Needs review',
  unknown: 'Needs checking',
  pending: 'Pending',
  queued: 'Queued',
  scheduled: 'Scheduled',
  preparing: 'Preparing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  paused: 'Paused',
  processing: 'Processing',
  accepted: 'Accepted',
  delivered: 'Delivered',
  failed: 'Failed',
  skipped: 'Skipped',
  scored: 'Scored',
  absent: 'Absent',
  exempt: 'Exempt',
};
export function Badge({ status }: { status: string }) {
  const { t } = useLocale();
  return (
    <span className={`badge ${status}`}>
      <span aria-hidden="true" />
      {t(statuses[status] ?? status)}
    </span>
  );
}
export function Dialog({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useLocale();
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) onClose();
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, [onClose]);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby={id}>
      <div className="dialog-header">
        <h2 id={id}>{t(title)}</h2>
        <Button type="button" variant="ghost" onClick={onClose} aria-label={t('Close')}>
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  open,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <Dialog title={title} open={open} onClose={onCancel}>
      <p>{t(message)}</p>
      <div className="actions">
        <Button variant="secondary" type="button" onClick={onCancel}>
          {t(cancelLabel)}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} type="button" onClick={onConfirm}>
          {t(confirmLabel)}
        </Button>
      </div>
    </Dialog>
  );
}
export function NextPage({
  next,
  onNext,
}: {
  next: string | null | undefined;
  onNext: (next: string) => void;
}) {
  const { t } = useLocale();
  return next ? (
    <div className="pagination">
      <Button variant="secondary" onClick={() => onNext(next)}>
        {t('Next')}
        <ArrowRight size={16} />
      </Button>
    </div>
  ) : null;
}
export function MoreChoices({
  query,
}: {
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
}) {
  const { t } = useLocale();
  return query.hasNextPage ? (
    <Button
      type="button"
      variant="ghost"
      busy={query.isFetchingNextPage}
      onClick={() => {
        void query.fetchNextPage();
      }}
    >
      {t('Load more')}
    </Button>
  ) : null;
}
export function useUnsaved(dirty: boolean) {
  const allowed = useRef(false);
  const blocker = useBlocker(() => dirty && !allowed.current);
  const { t } = useLocale();
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  return {
    allowNavigation: () => {
      allowed.current = true;
    },
    prompt: (
      <Dialog
        title="Unsaved changes"
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
      >
        <p>{t('Leave this page without saving your changes?')}</p>
        <div className="actions">
          <Button variant="secondary" onClick={() => blocker.reset?.()}>
            {t('Back')}
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            {t('Leave without saving')}
          </Button>
        </div>
      </Dialog>
    ),
  };
}
export function dateTime(timestamp: number | null, timezone: string, locale: string) {
  return timestamp
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(timestamp)
    : '—';
}
