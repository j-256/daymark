import { BACKUP_REMINDER_INTERVAL, type Recovery } from "./storage";

export type Protection = "protected" | "available" | "unsupported" | "error";
export async function storageProtection(
  storage?: Pick<StorageManager, "persisted" | "persist">,
  request = false,
): Promise<Protection> {
  if (typeof storage?.persisted !== "function") return "unsupported";
  try {
    if (await storage.persisted()) return "protected";
    if (typeof storage.persist !== "function") return "unsupported";
    if (request) await storage.persist();
    return (await storage.persisted()) ? "protected" : "available";
  } catch {
    return "error";
  }
}

export function backupReminder(recovery: Recovery, count: number, now = Date.now()): boolean {
  return Boolean(
    recovery.available &&
      count > 0 &&
      now >= recovery.remindAfter &&
      (!recovery.checkedAt ||
        (count > recovery.operationCount && now - recovery.checkedAt >= BACKUP_REMINDER_INTERVAL)),
  );
}
