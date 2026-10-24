import { Check, Circle, Minus, StickyNote, TriangleAlert, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import type { Status } from "../shared/model";

export function Sheet({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      className="sheet"
      aria-labelledby={titleId}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <header className="sheet-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function StatusIcon({ state }: { state: Status | "conflict" }) {
  return state === "confirmed" ? (
    <Check />
  ) : state === "skipped" ? (
    <Minus />
  ) : state === "conflict" ? (
    <TriangleAlert />
  ) : (
    <Circle />
  );
}
export function StatusButton({
  state,
  label,
  day,
  disabled,
  onClick,
  weekly,
  note = false,
  extraCount = 0,
}: {
  state: Status | "conflict";
  label: string;
  day: string;
  disabled?: boolean;
  onClick: () => void;
  weekly?: boolean;
  note?: boolean;
  extraCount?: number;
}) {
  return (
    <button
      type="button"
      className={`status-button${weekly ? " day-cell" : ""}`}
      data-day={day}
      data-state={state}
      aria-label={`${label}, ${day}: ${state}${note ? ", has note" : ""}${extraCount ? `, ${extraCount} tracker extra occurrence${extraCount === 1 ? "" : "s"}` : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="status-face">
        <StatusIcon state={state} />
      </span>
      {(note || extraCount > 0) && (
        <span className="cell-markers" aria-hidden="true">
          {note && <StickyNote />}
          {extraCount > 0 && <span data-extra-count={extraCount}>+{extraCount}</span>}
        </span>
      )}
    </button>
  );
}
export function ErrorMessage({ text }: { text: string }) {
  return text ? (
    <p className="error" role="alert">
      {text}
    </p>
  ) : null;
}
