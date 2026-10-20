import { describe, expect, it } from 'vitest';
import { ADMIN, cookieFrom, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();

/** Everything the setup screens collect, as they send it. */
const FULL_SETUP = {
  ...ADMIN,
  language: 'nl',
  unitSystem: 'metric',
  prepMode: 'running',
  tickedRetention: 'delete',
  stations: ['Koude keuken', 'Sauzen', 'Patisserie'],
  staff: [
    { displayName: 'Marco', role: 'cook', station: 'sauzen', pin: '4821' },
    { displayName: 'Ana', role: 'sous_chef', station: null, pin: '1357' },
  ],
  recipes: [
    {
      name: 'Kalfsfond',
      type: 'prep',
      station: 'Sauzen',
      yield: { value: 5, unit: 'l' },
      portions: null,
    },
    {
      name: 'Tarte tatin',
      type: 'dish',
      station: 'Patisserie',
      yield: { value: 8, unit: 'each' },
      portions: 8,
    },
  ],
};

async function setUp(payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/setup', payload });
}

describe('setting a kitchen up in one go', () => {
  it('creates the stations, staff, recipes and settings chosen on the way', async () => {
    const response = await setUp(FULL_SETUP);
    expect(response.statusCode).toBe(200);
    const cookies = { mise_session: cookieFrom(response, 'mise_session')! };

    const kitchen = await ctx.app.inject({ method: 'GET', url: '/api/kitchen', cookies });
    expect(kitchen.json()).toMatchObject({
      language: 'nl',
      prepMode: 'running',
      tickedRetention: 'delete',
    });

    const stations = await ctx.app.inject({ method: 'GET', url: '/api/stations', cookies });
    expect(stations.json().map((s: { name: string }) => s.name)).toEqual([
      'Koude keuken',
      'Sauzen',
      'Patisserie',
    ]);
    const sauce = stations.json()[1].id;

    const users = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies });
    const marco = users.json().find((u: { displayName: string }) => u.displayName === 'Marco');
    expect(marco).toMatchObject({ role: 'cook', defaultStationId: sauce, hasPin: true });
    expect(users.json()).toHaveLength(3);

    const recipes = await ctx.app.inject({ method: 'GET', url: '/api/recipes', cookies });
    const stock = recipes.json().find((r: { name: string }) => r.name === 'Kalfsfond');
    expect(stock).toMatchObject({ type: 'prep', stationId: sauce, status: 'draft' });
    expect(recipes.json()).toHaveLength(2);
  });

  it('lets a cook added during setup sign in with their PIN', async () => {
    const response = await setUp(FULL_SETUP);
    const cookies = { mise_session: cookieFrom(response, 'mise_session')! };
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies,
    });
    const device = cookieFrom(enrolled, 'mise_device')!;
    const roster = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/roster',
      cookies: { mise_device: device },
    });
    const marco = roster.json().find((p: { displayName: string }) => p.displayName === 'Marco');
    // The tablet's pad knows to sign in on the fourth digit.
    expect(marco.pinLength).toBe(4);

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: marco.id, pin: '4821' },
      cookies: { mise_device: device },
    });
    expect(signedIn.statusCode).toBe(200);
  });

  it('refuses a person or recipe on a station that is not in the list', async () => {
    const response = await setUp({
      ...FULL_SETUP,
      staff: [{ displayName: 'Marco', role: 'cook', station: 'Grill', pin: '4821' }],
    });
    expect(response.statusCode).toBe(400);

    // Nothing was half created: setup is still open.
    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json().needsSetup).toBe(true);
  });

  it('refuses two stations or two recipes with the same name', async () => {
    const stations = await setUp({ ...FULL_SETUP, stations: ['Sauzen', ' sauzen '] });
    expect(stations.statusCode).toBe(400);

    const recipes = await setUp({
      ...FULL_SETUP,
      recipes: [FULL_SETUP.recipes[0], { ...FULL_SETUP.recipes[0], name: 'KALFSFOND' }],
    });
    expect(recipes.statusCode).toBe(400);
  });

  it('refuses a kitchen with no stations at all', async () => {
    const response = await setUp({ ...FULL_SETUP, stations: [], staff: [], recipes: [] });
    expect(response.statusCode).toBe(400);
  });
});
