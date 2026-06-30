const { all } = require('../../../lib/db');
const { requireRole } = require('../../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rows = await all(`
    SELECT signup_id, username, full_name, department, position, email, status, created_date
    FROM signup_requests WHERE status = 'Pending' ORDER BY created_date ASC
  `);
  res.status(200).json({ signups: rows });
}

module.exports = requireRole('admin')(handler);
