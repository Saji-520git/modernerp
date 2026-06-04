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

- **Purchase confirm stores entered pack cost without per-base conversion**
  (`backend/src/modules/purchases/purchases.service.ts:307`).
  When a purchase line uses a non-base unit (e.g. Box), `confirmPurchase`
  records `unitCostCents` as the cost *as entered for that pack unit* and
  divides stock-in qty by the conversion factor, but it does NOT divide the
  stored `unitCostCents` down to the per-base-unit cost. As a result the
  product's saved cost can reflect the pack price rather than the per-piece
  price. Frontend FIX 4 now auto-recalculates the displayed per-unit cost on
  unit change so the user enters the correct figure, but the backend math at
  line 307 is intentionally left unchanged (out of scope: do NOT touch
  backend purchase service / stock math). Revisit when purchase-cost
  normalization is in scope.
