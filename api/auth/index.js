const bcrypt = require('bcryptjs');
const { run, get, all, audit } = require('../../lib/db');
const { setAuthCookie, clearAuthCookie, getUser, readBody } = require('../../lib/auth');
const { sendMail } = require('../../lib/mailer');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    return res.status(200).json({ user });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = await readBody(req);
  const action = body.action;

  if (action === 'login') {
    // Login is by email only.
    const { email, password } = body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const emailTrimmed = String(email).trim().toLowerCase();
    const user = await get('SELECT * FROM employees WHERE LOWER(email) = ?', [emailTrimmed]);

    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const sessionUser = {
      employee_id: user.employee_id,
      full_name: user.full_name,
      role: user.role,
      department: user.department,
      position: user.position,
      email: user.email,
      must_change_password: user.must_change_password === 1 ? true : false
    };
    setAuthCookie(res, sessionUser);
    await audit(user.employee_id, 'LOGIN', 'employee', user.employee_id, null);
    return res.status(200).json({ user: sessionUser });
  }

  if (action === 'logout') {
    const user = getUser(req);
    clearAuthCookie(res);
    if (user) await audit(user.employee_id, 'LOGOUT', 'employee', user.employee_id, null);
    return res.status(200).json({ ok: true });
  }

  if (action === 'signup') {
    // Simplified self-service signup: only Employee ID, email, and password.
    // Everything else (name, department, position, role, username) is filled
    // in by an admin when they review and approve the request.
    const { employee_id, email, password } = body;

    if (!employee_id || !email || !password) {
      return res.status(400).json({ error: 'Employee ID, email, and password are required' });
    }
    const empId = Number(employee_id);
    if (!Number.isInteger(empId) || empId <= 0) {
      return res.status(400).json({ error: 'Employee ID must be a positive whole number' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const emailTrimmed = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const existingId = await get('SELECT employee_id FROM employees WHERE employee_id = ?', [empId]);
    if (existingId) {
      return res.status(409).json({ error: 'That Employee ID is already registered. If this is your ID, contact your administrator.' });
    }
    const existingEmail = await get('SELECT employee_id FROM employees WHERE LOWER(email) = ?', [emailTrimmed]);
    if (existingEmail) {
      return res.status(409).json({ error: 'That email is already associated with an existing account' });
    }
    const existingSignup = await get(
      `SELECT signup_id FROM signup_requests WHERE status = 'Pending' AND (employee_id = ? OR email = ?)`,
      [empId, emailTrimmed]
    );
    if (existingSignup) {
      return res.status(409).json({ error: 'A signup request with that Employee ID or email is already pending approval' });
    }

    const hash = bcrypt.hashSync(password, 10);
    // 'username' and 'full_name' are placeholders here (those columns are
    // required NOT NULL on this table) — the admin overwrites them with real
    // values when approving.
    const result = await run(`
      INSERT INTO signup_requests (employee_id, username, password_hash, full_name, email)
      VALUES (?,?,?,?,?)
    `, [empId, emailTrimmed, hash, '(Pending)', emailTrimmed]);

    const signupId = Number(result.lastInsertRowid);
    await audit(null, 'SIGNUP_REQUESTED', 'signup_request', signupId, { employee_id: empId, email: emailTrimmed });

    const admins = (await all(`SELECT email FROM employees WHERE role = 'admin' AND status = 'active'`))
      .map(a => a.email).filter(Boolean);
    sendMail({
      to: admins,
      subject: `[Action needed] New account request: Employee ID ${empId}`,
      text: `A signup request was submitted for Employee ID ${empId} (${emailTrimmed}).\n\nLog in to review: ${process.env.APP_URL || ''}/admin.html`
    }).catch(() => {});

    return res.status(201).json({ ok: true, message: 'Your request has been submitted and is pending administrator approval.' });
  }

  if (action === 'change_password') {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { current_password, new_password } = body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const dbUser = await get('SELECT * FROM employees WHERE employee_id = ?', [user.employee_id]);
    if (!dbUser) return res.status(404).json({ error: 'Account not found' });
    const ok = bcrypt.compareSync(current_password, dbUser.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = bcrypt.hashSync(new_password, 10);
    await run('UPDATE employees SET password_hash = ?, must_change_password = 0 WHERE employee_id = ?', [newHash, user.employee_id]);
    await audit(user.employee_id, 'CHANGE_PASSWORD', 'employee', user.employee_id, null);
    return res.status(200).json({ ok: true });
  }

  if (action === 'upload_signature') {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!['hr_staff', 'hr_director'].includes(user.role)) {
      return res.status(403).json({ error: 'Only HR Staff or HR Director can upload a signature' });
    }
    const { signature } = body;
    if (!signature || typeof signature !== 'string' || !signature.startsWith('data:image/')) {
      return res.status(400).json({ error: 'A valid image (PNG or JPG) is required' });
    }
    if (signature.length > 400000) {
      return res.status(400).json({ error: 'Signature image is too large — please use a smaller file (under ~250KB)' });
    }
    await run('UPDATE employees SET signature = ? WHERE employee_id = ?', [signature, user.employee_id]);
    await audit(user.employee_id, 'UPLOAD_SIGNATURE', 'employee', user.employee_id, null);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
