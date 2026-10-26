import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMenu, Menu, MenuOverview, MenuSummary, UpdateMenu } from '@mise/contracts';
import { api, RequestFailed } from './client.js';

/** Menus, and what they print. */

export function useMenus() {
  return useQuery({ queryKey: ['menus'], queryFn: () => api.get<MenuSummary[]>('/menus') });
}

export function useMenu(id: string) {
  return useQuery({ queryKey: ['menu', id], queryFn: () => api.get<Menu>(`/menus/${id}`) });
}

export function useMenuOverview(id: string) {
  return useQuery({
    queryKey: ['menu-overview', id],
    queryFn: () => api.get<MenuOverview>(`/menus/${id}/overview`),
    // A refusal won't change by asking again straight away.
    retry: (count, error) => !(error instanceof RequestFailed && error.status < 500) && count < 1,
  });
}

function useMenuSaved() {
  const queryClient = useQueryClient();
  return (menu: Menu) => {
    queryClient.setQueryData(['menu', menu.id], menu);
    void queryClient.invalidateQueries({ queryKey: ['menus'] });
    void queryClient.invalidateQueries({ queryKey: ['menu-overview', menu.id] });
  };
}

export function useCreateMenu() {
  const saved = useMenuSaved();
  return useMutation({
    mutationFn: (input: Partial<CreateMenu> & { name: string }) => api.post<Menu>('/menus', input),
    onSuccess: saved,
  });
}

export function useUpdateMenu(id: string) {
  const saved = useMenuSaved();
  return useMutation({
    mutationFn: (input: UpdateMenu) => api.patch<Menu>(`/menus/${id}`, input),
    onSuccess: saved,
  });
}

export function useDuplicateMenu(id: string) {
  const saved = useMenuSaved();
  return useMutation({
    mutationFn: (name: string) => api.post<Menu>(`/menus/${id}/duplicate`, { name }),
    onSuccess: saved,
  });
}

export function useDeleteMenu() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/menus/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['menus'] }),
  });
}

export function useMarkCardsPrinted(id: string) {
  const saved = useMenuSaved();
  return useMutation({
    mutationFn: () => api.post<Menu>(`/menus/${id}/cards-printed`),
    onSuccess: saved,
  });
}
