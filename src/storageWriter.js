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
    (lsn, source_schema, source_table,
     operation, primary_key, old_data, new_data, changed_columns)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

async function writeBatch(events) {
  if (!events.length) return;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const e of events) {
      await client.query(INSERT_SQL, [
        e.lsn,
        e.sourceId,// DB identifier
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