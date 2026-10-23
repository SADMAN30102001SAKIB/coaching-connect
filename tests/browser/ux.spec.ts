import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fixture(page: Page) {
  const control = {
    failExam: false,
    failMarks: false,
    malformedSession: false,
    authenticated: true,
    rejectWrites: false,
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
        return json({ recovery_codes: ['fixture-only-recovery-code-not-a-real-secret'] });
      }
      if (path === '/api/auth/logout') control.authenticated = false;
      if (path === '/api/auth/security')
        return json(
          { error: { code: 'PASSWORD_INCORRECT', message: 'Your current password is incorrect.' } },
          401,
        );
      if (control.rejectWrites) return route.abort('failed');
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
      return json({ user: { id: 'owner', name: 'Audit Teacher', platform: 0 }, centers: [center] });
    }
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
      return json(exam);
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
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ id: 'student-a', name: 'Student A', identifier: 'a', active: 1, version: 1 }],
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
  await search.fill('Student B');
  await search.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Student B');
  await page.goBack();
  await expect(search).toHaveValue('Student A');
});
