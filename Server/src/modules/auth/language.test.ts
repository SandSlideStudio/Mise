import { describe, expect, it } from 'vitest';
import { ADMIN, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();

describe('interface language', () => {
  it('starts a kitchen in the language chosen at setup', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, language: 'nl' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ language: null, kitchenLanguage: 'nl' });

    // The screens before sign-in need it too.
    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toEqual({
      needsSetup: false,
      language: 'nl',
      kitchenName: ADMIN.kitchenName,
      setupTokenRequired: false,
    });
  });

  it('lets anyone choose their own language, and go back to following the kitchen', async () => {
    const cookie = await setUpKitchen(ctx.app);
    const cookies = { mise_session: cookie };

    const chosen = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { language: 'fr' },
      cookies,
    });
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json().user).toMatchObject({ language: 'fr', kitchenLanguage: 'en' });

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.json().user.language).toBe('fr');

    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { language: null },
      cookies,
    });
    expect(cleared.json().user.language).toBeNull();
  });

  it('keeps them signed in when they change language', async () => {
    const cookie = await setUpKitchen(ctx.app);
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { language: 'de' },
      cookies: { mise_session: cookie },
    });
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { mise_session: cookie },
    });
    expect(me.statusCode).toBe(200);
  });

  it('refuses a language the interface does not speak', async () => {
    const cookie = await setUpKitchen(ctx.app);
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { language: 'it' },
      cookies: { mise_session: cookie },
    });
    expect(response.statusCode).toBe(400);
  });

  it('needs somebody signed in to choose', async () => {
    await setUpKitchen(ctx.app);
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { language: 'es' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lets an administrator change the kitchen default for everyone who has not chosen', async () => {
    const cookie = await setUpKitchen(ctx.app);
    const cookies = { mise_session: cookie };

    const kitchen = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { language: 'es' },
      cookies,
    });
    expect(kitchen.statusCode).toBe(200);
    expect(kitchen.json().language).toBe('es');

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies });
    expect(me.json().user).toMatchObject({ language: null, kitchenLanguage: 'es' });
  });
});
