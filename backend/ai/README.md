# Owner-managed AI service

Private owner billing and activation records were removed before public release. The historical contract and setup guide below describe this revision; see the latest release for current service availability. No service credentials are distributed.

## Contract and limits

Authenticated participant endpoints are `POST /v1/enroll`, `/v1/status`, `/v1/generate` and `/v1/forget`. Public `/health` returns only the service name and effective pause state. There are no owner HTTP endpoints, arbitrary model calls, uploads, tools or configurable upstream URLs. Rust owns network requests and credential access.

| Policy | Initial application default |
| --- | --- |
| Generations per person per UTC day | 10; owner may override per person |
| Submitted generations per rolling 60 seconds | 3 across that person's devices |
| Active generations | 1 per person, including unresolved interrupted requests |
| Invitation lifetime | 10 minutes; configurable from 1–60 minutes |
| Capacity | 5 people initially; owner-configurable, including disabled identities |
| Quiz | 1–10 questions; 4,096 output tokens |
| Flashcards | 1–20 cards; 4,096 output tokens |
| Reminder | 1 draft; titles/references only; 768 output tokens |
| Source text | 20 notes, 16,000 UTF-8 body bytes each, 60,000 bytes total |
| Request limits | 2,000-byte prompt, 96 KiB HTTP body; 100,000-byte upstream payload, 18,000 bytes for reminders |
| Upstream attempts | One per admitted ID; no automatic retry |
| Spending | Owner-configured daily, monthly **and cumulative** ceilings |
| Expiry | Earliest configured service, credit or credential deadline |

The server pins `gpt-5.4-mini-2026-03-17`, Standard processing, global `https://api.openai.com/v1/responses`, `store:false`, no tools and no reasoning effort. It builds strict task schemas and validates output. Rust independently verifies shape, source membership and source revisions before displaying an editable draft. Only an explicit save persists it. Saved reminder scheduling and delivery are local and consume no further AI allowance.

Pricing is reviewed server code in `protocol.mjs`, revision `2026-11-16-gpt54mini-v1`: **750 nano-USD/input token, 75/cached input token, 4,500/output token**, equivalent to US$0.75 / $0.075 / $4.50 per million. Checked against the [official model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini) on 16 November 2026. These rates apply only to this pinned model, endpoint and processing mode. Pause and review pricing/reservation arithmetic before changing them, then update the revision, tests, deployment and owner policy. Admission assumes no grant, cache discount or promotional coverage.

## Identity and privacy

The owner verifies each person privately and maintains a roster mapping them to an opaque member UUID. D1 stores no names or email addresses. Use `invite --new-person` **once per verified person**. For a reinstall, another PC or a lost credential, verify the same person and use `invite --member ID`. Never create a new identity as recovery for an existing person. Editing local settings cannot reset usage or create a server identity.

Invitations have 256 random bits; only SHA-256 hashes are stored. D1 atomically consumes an invitation and attaches the device to its member. The desktop creates a separate 256-bit device credential and saves it in Windows Credential Manager before submitting enrollment. A lost reply can be retried with that same invitation and protected credential. Another device cannot reuse it. Revocation/disablement is checked on every call and atomically at admission. A request already submitted upstream may finish. Disabling a member is reversible; revocation is permanent.

Personal OpenAI keys retain their original Credential Manager entry. Hosted credentials use a separate entry bound to the build's public gateway origin. No key or device credential is included in ordinary settings, vaults or portable subject packages. **Revoke this device** revokes server access before deleting the local credential. **Forget hosted access on this PC** is an explicitly separate local deletion; it neither resets usage nor revokes a lost server credential.

Before activation, users accept a notice that selected content passes through Synapse to OpenAI. Only selected note bodies, task request, titles/references and timezone are sent; reminders omit bodies. D1 stores only opaque identities, invitation/device hashes, request IDs, timestamps, model/pricing revision, quota/usage amounts and provider response IDs for reconciliation. It stores no prompts, note bodies, generated answers, selected filenames or plaintext secrets. Routine Worker logging/tracing is disabled. OpenAI's [data controls and retention](https://developers.openai.com/api/docs/guides/your-data) still apply; `store:false` does not mean zero provider retention.

## Accounting and failure behavior

The `calls` insert and its SQLite triggers validate policy, revocation, server-clock daily/rate limits, the active lock and all three shared budgets, then reserve quota and spending **atomically**. D1 [transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/) also settle usage and policy changes together. Missing guards, missing policy/totals or unavailable storage fail closed.

Each reservation covers one input token per UTF-8 byte of the entire upstream JSON plus 4,096 tokens of framing headroom, and the full output token cap including reasoning. Integer nano-USD amounts avoid floating-point balance arithmetic. Reported usage reconciles against the request's original UTC day/month and cumulative totals. Invalid/missing cached-token detail receives no discount. Every admitted attempt consumes a generation, including rejected or invalid results. Reconciliation does not refund quota.

