## Complete Guide: Enable WAL + wal2json in PostgreSQL on Windows
wal_level = logical

max_wal_senders = 10
max_replication_slots = 10

wal_keep_size = 2GB
max_slot_wal_keep_size = 5GB

wal_compression = on

logical_decoding_work_mem = 128MB

track_commit_timestamp = on

---

## PHASE 1 — Check PostgreSQL Version

```cmd
psql -U postgres -c "SELECT version();"
```

Note your version (e.g., **16**). Use it everywhere below.

---

## PHASE 2 — Enable WAL in PostgreSQL

### Step 1: Find postgresql.conf

```cmd
psql -U postgres -c "SHOW config_file;"
```

Usually:
```
C:\Program Files\PostgreSQL\16\data\postgresql.conf
```

### Step 2: Open as Administrator

```
1. Open Notepad
2. File → Open
3. Navigate to:
   C:\Program Files\PostgreSQL\16\data\postgresql.conf
4. Change dropdown to "All Files (*.*)"
5. Open
```

### Step 3: Find and Change These Lines

Search (`Ctrl+H`) each one and update:

```ini
# Find and change:
wal_level = replica          →    wal_level = logical
max_replication_slots = 0    →    max_replication_slots = 10
max_wal_senders = 0          →    max_wal_senders = 10
wal_keep_size = 0            →    wal_keep_size = 1024
```

> If lines are commented with `#` — remove the `#` and update value

Save the file.

### Step 4: Configure pg_hba.conf

```
Open:
C:\Program Files\PostgreSQL\16\data\pg_hba.conf
(with Notepad as Administrator)
```

Add these lines at the **bottom**:

```
# CDC Replication
host    replication     postgres    127.0.0.1/32    md5
host    replication     postgres    ::1/128         md5
```

Save the file.

### Step 5: Restart PostgreSQL

```cmd
:: Open CMD as Administrator
net stop postgresql-x64-16
net start postgresql-x64-16
```

### Step 6: Verify WAL is Enabled

```cmd
psql -U postgres -c "SHOW wal_level;"
```

```
 wal_level
-----------
 logical        ← must show this
```

```cmd
psql -U postgres -c "SHOW max_replication_slots;"
```

```
 max_replication_slots
-----------------------
 10
```

---

## PHASE 3 — Install wal2json

### Step 7: Download wal2json Source

```
Go to:
https://github.com/eulerto/wal2json/archive/refs/heads/master.zip

Download and extract to:
C:\Users\YourName\Desktop\wal2json-master
```

### Step 8: Install Visual Studio (if not installed)

```
Download: https://visualstudio.microsoft.com/downloads/
→ Visual Studio Community 2022
→ Select: "Desktop development with C++"
   Keep only:
   ☑ MSVC Build Tools for x64/x86 (Latest)
   ☑ Windows 11 SDK
→ Install (~2.5 GB)
→ Restart PC after install
```

### Step 9: Open Developer Command Prompt

```
Start Menu →
Search: "Developer Command Prompt for VS 2022"
→ Right-click → Run as Administrator
```

### Step 10: Compile wal2json

```cmd
:: Navigate to wal2json folder
cd C:\Users\YourName\Desktop\wal2json-master

:: Open solution in Visual Studio
start wal2json.sln
```

In Visual Studio:

```
1. Solution loads → Right-click "wal2json" project
2. Click "Retarget solution"
   → SDK: 10.0 (latest)
   → Toolset: latest (v144)
   → OK

3. Right-click "wal2json" → Properties
   → Configuration: Release
   → Platform: x64

4. C/C++ → General → Additional Include Directories:
   C:\Program Files\PostgreSQL\16\include\server
   C:\Program Files\PostgreSQL\16\include

5. Linker → General → Additional Library Directories:
   C:\Program Files\PostgreSQL\16\lib

6. Linker → Input → Additional Dependencies:
   postgres.lib
   %(AdditionalDependencies)

7. Apply → OK

8. Build → Build Solution (Ctrl+Shift+B)
   → Build: 1 succeeded ✅
```

### Step 11: Copy DLL to PostgreSQL

```cmd
:: Open CMD as Administrator
:: Find your compiled DLL path (from build output)

copy "C:\Users\YourName\Desktop\wal2json-master\x64\Release\wal2json.dll" "C:\Program Files\PostgreSQL\16\lib\"

:: Verify it copied
dir "C:\Program Files\PostgreSQL\16\lib\wal2json.dll"
```

