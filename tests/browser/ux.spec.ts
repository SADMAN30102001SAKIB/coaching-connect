import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fixture(page: Page, extraPermissions: string[] = []) {
  const control = {
    failExam: false,
    multipleExamGroups: false,
    failMarks: false,
    malformedSession: false,
    authenticated: true,
    platform: false,
    noCenters: false,
    invitationExisting: 0,
    deletedCenters: [] as string[],
    rejectWrites: false,
    balance: '10.00',
    markVersion: 1,
    markScore: 5000 as number | null,
    markStatus: 'scored',
    writes: [] as { path: string; body: unknown }[],
    reads: [] as string[],
  };
  const center = {
    id: 'center-a',
    name: 'Audit Coaching',
    timezone: 'Asia/Dhaka',
    locale: 'en',
    revision: 1,
    owner_id: 'owner',
    late_minutes: 60,
  };
  const subject = { id: 'subject-a', name: 'Physics', kind: 'subject', version: 1, active: 1 };
  const group = { id: 'group-a', name: 'Batch A', kind: 'group', version: 1, active: 1 };
  const paper = { id: 'paper-a', name: 'Physics', maximum: 10000, version: 1 };
  const exam = {
    id: 'exam-a',
    name: 'Demo Exam - 1',
    exam_date: '2026-10-23',
    active: 1,
    version: 1,
    papers: [paper],
    participants: 1,
    groups: [{ ...group, count: 1 }],
  };
  const students = ['a', 'b'].map((id) => ({
    id: `student-${id}`,
    name: `Student ${id.toUpperCase()}`,
    identifier: id,
    active: 1,
    version: 1,
    groups: [],
    contacts: [
      {
        id: `contact-${id}`,
        phone: id === 'a' ? '01700000013' : '01700000014',
        audience: 'guardian',
        permitted: 0,
        suppressed: 0,
      },
    ],
  }));
  const permissions = [
    'students',
    'exams',
    'results',
    'messages',
    'groups',
    'academic',
    'templates',
  ].flatMap((feature) =>
    ['read', 'create', 'update', 'archive'].map((action) => `${feature}.${action}`),
  );
  permissions.push(...extraPermissions);
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') {
      control.writes.push({ path, body: req.postDataJSON() as unknown });
      if (path === '/api/auth/login') control.authenticated = true;
      if (path === '/api/auth/bootstrap') {
        control.authenticated = true;
        return json({
          recovery_codes: Array.from(
            { length: 8 },
            (_, i) => `fixture-only-code-${i}-not-a-real-secret`,
          ),
        });
      }
      if (path === '/api/auth/logout') control.authenticated = false;
      if (path === '/api/platform/recovery')
        return json({ recovery_code: 'fixture-only-not-a-real-recovery-code' });
      if (path === '/api/auth/security')
        return json(
          { error: { code: 'PASSWORD_INCORRECT', message: 'Your current password is incorrect.' } },
          401,
        );
      if (control.rejectWrites) return route.abort('failed');
      if (req.method() === 'DELETE' && path.startsWith('/api/platform/centers/'))
        control.deletedCenters.push(path.split('/').at(-1) ?? '');
      if (path.endsWith('/balance/refresh')) {
        control.balance = '42.00';
        return json({ balance: control.balance, estimate_sms: 50, checked_at: Date.now() });
      }
      if (path.endsWith('/marks')) {
        const saved = req.postDataJSON() as {
          version: number;
          score: number | null;
          status: string;
        }[];
        if (saved[0]?.version !== control.markVersion)
          return json(
            { error: { code: 'RESULT_CONFLICT', message: 'Another teacher saved these marks.' } },
            409,
          );
        control.markScore = saved[0].score;
        control.markStatus = saved[0].status;
        control.markVersion++;
      }
      return json({ id: 'saved', ok: true });
    }
    control.reads.push(path);
    if (path.endsWith('/balance'))
      return json({ balance: control.balance, estimate_sms: 50, checked_at: 1 });
    if (path === '/api/auth/session') {
      if (!control.authenticated)
        return json(
          { error: { code: 'SESSION_EXPIRED', message: 'Please sign in to continue.' } },
          401,
        );
      if (control.malformedSession)
        return route.fulfill({
          status: 503,
          contentType: 'text/html',
          body: '<html>Temporary upstream failure</html>',
        });
      return json({
        user: { id: 'owner', name: 'Audit Teacher', platform: Number(control.platform) },
        centers: control.noCenters ? [] : [center],
      });
    }
    if (path === '/api/auth/invitation')
      return json({ name: 'Fixture Coaching', existing: control.invitationExisting });
    if (path === '/api/platform/centers')
      return json({
        items: control.deletedCenters.includes(
          url.searchParams.get('cursor') ? 'center-b' : center.id,
        )
          ? []
          : [
              {
                ...center,
                id: url.searchParams.get('cursor') ? 'center-b' : center.id,
                name: url.searchParams.get('cursor') ? 'Second Coaching' : 'First Coaching',
                owner_name: 'Fixture Admin',
                owner_phone: '01700000013',
                active: url.searchParams.get('cursor') ? 0 : 1,
              },
            ],
        next:
          url.searchParams.get('cursor') || control.deletedCenters.includes('center-b')
            ? null
            : 'center-a',
      });
    if (path.endsWith('/context')) return json({ center, admin: true, permissions });
    if (path.endsWith('/home')) return json({ students: 2, groups: 1, exams: 1, campaigns: [] });
    if (path.endsWith('/catalog'))
      return json({
        items: [url.searchParams.get('kind') === 'group' ? group : subject],
        next: null,
      });
    if (path.endsWith('/marks')) {
      if (control.failMarks) return route.abort('failed');
      return json({
        paper,
        items: [
          {
            student_id: 'student-a',
            name: 'Ayesha',
            identifier: '01',
            status: control.markStatus,
            score: control.markScore,
            version: control.markVersion,
          },
        ],
        next: null,
        groups: [{ ...group, count: 1 }],
      });
    }
    if (path.endsWith('/exams/exam-a')) {
      if (control.failExam) return route.abort('failed');
      return json({
        ...exam,
        groups: control.multipleExamGroups
          ? ['Class 3', 'Class 4', 'Class 5', 'Long coaching group name'].map((name, index) => ({
              ...group,
              id: `group-${index}`,
              name,
              count: index + 1,
            }))
          : exam.groups,
      });
    }
    if (path.endsWith('/exams')) return json({ items: [exam], next: null });
    if (path.endsWith('/students')) return json({ items: students, next: null });
    if (path.includes('/students/'))
      return json(students.find((student) => path.endsWith(`/${student.id}`)));
    if (path.endsWith('/templates'))
      return json({
        items: [
          {
            id: 'template-a',
            name: 'Result template',
            scope: 'summary',
            body: '{{student_name}}',
            version: 1,
            active: 1,
          },
        ],
        next: null,
      });
    if (path.endsWith('/roles'))
      return json({
        items: [{ id: 'role-a', name: 'Teacher', permissions: ['students.read'], version: 1 }],
        next: null,
      });
    return json({ items: [], next: null });
  });
  return control;
}

