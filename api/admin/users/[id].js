const bcrypt = require('bcryptjs');
const { run, get, all, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];

async function handler(req, res) {
  const u = req.user;
  const { id } = req.query;

  if (req.method === 'PUT') {
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
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const target = await get('SELECT * FROM employees WHERE employee_id = ?', [id]);
    if (!target) return res.status(404).json({ error: 'Not found' });

    if (Number(id) === u.employee_id) {
      return res.status(400).json({ error: 'You cannot delete your own account while logged in as it' });
    }

    // Block deletion if this employee has certificate requests on file —
    // deleting them would break the audit trail / referential integrity.
    const linkedRequests = await all('SELECT request_id FROM certificate_requests WHERE employee_id = ? LIMIT 1', [id]);
    if (linkedRequests.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete: this user has certificate request history on file. Disable the account instead.'
      });
    }

    await run('DELETE FROM employees WHERE employee_id = ?', [id]);
    await audit(u.employee_id, 'DELETE_USER', 'employee', id, { username: target.username });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireRole('admin')(handler);