### Step 12: Restart PostgreSQL Again

```cmd
net stop postgresql-x64-16
net start postgresql-x64-16
```

### Step 13: Verify wal2json Works

```cmd
psql -U postgres -d your_database_name
```

```sql
-- Test wal2json is available
SELECT name
FROM pg_available_extensions
WHERE name = 'wal2json';

-- Create test slot
SELECT pg_create_logical_replication_slot('test_slot', 'wal2json');

-- Verify
SELECT slot_name, plugin, database, active
FROM pg_replication_slots;

-- Clean up test slot
SELECT pg_drop_replication_slot('test_slot');
```

Expected:
```
 slot_name  | plugin   | database            | active
------------+----------+---------------------+--------
 test_slot  | wal2json | your_database_name  | f
```

---

## PHASE 4 — Setup for CDC

### Step 14: Enable REPLICA IDENTITY FULL

```cmd
psql -U postgres -d crew_management_erp
```

```sql
-- Enable on ALL tables at once
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename
    FROM   pg_tables
    WHERE  schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I REPLICA IDENTITY FULL', t
    );
    RAISE NOTICE 'Done: %', t;
  END LOOP;
END;
$$;

-- Verify on one table
SELECT relname, relreplident
FROM   pg_class
WHERE  relname = 'vessel_planning_v2';
-- relreplident should be 'f' (full)
```

### Step 15: Create CDC Replication Slot

```sql
-- Make sure you are connected to correct DB
\c crew_management_erp

-- Create slot
SELECT pg_create_logical_replication_slot('cdc_slot', 'wal2json');

-- Verify
SELECT slot_name, plugin, database, active
FROM   pg_replication_slots;
```

Expected:
```
 slot_name | plugin   | database            | active
-----------+----------+---------------------+--------
 cdc_slot  | wal2json | crew_management_erp | f
```

### Step 16: Verify Everything

```sql
-- 1. WAL level
SHOW wal_level;                  -- logical

-- 2. Replication slots
SHOW max_replication_slots;      -- 10

-- 3. Slot exists in right DB
SELECT slot_name, plugin, database
FROM   pg_replication_slots
WHERE  slot_name = 'cdc_slot';

-- 4. REPLICA IDENTITY on tables
SELECT relname, relreplident
FROM   pg_class
JOIN   pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE  nspname = 'public'
AND    relkind = 'r'
ORDER  BY relname;
-- All should show 'f' (full)
```

---

## PHASE 5 — Quick Test Without Node.js

### Step 17: Test WAL Capture Directly

```sql
\c crew_management_erp

-- Peek at changes (does not consume them)
SELECT lsn, data
FROM   pg_logical_slot_peek_changes('cdc_slot', NULL, 5);

-- Make a test change
UPDATE vessel_planning_v2
SET    updated_at = now()
WHERE  id = 95;

-- Now get the change
SELECT lsn, data
FROM   pg_logical_slot_peek_changes('cdc_slot', NULL, 5);
```

You should see JSON output with the change.

---

## Full Sequence Summary

```
PHASE 1 — Check PostgreSQL version

PHASE 2 — Enable WAL
  Step 1  → Find postgresql.conf
  Step 2  → Open as Administrator
  Step 3  → Set wal_level=logical, slots=10, senders=10
  Step 4  → Edit pg_hba.conf
  Step 5  → Restart PostgreSQL
  Step 6  → Verify wal_level = logical

PHASE 3 — Install wal2json
  Step 7  → Download wal2json source from GitHub
  Step 8  → Install Visual Studio with C++ workload
  Step 9  → Open Developer Command Prompt as Admin
  Step 10 → Compile in Visual Studio (Release x64)
  Step 11 → Copy wal2json.dll to PostgreSQL lib folder
  Step 12 → Restart PostgreSQL
  Step 13 → Verify wal2json slot creation works

PHASE 4 — Setup for CDC
  Step 14 → REPLICA IDENTITY FULL on all tables
  Step 15 → Create cdc_slot replication slot
  Step 16 → Verify all settings

PHASE 5 — Quick Test
  Step 17 → Test WAL capture directly in psql
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `wal_level not logical` | Config not saved | Edit postgresql.conf again, restart |
| `could not load wal2json` | DLL wrong folder | Copy to `\lib\` not `\bin\` |
| `slot not in this database` | Slot in wrong DB | Drop and recreate in correct DB |
| `LNK1104 libpgcommon.lib` | Wrong linker deps | Use only `postgres.lib` |
| `MSB8020 v143 not found` | Wrong toolset | Retarget solution in VS |
| `permission denied` | Not admin | Run CMD/Notepad as Administrator |



====================================


## Complete CDC Service — Production Ready

---

## Project Structure

```
C:\cdc-service\
├── src\
│   ├── index.js
│   ├── cdcPoller.js
│   ├── changeProcessor.js
│   ├── storageWriter.js
│   └── logger.js
├── logs\
├── .env
└── package.json
```

---

## Step 1: Create Project

```cmd
cd C:\
mkdir cdc-service
cd cdc-service
npm init -y
npm install pg dotenv
mkdir src
mkdir logs
```

---

## Step 2: `.env`

```env
# Source PostgreSQL
SOURCE_HOST=localhost
SOURCE_PORT=5432
SOURCE_DB=crew_management_erp
SOURCE_USER=postgres
SOURCE_PASS=sailadmin

