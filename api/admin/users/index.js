const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { run, get, all, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];
// password column is now optional — auto-generated for new accounts
const REQUIRED_CSV_HEADERS = ['employee_id', 'username', 'full_name', 'email'];

function generateTempPassword() {
  // 12-character alphanumeric temp password, easy to share
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
    + Math.floor(10 + Math.random() * 90); // always ends with 2 digits for complexity
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    fields.push(cur);
    return fields.map(f => f.trim());
  };
  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

async function handleBulkImport(u, csv, res) {
  const { headers, rows } = parseCSV(csv);
  const missing = REQUIRED_CSV_HEADERS.filter(h => !headers.includes(h));
  if (missing.length > 0) {
    return res.status(400).json({ error: `CSV is missing required column(s): ${missing.join(', ')}` });
  }
  const colIndex = {};
  headers.forEach((h, i) => { colIndex[h] = i; });
  const results = { created: [], updated: [], skipped: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const get_ = (col) => (colIndex[col] !== undefined ? (row[colIndex[col]] || '').trim() : '');

    const employeeIdRaw = get_('employee_id');
    const username = get_('username');
    const password = get_('password');
    const full_name = get_('full_name');
    const email = get_('email');
    const department = get_('department');
    const position = get_('position');
    let role = get_('role').toLowerCase() || 'employee';

    if (!employeeIdRaw || !username || !full_name || !email) {
      results.skipped.push({ row: rowNum, reason: 'Missing required field(s) (Employee_ID, username, full_name, email)' });
      continue;
    }
    const employeeId = Number(employeeIdRaw);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      results.skipped.push({ row: rowNum, username, reason: `Invalid Employee_ID "${employeeIdRaw}" — must be a positive whole number` });
      continue;
    }
    if (!ROLES.includes(role)) {
      results.skipped.push({ row: rowNum, username, reason: `Invalid role "${role}" — must be one of ${ROLES.join(', ')}` });
      continue;
    }

    const existingById = await get('SELECT employee_id FROM employees WHERE employee_id = ?', [employeeId]);
    if (existingById) {
      // UPDATE existing user — password column is ignored entirely on updates
      const fields = ['username = ?', 'full_name = ?', 'email = ?', 'role = ?'];
      const values = [username, full_name, email, role];
      if (department !== undefined) { fields.push('department = ?'); values.push(department || null); }
      if (position !== undefined) { fields.push('position = ?'); values.push(position || null); }
      values.push(employeeId);
      await run(`UPDATE employees SET ${fields.join(', ')} WHERE employee_id = ?`, values);
      results.updated.push({ row: rowNum, employee_id: employeeId, username, role });
    } else {
      // CREATE new user — auto-generate a temp password, flag for reset on first login
      const existingByUsername = await get('SELECT employee_id FROM employees WHERE username = ?', [username]);
      if (existingByUsername) {
        results.skipped.push({ row: rowNum, username, reason: `Username "${username}" is already used by Employee_ID ${existingByUsername.employee_id}` });
        continue;
      }
      const tempPassword = generateTempPassword();
      const hash = bcrypt.hashSync(tempPassword, 10);
      await run(`
        INSERT INTO employees (employee_id, username, password_hash, full_name, department, position, email, role, must_change_password)
        VALUES (?,?,?,?,?,?,?,?,1)
      `, [employeeId, username, hash, full_name, department || null, position || null, email, role]);
      // Return temp password in results so admin can distribute it
      results.created.push({ row: rowNum, employee_id: employeeId, username, role, temp_password: tempPassword });
    }
  }

  await audit(u.employee_id, 'BULK_IMPORT_USERS', 'employee', null, {
    created_count: results.created.length,
    updated_count: results.updated.length,
    skipped_count: results.skipped.length
  });
  return res.status(200).json(results);
}

async function handler(req, res) {
  const u = req.user;

  if (req.method === 'GET') {
    // ?audit=1 -> audit log instead of user list
    if (req.query.audit === '1') {
      const logs = await all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500');
      return res.status(200).json({ logs });
    }
    const rows = await all(`
      SELECT employee_id, username, full_name, department, position, email, role, status, created_date
      FROM employees ORDER BY created_date DESC
    `);
    return res.status(200).json({ users: rows });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);

    // CSV bulk import path
    if (typeof body.csv === 'string' && body.csv.trim()) {
      return handleBulkImport(u, body.csv, res);
    }

    // Single user creation path
    let { username, password, full_name, department, position, email, role } = body;
    if (!username || !password || !full_name || !email) {
      return res.status(400).json({ error: 'username, password, full_name, email are required' });
    }
    role = ROLES.includes(role) ? role : 'employee';
    const existing = await get('SELECT employee_id FROM employees WHERE username = ?', [username]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await run(`
      INSERT INTO employees (username, password_hash, full_name, department, position, email, role)
      VALUES (?,?,?,?,?,?,?)
    `, [username, hash, full_name, department || null, position || null, email, role]);

    const employeeId = Number(result.lastInsertRowid);
    await audit(u.employee_id, 'CREATE_USER', 'employee', employeeId, { username, role });
    return res.status(201).json({ employee_id: employeeId });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireRole('admin')(handler);
