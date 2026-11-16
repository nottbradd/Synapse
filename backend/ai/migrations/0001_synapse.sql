-- Synapse owns this database. No note text, prompt, answer, key or invitation plaintext.
CREATE TABLE policy (
  id INTEGER PRIMARY KEY CHECK(id=1),
  paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN (0,1)),
  overrun INTEGER NOT NULL DEFAULT 0 CHECK(overrun IN (0,1)),
  enrollment_open INTEGER NOT NULL DEFAULT 0 CHECK(enrollment_open IN (0,1)),
  seats INTEGER NOT NULL DEFAULT 5 CHECK(seats BETWEEN 1 AND 10000),
  daily_limit INTEGER NOT NULL DEFAULT 10 CHECK(daily_limit BETWEEN 1 AND 1000),
  minute_limit INTEGER NOT NULL DEFAULT 3 CHECK(minute_limit BETWEEN 1 AND 60),
  funding TEXT NOT NULL DEFAULT 'unconfigured' CHECK(funding IN ('unconfigured','paid','credit')),
  service_expires INTEGER NOT NULL DEFAULT 0,
  credit_expires INTEGER,
  credential_expires INTEGER,
  pricing_revision TEXT,
  day_cap INTEGER NOT NULL DEFAULT 0 CHECK(day_cap BETWEEN 0 AND 1000000000000),
  month_cap INTEGER NOT NULL DEFAULT 0 CHECK(month_cap BETWEEN 0 AND 1000000000000),
  lifetime_cap INTEGER NOT NULL DEFAULT 0 CHECK(lifetime_cap BETWEEN 0 AND 1000000000000)
);
-- next
INSERT INTO policy(id) VALUES (1);
-- next
CREATE TRIGGER activation BEFORE UPDATE OF paused ON policy WHEN NEW.paused=0 BEGIN
  SELECT CASE WHEN NEW.overrun!=0 OR NEW.funding='unconfigured' OR NEW.pricing_revision IS NULL
    OR NEW.day_cap<=0 OR NEW.month_cap<=0 OR NEW.lifetime_cap<=0 THEN RAISE(ABORT,'service_unavailable') END;
  SELECT CASE WHEN NEW.service_expires<=unixepoch() OR NEW.credential_expires<=unixepoch()
    OR (NEW.funding='credit' AND (NEW.credit_expires IS NULL OR NEW.credit_expires<=unixepoch()))
    THEN RAISE(ABORT,'service_expired') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM totals WHERE (bucket='lifetime' AND amount>=NEW.lifetime_cap)
    OR (bucket=date('now') AND amount>=NEW.day_cap) OR (bucket=strftime('%Y-%m','now') AND amount>=NEW.month_cap))
    THEN RAISE(ABORT,'shared_budget') END;
END;
-- next
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','disabled','revoked')),
  daily_limit INTEGER CHECK(daily_limit BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- next
CREATE TRIGGER member_capacity BEFORE INSERT ON members BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM policy WHERE id=1) THEN RAISE(ABORT,'service_unavailable') END;
  SELECT CASE WHEN (SELECT count(*) FROM members WHERE state!='revoked') >= (SELECT seats FROM policy WHERE id=1)
    THEN RAISE(ABORT,'seats_full') END;
END;
-- next
CREATE TRIGGER member_revocation BEFORE UPDATE OF state ON members WHEN OLD.state='revoked' AND NEW.state!='revoked'
BEGIN SELECT RAISE(ABORT,'revoked'); END;
-- next
CREATE TABLE invites (
  hash TEXT PRIMARY KEY, member TEXT NOT NULL REFERENCES members(id),
  expires INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- next
CREATE TABLE devices (
  id TEXT PRIMARY KEY, member TEXT NOT NULL REFERENCES members(id), verifier TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- next
CREATE INDEX devices_member ON devices(member);
-- next
CREATE TRIGGER enroll BEFORE INSERT ON devices BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM policy WHERE id=1 AND enrollment_open=1)
    THEN RAISE(ABORT,'enrollment_closed') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM policy WHERE service_expires<=unixepoch()
    OR (funding='credit' AND (credit_expires IS NULL OR credit_expires<=unixepoch()))
    OR credential_expires<=unixepoch()) THEN RAISE(ABORT,'service_expired') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM invites i JOIN members m ON m.id=i.member
    WHERE i.hash=NEW.invite_hash AND i.member=NEW.member AND i.expires>unixepoch() AND m.state='active')
    THEN RAISE(ABORT,'invalid_invite') END;
  DELETE FROM invites WHERE hash=NEW.invite_hash;
END;
-- next
CREATE TABLE daily (member TEXT NOT NULL REFERENCES members(id), day TEXT NOT NULL,
  generations INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(member,day));
