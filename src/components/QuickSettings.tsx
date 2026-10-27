import { RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Layout } from "../client/layout";
import type { Tab } from "../client/navigation";
import type { Theme } from "./Settings";

const EDGE_SPACE = 8;
const MENU_GAP = 6;
export function QuickSettings({
  view,
  theme,
  setTheme,
  layout,
  setLayout,
  canSync,
  syncing,
  sync,
  canOpenSettings,
  allSettings,
}: {
  view: Tab;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  layout: Layout;
  setLayout: (layout: Layout) => void;
  canSync: boolean;
  syncing: boolean;
  sync: () => void;
  canOpenSettings: boolean;
  allSettings: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previousView = useRef(view);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    const menu = panel.current;
    if (!menu?.matches(":popover-open")) return;
    menu.hidePopover();
  }, [view]);
  const position = useCallback(() => {
    const trigger = button.current?.getBoundingClientRect();
    const menu = panel.current;
    if (!trigger || !menu) return;
    const top = trigger.bottom + MENU_GAP;
    menu.style.left = `${Math.max(EDGE_SPACE, Math.min(trigger.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - EDGE_SPACE))}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${Math.max(0, window.innerHeight - top - EDGE_SPACE)}px`;
  }, []);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const observer = new ResizeObserver(reposition);
    const application = button.current?.closest(".app");
    if (application) observer.observe(application);
    reposition();
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [open, position]);
  const close = () => panel.current?.hidePopover();
  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button"
        aria-label="Settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
      >
        <SettingsIcon />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Quick settings"
        className="quick-settings"
        onToggle={(event) => {
          const visible = event.currentTarget.matches(":popover-open");
          if (visible) position();
          setOpen(visible);
        }}
      >
        <h2>Quick settings</h2>
        <label>
          Appearance
          <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Layout
          <select value={layout} onChange={(event) => setLayout(event.target.value as Layout)}>
            <option value="auto">Automatic</option>
            <option value="compact">Compact</option>
            <option value="wide">Wide</option>
          </select>
        </label>
        <p className="hint">Saved on this device. Wide content can scroll horizontally.</p>
        <button
          type="button"
          className="list-action"
          disabled={!canSync || syncing}
          onClick={() => {
            close();
            sync();
          }}
        >
          <RefreshCw />
          Sync now
        </button>
        <button
          type="button"
          className="list-action all-settings"
          disabled={!canOpenSettings}
          onClick={() => {
            close();
            allSettings();
          }}
        >
          All settings...
        </button>
      </div>
    </>
  );
}
