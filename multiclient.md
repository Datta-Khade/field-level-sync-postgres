## Multiple Source DB CDC Architecture

---

## Architecture

```
Source DB 1 (crew_management_erp)
        │
        ├── cdc_slot_crew    ← separate slot per DB
        │
Source DB 2 (finance_db)
        │
        ├── cdc_slot_finance
        │
Source DB 3 (hr_db)
        │
        └── cdc_slot_hr
              │
              ▼
    CDC Service (Node.js)
    (one poller per source DB)
              │
              ▼
      cdc_store (single storage DB)
      cdc_change_log (all changes, identified by source_database)
```

---

## Updated Project Structure

```
C:\cdc-service\
├── src\
│   ├── index.js              ← starts all pollers
│   ├── cdcPoller.js          ← reusable poller class
│   ├── changeProcessor.js    ← parse + diff
│   ├── storageWriter.js      ← write to cdc_store
│   └── logger.js
├── config\
│   └── sources.js            ← all source DB configs
├── logs\
├── .env
└── package.json
```

---

## Step 1: `.env`

```env
# ==============================
# SOURCE DB 1
# ==============================
DB1_HOST=localhost
DB1_PORT=5432
DB1_NAME=crew_management_erp
DB1_USER=postgres
DB1_PASS=sailadmin
DB1_SLOT=cdc_slot_crew

# ==============================
# SOURCE DB 2
# ==============================
DB2_HOST=localhost
DB2_PORT=5432
DB2_NAME=finance_db
DB2_USER=postgres
DB2_PASS=sailadmin
DB2_SLOT=cdc_slot_finance

# ==============================
# SOURCE DB 3 (different server)
# ==============================
DB3_HOST=192.168.1.100
DB3_PORT=5432
DB3_NAME=hr_db
DB3_USER=postgres
DB3_PASS=hrpassword
DB3_SLOT=cdc_slot_hr

# ==============================
# STORAGE DB (single)
# ==============================
STORAGE_HOST=localhost
STORAGE_PORT=5432
STORAGE_DB=cdc_store
STORAGE_USER=postgres
STORAGE_PASS=sailadmin

# ==============================
# CDC SETTINGS
# ==============================
POLL_INTERVAL_MS=1000
MAX_RETRIES=3
```

---

## Step 2: `config\sources.js`

```js
/**
 * Define all source databases here.
 * Add or remove entries as needed.
 * Each entry is one independent CDC poller.
 */
module.exports = [
  {
    id       : 'crew_management_erp',    // unique identifier
    host     : process.env.DB1_HOST,
    port     : parseInt(process.env.DB1_PORT),
    database : process.env.DB1_NAME,
    user     : process.env.DB1_USER,
    password : process.env.DB1_PASS,
    slotName : process.env.DB1_SLOT,
    enabled  : true,
  },
  {
    id       : 'finance_db',
    host     : process.env.DB2_HOST,
    port     : parseInt(process.env.DB2_PORT),
    database : process.env.DB2_NAME,
    user     : process.env.DB2_USER,
    password : process.env.DB2_PASS,
    slotName : process.env.DB2_SLOT,
    enabled  : true,
  },
  {
    id       : 'hr_db',
    host     : process.env.DB3_HOST,
    port     : parseInt(process.env.DB3_PORT),
    database : process.env.DB3_NAME,
    user     : process.env.DB3_USER,
    password : process.env.DB3_PASS,
    slotName : process.env.DB3_SLOT,
    enabled  : true,
  },
];
```

---

## Step 3: `src\logger.js`

