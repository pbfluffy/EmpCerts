const { run, get, audit } = require('../../../../lib/db');
const { requireRole, readBody } = require('../../../../lib/auth');
const { sendMail } = require('../../../../lib/mailer');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  const { id } = req.query;
  const { decision, role, comment } = await readBody(req);

  if (!['Approved', 'Rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be Approved or Rejected' });
  }

  const signup = await get(`SELECT * FROM signup_requests WHERE signup_id = ?`, [id]);
  if (!signup) return res.status(404).json({ error: 'Not found' });
  if (signup.status !== 'Pending') {
    return res.status(400).json({ error: `Signup request is not pending (current status: ${signup.status})` });
  }

  if (decision === 'Approved') {
    const finalRole = ROLES.includes(role) ? role : 'employee';

    // Username could have been claimed by someone else in the meantime — re-check.
    const existing = await get('SELECT employee_id FROM employees WHERE username = ?', [signup.username]);
    if (existing) {
      return res.status(409).json({ error: 'That username was taken by another account since this request was submitted. Reject this request and ask the person to sign up again with a different username.' });
    }

    const result = await run(`
      INSERT INTO employees (username, password_hash, full_name, department, position, email, role)
      VALUES (?,?,?,?,?,?,?)
    `, [signup.username, signup.password_hash, signup.full_name, signup.department, signup.position, signup.email, finalRole]);

    const newEmployeeId = Number(result.lastInsertRowid);

    await run(`
      UPDATE signup_requests SET status = 'Approved', reviewed_by = ?, reviewed_date = datetime('now') WHERE signup_id = ?
    `, [u.employee_id, id]);

    await audit(u.employee_id, 'APPROVE_SIGNUP', 'signup_request', id, { new_employee_id: newEmployeeId, role: finalRole });

    sendMail({
      to: signup.email,
      subject: 'Your account has been approved',
      text: `Hi ${signup.full_name},\n\nYour account request has been approved. You can now log in with your username "${signup.username}".\n\n${process.env.APP_URL || ''}/index.html`
    }).catch(() => {});

    return res.status(200).json({ ok: true, employee_id: newEmployeeId });
  } else {
    await run(`
      UPDATE signup_requests SET status = 'Rejected', reviewed_by = ?, reviewed_date = datetime('now'), rejection_reason = ? WHERE signup_id = ?
    `, [u.employee_id, comment || null, id]);

    await audit(u.employee_id, 'REJECT_SIGNUP', 'signup_request', id, { comment });

    sendMail({
      to: signup.email,
      subject: 'Your account request was not approved',
      text: `Hi ${signup.full_name},\n\nYour account request was not approved.${comment ? '\nReason: ' + comment : ''}\n\nIf you believe this is a mistake, please contact your administrator.`
    }).catch(() => {});

    return res.status(200).json({ ok: true });
  }
}

module.exports = requireRole('admin')(handler);
