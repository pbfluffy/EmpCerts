const bcrypt = require('bcryptjs');
const { get, audit } = require('../../lib/db');
const { setAuthCookie, readBody } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { username, password } = await readBody(req);
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const user = await get('SELECT * FROM employees WHERE username = ?', [username]);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const sessionUser = {
    employee_id: user.employee_id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    department: user.department,
    position: user.position,
    email: user.email
  };
  setAuthCookie(res, sessionUser);
  await audit(user.employee_id, 'LOGIN', 'employee', user.employee_id, null);
  res.status(200).json({ user: sessionUser });
};