```js
const fs   = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

function write(level, msg, meta = {}) {
  const ts      = new Date().toISOString();
  const metaStr = Object.keys(meta).length
    ? ' ' + JSON.stringify(meta) : '';
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}${metaStr}`;

  console.log(line);

  try {
    fs.appendFileSync(
      path.join(logDir, 'cdc.log'),
      line + '\n'
    );
  } catch (err) {
    console.error('Log write failed:', err.message);
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

## Step 4: `src\changeProcessor.js`

```js
const logger = require('./logger');

function toMapFromColumns(columns = []) {
  const map = {};
  columns.forEach(col => { map[col.name] = col.value; });
  return map;
}

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

/**
 * sourceId — unique identifier of the source DB
 * e.g. "crew_management_erp"
 */
function parseChange(change, lsn, sourceId) {
  try {
    const {
      action,
      schema,
      table,
      columns  = [],
      identity = [],
      timestamp,
    } = change;

    if (action === 'B' || action === 'C') return null;

    const operationMap = { I: 'INSERT', U: 'UPDATE', D: 'DELETE' };
    const operation    = operationMap[action];
    if (!operation) {
      logger.warn('Unknown action', { action, sourceId });
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
      sourceId,             // "crew_management_erp"
      sourceSchema  : schema,
      sourceTable   : table,
      operation,
      primaryKey,
      oldData,
      newData,
      changedColumns,
      timestamp,
    };

    // ===== PRINT =====
    console.log(`\n========== CDC CHANGE [${sourceId}] ==========`);
    console.log(`  Database  : ${sourceId}`);
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

    console.log('=============================================\n');

    return event;

  } catch (err) {
    logger.error('Failed to parse change', {
      error    : err.message,
      sourceId,
      lsn,
    });
    return null;
  }
}

function parseWalPayload(lsn, rawData, sourceId) {
  try {
    const payload = JSON.parse(rawData);
    const changes = payload.change ? payload.change : [payload];
    return changes
      .map(c => parseChange(c, lsn, sourceId))
      .filter(Boolean);
  } catch (err) {
    logger.error('Failed to parse WAL payload', {
      error    : err.message,
      sourceId,
      lsn,
    });
    return [];
  }
}

module.exports = { parseWalPayload };
```

---

## Step 5: `src\storageWriter.js`

```js
const { Pool } = require('pg');
const logger   = require('./logger');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host     : process.env.STORAGE_HOST,
      port     : parseInt(process.env.STORAGE_PORT),
      database : process.env.STORAGE_DB,
      user     : process.env.STORAGE_USER,
      password : process.env.STORAGE_PASS,
      max      : 20,
      idleTimeoutMillis       : 30000,
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
    (lsn, source_database, source_schema, source_table,
     operation, primary_key, old_data, new_data, changed_columns)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

async function writeBatch(events) {
  if (!events.length) return;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const e of events) {
      await client.query(INSERT_SQL, [
        e.lsn,
        e.sourceId,            // DB identifier
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
    await moveToDeadLetter(events, err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function moveToDeadLetter(events, errorMsg) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const e of events) {
      await client.query(`
        INSERT INTO cdc_dead_letter
          (source_schema, source_table, operation, payload, error_message, attempts)
        VALUES ($1, $2, $3, $4, $5, 1)
      `, [
        e.sourceSchema,
        e.sourceTable,
        e.operation,
        JSON.stringify(e),
        errorMsg,
      ]);
    }
    await client.query('COMMIT');
    logger.warn(`Dead letter: ${events.length} event(s)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Dead letter write failed', { error: err.message });
  } finally {
    client.release();
  }
}

async function updateServiceState(serviceId, lsn, count) {
  try {
    await getPool().query(`
      INSERT INTO cdc_service_state (service_name, slot_name, last_lsn, total_events, last_heartbeat, updated_at)
      VALUES ($1, $1, $2, $3, now(), now())
      ON CONFLICT (service_name) DO UPDATE
        SET last_lsn       = $2,
            total_events   = cdc_service_state.total_events + $3,
            last_heartbeat = now(),
            status         = 'running',
            updated_at     = now()
    `, [serviceId, lsn, count]);
  } catch (err) {
    logger.warn('State update failed', { error: err.message, serviceId });
  }
}

async function updateServiceStatus(serviceId, status, errorMsg = null) {
  try {
    await getPool().query(`
      INSERT INTO cdc_service_state (service_name, slot_name, status, error_message, updated_at)
      VALUES ($1, $1, $2, $3, now())
      ON CONFLICT (service_name) DO UPDATE
        SET status        = $2,
            error_message = $3,
            updated_at    = now()
    `, [serviceId, status, errorMsg]);
  } catch (err) {
    logger.warn('Status update failed', { error: err.message });
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Storage pool closed');
  }
}

module.exports = {
  writeBatch,
  updateServiceState,
  updateServiceStatus,
  closePool,
};
```

---

## Step 6: `src\cdcPoller.js` — Reusable Class

```js
const { Client }          = require('pg');
const { parseWalPayload } = require('./changeProcessor');
const {
  writeBatch,
  updateServiceState,
  updateServiceStatus,
} = require('./storageWriter');
const logger = require('./logger');

const POLL_MS     = parseInt(process.env.POLL_INTERVAL_MS || '1000');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES       || '3');

class CDCPoller {
  constructor(config) {
    this.config     = config;        // from sources.js
    this.id         = config.id;     // "crew_management_erp"
    this.slotName   = config.slotName;
    this.client     = null;
    this.running    = false;
    this.errorCount = 0;
  }

