import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('exam progress links open filtered marks and protect unsaved edits', async ({
  page,
}, info) => {
  await fixture(page);
  if (info.project.use.isMobile) await page.setViewportSize({ width: 320, height: 850 });
  const progress = { marked: 1, absent: 1, not_entered: 2 };
  const paper = { id: 'paper-a', name: 'English', maximum: 10000, version: 1, progress };
  const exam = {
    id: 'exam-a',
    name: 'October assessment',
    exam_date: '2026-10-25',
    active: 1,
    version: 1,
    participants: 4,
    subject_count: 1,
    complete_count: 2,
    papers: [paper],
    groups: [],
  };
  await page.route('**/api/c/center-a/exams**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/marks')) {
      const filter = url.searchParams.get('filter') ?? 'all';
      const items = ['scored', 'absent', 'pending', 'exempt'].map((status, i) => ({
        student_id: `student-${i}`,
        name: `Student ${i}`,
        identifier: '',
        status,
        score: i === 0 ? 0 : null,
        version: 1,
      }));
      return route.fulfill({
        json: {
          paper,
          groups: [],
          progress,
          next: null,
          items: items.filter(
            (row) =>
              filter === 'all' ||
              (filter === 'not_entered'
                ? ['pending', 'exempt'].includes(row.status)
                : row.status === filter),
          ),
        },
      });
    }
    return route.fulfill({
      json: url.pathname.endsWith('/exams') ? { items: [exam], next: null } : exam,
    });
  });
  await page.goto('/exams');
  await expect(page.locator('.exam-record')).toContainText('4 students');
  await expect(page.locator('.exam-record')).toContainText('2 complete · 2 incomplete');
  const summary = await page.locator('.exam-progress-summary').evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    whiteSpace: getComputedStyle(element).whiteSpace,
    overflow: getComputedStyle(element).overflow,
    display: getComputedStyle(element).display,
    wrap: getComputedStyle(element).overflowWrap,
  }));
  expect(summary.scrollWidth <= summary.width, JSON.stringify(summary)).toBe(true);
  await page.screenshot({ path: info.outputPath('exam-progress-list.png'), fullPage: true });
  await page.locator('.exam-record .record-row-content').click();
  await expect(page.locator('.result-progress')).toContainText('Marked');
  await expect(page.locator('.result-progress')).toContainText('Not entered');
  await page.screenshot({ path: info.outputPath('subject-progress.png'), fullPage: true });
  await page
    .locator('.result-progress')
    .getByRole('link', { name: '2 Not entered', exact: true })
    .click();
  await expect(page).toHaveURL(/filter=not_entered/);
  await expect(page.locator('.mark-row')).toHaveCount(2);
  await page.getByLabel('Marks for Student 2', { exact: true }).fill('23');
  await page
    .getByRole('group', { name: 'Filter results', exact: true })
    .getByRole('button', { name: 'Absent', exact: false })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Save or discard your marks before changing filters.',
  );
  await expect(page).toHaveURL(/filter=not_entered/);
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page
    .getByRole('group', { name: 'Filter results', exact: true })
    .getByRole('button', { name: 'Absent', exact: false })
    .click();
  await expect(page.locator('.mark-row')).toHaveCount(1);
  await expect(page.getByLabel('Result status for Student 1', { exact: true })).toHaveValue(
    'absent',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('marks dropdown offers only scored and absent without rewriting existing statuses', async ({
  page,
}) => {
  const control = await fixture(page);
  control.markScore = null;
  for (const status of ['pending', 'exempt']) {
    control.markStatus = status;
    await page.goto('/exams/exam-a/marks/paper-a');
    const select = page.getByLabel('Result status for Ayesha', { exact: true });
    await expect(select.locator('option')).toHaveText(['Scored', 'Absent']);
    await expect(page.getByLabel('Marks for Ayesha', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeDisabled();
    expect(control.writes).toHaveLength(0);
  }
  await page.getByLabel('Result status for Ayesha', { exact: true }).selectOption('absent');
  await page.getByRole('button', { name: 'Save marks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeDisabled();
  expect(control.writes.at(-1)?.body).toEqual([
    { student_id: 'student-a', status: 'absent', score: null, version: 1 },
  ]);
});

test('exam enrollment resets its selection and replaces stale add feedback after removal', async ({
  page,
}, info) => {
  await fixture(page);
  let enrolled = false;
  await page.route('**/api/c/center-a/exams/exam-a**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/participants')) {
      enrolled = true;
      return route.fulfill({ json: { added: 2 } });
    }
    if (request.method() === 'DELETE') {
      enrolled = false;
      return route.fulfill({ json: { removed: 2 } });
    }
    return route.fulfill({
      json: {
        id: 'exam-a',
        name: 'Roster exam',
        active: 1,
        version: 1,
        exam_date: '2026-10-25',
        papers: [],
        participants: enrolled ? 2 : 0,
        groups: enrolled ? [{ id: 'group-a', name: 'Batch A', count: 2 }] : [],
      },
    });
  });
  await page.goto('/exams/exam-a');
  await page.getByLabel('Groups', { exact: true }).selectOption('group-a');
  await page.getByRole('button', { name: 'Add participants', exact: true }).click();
  await expect(page.getByLabel('Groups', { exact: true })).toHaveValue('');
  const oldNotice = page.getByText(
    'Participants added. Existing participants were not duplicated.',
    { exact: true },
  );
  await expect(oldNotice).toBeVisible();
  await expect(page.locator('.participating-group-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(oldNotice).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'Remove group', exact: true });
  await expect(dialog).toContainText('Other enrollments are kept');
  await dialog.getByRole('button', { name: 'Remove group', exact: true }).click();
  await expect(page.locator('.participating-group-row')).toHaveCount(0);
  await expect(
    page.getByText('Group removed. Other group enrollments and individual enrollments were kept.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('enrollment-feedback.png'), fullPage: true });
});

test('platform restore and suspend actions align across active and suspended centers', async ({
  page,
}, info) => {
  const control = await fixture(page);
  control.platform = true;
  control.noCenters = true;
  await page.route('**/api/platform/centers?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'center-a',
            name: 'Active center',
            owner_name: 'Admin',
            owner_phone: '01700000013',
            active: 1,
          },
          {
            id: 'center-b',
            name: 'Suspended center',
            owner_name: 'Another admin',
            owner_phone: '01700000014',
            active: 0,
          },
        ],
        next: null,
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Suspended center', exact: true })).toBeVisible();
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 850 });
    const suspend = await page.getByRole('button', { name: 'Suspend', exact: true }).boundingBox();
    const restore = await page.getByRole('button', { name: 'Restore', exact: true }).boundingBox();
    if (!suspend || !restore) throw new Error('Missing center controls');
    expect(suspend.x).toBeCloseTo(restore.x, 0);
    expect(suspend.width).toBeCloseTo(restore.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`aligned-center-actions-${width}.png`),
      fullPage: true,
    });
  }
});

