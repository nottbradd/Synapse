// Used only by the owner's authenticated Wrangler CLI. Never imported by the Worker.
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "./worker.mjs";
import { PRICING, UUID, requireThat } from "./protocol.mjs";

const integer = (n, min, max) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
export function dollars(value) {
  requireThat(
    typeof value === "string" && /^(0|[1-9]\d{0,3})(\.\d{1,9})?$/.test(value),
  );
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 1e9 + Number(fraction.padEnd(9, "0"));
  requireThat(integer(amount, 1, 1e12));
  return amount;
}
function expiry(value, optional = false) {
  if (optional && value === null) return null;
  requireThat(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value),
  );
  const parsed = Date.parse(value) / 1000;
  requireThat(
    Number.isInteger(parsed) &&
      new Date(parsed * 1000).toISOString().replace(".000", "") === value,
  );
  return parsed;
}
export async function configure(db, config) {
  const keys = [
    "seats",
    "daily_limit",
    "minute_limit",
    "enrollment_open",
    "funding",
    "service_expires",
    "credit_expires",
    "credential_expires",
    "day_usd",
    "month_usd",
    "lifetime_usd",
    "pricing_revision",
  ];
  requireThat(
    config &&
      Object.keys(config).length === keys.length &&
      keys.every((k) => Object.hasOwn(config, k)),
  );
  requireThat(
    integer(config.seats, 1, 10000) &&
      integer(config.daily_limit, 1, 1000) &&
      integer(config.minute_limit, 1, 60) &&
      typeof config.enrollment_open === "boolean" &&
      ["paid", "credit"].includes(config.funding) &&
      config.pricing_revision === PRICING.revision,
  );
  const service = expiry(config.service_expires),
    credit = expiry(config.credit_expires, config.funding !== "credit"),
    credential = expiry(config.credential_expires, true);
  const row = await db
    .prepare(
      "UPDATE policy SET seats=?,daily_limit=?,minute_limit=?,enrollment_open=?,funding=?,service_expires=?,credit_expires=?,credential_expires=?,day_cap=?,month_cap=?,lifetime_cap=?,pricing_revision=? WHERE id=1 AND paused=1 AND ? > unixepoch() AND (? IS NULL OR ?>unixepoch()) AND (? IS NULL OR ?>unixepoch()) AND ? >= (SELECT count(*) FROM members WHERE state!='revoked') RETURNING id",
    )
    .bind(
      config.seats,
      config.daily_limit,
      config.minute_limit,
      Number(config.enrollment_open),
      config.funding,
      service,
      credit,
      credential,
      dollars(config.day_usd),
      dollars(config.month_usd),
      dollars(config.lifetime_usd),
      config.pricing_revision,
      service,
      credit,
      credit,
      credential,
      credential,
      config.seats,
    )
    .first();
  requireThat(
    row,
    "Pause first; check capacity and future expiry dates. No settings changed.",
  );
}
export async function invite(db, { member, minutes = 10 }) {
  requireThat(integer(minutes, 1, 60) && (!member || UUID.test(member)));
  const id = member || randomUUID(),
    ticket = randomBytes(32).toString("hex");
  const statements = [];
  if (!member)
    statements.push(db.prepare("INSERT INTO members(id) VALUES (?)").bind(id));
  // Issuance is owner-only and hashed; redemption independently checks every condition.
  statements.push(
    db
      .prepare(
        "INSERT INTO invites(hash,member,expires) SELECT ?,id,unixepoch()+? FROM members WHERE id=? AND state='active' RETURNING member,expires",
      )
      .bind(await hash("invite:" + ticket), minutes * 60, id),
  );
  const results = await db.batch(statements);
  requireThat(
    results.at(-1).results.length === 1,
    "No active member with that ID.",
  );
  return {
    member: id,
    invitation: ticket,
    expires: results.at(-1).results[0].expires,
  };
}
export async function reconcile(db, { member, request, amount, record }) {
  requireThat(
    UUID.test(member) &&
      UUID.test(request) &&
      integer(amount, 0, 1e12) &&
      /^[A-Za-z0-9_.:-]{1,160}$/.test(record),
  );
  // The transaction records evidence and adjusts the original day/month/lifetime, never today's quota.
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO reconciliations(member,request_id,old_charge,new_charge,provider_record) SELECT member,request_id,charge,?,? FROM calls WHERE member=? AND request_id=? AND (SELECT paused FROM policy WHERE id=1)=1 RETURNING id",
      )
      .bind(amount, record, member, request),
    db
      .prepare(
        "UPDATE calls SET charge=?,state='reconciled',active=0 WHERE member=? AND request_id=? AND (SELECT paused FROM policy WHERE id=1)=1 RETURNING request_id",
      )
      .bind(amount, member, request),
  ]);
  requireThat(
    result[1].results.length === 1,
    "Pause first and check the member/request ID.",
  );
}
