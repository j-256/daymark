import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import type { Operation, Tracker } from "../../src/shared/model";

const PASSWORD = "local-browser-test-password-123!";
const ORIGIN = "http://localhost:5184";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
async function owner(request: APIRequestContext) {
  const status = await request.get("/api/admin/bootstrap");
  if ((await status.json()).setupRequired)
    expect(
      (
        await request.post("/api/admin/bootstrap", {
          headers: { Origin: ORIGIN },
          data: { name: "Owner", password: PASSWORD },
        })
      ).ok(),
    ).toBeTruthy();
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers: { Origin: ORIGIN },
        data: { email: "owner@example.com", password: PASSWORD },
      })
    ).ok(),
  ).toBeTruthy();
}
async function newAccount(request: APIRequestContext) {
  await owner(request);
  const email = `browser-${crypto.randomUUID()}@example.com`;
  const response = await request.post("/api/admin/accounts", {
    headers: { Origin: ORIGIN },
    data: { email, name: "Browser test", password: PASSWORD },
  });
  expect(response.status()).toBe(201);
  return email;
}
async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}
async function createTracker(page: Page, name = "Morning pills") {
  await page.getByRole("button", { name: "Add tracker", exact: true }).first().click();
  await page.getByLabel("Tracker name").fill(name);
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
  await expect(page.locator(".log-row").filter({ hasText: name })).toBeVisible();
}
const quick = (page: Page, name: string) =>
  page.locator(".log-row").filter({ hasText: name }).locator(".status-button");
async function client(
  browser: Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}
test("one-tap confirmation, Undo, and the weekly status cycle", async ({ page, request }) => {
  const email = await newAccount(request);
  await signIn(page, email);
  await createTracker(page);
  await quick(page, "Morning pills").click();
  await expect(quick(page, "Morning pills")).toHaveAttribute("data-state", "confirmed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(quick(page, "Morning pills")).toHaveAttribute("data-state", "unknown");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  const cell = page.locator(`.week-row .day-cell[data-day="${today()}"]`).first();
  for (const state of ["confirmed", "skipped", "unknown"]) {
    await cell.click();
    await expect(cell).toHaveAttribute("data-state", state);
  }
});

test("retains offline edits across reload and merges another device's records", async ({
  browser,
  request,
}) => {
  const email = await newAccount(request);
  const a = await client(browser, email);
  await createTracker(a.page, "Pills");
  await createTracker(a.page, "Shower");
  await expect(a.page.getByTestId("sync-status")).toHaveText(/Synced/);
  const b = await client(browser, email);
  await expect(quick(b.page, "Shower")).toBeVisible();
  await a.page.evaluate(() => navigator.serviceWorker.ready);
  await a.context.setOffline(true);
  await quick(a.page, "Pills").click();
  await expect(quick(a.page, "Pills")).toHaveAttribute("data-state", "confirmed");
  await a.page.reload();
  await expect(quick(a.page, "Pills")).toHaveAttribute("data-state", "confirmed");
  await quick(b.page, "Shower").click();
  await expect(quick(b.page, "Shower")).toHaveAttribute("data-state", "confirmed");
  await expect(b.page.getByTestId("sync-status")).toHaveText(/Synced/);
  await a.context.setOffline(false);
  await expect(quick(a.page, "Shower")).toHaveAttribute("data-state", "confirmed");
  await expect(quick(a.page, "Pills")).toHaveAttribute("data-state", "confirmed");
  await b.page.reload();
  await expect(quick(b.page, "Pills")).toHaveAttribute("data-state", "confirmed");
  await a.context.close();
  await b.context.close();
});

test("preserves conflicting same-entry edits and resolves them explicitly", async ({
  browser,
  request,
}) => {
  const email = await newAccount(request);
  const a = await client(browser, email);
  await createTracker(a.page, "Pills");
  await expect(a.page.getByTestId("sync-status")).toHaveText(/Synced/);
  const b = await client(browser, email);
  await expect(quick(b.page, "Pills")).toBeVisible();
  await a.context.setOffline(true);
  await quick(a.page, "Pills").click();
  await b.page.getByRole("button", { name: "Weeks", exact: true }).click();
  const cell = b.page.locator(`.week-row .day-cell[data-day="${today()}"]`).first();
  await cell.click();
  await expect(cell).toHaveAttribute("data-state", "confirmed");
  await cell.click();
  await expect(cell).toHaveAttribute("data-state", "skipped");
  await expect(b.page.getByTestId("sync-status")).toHaveText(/Synced/);
  await a.context.setOffline(false);
  await expect(a.page.getByRole("button", { name: /Review.*conflict/i })).toBeVisible();
  await a.page.getByRole("button", { name: /Review.*conflict/i }).click();
  await a.page.getByRole("button", { name: "Keep confirmed", exact: true }).click();
  await expect(quick(a.page, "Pills")).toHaveAttribute("data-state", "confirmed");
  await expect(a.page.getByRole("button", { name: /Review.*conflict/i })).toHaveCount(0);
  await a.context.close();
  await b.context.close();
});

test("uses system dark mode, supports explicit themes, and fits narrow screens", async ({
  page,
  request,
}) => {
  const email = await newAccount(request);
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page, email);
  await createTracker(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Appearance").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Appearance").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    const dimensions = await page.locator(".day-cell").first().boundingBox();
    expect(dimensions?.width).toBeGreaterThanOrEqual(44);
    expect(dimensions?.height).toBeGreaterThanOrEqual(44);
  }
});