The `(member, request_id)` ledger entry persists across devices and resets. Duplicates return `already_submitted` without a second upstream call or accounting entry. Results are deliberately not cached: an interrupted draft cannot be replayed. The desktop never retries automatically; a new explicit generation uses a new ID and allowance.

Missing usage, invalid JSON, rejected requests, redirects, cancellation, transport failures and timeouts keep a conservative hold. Confirmed terminal responses release the active lock. Uncertain submission/termination retains **both** the hold and active lock until owner review; there is no timed refund or automatic lock release. A 20-second upstream timeout and Worker `waitUntil` let accounting continue after desktop disconnection. A process crash may leave a hold; it cannot enable an unaccounted retry. An overrun or model/token-policy mismatch atomically pauses admissions and latches an owner-review flag.

Amounts are **usage-based estimates/reservations, not posted OpenAI charges or a provider-enforced financial guarantee**. Taxes, currency conversion and pricing outside the reviewed contract are not modeled. Regularly compare the dedicated project's Usage/Costs records with the ledger, especially after uncertain attempts. Verify provider-side controls separately; never assume a UI budget is enforced. No code enables billing, purchases credit, renews grants or extends expiry.

## Local verification

Use Node 24 or newer. From the Synapse root:

```powershell
npm ci --prefix backend/ai
npm run test:hosted
```

Automated tests use the actual local D1 implementation with mocked OpenAI responses. To run an isolated local Worker, choose a **fresh** directory; bootstrap refuses an existing schema:

```powershell
$qaState = Join-Path (Get-Location) '.local/hosted-trial/state'
node backend/ai/testing/bootstrap.mjs $qaState
node backend/ai/node_modules/wrangler/bin/wrangler.js dev --config backend/ai/testing/wrangler.jsonc --local --persist-to $qaState --ip 127.0.0.1 --port 18797
```

The synthetic invitation is in `state/fixture.json`. To exercise the desktop manually, close the normally installed app, then in another terminal:

```powershell
$env:SYNAPSE_TEST_HOSTED_URL = 'http://127.0.0.1:18797'
$env:SYNAPSE_TEST_DEVICE_DIR = Join-Path (Get-Location) '.local/hosted-trial/device'
npm run tauri dev -- --features test-api
```

Endpoint overrides require **both** debug mode and `test-api`; only loopback HTTP origins are accepted. Test credentials use separate Credential Manager entries. Hosted-only test mode refuses personal-key network calls unless the existing separate personal API mock is configured. Release builds ignore all test endpoint overrides. Production `wrangler.jsonc` never imports the mock entrypoint. Do not use personal notes or a production invitation for local fixtures.

## Prepare a separate live deployment

The current deployment above is already active and its owner trial is complete. These bootstrap instructions describe a new deployment; they are not a reason to recreate the current database, identity or paid trial.

1. Create a **dedicated OpenAI project and service account for Synapse**. Review data settings, available funding, exact grant expiry, service/key expiry and actual provider spend controls. Restrict the key to Responses creation and the pinned model where supported. Never put it in chat, source, desktop settings, command arguments or packages. Calendar's project/key/database must remain separate.
2. For a new deployment, authenticate as the owner and create a dedicated D1 database, then put its verified UUID into `wrangler.jsonc`. The current Synapse database above already exists: do not recreate it or reapply the bootstrap as a spending reset. The CLI rejects placeholder or mismatched database IDs.

```powershell
cd backend/ai
npm ci
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write d1:write
npx wrangler whoami
npx wrangler d1 create synapse-ai
# Edit this directory's wrangler.jsonc with the new Synapse database UUID.
node owner.mjs check-target --target remote
npx wrangler d1 migrations apply AI_DB --remote --config wrangler.jsonc
node node_modules/wrangler/bin/wrangler.js deploy --config wrangler.jsonc
# In a separate private PowerShell 7 window, paste the key at the hidden prompt:
pwsh -NoProfile -File ./set-service-key.ps1
node owner.mjs usage --target remote
```

The private helper verifies the remote database identity before accepting a SecureString, sends the key only through Wrangler's redirected stdin, suppresses child output and clears its transient character buffer. It writes no key file, argument or environment variable. Do not capture the reveal dialog, terminal input or clipboard. After entry, navigate away from the provider reveal page before any automation observation. Verify only `wrangler secret list`, masked provider metadata and deployment IDs. On this workstation, invoke Wrangler directly from `backend/ai`; `npm --prefix` can prevent discovery of the installed encrypted-auth keyring.

