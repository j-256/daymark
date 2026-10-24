import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

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
