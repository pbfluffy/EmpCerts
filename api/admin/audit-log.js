const { all } = require('../../lib/db');
const { requireRole } = require('../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rows = await all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500');
  res.status(200).json({ logs: rows });
}

module.exports = requireRole('admin')(handler);