test("keeps named slots and extra occurrence notes in day history", async ({ page, request }) => {
  const email = await newAccount(request);
  await signIn(page, email);
  await createTracker(page, "Shower");
  await page.locator(".log-row").filter({ hasText: "Shower" }).locator(".item-copy").click();
  await expect(page.getByRole("dialog", { name: "Shower", exact: true })).toBeVisible();
  await expect(page.getByLabel("Date", { exact: true })).toHaveAttribute("readonly", "");
  await page.getByLabel("Log an extra occurrence").check();
  await page.getByLabel("Notes", { exact: true }).fill("After swimming");
  await page.getByRole("button", { name: "Log occurrence", exact: true }).click();
  await page.locator(".log-row").filter({ hasText: "Shower" }).locator(".item-copy").click();
  await expect(page.getByText("After swimming", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete extra occurrence", exact: true }).click();
  await expect(page.getByText("After swimming", { exact: true })).toHaveCount(0);
});

test("isolates local history when switching app accounts", async ({ page, request }) => {
  const a = await newAccount(request);
  const b = await newAccount(request);
  await signIn(page, a);
  await createTracker(page, "Private A tracker");
  await expect(page.getByTestId("sync-status")).toHaveText(/Synced/);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await signIn(page, b);
  await expect(page.getByText("Private A tracker", { exact: true })).toHaveCount(0);
  await createTracker(page, "Private B tracker");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await signIn(page, a);
  await expect(quick(page, "Private A tracker")).toBeVisible();
  await expect(page.getByText("Private B tracker", { exact: true })).toHaveCount(0);
});

function fixtureTracker(name: string, schedule: Tracker["schedule"] = "daily"): Operation {
  return {
    id: crypto.randomUUID(),
    kind: "tracker",
    key: crypto.randomUUID(),
    parents: [],
    createdAt: new Date().toISOString(),
    value: {
      name,
      category: "Home",
      schedule,
      slots: [{ id: "default", name: "Morning", time: "08:00" }],
      weekdays: [],
      pinned: true,
      archived: false,
      order: 1,
    },
  };
}
async function seed(page: Page, operations: Operation[]) {
  const status = await page.evaluate(async (operations) => {
    const { account } = (await (await fetch("/api/session")).json()) as { account: { id: string } };
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Daymark-Account": account.id },
      body: JSON.stringify({ operations }),
    });
    window.dispatchEvent(new Event("focus"));
    return response.status;
  }, operations);
  expect(status).toBe(200);
}
test("counts an earlier completion toward an any-day weekly chore", async ({ page, request }) => {
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00"));
  await signIn(page, await newAccount(request));
  const tracker = fixtureTracker("Change sheets", "weekly");
  await seed(page, [
    tracker,
    {
      id: crypto.randomUUID(),
      kind: "entry",
      key: `${tracker.key}/2026-10-19/default`,
      parents: [],
      createdAt: new Date().toISOString(),
      value: { state: "confirmed", note: "", occurredAt: "2026-10-19T08:00:00Z" },
    },
  ]);
  await expect(quick(page, "Change sheets")).toHaveAttribute("data-state", "confirmed");
  await expect(page.locator(".summary strong")).toHaveText("1/1");
});
test("lets the owner of a tracker change its quick-list order", async ({ page, request }) => {
  await signIn(page, await newAccount(request));
  await createTracker(page, "First");
  await createTracker(page, "Second");
  await page.getByRole("button", { name: "Trackers", exact: true }).click();
  await page.getByRole("button", { name: "Edit Second", exact: true }).click();
  await page.getByLabel("Quick-list order", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".log-row").first()).toContainText("Second");
});
test("shows times and slot identity before choosing a conflicting entry", async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00"));
  await signIn(page, await newAccount(request));
  const tracker = fixtureTracker("Pills");
  const versions = ["2026-10-24T08:00:00.000Z", "2026-10-24T09:00:00.000Z"].map((occurredAt) => ({
    id: crypto.randomUUID(),
    kind: "entry" as const,
    key: `${tracker.key}/2026-10-24/default`,
    parents: [],
    createdAt: new Date().toISOString(),
    value: { state: "confirmed" as const, note: "", occurredAt },
  }));
  await seed(page, [tracker, ...versions]);
  await page.getByRole("button", { name: /Review.*conflict/i }).click();
  await expect(page.getByRole("dialog")).toContainText("Morning");
  for (const op of versions)
    await expect(page.locator(`time[datetime="${op.value.occurredAt}"]`)).toBeVisible();
});
test("shows competing slot settings before choosing a tracker version", async ({
  page,
  request,
}) => {
  await signIn(page, await newAccount(request));
  const first = fixtureTracker("Pills");
  const second = {
    ...first,
    id: crypto.randomUUID(),
    value: {
      ...(first.value as Tracker),
      slots: [{ id: "default", name: "Evening", time: "20:00" }],
    },
  };
  await seed(page, [first, second]);
  await page.getByRole("button", { name: /Review.*conflict/i }).click();
  await expect(page.getByRole("dialog")).toContainText("08:00");
  await expect(page.getByRole("dialog")).toContainText("20:00");
});

