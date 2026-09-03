-- Backfill: documents whose date was stored as UTC midnight.
--
-- The forms sent `new Date('2026-09-03').toISOString()`. A date-ONLY string is
-- parsed by JavaScript as UTC midnight, never local midnight, so every manually
-- entered document was filed at an instant that reads back as 05:30 AM in
-- Colombo — a time it never happened — and the real moment it was raised was
-- discarded. The till was never affected: it stamps `new Date()`.
--
-- The write path is fixed (frontend/src/utils/local-date.ts). This repairs what
-- the old code already stored.
--
-- WHICH ROWS: exactly those whose time-of-day is 00:00:00. That is the
-- signature of the bug and nothing else now produces it — a back-dated document
-- written by the fixed code stores LOCAL midnight, which at any non-UTC offset
-- is not 00:00:00 in the stored (UTC) representation. On a shop actually
-- running at UTC the transform is the identity, so this is a no-op there rather
-- than a corruption.
--
-- WHAT THEY BECOME, two cases:
--   • raised on the day it is dated  → `createdAt`, recovering the true time
--   • back-dated                     → local midnight of the day it is dated
--
-- WHAT DOES NOT CHANGE: the calendar day. UTC midnight of the 3rd already read
-- as the 3rd locally at +5:30, and both replacements land on the 3rd locally
-- too. No figure moves between days, so no report, filter or total shifts —
-- only the meaningless 05:30 AM becomes either the real time or 12:00 AM.
--
-- Timezone comes from the server's own setting, so the shop's clock decides.
-- The bundled PostgreSQL is initdb'd on the till itself and reports the
-- machine's zone (Asia/Colombo for ACM).

-- One definition, applied to each table below.
--   $1 = the stored date column, $2 = createdAt
-- local calendar day of an instant stored naive-UTC:
--   ((col AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
-- local midnight of a calendar day, back as naive UTC:
--   ((day::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')

UPDATE "Sale" SET "date" =
  CASE
    WHEN "date"::date = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
      THEN "createdAt"
    ELSE (("date"::date::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')
  END
WHERE "date"::time = '00:00:00';

UPDATE "Purchase" SET "date" =
  CASE
    WHEN "date"::date = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
      THEN "createdAt"
    ELSE (("date"::date::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')
  END
WHERE "date"::time = '00:00:00';

UPDATE "customer_payments" SET "paymentDate" =
  CASE
    WHEN "paymentDate"::date = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
      THEN "createdAt"
    ELSE (("paymentDate"::date::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')
  END
WHERE "paymentDate"::time = '00:00:00';

UPDATE "supplier_payments" SET "paymentDate" =
  CASE
    WHEN "paymentDate"::date = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
      THEN "createdAt"
    ELSE (("paymentDate"::date::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')
  END
WHERE "paymentDate"::time = '00:00:00';

-- expenses and payments always carried a real timestamp (their schemas demand
-- one), so these match nothing today. Included so a row that slipped through an
-- older path is repaired rather than left as the only one still reading 05:30.
UPDATE "expenses" SET "date" =
  CASE
    WHEN "date"::date = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
      THEN "createdAt"
    ELSE (("date"::date::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')
  END
WHERE "date"::time = '00:00:00';

UPDATE "payments" SET "date" =
  CASE
    WHEN "date"::date = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))::date
      THEN "createdAt"
    ELSE (("date"::date::timestamp AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'UTC')
  END
WHERE "date"::time = '00:00:00';
