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