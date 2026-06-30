const bcrypt = require('bcryptjs');
const { get, audit } = require('../../lib/db');
const { setAuthCookie, readBody } = require('../../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { username, password } = await readBody(req);
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Accept username, Employee ID, or email as the login identifier
  // (the login screen advertises all three, so the backend needs to match).
  const identifier = String(username).trim();
  const isNumericId = /^\d+$/.test(identifier);

  const user = isNumericId
    ? await get('SELECT * FROM employees WHERE employee_id = ? OR username = ?', [Number(identifier), identifier])
    : await get('SELECT * FROM employees WHERE username = ? OR email = ?', [identifier, identifier]);

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
