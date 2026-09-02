'use strict';

/**
 * Backup safety tests.
 *
 * Run with:  node --test electron/tests/backup.test.js
 *
 * The integration tests need a live PostgreSQL to dump. Point PGTEST_PORT and
 * PGTEST_DB at a THROWAWAY cluster — never at the shop's database on 5433 and
 * never at a shared dev DB (CLAUDE.md §12.1). They skip themselves if no
 * cluster answers, so the pure tests always run.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');

const {
  createBackupRunner,
  backupFileName,
  planPrune,
  isDumpComplete,
  DUMP_END_MARKER,
  MIN_DUMP_BYTES,
} = require('../backup.js');

const silentLog = { info() {}, warn() {}, error() {} };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'merp-backup-'));
}

/** A file that passes verification: big enough, ends with the marker. */
function writeGoodDump(file, filler = 'x') {
  fs.writeFileSync(file, filler.repeat(MIN_DUMP_BYTES * 2) + `\n--\n-- ${DUMP_END_MARKER}\n--\n`);
}

// ─── Pure: naming ─────────────────────────────────────────────────────────────

describe('backupFileName', () => {
  // Built from LOCAL components so these hold in any timezone.
  const at = new Date(2026, 8, 3, 14, 25, 36);

  test('a daily backup is named by date alone', () => {
    assert.strictEqual(backupFileName(null, at), 'modernerp_2026-09-03.sql');
  });

  test('a labelled backup carries the time, so two upgrades in one day cannot collide', () => {
    assert.strictEqual(backupFileName('premigration', at), 'modernerp_2026-09-03_premigration_142536.sql');
    const later = new Date(2026, 8, 3, 18, 0, 1);
    assert.notStrictEqual(backupFileName('premigration', at), backupFileName('premigration', later));
  });

  // The regression: at ACM (UTC+5:30) a 01:00 backup used to be named for the
  // previous day and overwrite it. Anywhere east of Greenwich this now differs
  // from the UTC slice, and everywhere it names the shop's own day.
  test('an after-midnight backup is filed under TODAY, not yesterday', () => {
    const oneAm = new Date(2026, 8, 3, 1, 0, 0);
    assert.strictEqual(backupFileName(null, oneAm), 'modernerp_2026-09-03.sql');
    if (-oneAm.getTimezoneOffset() > 0) {
      assert.notStrictEqual(
        backupFileName(null, oneAm),
        `modernerp_${oneAm.toISOString().slice(0, 10)}.sql`,
        'still using the UTC date',
      );
    }
  });

  test('midnight and 23:59 on the same local day share one daily file', () => {
    assert.strictEqual(
      backupFileName(null, new Date(2026, 8, 3, 0, 0, 0)),
      backupFileName(null, new Date(2026, 8, 3, 23, 59, 59)),
    );
  });

  test('consecutive local days get different daily files', () => {
    assert.notStrictEqual(
      backupFileName(null, new Date(2026, 8, 3, 23, 59, 59)),
      backupFileName(null, new Date(2026, 8, 4, 0, 0, 0)),
    );
  });
});

// ─── Pure: rotation ───────────────────────────────────────────────────────────

describe('planPrune', () => {
  const daily = (n) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return `modernerp_${d.toISOString().slice(0, 10)}.sql`;
  });

  test('keeps the newest 30 dailies and deletes the oldest first', () => {
    const plan = planPrune(daily(35));
    assert.strictEqual(plan.daily.length, 5);
    assert.strictEqual(plan.daily[0], 'modernerp_2026-01-01.sql');
    assert.strictEqual(plan.daily[4], 'modernerp_2026-01-05.sql');
  });

  test('deletes nothing while under the cap', () => {
    assert.deepStrictEqual(planPrune(daily(30)).daily, []);
  });

  test('30 dailies cannot evict a pre-migration backup — they rotate separately', () => {
    const names = [...daily(35), 'modernerp_2026-01-02_premigration_090000.sql'];
    const plan  = planPrune(names);
    assert.ok(!plan.daily.includes('modernerp_2026-01-02_premigration_090000.sql'));
    assert.deepStrictEqual(plan.labelled, [], 'a single labelled backup is under its own cap of 10');
  });

  test('labelled backups rotate at 10', () => {
    const labelled = Array.from({ length: 12 }, (_, i) =>
      `modernerp_2026-01-${String(i + 1).padStart(2, '0')}_premigration_090000.sql`);
    const plan = planPrune(labelled);
    assert.strictEqual(plan.labelled.length, 2);
    assert.strictEqual(plan.labelled[0], 'modernerp_2026-01-01_premigration_090000.sql');
  });

  test('sweeps .part leftovers and never touches unrelated files', () => {
    const plan = planPrune([
      'modernerp_2026-01-01.sql.part',
      'modernerp_2026-01-01.sql',
      'notes.txt',
      'modernerp-manual-export.json',
    ]);
    assert.deepStrictEqual(plan.parts, ['modernerp_2026-01-01.sql.part']);
    assert.deepStrictEqual(plan.daily, []);
    assert.deepStrictEqual(plan.labelled, []);
  });
});

