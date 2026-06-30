const bcrypt = require('bcryptjs');
const { run, get, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];

async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  const { id } = req.query;
  const body = await readBody(req);
  const { full_name, department, position, email, role, status, password } = body;

  const target = await get('SELECT * FROM employees WHERE employee_id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'Not found' });

  const fields = [];
  const values = [];
  if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name); }
  if (department !== undefined) { fields.push('department = ?'); values.push(department); }
  if (position !== undefined) { fields.push('position = ?'); values.push(position); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (role !== undefined && ROLES.includes(role)) { fields.push('role = ?'); values.push(role); }
  if (status !== undefined && ['active', 'disabled'].includes(status)) { fields.push('status = ?'); values.push(status); }
  if (password) { fields.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10)); }

  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  values.push(id);
  await run(`UPDATE employees SET ${fields.join(', ')} WHERE employee_id = ?`, values);

  await audit(u.employee_id, 'UPDATE_USER', 'employee', id, body);
  res.status(200).json({ ok: true });
}

module.exports = requireRole('admin')(handler);
