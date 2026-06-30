const { all } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;

  if (!['hr_staff', 'hr_director'].includes(u.role)) {
    return res.status(403).json({ error: 'Forbidden: only HR Staff or HR Director can view approval queues' });
  }

  // HR Staff approves requests WITHOUT salary info.
  // HR Director approves requests WITH salary info (and enters the salary figure).
  const wantsSalary = u.role === 'hr_director' ? 1 : 0;

  const rows = await all(`
    SELECT r.*, e.full_name AS employee_name, e.department, e.position
    FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
    WHERE r.status = 'Pending Approval' AND r.include_salary = ?
    ORDER BY r.created_date ASC
  `, [wantsSalary]);
  res.status(200).json({ requests: rows });
}

module.exports = requireAuth(handler);
