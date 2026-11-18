import { describe, expect, it } from 'vitest';
import { ADMIN, cookieFrom, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();

/** Everything the setup screens collect, as they send it. */
const FULL_SETUP = {
  ...ADMIN,
  language: 'nl',
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
      url: '/api/auth/sign-in-options',
      cookies: { mise_device: device },
    });
    const marco = roster
      .json()
      .people.find((p: { displayName: string }) => p.displayName === 'Marco');
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

  it('gives the person setting up a PIN for the tablet when they choose one', async () => {
    const response = await setUp({ ...FULL_SETUP, pin: '2468' });
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
      url: '/api/auth/sign-in-options',
      cookies: { mise_device: device },
    });
    const me = roster
      .json()
      .people.find((p: { displayName: string }) => p.displayName === ADMIN.displayName);
    expect(me.pinLength).toBe(4);

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: me.id, pin: '2468' },
      cookies: { mise_device: device },
    });
    expect(signedIn.statusCode).toBe(200);
  });

  it('leaves the person setting up without a PIN when they skip it', async () => {
    const response = await setUp(FULL_SETUP);
    const cookies = { mise_session: cookieFrom(response, 'mise_session')! };
    const users = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies });
    const me = users.json().find((u: { role: string }) => u.role === 'admin');
    expect(me.hasPin).toBe(false);
  });

  it('refuses a PIN that is not 4 to 8 digits', async () => {
    expect((await setUp({ ...FULL_SETUP, pin: '12' })).statusCode).toBe(400);
    expect((await setUp({ ...FULL_SETUP, pin: 'abcd' })).statusCode).toBe(400);
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

describe('the options from 2.3, chosen during setup', () => {
  const OPTIONS = {
    ...FULL_SETUP,
    staff: [
      { displayName: 'Marco', role: 'cook', station: 'sauzen', pin: '4821' },
      { displayName: 'Ana', role: 'sous_chef', station: null, pin: '7306' },
    ],
    pin: '5912',
    prepChecklist: true,
    pinOnly: true,
    idleSignOutMinutes: 10,
    checklist: [
      { station: 'Sauzen', name: 'Jus' },
      { station: null, name: 'Mise en place' },
      { station: 'sauzen', name: 'Hollandaise' },
    ],
  };

  it('saves the checklist, the idle time and PIN-only, which is on straight away', async () => {
    const response = await setUp(OPTIONS);
    expect(response.statusCode).toBe(200);
    const cookies = { mise_session: cookieFrom(response, 'mise_session')! };

    const kitchen = await ctx.app.inject({ method: 'GET', url: '/api/kitchen', cookies });
    expect(kitchen.json()).toMatchObject({
      prepChecklist: true,
      pinOnly: 'on',
      idleSignOutMinutes: 10,
    });

    const checklist = await ctx.app.inject({ method: 'GET', url: '/api/checklist', cookies });
    expect(checklist.json().enabled).toBe(true);
    const names = checklist.json().items.map((item: { name: string }) => item.name);
    expect(names).toEqual(['Jus', 'Hollandaise', 'Mise en place']);

    // The login page can tell, without anyone signed in.
    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json().pinOnly).toBe(true);
  });

  it('lets a cook sign in by PIN alone', async () => {
    const response = await setUp(OPTIONS);
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
      url: '/api/auth/sign-in-options',
      cookies: { mise_device: device },
    });
    expect(roster.json()).toMatchObject({ mode: 'pin', people: [] });
    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-only-login',
      payload: { pin: '4821' },
      cookies: { mise_device: device },
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().user.displayName).toBe('Marco');
  });

  it('leaves everything off when none of it is chosen', async () => {
    const response = await setUp(FULL_SETUP);
    const cookies = { mise_session: cookieFrom(response, 'mise_session')! };
    const kitchen = await ctx.app.inject({ method: 'GET', url: '/api/kitchen', cookies });
    expect(kitchen.json()).toMatchObject({
      prepChecklist: false,
      pinOnly: 'off',
      idleSignOutMinutes: null,
    });
  });

  it('refuses two people with the same PIN, saying nothing of whose', async () => {
    const response = await setUp({ ...OPTIONS, pin: '4821' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('pin_taken');
    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json().needsSetup).toBe(true);
  });

  it('refuses a PIN that is too easy to guess', async () => {
    const response = await setUp({
      ...OPTIONS,
      staff: [{ displayName: 'Marco', role: 'cook', station: null, pin: '1234' }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('pin_too_common');
  });

  it('allows the same and easy PINs when PIN-only is not chosen', async () => {
    const response = await setUp({
      ...FULL_SETUP,
      pin: '4821',
      staff: [{ displayName: 'Marco', role: 'cook', station: null, pin: '1234' }],
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses checklist lines without the checklist, or on a station not in the list', async () => {
    expect((await setUp({ ...FULL_SETUP, checklist: [{ name: 'Jus' }] })).statusCode).toBe(400);
    const elsewhere = await setUp({
      ...OPTIONS,
      checklist: [{ station: 'Grill', name: 'Jus' }],
    });
    expect(elsewhere.statusCode).toBe(400);
  });
});

describe('a setup that fails halfway', () => {
  it('leaves nothing behind, so it can simply be tried again', async () => {
    // Backups to a NAS with no address: refused after the kitchen was made.
    const failed = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, backups: { sendTo: ['webdav'], webdavUrl: null } },
    });
    expect(failed.statusCode).toBe(400);
    expect(cookieFrom(failed, 'mise_session')).toBeFalsy();
    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json().needsSetup).toBe(true);

    const again = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(again.statusCode).toBe(200);
  });
});