# Storage PostgreSQL
STORAGE_HOST=localhost
STORAGE_PORT=5432
STORAGE_DB=cdc_store
STORAGE_USER=postgres
STORAGE_PASS=sailadmin

# CDC Settings
SLOT_NAME=cdc_slot
POLL_INTERVAL_MS=1000
MAX_RETRIES=3
```

---

## Step 3: PostgreSQL Setup

```cmd
psql -U postgres -W
```

```sql
-- ================================
-- SOURCE DB SETUP
-- ================================
\c crew_management_erp

-- Enable REPLICA IDENTITY FULL on all tables
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    RAISE NOTICE 'Set REPLICA IDENTITY FULL on %', t;
  END LOOP;
END;
$$;

-- Create replication slot
SELECT pg_create_logical_replication_slot('cdc_slot', 'wal2json');

-- Verify
SELECT slot_name, database, plugin, active
FROM pg_replication_slots;

-- ================================
-- STORAGE DB SETUP
-- ================================
\c cdc_store

-- Main change log table
CREATE TABLE IF NOT EXISTS cdc_change_log (
    id               BIGSERIAL PRIMARY KEY,
    event_id         UUID DEFAULT gen_random_uuid(),
    captured_at      TIMESTAMPTZ DEFAULT now(),
    lsn              TEXT,
    source_database  TEXT,
    source_schema    TEXT NOT NULL,
    source_table     TEXT NOT NULL,
    operation        TEXT NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    primary_key      JSONB,
    old_data         JSONB,
    new_data         JSONB,
    changed_columns  JSONB,
    sync_status      TEXT NOT NULL DEFAULT 'pending'
                     CHECK (sync_status IN ('pending','synced','failed','skipped')),
    synced_at        TIMESTAMPTZ,
    retry_count      INT DEFAULT 0,
    error_message    TEXT
);

CREATE INDEX IF NOT EXISTS idx_cdc_sync_status  ON cdc_change_log(sync_status);
CREATE INDEX IF NOT EXISTS idx_cdc_table        ON cdc_change_log(source_schema, source_table);
CREATE INDEX IF NOT EXISTS idx_cdc_captured_at  ON cdc_change_log(captured_at);
CREATE INDEX IF NOT EXISTS idx_cdc_lsn          ON cdc_change_log(lsn);
CREATE INDEX IF NOT EXISTS idx_cdc_operation    ON cdc_change_log(operation);
CREATE INDEX IF NOT EXISTS idx_cdc_database     ON cdc_change_log(source_database);

-- Service state table
CREATE TABLE IF NOT EXISTS cdc_service_state (
    id             SERIAL PRIMARY KEY,
    service_name   TEXT NOT NULL UNIQUE DEFAULT 'cdc-main',
    slot_name      TEXT NOT NULL,
    last_lsn       TEXT,
    status         TEXT DEFAULT 'running'
                   CHECK (status IN ('running','stopped','error')),
    last_heartbeat TIMESTAMPTZ DEFAULT now(),
    started_at     TIMESTAMPTZ DEFAULT now(),
    error_message  TEXT,
    total_events   BIGINT DEFAULT 0,
    updated_at     TIMESTAMPTZ DEFAULT now()
);

