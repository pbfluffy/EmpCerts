const { run, all, audit } = require('../../lib/db');
const { requireAuth, readBody } = require('../../lib/auth');

const REASONS = ['Travel', 'Financial', 'Other'];
const DELIVERY_METHODS = ['Email', 'Download'];

async function handler(req, res) {
  const u = req.user;

  if (req.method === 'GET') {
    let rows;
    if (u.role === 'employee') {
      rows = await all(`
        SELECT r.*, e.full_name AS employee_name
        FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
        WHERE r.employee_id = ? ORDER BY r.created_date DESC
      `, [u.employee_id]);
    } else {
      rows = await all(`
        SELECT r.*, e.full_name AS employee_name
        FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
        ORDER BY r.created_date DESC
      `);
    }
    return res.status(200).json({ requests: rows });
  }

  if (req.method === 'POST') {
    let { reason, other_reason, include_salary, salary_amount, language, delivery_method, remarks } = await readBody(req);

    if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Invalid reason' });
    if (reason === 'Other' && (!other_reason || !other_reason.trim())) {
      return res.status(400).json({ error: 'Other Reason is required when Reason is "Other"' });
    }
    if (!DELIVERY_METHODS.includes(delivery_method)) return res.status(400).json({ error: 'Invalid delivery method' });

    include_salary = include_salary ? 1 : 0;
    if (include_salary && (salary_amount === undefined || salary_amount === null || salary_amount === '')) {
      return res.status(400).json({ error: 'Salary amount is required when Include Salary is Yes' });
    }

    const initialStatus = include_salary ? 'Pending Approval' : 'Submitted';

    const result = await run(`
      INSERT INTO certificate_requests
        (employee_id, reason, other_reason, include_salary, salary_amount, language, delivery_method, remarks, status)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, [
      u.employee_id, reason, reason === 'Other' ? other_reason : null,
      include_salary, include_salary ? salary_amount : null,
      language || 'English', delivery_method, remarks || null, initialStatus
    ]);

    const requestId = Number(result.lastInsertRowid);
    await audit(u.employee_id, 'SUBMIT_REQUEST', 'certificate_request', requestId, { include_salary: !!include_salary });

    if (!include_salary) {
      // No approval needed: mark ready for download immediately. PDF itself
      // is generated on-demand at download time (no persistent disk in serverless).
      await run(`UPDATE certificate_requests SET status = 'Completed', pdf_ready = 1 WHERE request_id = ?`, [requestId]);
      await audit(null, 'GENERATE_PDF', 'certificate_request', requestId, null);
    }

    const { get } = require('../../lib/db');
    const created = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [requestId]);
    return res.status(201).json({ request: created });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = requireAuth(handler);
