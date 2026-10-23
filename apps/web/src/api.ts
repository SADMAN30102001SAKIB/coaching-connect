import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { Context, Mark, Page, ResultStatus } from '@coaching/domain';

export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function retryRead(failures: number, error: unknown) {
  return (
    failures < 2 &&
    error instanceof ApiError &&
    (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

export async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const read = method === 'GET';
  const connectionMessage = read
    ? 'Connection interrupted. Reconnecting will refresh this screen.'
    : 'Confirmation was not received. Check the latest records before trying again; your change may already have been saved.';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new ApiError(
      connectionMessage,
      0,
      read ? 'CONNECTION_INTERRUPTED' : 'CONFIRMATION_UNKNOWN',
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new ApiError(
      connectionMessage,
      response.status >= 400 ? response.status : 502,
      'INVALID_RESPONSE',
    );
  }
  if (!response.ok) {
    const data =
      value && typeof value === 'object'
        ? (value as { error?: { message?: string; code?: string; requestId?: string } })
        : {};
    if (
      response.status === 401 &&
      data.error?.code === 'SESSION_EXPIRED' &&
      path !== '/auth/session'
    ) {
      unauthorizedHandler?.();
    }
    throw new ApiError(
      ['EDIT_CONFLICT', 'RESULT_CONFLICT'].includes(data.error?.code ?? '')
        ? 'This record changed elsewhere. Your edits are kept. Discard changes or reopen the editor to load the latest saved values.'
        : (data.error?.message ?? 'This request could not finish. Please try again.'),
      response.status,
      data.error?.code ?? 'REQUEST_FAILED',
      data.error?.requestId,
    );
  }
  return value as T;
}
export const CenterContext = createContext<(Context & { centerId: string }) | null>(null);
export function useCenter() {
  const context = useContext(CenterContext);
  if (!context) throw new Error('A coaching center must be selected');
  return context;
}
export function useData<T>(
  path: string,
  enabled = true,
  interval?: number | ((data: T | undefined) => number | false),
) {
  const { centerId } = useCenter();
  return useQuery({
    queryKey: ['data', centerId, path],
    queryFn: ({ signal }) => request<T>(`/c/${centerId}${path}`, 'GET', undefined, signal),
    enabled,
    refetchInterval:
      typeof interval === 'function' ? (query) => interval(query.state.data) : (interval ?? false),
    refetchIntervalInBackground: false,
  });
}
export function useAction<T = { id: string }>() {
  const { centerId } = useCenter();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body = {},
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => request<T>(`/c/${centerId}${path}`, method, body),
    onSuccess: (_result, { path, method, body }) => {
      if (method === 'PUT' && path.endsWith('/marks')) {
        const saved = body as {
          student_id: string;
          status: ResultStatus;
          score: number | null;
          version: number;
        }[];
        client.setQueriesData<{ items: Mark[] }>(
          {
            queryKey: ['data', centerId],
            predicate: (query) => String(query.queryKey[2]).startsWith(`${path}?`),
          },
          (old) =>
            old
              ? {
                  ...old,
                  items: old.items.map((row) => {
                    const change = saved.find((item) => item.student_id === row.student_id);
                    return change ? { ...row, ...change, version: change.version + 1 } : row;
                  }),
                }
              : old,
        );
      }
      const resource = path.split('/')[1] ?? '';
      const related: Record<string, string[]> = {
        balance: ['balance'],
        campaigns: ['campaigns', 'home', 'balance'],
        students: ['students', 'groups', 'exams', 'campaigns', 'home', 'context'],
        catalog: ['catalog', 'groups', 'students', 'exams', 'campaigns', 'home', 'context'],
        exams: ['exams', 'campaigns', 'home', 'context'],
        templates: ['templates', 'campaigns', 'context'],
        contacts: ['students', 'campaigns', 'context'],
        roles: ['roles', 'staff', 'context'],
        staff: ['staff', 'roles', 'context'],
        ownership: ['staff', 'context'],
        settings: ['context', 'home', 'campaigns'],
        provider: ['provider', 'balance', 'campaigns', 'context'],
      };
      void client.invalidateQueries({ queryKey: ['data', centerId], refetchType: 'none' });
      void client.refetchQueries({
        type: 'active',
        predicate: (query) =>
          query.queryKey[0] === 'data' &&
          query.queryKey[1] === centerId &&
          (related[resource] ?? [resource]).includes(
            String(query.queryKey[2]).replace(/^\//, '').split(/[/?]/)[0] ?? '',
          ),
      });
      if (['settings', 'ownership'].includes(resource))
        void client.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409)
        void client.invalidateQueries({ queryKey: ['data', centerId] });
    },
  });
}
export function useChoices<T>(path: string, enabled = true) {
  const { centerId } = useCenter();
  const query = useInfiniteQuery({
    queryKey: ['data', centerId, path, 'choices'],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      request<Page<T>>(
        `/c/${centerId}${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(pageParam)}`,
        'GET',
        undefined,
        signal,
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled,
    staleTime: 0,
  });
  return {
    ...query,
    data: query.data ? { items: query.data.pages.flatMap((page) => page.items) } : undefined,
  };
}
