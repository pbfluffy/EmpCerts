const { run, all, audit } = require('../../lib/db');
const { requireAuth, readBody } = require('../../lib/auth');
const { notifyRequestSubmitted } = require('../../lib/mailer');

const REASONS = ['Travel', 'Financial', 'Other'];
const DELIVERY_METHODS = ['Email', 'Download'];

async function handler(req, res) {
  const u = req.user;

  if (req.method === 'GET') {
    if (u.role === 'admin') {
      return res.status(403).json({ error: 'Administrators manage users only and cannot view certificate requests' });
    }
    // "My Requests" always shows only the logged-in person's own requests —
    // including for HR Staff/HR Director, who are also employees and can
    // submit their own certificate requests. See /api/requests/all for the
    // separate, read-only view of everyone else's requests.
    const rows = await all(`
      SELECT r.*, e.full_name AS employee_name
      FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
      WHERE r.employee_id = ? ORDER BY r.created_date DESC
    `, [u.employee_id]);
    return res.status(200).json({ requests: rows });
  }

  if (req.method === 'POST') {
    if (u.role === 'admin') {
      return res.status(403).json({ error: 'Administrators manage users only and cannot submit certificate requests' });
    }
    let { reason, other_reason, include_salary, language, delivery_method, remarks } = await readBody(req);

    if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Invalid reason' });
    if (reason === 'Other' && (!other_reason || !other_reason.trim())) {
      return res.status(400).json({ error: 'Other Reason is required when Reason is "Other"' });
    }
    if (!DELIVERY_METHODS.includes(delivery_method)) return res.status(400).json({ error: 'Invalid delivery method' });

    include_salary = include_salary ? 1 : 0;
    // Note: salary_amount is intentionally NOT accepted from the employee here.
    // HR Director enters the actual figure when approving a salary certificate request.

    // Every request requires approval:
    //   - Include Salary = No  -> goes to HR Staff
    //   - Include Salary = Yes -> goes to HR Director (who also fills in the salary amount)
    const initialStatus = 'Pending Approval';

    const result = await run(`
      INSERT INTO certificate_requests
        (employee_id, reason, other_reason, include_salary, salary_amount, language, delivery_method, remarks, status)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [
      u.employee_id, reason, reason === 'Other' ? other_reason : null,
      include_salary, null,
      language || 'English', delivery_method, remarks || null, initialStatus
    ]);

    const requestId = Number(result.lastInsertRowid);
    await audit(u.employee_id, 'SUBMIT_REQUEST', 'certificate_request', requestId, { include_salary: !!include_salary });

    const { get } = require('../../lib/db');
    const created = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [requestId]);

    // Notify the relevant HR queue by email (non-blocking — failures are logged, not thrown)
    const targetRole = include_salary ? 'hr_director' : 'hr_staff';
    const recipients = (await all('SELECT email FROM employees WHERE role = ? AND status = ?', [targetRole, 'active']))
      .map(r => r.email)
      .filter(Boolean);
    notifyRequestSubmitted({ recipients, request: created, employeeName: u.full_name }).catch(() => {});

    return res.status(201).json({ request: created });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(handler);
