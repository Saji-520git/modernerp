# ModernERP — Data Recovery Runbook

For the moment something has gone wrong with a shop's data and it needs to come
back. Written for the person sitting at the machine, not for a developer.

Rehearsed end-to-end on 2026-09-03 against a real database — see §6 for what was
actually proved, and what was not.

---

## 1. First: stop making it worse

**Close ModernERP before doing anything else.** The app writes to the database
continuously; every minute it stays open is more data written on top of the
problem.

Do NOT uninstall or reinstall. Reinstalling does not touch the data, so it
fixes nothing, and it costs time.

---

## 2. Where the backups are

```
C:\ProgramData\ModernERP\backups\
```

Two kinds of file live there:

| Filename | What it is |
|---|---|
| `modernerp_2026-09-03.sql` | the day's automatic backup |
| `modernerp_2026-09-03_premigration_014238.sql` | taken automatically just before a version upgrade |

The `_premigration_` copy is the one you want **if the trouble started right
after an upgrade** — it is the state of the data immediately before the new
version touched it.

Backups are written every 6 hours while the app runs, once at shutdown, and once
before any upgrade. Thirty daily copies and ten pre-upgrade copies are kept.

---

## 3. Pick the backup to restore

List them newest-first:

```bash
dir /O-D C:\ProgramData\ModernERP\backups\*.sql
```

Choose the **newest backup from before the problem started**. If the shop
noticed the problem on Tuesday morning, Monday's file is the right one — not
Tuesday's, which already contains the damage.

Every file in that folder has been verified complete at the moment it was
written; a dump that failed or was cut short is deleted rather than kept, so
anything present is restorable.

---

## 4. Restore

Replace `<BACKUP>` with the filename you chose.

```bash
"C:\Program Files\ModernERP\resources\pgsql\bin\pg_ctl.exe" -D "C:\ProgramData\ModernERP\pgdata" -o "-p 5433" start
```

```bash
set PGPASSWORD=ModernERP2024!
```

```bash
"C:\Program Files\ModernERP\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -c "DROP DATABASE IF EXISTS modernerp_damaged;" -c "ALTER DATABASE modernerp RENAME TO modernerp_damaged;" -c "CREATE DATABASE modernerp;"
```

> The damaged database is **renamed, not deleted**. If the restore turns out to
> be the wrong choice, the original is still there as `modernerp_damaged`.

```bash
"C:\Program Files\ModernERP\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -d modernerp -v ON_ERROR_STOP=1 -f "C:\ProgramData\ModernERP\backups\<BACKUP>"
```

`ON_ERROR_STOP=1` matters: without it psql carries on past a failure and leaves
a half-restored database that looks fine. With it, any error stops the restore.

Then start ModernERP normally.

**Expected duration:** about 2 seconds for a small shop's data. A much larger
database scales roughly with size — minutes, not hours.

### If the rename step fails

```
ERROR:  database "modernerp" is being accessed by other users
```

Something is still connected — ModernERP did not fully close, or a second copy
is running. Check Task Manager for `ModernERP.exe` and end it, then retry. If it
persists, disconnect everything else and retry:

```bash
"C:\Program Files\ModernERP\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='modernerp' AND pid <> pg_backend_pid();"
```

Never run that while the shop is trading — it cuts off live work in progress.

---

## 5. Check it worked

Sign in and confirm, in this order:

- [ ] Today's and recent invoices are present (Sales)
- [ ] Stock figures look right for a few known products (Inventory)
- [ ] Customer balances look right for one or two known customers
- [ ] A test sale completes and the receipt prints

Anything entered **after** the backup was taken is gone and has to be re-entered
by hand. Work out that window before telling the shop they are fine: it is the
gap between the backup's timestamp and when the problem started.

Once the shop is satisfied, the damaged copy can be dropped:

```bash
"C:\Program Files\ModernERP\resources\pgsql\bin\psql.exe" -h 127.0.0.1 -p 5433 -U postgres -c "DROP DATABASE modernerp_damaged;"
```

Leave it in place for at least a few days first.

---

## 6. What has actually been rehearsed (2026-09-03)

A real database was loaded, fingerprinted (row counts **and** a content
checksum per table), then deliberately destroyed in the way a bad migration
destroys things — a committed transaction that dropped a column, deleted every
`SaleLine` row, zeroed every sale total, and renamed a column away. All of it
succeeded and committed with no error, which is precisely the case no rollback
saves you from.

Restoring from the pre-migration backup returned the database to an **identical
whole-database checksum** — 44 of 44 tables matching in both count and content,
including the dropped and renamed columns.

**Proved:** the backup is complete and restorable; the restore procedure above
works; recovery from a destructive-but-successful migration is total.

**Not proved:** recovery from a migration that fails *partway* and leaves the
schema inconsistent. Postgres rolls back failed DDL, so this is expected to be
a non-event, but it has not been demonstrated. Nor has recovery been tried on a
database materially larger than a single shop's.

---

## 7. If the backups folder is empty or unreadable

Then the disk itself is the problem, and there is no software answer on that
machine. The backups live on the **same disk as the database** — a drive failure
takes both.

This is the largest remaining risk to any deployed shop's data and it is not
fixed in code. Copying `C:\ProgramData\ModernERP\backups\` to an external drive
or cloud folder on a schedule is what closes it.