INSERT INTO cdc_service_state (service_name, slot_name)
VALUES ('cdc-main', 'cdc_slot')
ON CONFLICT (service_name) DO NOTHING;

-- Dead letter table
CREATE TABLE IF NOT EXISTS cdc_dead_letter (
    id            BIGSERIAL PRIMARY KEY,
    change_log_id BIGINT,
    source_schema TEXT,
    source_table  TEXT,
    operation     TEXT,
    payload       JSONB,
    error_message TEXT,
    attempts      INT,
    failed_at     TIMESTAMPTZ DEFAULT now(),
    resolved      BOOLEAN DEFAULT false
);

\q
```

---

## Step 4: `src\logger.js`

```js
const fs   = require('fs');
const path = require('path');

const logDir  = path.join(__dirname, '..', 'logs');
const logFile = path.join(logDir, 'cdc.log');

// Ensure logs directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function write(level, msg, meta = {}) {
  const ts      = new Date().toISOString();
  const metaStr = Object.keys(meta).length
    ? ' ' + JSON.stringify(meta) : '';
  const line    = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}${metaStr}`;

  console.log(line);

  try {
    fs.appendFileSync(logFile, line + '\n');
  } catch (err) {
    console.error('Failed to write log file:', err.message);
  }
}

module.exports = {
  info  : (msg, meta) => write('info',  msg, meta),
  warn  : (msg, meta) => write('warn',  msg, meta),
  error : (msg, meta) => write('error', msg, meta),
  debug : (msg, meta) => write('debug', msg, meta),
};
```

---

## Step 5: `src\changeProcessor.js`

```js
const logger = require('./logger');

function toMapFromColumns(columns = []) {
  const map = {};
  columns.forEach(col => { map[col.name] = col.value; });
  return map;
}

/**
 * Returns only columns that actually changed with old + new values.
 */
function computeDiff(oldRow, newRow) {
  if (!oldRow || !newRow) return null;

  const diff = {};
  for (const [col, newVal] of Object.entries(newRow)) {
    const oldVal = oldRow[col] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[col] = { old: oldVal, new: newVal };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

function parseChange(change, lsn) {
  try {
    const {
      action,
      schema,
      table,
      columns  = [],
      identity = [],
      timestamp,
    } = change;

    // Skip transaction markers
    if (action === 'B' || action === 'C') return null;

    const operationMap = { I: 'INSERT', U: 'UPDATE', D: 'DELETE' };
    const operation    = operationMap[action];
    if (!operation) {
      logger.warn('Unknown action type', { action });
      return null;
    }

    const newData    = columns.length  ? toMapFromColumns(columns)  : null;
    const oldData    = identity.length ? toMapFromColumns(identity) : null;
    const primaryKey = identity.length
      ? { [identity[0].name]: identity[0].value } : null;

    const changedColumns = operation === 'UPDATE'
      ? computeDiff(oldData, newData) : null;

    const event = {
      lsn,
      sourceDatabase : process.env.SOURCE_DB,
      sourceSchema   : schema,
      sourceTable    : table,
      operation,
      primaryKey,
      oldData,
      newData,
      changedColumns,
      timestamp,
    };

    // ===== CLEAN CONSOLE PRINT =====
    console.log('\n========== CDC CHANGE ==========');
    console.log(`  Database  : ${process.env.SOURCE_DB}`);
    console.log(`  Schema    : ${schema}`);
    console.log(`  Table     : ${table}`);
    console.log(`  Operation : ${operation}`);
    console.log(`  PK        : ${JSON.stringify(primaryKey)}`);
    console.log(`  Time      : ${timestamp || 'N/A'}`);

    if (operation === 'INSERT') {
      console.log('\n  ➕ NEW ROW:');
      console.log(JSON.stringify(newData, null, 4));
    }

    if (operation === 'UPDATE') {
      if (changedColumns && Object.keys(changedColumns).length > 0) {
        console.log('\n  ✏️  CHANGED COLUMNS:');
        Object.entries(changedColumns).forEach(([col, val]) => {
          console.log(`\n    • ${col}`);
          console.log(`        old : ${JSON.stringify(val.old)}`);
          console.log(`        new : ${JSON.stringify(val.new)}`);
        });
      } else {
        console.log('\n  ℹ️  No column changes detected');
      }
    }

    if (operation === 'DELETE') {
      console.log('\n  ❌ DELETED ROW:');
      console.log(JSON.stringify(oldData, null, 4));
    }

    console.log('\n=================================\n');

    return event;

  } catch (err) {
    logger.error('Failed to parse change', {
      error  : err.message,
      change : JSON.stringify(change),
    });
    return null;
  }
}

/**
 * Parses full wal2json payload.
 * Handles both format-version 1 and 2.
 */
function parseWalPayload(lsn, rawData) {
  try {
    const payload = JSON.parse(rawData);
    const changes = payload.change ? payload.change : [payload];

    return changes
      .map(c => parseChange(c, lsn))
      .filter(Boolean);

  } catch (err) {
    logger.error('Failed to parse WAL payload', {
      error : err.message,
      lsn,
    });
    return [];
  }
}

module.exports = { parseWalPayload };
```

