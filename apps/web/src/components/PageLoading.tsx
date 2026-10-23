import { useEffect, useState, type ReactNode } from 'react';
import { useIsFetching, useQueryClient, type Query } from '@tanstack/react-query';
import { Loading } from '../ui';

const initialRead = (query: Query) =>
  query.state.data === undefined && query.state.status === 'pending';

export function PageLoading() {
  return (
    <div className="page-loading">
      <div className="page-header" aria-hidden="true">
        <div className="skeleton-heading" />
      </div>
      <Loading />
    </div>
  );
}

export function PageReady({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const pending = useIsFetching({ predicate: initialRead });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    // Include queries mounted by descendants before revealing the completed layout.
    const frame = requestAnimationFrame(() => {
      if (!client.isFetching({ predicate: initialRead })) setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [client, pending, ready]);
  return (
    <div className="page-stage" aria-busy={!ready}>
      {!ready && <PageLoading />}
      <div className="page-content" hidden={!ready}>
        {children}
      </div>
    </div>
  );
}

export function WorkspaceLoading() {
  return (
    <div className="app-shell workspace-loading">
      <aside className="sidebar" aria-hidden="true">
        <div className="skeleton-heading" />
        <div className="skeleton-navigation">
          {Array.from({ length: 8 }, (_, row) => (
            <div className="skeleton-row" key={row}>
              <span />
              <div>
                <i />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="workspace">
        <div className="topbar" aria-hidden="true">
          <div className="skeleton-heading" />
        </div>
        <main className="main-content">
          <PageLoading />
        </main>
        <div className="workspace-footer" aria-hidden="true">
          Coaching Connect
        </div>
      </div>
      <div className="bottom-nav" aria-hidden="true">
        <div className="skeleton-navigation">
          {Array.from({ length: 5 }, (_, row) => (
            <span className="skeleton-line" key={row} />
          ))}
        </div>
      </div>
    </div>
  );
}
