# Daymark

Daymark is a compact tracker for pills, personal care, maintenance, and chores. It runs at [daymark.lasers.app](https://daymark.lasers.app) on Cloudflare Workers and D1.

- Tap a Today status to confirm, with Undo for mistakes
- Cycle weekly cells through unknown, confirmed, and skipped; open Details to choose a date and review slots, notes, and extra logs
- Give a tracker separate named slots, such as morning and evening; log additional occurrences separately
- Use Trackers > Reorder to move items up or down; changes save offline and sync across devices. Weekly chores stay complete for their week
- Explore 7, 28, or 90 days of patterns, per-slot counts, and average gaps within the selected range
- Keep logging offline after the first successful load; reconnect to merge changes across devices
- Track medication stock, record refills, review stock history, and flag low supplies in Inventory
- Optionally link a tracker to a supply and deduct a quantity for each newly confirmed slot or extra log; Undo restores stock
- Open the gear dropdown for appearance, layout, Sync now, or All settings; system appearance and Automatic layout are the defaults

Concurrent edits to different records merge automatically. Different edits to the same record remain visible as a conflict until you choose a version. Device clocks and newer snapshots never decide which change wins. Unknown means unrecorded, including an explicitly cleared entry; skipped is a deliberate record.

## First use

The private deployment has a temporary whole-app Cloudflare Access gate restricted to the owner. Visit [/admin](https://daymark.lasers.app/admin), authenticate through Access, and choose the owner account's name and password. Use that app account to sign in to Daymark. Access and the Daymark account are separate sign-ins.

The owner creates accounts in the Accounts screen and shares initial credentials privately. There is no invitation email or password recovery email. Users can change their password in Settings; the owner can reset user passwords and deactivate accounts. Creating an account does not grant passage through the temporary Access gate.

Self-registration is closed by default. The owner can enable it in Accounts. Opening access to other people also requires the separate deployment changes described in [deployment and recovery](docs/deployment.md).

## Appearance and layout

The gear opens quick controls for System, Light, or Dark appearance and Automatic, Compact, or Wide layout. All settings opens the account and backup controls. These preferences stay on the device and work offline. Sync now is available after sign-in when the local account is ready and the browser is online.

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

Open http://localhost:5184/admin and create a local owner account. The local owner email is `owner@example.com`; Wrangler simulates the Access identity. Local data and credentials are independent of production. `npm run dev` serves a built client; restart it after client changes.

Run the same checks used by CI:

```sh
npm run verify
```

This checks formatting, TypeScript, domain and storage behavior, native authentication against local D1, browser flows, the built offline shell, production configuration, a Worker deployment dry run, and dependency security advisories. Linux CI also installs Chromium's system dependencies with `npx playwright install --with-deps chromium`.

The GitHub repository is private and GitHub Actions is disabled at the repository level. The checked-in verification workflow also refuses to run while the repository is private. Publishing the repository and enabling Actions are deliberate owner actions; CI has no deployment credentials or automatic deploy job.

## Data and operational limits

Browser history is stored per account in IndexedDB. Settings exports a JSON backup; importing a backup merges its operations into the same account. Treat backups as private activity history. Offline storage remains on the device after sign-out, so use a trusted browser profile. Browser storage eviction or clearing site data can remove unsynced changes; export a backup before clearing storage. Daymark requests no notification, location, or camera permissions.

The server retains an append-only activity history. Archiving a tracker and removing a slot preserve its history. V1 has no reminders, push notifications, shared trackers, automatic pruning, or scheduled backup export. Times are displayed in the viewing device's local time; the recorded calendar day stays fixed. Editing notes preserves the original instant, and changing an ambiguous daylight-saving time offers a choice between its first and second occurrence.

See [deployment, recovery, security boundaries, and Cloudflare Free-plan assessment](docs/deployment.md). Licensed under [AGPL-3.0-only](LICENSE).
