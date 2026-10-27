import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { stockBalances } from "../../src/client/inventory";
import { materialize, type Operation, type Tracker } from "../../src/shared/model";

async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "All settings...", exact: true }).click();
}
async function tracker(page: Page, name: string) {
  await page.getByRole("button", { name: "Add tracker", exact: true }).first().click();
  await page.getByLabel("Tracker name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save tracker", exact: true }).click();
}

test("checks a saved recovery copy, preserves its checkpoint across reload, and tracks later edits", async ({
  page,
}) => {
  await page.goto("/");
  await tracker(page, "Recovery chore");
  await expect(page.getByTestId("backup-reminder")).toBeVisible();
  await settings(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Missing backup download");
  await expect(page.getByTestId("backup-status")).toContainText("No backup checked");
  await page.getByLabel("Check backup", { exact: true }).setInputFiles(path);
  await expect(page.getByTestId("backup-status")).toContainText("All changes included");
  await page.reload();
  await settings(page);
  await expect(page.getByTestId("backup-status")).toContainText("All changes included");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page
    .locator(".log-row")
    .filter({ hasText: "Recovery chore" })
    .locator(".status-button")
    .click();
  await settings(page);
  await expect(page.getByTestId("backup-status")).toContainText("1 change since");
  await page.getByLabel("Check backup", { exact: true }).setInputFiles(path);
  await expect(page.getByRole("status")).toContainText("1 change missing");
  await expect(page.getByTestId("backup-status")).toContainText("1 change since");
});

test("postpones reminders without claiming a backup and keeps logging offline", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await page.goto("/");
  await tracker(page, "Offline recovery");
  await page.getByRole("button", { name: "Remind me tomorrow", exact: true }).click();
  await expect(page.getByTestId("backup-reminder")).not.toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("backup-reminder")).not.toBeVisible();
  await page.locator(".status-button").first().click();
  await expect(page.locator(".status-button").first()).toHaveAttribute("data-state", "confirmed");
  await settings(page);
  await expect(page.getByTestId("backup-status")).toContainText("No backup checked");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.clock.fastForward(24 * 60 * 60 * 1000 + 60000);
  await expect(page.getByTestId("backup-reminder")).toBeVisible();
});

test("shows storage protection grants and refusal while retaining usable backup controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let protectedStorage = false;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persisted: async () => protectedStorage,
        persist: async () => {
          if (localStorage.getItem("deny-protection")) return false;
          protectedStorage = true;
          return true;
        },
      },
    });
  });
  await page.goto("/");
  await settings(page);
  await page.getByRole("button", { name: "Request storage protection", exact: true }).click();
  await expect(page.getByTestId("storage-protection")).toContainText(
    "Protected from automatic eviction",
  );
  await expect(page.getByRole("button", { name: "Export backup", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    localStorage.setItem("deny-protection", "true");
  });
  await page.reload();
  await settings(page);
  await page.getByRole("button", { name: "Request storage protection", exact: true }).click();
  await expect(page.getByTestId("storage-protection")).toContainText(
    "Your browser did not enable storage protection",
  );
  await page.getByText("Why didn't I get a prompt?", { exact: true }).click();
  await expect(page.getByTestId("storage-protection-help")).toContainText(
    "Chrome and Edge decide automatically",
  );
  await expect(page.getByTestId("storage-protection-help")).toContainText(
    "Installing or bookmarking Daymark may help",
  );
  await expect(page.getByRole("button", { name: "Export backup", exact: true })).toBeEnabled();
});

function recoveryFixture(): Operation[] {
  const values: Operation[] = [];
  const add = (
    kind: Operation["kind"],
    key: string,
    value: Operation["value"],
    parents: string[] = [],
  ) => {
    const op = {
      id: crypto.randomUUID(),
      kind,
      key,
      value,
      parents,
      createdAt: "2026-10-27T08:00:00.000Z",
    };
    values.push(op);
    return op;
  };
  const tracker: Tracker = {
    name: "Archived care",
    category: "Care",
    slots: [{ id: "retired", name: "Old slot", time: "08:00" }],
    schedule: "daily",
    weekdays: [],
    pinned: false,
    archived: false,
    order: 0,
  };
  const original = add("tracker", "archived", tracker);
  add(
    "tracker",
    "archived",
    { ...tracker, archived: true, slots: [{ id: "default", name: "New slot", time: "" }] },
    [original.id],
  );
  add("tracker", "dose", {
    ...tracker,
    name: "Fractional dose",
    slots: [{ id: "default", name: "", time: "" }],
    inventory: { itemId: "supply", quantity: 500 },
  });
  add("inventory", "supply", {
    name: "Recovery supply",
    unit: "tablets",
    lowStock: 5000,
    archived: false,
  });
  add("stock", "opening", {
    itemId: "supply",
    quantity: 30500,
    reason: "opening",
    note: "Opening stock",
    day: "2026-10-27",
    deleted: false,
  });
  add("stock", "refill", {
    itemId: "supply",
    quantity: 1500,
    reason: "refill",
    note: "Fractional refill",
    day: "2026-10-27",
    deleted: false,
  });
  add("entry", "dose/2026-10-27/default", {
    state: "confirmed",
    note: "Half a tablet",
    occurredAt: "2026-10-27T08:00:00.000Z",
    inventory: { itemId: "supply", quantity: 500 },
  });
  add("event", "extra", {
    trackerId: "dose",
    day: "2026-10-27",
    occurredAt: "2026-10-27T09:00:00.000Z",
    note: "Extra quarter",
    deleted: false,
    inventory: { itemId: "supply", quantity: 250 },
  });
  add("entry", "archived/2026-10-26/retired", {
    state: "confirmed",
    note: "Conflict A",
    occurredAt: null,
  });
  add("entry", "archived/2026-10-26/retired", {
    state: "skipped",
    note: "Conflict B",
    occurredAt: null,
  });
  return values;
}