---

## Step 6: `src\storageWriter.js`

```js
const { Pool } = require('pg');
const logger   = require('./logger');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host        : process.env.STORAGE_HOST,
      port        : parseInt(process.env.STORAGE_PORT),
      database    : process.env.STORAGE_DB,
      user        : process.env.STORAGE_USER,
      password    : process.env.STORAGE_PASS,
      max         : 10,
      idleTimeoutMillis    : 30000,
      connectionTimeoutMillis : 5000,
    });

    pool.on('error', (err) => {
      logger.error('Storage pool error', { error: err.message });
    });
  }
  return pool;
}

const INSERT_SQL = `
  INSERT INTO cdc_change_log
    (lsn, source_database, source_schema, source_table, operation,
     primary_key, old_data, new_data, changed_columns)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

/**
 * Write batch of events in a single transaction.
 */
async function writeBatch(events) {
  if (!events.length) return;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const e of events) {
      await client.query(INSERT_SQL, [
        e.lsn,
        e.sourceDatabase,
        e.sourceSchema,
        e.sourceTable,
        e.operation,
        JSON.stringify(e.primaryKey),
        JSON.stringify(e.oldData),
        JSON.stringify(e.newData),
        JSON.stringify(e.changedColumns),
      ]);
    }

    await client.query('COMMIT');
    logger.info(`Stored ${events.length} event(s)`);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Failed to store batch', { error: err.message });

    // Move to dead letter
    await moveToDeadLetter(events, err.message);
    throw err;

  } finally {
    client.release();
  }
}

/**
 * Move failed events to dead letter table.
 */
