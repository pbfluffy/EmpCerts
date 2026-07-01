const { run, get, all, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

// HR Staff and HR Director can view and update employee info (name, dept,
// position, email), but CANNOT touch passwords, roles, or account status.
// Those remain admin-only.

async function handler(req, res) {
  const u = req.user;

  if (req.method === 'GET') {
    const rows = await all(`
      SELECT employee_id, username, full_name, department, position, email, role, status
      FROM employees ORDER BY status ASC, full_name ASC
    `);
    return res.status(200).json({ users: rows });
  }

  if (req.method === 'PUT') {
    const { id } = req.query;
    const { full_name, department, position, email } = await readBody(req);

    const target = await get('SELECT * FROM employees WHERE employee_id = ?', [id]);
    if (!target) return res.status(404).json({ error: 'Not found' });

    const fields = [];
    const values = [];
    if (full_name !== undefined && full_name.trim()) { fields.push('full_name = ?'); values.push(full_name.trim()); }
    if (department !== undefined) { fields.push('department = ?'); values.push(department || null); }
    if (position !== undefined) { fields.push('position = ?'); values.push(position || null); }
    if (email !== undefined && email.trim()) { fields.push('email = ?'); values.push(email.trim()); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(id);
    await run(`UPDATE employees SET ${fields.join(', ')} WHERE employee_id = ?`, values);

    await audit(u.employee_id, 'HR_UPDATE_USER', 'employee', id, { full_name, department, position, email });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireRole('hr_staff', 'hr_director')(handler);