3. For a fresh deployment, check `/health`: service must be `synapse-ai`, paused must be true. Copy `owner-config.example.json` to ignored `owner-config.json` only for a new installation; do not overwrite the current applied policy. The example's deadlines are intentionally invalid until reviewed. Choose all three ceilings explicitly; example amounts are suggestions, not active defaults. Use `funding:"credit"` with a verified grant deadline, or an explicitly owner-approved earlier funding cutoff tied to a currently verified balance and documented as such. Never claim the latter is the provider's precise expiry. Use `"paid"` only for previously authorized funding, with `credit_expires:null`. Always set a finite `service_expires`, and set `credential_expires` when applicable. Dates are exact UTC instants, `YYYY-MM-DDTHH:mm:ssZ`. No grace period or assumed renewal applies. Configure while paused:

```powershell
node owner.mjs configure --target remote --file owner-config.json
node owner.mjs usage --target remote
```

4. Build the desktop using only the **public HTTPS origin**, with no credentials, path, query or fragment. Leaving it unset produces the honest "not configured" state with local and personal-key features intact.

```powershell
cd ../..
$env:SYNAPSE_AI_URL = 'https://synapse-ai.nottbradd.workers.dev'
npm run tauri build
Remove-Item Env:SYNAPSE_AI_URL
```

5. Review funding, model access, pricing and ceilings before resuming. `resume` checks that the remote secret exists, but cannot prove it is valid, funded or permitted. Start with one fictional owner-only generation under chosen small limits; inspect provider usage/charges before inviting participants. No automated test calls the live provider.

```powershell
cd backend/ai
node owner.mjs resume --target remote --funding-reviewed --pricing-reviewed --credential-reviewed
node owner.mjs invite --target remote --new-person --minutes 10
# Use that private invitation in Synapse with fictional notes only.
node owner.mjs usage --target remote
node owner.mjs ledger --target remote
node owner.mjs revoke-user --target remote --member MEMBER_UUID
# Leave paused if participant rollout is not yet intended:
node owner.mjs pause --target remote
```

Record the deployment URL/version, provider outcome and whether posted charges/credit application were actually confirmed. A successful mock, secret-presence check, enrollment or status call is not a successful provider/billing check.

## Protected owner controls

The CLI uses authenticated Wrangler owner access; participants never receive it. Target defaults to **local**; remote operations require `--target remote`. A local custom database uses `--persist-to ABSOLUTE_PATH`. The CLI checks the Synapse name/binding, rejects the placeholder ID, and checks Cloudflare's remote database inventory to verify that the configured UUID belongs to a database actually named `synapse-ai`. It refuses an ID belonging to another application. Protect Cloudflare owner access with appropriate permissions and MFA.

```powershell
node owner.mjs members --target remote
node owner.mjs invite --target remote --member MEMBER_UUID --minutes 10
node owner.mjs devices --target remote --member MEMBER_UUID
node owner.mjs disable-user --target remote --member MEMBER_UUID
node owner.mjs enable-user --target remote --member MEMBER_UUID
node owner.mjs revoke-user --target remote --member MEMBER_UUID
node owner.mjs revoke-device --target remote --device DEVICE_UUID
node owner.mjs allowance --target remote --member MEMBER_UUID --daily 10
node owner.mjs allowance --target remote --member MEMBER_UUID --daily default
node owner.mjs usage --target remote
node owner.mjs ledger --target remote
node owner.mjs pause --target remote
```

Adjust capacity, enrollment, global allowances and shared ceilings by pausing, editing the reviewed config and applying `configure`. It preserves all identities, quotas, calls and totals. Disabled users retain a seat; revoked users cannot be re-enabled. Recovery invitations use the original member.

To reconcile an uncertain call, pause, inspect its provider response ID and the dedicated project's records, and confirm upstream termination. Never release a hold solely because it is old or no charge is visible yet. A zero-dollar adjustment requires evidence of no charge. Record a later higher charge too. The short reference must contain no personal content.

```powershell
node owner.mjs reconcile --target remote --member MEMBER_UUID --request REQUEST_UUID --usd 0.00125 --record PROVIDER_RECORD_ID --provider-record-reviewed --terminal-reviewed
node owner.mjs usage --target remote
# Only after correcting the cause and reviewing affected provider records:
node owner.mjs ack-overrun --target remote --provider-record-reviewed
```

**Credential rotation:** pause; create a replacement in the Synapse OpenAI project; use the private `set-service-key.ps1` helper; revoke the old key at OpenAI; update its expiry with `configure`; verify funding/access; explicitly resume. A later key expiry never extends an earlier credit deadline. Extending service requires explicitly verified replacement funding and changed dates. Cumulative accounting is never reset.

Back up D1 before migrations. Do not delete the ledger to unblock spending. Minimal idempotency/accounting records are retained indefinitely in this initial version; any future pruning needs a reviewed archive strategy that preserves duplicate prevention and cumulative totals.
