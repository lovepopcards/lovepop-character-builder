/* snowflake.js — Snowflake connection + sales cache refresh
   ============================================================ */
const crypto = require('crypto');
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

  // Key-pair login (what Lovepop's read-only service user uses) when SNOWFLAKE_PRIVATE_KEY is set;
  // otherwise the original password login.
  const privateKey = getPrivateKeyPem();
  if (!account || !username || (!password && !privateKey)) {
    throw new Error('Snowflake credentials not configured (account, username, and a password or SNOWFLAKE_PRIVATE_KEY required)');
  }
  const opts = privateKey
    ? { account, username, authenticator: 'SNOWFLAKE_JWT', privateKey, warehouse, database, schema }
    : { account, username, password, warehouse, database, schema };
  if (role) opts.role = role;
  return opts;
}

// The unencrypted PKCS8 PEM snowflake-sdk expects, from SNOWFLAKE_PRIVATE_KEY (real newlines or the
// literal "\n" used to keep it on one line in Railway variables), decrypted with
// SNOWFLAKE_PRIVATE_KEY_PASSPHRASE when the key is encrypted. null when unset.
function getPrivateKeyPem() {
  const raw = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!raw) return null;
  const pem = raw.replace(/\\n/g, '\n');
  const passphrase = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || undefined;
  const key = crypto.createPrivateKey(passphrase ? { key: pem, format: 'pem', passphrase } : { key: pem, format: 'pem' });
  return key.export({ format: 'pem', type: 'pkcs8' });
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
