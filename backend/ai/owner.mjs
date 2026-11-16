import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { configure, invite, reconcile, dollars } from "./admin.mjs";
import { PRICING, UUID, requireThat } from "./protocol.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes("--" + name);
const option = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? fallback : args[i + 1];
};
const target = option("target", "local");
const configPath = join(root, "wrangler.jsonc");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
function invoke(args) {
  const run = spawnSync(
    process.execPath,
    [wrangler, ...args, "--config", configPath],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  // Do not echo Wrangler diagnostics which could include credentials or SQL literals.
  if (run.status !== 0)
    throw Error(
      "Wrangler operation failed. Check authentication, the Synapse target and policy; no upstream request was made.",
    );
  const out = run.stdout;
  const start = out.indexOf("[");
  if (start < 0) throw Error("Wrangler returned an unexpected result.");
  return JSON.parse(out.slice(start));
}
function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
  throw Error("Unsupported SQL argument.");
}
const db = {
  prepare(sql) {
    const stmt = {
      sql,
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        return (await db.batch([this]))[0].results[0] ?? null;
      },
      async run() {
        return (await db.batch([this]))[0];
      },
    };
    return stmt;
  },
  async batch(statements) {
    // Query API preserves RETURNING rows (remote --file uses the import API instead).
    // Structured argv, no shell. Only opaque IDs, hashes and policy/usage metadata here.
    const sql = statements
      .map((s) => {
        let n = 0;
        const result = s.sql.replace(/\?/g, () => literal(s.values[n++]));
        requireThat(n === s.values.length);
        return result + ";";
      })
      .join("\n");
    return invoke([
      "d1",
      "execute",
      "AI_DB",
      "--" + target,
      "--command",
      sql,
      "--json",
      ...(target === "local" && option("persist-to")
        ? ["--persist-to", resolve(option("persist-to"))]
        : []),
    ]);
  },
};
async function main() {
  requireThat(
    ["local", "remote"].includes(target),
    "Use --target local or remote.",
  );
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
  requireThat(
    config.name === "synapse-ai" &&
      config.d1_databases?.length === 1 &&
      config.d1_databases[0].database_name === "synapse-ai" &&
      config.d1_databases[0].binding === "AI_DB",
    "Refusing a non-Synapse target.",
  );
  if (target === "remote") {
    requireThat(
      config.d1_databases[0].database_id !==
        "00000000-0000-0000-0000-000000000000",
      "Create a dedicated Synapse D1 database and set its ID first.",
    );
    const databases = invoke(["d1", "list", "--json"]);
    requireThat(
      databases.some(
        (database) =>
          database.uuid === config.d1_databases[0].database_id &&
          database.name === "synapse-ai",
      ),
      "The configured UUID is not a remote database named synapse-ai. Refusing to touch another application's database.",
    );
  }
  const member = option("member"),
    device = option("device");
  if (command === "check-target")
    return {
      target,
      worker: config.name,
      database: config.d1_databases[0].database_name,
    };
  if (command === "pause")
    return db
      .prepare("UPDATE policy SET paused=1 WHERE id=1 RETURNING paused")
      .first();
  if (command === "configure") {
    await configure(db, JSON.parse(await readFile(option("file"), "utf8")));
    return { configured: true, paused: true };
  }
  if (command === "resume") {
    requireThat(
      flag("funding-reviewed") &&
        flag("pricing-reviewed") &&
        flag("credential-reviewed"),
      "Resume requires --funding-reviewed --pricing-reviewed --credential-reviewed after the setup checks.",
    );
    if (target === "remote")
      requireThat(
        invoke(["secret", "list"]).some((s) => s.name === "OPENAI_SERVICE_KEY"),
        "Set the dedicated Synapse service key with wrangler secret put first.",
      );
    const row = await db
      .prepare(
        "UPDATE policy SET paused=0 WHERE id=1 AND paused=1 AND overrun=0 AND pricing_revision=? RETURNING paused",
      )
      .bind(PRICING.revision)
      .first();
    requireThat(
      row,
      "Policy is already active, has an unresolved overrun, or pricing is unreviewed.",
    );
    return row;
  }
  if (command === "invite") {
    requireThat(
      flag("new-person") !== !!member,
      "Choose --new-person once per verified person, or --member ID for another device.",
    );
    return invite(db, { member, minutes: Number(option("minutes", "10")) });
  }
  if (command === "members")
    return (await db.prepare("SELECT * FROM members ORDER BY created_at").run())
      .results;
  if (command === "devices") {
    requireThat(UUID.test(member));
    return (
      await db
        .prepare(
          "SELECT id,member,revoked,created_at FROM devices WHERE member=?",
        )
        .bind(member)
        .run()
    ).results;
  }
  if (["disable-user", "enable-user", "revoke-user"].includes(command)) {
    requireThat(UUID.test(member));
    const state = {
      "disable-user": "disabled",
      "enable-user": "active",
      "revoke-user": "revoked",
    }[command];
    return db
      .prepare("UPDATE members SET state=? WHERE id=? RETURNING id,state")
      .bind(state, member)
      .first();
  }
  if (command === "revoke-device") {
    requireThat(UUID.test(device));
    return db
      .prepare("UPDATE devices SET revoked=1 WHERE id=? RETURNING id,revoked")
      .bind(device)
      .first();
  }
  if (command === "allowance") {
    requireThat(UUID.test(member));
    const value =
      option("daily") === "default" ? null : Number(option("daily"));
    requireThat(
      value === null ||
        (Number.isInteger(value) && value >= 1 && value <= 1000),
    );
    return db
      .prepare(
        "UPDATE members SET daily_limit=? WHERE id=? RETURNING id,daily_limit",
      )
      .bind(value, member)
      .first();
  }
  if (command === "usage") {
    const rows = await db.batch([
      db.prepare("SELECT *,unixepoch() AS server_time FROM policy WHERE id=1"),
      db.prepare(
        "SELECT bucket,amount AS estimated_and_reserved_nusd FROM totals ORDER BY bucket",
      ),
      db.prepare(
        "SELECT state,count(*) AS requests,sum(charge) AS estimated_or_reserved_nusd,sum(active) AS unresolved_active FROM calls GROUP BY state",
      ),
      db.prepare(
        "SELECT member,request_id,device,created_at,model,state,reserved,charge,active,upstream_http,provider_id FROM calls WHERE state IN ('held','conservative') OR active=1 ORDER BY created_at",
      ),
    ]);
    return {
      policy: rows[0].results[0],
      buckets: rows[1].results,
      usage: rows[2].results,
      outstanding: rows[3].results,
    };
  }
  if (command === "ledger")
    return (
      await db
        .prepare("SELECT * FROM calls ORDER BY created_at DESC LIMIT 1000")
        .run()
    ).results;
  if (command === "reconcile") {
    requireThat(
      flag("provider-record-reviewed") && flag("terminal-reviewed"),
      "Review provider records and confirm the request has stopped before reconciling.",
    );
    await reconcile(db, {
      member,
      request: option("request"),
      amount: option("usd") === "0" ? 0 : dollars(option("usd")),
      record: option("record"),
    });
    return { reconciled: true, paused: true };
  }
  if (command === "ack-overrun") {
    requireThat(
      flag("provider-record-reviewed"),
      "Review and reconcile the overrun first.",
    );
    return db
      .prepare(
        "UPDATE policy SET overrun=0 WHERE id=1 AND paused=1 RETURNING paused,overrun",
      )
      .first();
  }
  throw Error(
    "Commands: check-target, usage, ledger, members, devices, configure --file, pause, resume, invite, disable-user, enable-user, revoke-user, revoke-device, allowance, reconcile, ack-overrun. Default target: local. See README.md.",
  );
}
main()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
