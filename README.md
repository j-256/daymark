# Daymark

Daymark is a compact tracker for pills, personal care, maintenance, and chores. It runs at [daymark.lasers.app](https://daymark.lasers.app) on Cloudflare Workers and D1.

- Tap a Today status to confirm, with Undo for mistakes
- Cycle weekly cells through unknown, confirmed, and skipped; open Details to choose a date and review slots, notes, and extra logs
- Give a tracker separate named slots, such as morning and evening; log additional occurrences separately
- Use Trackers > Reorder to move items up or down; changes save offline and sync across devices. Weekly chores stay complete for their week
- Explore 7, 28, or 90 days of patterns, per-slot counts, and average gaps within the selected range
- Use every tracking feature for free without signing in; history stays in this browser
- Keep logging offline after the app finishes downloading; invited accounts can sync across devices
- Export complete JSON backups and import them on another device or into an invited account
- Check a saved backup against your history, review changes since that copy, and request browser storage protection
- Track medication stock, record refills, review stock history, and flag low supplies in Inventory
- Optionally link a tracker to a supply and deduct a quantity for each newly confirmed slot or extra log; Undo restores stock
- Open the gear dropdown for appearance, layout, Sync now, or All settings; system appearance and Automatic layout are the defaults

Concurrent edits to different records merge automatically. Different edits to the same record remain visible as a conflict until you choose a version. Device clocks and newer snapshots never decide which change wins. Unknown means unrecorded, including an explicitly cleared entry; skipped is a deliberate record.

## First use

Open Daymark and start adding trackers. No account is needed for Today, Weeks, Patterns, Inventory, or Settings. "On this device" identifies the local workspace. Install the PWA from your browser for a home-screen shortcut; keep the first visit online until the service worker has cached the complete app.

Main views keep their place in the URL: `#today`, `#weeks`, `#patterns`, `#inventory`, `#trackers`, and `#settings`. You can bookmark or share a view, reload it, and use browser Back and Forward, including offline after the app is cached. Empty or unknown fragments open Today. Signing in or out returns to Today and updates the URL; reopening an existing account preserves a direct link. URLs identify the view without containing tracker or account data.

The local workspace makes no account, configuration, or sync API requests. Logging, navigation, patterns, inventory, and backups run locally. Cached public navigation uses the app shell without fetching a new page. Browsers can still check for service-worker updates, and a changed release downloads a new shell; clearing or evicting the cache requires another download. Literal zero network traffic across every browser lifecycle is not guaranteed. See [MDN's service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Online sync accounts are invite-only. Choose Sign in for sync if the owner has created an account for you. The owner uses [/admin](https://daymark.lasers.app/admin), protected by owner-only Cloudflare Access, to create accounts and share initial credentials privately. There is no invitation or password recovery email. Users can change passwords in Settings; the owner can reset passwords and deactivate accounts. Public self-registration is disabled by the server.

Signing in opens that account's separate history. It never uploads the local workspace automatically. Signing out returns to the local workspace and preserves account history on the device. To move history, export a backup, open the destination workspace, enable "Import from another workspace" in Settings, and import the file. Imported history in an account is then eligible to sync.

## Appearance and layout

The gear opens quick controls for System, Light, or Dark appearance and Automatic, Compact, or Wide layout. All settings opens the local workspace or account and backup controls. These preferences stay on the device and work offline. Sync now is available after sign-in when the local account is ready and the browser is online.

Automatic follows the window width. Compact caps the app at phone width, with stacked weekly labels and phone-sized dialogs. Wide uses desktop spacing and columns; on smaller screens the main content scrolls horizontally while the gear and navigation remain reachable. Choose Automatic to return to the normal responsive layout. The same choices are available in the full Settings screen.

## Medication inventory

Open Inventory to add a medication, its unit, quantity on hand, and low-stock threshold. Use Refill for incoming stock and Use / discard for quantities used outside a linked tracker or removed from the supply. History lets you undo or restore stock changes. To correct a count, record the difference as a refill or a use/discard. Archiving preserves stock history and deductions from existing links.

In a tracker's settings, select an Inventory item and set the quantity per occurrence. Each newly confirmed named slot or extra log consumes that amount; clearing or skipping the entry, deleting an extra log, or using Undo restores it. Changes to notes or tracker links preserve the amount already recorded, and earlier confirmations are not backfilled. A tracker uses the same quantity for each of its slots and extra logs. Quantities support up to three decimal places, including fractional tablets.

Refills recorded independently on offline devices add together on reconnect. Conflicting consumption or stock changes show "Quantity needs review" until resolved; no device's newer balance replaces another's changes. Negative stock remains visible and does not prevent activity logging. Low stock is a quantity threshold, with no refill ordering, pharmacy connection, or notification service.

## Development

Requires Node 24 or newer and npm. No Cloudflare credentials are needed for local development or verification.

```sh
npm ci
npx playwright install chromium
npm run db:local
npm run dev
```

Open http://localhost:5184 to use the local workspace. For account testing, open http://localhost:5184/admin and create a local owner account. The local owner email is `owner@example.com`; Wrangler simulates the Access identity. Local data and credentials are independent of production. `npm run dev` serves a built client; restart it after client changes.

Run the same checks used by CI:

```sh
npm run verify
```

This checks formatting, TypeScript, domain and storage behavior, native authentication against local D1, browser flows, the built offline shell, production configuration, a Worker deployment dry run, and dependency security advisories. Linux CI also installs Chromium's system dependencies with `npx playwright install --with-deps chromium`.

The GitHub repository is public. The Verify and deploy workflow runs on pushes, pull requests, and manual dispatch, using Node 24 and Chromium on Linux. Changes to `main` require a pull request and a passing `verify` check. The local integration queue also runs `npm run verify` before publishing an approved task and follows GitHub's branch protection when merging.

Verified changes to protected `main` deploy automatically through the `production` environment, without a separate deployment reviewer. Only the release step receives production credentials. It validates the verified build, checks migration history, records a recovery bookmark when needed, applies reviewed compatible migrations, and activates the exact uploaded Worker version. Pending manual migrations stop the release. See [deployment and recovery](docs/deployment.md) and [migration authoring](docs/migrations.md).

## Data and operational limits

Browser history is stored in isolated local and account workspaces in IndexedDB. Settings exports a complete JSON backup, including tracker definitions, archived records, inventory, stock changes, activity, and conflict history. Imports validate the operation graph and merge atomically without replacing existing edits; repeated imports do not duplicate operations. A backup from another workspace requires the explicit import checkbox. Appearance and layout preferences stay on the device and are not included. Treat backups as private activity history. Offline storage remains on the device after sign-out, so use a trusted browser profile. Daymark requests no notification, location, or camera permissions.

In Settings, choose Request storage protection to ask the browser to retain this site's data against automatic eviction. The browser can decline or lack this feature; logging and backups remain available. Chrome and Edge normally decide automatically without a permission prompt. Installing or bookmarking Daymark and using it regularly may help a later request succeed, but cannot guarantee approval. Firefox normally displays a prompt. The app cannot grant this permission itself. Protection covers the site's local and account workspaces together, but does not protect against clearing browser data or losing the device. See [how browsers grant persistent storage](https://web.dev/articles/persistent-storage#how_is_permission_granted) and [browser storage persistence](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

To keep a recovery copy, choose Export backup, save the file in a backed-up folder, then select the saved file with Check backup. Checking validates the complete history and compares its operation IDs and content with the active workspace without importing it. Only a complete checked file records a backup checkpoint. Settings shows its check time and changes since that copy; a dismissible reminder appears for existing history without a checked copy, or for new edits when the checked copy is at least a day old. Remind me tomorrow postpones the reminder without claiming a backup exists. Download requests, imports, and successful sync do not establish a checked backup. Checkpoints and postponement belong to each workspace on each device.

New exports include a SHA-256 integrity check; old unsigned backups remain readable. Integrity metadata detects altered files and does not encrypt private history. Normal checking and importing support files up to 20 MB and 50,000 operations. If an export exceeds these limits, Download raw history preserves the complete file for assisted recovery; that file cannot be checked or imported through the normal controls. See the [restore rehearsal](docs/deployment.md#personal-restore-rehearsal) before depending on a device for daily use.

The server retains an append-only activity history. Archiving a tracker and removing a slot preserve its history. V1 has no activity reminders, push notifications, shared trackers, automatic pruning, or scheduled backup export. Backup reminders appear only inside the app. Times are displayed in the viewing device's local time; the recorded calendar day stays fixed. Editing notes preserves the original instant, and changing an ambiguous daylight-saving time offers a choice between its first and second occurrence.

See [deployment, recovery, security boundaries, and Cloudflare Free-plan assessment](docs/deployment.md). Licensed under [AGPL-3.0-only](LICENSE).