async function exportFile(page: Page) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error("Missing backup download");
  return {
    path,
    backup: JSON.parse(readFileSync(path, "utf8")) as {
      operations: Operation[];
      integrity: unknown;
    },
  };
}

test("restores every operation into a fresh browser including conflicts retired slots and fractional inventory", async ({
  page,
  browser,
}) => {
  const operations = recoveryFixture();
  const file = {
    name: "legacy-recovery.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "daymark",
        version: 1,
        accountId: "local-workspace",
        exportedAt: "2026-10-27T10:00:00.000Z",
        operations,
      }),
    ),
  };
  await page.goto("/");
  await settings(page);
  await page.getByLabel("Import backup", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("status")).toContainText("10 edits imported");
  const saved = await exportFile(page);
  expect(saved.backup.integrity).toBeTruthy();
  const context = await browser.newContext();
  try {
    const destination = await context.newPage();
    await destination.goto("/");
    await settings(destination);
    await destination.getByLabel("Import backup", { exact: true }).setInputFiles(saved.path);
    await expect(destination.getByRole("status")).toContainText("10 edits imported");
    await destination.getByLabel("Import backup", { exact: true }).setInputFiles(saved.path);
    await expect(destination.getByRole("status")).toContainText("0 edits imported");
    await expect(destination.getByTestId("backup-status")).toContainText("No backup checked");
    const restored = await exportFile(destination);
    const sorted = (values: Operation[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted(restored.backup.operations)).toEqual(sorted(operations));
    expect(materialize(restored.backup.operations)).toEqual(materialize(saved.backup.operations));
    expect(stockBalances(restored.backup.operations)).toEqual(stockBalances(operations));
    await destination.getByLabel("Check backup", { exact: true }).setInputFiles(saved.path);
    await expect(destination.getByTestId("backup-status")).toContainText("All changes included");
    await destination.getByRole("button", { name: "Inventory", exact: true }).click();
    await expect(destination.locator(".stock-quantity")).toContainText("31.25 tablets left");
  } finally {
    await context.close();
  }
});

test("rejects a corrupted file for both checking and import without changing history", async ({
  page,
}) => {
  await page.goto("/");
  await tracker(page, "Preserve me");
  await settings(page);
  const saved = await exportFile(page);
  const corrupt = { ...saved.backup, operations: [] };
  const file = {
    name: "corrupted.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(corrupt)),
  };
  await page.getByLabel("Check backup", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("integrity check failed");
  await page.getByLabel("Import backup", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("integrity check failed");
  const after = await exportFile(page);
  expect(after.backup.operations).toEqual(saved.backup.operations);
});

test("abandons a delayed import when signing out to a different workspace", async ({
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
  const email = `recovery-${crypto.randomUUID()}@example.com`;
  expect(
    (
      await request.post("/api/admin/accounts", {
        headers,
        data: { email, name: "Recovery user", password },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in for sync", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("Synced");
  await tracker(page, "Private account history");
  await settings(page);
  const saved = await exportFile(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      const text = await original.call(this);
      return new Promise<string>((resolve) => {
        (window as unknown as { releaseBackupRead: () => void }).releaseBackupRead = () =>
          resolve(text);
      });
    };
  });
  await page.getByLabel("Import backup", { exact: true }).setInputFiles(saved.path);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { releaseBackupRead?: () => void }).releaseBackupRead ===
      "function",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("local-status")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { releaseBackupRead: () => void }).releaseBackupRead(),
  );
  await expect(page.locator(".log-row")).toHaveCount(0);
  await settings(page);
  await expect(page.getByTestId("backup-status")).toContainText("No backup checked");
  const empty = await exportFile(page);
  expect(empty.backup.operations).toEqual([]);
});
