-- Who changed what, and when.
--
-- The system has four roles, twenty-one permissions, price overrides, manual
-- stock adjustments, write-offs, voided sales, credit-limit decisions and
-- settings changes — and until now no record of who did any of them. For a
-- system that handles money across several users, that is the gap that matters
-- most: every other report says what the numbers are, none said who moved them.
--
-- The actor's name and role are stored as text rather than joined to User. A
-- user can be renamed, promoted or deactivated, and the trail must keep saying
-- who acted and under what authority AT THE TIME; a join would silently rewrite
-- history whenever an account changed. userId is deliberately nullable with no
-- foreign key, so deleting a user can never delete or break their trail.
--
-- Purely additive: a new table, nothing altered, nothing backfilled.
--
-- Reverse with:
--   DROP TABLE "audit_logs";

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"        TEXT         NOT NULL,
  "at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"    TEXT,
  "userName"  TEXT         NOT NULL,
  "userRole"  TEXT         NOT NULL,
  "action"    TEXT         NOT NULL,
  "entity"    TEXT         NOT NULL,
  "entityId"  TEXT,
  "summary"   TEXT         NOT NULL,
  "method"    TEXT         NOT NULL,
  "path"      TEXT         NOT NULL,
  "status"    INTEGER      NOT NULL,
  "ip"        TEXT,
  "meta"      JSONB,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Newest-first listing is the only way this table is ever read.
CREATE INDEX IF NOT EXISTS "audit_logs_at_idx"              ON "audit_logs"("at");
-- "show me everything that happened to THIS invoice"
CREATE INDEX IF NOT EXISTS "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");
-- "show me everything THIS user did"
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx"          ON "audit_logs"("userId");