async function moveToDeadLetter(events, errorMsg) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const e of events) {
      await client.query(`
        INSERT INTO cdc_dead_letter
          (source_schema, source_table, operation, payload, error_message, attempts)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        e.sourceSchema,
        e.sourceTable,
        e.operation,
        JSON.stringify(e),
        errorMsg,
        1,
      ]);
    }
    await client.query('COMMIT');
    logger.warn(`Moved ${events.length} event(s) to dead letter`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Failed to write dead letter', { error: err.message });
  } finally {
    client.release();
  }
}

/**
 * Update service heartbeat and LSN.
 */
async function updateServiceState(lsn, totalEvents) {
  try {
    await getPool().query(`
      UPDATE cdc_service_state
      SET last_lsn       = $1,
          last_heartbeat = now(),
          total_events   = total_events + $2,
          status         = 'running',
          updated_at     = now()
      WHERE service_name = 'cdc-main'
    `, [lsn, totalEvents]);
  } catch (err) {
    logger.warn('Failed to update service state', { error: err.message });
  }
}

/**
 * Update service status on error or stop.
 */
async function updateServiceStatus(status, errorMsg = null) {
  try {
    await getPool().query(`
      UPDATE cdc_service_state
      SET status        = $1,
          error_message = $2,
          updated_at    = now()
      WHERE service_name = 'cdc-main'
    `, [status, errorMsg]);
  } catch (err) {
    logger.warn('Failed to update service status', { error: err.message });
  }
}

/**
 * Fetch pending changes for sync consumer.
 */
async function getPendingChanges(limit = 100) {
  const res = await getPool().query(`
    SELECT * FROM cdc_change_log
    WHERE  sync_status = 'pending'
    ORDER  BY captured_at ASC
    LIMIT  $1
  `, [limit]);
  return res.rows;
}

/**
 * Mark list of IDs as synced.
 */
async function markSynced(ids) {
  await getPool().query(`
    UPDATE cdc_change_log
    SET    sync_status = 'synced',
           synced_at   = now()
    WHERE  id = ANY($1::bigint[])
  `, [ids]);
}

/**
 * Mark list of IDs as failed.
 */
async function markFailed(ids, errorMsg) {
  await getPool().query(`
    UPDATE cdc_change_log
    SET    sync_status    = 'failed',
           retry_count    = retry_count + 1,
           error_message  = $2
    WHERE  id = ANY($1::bigint[])
  `, [ids, errorMsg]);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  writeBatch,
  updateServiceState,
  updateServiceStatus,
  getPendingChanges,
  markSynced,
  markFailed,
  closePool,
};
```

---

## Step 7: `src\cdcPoller.js`

```js
const { Client }          = require('pg');
const { parseWalPayload } = require('./changeProcessor');
const {
  writeBatch,
  updateServiceState,
  updateServiceStatus,
} = require('./storageWriter');
const logger = require('./logger');

const SLOT_NAME   = process.env.SLOT_NAME            || 'cdc_slot';
const POLL_MS     = parseInt(process.env.POLL_INTERVAL_MS || '1000');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES       || '3');

let running      = false;
let client       = null;
let errorCount   = 0;
let totalEvents  = 0;

/**
 * Create source DB client with retry.
 */
async function connectWithRetry(retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      client = new Client({
        host     : process.env.SOURCE_HOST,
        port     : parseInt(process.env.SOURCE_PORT),
        database : process.env.SOURCE_DB,
        user     : process.env.SOURCE_USER,
        password : process.env.SOURCE_PASS,
        connectionTimeoutMillis : 5000,
      });

      client.on('error', (err) => {
        logger.error('Source DB client error', { error: err.message });
      });

      await client.connect();
      logger.info('Connected to source DB', {
        host : process.env.SOURCE_HOST,
        db   : process.env.SOURCE_DB,
      });
      return;

    } catch (err) {
      logger.error(`Connection attempt ${attempt}/${retries} failed`, {
        error: err.message,
      });

      if (attempt === retries) {
        throw new Error(`Failed to connect after ${retries} attempts`);
      }

      const wait = attempt * 2000;
      logger.info(`Retrying in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

/**
 * Ensure replication slot exists in correct database.
 */
async function ensureSlot() {
  const res = await client.query(`
    SELECT slot_name, plugin, database
    FROM   pg_replication_slots
    WHERE  slot_name = $1
    AND    database  = current_database()
  `, [SLOT_NAME]);

  if (res.rowCount === 0) {
    await client.query(
      `SELECT pg_create_logical_replication_slot($1, 'wal2json')`,
      [SLOT_NAME]
    );
    logger.info('Replication slot created', {
      slot     : SLOT_NAME,
      plugin   : 'wal2json',
      database : process.env.SOURCE_DB,
    });
  } else {
    logger.info('Replication slot found', {
      slot     : res.rows[0].slot_name,
      plugin   : res.rows[0].plugin,
      database : res.rows[0].database,
    });
  }
}

/**
 * Poll WAL slot for new changes.
 */
async function poll() {
  const res = await client.query(`
    SELECT lsn, data
    FROM   pg_logical_slot_get_changes(
      $1, NULL, NULL,
      'format-version',    '2',
      'include-timestamp', '1',
      'write-in-chunks',   '0'
    )
  `, [SLOT_NAME]);

  if (res.rowCount === 0) return;

  logger.info('WAL messages received', { count: res.rowCount });

  const events = res.rows.flatMap(({ lsn, data }) =>
    parseWalPayload(lsn, data)
  );

  if (events.length > 0) {
    await writeBatch(events);
    totalEvents += events.length;

    // Update last LSN and heartbeat
    const lastLsn = res.rows[res.rows.length - 1].lsn;
    await updateServiceState(lastLsn, events.length);

    logger.info('Parsed change events', { count: events.length });
  }

  // Reset error count on success
  errorCount = 0;
}

/**
 * Main polling loop with error handling.
 */
async function start() {
  running = true;

  try {
    await connectWithRetry();
    await ensureSlot();
  } catch (err) {
    logger.error('Startup failed', { error: err.message });
    await updateServiceStatus('error', err.message);
    throw err;
  }

  logger.info('CDC poller started', {
    slot     : SLOT_NAME,
    interval : `${POLL_MS}ms`,
  });

  const loop = async () => {
    if (!running) return;

    try {
      await poll();
      errorCount = 0;
    } catch (err) {
      errorCount++;
      logger.error('Poll error', {
        error    : err.message,
        attempt  : errorCount,
      });

      await updateServiceStatus('error', err.message);

      // Reconnect if too many consecutive errors
      if (errorCount >= MAX_RETRIES) {
        logger.warn('Too many errors — attempting reconnect...');
        try {
          await client.end().catch(() => {});
          await connectWithRetry();
          await ensureSlot();
          errorCount = 0;
          logger.info('Reconnected successfully');
          await updateServiceStatus('running');
        } catch (reconnErr) {
          logger.error('Reconnect failed', { error: reconnErr.message });
        }
      }
    }

    setTimeout(loop, POLL_MS);
  };

  loop();
}

/**
 * Graceful stop.
 */
async function stop() {
  running = false;
  if (client) {
    try {
      await client.end();
      logger.info('Disconnected from source DB');
    } catch (err) {
      logger.warn('Error disconnecting', { error: err.message });
    }
  }
}

module.exports = { start, stop };
```

---

## Step 8: `src\index.js`

```js
require('dotenv').config();

const poller  = require('./cdcPoller');
const storage = require('./storageWriter');
const logger  = require('./logger');

// Validate required env vars
const REQUIRED_ENV = [
  'SOURCE_HOST', 'SOURCE_PORT', 'SOURCE_DB', 'SOURCE_USER', 'SOURCE_PASS',
  'STORAGE_HOST', 'STORAGE_PORT', 'STORAGE_DB', 'STORAGE_USER', 'STORAGE_PASS',
  'SLOT_NAME',
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length > 0) {
    logger.error('Missing required env vars', { missing });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`Signal received: ${signal}`);
  logger.info('Shutting down CDC service...');
  try {
    await poller.stop();
    await storage.updateServiceStatus('stopped');
    await storage.closePool();
    logger.info('CDC service stopped cleanly.');
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
  }
  process.exit(0);
}

async function main() {
  logger.info('=============================');
  logger.info('   CDC Service Starting...   ');
  logger.info('=============================');

  validateEnv();

  await poller.start();

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    await storage.updateServiceStatus('error', err.message);
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    await storage.updateServiceStatus('error', String(reason));
    process.exit(1);
  });
}

