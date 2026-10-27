import { expect, type Page, test } from "@playwright/test";

const views = ["today", "weeks", "patterns", "inventory", "trackers", "settings"] as const;
async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "All settings...", exact: true }).click();
}
async function view(page: Page, name: (typeof views)[number]) {
  await expect(page.locator("main.view")).toHaveAttribute("id", name);
  await expect(page).toHaveURL(new RegExp(`#${name}$`));
}

for (const name of views) {
  test(`keeps the ${name} direct link through startup and reload`, async ({ page }) => {
    await page.goto(`/?source=review#${name}`);
    await view(page, name);
    await page.reload();
    await view(page, name);
    expect(new URL(page.url()).search).toBe("?source=review");
  });
}

test("updates every navigation entry point without guest API calls", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
  });
  await page.goto("/?source=review");
  await view(page, "today");
  for (const name of ["Weeks", "Patterns", "Inventory", "Trackers", "Today"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await view(page, name.toLowerCase() as (typeof views)[number]);
  }
  await settings(page);
  await view(page, "settings");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByTestId("local-status").click();
  await view(page, "settings");
  expect(new URL(page.url()).search).toBe("?source=review");
  expect(requests).toEqual([]);
});

test("updates URLs from backup and low-stock shortcuts", async ({ page }) => {
  await page.goto("/#today");
  await view(page, "today");
  await page.getByRole("button", { name: "Add tracker", exact: true }).first().click();
  await page.getByLabel("Tracker name", { exact: true }).fill("Navigation chore");
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
  await page.getByRole("button", { name: "Back up", exact: true }).click();
  await view(page, "settings");
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add medication", exact: true }).click();
  await page.getByLabel("Medication name", { exact: true }).fill("Navigation supply");
  await page.getByLabel("Quantity on hand", { exact: true }).fill("1");
  await page.getByLabel("Low stock at", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save medication", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "1 medication low on stock", exact: true }).click();
  await view(page, "inventory");
});

test("supports Back Forward repeated clicks and edited fragments", async ({ page }) => {
  await page.goto("/#today");
  await view(page, "today");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await view(page, "weeks");
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await view(page, "patterns");
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await page.goBack();
  await view(page, "weeks");
  await page.goForward();
  await view(page, "patterns");
  await page.evaluate(() => {
    location.hash = "inventory";
  });
  await view(page, "inventory");
  await page.goBack();
  await view(page, "patterns");
});

test("closes quick settings without leaving focus hidden when browser history changes the view", async ({
  page,
}) => {
  await page.goto("/#today");
  await view(page, "today");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await view(page, "weeks");
  const gear = page.getByRole("button", { name: "Settings", exact: true });
  const panel = page.getByRole("dialog", { name: "Quick settings", exact: true });
  await gear.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("combobox", { name: "Appearance", exact: true }).focus();
  await page.goBack();
  await view(page, "today");
  await expect(panel).not.toBeVisible();
  expect(
    await page
      .locator(".quick-settings")
      .evaluate((element) => element.contains(document.activeElement)),
  ).toBe(false);
  await page.goForward();
  await view(page, "weeks");
  await expect(panel).not.toBeVisible();
});

test("replaces unknown fragments with Today without adding a redirect entry", async ({ page }) => {
  await page.goto("/?source=review#unknown");
  await view(page, "today");
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await view(page, "weeks");
  await page.evaluate(() => {
    location.hash = "%";
  });
  await view(page, "today");
  await page.goBack();
  await view(page, "weeks");
  expect(new URL(page.url()).search).toBe("?source=review");
});

test("preserves routes on offline reload and closes an editor when going Back", async ({
  page,
  context,
}) => {
  await page.goto("/#today");
  await view(page, "today");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Weeks", exact: true }).click();
  await view(page, "weeks");
  await page.reload();
  await view(page, "weeks");
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await view(page, "inventory");
  await page.getByRole("button", { name: "Add tracker", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add tracker", exact: true })).toBeVisible();
  await page.goBack();
  await view(page, "weeks");
  await expect(page.getByRole("dialog", { name: "Add tracker", exact: true })).not.toBeVisible();
});
