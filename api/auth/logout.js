const { clearAuthCookie, getUser } = require('../../lib/auth');
const { audit } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = getUser(req);
  clearAuthCookie(res);
  if (user) await audit(user.employee_id, 'LOGOUT', 'employee', user.employee_id, null);
  res.status(200).json({ ok: true });
};
