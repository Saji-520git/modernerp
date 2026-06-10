# CLAUDE-ELECTRON — Electron (ACM Groceries) Production Guide

> **READ THIS FIRST when working on `electron-v1.0`.**
> `electron-v1.0` is the FROZEN ACM Groceries production deployment:
> Electron desktop app, bundled PostgreSQL on port 5433, Node backend on
> `localhost:4000`, fully offline on a low-spec Windows PC.

---

## SCOPE RULES

- Work on `electron-v1.0` **ONLY**. Never touch `dev`. Never touch v2 code.
- Read any file fully before editing it.
- Run `tsc --noEmit` after every file change.
- `git commit` after every fix.
- Do NOT change stock math. Do NOT change purchase-flow logic.
- Do NOT touch the `pg_ctl` command in `electron/main.js`.
- If a TypeScript error appears, or ANYTHING is unexpected → STOP and report.

---

## COMMIT FORMAT

- Use short, imperative subject lines (e.g. `fix(purchases): pre-fetch products outside line loop`).
- Scope prefix matches the area touched: `fix(api)`, `fix(electron)`, `fix(purchases)`, `docs:`, etc.
- Body (optional) explains the *why*, not the *what*.
- One logical fix per commit.

---

## GIT RELEASE RULE FOR ELECTRON
  DO NOT merge electron-v1.0 into main.
  main is the v2 development branch.
  They must NEVER be merged together.

  To release a new electron version:
    1. Commit fixes on electron-v1.0
    2. Push: git push origin electron-v1.0
    3. Tag directly on electron-v1.0:
       git tag v1.0.XX-production
       git push origin v1.0.XX-production
    4. Build installer on electron-v1.0
    NEVER: git checkout main && git merge

---

## KNOWN ISSUES (DEFERRED)

- **v1.0.34: Unit conversion on purchase confirm — baseQty derived from
  conversionQty before stock upsert and StockBatch creation.** `confirmPurchase`
  now also derives the per-base-unit cost: `costPerBaseCents =
  Math.round(unitCostCents / factor)` where `factor = baseQty / qty`, and stores
  it on `Product.costCents` (StockBatch has no cost field in this schema, so the
  product's last-cost is the single source of truth for COGS). Purchasing 1 case
  @ Rs.62,500 where 1 case = 25 boxes now correctly stores Rs.2,500/box. PO detail
  still displays what was purchased ("1 case @ Rs.62,500") — conversion happens
  only in stock math.

- **POS checkout timeout** (v1.0.28): if the checkout POST exceeds 60s on the
  client PC, the sale may be recorded without the receipt popup appearing. The
  cashier is now shown a warning to check the Sales page before re-processing,
  to avoid duplicate sales. Root cause: offline PostgreSQL cold-start latency.
  An idempotency key on checkout (server-side de-dupe) is deferred to a future
  sprint.
