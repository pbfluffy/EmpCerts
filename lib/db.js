const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  employee_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  department    TEXT,
  position      TEXT,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'employee',
  status        TEXT NOT NULL DEFAULT 'active',
  created_date  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS certificate_requests (
  request_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id       INTEGER NOT NULL REFERENCES employees(employee_id),
  reason            TEXT NOT NULL,
  other_reason      TEXT,
  include_salary    INTEGER NOT NULL DEFAULT 0,
  salary_amount     REAL,
  language          TEXT DEFAULT 'English',
  delivery_method   TEXT NOT NULL,
  remarks           TEXT,
  status            TEXT NOT NULL DEFAULT 'Submitted',
  approver_id       INTEGER REFERENCES employees(employee_id),
  approval_date     TEXT,
  rejection_reason  TEXT,
  pdf_ready         INTEGER NOT NULL DEFAULT 0,
  created_date      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES certificate_requests(request_id),
  approver_id   INTEGER NOT NULL REFERENCES employees(employee_id),
  status        TEXT NOT NULL,
  comment       TEXT,
  action_date   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signup_requests (
  signup_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  department      TEXT,
  position        TEXT,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
  reviewed_by     INTEGER REFERENCES employees(employee_id),
  reviewed_date   TEXT,
  rejection_reason TEXT,
  created_date    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  log_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   INTEGER,
  details     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let initialized = false;
async function ensureSchema() {
  if (initialized) return;
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await client.execute(stmt);
  }
  // Migration: add 'signature' column to employees if it doesn't exist yet
  // (for HR Staff/Director to upload a signature image used on approved certificates).
  try {
    await client.execute('ALTER TABLE employees ADD COLUMN signature TEXT');
  } catch (e) {
    // Column already exists — ignore.
  }
  // Migration: add 'employee_id' to signup_requests — the person now supplies
  // their desired Employee ID at signup time; admin fills in name/dept/etc.
  // at approval time.
  try {
    await client.execute('ALTER TABLE signup_requests ADD COLUMN employee_id INTEGER');
  } catch (e) {
    // Column already exists — ignore.
  }
  // Migration: add must_change_password flag — set on accounts with auto-generated
  // temp passwords (bulk import), forces a password reset on first login.
  try {
    await client.execute('ALTER TABLE employees ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  } catch (e) { /* already exists */ }
  // Migration: add joining_date to employees table
  try {
    await client.execute('ALTER TABLE employees ADD COLUMN joining_date TEXT');
  } catch (e) { /* already exists */ }
  initialized = true;
}

async function run(sql, args = []) {
  await ensureSchema();
  return client.execute({ sql, args });
}

async function get(sql, args = []) {
  const res = await run(sql, args);
  return res.rows[0] || null;
}

async function all(sql, args = []) {
  const res = await run(sql, args);
  return res.rows;
}

async function audit(actorId, action, entity, entityId, details) {
  await run(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)`,
    [actorId || null, action, entity || null, entityId || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = { run, get, all, audit, client };
