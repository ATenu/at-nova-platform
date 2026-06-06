import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/errors';

/** Centralized query keys. Mutations invalidate the relevant key prefixes. */
export const queryKeys = {
  me: ['me'] as const,
  users: ['admin', 'users'] as const,
  roles: ['admin', 'roles'] as const,
  permissions: ['admin', 'permissions'] as const,
  agents: ['agents', 'registry'] as const,
  agent: (name: string) => ['agents', 'registry', name] as const,
  customers: ['customers'] as const,
  products: ['products'] as const,
  sales: ['sales'] as const,
  sale: (id: string) => ['sales', id] as const,
  issues: ['issues'] as const,
  issue: (id: string) => ['issues', id] as const,
  actions: ['actions'] as const,
  sops: ['sops'] as const,
  sop: (id: string) => ['sops', id] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  conversationRuns: (conversationId: string) =>
    ['conversations', conversationId, 'runs'] as const,
  runTrace: (runId: string, detailed = false) =>
    ['agent-runs', runId, 'trace', detailed ? 'full' : 'user'] as const,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry auth/permission/not-found errors; they will not recover.
          if (isApiError(error) && [401, 403, 404, 400].includes(error.status)) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
