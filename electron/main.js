'use strict';

// Suppress EPIPE errors — broken pipe kills the process during PG/prisma output
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const log = require('electron-log');
const Store = require('electron-store');

// ── Paths ──────────────────────────────────────────────────────────────────────
const APP_DATA = 'C:\\ProgramData\\ModernERP';
const PGDATA   = path.join(APP_DATA, 'pgdata');
const UPLOADS  = path.join(APP_DATA, 'uploads');
const LOGS     = path.join(APP_DATA, 'logs');
const BACKUPS  = path.join(APP_DATA, 'backups');
const CACHE    = path.join(APP_DATA, 'cache');
const ENV_FILE = path.join(APP_DATA, '.env');

// PostgreSQL binaries — inside app resources
const PGSQL_BIN = path.join(process.resourcesPath, 'pgsql', 'bin');
const PG_CTL    = path.join(PGSQL_BIN, 'pg_ctl.exe');
const INITDB    = path.join(PGSQL_BIN, 'initdb.exe');
const PSQL      = path.join(PGSQL_BIN, 'psql.exe');
const PG_DUMP   = path.join(PGSQL_BIN, 'pg_dump.exe');

const PG_PORT = '5433';
const PG_USER = 'postgres';
const PG_PASS = 'ModernERP2024!';
const PG_DB   = 'modernerp';

// Backend entry — compiled JS in production, tsx source in dev
const BACKEND_DIR = path.join(__dirname, '..', 'backend');
const IS_DEV = !app.isPackaged;
const BACKEND_SCRIPT = IS_DEV
  ? path.join(BACKEND_DIR, 'src', 'server.ts')
  : path.join(BACKEND_DIR, 'dist', 'server.js');
const BACKEND_RUNNER = IS_DEV
  ? path.join(BACKEND_DIR, 'node_modules', '.bin', 'tsx')
  : process.execPath;


const store = new Store();
log.transports.file.resolvePathFn = () => path.join(LOGS, 'main.log');
if (app.isPackaged) {
  log.transports.console.level = false; // silence console in production; file log still active
}

let mainWindow   = null;
let splashWindow = null;
let backendProcess = null;
let tray = null;
let dbReady = false;   // true once the modernerp database exists (gates shutdown backup)