test('validation explains contact fields in English and Bangla without exposing paths', async ({
  page,
}, info) => {
  await fixture(page);
  await page.route('**/api/c/center-a/students', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 422,
      json: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Contact 1 — Phone number: Enter a valid Bangladesh mobile number',
          details: [
            {
              field: 'Phone number',
              section: 'Contact',
              item: 1,
              message: 'Enter a valid Bangladesh mobile number',
            },
          ],
        },
      },
    });
  });
  await page.goto('/students/new');
  await page.getByLabel('Name', { exact: true }).fill('Validation draft');
  await page.getByLabel('Phone number', { exact: true }).fill('0173456789');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(
    'Contact 1 — Phone number: Enter a valid Bangladesh mobile number',
  );
  await expect(alert).not.toContainText('contacts.0.phone');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Validation draft');
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await expect(alert).toContainText('যোগাযোগ ১ — ফোন নম্বর: বাংলাদেশের সঠিক মোবাইল নম্বর লিখুন');
  await alert.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('readable-validation.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('non-retryable read errors do not offer a misleading retry button', async ({ page }) => {
  await fixture(page);
  let status = 403;
  await page.route('**/api/c/center-a/students?*', (route) =>
    route.fulfill({
      status,
      json: {
        error: {
          code: 'ACCESS_DENIED',
          message: 'Your role does not allow this action. Ask your center admin.',
        },
      },
    }),
  );
  for (status of [403, 404, 422]) {
    await page.goto('/students');
    await expect(
      page.getByText('Your role does not allow this action. Ask your center admin.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  }
});

test('dashboard hides message history and its links without read permission', async ({ page }) => {
  const control = await fixture(page);
  control.admin = false;
  control.deniedPermissions = ['messages.read'];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back, Audit Teacher' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent messages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No messages yet', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View all', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Messages', exact: true })).toHaveCount(0);
  control.deniedPermissions = [];
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recent messages', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all', exact: true })).toBeVisible();
});

