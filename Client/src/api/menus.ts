import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMenu, Menu, MenuOverview, MenuSummary, UpdateMenu } from '@mise/contracts';
import { api, isQueued, RequestFailed, sendOrQueue } from './client.js';

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
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: (input: UpdateMenu) => {
      const before = queryClient.getQueryData<Menu>(['menu', id]);
      return sendOrQueue<Menu>('PATCH', `/menus/${id}`, input, {
        label: { key: 'offline.label.menu', vars: { name: input.name ?? before?.name ?? '' } },
        base: before?.updatedAt,
      });
    },
    onSuccess: (menu, input) => {
      if (!isQueued(menu)) return saved(menu);
      // Shown on this device as saved. Dishes it already shows can be moved
      // or taken off; one newly added needs the server to fill it in.
      queryClient.setQueryData<Menu>(['menu', id], (old) => {
        if (!old) return old;
        const { dishes, ...rest } = input;
        const byId = new Map(old.dishes.map((dish) => [dish.recipeId, dish]));
        return {
          ...old,
          ...rest,
          dishes: dishes
            ? dishes.flatMap((recipeId) => {
                const dish = byId.get(recipeId);
                return dish ? [dish] : [];
              })
            : old.dishes,
        } as Menu;
      });
    },
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
