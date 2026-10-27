import { useCallback, useEffect, useState } from "react";

export const TABS = ["today", "weeks", "patterns", "inventory", "trackers", "settings"] as const;
export type Tab = (typeof TABS)[number];
const DEFAULT_TAB: Tab = "today";

export function tabFromHash(hash: string): Tab {
  return TABS.find((tab) => hash === `#${tab}`) ?? DEFAULT_TAB;
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function tabUrl(tab: Tab): string {
  return `${location.pathname}${location.search}#${tab}`;
}

export function useNavigation() {
  const [tab, setTab] = useState(() => tabFromHash(location.hash));

  useEffect(() => {
    if (isAdminPath(location.pathname)) return;
    const read = () => {
      const selected = tabFromHash(location.hash);
      if (location.hash !== `#${selected}`) history.replaceState(null, "", tabUrl(selected));
      setTab(selected);
    };
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    read();
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);

  const navigate = useCallback((next: Tab, options: { replace?: boolean } = {}) => {
    if (isAdminPath(location.pathname)) {
      location.assign(`/#${next}`);
      return;
    }
    if (location.hash !== `#${next}`) {
      if (options.replace) history.replaceState(null, "", tabUrl(next));
      else history.pushState(null, "", tabUrl(next));
    }
    setTab(next);
  }, []);

  return { tab, navigate };
}
