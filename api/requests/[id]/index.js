const { get } = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  if (u.role === 'admin') {
    return res.status(403).json({ error: 'Administrators manage users only and cannot view certificate requests' });
  }
  const { id } = req.query;

  const row = await get(`
    SELECT r.*, e.full_name AS employee_name, e.email AS employee_email
    FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
    WHERE r.request_id = ?
  `, [id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (u.role === 'employee' && row.employee_id !== u.employee_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.status(200).json({ request: row });
}

module.exports = requireAuth(handler);
