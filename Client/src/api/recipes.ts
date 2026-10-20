import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AllergenProfile,
  CreateIngredient,
  CreateRecipe,
  ExpandedRecipe,
  Ingredient,
  RecipePhoto,
  Recipe,
  RecipeSummary,
  UpdateIngredient,
  UpdateRecipe,
} from '@mise/contracts';
import { api, BASE_URL, RequestFailed } from './client.js';

/** The ingredient catalogue and the recipe library. */

export function useIngredients(search?: string) {
  return useQuery({
    queryKey: ['ingredients', search ?? ''],
    queryFn: () => api.get<Ingredient[]>('/ingredients', search ? { search } : undefined),
    staleTime: 60_000,
  });
}

export function useIngredient(id: string | undefined) {
  return useQuery({
    queryKey: ['ingredient', id],
    enabled: Boolean(id),
    queryFn: () => api.get<Ingredient>(`/ingredients/${id}`),
  });
}

export function useCreateIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIngredient) => api.post<Ingredient>('/ingredients', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}

export function useUpdateIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateIngredient & { id: string }) =>
      api.patch<Ingredient>(`/ingredients/${id}`, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}

export function useDeleteIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/ingredients/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ingredients'] }),
  });
}

export interface RecipeFilters extends Record<string, string | undefined> {
  search?: string;
  type?: string;
  stationId?: string;
  tag?: string;
  excludeAllergen?: string;
}

export function useRecipes(filters: RecipeFilters = {}) {
  return useQuery({
    queryKey: ['recipes', filters],
    queryFn: () => api.get<RecipeSummary[]>('/recipes', filters),
  });
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe', id],
    enabled: Boolean(id),
    queryFn: () => api.get<Recipe>(`/recipes/${id}`),
  });
}

export function useRecipeAllergens(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe-allergens', id],
    enabled: Boolean(id),
    queryFn: () => api.get<AllergenProfile>(`/recipes/${id}/allergens`),
  });
}

/** Which recipes use this one. Shown before deleting it. */
export function useRecipeUsedBy(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe-used-by', id],
    enabled: Boolean(id),
    queryFn: () => api.get<{ id: string; name: string }[]>(`/recipes/${id}/used-by`),
  });
}

export function useCreateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipe) => api.post<Recipe>('/recipes', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

export function useUpdateRecipe(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRecipe) => api.patch<Recipe>(`/recipes/${id}`, input),
    onSuccess: (recipe) => {
      queryClient.setQueryData(['recipe', id], recipe);
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      void queryClient.invalidateQueries({ queryKey: ['recipe-allergens', id] });
    },
  });
}

export function useDuplicateRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.post<Recipe>(`/recipes/${id}/duplicate`, { name }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

export function useDeleteRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/recipes/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

export interface ScaleTarget {
  portions?: number;
  factor?: number;
  yieldValue?: number;
  yieldUnit?: string;
}

/**
 * The whole tree at a requested size. The server does the arithmetic with the
 * same domain code the prep explosion uses, so a scaled spec and a prep list
 * can never disagree.
 */
export function useExpandedRecipe(id: string | undefined, target: ScaleTarget) {
  return useQuery({
    queryKey: ['recipe-expanded', id, target],
    enabled: Boolean(id),
    queryFn: () =>
      api.get<ExpandedRecipe>(`/recipes/${id}/expanded`, target as Record<string, number | string>),
    // Keep the previous size on screen while the next one loads, so changing
    // the portion count doesn't flash the list away. Only for the same recipe.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === id ? previous : undefined,
  });
}

export function useUploadPhoto(recipeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${BASE_URL}/recipes/${recipeId}/photos`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const parsed = await response.json().catch(() => null);
        throw new RequestFailed(response.status, parsed, response.statusText);
      }
      return (await response.json()) as RecipePhoto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
      void queryClient.invalidateQueries({ queryKey: ['recipe-expanded', recipeId] });
    },
  });
}

export function useDeletePhoto(recipeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => api.delete<void>(`/photos/${photoId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
      void queryClient.invalidateQueries({ queryKey: ['recipe-expanded', recipeId] });
    },
  });
}