// ── Ensure required directories exist ─────────────────────────────────────────
function ensureDirs() {
  [APP_DATA, PGDATA, UPLOADS, LOGS, BACKUPS, CACHE].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── Write production .env (create fresh, or backfill missing keys) ────────────
function ensureEnv() {
  // Required key/value pairs. Names MUST match backend/src/config/env.ts zod schema:
  //   DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (others have defaults)
  const pairs = {
    DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}?connect_timeout=15&pool_timeout=15&connection_limit=5`,
    JWT_SECRET: '70373b00cf9400941374d2166aa7905c0719948035e25ccdd15e6fb520bfeb24ade9c909e97293e6136ce1402925b2298742c4a4d28bcaf166f112b9ebb04834',
    JWT_ACCESS_SECRET: '70373b00cf9400941374d2166aa7905c0719948035e25ccdd15e6fb520bfeb24ade9c909e97293e6136ce1402925b2298742c4a4d28bcaf166f112b9ebb04834',
    JWT_REFRESH_SECRET: '60e6f5977516bec5669fd735f778e0ae4397c8138f3b97bbb62bb346571a4a2416722afe85e9c719316d616ea72fd3daf40c833594b53c277d5cc24f4b1de8db',
    NODE_ENV: 'production',
    PORT: '4000',
    UPLOAD_PATH: UPLOADS,
    LOG_PATH: LOGS,
    CORS_ORIGIN: 'http://localhost:4000',
    LOG_LEVEL: 'info',
    BCRYPT_ROUNDS: '12',
    SESSION_TIMEOUT: '60',
  };

  if (!fs.existsSync(ENV_FILE)) {
    const content = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(ENV_FILE, content, 'utf8');
    log.info('Created production .env at', ENV_FILE);
    return;
  }

  // .env already exists (upgrade) — backfill any required keys that are missing,
  // so older installs gain JWT_ACCESS_SECRET without losing existing values.
  const existing = fs.readFileSync(ENV_FILE, 'utf8');
  const present = new Set(
    existing.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => l.slice(0, l.indexOf('=')).trim())
  );
  const missing = Object.entries(pairs).filter(([k]) => !present.has(k));
  if (missing.length === 0) return;

  const appended = (existing.endsWith('\n') ? '' : '\n')
    + missing.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.appendFileSync(ENV_FILE, appended, 'utf8');
  log.info('Backfilled missing .env keys:', missing.map(([k]) => k).join(', '));
}

// ── Load .env into process.env ────────────────────────────────────────────────
function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ── Temp password file for initdb ─────────────────────────────────────────────
function writePassFile() {
  const f = path.join(APP_DATA, '.pgpass_tmp');
  fs.writeFileSync(f, PG_PASS + '\n');
  return f;
}

// ── Configure pg_hba.conf for md5 local auth ──────────────────────────────────
function configurePgHba() {
  const hba = path.join(PGDATA, 'pg_hba.conf');
  const content = [
    '# ModernERP PostgreSQL auth config',
    'local   all   all                 md5',
    'host    all   all   127.0.0.1/32  md5',
    'host    all   all   ::1/128       md5',
  ].join('\n');
  fs.writeFileSync(hba, content);
  log.info('Wrote pg_hba.conf');
}

// ── initdb — only on first launch ─────────────────────────────────────────────
function initDbIfNeeded() {
  return new Promise((resolve, reject) => {
    const pgVersionFile = path.join(PGDATA, 'PG_VERSION');
    if (fs.existsSync(pgVersionFile)) {
      log.info('PostgreSQL data dir exists — skipping initdb');
      return resolve();
    }
    log.info('Running initdb — first time setup...');
    updateSplash('Setting up database (first time)...');
    const passFile = writePassFile();
    const proc = spawn(INITDB, [
      '-D', PGDATA,
      '-U', PG_USER,
      '--encoding=UTF8',
      '--auth=md5',
      '--lc-messages=C',
      '--lc-monetary=C',
      '--lc-numeric=C',
      '--lc-time=C',
      '--lc-collate=C',
      '--lc-ctype=C',
      `--pwfile=${passFile}`,
    ]);
    // Fix 4: Capture full stderr before rejecting so errors are instantly readable in logs
    let initdbError = '';
    proc.stdout.on('data', d => log.info('initdb stdout:', d.toString().trim()));
    proc.stderr.on('data', d => {
      const msg = d.toString();
      initdbError += msg;
      log.warn('initdb stderr:', msg.trim());
    });
    proc.on('close', code => {
      try { fs.unlinkSync(passFile); } catch (_) {}
      if (code === 0) {
        configurePgHba();
        log.info('initdb complete');
        resolve();
      } else {
        const errMsg = `initdb failed (code ${code}).\n${initdbError}`;
        log.error('initdb failed:', errMsg);
        reject(new Error(errMsg));
      }
    });
  });
}

// ── Start PostgreSQL ───────────────────────────────────────────────────────────
// CRITICAL (Windows): pg_ctl launches postgres.exe as a child which INHERITS our
// stdout/stderr pipes. Node's 'close' event waits for stdio EOF — which never comes
// while postgres holds the pipe open — so we must (a) redirect the server's output
// to a logfile via -l so postgres stops writing to / holding our pipe, (b) use
// stdio:'ignore' so there are no inheritable pipe handles, and (c) resolve on the
// process 'exit' event (fires on pg_ctl termination) rather than 'close'.
// waitForPostgres() is the real readiness gate after this.
function startPostgres() {
  return new Promise((resolve) => {
    updateSplash('Starting database...');
    log.info('Starting PostgreSQL...');
    const pgLog = path.join(LOGS, 'postgres.log');

    let settled = false;
    const settle = (label) => {
      if (settled) return;
      settled = true;
      log.info(`pg_ctl start: ${label}`);
      resolve();
    };

    const proc = spawn(PG_CTL, [
      'start',
      '-D', PGDATA,
      '-o', `-p ${PG_PORT}`,
      '-w',                 // wait until server accepts connections
      '-t', '30',           // 30 second timeout
      '-l', pgLog,          // redirect server output to file (frees our stdio pipes)
    ], { stdio: 'ignore' }); // no inheritable pipes → postgres can't hold them open

    proc.on('exit', code => {
      if (code === 0) {
        log.info('PostgreSQL started successfully');
      } else {
        // code 1 may just mean "already running" — let ensureDatabase/waitForPostgres detect
        log.warn(`pg_ctl start exited ${code} — may already be running, continuing`);
      }
      settle('process exited');
    });
    proc.on('error', err => {
      log.error('pg_ctl spawn error:', err.message);
      settle('spawn error');
    });

    // Safety net — never let startup hang here again (pg_ctl -t is 30s)
    setTimeout(() => settle('safety timeout (35s)'), 35000);
  });
}

// ── Stop PostgreSQL ────────────────────────────────────────────────────────────
function stopPostgres() {
  return new Promise((resolve) => {
    log.info('Stopping PostgreSQL...');
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    const proc = spawn(PG_CTL, ['stop', '-D', PGDATA, '-m', 'fast']);
    proc.on('close', () => done());
    // Force resolve after 5s regardless
    setTimeout(done, 5000);
  });
}

// ── Wait for PostgreSQL to accept connections (retry loop) ────────────────────
function waitForPostgres() {
  return new Promise((resolve, reject) => {
    const MAX_RETRIES = 15;
    const RETRY_MS    = 3000;
    let attempts = 0;

    function attempt() {
      attempts++;
      updateSplash(`Waiting for database to be ready... (${attempts}/${MAX_RETRIES})`);
      log.info(`PostgreSQL connection check (attempt ${attempts}/${MAX_RETRIES})...`);
      const env   = { ...process.env, PGPASSWORD: PG_PASS };
      const check = spawn(PSQL, [
        '-U', PG_USER,
        '-h', '127.0.0.1',
        '-p', PG_PORT,
        '-d', 'postgres',
        '-c', 'SELECT 1',
      ], { env });
      check.stderr.on('data', d => log.warn('pg-ready-check:', d.toString().trim()));
      check.on('close', code => {
        if (code === 0) {
          log.info('PostgreSQL is accepting connections ✓');
          resolve();
        } else if (attempts < MAX_RETRIES) {
          log.warn(`PostgreSQL not ready (attempt ${attempts}) — retry in ${RETRY_MS / 1000}s`);
          setTimeout(attempt, RETRY_MS);
        } else {
          reject(new Error(
            `PostgreSQL did not become ready after ${MAX_RETRIES} attempts (${MAX_RETRIES * RETRY_MS / 1000}s). ` +
            `Check logs at ${LOGS}`
          ));
        }
      });
    }

    attempt();
  });
}

// ── Create DB if it doesn't exist ─────────────────────────────────────────────
function ensureDatabase() {
  return new Promise((resolve, reject) => {
    updateSplash('Checking database...');
    const env = { ...process.env, PGPASSWORD: PG_PASS };

    // List databases and check if ours exists
    const check = spawn(PSQL, [
      '-U', PG_USER, '-h', '127.0.0.1', '-p', PG_PORT, '-lqt',
    ], { env });
    let output = '';
    check.stdout.on('data', d => output += d.toString());
    check.stderr.on('data', d => log.warn('psql list:', d.toString().trim()));
    check.on('close', () => {
      if (output.includes(PG_DB)) {
        log.info(`Database "${PG_DB}" already exists`);
        return resolve();
      }
      log.info(`Creating database "${PG_DB}"...`);
      const create = spawn(PSQL, [
        '-U', PG_USER, '-h', '127.0.0.1', '-p', PG_PORT,
        '-c', `CREATE DATABASE ${PG_DB};`,
      ], { env });
      create.stderr.on('data', d => log.warn('psql create:', d.toString().trim()));
      create.on('close', code => {
        if (code === 0) {
          log.info('Database created');
          resolve();
        } else {
          reject(new Error(`Failed to create database "${PG_DB}". Check logs at ${LOGS}`));
        }
      });
    });
  });
}

// ── Run Prisma migrate deploy ──────────────────────────────────────────────────
function runMigrations() {
  return new Promise((resolve, reject) => {
    updateSplash('Running database migrations...');
    log.info('Running prisma migrate deploy...');
    const env = {
      ...process.env,
      // CRITICAL: make the Electron binary run as plain Node.js, not a 2nd Electron app
      ELECTRON_RUN_AS_NODE: '1',
      DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}?connect_timeout=15&pool_timeout=15&connection_limit=5`,
      NODE_ENV: 'production',
      NODE_PATH: path.join(BACKEND_DIR, 'node_modules'),
      // Prisma writes a telemetry/checksum cache to node_modules/.cache/prisma.
      // In production node_modules lives under read-only Program Files → EPERM.
      // CHECKPOINT_DISABLE stops the write entirely; the rest redirect any cache
      // lookups to our writable ProgramData\ModernERP\cache directory.
      CHECKPOINT_DISABLE: '1',
      PRISMA_ENGINES_MIRROR: '',
      PRISMA_CLI_BINARY_TARGETS: 'windows',
      XDG_CACHE_HOME: CACHE,
      LOCALAPPDATA: CACHE,
    };
    const schemaPath = path.join(BACKEND_DIR, 'src', 'prisma', 'schema.prisma');
    // Use process.execPath (Electron = Node.js runtime) to run prisma CLI JS directly
    // Avoids prisma.cmd which calls external 'node' — not available on clean PC
    const prismaCli = path.join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js');
    const proc = spawn(process.execPath, [
      prismaCli,
      'migrate', 'deploy',
      '--schema', schemaPath,
    ], { env, cwd: BACKEND_DIR });
    proc.stdout.on('data', d => log.info('prisma:', d.toString().trim()));
    proc.stderr.on('data', d => log.warn('prisma:', d.toString().trim()));

    // 90-second hard timeout — if Prisma hangs on DB connection, kill it and continue
    const migrationTimeout = setTimeout(() => {
      log.error('prisma migrate timed out after 90s — killing and continuing');
      try { proc.kill(); } catch (_) {}
      resolve(); // non-fatal: either already applied or DB issue will surface at runtime
    }, 90000);

    proc.on('close', code => {
      clearTimeout(migrationTimeout);
      if (code === 0) {
        log.info('Prisma migrations complete');
        resolve();
      } else {
        // Migrations may already be fully applied — not fatal
        log.warn(`prisma migrate exited ${code} — treating as non-fatal`);
        resolve();
      }
    });
  });
}

