export type Layout = "auto" | "compact" | "wide";
export const LAYOUT_KEY = "daymark-layout";
const MEDIUM_WIDTH = 600;
const WIDE_WIDTH = 900;
export function normalizeLayout(value: string | null): Layout {
  return value === "compact" || value === "wide" ? value : "auto";
}
export function layoutPreference(): Layout {
  try {
    return normalizeLayout(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return "auto";
  }
}
export function layoutSize(layout: Layout, width: number): "compact" | "medium" | "wide" {
  if (layout !== "auto") return layout;
  return width >= WIDE_WIDTH ? "wide" : width >= MEDIUM_WIDTH ? "medium" : "compact";
}
export function applyLayout(layout: Layout): void {
  document.documentElement.dataset.layout = layout;
  document.documentElement.dataset.layoutSize = layoutSize(layout, window.innerWidth);
}
