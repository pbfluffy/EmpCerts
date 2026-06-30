const bcrypt = require('bcryptjs');
const { run, get, all, audit } = require('../../lib/db');
const { readBody } = require('../../lib/auth');
const { sendMail } = require('../../lib/mailer');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { username, password, full_name, department, position, email } = await readBody(req);

  if (!username || !password || !full_name || !email) {
    return res.status(400).json({ error: 'Username, password, full name, and email are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existingUser = await get('SELECT employee_id FROM employees WHERE username = ?', [username]);
  if (existingUser) {
    return res.status(409).json({ error: 'That username is already in use by an existing account' });
  }
  const existingSignup = await get(`SELECT signup_id FROM signup_requests WHERE username = ? AND status = 'Pending'`, [username]);
  if (existingSignup) {
    return res.status(409).json({ error: 'A signup request with that username is already pending approval' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await run(`
    INSERT INTO signup_requests (username, password_hash, full_name, department, position, email)
    VALUES (?,?,?,?,?,?)
  `, [username, hash, full_name, department || null, position || null, email]);

  const signupId = Number(result.lastInsertRowid);
  await audit(null, 'SIGNUP_REQUESTED', 'signup_request', signupId, { username });

  // Notify admins by email (non-blocking)
  const admins = (await all(`SELECT email FROM employees WHERE role = 'admin' AND status = 'active'`))
    .map(a => a.email).filter(Boolean);
  sendMail({
    to: admins,
    subject: `[Action needed] New account request: ${full_name}`,
    text: `${full_name} (${username}, ${email}) has requested an account.\n\nLog in to review: ${process.env.APP_URL || ''}/admin.html`
  }).catch(() => {});

  res.status(201).json({ ok: true, message: 'Your request has been submitted and is pending administrator approval.' });
};