// ── Run seed (based on actual DB user count, NOT the electron-store flag) ──────
// electron-store persists in AppData\Roaming across uninstall/reinstall, but the
// pgdata dir is deleted on uninstall. Relying on store.get('seeded') meant a
// fresh DB after reinstall was never seeded → no admin user → "Invalid
// credentials". We now ask the database directly: 0 users → seed; >0 → skip.
function runSeedIfFirstTime() {
  return new Promise((resolve) => {
    updateSplash('Checking initial data...');

    // Check if users exist in DB
    const env = { ...process.env, PGPASSWORD: PG_PASS };
    const check = spawn(PSQL, [
      '-U', PG_USER,
      '-h', '127.0.0.1',
      '-p', PG_PORT,
      '-d', PG_DB,
      '-t', '-c', 'SELECT COUNT(*) FROM "User";',
    ], { env });

    let output = '';
    check.stdout.on('data', d => output += d.toString());
    check.stderr.on('data', d => log.warn('user-count check:', d.toString().trim()));
    check.on('close', (code) => {
      const count = parseInt(output.trim(), 10) || 0;

      if (code === 0 && count > 0) {
        log.info(`Database has ${count} users — skipping seed`);
        store.set('seeded', true);
        return resolve();
      }

      // No users found (fresh DB, e.g. after reinstall) — must seed
      log.info('No users in database — running seed...');
      updateSplash('Setting up initial data...');

      const seedScript = path.join(BACKEND_DIR, 'dist', 'prisma', 'seed.js');
      const seedEnv = {
        ...process.env,
        // CRITICAL: make the Electron binary run as plain Node.js, not a 2nd Electron app
        ELECTRON_RUN_AS_NODE: '1',
        DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}?connect_timeout=15&pool_timeout=15&connection_limit=5`,
        NODE_ENV: 'production',
        NODE_PATH: path.join(BACKEND_DIR, 'node_modules'),
        CHECKPOINT_DISABLE: '1',
        XDG_CACHE_HOME: CACHE,
        LOCALAPPDATA: CACHE,
      };

      const proc = spawn(process.execPath, [seedScript], { env: seedEnv, cwd: BACKEND_DIR });
      proc.stdout.on('data', d => log.info('seed:', d.toString().trim()));
      proc.stderr.on('data', d => log.warn('seed err:', d.toString().trim()));
      proc.on('close', code => {
        if (code === 0) {
          store.set('seeded', true);
          log.info('Seed complete');
        } else {
          // Seed failure is not fatal — user can continue with empty data
          log.warn(`Seed exited with code ${code} — continuing without seed data`);
        }
        resolve();
      });
    });

    check.on('error', (err) => {
      log.warn('User count check failed:', err.message);
      // If the check itself fails, don't block startup
      resolve();
    });
  });
}

// ── Port availability check ────────────────────────────────────────────────────
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false)); // port already in use
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

// ── Start Express backend ──────────────────────────────────────────────────────
function startBackend() {
  return new Promise(async (resolve) => {
    updateSplash('Starting application server...');

    // If port 4000 is already occupied, assume backend is running — skip spawn
    const portFree = await isPortFree(4000);
    if (!portFree) {
      log.warn('Port 4000 already in use — skipping backend spawn');
      return resolve();
    }

    log.info('Starting Express backend...');
    const env = {
      ...process.env,
      // CRITICAL: make the Electron binary run as plain Node.js, not a 2nd Electron app
      ELECTRON_RUN_AS_NODE: '1',
      DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}?connect_timeout=15&pool_timeout=15&connection_limit=5`,
      NODE_ENV: 'production',
      PORT: '4000',
      UPLOAD_PATH: UPLOADS,
      LOG_PATH: LOGS,
      CORS_ORIGIN: 'http://localhost:4000',
      NODE_PATH: path.join(BACKEND_DIR, 'node_modules'),
      CHECKPOINT_DISABLE: '1',
      XDG_CACHE_HOME: CACHE,
      LOCALAPPDATA: CACHE,
    };

    backendProcess = spawn(BACKEND_RUNNER, [BACKEND_SCRIPT], { env, cwd: BACKEND_DIR });

    backendProcess.stdout.on('data', d => {
      const msg = d.toString().trim();
      log.info('backend:', msg);
      if (msg.includes('listening') || msg.includes('4000')) {
        resolve();
      }
    });
    backendProcess.stderr.on('data', d => log.warn('backend err:', d.toString().trim()));

    // Crash recovery — restart only on unexpected non-zero exit codes
    // Exclude code 1 (EPIPE / normal signal) and skip if app is closing
    backendProcess.on('exit', (code) => {
      if (code !== 0 && code !== null && code !== 1 && !app.isQuiting) {
        log.warn('Backend crashed with code:', code, '— restarting in 3s');
        setTimeout(() => {
          startBackend().catch(e => log.error('Backend restart failed:', e));
        }, 3000);
      } else {
        log.warn('Backend process exited with code:', code);
      }
    });

    // Safety timeout — resolve after 15 seconds even without "listening" message
    setTimeout(resolve, 15000);
  });
}

// ── Backup: run pg_dump ────────────────────────────────────────────────────────
function runBackup() {
  return new Promise((resolve) => {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUPS, `modernerp_${date}.sql`);
    log.info('Running backup to', file);
    const env = { ...process.env, PGPASSWORD: PG_PASS };
    const proc = spawn(PG_DUMP, [
      '-U', PG_USER,
      '-h', '127.0.0.1',
      '-p', PG_PORT,
      '-F', 'p',   // plain SQL
      '-f', file,
      PG_DB,
    ], { env });
    proc.stderr.on('data', d => log.warn('pg_dump:', d.toString().trim()));
    proc.on('close', code => {
      if (code === 0) {
        store.set('lastBackup', Date.now());
        log.info('Backup complete:', file);
        cleanOldBackups();
      } else {
        log.warn('Backup failed with code', code);
      }
      resolve();
    });
  });
}

