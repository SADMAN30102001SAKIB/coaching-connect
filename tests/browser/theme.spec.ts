import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('installed icons have rounded standard tiles and a smaller mask-safe message symbol', async ({
  page,
}) => {
  await page.goto('/');
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(manifest.icons.map(({ sizes, purpose }) => ({ sizes, purpose }))).toEqual([
    { sizes: '192x192', purpose: 'any' },
    { sizes: '512x512', purpose: 'any' },
    { sizes: '512x512', purpose: 'maskable' },
  ]);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icon-maskable-512.png',
  );
  for (const icon of manifest.icons) {
    const asset = await page.request.get(icon.src);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()['content-type']).toContain('image/png');
    const pixels = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable');
      ctx.drawImage(image, 0, 0);
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let left = width;
      let right = 0;
      let radius = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          const pixel = data.subarray(offset, offset + 4);
          if (!pixel.every((channel, index) => channel >= (index === 3 ? 250 : 245))) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          radius = Math.max(radius, Math.hypot(x - width / 2, y - height / 2) / width);
        }
      }
      return {
        width,
        height,
        corners: [0, width - 1, (height - 1) * width, height * width - 1].map(
          (offset) => data[offset * 4 + 3],
        ),
        symbolWidth: (right - left + 1) / width,
        radius,
      };
    }, icon.src);
    const size = Number(icon.sizes.split('x')[0]);
    expect(pixels.width).toBe(size);
    expect(pixels.height).toBe(size);
    expect(pixels.corners).toEqual(Array(4).fill(icon.purpose === 'maskable' ? 255 : 0));
    expect(pixels.symbolWidth).toBeGreaterThan(0.44);
    expect(pixels.symbolWidth).toBeLessThan(0.49);
    expect(pixels.radius).toBeLessThan(0.4);
  }
});

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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#1f1f1c');
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
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished),
      );
    });
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      accessibility.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, failure: n.failureSummary })),
      })),
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