test('warm surfaces and bundled Latin fonts are consistent across shared components', async ({
  page,
}, info) => {
  await fixture(page, ['balance.read']);
  await page.goto('/groups');
  await expect(page.locator('.page-content h1')).toHaveText('Groups');
  await page.evaluate(() => document.fonts.ready);
  const dark = info.project.use.colorScheme === 'dark';
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    dark ? 'rgb(31, 31, 28)' : 'rgb(247, 245, 239)',
  );
  await expect(page.locator('html')).toHaveCSS(
    'color',
    dark ? 'rgb(234, 231, 223)' : 'rgb(41, 40, 34)',
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const renderedFont = async (selector: string, family: string) => {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(
      fonts
        .filter((font) => font.isCustomFont && font.glyphCount > 0)
        .map((font) => font.familyName),
    ).toContain(family);
  };
  await renderedFont('.page-content h1', 'Source Serif 4 Variable');
  await renderedFont('.page-header .button', 'SourceSans3VF');
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS(
    'background-color',
    dark ? 'rgb(41, 41, 37)' : 'rgb(255, 252, 245)',
  );
  await dialog.getByRole('textbox').fill('Evening batch');
  await page.evaluate(() => document.fonts.ready);
  await renderedFont('dialog h2', 'Source Serif 4 Variable');
  await page.screenshot({ path: info.outputPath('warm-group-dialog.png'), fullPage: true });
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const path of ['/', '/students', '/exams/exam-a', '/templates', '/messages/new']) {
    await page.goto(path);
    await expect(page.locator('.page-content h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`warm-${path.replaceAll('/', '-') || 'home'}.png`),
      fullPage: true,
    });
  }
  await page.getByLabel('Select exams', { exact: true }).click();
  await expect(page.locator('.picker-dropdown')).toBeVisible();
  await expect(page.locator('.picker-dropdown')).toHaveCSS(
    'background-color',
    dark ? 'rgb(41, 41, 37)' : 'rgb(255, 252, 245)',
  );
  await page.screenshot({ path: info.outputPath('warm-picker.png'), fullPage: true });
  await cdp.detach();
});

