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