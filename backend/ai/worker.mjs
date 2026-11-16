import {
  Denied,
  requireThat,
  exact,
  UUID,
  TOKEN,
  MODEL,
  PRICING,
  LIMITS,
  prepare,
  decode,
  measured,
} from "./protocol.mjs";

const failures = {
  invalid_request: 400,
  too_large: 413,
  invalid_invite: 403,
  revoked: 403,
  enrollment_closed: 403,
  seats_full: 409,
  already_submitted: 409,
  generation_active: 409,
  rate_limit: 429,
  daily_allowance: 429,
  shared_budget: 429,
  service_paused: 503,
  service_expired: 503,
  service_unavailable: 503,
  upstream_unavailable: 503,
  invalid_output: 502,
};
export const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function hash(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("");
}
async function json(message, limit) {
  requireThat(
    message.headers.get("content-type")?.split(";")[0] === "application/json",
  );
  requireThat(
    Number(message.headers.get("content-length") || 0) <= limit,
    "too_large",
  );
  const reader = message.body?.getReader();
  requireThat(reader);
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Denied("too_large");
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw error instanceof Denied ? error : new Denied("invalid_request");
  }
}
function serviceReason(p, keyPresent = true) {
  if (
    p.service_expires <= p.now ||
    (p.funding === "credit" && !(p.credit_expires > p.now)) ||
    (p.credential_expires !== null && p.credential_expires <= p.now)
  )
    return "service_expired";
  if (p.paused || p.overrun) return "service_paused";
  if (
    !keyPresent ||
    p.funding === "unconfigured" ||
    p.pricing_revision !== PRICING.revision ||
    p.day_cap <= 0 ||
    p.month_cap <= 0 ||
    p.lifetime_cap <= 0
  )
    return "service_unavailable";
  return null;
}
async function policy(db) {
  const p = await db
    .prepare("SELECT *,unixepoch() AS now FROM policy WHERE id=1")
    .first();
  requireThat(p, "service_unavailable");
  return p;
}
async function guardSchema(db) {
  const result = await db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('reserve','reconcile','enroll','member_capacity','member_revocation','activation')",
    )
    .first();
  requireThat(result?.n === 6, "service_unavailable");
}
async function authenticate(db, device, verifier) {
  const member = await db
    .prepare(
      "SELECT m.id,COALESCE(m.daily_limit,p.daily_limit) AS allowance FROM devices d JOIN members m ON m.id=d.member JOIN policy p ON p.id=1 WHERE d.id=? AND d.verifier=? AND d.revoked=0 AND m.state='active'",
    )
    .bind(device, verifier)
    .first();
  requireThat(member, "revoked");
  return member;
}
async function enroll(db, request, device, verifier) {
  const form = await json(request, 256);
  requireThat(exact(form, ["invite"]) && TOKEN.test(form.invite));
  const ticket = await hash("invite:" + form.invite);
  // Lost enrollment replies can be retried only by the original device credential.
  const old = await db
    .prepare(
      "SELECT d.*,m.state AS member_state FROM devices d JOIN members m ON m.id=d.member WHERE d.id=?",
    )
    .bind(device)
    .first();
  if (old) {
    requireThat(
      !old.revoked &&
        old.member_state === "active" &&
        old.verifier === verifier &&
        old.invite_hash === ticket,
      "invalid_invite",
    );
    return reply({ member: old.member, device });
  }
  await guardSchema(db);
  const row = await db
    .prepare(
      "INSERT INTO devices(id,member,verifier,invite_hash) SELECT ?,member,?,hash FROM invites WHERE hash=? AND expires>unixepoch() RETURNING member",
    )
    .bind(device, verifier, ticket)
    .first();
  requireThat(row, "invalid_invite");
  return reply({ member: row.member, device });
}
export async function status(db, member, device, keyPresent) {
  const p = await policy(db);
  const day = new Date(p.now * 1000).toISOString().slice(0, 10);
  const rows = await db.batch([
    db
      .prepare("SELECT generations FROM daily WHERE member=? AND day=?")
      .bind(member.id, day),
    db
      .prepare(
        "SELECT bucket,amount FROM totals WHERE bucket IN (?,?,'lifetime')",
      )
      .bind(day, day.slice(0, 7)),
    db
      .prepare(
        "SELECT sum(active) AS active,sum(CASE WHEN state IN ('held','conservative') THEN charge ELSE 0 END) AS reserved,sum(input_tokens) AS input,sum(output_tokens) AS output,count(*) AS requests,sum(charge) AS estimate FROM calls WHERE member=?",
      )
      .bind(member.id),
    db
      .prepare(
        "SELECT count(*) AS n,min(created_at)+60 AS retry_at FROM calls WHERE member=? AND created_at>?",
      )
      .bind(member.id, p.now - 60),
  ]);
  const usage = rows[2].results[0],
    recent = rows[3].results[0];
  const used = rows[0].results[0]?.generations ?? 0;
  const totals = Object.fromEntries(
    rows[1].results.map((r) => [r.bucket, r.amount]),
  );
  requireThat(Object.hasOwn(totals, "lifetime"), "service_unavailable");
  let reason = serviceReason(p, keyPresent);
  if (
    !reason &&
    ((totals[day] ?? 0) >= p.day_cap ||
      (totals[day.slice(0, 7)] ?? 0) >= p.month_cap ||
      totals.lifetime >= p.lifetime_cap)
  )
    reason = "shared_budget";
  if (!reason && used >= member.allowance) reason = "daily_allowance";
  if (!reason && usage.active) reason = "generation_active";
  if (!reason && recent.n >= p.minute_limit) reason = "rate_limit";
  return {
    member: member.id,
    device,
    server_time: p.now,
    reason,
    remaining: Math.max(0, member.allowance - used),
    daily_limit: member.allowance,
    reset_at: (Math.floor(p.now / 86400) + 1) * 86400,
    retry_at: recent.n >= p.minute_limit ? recent.retry_at : null,
    requests: usage.requests,
    input_tokens: usage.input ?? 0,
    output_tokens: usage.output ?? 0,
    estimated_nusd: usage.estimate ?? 0,
    reserved_nusd: usage.reserved ?? 0,
    active: !!usage.active,
    model: MODEL,
    limits: LIMITS,
  };
}
async function generate(db, request, env, member, device, upstream) {
  const form = await json(request, 98304);
  const p = await policy(db);
  const reason = serviceReason(p, !!env.OPENAI_SERVICE_KEY);
  requireThat(!reason, reason);
  const call = prepare(form, p.now);
  await guardSchema(db);
  // A single statement and its triggers reserve quota AND all three budget buckets.
  // Every upstream attempt has exactly one immutable idempotency record, retained indefinitely.
  const admitted = await db
    .prepare(
      "INSERT INTO calls(member,request_id,device,kind,model,pricing_revision,reserved,charge) VALUES (?,?,?,?,?,?,?,?) RETURNING created_at",
    )
    .bind(
      member.id,
      form.request_id,
      device,
      form.kind,
      MODEL,
      PRICING.revision,
      call.reserve,
      call.reserve,
    )
    .first();
  requireThat(admitted, "service_unavailable");
  // Recheck expiry/pause/revocation after upload/admission; any failure retains the hold.
  const current = await policy(db);
  requireThat(!serviceReason(current), serviceReason(current));
  await authenticate(
    db,
    device,
    await hash("device:" + request.headers.get("Authorization").split(".")[1]),
  );
  let response, result;
  try {
    response = await upstream("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.OPENAI_SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: call.body,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    // Never follow redirects or retry. No raw provider errors or request text are logged/stored.
    if (!response.ok) {
      await db
        .prepare(
          "UPDATE calls SET state='conservative',active=?,upstream_http=? WHERE member=? AND request_id=? AND state='held'",
        )
        .bind(
          response.status >= 500 ? 1 : 0,
          response.status,
          member.id,
          form.request_id,
        )
        .run();
      throw new Denied("upstream_unavailable");
    }
    result = await json(response, 262144);
  } catch {
    throw new Denied("upstream_unavailable");
  } // Unknown billing/termination retains full hold AND active lock.
  const knownModel = result.model === MODEL;
  const knownTier =
    result.service_tier == null || result.service_tier === "default";
  const providerId =
    typeof result.id === "string" &&
    /^resp_[A-Za-z0-9_-]{1,150}$/.test(result.id)
      ? result.id
      : null;
  const terminal = ["completed", "failed", "incomplete", "cancelled"].includes(
    result.status,
  );
  // Partial receipts cannot release headroom while upstream may still be generating.
  const meter =
    knownModel && knownTier && terminal ? measured(result.usage) : null;
  const mismatch =
    !knownModel ||
    !knownTier ||
    (meter && meter.output > LIMITS[form.kind].output);
  const settlement = await db.batch([
    db
      .prepare(
        "UPDATE calls SET state=?,charge=?,active=?,input_tokens=?,output_tokens=?,upstream_http=?,provider_id=? WHERE member=? AND request_id=? AND state='held' RETURNING state",
      )
      .bind(
        meter ? "measured" : "conservative",
        meter?.cost ?? call.reserve,
        terminal ? 0 : 1,
        meter?.input ?? null,
        meter?.output ?? null,
        response.status,
        providerId,
        member.id,
        form.request_id,
      ),
    db
      .prepare("UPDATE policy SET paused=1,overrun=1 WHERE id=1 AND ?=1")
      .bind(Number(!!mismatch)),
  ]);
  requireThat(settlement[0].results.length === 1, "service_unavailable");
  if (mismatch) throw new Denied("upstream_unavailable");
  const draft = decode(result, call);
  return reply({
    request_id: form.request_id,
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }],
      },
    ],
    usage: meter
      ? { input_tokens: meter.input, output_tokens: meter.output }
      : null,
    accounting: meter ? "measured" : "reserved",
    reference_time: call.referenceTime,
    allowance: await status(db, member, device, true),
  });
}
async function handle(request, env, upstream) {
  const path = new URL(request.url).pathname,
    db = env.AI_DB;
  if (path === "/health" && request.method === "GET") {
    const p = await policy(db);
    return reply({
      service: "synapse-ai",
      paused: !!serviceReason(p, !!env.OPENAI_SERVICE_KEY),
    });
  }
  if (
    !["/v1/enroll", "/v1/status", "/v1/generate", "/v1/forget"].includes(path)
  )
    return reply({ error: "not_found" }, 404);
  requireThat(request.method === "POST");
  const match = /^Bearer ([^.]+)\.([0-9a-f]{64})$/.exec(
    request.headers.get("Authorization") || "",
  );
  requireThat(match && UUID.test(match[1]), "revoked");
  const [, device, token] = match,
    verifier = await hash("device:" + token);
  if (path === "/v1/enroll") return enroll(db, request, device, verifier);
  const member = await authenticate(db, device, verifier);
  if (path === "/v1/generate")
    return generate(db, request, env, member, device, upstream);
  requireThat(exact(await json(request, 32), []));
  if (path === "/v1/forget") {
    await db
      .prepare("UPDATE devices SET revoked=1 WHERE id=? AND verifier=?")
      .bind(device, verifier)
      .run();
    return reply({ revoked: true });
  }
  return reply(await status(db, member, device, !!env.OPENAI_SERVICE_KEY));
}
// Only local tests inject dependencies. No request/env option can select an upstream URL.
export function createWorker({ upstream = fetch } = {}) {
  return {
    async fetch(request, env, ctx) {
      const work = handle(request, env, upstream).catch((e) => {
        const reason =
          e instanceof Denied
            ? e.message
            : Object.keys(failures).find(
                (k) =>
                  String(e?.message).includes(k) ||
                  String(e?.cause?.message).includes(k),
              );
        const safe = Object.hasOwn(failures, reason)
          ? reason
          : "service_unavailable";
        return reply({ error: safe }, failures[safe]);
      });
      // Continue accounting on a disconnected/cancelled desktop; no response payload is persisted.
      ctx?.waitUntil(work.then(() => undefined));
      return work;
    },
  };
}
export default createWorker();
