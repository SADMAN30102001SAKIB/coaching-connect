import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('appearance follows the device, persists overrides, and synchronizes tabs', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const root = page.locator('html');
  const picker = page.getByRole('button', { name: /Switch to (light|dark) mode/, exact: true });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await expect(page.locator('.theme-picker select')).toHaveCount(0);
  await expect(picker).toHaveAccessibleName('Switch to light mode');
  await picker.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await picker.focus();
  await picker.press('Space');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await picker.press('Enter');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await picker.click();
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(picker).toHaveAccessibleName('Switch to light mode');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#101622');
  const other = await page.context().newPage();
  await other.goto('/');
  await other.evaluate(() => localStorage.removeItem('theme'));
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await other.reload();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await other.emulateMedia({ colorScheme: 'light' });
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await picker.click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await picker.click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  await picker.click();
  await other.evaluate(() => localStorage.removeItem('theme'));
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-theme-preference', 'system');
  await other.close();
  const phone = `017${String(Date.now() % 100000000).padStart(8, '0')}`;
  await page.getByLabel('Phone number').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('incorrect theme test password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The phone number or password is incorrect.');
  for (const mode of ['light', 'dark'] as const) {
    if ((await root.getAttribute('data-theme')) !== mode) await picker.click();
    await expect(root).toHaveAttribute('data-theme', mode);
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      accessibility.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/${info.project.name}-auth-${mode}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'হালকা থিম চালু করুন', exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await page.context().setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You are offline', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.context().setOffline(false);
  expect(errors).toEqual([]);
});

test('saved theme is applied before the React bundle starts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#root')).toBeEmpty();
});
