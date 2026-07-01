const { run, get, all, audit } = require('../../lib/db');
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

    // ?scope=all -> read-only view of everyone's requests (HR Staff/Director only)
    if (req.query.scope === 'all') {
      if (!['hr_staff', 'hr_director'].includes(u.role)) {
        return res.status(403).json({ error: 'Forbidden: insufficient role' });
      }
      const rows = await all(`
        SELECT r.*, e.full_name AS employee_name,
          a.full_name AS approver_name
        FROM certificate_requests r
        JOIN employees e ON e.employee_id = r.employee_id
        LEFT JOIN employees a ON a.employee_id = r.approver_id
        ORDER BY r.created_date DESC
      `);
      return res.status(200).json({ requests: rows });
    }

    // Default: "My Requests" — always the logged-in person's own, regardless of role.
    const rows = await all(`
      SELECT r.*, e.full_name AS employee_name,
        a.full_name AS approver_name
      FROM certificate_requests r
      JOIN employees e ON e.employee_id = r.employee_id
      LEFT JOIN employees a ON a.employee_id = r.approver_id
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

    const result = await run(`
      INSERT INTO certificate_requests
        (employee_id, reason, other_reason, include_salary, salary_amount, language, delivery_method, remarks, status)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [
      u.employee_id, reason, reason === 'Other' ? other_reason : null,
      include_salary, null,
      language || 'English', delivery_method, remarks || null, 'Pending Approval'
    ]);

    const requestId = Number(result.lastInsertRowid);
    await audit(u.employee_id, 'SUBMIT_REQUEST', 'certificate_request', requestId, { include_salary: !!include_salary });

    const created = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [requestId]);

    const targetRole = include_salary ? 'hr_director' : 'hr_staff';
    const recipients = (await all('SELECT email FROM employees WHERE role = ? AND status = ?', [targetRole, 'active']))
      .map(r => r.email).filter(Boolean);
    notifyRequestSubmitted({ recipients, request: created, employeeName: u.full_name }).catch(() => {});

    return res.status(201).json({ request: created });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(handler);