  // ─── Connect ───────────────────────────────────────────
  async connect(retries = MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.client = new Client({
          host     : this.config.host,
          port     : this.config.port,
          database : this.config.database,
          user     : this.config.user,
          password : this.config.password,
          connectionTimeoutMillis : 5000,
        });

        this.client.on('error', (err) => {
          logger.error(`[${this.id}] Client error`, { error: err.message });
        });

        await this.client.connect();
        logger.info(`[${this.id}] Connected`, {
          host : this.config.host,
          db   : this.config.database,
        });
        return;

      } catch (err) {
        logger.error(`[${this.id}] Connect attempt ${attempt}/${retries}`, {
          error: err.message,
        });

        if (attempt === retries) {
          throw new Error(`[${this.id}] Failed to connect after ${retries} attempts`);
        }

        const wait = attempt * 2000;
        logger.info(`[${this.id}] Retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }

  // ─── Ensure Slot ───────────────────────────────────────
  async ensureSlot() {
    const res = await this.client.query(`
      SELECT slot_name, plugin, database
      FROM   pg_replication_slots
      WHERE  slot_name = $1
      AND    database  = current_database()
    `, [this.slotName]);

    if (res.rowCount === 0) {
      await this.client.query(
        `SELECT pg_create_logical_replication_slot($1, 'wal2json')`,
        [this.slotName]
      );
      logger.info(`[${this.id}] Slot created`, {
        slot : this.slotName,
      });
    } else {
      logger.info(`[${this.id}] Slot found`, {
        slot   : res.rows[0].slot_name,
        plugin : res.rows[0].plugin,
        db     : res.rows[0].database,
      });
    }
  }

  // ─── Poll ──────────────────────────────────────────────
  async poll() {
    const res = await this.client.query(`
      SELECT lsn, data
      FROM   pg_logical_slot_get_changes(
        $1, NULL, NULL,
        'format-version',    '2',
        'include-timestamp', '1',
        'write-in-chunks',   '0'
      )
    `, [this.slotName]);

    if (res.rowCount === 0) return;

    logger.info(`[${this.id}] WAL received`, { count: res.rowCount });

    const events = res.rows.flatMap(({ lsn, data }) =>
      parseWalPayload(lsn, data, this.id)
    );

    if (events.length > 0) {
      await writeBatch(events);
      const lastLsn = res.rows[res.rows.length - 1].lsn;
      await updateServiceState(this.id, lastLsn, events.length);
    }
  }

  // ─── Start ─────────────────────────────────────────────
  async start() {
    this.running = true;

    try {
      await this.connect();
      await this.ensureSlot();
    } catch (err) {
      logger.error(`[${this.id}] Startup failed`, { error: err.message });
      await updateServiceStatus(this.id, 'error', err.message);
      throw err;
    }

    logger.info(`[${this.id}] Poller started`, {
      slot     : this.slotName,
      interval : `${POLL_MS}ms`,
    });

    const loop = async () => {
      if (!this.running) return;

      try {
        await this.poll();
        this.errorCount = 0;
      } catch (err) {
        this.errorCount++;
        logger.error(`[${this.id}] Poll error`, {
          error   : err.message,
          attempt : this.errorCount,
        });

        await updateServiceStatus(this.id, 'error', err.message);

        // Reconnect after max errors
        if (this.errorCount >= MAX_RETRIES) {
          logger.warn(`[${this.id}] Max errors reached — reconnecting...`);
          try {
            await this.client.end().catch(() => {});
            await this.connect();
            await this.ensureSlot();
            this.errorCount = 0;
            await updateServiceStatus(this.id, 'running');
            logger.info(`[${this.id}] Reconnected`);
          } catch (reconnErr) {
            logger.error(`[${this.id}] Reconnect failed`, {
              error: reconnErr.message,
            });
          }
        }
      }

      setTimeout(loop, POLL_MS);
    };

    loop();
  }

  // ─── Stop ──────────────────────────────────────────────
  async stop() {
    this.running = false;
    if (this.client) {
      try {
        await this.client.end();
        logger.info(`[${this.id}] Disconnected`);
      } catch (err) {
        logger.warn(`[${this.id}] Disconnect error`, { error: err.message });
      }
    }
    await updateServiceStatus(this.id, 'stopped');
  }
}

module.exports = CDCPoller;
```

---

## Step 7: `src\index.js`

```js
require('dotenv').config();

const CDCPoller = require('./cdcPoller');
const storage   = require('./storageWriter');
const logger    = require('./logger');
const sources   = require('../config/sources');

// Validate required env vars
const REQUIRED = [
  'STORAGE_HOST', 'STORAGE_PORT',
  'STORAGE_DB',   'STORAGE_USER', 'STORAGE_PASS',
];

function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length > 0) {
    logger.error('Missing required env vars', { missing });
    process.exit(1);
  }
}

async function main() {
  logger.info('=================================');
  logger.info('   CDC Service Starting...       ');
  logger.info('=================================');

  validateEnv();

  // Filter enabled sources only
  const activeSources = sources.filter(s => s.enabled);

  if (activeSources.length === 0) {
    logger.error('No active source DBs configured');
    process.exit(1);
  }

  logger.info(`Starting ${activeSources.length} poller(s)`, {
    sources: activeSources.map(s => s.id),
  });

  // Start one poller per source DB
  const pollers = activeSources.map(config => new CDCPoller(config));

  // Start all pollers in parallel
  await Promise.allSettled(
    pollers.map(async (poller) => {
      try {
        await poller.start();
      } catch (err) {
        logger.error(`Failed to start poller`, {
          id    : poller.id,
          error : err.message,
        });
      }
    })
  );

  // Graceful shutdown
  async function shutdown(signal) {
    logger.info(`Signal: ${signal} — shutting down...`);
    await Promise.allSettled(pollers.map(p => p.stop()));
    await storage.closePool();
    logger.info('All pollers stopped. Goodbye.');
    process.exit(0);
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught exception', { error: err.message });
    await shutdown('uncaughtException');
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    await shutdown('unhandledRejection');
  });
}

main().catch(err => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});
```

---

## Step 8: Setup Each Source DB

Run for **each source database**:

```cmd
psql -U postgres -d crew_management_erp
```

```sql
-- REPLICA IDENTITY FULL
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END;
$$;

-- Create slot (slot name must match .env)
SELECT pg_create_logical_replication_slot('cdc_slot_crew', 'wal2json');
\q
```

```cmd
psql -U postgres -d finance_db
```

```sql
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END;
$$;

SELECT pg_create_logical_replication_slot('cdc_slot_finance', 'wal2json');
\q
```

---

## Step 9: Run

```cmd
cd C:\cdc-service
npm start
```

---

## Expected Output

```
[INFO ] =================================
[INFO ]    CDC Service Starting...
[INFO ] =================================
[INFO ] Starting 3 poller(s) {"sources":["crew_management_erp","finance_db","hr_db"]}
[INFO ] [crew_management_erp] Connected {"host":"localhost","db":"crew_management_erp"}
[INFO ] [finance_db] Connected {"host":"localhost","db":"finance_db"}
[INFO ] [hr_db] Connected {"host":"192.168.1.100","db":"hr_db"}
[INFO ] [crew_management_erp] Slot found {"slot":"cdc_slot_crew","plugin":"wal2json"}
[INFO ] [finance_db] Slot found {"slot":"cdc_slot_finance","plugin":"wal2json"}
[INFO ] [hr_db] Slot found {"slot":"cdc_slot_hr","plugin":"wal2json"}
[INFO ] [crew_management_erp] Poller started {"interval":"1000ms"}
[INFO ] [finance_db] Poller started {"interval":"1000ms"}
[INFO ] [hr_db] Poller started {"interval":"1000ms"}

========== CDC CHANGE [crew_management_erp] ==========
  Database  : crew_management_erp
  Schema    : public
  Table     : vessel_planning_v2
  Operation : UPDATE
  ✏️  CHANGED COLUMNS:
    • joining_status
        old : "In Transit"
        new : "Confirmed"
=======================================================

========== CDC CHANGE [finance_db] ==========
  Database  : finance_db
  Schema    : public
  Table     : invoices
  Operation : INSERT
  ➕ NEW ROW: { "id": 201, "amount": 5000 }
=============================================
```

---

## Query Changes Per Source

```sql
-- All changes from specific DB
SELECT * FROM cdc_change_log
WHERE source_database = 'crew_management_erp'
ORDER BY captured_at DESC;

-- All changes across all DBs
SELECT
  source_database,
  source_table,
  operation,
  changed_columns,
  captured_at
FROM cdc_change_log
ORDER BY captured_at DESC
LIMIT 50;

-- Count per DB
SELECT
  source_database,
  COUNT(*) as total,
  SUM(CASE WHEN operation='INSERT' THEN 1 ELSE 0 END) as inserts,
  SUM(CASE WHEN operation='UPDATE' THEN 1 ELSE 0 END) as updates,
  SUM(CASE WHEN operation='DELETE' THEN 1 ELSE 0 END) as deletes
FROM cdc_change_log
GROUP BY source_database;
```

---

## Adding a New Source DB Later

Just do **3 things**:

**1. Add to `.env`:**
```env
DB4_HOST=localhost
DB4_PORT=5432
DB4_NAME=new_db
DB4_USER=postgres
DB4_PASS=password
DB4_SLOT=cdc_slot_new
```

**2. Add to `config\sources.js`:**
```js
{
  id       : 'new_db',
  host     : process.env.DB4_HOST,
  port     : parseInt(process.env.DB4_PORT),
  database : process.env.DB4_NAME,
  user     : process.env.DB4_USER,
  password : process.env.DB4_PASS,
  slotName : process.env.DB4_SLOT,
  enabled  : true,
},
```

**3. Setup the DB:**
```sql
\c new_db
ALTER TABLE your_table REPLICA IDENTITY FULL;
SELECT pg_create_logical_replication_slot('cdc_slot_new', 'wal2json');
```

**Restart service — done ✅**