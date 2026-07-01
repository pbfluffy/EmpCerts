const { run, get, all, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');
const { sendMail } = require('../../../lib/mailer');

const ROLES = ['employee', 'hr_staff', 'hr_director', 'admin'];

function autoUsername(employeeId) {
  return `emp_${employeeId}`;
}

async function handler(req, res) {
  const u = req.user;

  if (req.method === 'GET') {
    const rows = await all(`
      SELECT signup_id, employee_id, full_name, email, status, created_date
      FROM signup_requests WHERE status = 'Pending' ORDER BY created_date ASC
    `);
    return res.status(200).json({ signups: rows });
  }

  if (req.method === 'POST') {
    const { signup_id, decision, role, comment, full_name, department, position } = await readBody(req);
    if (!signup_id) return res.status(400).json({ error: 'signup_id is required' });
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be Approved or Rejected' });
    }
    if (decision === 'Approved') {
      if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'Full name is required' });
      if (!department || !department.trim()) return res.status(400).json({ error: 'Department is required' });
      if (!position || !position.trim()) return res.status(400).json({ error: 'Position is required' });
      if (!role || !ROLES.includes(role)) return res.status(400).json({ error: 'A valid role is required' });
    }

    const signup = await get(`SELECT * FROM signup_requests WHERE signup_id = ?`, [signup_id]);
    if (!signup) return res.status(404).json({ error: 'Not found' });
    if (signup.status !== 'Pending') {
      return res.status(400).json({ error: `Signup request is not pending (current status: ${signup.status})` });
    }

    if (decision === 'Approved') {
      const finalRole = ROLES.includes(role) ? role : 'employee';

      const existingEmail = await get('SELECT employee_id FROM employees WHERE LOWER(email) = ?', [signup.email.toLowerCase()]);
      if (existingEmail) {
        return res.status(409).json({ error: 'That email is already associated with an existing account. Reject this request.' });
      }

      let newEmployeeId;
      if (signup.employee_id) {
        const existingId = await get('SELECT employee_id FROM employees WHERE employee_id = ?', [signup.employee_id]);
        if (existingId) {
          return res.status(409).json({ error: `Employee ID ${signup.employee_id} is already in use. Reject this request.` });
        }
        await run(`
          INSERT INTO employees (employee_id, username, password_hash, full_name, department, position, email, role)
          VALUES (?,?,?,?,?,?,?,?)
        `, [signup.employee_id, autoUsername(signup.employee_id), signup.password_hash,
            full_name.trim(), department.trim(), position.trim(), signup.email, finalRole]);
        newEmployeeId = signup.employee_id;
      } else {
        const result = await run(`
          INSERT INTO employees (username, password_hash, full_name, department, position, email, role)
          VALUES (?,?,?,?,?,?,?)
        `, ['_tmp', signup.password_hash, full_name.trim(), department.trim(), position.trim(), signup.email, finalRole]);
        newEmployeeId = Number(result.lastInsertRowid);
        await run('UPDATE employees SET username = ? WHERE employee_id = ?', [autoUsername(newEmployeeId), newEmployeeId]);
      }

      await run(`UPDATE signup_requests SET status = 'Approved', reviewed_by = ?, reviewed_date = datetime('now') WHERE signup_id = ?`,
        [u.employee_id, signup_id]);
      await audit(u.employee_id, 'APPROVE_SIGNUP', 'signup_request', signup_id, { new_employee_id: newEmployeeId, role: finalRole });

      sendMail({
        to: signup.email,
        subject: 'Your account has been approved',
        text: `Hi ${full_name.trim()},\n\nYour account has been approved. Log in with your email address at:\n${process.env.APP_URL || ''}/index.html`
      }).catch(() => {});

      return res.status(200).json({ ok: true, employee_id: newEmployeeId });
    } else {
      await run(`UPDATE signup_requests SET status = 'Rejected', reviewed_by = ?, reviewed_date = datetime('now'), rejection_reason = ? WHERE signup_id = ?`,
        [u.employee_id, comment || null, signup_id]);
      await audit(u.employee_id, 'REJECT_SIGNUP', 'signup_request', signup_id, { comment });

      sendMail({
        to: signup.email,
        subject: 'Your account request was not approved',
        text: `Hi,\n\nYour account request was not approved.${comment ? '\nReason: ' + comment : ''}\n\nContact your administrator if you think this is a mistake.`
      }).catch(() => {});

      return res.status(200).json({ ok: true });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireRole('admin')(handler);
