import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DishCard, DishCardSettings, UpdateDishCardSettings } from '@mise/contracts';
import { api, BASE_URL, RequestFailed } from './client.js';

/** Dish cards, and how this kitchen wants them to look. */

export function useDishCard(recipeId: string) {
  return useQuery({
    queryKey: ['dish-card', recipeId],
    queryFn: () => api.get<DishCard>(`/recipes/${recipeId}/card`),
    // A refusal won't change by asking again straight away.
    retry: (count, error) => !(error instanceof RequestFailed && error.status < 500) && count < 1,
  });
}

export function useDishCardSettings() {
  return useQuery({
    queryKey: ['dish-card-settings'],
    queryFn: () => api.get<DishCardSettings>('/dish-cards/settings'),
  });
}

function useSettingsSaved() {
  const queryClient = useQueryClient();
  return (settings: DishCardSettings) => {
    queryClient.setQueryData(['dish-card-settings'], settings);
    void queryClient.invalidateQueries({ queryKey: ['dish-card'] });
  };
}

export function useUpdateDishCardSettings() {
  const saved = useSettingsSaved();
  return useMutation({
    mutationFn: (input: UpdateDishCardSettings) =>
      api.patch<DishCardSettings>('/dish-cards/settings', input),
    onSuccess: saved,
  });
}

export function useUploadLogo() {
  const saved = useSettingsSaved();
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${BASE_URL}/dish-cards/logo`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const parsed = await response.json().catch(() => null);
        throw new RequestFailed(response.status, parsed, response.statusText);
      }
      return (await response.json()) as DishCardSettings;
    },
    onSuccess: saved,
  });
}

export function useRemoveLogo() {
  const saved = useSettingsSaved();
  return useMutation({
    mutationFn: () => api.delete<DishCardSettings>('/dish-cards/logo'),
    onSuccess: saved,
  });
}
