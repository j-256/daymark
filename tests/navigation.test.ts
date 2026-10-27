import { expect, it } from "vitest";
import { isAdminPath, TABS, tabFromHash } from "../src/client/navigation";

it("reads every supported main-view fragment", () => {
  for (const tab of TABS) expect(tabFromHash(`#${tab}`)).toBe(tab);
});
it("falls back safely for empty unknown and malformed fragments", () => {
  for (const hash of ["", "#", "#unknown", "#Settings", "#%", "#settings/extra"])
    expect(tabFromHash(hash)).toBe("today");
});
it("recognizes only the protected administration path and its children", () => {
  for (const path of ["/admin", "/admin/", "/admin/accounts"]) expect(isAdminPath(path)).toBe(true);
  for (const path of ["/", "/administrator", "/api/admin"]) expect(isAdminPath(path)).toBe(false);
});
