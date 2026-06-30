const { all } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rows = await all(`
    SELECT r.*, e.full_name AS employee_name
    FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
    ORDER BY r.created_date DESC
  `);
  res.status(200).json({ requests: rows });
}

module.exports = requireRole('hr_staff', 'hr_director')(handler);
