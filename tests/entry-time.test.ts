import { afterEach, expect, it } from "vitest";
import { localInstants, savedInstant } from "../src/client/entry-time";

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});
it("preserves the original instant when only a note changes across calendar boundaries", () => {
  expect(savedInstant("2026-10-23T22:30:42.123Z", false, "2026-10-24", "22:30", "earlier")).toBe(
    "2026-10-23T22:30:42.123Z",
  );
});
it("preserves the later repeated DST instant when the time is untouched", () => {
  process.env.TZ = "America/New_York";
  expect(savedInstant("2026-11-01T06:30:00.000Z", false, "2026-11-01", "01:30", "earlier")).toBe(
    "2026-11-01T06:30:00.000Z",
  );
  expect(localInstants("2026-11-01", "01:30")).toEqual([
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]);
  expect(savedInstant(null, true, "2026-11-01", "01:30", "later")).toBe("2026-11-01T06:30:00.000Z");
});
it("rejects a local time skipped by the spring DST transition", () => {
  process.env.TZ = "America/New_York";
  expect(() => localInstants("2026-03-08", "02:30")).toThrow(/does not exist/);
});
