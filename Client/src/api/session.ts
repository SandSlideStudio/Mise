import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onReachable } from '../lib/connectivity.js';
import type {
  LoginRequest,
  RosterEntry,
  SessionUser,
  SetupRequest,
  SetupStatus,
  UpdateMe,
} from '@mise/contracts';
import { useNavigate } from '@tanstack/react-router';
import { api, noAnswer, RequestFailed } from './client.js';
import { sendPending } from './ticks.js';
import { forgetKept } from './offline.js';

/**
 * A sign-out Mise didn't hear yet.
 *
 * The session lives in a cookie the page can't touch, so signing out offline
 * is remembered here: the device counts as signed out at once, and tells Mise
 * before anything else once it answers. The next cook never carries on as
 * the last one, and never sends changes under their name.
 */
const SIGNED_OUT_KEY = 'mise.signedOut';

function signOutPending(): boolean {
  try {
    return localStorage.getItem(SIGNED_OUT_KEY) !== null;
  } catch {
    return false;
  }
}

function setSignOutPending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(SIGNED_OUT_KEY, '1');
    else localStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Storage blocked: the sign-out is only as good as the server's answer.
  }
}

/** Finish a sign-out made offline. True once nobody is signed in on Mise either. */
export async function finishSignOut(): Promise<boolean> {
  if (!signOutPending()) return true;
  try {
    await api.post<void>('/auth/logout');
  } catch (error) {
    if (!(error instanceof RequestFailed && error.isUnauthenticated)) return false;
  }
  setSignOutPending(false);
  return true;
}

/** Finish a sign-out made offline as soon as Mise answers. Mounted once, in the shell. */
export function useFinishSignOut(): void {
  useEffect(() => {
    const finish = () => {
      if (signOutPending()) void finishSignOut();
    };
    finish();
    const timer = window.setInterval(finish, 10_000);
    const offReachable = onReachable(finish);
    window.addEventListener('online', finish);
    return () => {
      window.clearInterval(timer);
      offReachable();
      window.removeEventListener('online', finish);
    };
  }, []);
}

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
      // Signed out while Mise couldn't hear it: signed out until it has.
      if (!(await finishSignOut())) return null;
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
    mutationFn: async (input: LoginRequest) => {
      await finishSignOut();
      return api.post<{ user: SessionUser }>('/auth/login', input);
    },
    onSuccess: ({ user }) => {
      // Signed in afresh: the old cookie is gone from this device either way.
      setSignOutPending(false);
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
    // Never held until the browser is back online: signing out works offline.
    networkMode: 'always',
    mutationFn: async () => {
      const user = queryClient.getQueryData<SessionUser | null>(['me']);
      if (user) {
        await Promise.race([
          sendPending(user.id),
          new Promise((resolve) => window.setTimeout(resolve, FLUSH_MS)),
        ]);
      }
      try {
        await api.post<void>('/auth/logout');
      } catch (error) {
        // Mise can't be reached: signed out here now, and on Mise once it answers.
        if (!noAnswer(error)) throw error;
        setSignOutPending(true);
      }
      return user;
    },
    onSuccess: async (user) => {
      await navigate({ to: user?.onTablet ? '/line' : '/login' });
      queryClient.getMutationCache().clear();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'setup-status' });
      // And what was kept on the device for offline use: the next person starts clean.
      await forgetKept();
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
    mutationFn: async (input: { userId: string; pin: string }) => {
      await finishSignOut();
      return api.post<{ user: SessionUser }>('/auth/pin-login', input);
    },
    onSuccess: ({ user }) => {
      setSignOutPending(false);
      queryClient.setQueryData(['me'], user);
    },
  });
}
