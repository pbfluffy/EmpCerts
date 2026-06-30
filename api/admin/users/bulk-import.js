const bcrypt = require('bcryptjs');
const { run, get, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];
const REQUIRED_HEADERS = ['username', 'password', 'full_name', 'email'];

// Minimal CSV parser: handles quoted fields containing commas, and trims whitespace.
function parseCSV(text) {
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

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  const { csv } = await readBody(req);

  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content provided' });
  }

  const { headers, rows } = parseCSV(csv);
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
  if (missing.length > 0) {
    return res.status(400).json({ error: `CSV is missing required column(s): ${missing.join(', ')}` });
  }

  const colIndex = {};
  headers.forEach((h, i) => { colIndex[h] = i; });

  const results = { created: [], skipped: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
    const get_ = (col) => (colIndex[col] !== undefined ? (row[colIndex[col]] || '').trim() : '');

    const username = get_('username');
    const password = get_('password');
    const full_name = get_('full_name');
    const email = get_('email');
    const department = get_('department');
    const position = get_('position');
    let role = get_('role').toLowerCase() || 'employee';

    if (!username || !password || !full_name || !email) {
      results.skipped.push({ row: rowNum, reason: 'Missing required field(s) (username, password, full_name, email)' });
      continue;
    }
    if (!ROLES.includes(role)) {
      results.skipped.push({ row: rowNum, username, reason: `Invalid role "${role}" — must be one of ${ROLES.join(', ')}` });
      continue;
    }

    const existing = await get('SELECT employee_id FROM employees WHERE username = ?', [username]);
    if (existing) {
      results.skipped.push({ row: rowNum, username, reason: 'Username already exists' });
      continue;
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await run(`
      INSERT INTO employees (username, password_hash, full_name, department, position, email, role)
      VALUES (?,?,?,?,?,?,?)
    `, [username, hash, full_name, department || null, position || null, email, role]);

    const employeeId = Number(result.lastInsertRowid);
    results.created.push({ row: rowNum, employee_id: employeeId, username, role });
  }

  await audit(u.employee_id, 'BULK_IMPORT_USERS', 'employee', null, {
    created_count: results.created.length,
    skipped_count: results.skipped.length
  });

  res.status(200).json(results);
}

module.exports = requireRole('admin')(handler);
