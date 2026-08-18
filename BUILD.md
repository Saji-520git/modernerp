# BUILD.md — ModernERP electron-v1.0 release discipline

Standing rules for building, tagging, and releasing the v1.0 Electron
production track. These are not suggestions. They are hard rules written
down because verbal context fades and the same mistakes recur. Read all
of this before any build or release.

> Audience: future-me, and any developer who picks up this branch cold.
> If you are about to build or deploy and have NOT read this file end to
> end, stop and read it first.

---

## Branch model

- `electron-v1.0` is the ONLY production branch for the v1.0 track.
- Never push to `main`, `dev`, or any `v2-*` branch from this work.
- The dev DB is contaminated with v2-branch tables. `prisma migrate dev`
  and `prisma migrate diff` will generate DROP statements against
  production tables. **NEVER run them on this branch.**
- All migrations are applied via `prisma migrate deploy` only.
- Migrations live at `backend/src/prisma/migrations/` (non-default path).
  The schema is at `backend/src/prisma/schema.prisma`, wired through
  `backend/package.json`:

  ```json
  "prisma": { "schema": "src/prisma/schema.prisma", "seed": "tsx src/prisma/seed.ts" }
  ```

  Because the path is non-default, every Prisma CLI call run from
  `backend/` picks it up automatically — but if you run Prisma from
  elsewhere, pass `--schema src/prisma/schema.prisma` explicitly.

### Migrate: deploy vs dev (the v2-contamination rule)

| Command | Allowed on electron-v1.0? | Why |
|---|---|---|
| `prisma migrate deploy` | ✅ YES | Applies pending migrations forward only. No diffing against the (contaminated) dev DB. |
| `prisma migrate dev` | ❌ NEVER | Diffs the schema against the connected DB and writes new migrations / resets. On the contaminated dev DB it emits DROPs against v2 tables and can destroy data. |
| `prisma migrate diff` | ❌ NEVER | Same diffing hazard. |
| `prisma db push` | ❌ NEVER | Force-syncs schema to DB with no migration history; destructive. |
| `prisma generate` | ✅ YES | Regenerates the client from the schema. Safe. Required after any schema change. |

After any migration, always run, in order, from `backend/`:

```bash
npx prisma generate --schema src/prisma/schema.prisma
npm run typecheck
```

Never skip `prisma generate`. The generated client is compiled from the
schema; if a migration adds columns and generate is not run, the old
client throws `PrismaClientValidationError` on any query using the new
fields, and requests hang.

---

## Tag model

- Production tags: `vMAJOR.MINOR.PATCH-production` at the commit deployed
  to the client.
- Release candidates: `vMAJOR.MINOR.PATCH-rcN` — incremented on each
  rebuild, never moved.
- Tags are annotated (`git tag -a`), never lightweight.
- Tags are **NEVER moved or deleted.** If an rc is superseded, the next
  one becomes `-rc(N+1)`, and the old rc remains as a historical record
  — even if it was never built. See the v1.0.71-rc1 → rc2 case below.
- `git rev-parse <tag>` on an annotated tag returns the **tag object**
  SHA, not the commit. Use `git rev-parse <tag>^{}` to dereference to
  the commit. Pre-flight checks must dereference, or they will compare
  the wrong SHA and falsely "fail".

### Tagging sequence (per release)

```bash
# 1. push the commits first
git push origin electron-v1.0

# 2. verify origin landed the tip
git fetch origin
git log --oneline -1 origin/electron-v1.0     # must equal local HEAD

# 3. create the annotated tag AT the specific commit
git tag -a v<VERSION>-rcN <commit> -m "<release notes>"

# 4. push the tag
git push origin v<VERSION>-rcN

# 5. verify both the tag and any prior tags are intact
git ls-remote --tags origin v<VERSION>-rcN
git rev-parse v<VERSION>-rcN^{}               # dereference to commit
```

Never force-push. Never `--no-verify`. Never move or delete a tag to
"reuse" it.

---

## Version field — leave it at 1.0.0

`package.json` `version` stays `"1.0.0"` and is **not bumped per
release.** Consequences, by design:

