const { run, get, audit } = require('../../../lib/db');
const { requireRole, readBody } = require('../../../lib/auth');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  const { id } = req.query;
  const { decision, comment } = await readBody(req);

  if (!['Approved', 'Rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be Approved or Rejected' });
  }

  const request = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.status !== 'Pending Approval') {
    return res.status(400).json({ error: `Request is not pending approval (current status: ${request.status})` });
  }

  await run(`INSERT INTO approvals (request_id, approver_id, status, comment) VALUES (?,?,?,?)`,
    [request.request_id, u.employee_id, decision, comment || null]);

  if (decision === 'Approved') {
    await run(`
      UPDATE certificate_requests
      SET status = 'Completed', approver_id = ?, approval_date = datetime('now'), pdf_ready = 1
      WHERE request_id = ?
    `, [u.employee_id, request.request_id]);
    await audit(u.employee_id, 'APPROVE_REQUEST', 'certificate_request', request.request_id, { comment });
    await audit(null, 'GENERATE_PDF', 'certificate_request', request.request_id, null);
  } else {
    await run(`
      UPDATE certificate_requests
      SET status = 'Rejected', approver_id = ?, approval_date = datetime('now'), rejection_reason = ?
      WHERE request_id = ?
    `, [u.employee_id, comment || null, request.request_id]);
    await audit(u.employee_id, 'REJECT_REQUEST', 'certificate_request', request.request_id, { comment });
  }

  const updated = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [request.request_id]);
  res.status(200).json({ request: updated });
}

module.exports = requireRole('hr_director_or_above')(handler);
