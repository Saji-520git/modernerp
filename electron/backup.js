'use strict';

/**
 * Database backup — writing, verifying and rotating pg_dump output.
 *
 * Lives outside main.js so it can be tested. main.js has no test harness, and
 * "the shop's data is safe" is not a claim that should rest on reading code.
 * The decision functions here (is this dump complete? what may be deleted?) are
 * pure and covered by electron/tests/backup.test.js.
 */

const fs   = require('fs');
const path = require('path');
const { spawn: realSpawn } = require('child_process');

// pg_dump writes this line only after the entire dump has been emitted, so its
// presence is the one honest witness that nothing was cut short. Exit code 0
// is not enough on its own: a dump killed by a power cut can still leave a
// plausible-looking file behind.
const DUMP_END_MARKER = 'PostgreSQL database dump complete';
const MIN_DUMP_BYTES  = 2048;   // even an empty-schema dump is far larger

// Daily and labelled backups rotate SEPARATELY. Pooled, thirty days of dailies
// would evict the pre-migration copies — and those are taken at the single
// riskiest moment in the database's life.
const DAILY_RE    = /^modernerp_\d{4}-\d{2}-\d{2}\.sql$/;
const LABELLED_RE = /^modernerp_\d{4}-\d{2}-\d{2}_[a-z]+_\d{6}\.sql$/;
const DAILY_KEEP    = 30;
const LABELLED_KEEP = 10;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

/**
 * Name for a backup taken at `now`, in the SHOP'S day — never UTC.
 *
 * This used to be `toISOString().slice(0, 10)`, which is the UTC date. Colombo
 * runs at UTC+5:30, so every backup taken between midnight and 05:30 local was
 * filed under YESTERDAY's name — and overwrote yesterday's copy. A till left
 * open overnight quietly destroyed the previous day's backup, every night.
 * Same class of bug as the report date filters; see backend/src/utils/local-date.ts.
 *
 * A labelled backup also carries the time: two upgrades in one day must not
 * overwrite each other, and the pre-migration copy is the one that matters most.
 */
function backupFileName(label, now = new Date()) {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (!label) return `modernerp_${date}.sql`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `modernerp_${date}_${label}_${time}.sql`;
}

/**
 * Given the filenames present in the backups folder, decide what may go.
 * Pure — takes names, returns names. Nothing is touched here.
 */
function planPrune(names, dailyKeep = DAILY_KEEP, labelledKeep = LABELLED_KEEP) {
  // Both patterns begin with the date, so a lexical sort is chronological.
  const overflow = (list, keep) =>
    list.slice().sort().slice(0, Math.max(0, list.length - keep));

  return {
    // Files a killed process left behind. They are never restorable and only
    // invite someone to try.
    parts:    names.filter((n) => n.endsWith('.sql.part')),
    daily:    overflow(names.filter((n) => DAILY_RE.test(n)),    dailyKeep),
    labelled: overflow(names.filter((n) => LABELLED_RE.test(n)), labelledKeep),
  };
}

/** Last `n` bytes of a file as text — enough to see the closing marker. */
function readTail(file, n) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len  = Math.min(n, size);
    if (len === 0) return '';
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** A dump is trustworthy only if it is big enough AND ends where it should. */
function isDumpComplete(file) {
  try {
    const size = fs.statSync(file).size;
    if (size < MIN_DUMP_BYTES) return false;
    return readTail(file, 512).includes(DUMP_END_MARKER);
  } catch (_) {
    return false;
  }
}

function safeUnlink(p) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * @param {object} cfg
 * @param {string} cfg.backupsDir
 * @param {string} cfg.pgDump      absolute path to pg_dump.exe
 * @param {string} cfg.pgUser
 * @param {string} cfg.pgPort
 * @param {string} cfg.pgPass
 * @param {string} cfg.pgDb
 * @param {object} cfg.log         electron-log or any {info,warn,error}
 * @param {function} [cfg.spawnFn] injected for tests
 */
function createBackupRunner(cfg) {
  const { backupsDir, pgDump, pgUser, pgPort, pgPass, pgDb, log } = cfg;
  const spawnFn = cfg.spawnFn || realSpawn;

  function cleanOldBackups() {
    try {
      const plan = planPrune(fs.readdirSync(backupsDir));
      for (const name of [...plan.daily, ...plan.labelled]) {
        try {
          fs.unlinkSync(path.join(backupsDir, name));
          log.info('Deleted old backup:', name);
        } catch (e) {
          log.warn('Could not delete old backup', name, '—', e.message);
        }
      }
      for (const name of plan.parts) safeUnlink(path.join(backupsDir, name));
    } catch (e) {
      log.warn('cleanOldBackups error:', e.message);
    }
  }

  /**
   * Dumps to a .part file and renames it into place only once the dump is
   * proven complete.
   *
   * The reason is not tidiness: `pg_dump -f x.sql` TRUNCATES x.sql the moment
   * it opens it. The daily file is named by date, so the six-hourly timer
   * re-opens the SAME path four times a day. A dump that died halfway — disk
   * full, Postgres restarted, machine switched off at the wall — used to leave
   * a truncated file where the morning's good copy had been, and that was the
   * only copy of the day. The shop would not find out until they needed it.
   *
   * @param {{label?: string}} opts
   * @returns {Promise<boolean>} true only if a verified dump landed on disk.
   */
  function runBackup(opts = {}) {
    return new Promise((resolve) => {
      const file = path.join(backupsDir, backupFileName(opts.label));
      const tmp  = `${file}.part`;
      log.info('Running backup to', file);
      safeUnlink(tmp);

      const env  = { ...process.env, PGPASSWORD: pgPass };
      const proc = spawnFn(pgDump, [
        '-U', pgUser,
        '-h', '127.0.0.1',
        '-p', pgPort,
        '-F', 'p',   // plain SQL
        '-f', tmp,
        pgDb,
      ], { env });

      if (proc.stderr) proc.stderr.on('data', (d) => log.warn('pg_dump:', d.toString().trim()));

      proc.on('error', (e) => {
        log.error('pg_dump could not start:', e.message);
        safeUnlink(tmp);
        resolve(false);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          // The previous good backup at `file` is untouched — that is the point.
          log.warn('Backup failed with code', code, '— previous backup left intact');
          safeUnlink(tmp);
          return resolve(false);
        }
        if (!isDumpComplete(tmp)) {
          log.warn('Backup rejected: incomplete or too small — previous backup left intact');
          safeUnlink(tmp);
          return resolve(false);
        }
        try {
          fs.renameSync(tmp, file);   // replaces the old copy only now
        } catch (e) {
          log.error('Could not move verified backup into place:', e.message);
          safeUnlink(tmp);
          return resolve(false);
        }
        log.info('Backup complete:', file);
        cleanOldBackups();
        resolve(true);
      });
    });
  }

  return { runBackup, cleanOldBackups };
}

module.exports = {
  createBackupRunner,
  backupFileName,
  planPrune,
  isDumpComplete,
  readTail,
  DUMP_END_MARKER,
  MIN_DUMP_BYTES,
  DAILY_KEEP,
  LABELLED_KEEP,
};