- The installer artifact is always named `ModernERP Setup 1.0.0.exe`.
- Version disambiguation lives in **(a)** the git tag and **(b)** the
  build output folder name (`C:\ModernERP-Build\v<VERSION>-rcN\`), NOT
  the filename.
- Because the filename is constant, building into the default output dir
  **overwrites the previous installer in place.** This is exactly why
  versioned output folders (below) are mandatory — they keep each
  release's installer isolated and prevent clobbering the prior
  production build.

Do not "fix" this by bumping the version unless Mr. S explicitly decides
to change the scheme.

---

## Build chain

The build is a **TWO-COMMAND sequence.** `prebuild:win` and the
electron-builder invocation are NOT chained in `package.json`. You must
run both, in order.

Root `package.json` scripts (for reference — do not modify):

```json
"scripts": {
  "electron":     "electron .",
  "build":        "electron-builder",
  "prebuild:win": "npm --prefix backend run build && npm --prefix frontend run build",
  "build:win":    "electron-builder --win --x64",
  "postinstall":  "electron-builder install-app-deps"
}
```

### Step 1 — prebuild (compile backend + frontend)

```bash
npm run prebuild:win
```

This runs, in sequence:

- `npm --prefix backend run build` → `tsc -p tsconfig.json`
  (backend TypeScript → `backend/dist/`)
- `npm --prefix frontend run build` → `tsc -b && vite build`
  (frontend type-check + Vite production bundle → `frontend/dist/`)

Both must finish with exit 0. Expected benign warnings only:
- Vite: "users.ts is dynamically imported … but also statically
  imported" — pre-existing, harmless.
- Vite: "Some chunks are larger than 500 kB" — pre-existing, harmless.

If either step reports a TypeScript error, STOP. Do not proceed to
electron-builder with a broken compile.

> **Why prebuild is mandatory — the v1.0.65 stale-dist incident.**
> electron-builder packages `backend/dist` and `frontend/dist` as-is via
> `extraResources`. It does **not** compile them. In v1.0.65 a build was
> cut without re-running prebuild, so the installer shipped a stale
> `dist/` from a previous commit — the source fix was never in the
> artifact. The bug "came back" on the client machine despite being
> fixed in git. Since then: **prebuild is non-negotiable before every
> electron-builder run.** Note that `tsc` does not always purge orphaned
> `.js` files from a stale `dist/`; if `backend/dist` or `frontend/dist`
> is suspiciously old, clean it before prebuild (ask Mr. S first — these
> are gitignored build dirs, but deletion is still a deliberate act).

### Step 2 — electron-builder with a versioned output override

The default `npm run build:win` writes to `C:\ModernERP-Build\` (the
`directories.output` path in `package.json`'s `build` block). **Do NOT
use `build:win` for versioned releases** — it dumps into the shared root
folder and overwrites the prior installer (see "Version field" above).

`npm run build:win` also does not cleanly pass the output override
through npm's argument passthrough. **Invoke electron-builder directly:**

```bash
npx electron-builder --win --x64 --config.directories.output="C:\ModernERP-Build\v<VERSION>-rcN"
```

This overrides the output directory **on the CLI only** — no
`package.json` edit. The build writes:

- `C:\ModernERP-Build\v<VERSION>-rcN\ModernERP Setup 1.0.0.exe`
- `…\ModernERP Setup 1.0.0.exe.blockmap`
- `…\latest.yml`
- `…\builder-debug.yml`
- `…\win-unpacked\` (directory)

Expected benign warnings: `asar usage is disabled` (×2 — intentional,
`"asar": false` in config) and `skipped dependencies rebuild`
(`npmRebuild: false`, intentional). A full clean build takes roughly
11–12 minutes and produces a ~415–440 MB installer.

---

## Verify the build (SHA256 habit)

After electron-builder exits 0, verify the artifacts and capture a hash.

```powershell
# list artifacts
Get-ChildItem "C:\ModernERP-Build\v<VERSION>-rcN" |
  Select-Object Name, Length, LastWriteTime

# exact byte size + SHA256 of the installer
$exe = "C:\ModernERP-Build\v<VERSION>-rcN\ModernERP Setup 1.0.0.exe"
(Get-Item $exe).Length
Get-FileHash $exe -Algorithm SHA256
```

Record the SHA256 and byte size in the release notes / tag message.
Reasons:
- It uniquely identifies the artifact even though the filename is always
  `ModernERP Setup 1.0.0.exe`.
- It lets you confirm the file copied to AnyDesk / the client machine is
  byte-identical to what you built (re-hash on the target).
- Two builds of different source produce different sizes/hashes — a quick
  sanity check that you didn't accidentally ship a stale or wrong file.

### Protect the prior production installer

Because filenames collide, after a versioned build always re-check that
the previous release's installer (in a different folder, e.g. the root
`C:\ModernERP-Build\ModernERP Setup 1.0.0.exe` or a prior `v…` folder) is
**untouched** — same `LastWriteTime` and `Length` as before your build.
If it changed, the output override did not take effect and you may have
clobbered a shipped build. STOP and investigate before doing anything
else.

---

## Deploy (AnyDesk to the client PC)

The client runs a bundled offline portable PostgreSQL, backend on
`localhost:4000`, frontend on `localhost:5173`, all inside the Electron
app on an offline Windows PC.

1. Copy the verified `ModernERP Setup 1.0.0.exe` to the client machine.
   Re-hash it there (`Get-FileHash … -Algorithm SHA256`) and confirm it
   matches the build-side SHA256.
2. Apply any pending DB migrations with **`prisma migrate deploy`** only
   (never `migrate dev`). Run from `backend/` so the non-default schema
   path is picked up:

   ```bash
   npx prisma migrate deploy --schema src/prisma/schema.prisma
   npx prisma generate --schema src/prisma/schema.prisma
   ```

3. Restart the app fully (not hot-reload) so the regenerated Prisma
   client is loaded into a fresh process.

### Pending migrations (as of v1.0.72-rc3 / commit fc22b61)

v1.0.72 (chunks 11-12) made no schema changes; both migrations
below remain pending on the ACM client and must run on next
deploy.

v1.0.71 made **no schema changes.** The following migrations were
introduced in v1.0.69 / v1.0.70 and must be applied on next deploy if
the client DB has not yet received them:

- `20260619065405_add_product_cost_entry_unit`   (v1.0.69)
- `20260620165054_add_product_price_entry_unit`   (v1.0.70)

`prisma migrate deploy` applies them in order and is idempotent — already
-applied migrations are skipped.

### Rollback procedure

Rollback discipline depends on ACM's transaction state.

**Practice phase (current state, as of v1.0.72-rc3):**

ACM is not yet running real transactions through the system.
Each deploy carries forward product details and supplier
details only. Rollback in this phase is light:

1. Stop the Electron app on the ACM PC.
2. Run the installer for the previous good release from its
   versioned folder (e.g. `C:\ModernERP-Build\v1.0.71-rc3\ModernERP Setup 1.0.0.exe`).
3. Confirm installation overwrote the prior install.
4. Restart Electron app.
5. Verify the app launches and product/supplier data is intact.

If product/supplier data is missing or corrupt after the
rollback install, re-import from the most recent export
(Settings → Export → Products / Suppliers in the older
installed version).

**Schema rollback caveat (even in practice phase):**

Prisma migrations are forward-only — there is no automatic
down-migration. If the previous release ran with an OLDER
schema than the new one, rolling back the installer will NOT
roll back the schema. The older app may fail to start or
silently misbehave against a newer schema.

If schema rollback is required:
- Manually drop the new tables/columns added by the failed
  release's migration. Consult `backend/src/prisma/migrations/`
  for the SQL the new migration added.
- Better: do a fresh DB initialization + re-import master data.

**Live phase (future, when ACM cuts over to real transactions):**

Once ACM is running real sales/purchases/inventory movements,
rollback discipline tightens significantly. Required additions:

1. **MANDATORY pre-deploy DB backup.** Run before installing
   any new release:

   ```
   pg_dump -U postgres -d modernerp -F c -f C:\ModernERP-Backups\modernerp-pre-<tag>-<date>.dump
   ```

   Verify backup file size is non-trivial (expected: hundreds
   of MB for a year+ of transactions).

2. **Rollback procedure becomes:**
   a. Stop Electron app.
   b. Restore DB from backup:

      ```
      pg_restore -U postgres -d modernerp --clean --if-exists C:\ModernERP-Backups\modernerp-pre-<tag>-<date>.dump
      ```

   c. Reinstall prior release.
   d. Restart Electron app.
   e. Verify last transaction in the system matches the backup
      timestamp.

3. **Backup retention:** keep pre-deploy backups for at least
   30 days. Verify backup integrity periodically with
   `pg_restore --list`.

4. **Document the cutover.** The day ACM moves from practice
   to live, add a dated entry to the Incident log marking the
   cutover, and update this section's "current state" reference.

---

## Incident log — lessons that produced these rules

### v1.0.65 — stale dist shipped
A build was cut without re-running prebuild. electron-builder packaged an
old `dist/`, so a fix that was in git never reached the installer; the
bug reappeared on the client. **Rule produced:** prebuild is mandatory
before every electron-builder run (see Build chain, Step 1).

### v1.0.71 — rc1 → rc2 (rebuild only when source changed; preserve tag
history)
`v1.0.71-rc1` was tagged at commit `d9cf451` but **never built.** A
browser rehearsal then revealed a UX inconsistency (F5/Cancel used native
`window.confirm` while F4-Hold used a styled modal). Chunk 3b fixed it in
a new commit `e262ec6`. Rather than move the rc1 tag, we left it in place
as a historical record and tagged the new commit `v1.0.71-rc2`. **Rules
produced:** (a) rebuild only when source actually changed; (b) tags are
never moved/deleted — supersede with `-rc(N+1)`; (c) an rc tag that was
never built is still kept as history.

### Annotated-tag dereference gotcha
During the rc2 pre-flight, `git rev-parse v1.0.71-rc1` returned the tag
object SHA (`89703f5…`), not the commit, which looked like a mismatch.
The fix is `git rev-parse <tag>^{}` to dereference to the commit
(`d9cf451`). **Rule produced:** always dereference annotated tags in
verification steps.

---

## Release log

Per-build records. Update on every installer build. SHA256 is
the build's fingerprint — verify on test PC install integrity
and pre-deploy.

| Tag | Commit | Date | SHA256 | Size | Built | Tested | Deployed | Notes |
|---|---|---|---|---|---|---|---|---|
| v1.0.65-production | (historical) | (pre-session) | — | — | yes | yes | yes | Stale-dist incident; see Incident log |
| v1.0.69-production | 84b2f89 | (pre-session) | — | — | yes | — | — | cost-entry-unit feature; shelved for bundle deploy |
| v1.0.70-production | c007d03 | (pre-session) | — | — | yes | — | — | priceEntryUnitId mirror; shelved for bundle deploy |
| v1.0.71-rc1 | d9cf451 | (pre-session) | — | — | NO | — | — | Never built; superseded by rc2 (see Incident log) |
| v1.0.71-rc2 | (per Incident log) | (pre-session) | — | — | yes | — | — | rc1 + chunk 3b fix |
| v1.0.71-rc3 | 8066f4a | (pre-session) | — | — | yes | — | — | + chunks 3c-2, 3c-3; shelved for bundle deploy |
| v1.0.72-rc1 | 3a3bebc | 2026-06-27 | — | — | NO | — | — | Preserved as historical record; had 30s hang UX bug |
| v1.0.72-rc2 | c5c1ee3 | 2026-06-27 | — | — | NO | — | — | + chunk 11 (hang fix); superseded by rc3 |
| v1.0.72-rc3 | fc22b61 | 2026-06-28 | 55bd878c772268bdc6e2827df9beeac283c25a81acf2c794747d0b24167f3f19 | 436,464,774 B (~416 MB) | YES | PENDING | PENDING | + chunk 12 (reason guard); build verified, awaiting test PC |

### Fields explained

- **Tag:** annotated tag name on origin.
- **Commit:** the tagged commit SHA.
- **Date:** build date (or "(historical)" / "(pre-session)" if
  unknown).
- **SHA256:** installer file hash from `certutil -hashfile`.
- **Size:** installer file size in bytes (and rounded MB).
- **Built:** YES if installer .exe exists in versioned folder;
  NO if tag-only with no installer.
- **Tested:** YES if smoke-tested on test PC; PENDING; or NO.
- **Deployed:** YES if installed on ACM client PC; PENDING;
  or NO.
- **Notes:** brief context — what changed, why this release,
  any known issues.

### Update protocol

When a new installer is built:
1. Add a row at the bottom of the table with all known fields.
2. SHA256 must be computed via `certutil -hashfile` (NOT estimated
  or remembered).
3. Update Tested / Deployed columns as those operations complete.
4. If a release is superseded, do NOT delete its row — supersession
  is operational history.

---

## Quick reference (versioned release, start to finish)

```bash
# 0. pre-flight
git branch --show-current                       # electron-v1.0
git status --short                              # empty
git log --oneline -1                            # expected HEAD

# 1. push + tag (see Tag model for full sequence)
git push origin electron-v1.0
git tag -a v<VERSION>-rcN <commit> -m "<notes>"
git push origin v<VERSION>-rcN

# 2. build (TWO commands)
npm run prebuild:win
npx electron-builder --win --x64 --config.directories.output="C:\ModernERP-Build\v<VERSION>-rcN"

# 3. verify
Get-ChildItem "C:\ModernERP-Build\v<VERSION>-rcN"
Get-FileHash "C:\ModernERP-Build\v<VERSION>-rcN\ModernERP Setup 1.0.0.exe" -Algorithm SHA256
#   …and confirm the prior production installer is untouched.

# 4. deploy (on client, from backend/)
npx prisma migrate deploy --schema src/prisma/schema.prisma
npx prisma generate --schema src/prisma/schema.prisma
#   …then fully restart the app.
```

## Hard "never" list

- Never `prisma migrate dev` / `migrate diff` / `db push` on this branch.
- Never force-push; never `--no-verify`; never `--no-gpg-sign` unless
  explicitly told.
- Never move or delete a tag.
- Never skip `prebuild:win` before electron-builder.
- Never bump `package.json` version without an explicit decision.
- Never use `npm run build:win` for a versioned release (no clean output
  override) — invoke electron-builder directly.
- Never ship without capturing the installer SHA256 and confirming the
  prior production installer is intact.
