import { expect, it } from "vitest";
import { backupReminder, storageProtection } from "../src/client/recovery";
import { BACKUP_REMINDER_INTERVAL, type Recovery } from "../src/client/storage";

const recovery: Recovery = { checkedAt: 1000, operationCount: 3, remindAfter: 0, available: true };
it("checks persistence and reads back grants rather than trusting a request result", async () => {
  let protectedStorage = false;
  const storage = {
    persisted: async () => protectedStorage,
    persist: async () => {
      protectedStorage = true;
      return true;
    },
  };
  expect(await storageProtection(storage)).toBe("available");
  expect(await storageProtection(storage, true)).toBe("protected");
  expect(
    await storageProtection({ persisted: async () => false, persist: async () => true }, true),
  ).toBe("available");
});
it("handles refusal, unsupported APIs, and exceptions without breaking logging", async () => {
  expect(await storageProtection(undefined)).toBe("unsupported");
  expect(
    await storageProtection({ persisted: async () => false, persist: async () => false }, true),
  ).toBe("available");
  expect(
    await storageProtection({
      persisted: async () => {
        throw new Error("unavailable");
      },
      persist: async () => false,
    }),
  ).toBe("error");
});
it("reminds only for existing unprotected edits and honors a daily postponement", () => {
  const later = 1000 + BACKUP_REMINDER_INTERVAL;
  expect(backupReminder(recovery, 0, later)).toBe(false);
  expect(backupReminder(recovery, 3, later)).toBe(false);
  expect(backupReminder(recovery, 4, later - 1)).toBe(false);
  expect(backupReminder(recovery, 4, later)).toBe(true);
  expect(backupReminder({ ...recovery, checkedAt: 0 }, 1, 1000)).toBe(true);
  expect(backupReminder({ ...recovery, checkedAt: 0, remindAfter: later }, 1, later - 1)).toBe(
    false,
  );
  expect(backupReminder({ ...recovery, available: false }, 4, later)).toBe(false);
});
