import { expect, type Page, test } from "@playwright/test";

async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "All settings...", exact: true }).click();
}
async function tracker(page: Page, name: string) {
  await page.getByRole("button", { name: "Add tracker", exact: true }).first().click();
  await page.getByLabel("Tracker name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
  await expect(page.locator(".log-row").filter({ hasText: name })).toBeVisible();
}

test("local tracking makes no API calls on startup, writes, idle, focus, or reconnect", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByTestId("local-status")).toHaveText("On this device");
  await tracker(page, "Local pills");
  const status = page
    .locator(".log-row")
    .filter({ hasText: "Local pills" })
    .locator(".status-button");
  await status.click();
  await expect(status).toHaveAttribute("data-state", "confirmed");
  await page.clock.runFor(61000);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await settings(page);
  await expect(page.getByRole("button", { name: "Export backup", exact: true })).toBeEnabled();
  expect(requests).toEqual([]);
});

test("cached public navigation stays on device and local history survives offline reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await tracker(page, "Offline chore");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const serverNavigations: string[] = [];
  await context.route("**/*", (route) => {
    if (route.request().isNavigationRequest()) serverNavigations.push(route.request().url());
    return route.continue();
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  expect(serverNavigations).toEqual([]);
  await context.setOffline(true);
  await page.reload();
  const status = page
    .locator(".log-row")
    .filter({ hasText: "Offline chore" })
    .locator(".status-button");
  await status.click();
  await expect(status).toHaveAttribute("data-state", "confirmed");
  await page.reload();
  await expect(status).toHaveAttribute("data-state", "confirmed");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await expect(page.locator(".week-row").filter({ hasText: "Offline chore" })).toBeVisible();
  await settings(page);
  await expect(page.getByRole("button", { name: "Export backup", exact: true })).toBeEnabled();
  await context.setOffline(false);
  await page.goto("/admin");
  expect(serverNavigations.some((url) => new URL(url).pathname === "/admin")).toBe(true);
});

test("exports local history and restores it into a fresh browser without an account", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await tracker(page, "Portable chore");
  await page
    .locator(".log-row")
    .filter({ hasText: "Portable chore" })
    .locator(".status-button")
    .click();
  await settings(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Backup download is unavailable");
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto("/");
    await settings(other);
    await other.getByLabel("Import backup", { exact: true }).setInputFiles(path);
    await expect(other.getByRole("status")).toHaveText("2 edits imported");
    await other.getByLabel("Import backup", { exact: true }).setInputFiles(path);
    await expect(other.getByRole("status")).toHaveText("0 edits imported");
    await other.getByRole("button", { name: "Today", exact: true }).click();
    await expect(
      other.locator(".log-row").filter({ hasText: "Portable chore" }).locator(".status-button"),
    ).toHaveAttribute("data-state", "confirmed");
  } finally {
    await context.close();
  }
});

test("keeps local and invited account history separate until an explicit backup import", async ({
  page,
  request,
}) => {
  const password = "local-browser-test-password-123!";
  const headers = { Origin: "http://localhost:5184" };
  if ((await (await request.get("/api/admin/bootstrap")).json()).setupRequired)
    expect(
      (
        await request.post("/api/admin/bootstrap", { headers, data: { name: "Owner", password } })
      ).ok(),
    ).toBe(true);
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        headers,
        data: { email: "owner@example.com", password },
      })
    ).ok(),
  ).toBe(true);
  const email = `local-transition-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await request.post("/api/admin/accounts", {
        headers,
        data: { email, name: "Invited user", password },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await tracker(page, "Local only");
  await settings(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Backup download is unavailable");
  await page.getByRole("button", { name: "Sign in for sync", exact: true }).first().click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await expect(page.locator(".log-row")).toHaveCount(0);
  await tracker(page, "Account only");
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await settings(page);
  await page.getByLabel("Import backup", { exact: true }).setInputFiles(path);
  await expect(page.getByRole("alert")).toContainText("another workspace");
  await page.getByLabel("Import from another workspace", { exact: true }).check();
  await page.getByLabel("Import backup", { exact: true }).setInputFiles(path);
  await expect(page.getByRole("status")).toHaveText("1 edits imported");
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".log-row")).toHaveCount(2);
  await settings(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("local-status")).toBeVisible();
  await expect(page.locator(".log-row").filter({ hasText: "Local only" })).toBeVisible();
  await expect(page.locator(".log-row").filter({ hasText: "Account only" })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".log-row")).toHaveCount(1);
  const paths = await page.evaluate(async () => {
    const entries = await Promise.all(
      (await caches.keys()).map(async (key) =>
        (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname),
      ),
    );
    return entries.flat();
  });
  expect(paths.some((path) => path.startsWith("/api/") || path.startsWith("/admin"))).toBe(false);
});
