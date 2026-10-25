import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const ORIGIN = "http://localhost:5184";
const PASSWORD = "local-browser-test-password-123!";
async function account(request: APIRequestContext) {
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
  const email = `inventory-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await request.post("/api/admin/accounts", {
        headers: { Origin: ORIGIN },
        data: { email, name: "Inventory test", password: PASSWORD },
      })
    ).status(),
  ).toBe(201);
  return email;
}
async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in for sync", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}
async function inventory(page: Page) {
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
}
async function addMedication(page: Page) {
  await inventory(page);
  await page.getByRole("button", { name: "Add medication", exact: true }).click();
  await page.getByLabel("Medication name", { exact: true }).fill("Test medication");
  await page.getByLabel("Quantity on hand", { exact: true }).fill("5");
  await page.getByLabel("Low stock at", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save medication", exact: true }).click();
  await expect(page.locator(".stock-quantity")).toHaveText("5 tablets left");
}
async function refill(page: Page, amount: string) {
  await page.getByRole("button", { name: "Refill Test medication", exact: true }).click();
  await page.getByLabel("Quantity", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Save stock change", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}
const quick = (page: Page) =>
  page.locator(".log-row").filter({ hasText: "Test dose" }).locator(".status-button");

test("tracks refills, fractional doses, Undo and note-only edits", async ({ page, request }) => {
  await signIn(page, await account(request));
  await addMedication(page);
  await refill(page, "2");
  await expect(page.locator(".stock-quantity")).toHaveText("7 tablets left");
  await page.getByRole("button", { name: "Add tracker", exact: true }).first().click();
  await page.getByLabel("Tracker name", { exact: true }).fill("Test dose");
  await page
    .getByRole("combobox", { name: "Inventory item", exact: true })
    .selectOption({ label: "Test medication" });
  await page.getByLabel("Quantity per occurrence", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await quick(page).click();
  await inventory(page);
  await expect(page.locator(".stock-quantity")).toHaveText("5.5 tablets left");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".stock-quantity")).toHaveText("7 tablets left");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await quick(page).click();
  await page.locator(".log-row").filter({ hasText: "Test dose" }).locator(".item-copy").click();
  await page.getByLabel("Notes", { exact: true }).fill("Note without another dose");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await inventory(page);
  await expect(page.locator(".stock-quantity")).toHaveText("5.5 tablets left");
  await page.getByRole("button", { name: "History for Test medication", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Dose");
  await page.getByRole("button", { name: "Undo stock change", exact: true }).first().click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".stock-quantity")).toHaveText("3.5 tablets left");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.locator(".log-row").filter({ hasText: "Test dose" }).locator(".item-copy").click();
  await page.getByLabel("Log an extra occurrence", { exact: true }).check();
  await page.getByRole("button", { name: "Log occurrence", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await inventory(page);
  await expect(page.locator(".stock-quantity")).toHaveText("2 tablets left");
  await expect(page.getByText("Low stock", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1 medication low on stock", exact: true }),
  ).toBeVisible();
  await page.locator(".log-row").filter({ hasText: "Test dose" }).locator(".item-copy").click();
  await page.getByRole("button", { name: "Delete extra occurrence", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Extra occurrence deleted");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await inventory(page);
  await expect(page.locator(".stock-quantity")).toHaveText("3.5 tablets left");
});

test("merges refills from two devices after offline reload without overwriting stock", async ({
  browser,
  request,
}) => {
  const email = await account(request);
  const a = await browser.newContext({ viewport: { width: 320, height: 740 } });
  const b = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const first = await a.newPage();
    const second = await b.newPage();
    await signIn(first, email);
    await addMedication(first);
    await expect(first.getByTestId("sync-status")).toHaveText(/Synced/);
    await signIn(second, email);
    await inventory(second);
    await expect(second.locator(".stock-quantity")).toHaveText("5 tablets left");
    await first.evaluate(() => navigator.serviceWorker.ready);
    await a.setOffline(true);
    await refill(first, "30");
    await first.reload();
    await inventory(first);
    await expect(first.locator(".stock-quantity")).toHaveText("35 tablets left");
    await refill(second, "60");
    await expect(second.locator(".stock-quantity")).toHaveText("65 tablets left");
    await expect(second.getByTestId("sync-status")).toHaveText(/Synced/);
    await a.setOffline(false);
    await expect(first.locator(".stock-quantity")).toHaveText("95 tablets left");
    await second.reload();
    await inventory(second);
    await expect(second.locator(".stock-quantity")).toHaveText("95 tablets left");
  } finally {
    await a.close();
    await b.close();
  }
});

test("gives recovery guidance for an incomplete inventory backup", async ({ page, request }) => {
  await signIn(page, await account(request));
  const response = await page.evaluate(async () => {
    const { account } = (await (await fetch("/api/session")).json()) as { account: { id: string } };
    const result = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Daymark-Account": account.id,
        "X-Daymark-Sync": "2",
      },
      body: JSON.stringify({
        operations: [
          {
            id: crypto.randomUUID(),
            kind: "stock",
            key: "incomplete-refill",
            parents: [],
            createdAt: new Date().toISOString(),
            value: {
              itemId: "missing-supply",
              quantity: 30000,
              reason: "refill",
              note: "",
              day: new Date().toISOString().slice(0, 10),
              deleted: false,
            },
          },
        ],
      }),
    });
    return result.status;
  });
  expect(response).toBe(200);
  await page.reload();
  await inventory(page);
  await page.getByLabel("Show archived medications", { exact: true }).check();
  await expect(page.getByText("Supply details missing", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Sync or import a complete backup to restore this supply.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs review", exact: true })).toHaveCount(0);
});
