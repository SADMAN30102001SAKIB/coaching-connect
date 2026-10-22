import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('phone login, center onboarding and responsive academic workflow', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const checkAccessibility = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  };
  const phone = `017${String(Date.now() % 100000000).padStart(8, '0')}`;
  const adminPassword = 'a long browser test password 2026';
  const bootstrapPassword = 'a long platform test password 2026';
  const documentResponse = await page.goto('/');
  expect(documentResponse?.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const login = await page.request.post('/api/auth/login', {
    data: { phone: '01700000010', password: bootstrapPassword },
  });
  if (login.status() !== 200) {
    const bootstrap = await page.request.post('/api/auth/bootstrap', {
      data: {
        token: 'local-browser-test-setup-key-not-for-production-2026',
        name: 'Platform owner',
        phone: '01700000010',
        password: bootstrapPassword,
      },
    });
    expect(bootstrap.status()).toBe(201);
  }
  const created = await page.request.post('/api/platform/centers', {
    data: {
      name: `${info.project.name} Coaching`,
      admin_name: 'Test teacher',
      phone,
      timezone: 'Asia/Dhaka',
    },
  });
  expect(created.status()).toBe(201);
  const invitation = (await created.json()) as { id: string; token: string };
  await page.request.post('/api/auth/logout', { data: {} });
  await page.goto(`/?invite=${invitation.token}`);
  await expect(page.getByRole('heading', { name: 'Activate account' })).toBeVisible();
  await page.getByLabel('Your name').fill('Test teacher');
  await page.getByLabel('New password').fill(adminPassword);
  await page.getByRole('button', { name: 'Activate account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save recovery codes' })).toBeVisible();
  await page.getByLabel('I saved my codes').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Test' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((body) => body.clientWidth),
  );
  await page.screenshot({ path: `test-results/${info.project.name}-home.png`, fullPage: true });
  await checkAccessibility();
  if (!info.project.use.isMobile) {
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 480 });
    const sidebar = page.locator('.sidebar');
    const signOut = sidebar.getByRole('button', { name: 'Sign out', exact: true });
    await expect(sidebar).toHaveCSS('overflow-y', 'auto');
    await sidebar.hover();
    await page.mouse.wheel(0, 1000);
    await expect(signOut).toBeInViewport();
    await expect(sidebar.getByRole('link', { name: 'Account security' })).toBeInViewport();
    await expect.poll(() => sidebar.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: `test-results/${info.project.name}-sidebar.png` });
    await sidebar.evaluate((element) => element.scrollTo(0, 0));
    if (viewport) await page.setViewportSize(viewport);
  }
  const center = invitation.id;
  const subjectResponse = await page.request.post(`/api/c/${center}/catalog`, {
    data: { kind: 'subject', name: 'Physics' },
  });
  expect(subjectResponse.status()).toBe(201);
  const subject = (await subjectResponse.json()) as { id: string };
  const groupResponse = await page.request.post(`/api/c/${center}/catalog`, {
    data: { kind: 'group', name: 'Evening batch' },
  });
  const group = (await groupResponse.json()) as { id: string };
  const studentResponse = await page.request.post(`/api/c/${center}/students`, {
    data: {
      name: 'Ayesha Rahman',
      identifier: '01',
      group_ids: [group.id],
      contacts: [{ phone: '01700000013', label: 'Mother', audience: 'guardian', permitted: true }],
    },
  });
  expect(studentResponse.status()).toBe(200);
  await page.goto('/students');
  await expect(page.getByText('Ayesha Rahman', { exact: true })).toBeVisible();
  await page.getByText('Ayesha Rahman', { exact: true }).click();
  await expect(page.getByText('Mother', { exact: true })).toBeVisible();
  await page.goto('/exams/new');
  await page.getByLabel('Name', { exact: true }).fill('October assessment');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-22');
  await page.getByLabel('Subject', { exact: true }).selectOption(subject.id);
  await page.getByLabel('Maximum marks', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Create exam', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'October assessment' })).toBeVisible();
  await page.getByLabel('Groups').selectOption(group.id);
  await page.getByRole('button', { name: 'Add participants', exact: true }).click();
  await expect(page.getByText('Participants added.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Enter marks' }).click();
  await page.getByLabel('Result status for Ayesha Rahman').selectOption('scored');
  await page.getByLabel('Marks for Ayesha Rahman').fill('63.5');
  await checkAccessibility();
  await page.getByRole('button', { name: 'Save marks' }).click();
  await expect(page.getByLabel('Marks for Ayesha Rahman')).toHaveValue('63.5');
  await expect(page.getByRole('button', { name: 'Save marks' })).toBeDisabled();
  await page.screenshot({ path: `test-results/${info.project.name}-marks.png`, fullPage: true });
  const examId = new URL(page.url()).pathname.split('/')[2];
  expect(
    (
      await page.request.put(`/api/c/${center}/provider`, {
        data: {
          api_key: 'browser-mock-key-never-a-real-key',
          sender_ids: ['09610000000'],
          batch_size: 1,
          interval_seconds: 1,
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/messages/new?exam=${examId}`);
  await page.getByLabel('Name', { exact: true }).fill('October family update');
  await page.getByLabel('Message', { exact: true }).fill('{{student_name}}\n{{results_summary}}');
  await checkAccessibility();
  await page.getByRole('button', { name: 'Prepare preview' }).click();
  await expect(page.getByText('Ready for review', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText('Ayesha Rahman\nOctober assessment · Physics: 63.5/75', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm sending', exact: true }).click();
  await checkAccessibility();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm sending', exact: true })
    .click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('MOCK TEST — not a real SMS', { exact: false })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-messages.png`, fullPage: true });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { name: 'ব্যক্তিগত বার্তাগুলো' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await expect(page.getByRole('heading', { name: 'ব্যক্তিগত বার্তাগুলো' })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  for (const size of [192, 512]) {
    const icon = await page.request.get(`/icon-${size}.png`);
    expect(icon.headers()['content-type']).toContain('image/png');
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  expect(await page.evaluate(async () => await caches.keys())).toEqual([]);
  await page.context().setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You are offline', exact: true })).toBeVisible();
  await page.context().setOffline(false);
  expect(errors).toEqual([]);
});
