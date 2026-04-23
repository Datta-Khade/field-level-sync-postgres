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

    // Skip UPDATE events where the ONLY changed column is `updated_at`
    // (no meaningful business data changed — just a timestamp touch).
    if (operation === 'UPDATE' && changedColumns) {
      const cols = Object.keys(changedColumns);
      if (cols.length > 0 && cols.every(c => c === 'updated_at')) {
        logger.debug('Skipping update-only-updated_at event', { table, lsn });
        return null;
      }
    }

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