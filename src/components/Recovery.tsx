import { Download, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import type { RecoveryControls } from "../client/useRecovery";
import { ErrorMessage } from "./ui";

export function RecoveryNotice({
  recovery,
  open,
}: {
  recovery: RecoveryControls;
  open: () => void;
}) {
  if (!recovery.reminder) return null;
  return (
    <aside
      className="notice recovery-notice"
      data-testid="backup-reminder"
      aria-label="Backup reminder"
    >
      <span>Keep a recovery copy outside this browser.</span>
      <div>
        <button type="button" onClick={open}>
          Back up
        </button>
        <button type="button" disabled={recovery.busy} onClick={() => void recovery.postpone()}>
          Remind me tomorrow
        </button>
      </div>
      <ErrorMessage text={recovery.error} />
    </aside>
  );
}

export function RecoverySettings({ controls }: { controls: RecoveryControls }) {
  const [allowDifferentWorkspace, setAllowDifferentWorkspace] = useState(false);
  const checkpoint = controls.recovery;
  const changed = checkpoint ? Math.max(0, controls.count - checkpoint.operationCount) : 0;
  const protection =
    controls.protection === "protected"
      ? "Protected from automatic eviction"
      : controls.protection === "unsupported"
        ? "Storage protection is unavailable in this browser"
        : controls.protection === "error"
          ? "Storage protection could not be checked"
          : controls.protection === "checking"
            ? "Checking storage protection..."
            : controls.protectionRequested
              ? "Your browser did not enable storage protection"
              : "Browser storage protection is not enabled";
  const choose =
    (action: (file: File) => Promise<void>) =>
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (file) await action(file);
    };
  return (
    <section className="settings-section">
      <h2>Your data</h2>
      <p data-testid="storage-protection">{protection}</p>
      {controls.protection !== "protected" && controls.protection !== "unsupported" && (
        <button
          className="list-action"
          type="button"
          disabled={controls.busy || controls.protection === "checking"}
          onClick={() => void controls.protect()}
        >
          <ShieldCheck />
          Request storage protection
        </button>
      )}
      <div className="storage-protection-guidance">
        <p className="hint">
          {controls.protection === "available" &&
            "Your browser decides whether to grant protection and may not show a prompt. "}
          Storage protection reduces automatic removal. Clearing browser data or losing the device
          still requires a backup.
        </p>
        {controls.protection === "available" && controls.protectionRequested && (
          <details>
            <summary>Why didn't I get a prompt?</summary>
            <p className="hint" data-testid="storage-protection-help">
              Chrome and Edge decide automatically. Installing or bookmarking Daymark may help; try
              again later. Firefox usually shows a prompt. Daymark cannot force approval.
            </p>
          </details>
        )}
      </div>
      <p data-testid="backup-status">
        {!checkpoint ? (
          "Checking backup status..."
        ) : !checkpoint.available ? (
          "Backup status is unavailable. Export and check a recovery copy."
        ) : !checkpoint.checkedAt ? (
          "No backup checked on this device"
        ) : (
          <>
            {changed
              ? `${changed} ${changed === 1 ? "change" : "changes"} since the checked backup`
              : "All changes included in the checked backup"}
            <br />
            <span className="muted">Checked {new Date(checkpoint.checkedAt).toLocaleString()}</span>
          </>
        )}
      </p>
      <button
        className="list-action"
        type="button"
        disabled={controls.busy}
        onClick={() => void controls.exportBackup()}
      >
        <Download />
        Export backup
      </button>
      {controls.hasRescue && (
        <button
          className="list-action"
          type="button"
          disabled={controls.busy}
          onClick={controls.downloadRescue}
        >
          <Download />
          Download raw history
        </button>
      )}
      <label className="list-action upload-label">
        <ShieldCheck />
        Check backup
        <input
          type="file"
          accept="application/json,.json"
          disabled={controls.busy}
          onChange={choose(controls.check)}
        />
      </label>
      <p className="hint">
        Save the download outside this browser, then select it with Check backup. Checking reads the
        file without importing it. Sync is a second copy, not an independent backup.
      </p>
      <label className="list-action upload-label">
        <Upload />
        Import backup
        <input
          type="file"
          accept="application/json,.json"
          disabled={controls.busy}
          onChange={choose((file) => controls.importBackup(file, allowDifferentWorkspace))}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={allowDifferentWorkspace}
          onChange={(event) => setAllowDifferentWorkspace(event.target.checked)}
        />
        Import from another workspace
      </label>
      <p className="hint">
        Backups contain trackers, inventory, and complete activity history. Imports merge without
        replacing edits. Imported account history becomes eligible to sync.
      </p>
      <ErrorMessage text={controls.error} />
    </section>
  );
}