-- next
CREATE TABLE totals (bucket TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount>=0));
-- next
INSERT INTO totals VALUES ('lifetime',0);
-- next
CREATE TABLE calls (
  member TEXT NOT NULL REFERENCES members(id), request_id TEXT NOT NULL, device TEXT NOT NULL REFERENCES devices(id),
  kind TEXT NOT NULL CHECK(kind IN ('quiz','flashcards','reminder')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()), day TEXT NOT NULL DEFAULT (date('now')),
  model TEXT NOT NULL, pricing_revision TEXT NOT NULL,
  reserved INTEGER NOT NULL CHECK(reserved>0), charge INTEGER NOT NULL CHECK(charge>=0),
  state TEXT NOT NULL DEFAULT 'held' CHECK(state IN ('held','measured','conservative','reconciled')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  input_tokens INTEGER, output_tokens INTEGER, upstream_http INTEGER, provider_id TEXT,
  PRIMARY KEY(member,request_id)
);
-- next
CREATE INDEX calls_member_time ON calls(member,created_at);
-- next
CREATE TRIGGER reserve BEFORE INSERT ON calls BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM policy WHERE id=1 AND paused=0 AND overrun=0)
    THEN RAISE(ABORT,'service_paused') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM policy WHERE funding='unconfigured' OR day_cap<=0 OR month_cap<=0
    OR lifetime_cap<=0 OR pricing_revision IS NULL OR pricing_revision!=NEW.pricing_revision)
    THEN RAISE(ABORT,'service_unavailable') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM policy WHERE service_expires<=unixepoch()
    OR (funding='credit' AND (credit_expires IS NULL OR credit_expires<=unixepoch()))
    OR credential_expires<=unixepoch()) THEN RAISE(ABORT,'service_expired') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM devices d JOIN members m ON d.member=m.id
    WHERE d.id=NEW.device AND m.id=NEW.member AND d.revoked=0 AND m.state='active')
    THEN RAISE(ABORT,'revoked') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM calls WHERE member=NEW.member AND request_id=NEW.request_id)
    THEN RAISE(ABORT,'already_submitted') END;
  SELECT CASE WHEN NEW.day!=date('now') OR NEW.created_at!=unixepoch() OR NEW.state!='held'
    OR NEW.active!=1 OR NEW.reserved!=NEW.charge THEN RAISE(ABORT,'invalid_request') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM calls WHERE member=NEW.member AND active=1)
    THEN RAISE(ABORT,'generation_active') END;
  SELECT CASE WHEN (SELECT count(*) FROM calls WHERE member=NEW.member AND created_at>unixepoch()-60)
    >= (SELECT minute_limit FROM policy WHERE id=1) THEN RAISE(ABORT,'rate_limit') END;
  INSERT OR IGNORE INTO daily(member,day) VALUES (NEW.member,NEW.day);
  SELECT CASE WHEN generations >= COALESCE((SELECT daily_limit FROM members WHERE id=NEW.member),
    (SELECT daily_limit FROM policy WHERE id=1)) THEN RAISE(ABORT,'daily_allowance') END
    FROM daily WHERE member=NEW.member AND day=NEW.day;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM totals WHERE bucket='lifetime')
    THEN RAISE(ABORT,'service_unavailable') END;
  INSERT OR IGNORE INTO totals VALUES (NEW.day,0),(substr(NEW.day,1,7),0);
  SELECT CASE WHEN EXISTS(SELECT 1 FROM totals,policy WHERE id=1 AND
    ((bucket=NEW.day AND amount+NEW.charge>day_cap) OR
     (bucket=substr(NEW.day,1,7) AND amount+NEW.charge>month_cap) OR
     (bucket='lifetime' AND amount+NEW.charge>lifetime_cap))) THEN RAISE(ABORT,'shared_budget') END;
  UPDATE totals SET amount=amount+NEW.charge WHERE bucket IN (NEW.day,substr(NEW.day,1,7),'lifetime');
  UPDATE daily SET generations=generations+1 WHERE member=NEW.member AND day=NEW.day;
END;
-- next
CREATE TRIGGER reconcile AFTER UPDATE OF charge,state ON calls BEGIN
  UPDATE totals SET amount=amount+NEW.charge-OLD.charge WHERE bucket IN (NEW.day,substr(NEW.day,1,7),'lifetime');
  UPDATE policy SET paused=1,overrun=1 WHERE id=1 AND (NEW.charge>NEW.reserved OR EXISTS(
    SELECT 1 FROM totals WHERE (bucket='lifetime' AND amount>lifetime_cap)
    OR (bucket=date('now') AND amount>day_cap) OR (bucket=strftime('%Y-%m','now') AND amount>month_cap)));
END;
-- next
CREATE TABLE reconciliations (
  id INTEGER PRIMARY KEY, member TEXT NOT NULL, request_id TEXT NOT NULL,
  old_charge INTEGER NOT NULL, new_charge INTEGER NOT NULL, provider_record TEXT NOT NULL,
  at INTEGER NOT NULL DEFAULT (unixepoch())
);