test('shared typography stays readable without overflowing narrow layouts', async ({
  page,
}, info) => {
  await fixture(page, ['balance.read']);
  const widths = info.project.use.isMobile ? [320, 390] : [768, 1280];
  for (const locale of ['en', 'bn']) {
    await page.goto('/');
    await page.evaluate((value) => localStorage.setItem('locale', value), locale);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 850 });
      for (const path of [
        '/',
        '/students',
        '/students/student-a',
        '/exams/exam-a',
        '/messages/new',
        '/templates',
        '/groups',
      ]) {
        await page.goto(path);
        await expect(page.locator('.page-content h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.getByRole('status', { name: /Loading|লোড/ })).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        const problems = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('body *')].flatMap((element) => {
            if (
              !element.getClientRects().length ||
              getComputedStyle(element).visibility === 'hidden'
            )
              return [];
            const text = [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent?.trim() ?? '')
              .join('');
            if (!text) return [];
            const size = parseFloat(getComputedStyle(element).fontSize);
            const action = element.matches('button, a.button');
            return size < (action ? 14 : 12) ? [{ text, size, selector: element.className }] : [];
          }),
        );
        expect(problems, `${locale} ${width}px ${path}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        const clipped = await page
          .locator('.button, .bottom-nav a')
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.scrollWidth > element.clientWidth + 1)
              .map((element) => element.textContent),
          );
        expect(clipped, `${locale} ${width}px ${path}`).toEqual([]);
      }
    }
    await page.screenshot({ path: info.outputPath(`typography-${locale}.png`), fullPage: true });
  }
});

test('auth back actions are separated in reset, setup and activation modes', async ({
  page,
}, info) => {
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  const control = await fixture(page);
  control.authenticated = false;
  for (const mode of ['reset', 'setup', 'activate', 'existing'] as const) {
    control.invitationExisting = mode === 'existing' ? 1 : 0;
    await page.goto(
      mode === 'activate' || mode === 'existing' ? '/?invite=fixture-not-a-real-invitation' : '/',
    );
    if (mode === 'reset')
      await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    if (mode === 'setup')
      await page.getByRole('button', { name: 'Set up platform', exact: true }).click();
    const back = page.getByRole('button', { name: 'Back to sign in', exact: true });
    await expect(back).toBeVisible();
    const primary = await page.locator('.auth-content form button[type="submit"]').boundingBox();
    const secondary = await back.boundingBox();
    if (!primary || !secondary) throw new Error('Auth action geometry is missing');
    expect(secondary.y - primary.y - primary.height).toBeGreaterThanOrEqual(15);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`auth-${mode}.png`), fullPage: true });
    await back.click();
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  }
});

test('recovery controls are spaced, downloadable and retain the saved acknowledgement guard', async ({
  page,
}, info) => {
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  const control = await fixture(page);
  control.authenticated = false;
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up platform', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fixture owner');
  await page.getByLabel('Setup key', { exact: true }).fill('fixture-setup-key-not-for-production');
  await page.getByLabel('Phone number', { exact: true }).fill('01700000013');
  await page.getByLabel('New password', { exact: true }).fill('fixture password long enough 2026');
  await page.getByRole('button', { name: 'Set up platform', exact: true }).click();
  const download = page.getByRole('button', { name: 'Download recovery codes', exact: true });
  const ack = page.getByLabel('I saved my codes', { exact: true });
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeDisabled();
  const file = page.waitForEvent('download');
  await download.click();
  expect((await file).suggestedFilename()).toBe('coaching-recovery-codes.txt');
  await ack.uncheck();
  await expect(next).toBeDisabled();
  await ack.check();
  await expect(next).toBeEnabled();
  const boxes = await page.locator('.recovery-actions > *').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    }),
  );
  expect((boxes[1]?.top ?? 0) - (boxes[0]?.bottom ?? 0)).toBeGreaterThanOrEqual(15);
  expect((boxes[2]?.top ?? 0) - (boxes[1]?.bottom ?? 0)).toBeGreaterThanOrEqual(15);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('recovery-actions.png'), fullPage: true });
  await next.click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Audit', exact: true }),
  ).toBeVisible();
});

test('platform deletion requires suspension and the typed name, keeps failures retryable and repairs pagination', async ({
  page,
}, info) => {
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  const control = await fixture(page);
  control.platform = true;
  control.noCenters = true;
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Delete center First Coaching', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const remove = page.getByRole('button', { name: 'Delete center Second Coaching', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Type the coaching center name to confirm', { exact: true });
  const permanent = dialog.getByRole('button', { name: 'Delete permanently', exact: true });
  await expect(dialog).toContainText('User accounts and other coaching centers are kept.');
  await expect(permanent).toBeDisabled();
  await name.fill('Wrong center');
  await expect(permanent).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(control.deletedCenters).toEqual([]);
  await remove.click();
  await expect(name).toHaveValue('');
  await name.fill('Second Coaching');
  await expect(permanent).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('delete-center-dialog.png'), fullPage: true });
  control.rejectWrites = true;
  await permanent.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(name).toHaveValue('Second Coaching');
  expect(control.writes).toHaveLength(1);
  control.rejectWrites = false;
  const request = page.waitForRequest(
    (request) =>
      request.method() === 'DELETE' && request.url().endsWith('/platform/centers/center-b'),
  );
  await permanent.click();
  expect((await request).postDataJSON()).toEqual({ name: 'Second Coaching' });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'First Coaching', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Second Coaching', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  expect(control.deletedCenters).toEqual(['center-b']);
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
  await page.screenshot({ path: info.outputPath('after-center-delete.png'), fullPage: true });
});

test('platform center cards, pagination and collapsed recovery preserve their workflows', async ({
  page,
}, info) => {
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  const control = await fixture(page);
  control.platform = true;
  control.noCenters = true;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'First Coaching', exact: true })).toBeVisible();
  await expect(page.locator('.platform-recovery form')).toBeHidden();
  const card = page.locator('.platform-center');
  const textBox = await card.locator('h2').boundingBox();
  const cardBox = await card.boundingBox();
  if (!textBox || !cardBox) throw new Error('Center card geometry is missing');
  expect(textBox.x - cardBox.x).toBeLessThanOrEqual(25);
  await page.screenshot({ path: info.outputPath('platform-centers.png'), fullPage: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second Coaching', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'First Coaching', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Already-submitted SMS cannot be recalled.');
  await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(control.writes.at(-1)).toMatchObject({
    path: '/api/platform/centers/center-a',
    body: { active: false },
  });
  await page.locator('.platform-recovery > summary').click();
  await page.getByLabel('Phone number', { exact: true }).fill('01700000013');
  await page
    .getByLabel('Verification reference', { exact: true })
    .fill('Fixture verified support reference 1234');
  await page.getByRole('button', { name: 'Issue one-use recovery code', exact: true }).click();
  expect(control.writes.filter((write) => write.path.endsWith('/recovery'))).toHaveLength(0);
  await page
    .getByLabel('I independently verified this person’s account ownership.', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Issue one-use recovery code', exact: true }).click();
  await expect(
    page.getByText('fixture-only-not-a-real-recovery-code', { exact: true }),
  ).toBeVisible();
  expect(control.writes.at(-1)).toMatchObject({
    path: '/api/platform/recovery',
    body: { confirmed: true },
  });
  await page.getByRole('button', { name: 'Hide code', exact: true }).click();
  await expect(
    page.getByText('fixture-only-not-a-real-recovery-code', { exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('message review offers clear timing choices and still requires final approval', async ({
  page,
}, info) => {
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  const control = await fixture(page, [
    'messages.send',
    'messages.schedule',
    'messages.read_content',
  ]);
  await page.route('**/api/c/center-a/campaigns/**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith('/messages')
        ? {
            items: [
              {
                id: 'message-a',
                student_name: 'Fixture Student',
                phone: '8801700000013',
                body: 'A personalized fixture message.',
                state: 'pending',
                segments: 1,
                reason: null,
              },
            ],
            next: null,
          }
        : {
            id: 'review-a',
            name: 'Fixture review',
            state: 'ready_for_review',
            created_at: 1,
            scheduled_at: null,
            total: 1,
            excluded: 0,
            submitted: 0,
            delivered: 0,
            failed: 0,
            unknown: 0,
            skipped: 0,
            reason: null,
          },
    });
  });
  await page.goto('/messages/review-a');
  const review = page.getByRole('region', { name: 'Review messages', exact: true });
  await expect(review.getByRole('radio', { name: 'Send now', exact: true })).toBeChecked();
  await expect(review.getByLabel('Send date and time', { exact: true })).toHaveCount(0);
  await expect(review.locator('.sms-details p')).toBeHidden();
  await review.locator('.sms-details summary').click();
  await expect(review.locator('.sms-details p')).toContainText('not proof of delivery');
  await review.locator('.sms-details summary').click();
  await review.getByRole('radio', { name: 'Schedule', exact: true }).check();
  await expect(
    review.getByRole('button', { name: 'Schedule messages', exact: true }),
  ).toBeDisabled();
  await review.getByLabel('Send date and time', { exact: true }).fill('2030-01-02T10:30');
  await expect(review).toContainText('Asia/Dhaka');
  if (!info.project.use.isMobile) {
    const radioBox = await review.locator('.choice').first().boundingBox();
    const inputBox = await review.getByLabel('Send date and time', { exact: true }).boundingBox();
    if (!radioBox || !inputBox) throw new Error('Send control geometry is missing');
    expect(Math.abs(radioBox.y - inputBox.y)).toBeLessThan(2);
  }
  await page.screenshot({ path: info.outputPath('message-review-scheduled.png'), fullPage: true });
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await review.getByRole('button', { name: 'Schedule messages', exact: true }).click();
  expect(control.writes).toHaveLength(0);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm schedule', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(control.writes.at(-1)).toMatchObject({
    path: '/api/c/center-a/campaigns/review-a/approve',
    body: { scheduled_at: Date.UTC(2030, 0, 2, 4, 30) },
  });
  await review.getByRole('radio', { name: 'Send now', exact: true }).check();
  await expect(review.getByLabel('Send date and time', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('message-review-now.png'), fullPage: true });
  await review.getByRole('button', { name: 'Send messages', exact: true }).click();
  expect(control.writes).toHaveLength(1);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm sending', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(control.writes.at(-1)).toMatchObject({ body: { scheduled_at: null } });
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await page
    .locator('.send-review')
    .getByRole('radio', { name: 'সময় নির্ধারণ', exact: true })
    .check();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath('message-review-bangla.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Bangla uses the bundled font with joined text and unclipped shared typography', async ({
  page,
}, info) => {
  await fixture(page, ['balance.read']);
  await page.addInitScript(() => localStorage.setItem('locale', 'bn'));
  const fontResponse = page.waitForResponse((response) =>
    response.url().endsWith('/fonts/noto-sans-bengali-v33.woff2'),
  );
  await page.goto('/');
  expect((await fontResponse).status()).toBe(200);
  const weights = await page.evaluate(async () => {
    return Promise.all(
      [400, 650, 700].map(async (weight) => {
        const faces = await document.fonts.load(
          `${weight} 24px "Noto Sans Bengali"`,
          'শিক্ষার্থী কর্মক্ষেত্র সারসংক্ষেপ শ্রেণি',
        );
        return faces.map((face) => ({ family: face.family, status: face.status }));
      }),
    );
  });
  for (const faces of weights) {
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((face) => face.status === 'loaded')).toBe(true);
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const renderedBengali = async (selector: string) => {
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(
      fonts.some(
        (font) =>
          font.isCustomFont && font.familyName.includes('Noto Sans Bengali') && font.glyphCount > 0,
      ),
    ).toBe(true);
  };
  for (const path of [
    '/',
    '/students',
    '/exams',
    '/messages',
    '/groups',
    '/academic',
    '/templates',
    '/staff',
    '/settings',
  ]) {
    if (path !== '/') await page.goto(path);
    await expect(page.locator('.page-content')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
    await expect(page.locator('.page-content h1')).toHaveCSS('letter-spacing', 'normal');
    const cramped = await page
      .locator('.page-content :is(h1, h2, .eyebrow, .badge, .stat-top span), .nav-caption')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              style.letterSpacing !== 'normal' ||
              parseFloat(style.lineHeight) / parseFloat(style.fontSize) < 1.59
            );
          })
          .map((element) => element.textContent),
      );
    expect(cramped).toEqual([]);
    await renderedBengali('.page-content h1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (path === '/')
      await page.screenshot({ path: info.outputPath('bangla-dashboard.png'), fullPage: true });
    if (path === '/groups') {
      await page.getByRole('button', { name: 'ব্যাচ যোগ করুন', exact: true }).click();
      await page.getByRole('dialog').getByRole('textbox').fill('প্রথম শ্রেণির শিক্ষার্থী');
      await page.screenshot({ path: info.outputPath('bangla-dialog.png'), fullPage: true });
      await page.getByRole('dialog').getByRole('button', { name: 'বাতিল', exact: true }).click();
    }
  }
  await page.route('**/api/c/center-a/exams/exam-a', (route) =>
    route.fulfill({
      json: {
        id: 'exam-a',
        name: 'শিক্ষার্থীদের পরীক্ষা—প্রথম শ্রেণি',
        exam_date: '2026-10-24',
        active: 1,
        version: 1,
        papers: [],
        participants: 0,
        groups: [],
      },
    }),
  );
  await page.goto('/exams/exam-a');
  await expect(page.locator('.page-content h1')).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.page-content h1')).toHaveAttribute('lang', 'bn');
  await expect(page.locator('.page-content h1')).toHaveCSS('letter-spacing', 'normal');
  await renderedBengali('.page-content h1');
  await page.screenshot({ path: info.outputPath('bangla-title-english-ui.png'), fullPage: true });
  await cdp.detach();
});

test('missing SMS estimates stay unavailable while a genuine zero remains visible', async ({
  page,
}, info) => {
  await fixture(page, ['balance.read']);
  let estimate: number | null | undefined = null;
  await page.route('**/api/c/center-a/balance', (route) =>
    route.fulfill({
      json: { balance: '42.00', estimate_sms: estimate, checked_at: 1 },
    }),
  );
  for (const value of [null, undefined, 0, 75]) {
    estimate = value;
    await page.goto('/');
    await expect(page.locator('.balance-number')).toHaveText('৳42.00');
    const panel = page.locator('.balance-panel');
    if (value === null || value === undefined) {
      await expect(panel).toContainText('Provider estimate unavailable.');
      await expect(panel).not.toContainText('Estimate: 0 SMS.');
    } else {
      await expect(panel).toContainText(`Estimate: ${value} SMS.`);
      await expect(panel).not.toContainText('Provider estimate unavailable.');
    }
  }
  estimate = null;
  await page.reload();
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(page.locator('.balance-panel')).toContainText(
    'সেবাদাতার আনুমানিক এসএমএস সংখ্যা পাওয়া যায়নি।',
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: info.outputPath('unavailable-estimate-bangla.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('dashboard refreshes balance once per visit and reload, not on background updates', async ({
  page,
}) => {
  const control = await fixture(page, ['balance.read', 'balance.refresh']);
  const refreshes = () =>
    control.writes.filter((write) => write.path.endsWith('/balance/refresh')).length;
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(refreshes()).toBe(0);
  await page.goto('/');
  await expect(page.locator('.balance-number')).toHaveText('৳42.00');
  expect(refreshes()).toBe(1);
  const reads = control.reads.filter((path) => path.endsWith('/balance')).length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect
    .poll(() => control.reads.filter((path) => path.endsWith('/balance')).length)
    .toBeGreaterThan(reads);
  await expect(page.getByRole('button', { name: 'Refresh balance', exact: true })).toBeEnabled();
  expect(refreshes()).toBe(1);
  await page.getByRole('button', { name: 'Refresh balance', exact: true }).click();
  await expect.poll(refreshes).toBe(2);
  await page.getByRole('link', { name: 'Students', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect.poll(refreshes).toBe(3);
  await expect(page.getByRole('button', { name: 'Refresh balance', exact: true })).toBeEnabled();
  await page.reload();
  await expect.poll(refreshes).toBe(4);
  await expect(page.locator('.balance-number')).toHaveText('৳42.00');
});

test('automatic balance refresh respects permissions and does not retry failed requests', async ({
  page,
}) => {
  const control = await fixture(page, ['balance.read']);
  await page.goto('/');
  await expect(page.locator('.balance-number')).toHaveText('৳10.00');
  await expect(page.getByRole('button', { name: 'Refresh balance', exact: true })).toHaveCount(0);
  expect(control.writes).toHaveLength(0);
  await page.unrouteAll({ behavior: 'wait' });
  const failed = await fixture(page, ['balance.read', 'balance.refresh']);
  failed.rejectWrites = true;
  await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.balance-number')).toHaveText('৳10.00');
  expect(failed.writes).toHaveLength(1);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByRole('button', { name: 'Refresh balance', exact: true })).toBeEnabled();
  expect(failed.writes).toHaveLength(1);
  failed.rejectWrites = false;
  await page.getByRole('button', { name: 'Refresh balance', exact: true }).click();
  await expect(page.locator('.balance-number')).toHaveText('৳42.00');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(failed.writes).toHaveLength(2);
});

test('reload keeps one loading frame across session, context and page requests', async ({
  page,
}, info) => {
  await fixture(page);
  for (const path of [
    '/groups',
    '/staff',
    '/students',
    '/messages',
    '/exams',
    '/academic',
    '/templates',
    '/settings',
    '/',
    '/security',
  ]) {
    const gate = () => {
      let release = () => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    const session = gate();
    const context = gate();
    const content = gate();
    const roles = gate();
    let contextRequested = false;
    const handler = async (route: import('@playwright/test').Route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/auth/session')) await session.promise;
      else if (url.pathname.endsWith('/context')) {
        contextRequested = true;
        await context.promise;
      } else if (path === '/staff' && url.pathname.endsWith('/roles')) await roles.promise;
      else await content.promise;
      await route.fallback();
    };
    await page.route('**/api/**', handler);
    try {
      await page.goto(path);
      await expect(page.locator('.workspace-loading')).toBeVisible();
      const initial = await page.locator('.page-loading').boundingBox();
      if (path === '/staff') await page.screenshot({ path: info.outputPath('startup.png') });
      session.release();
      await expect.poll(() => contextRequested).toBe(true);
      await expect(page.locator('.workspace-loading')).toBeVisible();
      await expect(page.getByRole('heading', { name: /Welcome back/ })).not.toBeVisible();
      expect(await page.locator('.page-loading').boundingBox()).toEqual(initial);
      context.release();
      await expect(page.locator('.workspace-loading')).toHaveCount(0);
      if (!['/security', '/settings'].includes(path)) {
        await expect(page.locator('.page-loading')).toBeVisible();
        await expect
          .poll(async () => {
            const box = await page.locator('.page-loading').boundingBox();
            return box && { x: box.x, y: box.y, width: box.width };
          })
          .toEqual(initial && { x: initial.x, y: initial.y, width: initial.width });
        await expect(page.locator('.page-content')).toBeHidden();
      }
      content.release();
      if (path === '/staff') {
        await expect(page.locator('.page-content')).toBeHidden();
        await expect(page.locator('.page-loading')).toBeVisible();
      }
      roles.release();
      await expect(page.locator('.page-content')).toBeVisible();
      await expect(page.locator('.page-loading')).toHaveCount(0);
      await expect(page.locator('.page-content .skeleton')).toHaveCount(0);
      await expect(page.locator('.page-content h1')).toBeVisible();
      if (path === '/staff') await page.screenshot({ path: info.outputPath('staff-ready.png') });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      session.release();
      context.release();
      content.release();
      roles.release();
      await page.unroute('**/api/**', handler);
    }
  }
});

test('mobile page titles and primary actions stay inline with long taglines', async ({
  page,
}, info) => {
  await fixture(page);
  for (const width of [320, 360, 393, 539]) {
    await page.setViewportSize({ width, height: 850 });
    for (const [path, label] of [
      ['/messages', 'New message'],
      ['/students', 'Add student'],
      ['/groups', 'Add group'],
      ['/staff', 'Invite'],
    ] as const) {
      await page.goto(path);
      const title = page.locator('.page-content h1');
      const action = page
        .locator('.page-content .page-header')
        .getByRole(/Invite|Add group/.test(label) ? 'button' : 'link', {
          name: label,
          exact: true,
        });
      await expect(action).toBeVisible();
      const headingBox = await title.boundingBox();
      const actionBox = await action.boundingBox();
      if (!headingBox || !actionBox) throw new Error('Header geometry is missing');
      expect(actionBox.x).toBeGreaterThan(headingBox.x);
      expect(actionBox.y).toBeLessThan(headingBox.y + headingBox.height);
      expect(actionBox.y + actionBox.height).toBeGreaterThan(headingBox.y);
      if (width === 320 && path === '/messages')
        await page.screenshot({ path: info.outputPath('messages-mobile.png') });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
});

test('cancelled modal drafts reset and ordinary edits preserve active records', async ({
  page,
}) => {
  const control = await fixture(page);
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Cancelled group');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add group', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue('');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/academic');
  await page.getByRole('button', { name: 'Edit Physics', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Physics renamed');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(control.writes.at(-1)?.body).toMatchObject({ active: 1 });
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Edit Result template', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(control.writes.at(-1)?.body).not.toHaveProperty('active', 0);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Edit Teacher', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save role', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(control.writes.at(-1)?.body).not.toHaveProperty('active', 0);
});

test('all five form screens keep their actions after the fields rather than floating over content', async ({
  page,
}, info) => {
  await fixture(page);
  await page.setViewportSize({ width: info.project.use.isMobile ? 320 : 1280, height: 800 });
  const paths = [
    '/students/new',
    '/students/student-a/edit',
    '/exams/new',
    '/exams/exam-a/marks/paper-a',
    '/messages/new',
  ];
  for (const [index, path] of paths.entries()) {
    await page.goto(path);
    const actions = page.locator('.form-actions');
    await expect(actions).toHaveCount(1);
    const layout = await actions.evaluate((element) => {
      const previous = element.previousElementSibling;
      const style = getComputedStyle(element);
      if (!previous) throw new Error('The form fields are missing');
      return {
        position: style.position,
        bottom: style.bottom,
        last: element.parentElement?.lastElementChild === element,
        followsFields:
          element.getBoundingClientRect().top >= previous.getBoundingClientRect().bottom,
      };
    });
    expect(layout).toEqual({ position: 'static', bottom: 'auto', last: true, followsFields: true });
    await actions.scrollIntoViewIfNeeded();
    await expect(
      actions.getByRole('button', { name: /Save|Create exam|Prepare preview/ }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (info.project.use.isMobile) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const footer = await actions.boundingBox();
      const navigation = await page.locator('.bottom-nav').boundingBox();
      if (!footer || !navigation) throw new Error('Footer geometry is missing');
      expect(footer.y + footer.height).toBeLessThanOrEqual(navigation.y);
    }
    await page.screenshot({ path: info.outputPath(`form-footer-${index}.png`), fullPage: true });
  }
});

test('student contacts remain aligned and readable on narrow screens without changing suppression or SMS permission', async ({
  page,
}, info) => {
  await fixture(page);
  const contacts = [
    {
      id: 'contact-guardian',
      phone: '8801723458794',
      audience: 'guardian',
      permitted: 1,
      suppressed: 0,
    },
    {
      id: 'contact-student',
      phone: '8801648234724',
      audience: 'student',
      permitted: 0,
      suppressed: 0,
    },
    {
      id: 'contact-blocked',
      phone: '8801712345678',
      audience: 'guardian',
      permitted: 1,
      suppressed: 1,
    },
  ];
  await page.route('**/api/c/center-a/students/student-a', (route) =>
    route.fulfill({
      json: {
        id: 'student-a',
        name: 'Student A',
        identifier: '',
        version: 1,
        active: 1,
        groups: [],
        contacts,
      },
    }),
  );
  await page.route('**/api/c/center-a/contacts/*/suppression', async (route) => {
    const contact = contacts.find((item) =>
      route.request().url().includes(`/contacts/${item.id}/`),
    );
    if (!contact) throw new Error('Contact fixture is missing');
    const body = route.request().postDataJSON() as { suppressed: boolean; expected: boolean };
    expect(body.expected).toBe(Boolean(contact.suppressed));
    contact.suppressed = Number(body.suppressed);
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/students/student-a');
  const rows = page.locator('.contact-record-row');
  await expect(rows).toHaveCount(3);
  const widths = info.project.use.isMobile ? [320, 360, 390, 539, 767] : [768, 1024, 1280];
  async function checkLayout(width: number) {
    await page.setViewportSize({ width, height: 850 });
    const geometry = await rows.evaluateAll((items) =>
      items.map((item) => {
        const details = item.querySelector('.contact-headline');
        const label = details?.querySelector('strong');
        const badge = details?.querySelector('.badge');
        const phone = item.querySelector('.contact-phone');
        const action = item.querySelector('.contact-action-btn');
        if (!details || !label || !badge || !phone || !action)
          throw new Error('Contact details are missing');
        const labelBox = label.getBoundingClientRect();
        const badgeBox = badge.getBoundingClientRect();
        const phoneBox = phone.getBoundingClientRect();
        const actionBox = action.getBoundingClientRect();
        const headlineBox = details.getBoundingClientRect();
        return {
          display: getComputedStyle(item).display,
          inset: details.getBoundingClientRect().left - item.getBoundingClientRect().left,
          padding: parseFloat(getComputedStyle(item).paddingLeft),
          phoneClipped: phone.scrollWidth > phone.clientWidth,
          badgeClipped: badge.scrollWidth > badge.clientWidth,
          rowOverflow: item.scrollWidth > item.clientWidth,
          labelAndBadgeShareRow: labelBox.top < badgeBox.bottom && badgeBox.top < labelBox.bottom,
          badgeFollowsLabel: badgeBox.left >= labelBox.right,
          phoneAndActionShareRow:
            phoneBox.top < actionBox.bottom && actionBox.top < phoneBox.bottom,
          secondRowFollowsHeadline: Math.min(phoneBox.top, actionBox.top) >= headlineBox.bottom,
          phoneAndActionDoNotOverlap: phoneBox.right <= actionBox.left,
        };
      }),
    );
    for (const row of geometry) {
      expect(row.display).toBe('grid');
      expect(row.inset).toBeCloseTo(row.padding, 0);
      expect(row.phoneClipped).toBe(false);
      expect(row.badgeClipped).toBe(false);
      expect(row.rowOverflow).toBe(false);
      expect(row.labelAndBadgeShareRow).toBe(true);
      expect(row.badgeFollowsLabel).toBe(true);
      expect(row.phoneAndActionShareRow).toBe(true);
      expect(row.secondRowFollowsHeadline).toBe(true);
      expect(row.phoneAndActionDoNotOverlap).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  for (const width of widths) await checkLayout(width);
  await expect(rows.nth(0).getByText('SMS permitted', { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByText('No SMS permission', { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText('Number blocked', { exact: true })).toBeVisible();
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  await page.screenshot({ path: info.outputPath('student-contacts.png'), fullPage: true });
  await rows.first().getByRole('button', { name: 'Block number', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(contacts[0]?.phone ?? 'Missing phone');
  await expect(dialog).toContainText('stops SMS for every student sharing it');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows.first().getByText('Number blocked', { exact: true })).toBeVisible();
  await rows.first().getByRole('button', { name: 'Unblock number', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows.first().getByText('SMS permitted', { exact: true })).toBeVisible();
  await rows.nth(1).getByRole('button', { name: 'Block number', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await rows.nth(1).getByRole('button', { name: 'Unblock number', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows.nth(1).getByText('No SMS permission', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await page.evaluate(() => document.fonts.ready);
  for (const width of widths) await checkLayout(width);
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  await page.screenshot({ path: info.outputPath('student-contacts-bangla.png'), fullPage: true });
});

test('exam groups use two mobile columns and three desktop columns while mobile keeps only the compact add subject action', async ({
  page,
}, info) => {
  const control = await fixture(page);
  control.multipleExamGroups = true;
  await page.goto('/exams/exam-a');
  const cards = page.locator('.participating-group-row');
  await expect(cards).toHaveCount(4);
  const mobile = Boolean(info.project.use.isMobile);
  const columns = mobile ? 2 : 3;
  for (const width of mobile ? [320, 390, 767] : [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    const boxes = await cards.evaluateAll((items) =>
      items.map((item) => {
        const { x, y } = item.getBoundingClientRect();
        return { x, y };
      }),
    );
    const first = boxes[0];
    const nextRow = boxes[columns];
    if (!first || !nextRow) throw new Error('Group card rows are missing');
    for (let column = 1; column < columns; column++) {
      const current = boxes[column];
      const previous = boxes[column - 1];
      if (!current || !previous) throw new Error('Group card columns are missing');
      expect(current.y).toBe(first.y);
      expect(current.x).toBeGreaterThan(previous.x);
    }
    expect(nextRow.y).toBeGreaterThan(first.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await cards.evaluateAll((items) =>
        items.every((item) => item.scrollWidth <= item.clientWidth),
      ),
    ).toBe(true);
    if (mobile) await expect(page.locator('.add-subject-card')).toBeHidden();
    else await expect(page.locator('.add-subject-card')).toBeVisible();
  }
  if (mobile) await page.setViewportSize({ width: 320, height: 850 });
  await page.screenshot({ path: info.outputPath('exam-group-columns.png'), fullPage: true });
  await cards.first().getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Class 3');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Add subject', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add subject', exact: true })).toBeVisible();
});

test('cached page visits refresh silently without replacing content or shifting layout', async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto('/exams/exam-a');
  const participants = page.getByRole('heading', { name: 'Participants', exact: true });
  await expect(participants).toBeVisible();
  const before = await participants.boundingBox();
  await page.getByRole('link', { name: 'Exams', exact: true }).click();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/c/center-a/exams/exam-a', async (route) => {
    started();
    await pending;
    await route.fallback();
  });
  await page.getByRole('link', { name: /Demo Exam - 1/ }).click();
  await requested;
  try {
    await expect(page.locator('.query-state[aria-busy="true"]')).toHaveCount(1);
    await expect(participants).toBeVisible();
    await expect(page.getByText('Updating…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Loading…', exact: true })).toHaveCount(0);
    expect(await participants.boundingBox()).toEqual(before);
    await page.screenshot({
      path: info.outputPath('silent-background-refresh.png'),
      fullPage: true,
    });
  } finally {
    release();
  }
  await expect(page.locator('.query-state[aria-busy="true"]')).toHaveCount(0);
  await expect(participants).toBeVisible();
});

test('temporary refresh failures preserve content and recover without reloading', async ({
  page,
}, info) => {
  const control = await fixture(page);
  await page.goto('/exams/exam-a');
  await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
  control.failExam = true;
  await page.getByLabel('Groups', { exact: true }).selectOption('group-a');
  await page.getByRole('button', { name: 'Add participants', exact: true }).click();
  await expect(page.getByText('Showing saved data. Reconnect or try again to update.')).toBeVisible(
    { timeout: 15000 },
  );
  await expect(page.getByRole('heading', { name: 'Participants', exact: true })).toBeVisible();
  expect(
    control.reads.filter((path) => path.endsWith('/exams/exam-a')).length,
  ).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: info.outputPath('network-recovery.png'), fullPage: true });
  control.failExam = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByText('Showing saved data. Reconnect or try again to update.'),
  ).not.toBeVisible();
});

test('reconnect and failed reads preserve unsaved marks and their conflict version', async ({
  page,
}) => {
  const control = await fixture(page);
  await page.goto('/exams/exam-a/marks/paper-a');
  const score = page.getByLabel('Marks for Ayesha', { exact: true });
  await score.fill('73');
  await page.context().setOffline(true);
  await expect(page.getByText('You are offline', { exact: false })).toBeVisible();
  await page.context().setOffline(false);
  await expect
    .poll(() => control.reads.filter((path) => path.endsWith('/marks')).length)
    .toBeGreaterThan(1);
  await expect(score).toHaveValue('73');
  await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeEnabled();
  control.failMarks = true;
  await page.context().setOffline(true);
  await expect(page.getByText('You are offline', { exact: false })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText('Showing saved data. Reconnect or try again to update.')).toBeVisible(
    { timeout: 15000 },
  );
  await expect(score).toHaveValue('73');
  control.failMarks = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByText('Showing saved data. Reconnect or try again to update.'),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeDisabled();
  await expect(score).toHaveValue('73');
  expect(control.writes.at(-1)?.body).toEqual([
    { student_id: 'student-a', status: 'scored', score: 7300, version: 1 },
  ]);
});

test('concurrent marks edits cannot overwrite newer results and zero stays distinct from exempt', async ({
  page,
}) => {
  const control = await fixture(page);
  await page.goto('/exams/exam-a/marks/paper-a');
  const score = page.getByLabel('Marks for Ayesha', { exact: true });
  await score.fill('73');
  control.markVersion = 2;
  control.markScore = null;
  control.markStatus = 'exempt';
  await page.context().setOffline(true);
  await expect(page.getByText('You are offline', { exact: false })).toBeVisible();
  await page.context().setOffline(false);
  await expect
    .poll(() => control.reads.filter((path) => path.endsWith('/marks')).length)
    .toBeGreaterThan(1);
  await expect(score).toHaveValue('73');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'This record changed elsewhere. Your edits are kept.',
  );
  await expect(score).toHaveValue('73');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByLabel('Result status for Ayesha')).toHaveValue('exempt');
  await expect(score).toBeDisabled();
  await page.getByLabel('Result status for Ayesha').selectOption('scored');
  await score.fill('0');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeDisabled();
  await expect(score).toHaveValue('0');
  expect(control.writes.at(-1)?.body).toEqual([
    { student_id: 'student-a', status: 'scored', score: 0, version: 2 },
  ]);
});

test('uncertain writes keep the draft and are never automatically replayed', async ({ page }) => {
  const control = await fixture(page);
  await page.goto('/academic');
  await page.getByRole('button', { name: 'Edit Physics', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('My unsaved name');
  control.rejectWrites = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Confirmation was not received.');
  const before = control.reads.length;
  await page.context().setOffline(true);
  await expect(page.getByText('You are offline', { exact: false })).toBeVisible();
  await page.context().setOffline(false);
  await expect.poll(() => control.reads.length).toBeGreaterThan(before);
  expect(control.writes).toHaveLength(1);
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue(
    'My unsaved name',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Discard unsaved changes?')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue(
    'My unsaved name',
  );
});

test('cached student editors isolate identities and preserve denied SMS permission', async ({
  page,
}) => {
  const control = await fixture(page);
  await page.goto('/students/student-b/edit');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Student B');
  await page.getByRole('link', { name: 'Students', exact: true }).click();
  await page.getByText('Student A', { exact: true }).click();
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Student A');
  await page.evaluate(() => history.go(-3));
  await expect(page).toHaveURL(/\/students\/student-b\/edit$/);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Student B');
  await expect(page.getByLabel('Phone number', { exact: true })).toHaveValue('01700000014');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => control.writes.length).toBe(1);
  expect(control.writes[0]?.body).toMatchObject({ contacts: [{ permitted: false }] });
});

test('programmatic edits prompt before leaving and pickers are accessible when open', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/messages/new');
  await page.getByLabel('Select exams', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search exams…' })).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    audit.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.getByRole('dialog', { name: 'Search exams…' }).getByRole('textbox').press('Escape');
  await page.getByRole('button', { name: 'student name', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('{{student_name}}');
});

test('page visits revalidate and malformed session responses offer recovery instead of login', async ({
  page,
}) => {
  const control = await fixture(page);
  await page.goto('/exams');
  await expect(page.getByRole('heading', { name: 'Demo Exam - 1', exact: true })).toBeVisible();
  const count = control.reads.filter((path) => path.endsWith('/exams')).length;
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Audit', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Exams', exact: true }).click();
  await expect
    .poll(() => control.reads.filter((path) => path.endsWith('/exams')).length)
    .toBeGreaterThan(count);
  control.malformedSession = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).not.toBeVisible();
  control.malformedSession = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Exams', exact: true })).toBeVisible();
});

test('initial skeletons respect reduced motion and fit the viewport', async ({ page }, info) => {
  await fixture(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/c\/center-a\/exams\?/, async (route) => {
    await gate;
    await route.fallback();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.goto('/exams');
    await expect(
      page.getByRole('main').getByRole('status', { name: 'Loading…', exact: true }),
    ).toBeVisible();
    await expect(page.locator('main .skeleton-line')).toHaveCSS('animation-name', 'none');
    expect(
      await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('loading.png'), fullPage: true });
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'Demo Exam - 1', exact: true })).toBeVisible();
});

test('sign-in, sign-out and password validation preserve a working session observer', async ({
  page,
}) => {
  const control = await fixture(page);
  control.authenticated = false;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Phone number', { exact: true }).fill('01700000013');
  await page.getByLabel('Password', { exact: true }).fill('local fixture password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Audit', exact: true }),
  ).toBeVisible();
  await page.goto('/security');
  await page.getByLabel('Current password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your current password is incorrect.');
  await expect(page.getByRole('heading', { name: 'Account security', exact: true })).toBeVisible();
  await page.goto('/more');
  await page.locator('.menu-list').getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Phone number', { exact: true }).fill('01700000013');
  await page.getByLabel('Password', { exact: true }).fill('local fixture password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Audit', exact: true }),
  ).toBeVisible();
});

test('reconnecting during account setup does not hide unacknowledged recovery codes', async ({
  page,
}) => {
  const control = await fixture(page);
  control.authenticated = false;
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up platform', exact: true }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Fixture owner');
  await page
    .getByLabel('Setup key', { exact: true })
    .fill('local-fixture-setup-key-not-for-production');
  await page.getByLabel('Phone number', { exact: true }).fill('01700000013');
  await page.getByLabel('New password', { exact: true }).fill('local fixture password 2026');
  await page.getByRole('button', { name: 'Set up platform', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Save recovery codes', exact: true }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await page.context().setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(
    page.getByRole('heading', { name: 'Save recovery codes', exact: true }),
  ).toBeVisible();
  await page.getByLabel('I saved my codes', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Audit', exact: true }),
  ).toBeVisible();
});

test('list pagination and search survive detail visits and browser Back', async ({ page }) => {
  await fixture(page);
  await page.route(/\/api\/c\/center-a\/students\?/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const cursor = params.get('cursor');
    const query = params.get('q');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'student-a',
            name: query || 'Student A',
            identifier: query ? `Result for ${query}` : 'a',
            active: 1,
            version: 1,
          },
        ],
        next: cursor ? null : 'next-cursor',
      }),
    });
  });
  await page.goto('/students');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/cursor=next-cursor/);
  await page.getByText('Student A', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Student A', exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/cursor=next-cursor/);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).not.toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/students$/);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search', exact: true });
  await search.fill('Student A');
  await search.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Student A');
  await expect(page.locator('.record-row small')).toHaveText('Result for Student A');
  await search.fill('Student B');
  await search.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Student B');
  await expect(page.locator('.record-row small')).toHaveText('Result for Student B');
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Student A');
  await expect(search).toHaveValue('Student A');
  await expect(page.locator('.record-row small')).toHaveText('Result for Student A');
});
