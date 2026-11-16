// Creates a fresh synthetic local database and invitations, never a remote connection.
import { getPlatformProxy } from "wrangler";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { migrate } from "./schema.mjs";
import { configure, invite } from "../admin.mjs";
import { PRICING } from "../protocol.mjs";

const state = resolve(process.argv[2]);
const proxy = await getPlatformProxy({
  configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
  persist: { path: join(state, "v3") },
  remoteBindings: false,
});
try {
  const db = proxy.env.AI_DB;
  await migrate(db); // Refuses an existing schema, so this cannot reset an existing ledger.
  await configure(db, {
    seats: 5,
    daily_limit: 10,
    minute_limit: 3,
    enrollment_open: true,
    funding: "paid",
    service_expires: "2035-01-01T00:00:00Z",
    credit_expires: null,
    credential_expires: null,
    day_usd: "1",
    month_usd: "10",
    lifetime_usd: "20",
    pricing_revision: PRICING.revision,
  });
  await db.prepare("UPDATE policy SET paused=0").run();
  const first = await invite(db, {}),
    second = await invite(db, { member: first.member });
  await mkdir(state, { recursive: true });
  await writeFile(
    join(state, "fixture.json"),
    JSON.stringify({ mocked: true, first, second }, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      mocked: true,
      state,
      fixture: join(state, "fixture.json"),
    }),
  );
} finally {
  await proxy.dispose();
}
