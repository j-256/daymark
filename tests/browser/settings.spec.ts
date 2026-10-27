import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const ORIGIN = "http://localhost:5184";
const PASSWORD = "local-browser-test-password-123!";
async function signIn(page: Page, request: APIRequestContext) {
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
  const email = `settings-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await request.post("/api/admin/accounts", {
        headers: { Origin: ORIGIN },
        data: { email, name: "Settings test", password: PASSWORD },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in for sync", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  return email;
}
const gear = (page: Page) => page.getByRole("button", { name: "Settings", exact: true });
const popup = (page: Page) => page.getByRole("dialog", { name: "Quick settings", exact: true });
async function chooseLayout(page: Page, value: string) {
  await gear(page).click();
  await popup(page).getByRole("combobox", { name: "Layout", exact: true }).selectOption(value);
  await page.keyboard.press("Escape");
}

test("quick settings changes appearance and opens all settings with keyboard and outside dismissal", async ({
  page,
  request,
}) => {
  await signIn(page, request);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toHaveCount(0);
  await gear(page).click();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(popup(page)).not.toBeVisible();
  await expect(gear(page)).toBeFocused();
  await gear(page).click();
  await page.getByRole("heading", { name: "Today", exact: true }).click();
  await expect(popup(page)).not.toBeVisible();
  await gear(page).click();
  await popup(page).getByRole("button", { name: "All settings...", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("dark");
  await expect(page.getByRole("combobox", { name: "Layout", exact: true })).toHaveValue("auto");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("compact and wide override real arrangements and Automatic follows resize", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, request);
  await page.getByRole("button", { name: "Add tracker", exact: true }).first().click();
  await page.getByLabel("Tracker name", { exact: true }).fill("Layout tracker");
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await expect(page.locator(".week-row").first()).toHaveCSS("display", "grid");
  await chooseLayout(page, "compact");
  await expect(page.locator(".app")).toHaveCSS("width", "390px");
  await expect(page.locator(".week-row").first()).toHaveCSS("display", "block");
  await page.getByRole("button", { name: /Details for Layout tracker/ }).click();
  await expect(page.getByRole("dialog")).toHaveCSS("width", "390px");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.locator(".app")).toHaveCSS("width", "390px");
  await page.setViewportSize({ width: 320, height: 740 });
  await chooseLayout(page, "wide");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await expect(page.locator(".week-row").first()).toHaveCSS("display", "grid");
  await expect(page.locator(".view-content")).toHaveCSS("min-width", "900px");
  const bounds = await gear(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.locator("main.view").evaluate((element) => {
    element.scrollLeft = 400;
  });
  await expect
    .poll(() => page.locator("main.view").evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await gear(page).click();
  await popup(page).getByRole("button", { name: "All settings...", exact: true }).click();
  await expect
    .poll(() => page.locator("main.view").evaluate((element) => element.scrollLeft))
    .toBe(0);
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await chooseLayout(page, "auto");
  await expect(page.locator(".week-row").first()).toHaveCSS("display", "block");
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator(".week-row").first()).toHaveCSS("display", "grid");
});

test("quick sync uses the existing account and disables offline without blocking preferences", async ({
  page,
  request,
  context,
}) => {
  await signIn(page, request);
  await expect(page.getByTestId("sync-status")).toHaveText(/Synced/);
  await gear(page).click();
  const pull = page.waitForRequest(
    (request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/sync",
  );
  await popup(page).getByRole("button", { name: "Sync now", exact: true }).click();
  expect((await pull).headers()["x-daymark-account"]).toBeTruthy();
  await expect(page.getByTestId("sync-status")).toHaveText(/Synced/);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await gear(page).click();
  await expect(popup(page).getByRole("button", { name: "Sync now", exact: true })).toBeDisabled();
  await popup(page).getByRole("combobox", { name: "Layout", exact: true }).selectOption("compact");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "compact");
});

test("invalid preferences fall back to Automatic and guest controls stay available by keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("daymark-layout", "invalid"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-layout", "auto");
  await gear(page).focus();
  await page.keyboard.press("Enter");
  await expect(popup(page)).toBeVisible();
  await expect(gear(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(
    popup(page).getByRole("combobox", { name: "Appearance", exact: true }),
  ).toBeFocused();
  await expect(popup(page).getByRole("button", { name: "Sync now", exact: true })).toBeDisabled();
  await expect(
    popup(page).getByRole("button", { name: "All settings...", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(gear(page)).toHaveAttribute("aria-expanded", "false");
});

test("All settings leaves the admin route for the full app settings", async ({ page, request }) => {
  await signIn(page, request);
  await page.goto("/admin");
  await gear(page).click();
  await popup(page).getByRole("button", { name: "All settings...", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${ORIGIN}/#settings`);
});

test("preserves account deep links on reload and updates the route on account switches", async ({
  page,
  request,
}) => {
  const email = await signIn(page, request);
  await expect(page).toHaveURL(`${ORIGIN}/#today`);
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/#weeks`);
  await page.reload();
  await expect(page.locator("main.view")).toHaveAttribute("id", "weeks");
  await expect(page).toHaveURL(`${ORIGIN}/#weeks`);
  await gear(page).click();
  await popup(page).getByRole("button", { name: "All settings...", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("local-status")).toBeVisible();
  await expect(page).toHaveURL(`${ORIGIN}/#today`);
  await gear(page).click();
  await popup(page).getByRole("button", { name: "All settings...", exact: true }).click();
  await page.getByRole("button", { name: "Sign in for sync", exact: true }).first().click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await expect(page.locator("main.view")).toHaveAttribute("id", "today");
  await expect(page).toHaveURL(`${ORIGIN}/#today`);
});
