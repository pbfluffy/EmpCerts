const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { run, get, all, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];
// username is now auto-managed internally as emp_<employee_id>
const REQUIRED_CSV_HEADERS = ['employee_id', 'full_name', 'email'];

function autoUsername(employeeId) {
  return `emp_${employeeId}`;
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
    + Math.floor(10 + Math.random() * 90);
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
    const full_name = get_('full_name');
    const email = get_('email');
    const department = get_('department');
    const position = get_('position');
    const joining_date = get_('joining_date') || null;
    let role = get_('role').toLowerCase() || 'employee';

    if (!employeeIdRaw || !full_name || !email) {
      results.skipped.push({ row: rowNum, reason: 'Missing required field(s) (Employee_ID, full_name, email)' });
      continue;
    }
    const employeeId = Number(employeeIdRaw);
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      results.skipped.push({ row: rowNum, reason: `Invalid Employee_ID "${employeeIdRaw}" — must be a positive whole number` });
      continue;
    }
    if (!ROLES.includes(role)) {
      results.skipped.push({ row: rowNum, reason: `Invalid role "${role}" — must be one of ${ROLES.join(', ')}` });
      continue;
    }

    const existingById = await get('SELECT employee_id FROM employees WHERE employee_id = ?', [employeeId]);
    if (existingById) {
      // UPDATE — auto-refresh username too in case it was set to something old
      const fields = ['username = ?', 'full_name = ?', 'email = ?', 'role = ?'];
      const values = [autoUsername(employeeId), full_name, email, role];
      if (department !== undefined) { fields.push('department = ?'); values.push(department || null); }
      if (position !== undefined) { fields.push('position = ?'); values.push(position || null); }
      if (joining_date !== undefined) { fields.push('joining_date = ?'); values.push(joining_date || null); }
      values.push(employeeId);
      await run(`UPDATE employees SET ${fields.join(', ')} WHERE employee_id = ?`, values);
      results.updated.push({ row: rowNum, employee_id: employeeId, role });
    } else {
      // CREATE — auto-generate username and temp password
      const tempPassword = generateTempPassword();
      const hash = bcrypt.hashSync(tempPassword, 10);
      await run(`
        INSERT INTO employees (employee_id, username, password_hash, full_name, department, position, email, role, joining_date, must_change_password)
        VALUES (?,?,?,?,?,?,?,?,?,1)
      `, [employeeId, autoUsername(employeeId), hash, full_name, department || null, position || null, email, role, joining_date, 1]);
      results.created.push({ row: rowNum, employee_id: employeeId, role, temp_password: tempPassword });
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
    if (req.query.audit === '1') {
      const logs = await all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500');
      return res.status(200).json({ logs });
    }
    const rows = await all(`
      SELECT employee_id, full_name, department, position, email, role, status, created_date
      FROM employees ORDER BY created_date DESC
    `);
    return res.status(200).json({ users: rows });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);

    if (typeof body.csv === 'string' && body.csv.trim()) {
      return handleBulkImport(u, body.csv, res);
    }

    // Single user creation — Employee ID is required (must come from HR records)
    let { full_name, department, position, email, role, employee_id, joining_date } = body;
    if (!full_name || !email || !employee_id) {
      return res.status(400).json({ error: 'Employee ID, full_name, and email are required' });
    }
    role = ROLES.includes(role) ? role : 'employee';

    const existingEmail = await get('SELECT employee_id FROM employees WHERE LOWER(email) = ?', [email.toLowerCase()]);
    if (existingEmail) return res.status(409).json({ error: 'Email already in use' });

    const empId = Number(employee_id);
    if (!Number.isInteger(empId) || empId <= 0) {
      return res.status(400).json({ error: 'Employee ID must be a positive whole number' });
    }
    const existingId = await get('SELECT employee_id FROM employees WHERE employee_id = ?', [empId]);
    if (existingId) return res.status(409).json({ error: `Employee ID ${empId} is already in use` });

    const tempPassword = generateTempPassword();
    const hash = bcrypt.hashSync(tempPassword, 10);
    await run(`
      INSERT INTO employees (employee_id, username, password_hash, full_name, department, position, email, role, joining_date, must_change_password)
      VALUES (?,?,?,?,?,?,?,?,?,1)
    `, [empId, autoUsername(empId), hash, full_name, department || null, position || null, email, role, joining_date || null]);

    await audit(u.employee_id, 'CREATE_USER', 'employee', empId, { role });
    return res.status(201).json({ employee_id: empId, temp_password: tempPassword });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireRole('admin')(handler);
