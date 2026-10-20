import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LoginRequest,
  RosterEntry,
  SessionUser,
  SetupRequest,
  SetupStatus,
  UpdateMe,
} from '@mise/contracts';
import { useNavigate } from '@tanstack/react-router';
import { api, RequestFailed } from './client.js';
import { sendPending } from './ticks.js';

/** Whether this server has ever been set up, the language it speaks, and its name. */
export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<SetupStatus>('/setup/status'),
    staleTime: Infinity,
  });
}

/**
 * Who is signed in, or null. A 401 is a normal answer here rather than an
 * error, because "nobody is signed in" is a state the shell renders.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const { user } = await api.get<{ user: SessionUser }>('/auth/me');
        return user;
      } catch (error) {
        if (error instanceof RequestFailed && error.isUnauthenticated) return null;
        throw error;
      }
    },
    retry: false,
  });
}

/** Change something about yourself. Today that is only the language. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMe) => api.patch<{ user: SessionUser }>('/auth/me', input),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => api.post<{ user: SessionUser }>('/auth/login', input),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
    },
  });
}

/** How long signing out waits for this person's saved ticks to go through. */
const FLUSH_MS = 3_000;

/**
 * Signing out on a shared tablet. Saved ticks get one last try first; any
 * still waiting stay saved for this person's next sign-in. Then everything
 * this person had loaded is forgotten, so the next cook starts clean, and a
 * tablet goes back to the list of names.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      const user = queryClient.getQueryData<SessionUser | null>(['me']);
      if (user) {
        await Promise.race([
          sendPending(user.id),
          new Promise((resolve) => window.setTimeout(resolve, FLUSH_MS)),
        ]);
      }
      await api.post<void>('/auth/logout');
      return user;
    },
    onSuccess: async (user) => {
      await navigate({ to: user?.onTablet ? '/line' : '/login' });
      queryClient.getMutationCache().clear();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'setup-status' });
      queryClient.setQueryData(['me'], null);
    },
  });
}

export function useSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupRequest) => api.post<{ user: SessionUser }>('/setup', input),
    // Only who is signed in. The setup page marks the server as set up itself,
    // once its closing animation has played, so nothing redirects mid-way.
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
    },
  });
}

/**
 * The staff list a shared tablet shows. Only reachable from an enrolled
 * device, so a 403 here means "this is not a kitchen tablet" rather than a
 * failure worth showing as an error.
 */
export function useRoster(enabled: boolean) {
  return useQuery({
    queryKey: ['roster'],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<RosterEntry[]>('/auth/roster');
      } catch (error) {
        if (error instanceof RequestFailed && error.status === 403) return null;
        throw error;
      }
    },
  });
}

export function usePinLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; pin: string }) =>
      api.post<{ user: SessionUser }>('/auth/pin-login', input),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
    },
  });
}