test('result group choices follow selected exams and announcements keep all groups', async ({
  page,
}, info) => {
  await fixture(page);
  const exams = ['a', 'b'].map((id) => ({
    id: `exam-${id}`,
    name: `Exam ${id.toUpperCase()}`,
    active: 1,
    papers: [],
    groups: [{ id: `group-${id}`, name: `Exam group ${id.toUpperCase()}` }],
  }));
  await page.route('**/api/c/center-a/exams**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith('/exams')
        ? { items: exams, next: null }
        : exams.find((exam) => path.endsWith(`/${exam.id}`)),
    });
  });
  await page.goto('/messages/new?exam=exam-a');
  const groups = page.getByLabel('Groups', { exact: true });
  await expect(groups).toContainText('All exam participants');
  await groups.click();
  await expect(page.getByRole('checkbox', { name: 'Exam group A', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Batch A', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Exam group A', exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Select exams', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Exam B', exact: true }).check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(groups).toContainText('All exam participants');
  await groups.click();
  await expect(page.getByRole('checkbox', { name: 'Exam group A', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Exam group B', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Message type', { exact: true }).selectOption('subject');
  await groups.click();
  await expect(page.getByRole('checkbox', { name: 'Exam group A', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Exam group B', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Exam group A', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('exam-recipient-groups.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Message type', { exact: true }).selectOption('announcement');
  await expect(groups).toContainText('All students included');
  await groups.click();
  await expect(page.getByRole('checkbox', { name: 'Batch A', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Exam group A', exact: true })).toHaveCount(0);
});

test('exam header keeps send results beside edit on narrow screens', async ({ page }, info) => {
  await fixture(page, ['exams.archive', 'exams.update', 'messages.create']);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/exams/exam-a');
  const send = page.getByRole('link', { name: 'Send results', exact: true });
  const edit = page
    .locator('.exam-page-actions')
    .getByRole('button', { name: 'Edit', exact: true });
  const archive = page.getByRole('button', { name: 'Archive', exact: true });
  await expect(send).toBeVisible();
  const boxes = await Promise.all([archive.boundingBox(), edit.boundingBox(), send.boundingBox()]);
  const first = boxes[0];
  if (!first) throw new Error('Archive action is missing');
  expect(boxes.every((box) => box && Math.abs(box.y - first.y) < 2)).toBe(true);
  expect(boxes[1]?.width).toBeGreaterThanOrEqual(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await archive.click();
  await expect(page.getByRole('dialog', { name: 'Archive exam', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: info.outputPath('exam-header-mobile.png') });
});

async function fixture(page: Page, extraPermissions: string[] = []) {
  const control = {
    failExam: false,
    multipleExamGroups: false,
    failMarks: false,
    malformedSession: false,
    authenticated: true,
    platform: false,
    admin: true,
    deniedPermissions: [] as string[],
    displayName: 'Audit Teacher',
    staff: [] as {
      id: string;
      name: string;
      phone: string;
      active: number;
      pending: number;
      role_ids: string;
    }[],
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
      if (path === '/api/auth/profile')
        control.displayName = (req.postDataJSON() as { name: string }).name;
      if (path.endsWith('/staff/invite')) return json({ token: 'a'.repeat(64) });
      if (req.method() === 'DELETE' && path.includes('/staff/'))
        control.staff = control.staff.filter((person) => !path.endsWith(`/${person.id}`));
      if (req.method() === 'PUT' && path.includes('/staff/')) {
        const input = req.postDataJSON() as { active: boolean; role_ids: string[] };
        control.staff = control.staff.map((person) =>
          path.endsWith(`/${person.id}`)
            ? { ...person, active: Number(input.active), role_ids: JSON.stringify(input.role_ids) }
            : person,
        );
      }
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
        user: { id: 'owner', name: control.displayName, platform: Number(control.platform) },
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
    if (path.endsWith('/context'))
      return json({
        center,
        admin: control.admin,
        permissions: permissions.filter(
          (permission) => !control.deniedPermissions.includes(permission),
        ),
      });
    if (path.endsWith('/staff')) return json({ items: control.staff, next: null });
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

test('management rows, compact staff dialogs and platform controls stay usable on narrow and short screens', async ({
  page,
}, info) => {
  await page.setViewportSize(
    info.project.use.isMobile ? { width: 320, height: 700 } : { width: 1280, height: 800 },
  );
  const control = await fixture(page);
  const name = 'A teacher with a long full display name';
  control.staff = [
    {
      id: 'staff-long',
      name,
      phone: '8801700000011',
      active: 1,
      pending: 0,
      role_ids: '["role-0"]',
    },
    {
      id: 'staff-pending',
      name: '',
      phone: '8801700000012',
      active: 0,
      pending: 1,
      role_ids: '[]',
    },
    {
      id: 'owner',
      name: 'Coaching administrator',
      phone: '8801700000013',
      active: 1,
      pending: 0,
      role_ids: '[]',
    },
  ];
  await page.route('**/api/c/center-a/roles?*', (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 12 }, (_, index) => ({
          id: `role-${index}`,
          name: `Long teaching and classroom coordination role ${index + 1}`,
          permissions: ['students.read'],
          version: 1,
        })),
        next: null,
      },
    }),
  );
  await page.goto('/exams');
  await expect(page.locator('.exam-record')).toBeVisible();
  await expect(page.locator('.exam-record a button')).toHaveCount(0);
  const examBox = await page.locator('.exam-record').boundingBox();
  if (!examBox) throw new Error('Missing exam row');
  expect(examBox.height).toBeLessThan(140);
  const titleColor = await page
    .locator('.exam-record strong')
    .evaluate((element) => getComputedStyle(element).color);
  await page.screenshot({ path: info.outputPath('compact-exam-list.png'), fullPage: true });
  await page.goto('/students');
  await expect(page.locator('.record-row strong').first()).toHaveCSS('color', titleColor);
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Staff', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
  await expect(page.locator('.staff-headline .badge')).toHaveCount(3);
  const phonesFit = await page
    .locator('.staff-phone')
    .evaluateAll((phones) => phones.every((phone) => phone.scrollWidth <= phone.clientWidth));
  expect(phonesFit).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('staff-rows.png'), fullPage: true });
  await page.getByRole('button', { name: `Edit staff access ${name}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit staff access', exact: true });
  await expect(edit.locator('.member-summary')).toContainText(name);
  await expect(edit.getByRole('group', { name: 'Roles', exact: true })).toBeVisible();
  await expect(
    edit.getByRole('checkbox', { name: /Long teaching.*role 1$/, exact: false }),
  ).toBeChecked();
  await page.setViewportSize({ width: 320, height: 480 });
  await edit.getByRole('checkbox', { name: /^Allow center access/ }).uncheck();
  const save = edit.getByRole('button', { name: 'Save access', exact: true });
  await save.scrollIntoViewIfNeeded();
  const modalBox = await edit.boundingBox();
  const cancelBox = await edit.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
  const saveBox = await save.boundingBox();
  if (!modalBox || !cancelBox || !saveBox) throw new Error('Missing staff dialog geometry');
  expect(modalBox.width).toBeLessThanOrEqual(320);
  expect(modalBox.height).toBeLessThanOrEqual(480);
  expect(cancelBox.x).toBeLessThan(saveBox.x);
  expect(Math.abs(cancelBox.y - saveBox.y)).toBeLessThan(2);
  await page.screenshot({ path: info.outputPath('staff-access-short-screen.png') });
  await save.click();
  await expect(edit).toHaveCount(0);
  expect(control.writes.at(-1)?.body).toEqual({ active: false, role_ids: ['role-0'] });
  await expect(
    page.locator('.staff-row').filter({ hasText: name }).getByText('Suspended', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite staff', exact: true });
  await expect(invite).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(invite).toHaveCount(0);
  await page.getByRole('button', { name: 'বাংলা', exact: true }).click();
  await page.getByRole('button', { name: `কর্মীর অনুমতি ${name}`, exact: true }).click();
  const translated = page.getByRole('dialog');
  await expect(translated).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await translated.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(
    true,
  );
  const modalAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(modalAccessibility.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('staff-access-bangla.png') });
  await page.keyboard.press('Escape');
  await expect(translated).toHaveCount(0);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  control.platform = true;
  control.noCenters = true;
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Platform', exact: true })).toBeVisible();
  const controls = await page.locator('.account-controls').boundingBox();
  if (!controls) throw new Error('Missing platform controls');
  expect(controls.height).toBeLessThanOrEqual(48);
  expect(controls.width).toBeLessThanOrEqual(288);
  await expect(page.getByText('Suspend before deleting.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Delete center First Coaching', exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('platform-compact-header.png'), fullPage: true });
});

test('archived exams are discoverable with explicit archive and restore actions instead of an edit checkbox', async ({
  page,
}, info) => {
  const control = await fixture(page);
  const exams = [
    {
      id: 'inactive-a',
      name: 'Inactive fixture exam',
      exam_date: '2026-10-24',
      active: 0,
      version: 1,
    },
    { id: 'active-a', name: 'Active fixture exam', exam_date: '2026-10-23', active: 1, version: 1 },
  ];
  await page.route('**/api/c/center-a/exams?*', async (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    await route.fulfill({
      json: {
        items: exams.filter(
          (exam) => status === 'all' || exam.active === (status === 'inactive' ? 0 : 1),
        ),
        next: null,
      },
    });
  });
  await page.route('**/api/c/center-a/exams/inactive-a', async (route) => {
    if (route.request().method() === 'PATCH') {
      const exam = exams.find((item) => item.id === 'inactive-a');
      if (!exam) throw new Error('Missing fixture exam');
      exam.active = Number((route.request().postDataJSON() as { active: boolean }).active);
      exam.version++;
      return route.fallback();
    }
    await route.fulfill({ json: { ...exams[0], papers: [], participants: 0, groups: [] } });
  });
  await page.goto('/exams');
  const filters = page.getByRole('group', { name: 'Exam status', exact: true });
  await expect(filters.getByRole('button', { name: 'All exams', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('Inactive fixture exam', { exact: true })).toBeVisible();
  await filters.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(page).toHaveURL(/status=inactive/);
  await expect(page.getByText('Active fixture exam', { exact: true })).toHaveCount(0);
  await page
    .locator('.exam-record .record-row-content')
    .filter({ hasText: 'Inactive fixture exam' })
    .click();
  await page.goBack();
  await expect(filters.getByRole('button', { name: 'Archived', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Restore Inactive fixture exam', exact: true }).click();
  expect(control.writes).toHaveLength(0);
  await page
    .getByRole('dialog', { name: 'Restore exam' })
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'No archived exams', exact: true })).toBeVisible();
  expect(control.writes.at(-1)?.body).toMatchObject({
    active: true,
    version: 1,
    name: 'Inactive fixture exam',
  });
  await filters.getByRole('button', { name: 'Current', exact: true }).click();
  await expect(page.getByText('Inactive fixture exam', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Archive Inactive fixture exam', exact: true }).click();
  const archive = page.getByRole('dialog', { name: 'Archive exam' });
  await expect(archive).toContainText('marks and history are kept');
  await archive.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(control.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Archive Inactive fixture exam', exact: true }).click();
  await archive.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Inactive fixture exam', { exact: true })).toHaveCount(0);
  expect(control.writes.at(-1)?.body).toMatchObject({ active: false, version: 2 });
  await filters.getByRole('button', { name: 'Archived', exact: true }).click();
  await page
    .locator('.exam-record .record-row-content')
    .filter({ hasText: 'Inactive fixture exam' })
    .click();
  await expect(page.getByRole('link', { name: 'Send results', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Edit', exact: true }).getByRole('checkbox'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('exam-status-filters.png'), fullPage: true });
});

test('staff can edit their own profile without seeing center administration or redundant preferences', async ({
  page,
}, info) => {
  const control = await fixture(page);
  control.admin = false;
  await page.goto('/settings');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Audit Teacher');
  await expect(page.getByLabel('Center name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Language', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Timezone', { exact: true })).toHaveCount(0);
  await page.getByLabel('Display name', { exact: true }).fill('My chosen full name');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByText('Your name has been updated.', { exact: true })).toBeVisible();
  await expect(page.locator('.user-avatar')).toHaveAttribute('title', 'My chosen full name');
  expect(control.writes.find((write) => write.path === '/api/auth/profile')?.body).toEqual({
    name: 'My chosen full name',
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Welcome back, My chosen full name', exact: true }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toHaveValue('My chosen full name');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('personal-settings.png'), fullPage: true });
});

test('staff invitations have one self-owned name and center-scoped removal with readable roles', async ({
  page,
}, info) => {
  const control = await fixture(page);
  control.staff = [
    {
      id: 'staff-a',
      name: 'Chosen teacher name',
      phone: '88017000000011',
      active: 1,
      pending: 0,
      role_ids: '[]',
    },
    { id: 'staff-b', name: '', phone: '88017000000012', active: 0, pending: 1, role_ids: '[]' },
  ];
  await page.goto('/staff');
  await expect(page.getByText('Invited', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite staff', exact: true });
  await expect(invite.getByLabel('Name', { exact: true })).toHaveCount(0);
  await invite.getByLabel('Phone number', { exact: true }).fill('01700000013');
  await invite.getByRole('button', { name: 'Invite staff', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Invitation link', exact: true })).toBeVisible();
  const sent = control.writes.find((write) => write.path.endsWith('/staff/invite'));
  expect(sent?.body).toEqual({ phone: '01700000013', role_ids: [] });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Remove from center Chosen teacher name', exact: true })
    .click();
  const removal = page.getByRole('dialog', { name: 'Remove from center', exact: true });
  await expect(removal).toContainText('historical records are kept');
  await removal.getByRole('button', { name: 'Remove from center', exact: true }).click();
  await expect(page.getByText('Chosen teacher name', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create role', exact: true }).click();
  const role = page.getByRole('dialog', { name: 'Create role', exact: true });
  await expect(role.getByText('Academic', { exact: true })).toHaveCount(0);
  await expect(role.getByText('Sending & sensitive actions', { exact: true })).toHaveCount(0);
  await role
    .getByRole('group', { name: 'Marks & results', exact: true })
    .getByLabel('Update', { exact: true })
    .check();
  await expect(
    role.getByRole('group', { name: 'Exams', exact: true }).getByLabel('Read', { exact: true }),
  ).toBeChecked();
  await expect(
    role
      .getByRole('group', { name: 'Marks & results', exact: true })
      .getByLabel('Read', { exact: true }),
  ).toBeChecked();
  await role
    .getByRole('group', { name: 'Exams', exact: true })
    .getByLabel('Read', { exact: true })
    .uncheck();
  await expect(
    role
      .getByRole('group', { name: 'Marks & results', exact: true })
      .getByLabel('Update', { exact: true }),
  ).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('role-editor.png'), fullPage: true });
});

test('platform reload never flashes a coaching sidebar and center creation omits admin name and timezone', async ({
  page,
}, info) => {
  const control = await fixture(page);
  control.platform = true;
  control.noCenters = true;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/session', async (route) => {
    await gate;
    await route.fallback();
  });
  await page.goto('/');
  await expect(page.locator('.session-loading')).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Coaching centers', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create center', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Create center', exact: true });
  await expect(form.getByLabel('Admin name', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Timezone', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Center name', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Phone number', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible();
  if (info.project.use.isMobile) {
    const heading = await page.locator('.account-header h1').boundingBox();
    if (!heading) throw new Error('Missing account heading');
    expect(heading.width).toBeGreaterThan(250);
  }
  await page.screenshot({ path: info.outputPath('platform-settings.png'), fullPage: true });
});

test('expired delivery checks stop dashboard polling and final delivery counters refresh message badges', async ({
  page,
}) => {
  await fixture(page, ['messages.read_content']);
  let checking = 1;
  let delivered = 0;
  let reads = 0;
  const campaign = () => ({
    id: 'campaign-a',
    name: 'Delivery fixture',
    state: 'completed',
    total: 1,
    submitted: 1,
    delivered,
    failed: 0,
    unknown: 0,
    skipped: 0,
    excluded: 0,
    delivery_checking: checking,
    delivery_unconfirmed: checking || delivered ? 0 : 1,
  });
  await page.route('**/api/c/center-a/campaigns/campaign-a', async (route) => {
    reads++;
    await route.fulfill({ json: campaign() });
  });
  await page.route('**/api/c/center-a/campaigns/campaign-a/messages?*', async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'message-a',
            student_name: 'Teacher fixture',
            phone: '8801700000011',
            body: 'Fixture message',
            segments: 1,
            state: delivered ? 'delivered' : 'accepted',
          },
        ],
        next: null,
      },
    });
  });
  await page.clock.install();
  await page.goto('/messages/campaign-a');
  await expect(page.getByRole('heading', { name: 'Delivery fixture' })).toBeVisible();
  checking = 0;
  await page.clock.fastForward(61000);
  await expect(page.getByText(/Automatic checks have ended/)).toBeVisible();
  const stopped = reads;
  await page.clock.fastForward(180000);
  expect(reads).toBe(stopped);
  checking = 1;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Delivery fixture' })).toBeVisible();
  checking = 0;
  delivered = 1;
  await page.clock.fastForward(61000);
  await expect(page.locator('.message-card .badge')).toHaveText('Delivered');
});

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
    page.getByRole('heading', { name: 'Welcome back, Audit Teacher', exact: true }),
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
  ).toHaveCount(0);
  await expect(page.getByText('Suspend before deleting.', { exact: true })).toBeVisible();
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
  await expect(review).toContainText('Bangladesh time (UTC+6)');
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
      await expect(page.locator('.session-loading')).toBeVisible();
      await expect(page.locator('.sidebar')).toHaveCount(0);
      if (path === '/staff') await page.screenshot({ path: info.outputPath('startup.png') });
      session.release();
      await expect.poll(() => contextRequested).toBe(true);
      await expect(page.locator('.workspace-loading')).toBeVisible();
      const initial = await page.locator('.page-loading').boundingBox();
      await expect(page.getByRole('heading', { name: /Welcome back/ })).not.toBeVisible();
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
  await page
    .locator('.exam-record .record-row-content')
    .filter({ hasText: 'Demo Exam - 1' })
    .click();
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

test('concurrent marks edits preserve legacy results until explicitly replaced with a score', async ({
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
  await expect(page.getByLabel('Result status for Ayesha')).toHaveValue('scored');
  await expect(score).toBeEnabled();
  await expect(score).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save marks', exact: true })).toBeDisabled();
  expect(control.markStatus).toBe('exempt');
  await expect(page.getByLabel('Result status for Ayesha').locator('option')).toHaveText([
    'Scored',
    'Absent',
  ]);
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
  await expect(page.getByText('Demo Exam - 1', { exact: true })).toBeVisible();
  const count = control.reads.filter((path) => path.endsWith('/exams')).length;
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back, Audit Teacher', exact: true }),
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
  await expect(page.getByText('Demo Exam - 1', { exact: true })).toBeVisible();
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
    page.getByRole('heading', { name: 'Welcome back, Audit Teacher', exact: true }),
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
    page.getByRole('heading', { name: 'Welcome back, Audit Teacher', exact: true }),
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
    page.getByRole('heading', { name: 'Welcome back, Audit Teacher', exact: true }),
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
