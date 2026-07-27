'use client';

import { currentUserResponseSchema } from '@bug-bounty-escrow/shared';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

export function useCurrentUser() {
  const { session } = useAuth();
  return useQuery({
    queryKey: queryKeys.me,
    enabled: session !== null,
    queryFn: async () =>
      (
        await apiRequest('/api/me', currentUserResponseSchema, {
          token: session?.access_token,
        })
      ).data,
  });
}
