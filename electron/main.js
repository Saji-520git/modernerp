'use strict';

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
const ENV_FILE = path.join(APP_DATA, '.env');

// PostgreSQL binaries — inside app resources
const PGSQL_BIN = path.join(process.resourcesPath, 'pgsql', 'bin');
const PG_CTL    = path.join(PGSQL_BIN, 'pg_ctl.exe');
const INITDB    = path.join(PGSQL_BIN, 'initdb.exe');
const PSQL      = path.join(PGSQL_BIN, 'psql.exe');
const PG_DUMP   = path.join(PGSQL_BIN, 'pg_dump.exe');

const PG_PORT = '5432';
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
  : 'node';

// Prisma CLI
const PRISMA_CMD = path.join(BACKEND_DIR, 'node_modules', '.bin', 'prisma.cmd');

const store = new Store();
log.transports.file.resolvePathFn = () => path.join(LOGS, 'main.log');

let mainWindow   = null;
let splashWindow = null;
let backendProcess = null;
let tray = null;

// ── Ensure required directories exist ─────────────────────────────────────────
function ensureDirs() {
  [APP_DATA, PGDATA, UPLOADS, LOGS, BACKUPS].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── Write production .env if it doesn't exist ─────────────────────────────────
function ensureEnv() {
  if (fs.existsSync(ENV_FILE)) return;
  const content = [
    `DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@localhost:${PG_PORT}/${PG_DB}`,
    `JWT_SECRET=70373b00cf9400941374d2166aa7905c0719948035e25ccdd15e6fb520bfeb24ade9c909e97293e6136ce1402925b2298742c4a4d28bcaf166f112b9ebb04834`,
    `JWT_REFRESH_SECRET=60e6f5977516bec5669fd735f778e0ae4397c8138f3b97bbb62bb346571a4a2416722afe85e9c719316d616ea72fd3daf40c833594b53c277d5cc24f4b1de8db`,
    `NODE_ENV=production`,
    `PORT=4000`,
    `UPLOAD_PATH=${UPLOADS}`,
    `LOG_PATH=${LOGS}`,
    `CORS_ORIGIN=http://localhost:4000`,
    `LOG_LEVEL=info`,
    `BCRYPT_ROUNDS=12`,
    `SESSION_TIMEOUT=60`,
  ].join('\n');
  fs.writeFileSync(ENV_FILE, content, 'utf8');
  log.info('Created production .env at', ENV_FILE);
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
function startPostgres() {
  return new Promise((resolve, reject) => {
    updateSplash('Starting database...');
    log.info('Starting PostgreSQL...');
    const proc = spawn(PG_CTL, [
      'start',
      '-D', PGDATA,
      '-o', `-p ${PG_PORT}`,
      '-w',        // wait until server accepts connections
      '-t', '30',  // 30 second timeout
    ]);
    proc.stdout.on('data', d => log.info('pg_ctl:', d.toString().trim()));
    proc.stderr.on('data', d => log.warn('pg_ctl:', d.toString().trim()));
    proc.on('close', code => {
      if (code === 0) {
        log.info('PostgreSQL started successfully');
        resolve();
      } else {
        // code 1 may just mean "already running" — resolve and let ensureDatabase detect
        log.warn(`pg_ctl start exited ${code} — may already be running, continuing`);
        resolve();
      }
    });
  });
}

// ── Stop PostgreSQL ────────────────────────────────────────────────────────────
function stopPostgres() {
  return new Promise((resolve) => {
    log.info('Stopping PostgreSQL...');
    const proc = spawn(PG_CTL, ['stop', '-D', PGDATA, '-m', 'fast']);
    proc.on('close', () => resolve());
    // Force resolve after 5s regardless
    setTimeout(resolve, 5000);
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
      DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`,
      NODE_ENV: 'production',
    };
    const schemaPath = path.join(BACKEND_DIR, 'src', 'prisma', 'schema.prisma');
    const proc = spawn(PRISMA_CMD, [
      'migrate', 'deploy',
      '--schema', schemaPath,
    ], { env, cwd: BACKEND_DIR });
    proc.stdout.on('data', d => log.info('prisma:', d.toString().trim()));
    proc.stderr.on('data', d => log.warn('prisma:', d.toString().trim()));
    proc.on('close', code => {
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

// ── Run seed (first time only) ─────────────────────────────────────────────────
function runSeedIfFirstTime() {
  return new Promise((resolve) => {
    if (store.get('seeded')) return resolve();
    updateSplash('Setting up initial data...');
    log.info('Running seed for first time...');
    const env = {
      ...process.env,
      DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`,
      NODE_ENV: 'production',
    };
    const tsxBin = path.join(BACKEND_DIR, 'node_modules', '.bin', 'tsx');
    const seedScript = path.join(BACKEND_DIR, 'src', 'prisma', 'seed.ts');
    const proc = spawn(tsxBin, [seedScript], { env, cwd: BACKEND_DIR });
    proc.stdout.on('data', d => log.info('seed:', d.toString().trim()));
    proc.stderr.on('data', d => log.warn('seed:', d.toString().trim()));
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
      DATABASE_URL: `postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}`,
      NODE_ENV: 'production',
      PORT: '4000',
      UPLOAD_PATH: UPLOADS,
      LOG_PATH: LOGS,
      CORS_ORIGIN: 'http://localhost:4000',
    };

    // Merge .env file values (don't overwrite already-set vars)
    loadEnv();

    backendProcess = spawn(BACKEND_RUNNER, [BACKEND_SCRIPT], { env, cwd: BACKEND_DIR });

    backendProcess.stdout.on('data', d => {
      const msg = d.toString().trim();
      log.info('backend:', msg);
      if (msg.includes('listening') || msg.includes('4000')) {
        resolve();
      }
    });
    backendProcess.stderr.on('data', d => log.warn('backend err:', d.toString().trim()));

    // Crash recovery — attempt one automatic restart after 3 seconds
    backendProcess.on('exit', (code) => {
      if (code !== 0 && code !== null && !isShuttingDown) {
        log.error('Backend crashed with code:', code, '— restarting in 3s');
        setTimeout(() => {
          startBackend().catch(e => log.error('Backend restart failed:', e));
        }, 3000);
      } else {
        log.warn('Backend process exited with code:', code);
      }
    });

    // Safety timeout — resolve after 10 seconds even without "listening" message
    setTimeout(resolve, 10000);
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

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    mainWindow.maximize();
  });

  // Minimize to tray instead of taskbar
  mainWindow.on('minimize', () => {
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System tray ────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '..', 'build-resources', 'icon.ico');
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
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info('Shutting down ModernERP...');

  try {
    await runBackup();
  } catch (e) {
    log.warn('Shutdown backup failed:', e.message);
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
app.whenReady().then(async () => {
  // Fix 3: Prepend PostgreSQL bin + lib to PATH so Windows finds all bundled DLLs
  process.env.PATH = [
    PGSQL_BIN,
    path.join(process.resourcesPath, 'pgsql', 'lib'),
    process.env.PATH || '',
  ].join(';');

  // Fix 2: 60-second master startup timeout — quit gracefully if startup hangs
  const startupTimeout = setTimeout(() => {
    log.error('Startup timed out after 60 seconds');
    dialog.showErrorBox(
      'ModernERP Startup Timeout',
      `ModernERP took too long to start (>60 seconds).\n\n` +
      `Log file: ${path.join(LOGS, 'main.log')}\n\n` +
      `Please contact support: 0757187506`
    );
    app.quit();
  }, 60000);

  try {
    ensureDirs();
    ensureEnv();
    loadEnv();
    createSplash();

    await initDbIfNeeded();
    await startPostgres();

    // Give PostgreSQL 2 seconds to fully accept connections
    await new Promise(r => setTimeout(r, 2000));

    await ensureDatabase();
    await runMigrations();
    await runSeedIfFirstTime();
    await startBackend();

    // Give backend 2 seconds to be ready for requests
    await new Promise(r => setTimeout(r, 2000));

    await runAutoBackupIfDue();

    clearTimeout(startupTimeout);
    createMainWindow();
    createTray();
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
  if (!isShuttingDown && (backendProcess || mainWindow)) {
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
