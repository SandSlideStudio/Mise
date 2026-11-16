import { expect, test, type APIRequestContext } from '@playwright/test';
import { ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

// The tests share one kitchen, so PIN-only sign-in goes back off whatever happened.
test.afterEach(async ({ request }) => {
  await signedInApi(request);
  const off = await request.patch('/api/kitchen', { data: { pinOnly: false } });
  expect(off.ok(), await off.text()).toBe(true);
});

/**
 * Hard to guess, all different, and none of them a PIN an earlier test gave
 * out ('4821', '5938'), so they never clash with someone who is waiting.
 */
const NEW_PINS = ['7302', '6184', '9457', '2860', '3719', '8643', '1957', '4086', '6521', '7834'];

/**
 * Earlier tests left people with PINs behind. The mode only turns on once
 * everyone has a new one, so give each of them one, apart from `except`. The first three PINs
 * in the list are used by the test itself.
 */
async function renewOtherPins(request: APIRequestContext, except: string[], from: number) {
  const people: { id: string; hasPin: boolean; active?: boolean }[] = await (
    await request.get('/api/users')
  ).json();
  let next = from;
  for (const person of people) {
    if (!person.hasPin || except.includes(person.id)) continue;
    const pin = NEW_PINS[next++];
    expect(pin, 'enough spare PINs for everyone').toBeDefined();
    const set = await request.patch(`/api/users/${person.id}`, { data: { pin } });
    expect(set.ok(), await set.text()).toBe(true);
  }
}

test('a tablet takes only a PIN once everyone has a new one, and locks after five wrong ones', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const cook = unique('Cook Noor');
  const created = await page.request.post('/api/users', {
    data: { displayName: cook, role: 'cook', pin: '5160' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const cookId: string = (await created.json()).id;

  // Switching it on does not change the tablets yet: it waits, and says for whom.
  await page.goto('/settings?tab=kitchen');
  await page.getByRole('switch', { name: 'Sign in with a PIN only' }).click();
  await expect(page.getByText('Waiting for new PINs.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Still needs a new PIN' })).toBeVisible();
  await expect(page.locator('li.tag', { hasText: cook })).toBeVisible();

  // An obvious PIN is refused on the staff screen, with its reason.
  await page.goto('/settings?tab=staff');
  const row = page.locator('li', { hasText: cook });
  await expect(row).toContainText('Needs a new PIN');
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.locator('#pin').fill('1234');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByRole('alert')).toHaveText('Pick a less obvious PIN.');

  // A PIN someone else has is refused too: the cook's own, taken by the next person to try it.
  const oli = await page.request.post('/api/users', {
    data: { displayName: unique('Cook Oli'), role: 'cook', pin: '5161' },
  });
  expect(oli.ok(), await oli.text()).toBe(true);
  const oliId: string = (await oli.json()).id;
  const clash = await page.request.patch(`/api/users/${oliId}`, {
    data: { pin: '7302' },
  });
  expect(clash.ok()).toBe(true);

  // A good, unique one goes through.
  await row.locator('#pin').fill('7302');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByRole('alert')).toHaveText('Choose another PIN.');
  await row.locator('#pin').fill('9457');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(row).not.toContainText('Needs a new PIN');

  // Everyone else who has a PIN gets a new one, which turns the mode fully on.
  await renewOtherPins(page.request, [cookId, oliId], 3);
  await page.goto('/settings?tab=kitchen');
  await expect(page.getByText('On. Tablets show only the keypad.')).toBeVisible();

  // Enrol a tablet (a separate browser, so the chef's stays signed in) and look at it.
  const tabletName = unique('PIN tablet');
  const tablet = await browser.newContext();
  try {
    const pad = await tablet.newPage();
    await signIn(pad);
    const enrolled = await pad.request.post('/api/auth/devices', { data: { name: tabletName } });
    expect(enrolled.ok(), await enrolled.text()).toBe(true);
    await pad.request.post('/api/auth/logout');

    await pad.goto('/line');
    await expect(pad.getByText('Type your PIN.')).toBeVisible();
    // No names, and with every PIN the same length there is no OK key either.
    await expect(pad.getByText(cook)).toHaveCount(0);
    await expect(pad.getByRole('button', { name: 'OK', exact: true })).toHaveCount(0);

    // A wrong PIN is turned away, the slots empty again and the tablet stays on the sign-in.
    for (const digit of '8026') await pad.getByRole('button', { name: digit, exact: true }).click();
    await expect(pad.getByRole('alert')).toBeVisible();
    await expect(pad.getByRole('status')).toHaveAttribute('aria-label', '0 digits entered');
    expect(new URL(pad.url()).pathname).toBe('/line');

    // The right one finds the person without a name being tapped.
    for (const digit of '9457') await pad.getByRole('button', { name: digit, exact: true }).click();
    await expect(pad.getByText(`Welcome, ${cook}.`)).toBeVisible();
    await pad.waitForURL((url) => url.pathname === '/');
    await expect(pad.getByText(cook).first()).toBeVisible();
    await pad.request.post('/api/auth/logout');

    // Five wrong PINs lock the tablet, even against the right one. Done through the API:
    // five taps of four digits each through the screen would only be slow.
    const wrong = () => pad.request.post('/api/auth/pin-only-login', { data: { pin: '8026' } });
    // The fifth is the one that finds the tablet locked.
    for (let attempt = 0; attempt < 4; attempt++) expect((await wrong()).status()).toBe(401);
    expect((await wrong()).status()).toBe(429);
    const locked = await pad.request.post('/api/auth/pin-only-login', { data: { pin: '9457' } });
    expect(locked.status()).toBe(429);

    // The settings show it, and a head chef lifts it.
    await page.goto('/settings?tab=devices');
    const device = page.locator('li', { hasText: tabletName });
    await expect(device).toContainText('Locked out');
    await device.getByRole('button', { name: 'Lift the lock' }).click();
    await expect(device).not.toContainText('Locked out');

    const again = await pad.request.post('/api/auth/pin-only-login', { data: { pin: '9457' } });
    expect(again.ok(), await again.text()).toBe(true);
  } finally {
    await tablet.close();
  }
});
