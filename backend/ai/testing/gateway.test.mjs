import assert from "node:assert/strict";
import { test, before, beforeEach, after } from "node:test";
import { getPlatformProxy } from "wrangler";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createWorker } from "../worker.mjs";
import { MODEL, PRICING, prepare, measured } from "../protocol.mjs";
import { configure, invite, reconcile } from "../admin.mjs";
import { migrate } from "./schema.mjs";
import { result } from "./mock.mjs";

let proxy, db, worker, hits, upstream;
const secret = () => randomBytes(32).toString("hex");
const form = (kind = "quiz", count = 3) => ({
  request_id: randomUUID(),
  kind,
  count,
  prompt: "Help me study momentum.",
  timezone: "Australia/Sydney",
  current_subject_id: null,
  sources: [
    {
      id: "Physics/momentum.md",
      title: "Momentum",
      subject_id: "physics",
      content:
        kind === "reminder"
          ? ""
          : "p = mv. Momentum is conserved in a closed system.",
    },
  ],
});
function call(route, who, body = {}, env = {}) {
  return worker.fetch(
    new Request("https://synapse.test/v1/" + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${who.device}.${who.token}`,
      },
      body: JSON.stringify(body),
    }),
    { AI_DB: db, OPENAI_SERVICE_KEY: "synthetic-service-key-only", ...env },
  );
}
async function reason(promise, expected) {
  const r = await promise;
  assert.notEqual(r.status, 200);
  assert.equal((await r.json()).error, expected);
}
async function enrollment(member) {
  const ticket = await invite(db, { member });
  const who = { member: ticket.member, device: randomUUID(), token: secret() };
  assert.equal(
    (await call("enroll", who, { invite: ticket.invitation })).status,
    200,
  );
  return who;
}
const conf = () => ({
  seats: 100,
  daily_limit: 10,
  minute_limit: 3,
  enrollment_open: true,
  funding: "paid",
  service_expires: "2035-01-01T00:00:00Z",
  credit_expires: null,
  credential_expires: null,
  day_usd: "10",
  month_usd: "100",
  lifetime_usd: "1000",
  pricing_revision: PRICING.revision,
});
before(async () => {
  proxy = await getPlatformProxy({
    configPath: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    persist: false,
  });
  db = proxy.env.AI_DB;
  await migrate(db);
});
after(async () => {
  await proxy?.dispose();
});
beforeEach(async () => {
  await db.batch(
    [
      "UPDATE policy SET paused=1,overrun=0",
      "DELETE FROM reconciliations",
      "DELETE FROM calls",
      "DELETE FROM devices",
      "DELETE FROM invites",
      "DELETE FROM daily",
      "DELETE FROM members",
      "DELETE FROM totals",
      "INSERT INTO totals VALUES ('lifetime',0)",
    ].map((sql) => db.prepare(sql)),
  );
  await configure(db, conf());
  await db.prepare("UPDATE policy SET paused=0").run();
  hits = [];
  upstream = async (_url, init) => Response.json(result(JSON.parse(init.body)));
  worker = createWorker({
    upstream: async (url, init) => {
      hits.push({ url, init });
      return upstream(url, init);
    },
  });
});
test("devices share one person allowance, including a re-enrolled replacement", async () => {
  const a = await enrollment(),
    b = await enrollment(a.member);
  await db
    .prepare("UPDATE members SET daily_limit=2 WHERE id=?")
    .bind(a.member)
    .run();
  assert.equal((await call("generate", a, form())).status, 200);
  assert.equal((await call("generate", b, form())).status, 200);
  const replacement = await enrollment(a.member);
  await reason(call("generate", replacement, form()), "daily_allowance");
  const s = await (await call("status", b)).json();
  assert.equal(s.remaining, 0);
  assert.equal(s.requests, 2);
  assert.equal(hits.length, 2);
});
test("one active generation per person is enforced atomically under concurrent submissions", async () => {
  const a = await enrollment(),
    b = await enrollment(a.member);
  let resolve;
  upstream = (_url, init) =>
    new Promise((r) => {
      resolve = () => r(Response.json(result(JSON.parse(init.body))));
    });
  const first = call("generate", a, form());
  while (!resolve) await new Promise((r) => setTimeout(r, 5));
  const denied = await Promise.all(
    Array.from({ length: 12 }, () => call("generate", b, form())),
  );
  for (const r of denied)
    assert.equal((await r.json()).error, "generation_active");
  resolve();
  assert.equal((await first).status, 200);
  assert.equal(hits.length, 1);
});
test("near daily boundary, concurrent devices cannot claim the last allowance twice", async () => {
  const a = await enrollment(),
    b = await enrollment(a.member);
  await db
    .prepare("UPDATE members SET daily_limit=1 WHERE id=?")
    .bind(a.member)
    .run();
  const results = await Promise.all([
    call("generate", a, form()),
    call("generate", b, form()),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(hits.length, 1);
  assert.equal(
    (
      await db
        .prepare("SELECT generations FROM daily WHERE member=?")
        .bind(a.member)
        .first()
    ).generations,
    1,
  );
});
test("shared budget reservation is atomic across identities and all three ceilings", async () => {
  for (const cap of ["day_cap", "month_cap", "lifetime_cap"]) {
    const a = await enrollment(),
      b = await enrollment();
    const f = form();
    // Each loop uses the current cumulative spend plus one full reservation, and stalls upstream.
    const existing = await db
      .prepare("SELECT amount FROM totals WHERE bucket='lifetime'")
      .first();
    const max = prepare(f, Math.floor(Date.now() / 1000)).reserve;
    await db
      .prepare(`UPDATE policy SET ${cap}=?`)
      .bind(existing.amount + max)
      .run();
    let release;
    upstream = (_url, init) =>
      new Promise((r) => {
        release = () => r(Response.json(result(JSON.parse(init.body))));
      });
    const pending = call("generate", a, f);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    await reason(call("generate", b, form()), "shared_budget");
    release();
    assert.equal((await pending).status, 200);
    await db.prepare(`UPDATE policy SET ${cap}=1000000000000`).run();
  }
  assert.equal(hits.length, 3);
});
test("duplicate IDs never call upstream twice, even from another device or after completion", async () => {
  const a = await enrollment(),
    b = await enrollment(a.member),
    f = form();
  assert.equal((await call("generate", a, f)).status, 200);
  await reason(call("generate", b, f), "already_submitted");
  await reason(
    call("generate", a, { ...f, prompt: "Changed content" }),
    "already_submitted",
  );
  assert.equal(hits.length, 1);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM calls").first()).n,
    1,
  );
});
test("interrupted upstream retains budget, quota and active lock; owner reconciliation uses evidence", async () => {
  const a = await enrollment(),
    f = form();
  upstream = async () => {
    throw Error("private payload and key must not escape");
  };
  await reason(call("generate", a, f), "upstream_unavailable");
  const c = await db.prepare("SELECT * FROM calls").first();
  assert.equal(c.charge, c.reserved);
  assert.equal(c.active, 1);
  await reason(call("generate", a, form()), "generation_active");
  await reason(call("generate", a, f), "already_submitted");
  await db.prepare("UPDATE policy SET paused=1").run();
  await reconcile(db, {
    member: a.member,
    request: f.request_id,
    amount: 0,
    record: "provider-reviewed:no-charge:1",
  });
  const after = await db.prepare("SELECT * FROM calls").first();
  assert.equal(after.active, 0);
  assert.equal(after.charge, 0);
  assert.equal(
    (await db.prepare("SELECT generations FROM daily").first()).generations,
    1,
  );
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM reconciliations").first()).n,
    1,
  );
});
test("missing usage retains conservative reserve; malformed output is still accounted", async () => {
  const a = await enrollment();
  upstream = async (_url, init) => {
    const r = result(JSON.parse(init.body));
    delete r.usage;
    return Response.json(r);
  };
  const good = await (await call("generate", a, form())).json();
  assert.equal(good.accounting, "reserved");
  const c = await db.prepare("SELECT * FROM calls").first();
  assert.equal(c.charge, c.reserved);
  assert.equal(c.active, 0);
  upstream = async (_url, init) => {
    const r = result(JSON.parse(init.body));
    r.output[0].content[0].text = '{"private":"not a quiz"}';
    return Response.json(r);
  };
  await reason(call("generate", a, form()), "invalid_output");
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM calls WHERE state='measured'")
        .first()
    ).n,
    1,
  );
});
test("overruns pause further admission, and cannot be resumed without owner review", async () => {
  const a = await enrollment(),
    b = await enrollment();
  upstream = async (_url, init) => {
    const r = result(JSON.parse(init.body));
    r.usage.input_tokens = 900000;
    return Response.json(r);
  };
  assert.equal((await call("generate", a, form())).status, 200);
  const p = await db.prepare("SELECT paused,overrun FROM policy").first();
  assert.deepEqual(p, { paused: 1, overrun: 1 });
  await reason(call("generate", b, form()), "service_paused");
  await assert.rejects(db.prepare("UPDATE policy SET paused=0").run());
});
test("revocation and disablement are checked on every device without resetting usage", async () => {
  const a = await enrollment(),
    b = await enrollment(a.member);
  assert.equal((await call("generate", a, form())).status, 200);
  await db
    .prepare("UPDATE devices SET revoked=1 WHERE id=?")
    .bind(a.device)
    .run();
  await reason(call("status", a), "revoked");
  assert.equal((await call("status", b)).status, 200);
  await db
    .prepare("UPDATE members SET state='disabled' WHERE id=?")
    .bind(a.member)
    .run();
  await reason(call("generate", b, form()), "revoked");
  await db
    .prepare("UPDATE members SET state='active' WHERE id=?")
    .bind(a.member)
    .run();
  assert.equal((await (await call("status", b)).json()).remaining, 9);
  await db
    .prepare("UPDATE members SET state='revoked' WHERE id=?")
    .bind(a.member)
    .run();
  await reason(call("status", b), "revoked");
  await assert.rejects(
    db
      .prepare("UPDATE members SET state='active' WHERE id=?")
      .bind(a.member)
      .run(),
  );
});
test("single-use invitations, lost reply recovery, expiry and capacity", async () => {
  const ticket = await invite(db, {}),
    a = { device: randomUUID(), token: secret() },
    b = { device: randomUUID(), token: secret() };
  assert.equal(
    (await call("enroll", a, { invite: ticket.invitation })).status,
    200,
  );
  assert.equal(
    (await call("enroll", a, { invite: ticket.invitation })).status,
    200,
  );
  await reason(
    call("enroll", b, { invite: ticket.invitation }),
    "invalid_invite",
  );
  const expired = await invite(db, { member: ticket.member });
  await db.prepare("UPDATE invites SET expires=unixepoch()-1").run();
  await reason(
    call("enroll", b, { invite: expired.invitation }),
    "invalid_invite",
  );
  await db.prepare("UPDATE policy SET seats=1").run();
  await assert.rejects(invite(db, {}));
  await db.prepare("UPDATE policy SET enrollment_open=0").run();
  const closed = await invite(db, { member: ticket.member });
  await reason(
    call("enroll", b, { invite: closed.invitation }),
    "enrollment_closed",
  );
});
test("service pause, credit expiry and credential expiry stop generation and health reports paused", async () => {
  const a = await enrollment();
  await db.prepare("UPDATE policy SET paused=1").run();
  await reason(call("generate", a, form()), "service_paused");
  await db.prepare("UPDATE policy SET paused=0").run();
  for (const sql of [
    "UPDATE policy SET funding='credit',credit_expires=unixepoch()-1",
    "UPDATE policy SET credential_expires=unixepoch()-1",
    "UPDATE policy SET service_expires=unixepoch()-1",
  ]) {
    await db.prepare(sql).run();
    await reason(call("generate", a, form()), "service_expired");
    const health = await worker.fetch(
      new Request("https://synapse.test/health"),
      { AI_DB: db, OPENAI_SERVICE_KEY: "synthetic" },
    );
    assert.equal((await health.json()).paused, true);
  }
  assert.equal(hits.length, 0);
});
test("server clock drives day resets; client clocks and price/model/token/identity overrides are rejected", async () => {
  const a = await enrollment();
  await db
    .prepare("INSERT INTO daily VALUES (?,date('now','-1 day'),10)")
    .bind(a.member)
    .run();
  const s = await (await call("status", a)).json();
  assert.equal(s.remaining, 10);
  assert.equal(s.reset_at, (Math.floor(s.server_time / 86400) + 1) * 86400);
  for (const [key, value] of Object.entries({
    model: "expensive",
    max_output_tokens: 90000,
    member: randomUUID(),
    price: 0,
    reference_time: "2099-01-01",
    endpoint: "https://attacker.invalid",
    tools: [],
  })) {
    await reason(
      call("generate", a, { ...form(), [key]: value }),
      "invalid_request",
    );
  }
  assert.equal(hits.length, 0);
  assert.equal((await call("generate", a, form())).status, 200);
  const sent = JSON.parse(hits[0].init.body);
  assert.equal(sent.model, MODEL);
  assert.equal(sent.max_output_tokens, 4096);
  assert.equal(sent.store, false);
  assert.equal(sent.service_tier, "default");
  assert.equal(sent.tools, undefined);
});
test("3 per minute applies across devices; retries and rejected inputs do not create extra accounting", async () => {
  const a = await enrollment(),
    b = await enrollment(a.member);
  for (let i = 0; i < 3; i++)
    assert.equal((await call("generate", i % 2 ? a : b, form())).status, 200);
  await reason(call("generate", a, form()), "rate_limit");
  const s = await (await call("status", b)).json();
  assert.equal(s.requests, 3);
  assert.ok(s.retry_at > s.server_time);
  await db.prepare("UPDATE calls SET created_at=unixepoch()-61").run();
  assert.equal((await call("generate", a, form())).status, 200);
});
test("schema guards and storage outages fail closed before upstream; settlement failure retains hold", async () => {
  const a = await enrollment();
  await reason(
    call("generate", a, form(), {
      AI_DB: {
        prepare() {
          throw Error("storage unavailable");
        },
      },
    }),
    "service_unavailable",
  );
  assert.equal(hits.length, 0);
  await db.prepare("DROP TRIGGER reconcile").run();
  await reason(call("generate", a, form()), "service_unavailable");
  assert.equal(hits.length, 0);
  const sql = await (
    await import("node:fs/promises")
  ).readFile(
    new URL("../migrations/0001_synapse.sql", import.meta.url),
    "utf8",
  );
  await db
    .prepare(
      sql
        .split(/^-- next\r?$/m)
        .find((s) => s.includes("CREATE TRIGGER reconcile"))
        .trim(),
    )
    .run();
  upstream = async (_url, init) => {
    await db
      .prepare(
        "CREATE TRIGGER fail_settle BEFORE UPDATE ON calls BEGIN SELECT RAISE(ABORT,'storage_failure'); END",
      )
      .run();
    return Response.json(result(JSON.parse(init.body)));
  };
  await reason(call("generate", a, form()), "service_unavailable");
  const c = await db.prepare("SELECT * FROM calls").first();
  assert.equal(c.state, "held");
  assert.equal(c.charge, c.reserved);
  await db.prepare("DROP TRIGGER fail_settle").run();
});
test("all supported operations validate task limits and no prompts or answers enter the ledger", async () => {
  const a = await enrollment();
  await reason(call("generate", a, form("quiz", 11)), "invalid_request");
  await reason(call("generate", a, form("flashcards", 21)), "invalid_request");
  const large = form();
  large.sources[0].content = "x".repeat(16001);
  await reason(call("generate", a, large), "invalid_request");
  for (const [kind, count] of [
    ["quiz", 10],
    ["flashcards", 20],
    ["reminder", 1],
  ])
    assert.equal((await call("generate", a, form(kind, count))).status, 200);
  const rows = JSON.stringify(
    (await db.prepare("SELECT * FROM calls").all()).results,
  );
  assert.ok(
    !rows.includes("Momentum") &&
      !rows.includes("Help me study") &&
      !rows.includes("p = mv") &&
      !rows.includes("Mass times velocity"),
  );
  assert.equal(hits.length, 3);
});
test("upstream rejections and model mismatch are accounted without exposing provider text", async () => {
  const a = await enrollment();
  upstream = async () =>
    Response.json(
      { error: { message: "private note sk-service-secret" } },
      { status: 429 },
    );
  await reason(call("generate", a, form()), "upstream_unavailable");
  const c = await db.prepare("SELECT * FROM calls").first();
  assert.equal(c.state, "conservative");
  assert.equal(c.charge, c.reserved);
  assert.equal(c.upstream_http, 429);
  upstream = async (_url, init) => {
    const r = result(JSON.parse(init.body));
    r.model = "unexpected-model";
    return Response.json(r);
  };
  await reason(call("generate", a, form()), "upstream_unavailable");
  assert.equal(
    (await db.prepare("SELECT paused FROM policy").first()).paused,
    1,
  );
});
test("owner configuration requires pause, reviewed pricing and explicit future expiry; no reset side effects", async () => {
  const a = await enrollment();
  assert.equal((await call("generate", a, form())).status, 200);
  await assert.rejects(configure(db, conf()));
  await db.prepare("UPDATE policy SET paused=1").run();
  await assert.rejects(
    configure(db, { ...conf(), service_expires: "2000-01-01T00:00:00Z" }),
  );
  await assert.rejects(
    configure(db, { ...conf(), pricing_revision: "unreviewed" }),
  );
  await configure(db, { ...conf(), daily_limit: 15 });
  assert.equal(
    (await db.prepare("SELECT generations FROM daily").first()).generations,
    1,
  );
  assert.equal(
    (await db.prepare("SELECT paused FROM policy").first()).paused,
    1,
  );
});
test("metering counts reasoning output, discounts only valid cached tokens, and rejects missing usage", () => {
  assert.equal(
    measured({ input_tokens: 100, output_tokens: 200 }).cost,
    100 * 750 + 200 * 4500,
  );
  assert.equal(
    measured({
      input_tokens: 100,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 101 },
    }).cost,
    100 * 750 + 4500,
  );
  assert.equal(
    measured({
      input_tokens: 100,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 50 },
    }).cost,
    50 * 750 + 50 * 75 + 4500,
  );
  assert.equal(measured(null), null);
});

test("partial usage never releases the active reservation; unexpected service tier pauses", async () => {
  const a = await enrollment();
  upstream = async (_url, init) => {
    const r = result(JSON.parse(init.body));
    r.status = "in_progress";
    return Response.json(r);
  };
  await reason(call("generate", a, form()), "invalid_output");
  const c = await db.prepare("SELECT * FROM calls").first();
  assert.equal(c.charge, c.reserved);
  assert.equal(c.active, 1);
  assert.equal(c.state, "conservative");
  const b = await enrollment();
  upstream = async (_url, init) => {
    const r = result(JSON.parse(init.body));
    r.service_tier = "priority";
    return Response.json(r);
  };
  await reason(call("generate", b, form()), "upstream_unavailable");
  assert.equal(
    (await db.prepare("SELECT paused FROM policy").first()).paused,
    1,
  );
});

test("expiry during upload is checked against D1 at admission", async () => {
  const a = await enrollment();
  let finish;
  const body = new ReadableStream({
    start(controller) {
      finish = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(form())));
        controller.close();
      };
    },
  });
  const pending = worker.fetch(
    new Request("https://synapse.test/v1/generate", {
      method: "POST",
      duplex: "half",
      headers: {
        Authorization: `Bearer ${a.device}.${a.token}`,
        "Content-Type": "application/json",
      },
      body,
    }),
    { AI_DB: db, OPENAI_SERVICE_KEY: "synthetic" },
  );
  await db.prepare("UPDATE policy SET service_expires=unixepoch()-1").run();
  finish();
  await reason(pending, "service_expired");
  assert.equal(hits.length, 0);
});

test("no unauthenticated inference or public owner API; missing service key fails closed", async () => {
  const unauthenticated = await worker.fetch(
    new Request("https://synapse.test/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form()),
    }),
    { AI_DB: db, OPENAI_SERVICE_KEY: "synthetic" },
  );
  assert.equal(unauthenticated.status, 403);
  const admin = await worker.fetch(
    new Request("https://synapse.test/admin/resume", { method: "POST" }),
    { AI_DB: db },
  );
  assert.equal(admin.status, 404);
  const a = await enrollment();
  await reason(
    call("generate", a, form(), { OPENAI_SERVICE_KEY: "" }),
    "service_unavailable",
  );
  assert.equal(hits.length, 0);
});

test("fresh migration starts paused with no funding, enrollment or spending capacity", async () => {
  const fresh = await getPlatformProxy({
    configPath: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    persist: false,
  });
  try {
    await migrate(fresh.env.AI_DB);
    const p = await fresh.env.AI_DB.prepare("SELECT * FROM policy").first();
    assert.equal(p.paused, 1);
    assert.equal(p.enrollment_open, 0);
    assert.equal(p.funding, "unconfigured");
    assert.equal(p.day_cap + p.month_cap + p.lifetime_cap, 0);
    await assert.rejects(
      fresh.env.AI_DB.prepare("UPDATE policy SET paused=0").run(),
    );
  } finally {
    await fresh.dispose();
  }
});
