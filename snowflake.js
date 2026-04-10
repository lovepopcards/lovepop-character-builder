/* snowflake.js — Snowflake connection + sales cache refresh
   ============================================================ */
const db = require('./database');

let snowflake;
try { snowflake = require('snowflake-sdk'); } catch { snowflake = null; }
if (snowflake) snowflake.configure({ logLevel: 'ERROR' });

// ── Build connection options from env vars or DB settings ─────
function getConnOpts() {
  const s = db.getAllSettings();
  const pick = (envKey, settingKey, fallback = '') =>
    process.env[envKey] || s[settingKey] || fallback;

  const account  = pick('SNOWFLAKE_ACCOUNT',   'snowflake_account');
  const username = pick('SNOWFLAKE_USERNAME',   'snowflake_username');
  const password = pick('SNOWFLAKE_PASSWORD',   'snowflake_password');
  const warehouse= pick('SNOWFLAKE_WAREHOUSE',  'snowflake_warehouse');
  const database = pick('SNOWFLAKE_DATABASE',   'snowflake_database');
  const schema   = pick('SNOWFLAKE_SCHEMA',     'snowflake_schema', 'PUBLIC');
  const role     = pick('SNOWFLAKE_ROLE',       'snowflake_role');

  if (!account || !username || !password) {
    throw new Error('Snowflake credentials not configured (account, username, password required)');
  }
  const opts = { account, username, password, warehouse, database, schema };
  if (role) opts.role = role;
  return opts;
}

// ── Execute a SQL query, return rows ─────────────────────────
async function query(sql) {
  if (!snowflake) throw new Error('snowflake-sdk is not installed');
  const opts = getConnOpts();
  const conn = snowflake.createConnection(opts);

  await new Promise((resolve, reject) => {
    conn.connect((err, c) => { if (err) reject(err); else resolve(c); });
  });

  try {
    return await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        complete: (err, _stmt, rows) => {
          if (err) reject(err); else resolve(rows || []);
        },
      });
    });
  } finally {
    conn.destroy(() => {});
  }
}

// ── Refresh sales cache from Snowflake ────────────────────────
// The configured SQL must return rows with columns (case-insensitive):
//   sku, t12m_revenue, t12m_units, asp
async function refreshSalesCache() {
  const s = db.getAllSettings();
  const sql = s.snowflake_query || '';
  if (!sql.trim()) throw new Error('No Snowflake sales query configured in Settings');

  const rows = await query(sql);
  db.upsertSalesCache(rows);
  return rows.length;
}

// ── Test connectivity (cheap query) ──────────────────────────
async function testConnection() {
  await query('SELECT CURRENT_TIMESTAMP() AS now');
  return true;
}

module.exports = { query, refreshSalesCache, testConnection };
