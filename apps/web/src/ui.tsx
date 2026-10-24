import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Inbox,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
import { useLocale } from './i18n';
import { useBlocker, useSearchParams } from 'react-router';
import { ApiError, retryRead } from './api';
import { useIsMutating } from '@tanstack/react-query';

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
  if (!error && !children) return null;
  return (
    <div className={`alert ${success ? 'success' : 'error'}`} role={success ? 'status' : 'alert'}>
      {success ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
      <div>{error instanceof Error ? <ErrorText error={error} /> : children}</div>
    </div>
  );
}
function ErrorText({ error }: { error: Error }) {
  const { t, locale } = useLocale();
  if (error instanceof ApiError && error.details.length) {
    const number = new Intl.NumberFormat(locale);
    return (
      <>
        {error.details.map((detail, index) => (
          <div key={index}>
            {detail.section && detail.item
              ? `${t(detail.section)} ${number.format(detail.item)} — `
              : ''}
            {t(detail.field)}:{' '}
            {t(detail.message).replace(
              '{limit}',
              detail.limit === undefined ? '' : number.format(detail.limit),
            )}
          </div>
        ))}
      </>
    );
  }
  return <>{t(error.message)}</>;
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
  const heading = t(title);
  return (
    <>
      <header className="page-header">
        <div>
          {eyebrow && <p className="eyebrow">{t(eyebrow)}</p>}
          <h1 lang={/[\u0980-\u09ff]/u.test(heading) ? 'bn' : undefined}>{heading}</h1>
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
export function Loading({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  return (
    <div
      className={`skeleton${compact ? ' compact' : ''}`}
      role="status"
      aria-label={t('Loading…')}
    >
      <span className="sr-only">{t('Loading…')}</span>
      <div className="skeleton-line short" aria-hidden="true" />
      {(compact ? [] : [0, 1, 2]).map((row) => (
        <div className="skeleton-row" key={row} aria-hidden="true">
          <span />
          <div>
            <i />
            <i />
          </div>
        </div>
      ))}
    </div>
  );
}
export function State({
  query,
  compact = false,
  children,
}: {
  query: {
    isPending: boolean;
    error: unknown;
    data: unknown;
    isFetching: boolean;
    fetchStatus: string;
    refetch: () => Promise<unknown>;
  };
  children: ReactNode;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const terminal = query.error instanceof ApiError && [401, 403, 404].includes(query.error.status);
  const hasData = query.data !== undefined && !terminal;
  const paused = query.fetchStatus === 'paused';
  return (
    <div className="query-state" aria-busy={query.isFetching}>
      {(query.error || paused) && (
        <div className="query-notice" role="status">
          <div>
            {hasData && (paused || retryRead(0, query.error)) ? (
              t('Showing saved data. Reconnect or try again to update.')
            ) : paused ? (
              t('You are offline. Reconnect to load this screen.')
            ) : query.error instanceof Error ? (
              <ErrorText error={query.error} />
            ) : (
              t('This request could not finish. Please try again.')
            )}
          </div>
          {!paused && retryRead(0, query.error) && (
            <Button
              type="button"
              variant="secondary"
              busy={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
            >
              {t('Try again')}
            </Button>
          )}
        </div>
      )}
      {hasData ? children : query.isPending && !paused ? <Loading compact={compact} /> : null}
    </div>
  );
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
  refresh,
  size = 'default',
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  refresh?: (() => Promise<unknown>) | undefined;
  size?: 'default' | 'compact';
}) {
  return open ? (
    <OpenDialog title={title} onClose={onClose} refresh={refresh} size={size}>
      {children}
    </OpenDialog>
  ) : null;
}
function OpenDialog({
  title,
  onClose,
  children,
  refresh,
  size,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  refresh?: (() => Promise<unknown>) | undefined;
  size: 'default' | 'compact';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const [discard, setDiscard] = useState(false);
  const id = useId();
  const { t } = useLocale();
  const busy = useIsMutating() > 0;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    if (refresh) void refresh();
  }, [refresh]);
  const close = useCallback(() => {
    if (busy) return;
    if (discard) setDiscard(false);
    else if (dirty.current) setDiscard(true);
    else onClose();
  }, [busy, discard, onClose]);
  useEffect(() => {
    const dialog = ref.current;
    const backdrop = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-edits-form]'))
        dirty.current = true;
      if (event.target === dialog) close();
    };
    const block = (event: MouseEvent) => {
      if (busy) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    dialog?.addEventListener('click', backdrop);
    dialog?.addEventListener('click', block, true);
    return () => {
      dialog?.removeEventListener('click', backdrop);
      dialog?.removeEventListener('click', block, true);
    };
  }, [busy, close]);
  return (
    <dialog
      ref={ref}
      className={size === 'compact' ? 'dialog-compact' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onChangeCapture={(event) => {
        if (event.target instanceof Element && !event.target.closest('.picker-search-bar'))
          dirty.current = true;
      }}
      aria-labelledby={id}
    >
      <div className="dialog-header">
        <h2 id={id}>{t(title)}</h2>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={close}
          aria-label={t('Close')}
        >
          <X size={20} />
        </Button>
      </div>
      <fieldset className="form-fields dialog-body" disabled={busy} hidden={discard}>
        {children}
      </fieldset>
      {discard && (
        <div>
          <p>{t('Discard unsaved changes?')}</p>
          <div className="actions">
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              {t('Back')}
            </Button>
            <Button variant="danger" onClick={onClose}>
              {t('Leave without saving')}
            </Button>
          </div>
        </div>
      )}
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
const unsavedForms = new Set<() => void>();
export function hasUnsavedChanges() {
  return unsavedForms.size > 0;
}
export function allowWorkspaceChange() {
  for (const allow of unsavedForms) allow();
}
export function useUnsaved(dirty: boolean) {
  const allowed = useRef(false);
  const blocker = useBlocker(() => dirty && !allowed.current);
  const { t } = useLocale();
  useEffect(() => {
    if (!dirty) return;
    const allow = () => {
      allowed.current = true;
    };
    unsavedForms.add(allow);
    const listener = (event: BeforeUnloadEvent) => {
      if (!allowed.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => {
      window.removeEventListener('beforeunload', listener);
      unsavedForms.delete(allow);
    };
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
export function useDraftSnapshot<T>(value: T, dirty: boolean) {
  const [snapshot, setSnapshot] = useState(value);
  if (!dirty && snapshot !== value) {
    setSnapshot(value);
    return value;
  }
  return snapshot;
}
export function useListParams() {
  const [params, setParams] = useSearchParams();
  const update = (values: Record<string, string>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  };
  return { params, update };
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

export function SearchableSelect<T extends { id: string; name: string }>({
  id,
  items,
  selected,
  onChange,
  single = false,
  placeholder,
  query,
  emptyLabel,
  summaryFormatter,
  'aria-describedby': ariaDescribedBy,
}: {
  id?: string;
  items: T[];
  selected: string[];
  onChange: (selected: string[]) => void;
  single?: boolean;
  placeholder?: string;
  query?: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
    refetch: () => Promise<unknown>;
    isPending: boolean;
    isFetching: boolean;
    fetchStatus: string;
    error: unknown;
    data: unknown;
  };
  emptyLabel?: string;
  summaryFormatter?: (selectedItems: T[]) => string;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();
  const triggerId = id ?? pickerId;

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        document.getElementById(triggerId)?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, triggerId]);

  const selectedItems = useMemo(
    () => items.filter((item) => selected.includes(item.id)),
    [items, selected],
  );

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const queryStr = search.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(queryStr));
  }, [items, search]);

  const label = useMemo(() => {
    if (selectedItems.length < selected.length) return `${selected.length} ${t('selected')}`;
    if (summaryFormatter) return summaryFormatter(selectedItems);
    if (selectedItems.length === 0) return emptyLabel ? t(emptyLabel) : t('Choose…');
    if (selectedItems.length === 1) return selectedItems[0]?.name ?? '';
    return `${selectedItems.length} ${t('selected')}`;
  }, [summaryFormatter, selectedItems, selected.length, emptyLabel, t]);

  return (
    <div className="picker-container" ref={containerRef}>
      <button
        type="button"
        id={triggerId}
        className="picker-trigger"
        onClick={() => {
          if (!open) {
            setSearch('');
            void query?.refetch();
          }
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${triggerId}-options` : undefined}
        aria-describedby={ariaDescribedBy}
      >
        <span className={`picker-trigger-label ${selected.length === 0 ? 'placeholder' : ''}`}>
          {label}
        </span>
        <ChevronDown size={16} className={`picker-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div
          className="picker-dropdown"
          id={`${triggerId}-options`}
          role="dialog"
          aria-label={placeholder ?? t('Choose…')}
        >
          <div className="picker-search-bar">
            <Search size={14} className="picker-search-icon" />
            <input
              type="text"
              ref={searchRef}
              aria-label={placeholder ?? t('Search…')}
              className="picker-search-input"
              value={search}
              onChange={(e) => {
                e.stopPropagation();
                setSearch(e.target.value);
              }}
              placeholder={placeholder ?? t('Search…')}
            />
            {search && (
              <button
                type="button"
                className="picker-search-clear"
                onClick={() => setSearch('')}
                aria-label={t('Clear search')}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="picker-list" role="group" aria-label={t('Choices')}>
            {query?.isPending && (
              <State query={query} compact>
                {null}
              </State>
            )}
            {!query?.isPending && query?.error ? (
              <div className="query-notice" role="status">
                <div>
                  {query.error instanceof Error ? (
                    <ErrorText error={query.error} />
                  ) : (
                    t('This request could not finish. Please try again.')
                  )}
                </div>
                {retryRead(0, query.error) && (
                  <Button
                    type="button"
                    variant="secondary"
                    busy={query.isFetching}
                    onClick={() => {
                      void query.refetch();
                    }}
                  >
                    {t('Try again')}
                  </Button>
                )}
              </div>
            ) : null}
            {filteredItems.length > 0
              ? filteredItems.map((item) => {
                  const isChecked = selected.includes(item.id);
                  return (
                    <label className="picker-item" key={item.id}>
                      <input
                        type={single ? 'radio' : 'checkbox'}
                        name={single ? `picker-${triggerId}` : undefined}
                        checked={isChecked}
                        onChange={(e) => {
                          if (single) {
                            onChange([item.id]);
                            setOpen(false);
                          } else {
                            onChange(
                              e.target.checked
                                ? [...selected, item.id]
                                : selected.filter((id) => id !== item.id),
                            );
                          }
                        }}
                      />
                      <span className="picker-item-name">{item.name}</span>
                    </label>
                  );
                })
              : !query?.isPending && (
                  <div className="picker-empty-state">
                    {t(
                      query?.hasNextPage
                        ? 'No matches in loaded choices. Load more to continue searching.'
                        : 'No matches found',
                    )}
                  </div>
                )}
            {query && <MoreChoices query={query} />}
          </div>

          {!single && (
            <div className="picker-footer">
              <span className="picker-count">
                {selected.length === 0 ? t('None selected') : `${selected.length} ${t('selected')}`}
              </span>
              <div className="picker-footer-actions">
                {selected.length > 0 && (
                  <button
                    type="button"
                    className="picker-action-button"
                    onClick={() => onChange([])}
                  >
                    {t('Clear')}
                  </button>
                )}
                <button
                  type="button"
                  className="picker-action-button primary"
                  onClick={() => setOpen(false)}
                >
                  {t('Done')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