// ─── Pure: verification ───────────────────────────────────────────────────────

describe('isDumpComplete', () => {
  test('accepts a dump that is big enough and ends with the marker', () => {
    const dir = tmpDir(); const f = path.join(dir, 'ok.sql');
    writeGoodDump(f);
    assert.strictEqual(isDumpComplete(f), true);
  });

  test('rejects a dump truncated before the marker — the power-cut case', () => {
    const dir = tmpDir(); const f = path.join(dir, 'cut.sql');
    writeGoodDump(f);
    const full = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, full.slice(0, full.length - 60));   // marker chopped off
    assert.strictEqual(isDumpComplete(f), false);
  });

  test('rejects a file too small to be a real dump', () => {
    const dir = tmpDir(); const f = path.join(dir, 'tiny.sql');
    fs.writeFileSync(f, `-- ${DUMP_END_MARKER}\n`);   // marker present, but nothing else
    assert.strictEqual(isDumpComplete(f), false);
  });

  test('rejects an empty file', () => {
    const dir = tmpDir(); const f = path.join(dir, 'empty.sql');
    fs.writeFileSync(f, '');
    assert.strictEqual(isDumpComplete(f), false);
  });

  test('rejects a missing file rather than throwing', () => {
    assert.strictEqual(isDumpComplete(path.join(tmpDir(), 'nope.sql')), false);
  });
});

// ─── Runner: the regression that matters ──────────────────────────────────────

/**
 * Stands in for pg_dump. `behaviour` decides what it does to the .part file
 * before exiting, so we can reproduce a half-written dump exactly.
 */
function fakeSpawn(behaviour) {
  return (_bin, args) => {
    const tmp = args[args.indexOf('-f') + 1];
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      const code = behaviour(tmp);
      proc.emit('close', code);
    });
    return proc;
  };
}

function runnerFor(dir, spawnFn) {
  return createBackupRunner({
    backupsDir: dir, pgDump: 'pg_dump', pgUser: 'u', pgPort: '1', pgPass: 'p', pgDb: 'db',
    log: silentLog, spawnFn,
  });
}

