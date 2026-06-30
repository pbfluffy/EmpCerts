const { all } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rows = await all(`
    SELECT r.*, e.full_name AS employee_name, e.department, e.position
    FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
    WHERE r.status = 'Pending Approval'
    ORDER BY r.created_date ASC
  `);
  res.status(200).json({ requests: rows });
}

module.exports = requireRole('hr_director_or_above')(handler);
