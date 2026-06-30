const bcrypt = require('bcryptjs');
const { run, get, all, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];

async function handler(req, res) {
  const u = req.user;

  if (req.method === 'GET') {
    const rows = await all(`
      SELECT employee_id, username, full_name, department, position, email, role, status, created_date
      FROM employees ORDER BY created_date DESC
    `);
    return res.status(200).json({ users: rows });
  }

  if (req.method === 'POST') {
    let { username, password, full_name, department, position, email, role } = await readBody(req);
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
