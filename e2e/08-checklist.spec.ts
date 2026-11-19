import { expect, test, type Page } from '@playwright/test';
import { CHEF, dismissTour, ensureKitchen, signIn, signedInApi, unique } from './helpers.js';

test.beforeEach(async ({ request }) => ensureKitchen(request));

// The tests share one kitchen, so the checklist goes back off whatever happened.
test.afterEach(async ({ request }) => {
  await signedInApi(request);
  const off = await request.patch('/api/kitchen', { data: { prepChecklist: false } });
  expect(off.ok(), await off.text()).toBe(true);
});

/** Opens the checklist panel on the prep list, if it is closed. */
async function openChecklist(page: Page) {
  const toggle = page.getByRole('button', { name: /^Prep checklist/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** The line on the prep list, not the same words ticked in the checklist above it. */
const prepLine = (page: Page, text: string) =>
  page.locator('li', { hasText: text, has: page.locator('button[data-tour="task"]') });

test('the chef switches the checklist on and builds it by station; a cook ticks items onto the list', async ({
  page,
  browser,
}) => {
  await signIn(page);

  // Two stations for the items, made through the API: the screens for that are tested elsewhere.
  const grill = unique('Grill');
  const pastry = unique('Pastry');
  for (const name of [grill, pastry]) {
    const made = await page.request.post('/api/stations', { data: { name } });
    expect(made.ok(), await made.text()).toBe(true);
  }
  const lamb = unique('Trim lamb');
  const chimichurri = unique('Chimichurri');
  const custard = unique('Custard base');

  await page.goto('/settings?tab=kitchen');
  await page.getByRole('switch', { name: /Prep checklist/ }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true }).first()).toBeVisible();

  await page.goto('/');
  await openChecklist(page);
  await expect(
    page.getByText('The checklist is empty. Add what your kitchen makes.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit checklist' }).click();

  // Each station has its own "New item" box under its own heading.
  for (const [station, names] of [
    [grill, [lamb, chimichurri]],
    [pastry, [custard]],
  ] as const) {
    const section = page.locator('form section', {
      has: page.getByRole('heading', { name: station }),
    });
    for (const name of names) {
      await section.getByLabel('New item').fill(name);
      await section.getByRole('button', { name: 'Add', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: 'Save checklist' }).click();
  await expect(page.getByRole('checkbox', { name: lamb })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit checklist' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: chimichurri })).toBeVisible();

  // A line the chef types herself is "Added by" her, not from the checklist.
  const typed = unique('Pick mint');
  await page.getByLabel('What to do').fill(typed);
  await page.getByRole('button', { name: 'Add the line' }).click();
  const typedRow = prepLine(page, typed);
  await expect(typedRow).toContainText(`Added by ${CHEF.displayName}`);
  await expect(typedRow).not.toContainText('From the checklist');

  // A cook on an enrolled tablet. The tablet is enrolled from the chef's session in a
  // separate browser context, so the chef's own window stays signed in.
  const cook = unique('Cook Ines');
  const created = await page.request.post('/api/users', {
    data: { displayName: cook, role: 'cook', pin: '5938' },
  });
  expect(created.ok(), await created.text()).toBe(true);

  const tablet = await browser.newContext();
  try {
    const cookPage = await tablet.newPage();
    await signIn(cookPage);
    const enrolled = await cookPage.request.post('/api/auth/devices', {
      data: { name: unique('Checklist tablet') },
    });
    expect(enrolled.ok(), await enrolled.text()).toBe(true);
    await cookPage.request.post('/api/auth/logout');
    await cookPage.goto('/line');
    await cookPage.getByRole('button', { name: new RegExp(cook) }).click();
    for (const digit of '5938') {
      await cookPage.getByRole('button', { name: digit, exact: true }).click();
    }
    await cookPage.waitForURL((url) => url.pathname === '/');
    await dismissTour(cookPage);

    await openChecklist(cookPage);
    // Anyone can tick, but only a chef edits.
    await expect(cookPage.getByRole('button', { name: 'Edit checklist' })).toHaveCount(0);
    const add = cookPage.getByRole('button', { name: /^Add to prep list/ });
    await expect(add).toBeDisabled();

    await cookPage.getByRole('checkbox', { name: lamb }).check();
    await cookPage.getByRole('checkbox', { name: custard }).check();
    await expect(add).toHaveText('Add to prep list (2)');
    await add.click();
    await expect(cookPage.getByRole('status').filter({ hasText: 'lines added' })).toHaveText(
      '2 lines added to the prep list.',
    );

    for (const name of [lamb, custard]) {
      await expect(prepLine(cookPage, name)).toContainText(`From the checklist, by ${cook}`);
    }

    // The same item again goes nowhere: it is still open on the list.
    await cookPage.getByRole('checkbox', { name: lamb }).check();
    await cookPage.getByRole('button', { name: 'Add to prep list (1)' }).click();
    await expect(cookPage.getByRole('status')).toHaveText(
      'Nothing new to add. 1 was already on the list.',
    );
    await expect(prepLine(cookPage, lamb)).toHaveCount(1);

    // One new and one already there: both numbers are said.
    await cookPage.getByRole('checkbox', { name: lamb }).check();
    await cookPage.getByRole('checkbox', { name: chimichurri }).check();
    await cookPage.getByRole('button', { name: 'Add to prep list (2)' }).click();
    await expect(cookPage.getByRole('status')).toHaveText(
      '1 line added to the prep list. 1 was already on the list.',
    );

    // The server refuses a cook's edit too, not only the missing button.
    const refused = await cookPage.request.put('/api/checklist', {
      data: { items: [], base: new Date(0).toISOString() },
    });
    expect(refused.status()).toBe(403);
  } finally {
    await tablet.close();
  }

  // The chef sees the same lines, with who put them there.
  await page.reload();
  await expect(prepLine(page, chimichurri)).toContainText('From the checklist, by');
});

test('a chef sets a par; the cook says what is there and the list asks for the rest', async ({
  page,
}) => {
  await signIn(page);
  const on = await page.request.patch('/api/kitchen', { data: { prepChecklist: true } });
  expect(on.ok(), await on.text()).toBe(true);
  const gel = unique('Fig gel');
  const stock = unique('Veal stock');

  await page.goto('/');
  await openChecklist(page);
  await page.getByRole('button', { name: 'Edit checklist' }).click();
  const anywhere = page.locator('form section', {
    has: page.getByRole('heading', { name: 'Anywhere' }),
  });
  for (const [name, par] of [
    [gel, '3'],
    [stock, '2'],
  ] as const) {
    await anywhere.getByLabel('New item').fill(name);
    await anywhere.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel(`Par for ${name}`, { exact: true }).fill(par);
    await page.getByLabel(`Unit of the par for ${name}`, { exact: true }).selectOption('l');
  }
  await page.getByRole('button', { name: 'Save checklist' }).click();

  await page.getByRole('checkbox', { name: gel }).check();
  await page.getByRole('checkbox', { name: stock }).check();
  await page.getByRole('button', { name: 'Add to prep list (2)' }).click();
  await expect(page.getByRole('heading', { name: 'How much is there?' })).toBeVisible();
  await page.getByLabel(`How much ${gel} is there, in l`).fill('1');
  await page.getByLabel(`How much ${stock} is there, in l`).fill('2.5');
  await page.getByRole('button', { name: 'Add to prep list (2)' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'enough there' })).toHaveText(
    `1 line added to the prep list. ${stock}: enough there.`,
  );
  const line = prepLine(page, gel);
  await expect(line).toContainText('2 l');
  await expect(line).toContainText('Par 3 l, 1 l there');
  await expect(prepLine(page, stock)).toHaveCount(0);

  // The checklist is shared by these tests: take the two items off again.
  const current = await (await page.request.get('/api/checklist')).json();
  const put = await page.request.put('/api/checklist', {
    data: {
      items: current.items.filter((item: { name: string }) => ![gel, stock].includes(item.name)),
    },
  });
  expect(put.ok(), await put.text()).toBe(true);
});
