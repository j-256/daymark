# Deployment and recovery

## Ownership and ingress

The Worker `daymark`, its D1 database `daymark`, and the Custom Domain `daymark.lasers.app` belong to this application. `wrangler.jsonc` is the deployment configuration. Direct workers.dev and version preview URLs are disabled. Every static request goes through the Worker, which validates Cloudflare Access while `ACCESS_REQUIRED` is `true`.

Cloudflare Access applications protect the whole hostname and the more specific `/admin` and `/api/admin` paths. Both policies allow only the configured owner email. The admin audience is separate and remains mandatory even if the outer gate is removed. The Worker verifies the signed Access JWT's issuer, audience, and expiry when the platform context is unavailable. Static Assets routing does not propagate the Access context; see [Cloudflare's integration documentation](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

Native app sessions use Better Auth, secure HttpOnly cookies in production, database-backed sessions, password hashing, and database-backed authentication rate limiting. Rate limiting is disabled only on the HTTP localhost development configuration. Server queries scope all operations to the native account, and sync requires the account ID the browser believes is signed in. Account deactivation revokes sessions. Cross-origin mutations are rejected. Admin mutations require both the owner Access identity and a native owner account.

## Secrets and provisioning

Supply `AUTH_SECRET` (at least 32 random bytes encoded as a string) and `OWNER_EMAIL` through Wrangler secrets, never tracked variables. Keep a protected, structured recovery copy in your automation credential store. Secret rotation invalidates app sessions; retain the D1 database and users when rotating. Cloudflare API credentials are needed only on the deployment machine, not in the app.

For a new installation, create the D1 database, set its identifier in Wrangler, create both Access applications and their exact allow policies, then set issuer and audience variables before attaching the Custom Domain. Provision secrets with `npx wrangler secret bulk <protected-json-file>` using an object whose keys are `AUTH_SECRET` and `OWNER_EMAIL`. Never print or commit that file.

```sh
npm ci
npx playwright install chromium
npm run verify
npx wrangler d1 migrations apply daymark --remote
npx wrangler deploy
```

Apply schema migrations before deploying code that requires them. The dry-run output is kept outside the static asset directory. The deployment command builds from local source; deploy the clean, tested integration branch and retain Wrangler's version ID in the release evidence. Do not attach a public test hostname to bypass Access.

After deploying, read back the hostname, Worker, D1 binding, both Access applications and policies, and disabled provider URLs. Unauthenticated requests to `/`, `/admin`, and `/api/sync` must reach Access, while direct untrusted-origin access must fail. An Access redirect proves ingress protection; it does not prove authenticated application health. Complete an authenticated owner bootstrap, account login, tracker write, reload, and second-device merge when an owner browser session is available.

## Opening registration later

1. Keep the specific owner-only Access applications on `/admin` and `/api/admin`
2. Change the Worker's outer gate variable `ACCESS_REQUIRED` to `false` and update the production configuration check to permit that reviewed deployment
3. Remove only the whole-host Access application, verify native anonymous API requests still fail, and test a non-owner account
4. Enable self-registration in Accounts when desired; leaving it off keeps manual account creation

App-level account authorization remains independent of Access. Account creation alone never changes an Access policy. Confirm rate limiting and monitor authentication costs before allowing public registration.

## Synchronization and recovery

Each edit has a random ID and parent IDs identifying the versions the browser observed. The server atomically appends a bounded batch; identical retries are idempotent, ID collisions and missing or cross-record parents reject the whole batch. Pulls use an indexed, account-specific cursor. Conflicts keep every distinct concurrent head. Resolving a conflict creates an edit referencing all versions shown to the user.

IndexedDB commits precede successful UI updates. Only acknowledged operation IDs leave the pending queue. Failed network requests, expired sessions, Access redirects, and rejected batches preserve local work. Reconnect, focus, visible-page timers, and new edits trigger sync. Background Sync is not required: keep a browser tab open or reopen Daymark to resume. The service worker caches the application shell, never API responses, and rejects redirects during installation. A first visit needs a connection and valid Access authentication.

Use Settings to export a per-account JSON backup before browser maintenance. Imports validate the full causal graph, reject account mismatches and ID collisions, and merge atomically. For disaster recovery, export the remote D1 database with `npx wrangler d1 export daymark --remote --output <protected-backup.sql>`. Protect SQL exports as credential and activity data. D1 Time Travel retention depends on the account plan; verify its available bookmark before running a restore. Back up before migrations or restoration. Worker rollback does not roll back the database. Restore compatible code and database together and retest session and sync behavior. V1 does not automatically schedule exports.

## Diagnostics

API responses include `X-Request-ID`; failures return the same correlation ID. Worker logs record route class, status, duration, and safe reason codes. Sync writes also record batch size and D1 row metrics. Logs exclude operation values, notes, email addresses, cookies, and credentials. Use `npx wrangler tail daymark` or Cloudflare Workers Logs to correlate a failing request; match the request ID rather than copying activity contents into a ticket. Authentication logs from the auth library are disabled. Worker observability is enabled; configure retention in Cloudflare for the account's operational needs.

## Cloudflare Free-plan assessment

Official limits were checked on 2026-10-24. This application uses no Queues, Durable Objects, R2, paid identity provider, or paid email service. Successful testing on a Paid account does not establish Free-plan compatibility.

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) allow 100,000 requests per day, 10 ms CPU per invocation, 128 MB memory, a 64 MiB uncompressed Worker, 20,000 static files, and 25 MiB per asset on Free. Worker-first serving invokes code for shell requests, so include those requests in the workload budget
- Native password hashing is deliberately expensive and can exceed the Free 10 ms CPU limit. Password creation, login, and resets require a plan with sufficient CPU allowance unless an actual Free-account measurement demonstrates otherwise. This is a compute risk inherent to the chosen password authentication path, not a request-volume issue. No weak-hash fallback is supported. A separately implemented external identity or passkey flow could avoid password hashing at the cost of another authentication design; it is not a v1 switch
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) gives Free accounts 5 million rows read per day, 100,000 rows written per day, and 5 GB total storage. These quotas are shared with other databases in the account. Exceeding daily query limits stops server sync until midnight UTC; local edits stay queued. Index writes and authentication/session queries also count
- A planning workload of 20 people logging 20 edits per day produces 400 operation rows per day. At an assumed 1 KiB per operation, activity payload grows by about 143 MiB per year before indexes and authentication data. This is a projection, not measured production usage. Device count, idle polling, note sizes, conflicts, and retries change query costs; inspect emitted D1 metrics instead of treating edit count as write count
- A local release dry run measured approximately 1.8 MiB of uncompressed Worker code and 330 KiB compressed; the main browser script was approximately 286 kB before compression. These are artifact measurements, not Free-account runtime CPU measurements
- Reproduce asset and Worker size measurements with `npm run build`, `npm run check:deploy`, and `du -sh dist .worker-dry-run`. Exercise authentication on the actual target plan and inspect CPU metrics before claiming Free compatibility. V1 has no causal-history compaction, so long-lived accounts eventually require a storage and client-memory strategy

The deployed account may use Workers Paid for reliable native password authentication. This does not require GitHub Actions billing: verification runs locally while Actions remains disabled.