test("preserves an existing instant when saving only a note", async ({ page, request }) => {
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00"));
  await signIn(page, await newAccount(request));
  const tracker = fixtureTracker("Pills");
  const original = "2026-10-23T22:30:42.123Z";
  await seed(page, [
    tracker,
    {
      id: crypto.randomUUID(),
      kind: "entry",
      key: `${tracker.key}/2026-10-24/default`,
      parents: [],
      createdAt: new Date().toISOString(),
      value: { state: "confirmed", note: "", occurredAt: original },
    },
  ]);
  await page.locator(".log-row").filter({ hasText: "Pills" }).locator(".item-copy").click();
  await page.getByLabel("Notes", { exact: true }).fill("Only the note changed");
  const upload = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/sync" &&
      request.postData()?.includes("Only the note changed") === true,
  );
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  const body = (await upload).postDataJSON() as { operations: Operation[] };
  expect(
    body.operations.find((op) => "note" in op.value && op.value.note === "Only the note changed")
      ?.value,
  ).toMatchObject({ occurredAt: original });
});

test("opens weekly day details directly and shows notes and tracker extras once", async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00"));
  await signIn(page, await newAccount(request));
  const tracker = fixtureTracker("Pills");
  (tracker.value as Tracker).slots = [
    { id: "morning", name: "Morning", time: "08:00" },
    { id: "evening", name: "Evening", time: "20:00" },
  ];
  const entry = (slot: string, day: string, note: string): Operation => ({
    id: crypto.randomUUID(),
    kind: "entry",
    key: `${tracker.key}/${day}/${slot}`,
    parents: [],
    createdAt: new Date().toISOString(),
    value: { state: "confirmed", occurredAt: null, note },
  });
  await seed(page, [
    tracker,
    entry("morning", "2026-10-24", "After breakfast"),
    entry("evening", "2026-10-23", "After dinner"),
    {
      id: crypto.randomUUID(),
      kind: "event",
      key: crypto.randomUUID(),
      parents: [],
      createdAt: new Date().toISOString(),
      value: {
        trackerId: tracker.key,
        day: "2026-10-24",
        occurredAt: null,
        note: "After swimming",
        deleted: false,
      },
    },
  ]);
  await seed(page, [
    {
      ...tracker,
      id: crypto.randomUUID(),
      parents: [tracker.id],
      value: {
        ...(tracker.value as Tracker),
        slots: [{ id: "morning", name: "Morning", time: "08:00" }],
      },
    },
  ]);
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await expect(page.locator('.day-cell[data-day="2026-10-24"] [data-extra-count="1"]')).toHaveCount(
    1,
  );
  await expect(
    page.locator('.day-cell[data-day="2026-10-24"][aria-label*="has note"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Details for Pills / Morning", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("After breakfast");
  await expect(page.getByRole("dialog")).toContainText("After swimming");
  await page.getByLabel("History date", { exact: true }).fill("2026-10-23");
  await expect(page.getByRole("dialog")).toContainText("After dinner");
  await expect(page.getByRole("dialog")).toContainText("Retired slot");
  await page.getByLabel("History date", { exact: true }).fill("2026-10-25");
  await expect(page.getByLabel("History date", { exact: true })).toHaveValue("2026-10-23");
  await expect(page.getByRole("dialog")).not.toContainText("After swimming");
  await page.getByRole("button", { name: "Edit Evening", exact: true }).click();
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2026-10-23");
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Dinner note updated");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByLabel("History date", { exact: true })).toHaveValue("2026-10-23");
  await expect(page.getByRole("dialog")).toContainText("Dinner note updated");
});
