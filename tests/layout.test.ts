import { describe, expect, it } from "vitest";
import { layoutSize, normalizeLayout } from "../src/client/layout";

describe("layout preference", () => {
  it("defaults unknown saved values to Automatic", () => {
    for (const value of [null, "", "desktop", "invalid"])
      expect(normalizeLayout(value)).toBe("auto");
    for (const value of ["auto", "compact", "wide"]) expect(normalizeLayout(value)).toBe(value);
  });
  it("follows the viewport only in Automatic mode", () => {
    expect(layoutSize("auto", 390)).toBe("compact");
    expect(layoutSize("auto", 599)).toBe("compact");
    expect(layoutSize("auto", 600)).toBe("medium");
    expect(layoutSize("auto", 899)).toBe("medium");
    expect(layoutSize("auto", 900)).toBe("wide");
    expect(layoutSize("compact", 1440)).toBe("compact");
    expect(layoutSize("wide", 320)).toBe("wide");
  });
});
