-- One open shift per cashier per warehouse, enforced by the database.
--
-- openShift guarded this with findFirst() followed by create(), which is a
-- check-then-act with nothing holding the gap: two requests arriving together
-- both see "no open shift" and both create one. The same cashier then has two
-- open shifts on one till, sales land in whichever the lookup happens to
-- return, and closing one leaves the other open holding real takings.
--
-- Deliberately scoped to (userId, warehouseId) and NOT to userId alone: holding
-- an open shift in two different warehouses is legitimate and already happens
-- on this database. Only a duplicate on the SAME till is wrong.
--
-- A partial index is the right tool — the uniqueness applies only while a shift
-- is OPEN. Closed shifts pile up on the same pair forever and must stay
-- unconstrained.
--
-- NOTE: Prisma's schema language cannot express a partial (WHERE-filtered)
-- unique index, so this index exists in the database and not in schema.prisma.
-- That is safe here because this project applies migrations with
-- `migrate deploy`, which never diffs the schema against the database. Do not
-- run `migrate dev` — CLAUDE.md §12.1 already forbids it on this database for
-- unrelated reasons, and it would try to "reconcile" this index away.
--
-- Reverse with:
--   DROP INDEX "pos_shifts_one_open_per_user_warehouse";

CREATE UNIQUE INDEX "pos_shifts_one_open_per_user_warehouse"
  ON "pos_shifts" ("userId", "warehouseId")
  WHERE status = 'OPEN';