describe('runBackup — a failed dump must not destroy the good copy', () => {
  test('non-zero exit leaves the existing backup byte-identical', async () => {
    const dir  = tmpDir();
    const good = path.join(dir, backupFileName(null));
    writeGoodDump(good, 'A');
    const before = fs.readFileSync(good);

    // Reproduces the old bug's setup: pg_dump opens (and would truncate) the
    // target, writes part of it, then dies.
    const { runBackup } = runnerFor(dir, fakeSpawn((tmp) => {
      fs.writeFileSync(tmp, 'PARTIAL GARBAGE');
      return 1;
    }));

    assert.strictEqual(await runBackup(), false);
    assert.deepStrictEqual(fs.readFileSync(good), before, 'previous backup was modified');
    assert.ok(!fs.existsSync(`${good}.part`), '.part leftover was not cleaned up');
  });

  test('exit 0 with a TRUNCATED dump is rejected and the good copy survives', async () => {
    const dir  = tmpDir();
    const good = path.join(dir, backupFileName(null));
    writeGoodDump(good, 'A');
    const before = fs.readFileSync(good);

    // The nastiest case: pg_dump reports success but the file was cut short.
    const { runBackup } = runnerFor(dir, fakeSpawn((tmp) => {
      fs.writeFileSync(tmp, 'B'.repeat(MIN_DUMP_BYTES * 2));   // big, but no end marker
      return 0;
    }));

    assert.strictEqual(await runBackup(), false);
    assert.deepStrictEqual(fs.readFileSync(good), before);
  });

  test('spawn failure (pg_dump missing) is survivable and reported', async () => {
    const dir = tmpDir();
    const { runBackup } = runnerFor(dir, () => {
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit('error', new Error('ENOENT')));
      return proc;
    });
    assert.strictEqual(await runBackup(), false);
  });

  test('a good dump replaces the previous copy and reports true', async () => {
    const dir  = tmpDir();
    const good = path.join(dir, backupFileName(null));
    writeGoodDump(good, 'A');

    const { runBackup } = runnerFor(dir, fakeSpawn((tmp) => {
      writeGoodDump(tmp, 'B');
      return 0;
    }));

    assert.strictEqual(await runBackup(), true);
    assert.ok(fs.readFileSync(good, 'utf8').startsWith('B'), 'new dump did not replace the old one');
    assert.ok(!fs.existsSync(`${good}.part`));
  });

  test('a labelled backup does not overwrite the daily one', async () => {
    const dir = tmpDir();
    const { runBackup } = runnerFor(dir, fakeSpawn((tmp) => { writeGoodDump(tmp); return 0; }));

    assert.strictEqual(await runBackup(), true);
    assert.strictEqual(await runBackup({ label: 'premigration' }), true);

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    assert.strictEqual(files.length, 2, `expected a daily and a labelled backup, got ${files}`);
    assert.ok(files.some((f) => /_premigration_\d{6}\.sql$/.test(f)));
  });
});

// ─── Integration: the real pg_dump ────────────────────────────────────────────
//
// Everything above trusts that pg_dump actually emits DUMP_END_MARKER. If it
// did not, verification would reject every backup and the shop would silently
// have none. That assumption is worth checking against the real binary.

const PG_BIN   = path.join(__dirname, '..', '..', 'resources', 'pgsql', 'bin');
const PG_DUMP  = path.join(PG_BIN, 'pg_dump.exe');
const PGT_PORT = process.env.PGTEST_PORT || '5439';
const PGT_DB   = process.env.PGTEST_DB   || 'modernerp_test';
const PGT_USER = process.env.PGTEST_USER || 'postgres';

function clusterAvailable() {
  if (!fs.existsSync(PG_DUMP)) return false;
  try {
    execFileSync(path.join(PG_BIN, 'psql.exe'),
      ['-h', '127.0.0.1', '-p', PGT_PORT, '-U', PGT_USER, '-d', PGT_DB, '-c', 'select 1'],
      { stdio: 'ignore', env: { ...process.env, PGPASSWORD: process.env.PGTEST_PASS || 'postgres' } });
    return true;
  } catch (_) {
    return false;
  }
}

describe('runBackup — against the real bundled pg_dump', { skip: !clusterAvailable() && 'no throwaway cluster on 127.0.0.1:' + PGT_PORT }, () => {
  test('produces a dump this code accepts as complete', async () => {
    const dir = tmpDir();
    const { runBackup } = createBackupRunner({
      backupsDir: dir, pgDump: PG_DUMP, pgUser: PGT_USER, pgPort: PGT_PORT,
      pgPass: process.env.PGTEST_PASS || 'postgres', pgDb: PGT_DB, log: silentLog,
    });

    assert.strictEqual(await runBackup(), true, 'real pg_dump output failed verification');

    const out = path.join(dir, backupFileName(null));
    assert.ok(fs.existsSync(out));
    assert.ok(fs.statSync(out).size > MIN_DUMP_BYTES);
    assert.strictEqual(isDumpComplete(out), true);
    assert.ok(!fs.existsSync(`${out}.part`));
  });

  test('dumping a database that does not exist fails without leaving a file', async () => {
    const dir = tmpDir();
    const { runBackup } = createBackupRunner({
      backupsDir: dir, pgDump: PG_DUMP, pgUser: PGT_USER, pgPort: PGT_PORT,
      pgPass: process.env.PGTEST_PASS || 'postgres', pgDb: 'no_such_db_xyz', log: silentLog,
    });

    assert.strictEqual(await runBackup(), false);
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'a failed dump left a file behind');
  });
});