main().catch(async (err) => {
  logger.error('Fatal startup error', { error: err.message });
  process.exit(1);
});
```

---

## Step 9: Update `package.json`

```json
{
  "name": "cdc-service",
  "version": "1.0.0",
  "description": "PostgreSQL CDC service using wal2json",
  "main": "src/index.js",
  "scripts": {
    "start" : "node src/index.js",
    "dev"   : "node --watch src/index.js"
  },
  "dependencies": {
    "dotenv" : "^16.0.0",
    "pg"     : "^8.11.0"
  }
}
```

---

## Step 10: Run

```cmd
cd C:\cdc-service
npm start
```

---

## Expected Output

```
[INFO ] =============================
[INFO ]    CDC Service Starting...
[INFO ] =============================
[INFO ] Connected to source DB {"host":"localhost","db":"crew_management_erp"}
[INFO ] Replication slot found {"slot":"cdc_slot","plugin":"wal2json","database":"crew_management_erp"}
[INFO ] CDC poller started {"slot":"cdc_slot","interval":"1000ms"}

========== CDC CHANGE ==========
  Database  : crew_management_erp
  Schema    : public
  Table     : vessel_planning_v2
  Operation : UPDATE
  PK        : {"id":95}
  Time      : 2026-04-22 08:33:21.455803+00

  ✏️  CHANGED COLUMNS:

    • joining_status
        old : "In Transit"
        new : "Confirmed"

    • updated_at
        old : "2026-04-22 08:29:15.344+00"
        new : "2026-04-22 08:33:21.449+00"
=================================

[INFO ] Stored 1 event(s)
```

---

## Full Sequence Summary

```
Step 1  → Create project + npm install
Step 2  → .env with DB credentials
Step 3  → PostgreSQL: REPLICA IDENTITY FULL + slot + storage schema
Step 4  → logger.js
Step 5  → changeProcessor.js
Step 6  → storageWriter.js
Step 7  → cdcPoller.js
Step 8  → index.js
Step 9  → package.json
Step 10 → npm start
```

Want me to add a **REST API** to query the change log, or a **sync consumer** that pushes changes to a target database?