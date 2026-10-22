import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { Context, Page } from '@coaching/domain';

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

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(
      'Cannot connect. Check your internet connection. Unsaved changes have not been sent.',
      0,
      'OFFLINE',
    );
  }
  const value: unknown = await response.json();
  if (!response.ok) {
    const data = value as { error?: { message?: string; code?: string; requestId?: string } };
    if (
      response.status === 401 &&
      !path.startsWith('/auth/login') &&
      !path.startsWith('/auth/session') &&
      !path.startsWith('/auth/invitation') &&
      !path.startsWith('/auth/recover') &&
      !path.startsWith('/auth/bootstrap')
    ) {
      unauthorizedHandler?.();
    }
    throw new ApiError(
      data.error?.message ?? 'This request could not finish. Reload and try again.',
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
    queryFn: () => request<T>(`/c/${centerId}${path}`),
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
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['data', centerId] });
    },
  });
}
export function useChoices<T>(path: string, enabled = true) {
  const { centerId } = useCenter();
  const query = useInfiniteQuery({
    queryKey: ['data', centerId, path, 'choices'],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request<Page<T>>(
        `/c/${centerId}${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(pageParam)}`,
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled,
  });
  return {
    ...query,
    data: query.data ? { items: query.data.pages.flatMap((page) => page.items) } : undefined,
  };
}