function runAutoBackupIfDue() {
  const lastBackup = store.get('lastBackup', 0);
  const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000;
  if (Date.now() - lastBackup < TWENTY_THREE_HOURS) {
    log.info('Backup not due yet — skipping');
    return Promise.resolve();
  }
  return runBackup();
}

function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUPS)
      .filter(f => f.startsWith('modernerp_') && f.endsWith('.sql'))
      .sort();
    while (files.length > 30) {
      const old = files.shift();
      fs.unlinkSync(path.join(BACKUPS, old));
      log.info('Deleted old backup:', old);
    }
  } catch (e) {
    log.warn('cleanOldBackups error:', e.message);
  }
}

// ── Splash window ──────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function updateSplash(msg) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents
      .executeJavaScript(
        `(function(){ var el = document.getElementById('status'); if(el) el.textContent = ${JSON.stringify(msg)}; })()`
      )
      .catch(() => {});
  }
  log.info('[splash]', msg);
}

// ── Main application window ────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    title: 'ModernERP — ACM Groceries',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // In production: load the built React frontend from disk
  // In dev: could load from vite dev server, but for Electron testing we use dist/
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  mainWindow.loadFile(indexPath);

  // Route external links (e.g. WhatsApp wa.me deep-links) to the OS default
  // handler instead of opening a new Electron window. Everything else keeps
  // the default in-app behaviour.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('whatsapp:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.maximize();
  });

  // Clear the persisted auth session when the window is closed so that
  // re-opening the app always requires a fresh login. The JWT is stored by
  // the Zustand persist middleware under the 'modernerp-auth' localStorage
  // key (NOT 'token'/'accessToken'). 'last_login_email' is left intact so the
  // login screen can still pre-fill the email.
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents
        .executeJavaScript(`localStorage.removeItem('modernerp-auth');`)
        .catch(() => {});
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System tray ────────────────────────────────────────────────────────────────
function createTray() {
  try {
    // icon.ico is copied to resources/ via extraResources in package.json
    const iconPath = path.join(process.resourcesPath, 'icon.ico');
    tray = new Tray(iconPath);

    const menu = Menu.buildFromTemplate([
      { label: 'BROcode ERP', enabled: false },
      { type: 'separator' },
      {
        label: 'Open', click: () => {
          if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        },
      },
      {
        label: 'Backup Now', click: () => {
          runBackup()
            .then(() => {
              tray.displayBalloon({
                title: 'BROcode ERP',
                content: 'Backup completed successfully',
              });
            })
            .catch(e => log.warn('Tray backup failed:', e.message));
        },
      },
      { type: 'separator' },
      { label: 'Exit', click: () => app.quit() },
    ]);

    tray.setToolTip('BROcode ERP — Running');
    tray.setContextMenu(menu);
    tray.on('double-click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch (e) {
    log.warn('createTray failed (non-fatal):', e.message);
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.isQuiting = true;
  log.info('Shutting down ModernERP...');

  // Only back up if the database was actually created — avoids spurious
  // "database modernerp does not exist" pg_dump errors on a failed startup
  if (dbReady) {
    try {
      await runBackup();
    } catch (e) {
      log.warn('Shutdown backup failed:', e.message);
    }
  } else {
    log.info('Skipping shutdown backup — database not yet initialized');
  }

  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
    // Give backend 3 seconds to close gracefully
    await new Promise(r => setTimeout(r, 3000));
  }

  try {
    await stopPostgres();
  } catch (e) {
    log.warn('Stop postgres error:', e.message);
  }

  log.info('Shutdown complete');
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.info('Another instance running — quitting');
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Prepend Electron binary dir + PG bin + PG lib to PATH
  // electronDir makes process.execPath available as 'node' to child .cmd scripts
  const electronDir = path.dirname(process.execPath);
  process.env.PATH = [
    electronDir,
    PGSQL_BIN,
    path.join(process.resourcesPath, 'pgsql', 'lib'),
    process.env.PATH || '',
  ].join(';');
  // NODE_PATH so backend scripts resolve modules from their own node_modules
  process.env.NODE_PATH = path.join(BACKEND_DIR, 'node_modules');

  // Master startup timeout — quit gracefully if startup hangs (300 s for slow first-launch)
  const startupTimeout = setTimeout(() => {
    log.error('Startup timed out after 300 seconds');
    dialog.showErrorBox(
      'ModernERP Startup Timeout',
      `ModernERP took too long to start (>300 seconds).\n\n` +
      `Log file: ${path.join(LOGS, 'main.log')}\n\n` +
      `Please contact support: 0757187506`
    );
    app.quit();
  }, 300000);

  // Fix 3: Critical path existence checks — fail fast with clear error
  const criticalPaths = [
    { label: 'pg_ctl.exe',           path: PG_CTL },
    { label: 'Backend dist/server.js', path: path.join(BACKEND_DIR, 'dist', 'server.js') },
    { label: 'Frontend dist/index.html', path: path.join(__dirname, '..', 'frontend', 'dist', 'index.html') },
    { label: 'Prisma build/index.js', path: path.join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js') },
  ];
  const missing = [];
  for (const item of criticalPaths) {
    const exists = fs.existsSync(item.path);
    log.info(`[path-check] ${exists ? 'OK' : 'MISSING'} — ${item.label}: ${item.path}`);
    if (!exists) missing.push(item.label);
  }
  if (missing.length > 0) {
    clearTimeout(startupTimeout);
    dialog.showErrorBox(
      'ModernERP — Missing Files',
      `Cannot start: the following required files are missing:\n\n` +
      missing.map(m => `  • ${m}`).join('\n') +
      `\n\nLog file: ${path.join(LOGS, 'main.log')}\n\nPlease reinstall or contact support: 0757187506`
    );
    return app.quit();
  }

  try {
    ensureDirs();
    ensureEnv();
    loadEnv();
    createSplash();

    await initDbIfNeeded();
    await startPostgres();

    // Wait until PostgreSQL is actually accepting connections (15 × 3s = 45s max wait)
    await waitForPostgres();

    await ensureDatabase();
    dbReady = true;   // DB confirmed to exist — shutdown backup is now safe
    await runMigrations();
    await runSeedIfFirstTime();
    await startBackend();

    // Give backend 3 seconds to be ready for requests
    await new Promise(r => setTimeout(r, 3000));

    await runAutoBackupIfDue();

    clearTimeout(startupTimeout);
    createMainWindow();
    try { createTray(); } catch (e) { log.warn('Tray init failed (non-fatal):', e.message); }
  } catch (err) {
    clearTimeout(startupTimeout);
    log.error('Startup failed:', err);
    dialog.showErrorBox(
      'ModernERP Startup Error',
      `Failed to start ModernERP.\n\n` +
      `Error: ${err.message}\n\n` +
      `Log file: ${path.join(LOGS, 'main.log')}\n\n` +
      `Please contact support: 0757187506`
    );
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (!isShuttingDown) {
    e.preventDefault();
    await shutdown();
    app.exit(0);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC handlers ───────────────────────────────────────────────────────────────
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:backup', async () => {
  try {
    await runBackup();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('app:openLogs', () => {
  shell.openPath(LOGS);
});
ipcMain.handle('app:openBackups', () => {
  shell.openPath(BACKUPS);
});
