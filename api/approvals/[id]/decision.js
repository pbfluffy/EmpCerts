const { run, get, audit } = require('../../../lib/db');
const { requireAuth, readBody } = require('../../../lib/auth');
const { notifyRequestDecision } = require('../../../lib/mailer');

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  const { id } = req.query;
  const { decision, comment, salary_amount } = await readBody(req);

  if (!['hr_staff', 'hr_director'].includes(u.role)) {
    return res.status(403).json({ error: 'Forbidden: only HR Staff or HR Director can decide on requests' });
  }
  if (!['Approved', 'Rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be Approved or Rejected' });
  }

  const request = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.status !== 'Pending Approval') {
    return res.status(400).json({ error: `Request is not pending approval (current status: ${request.status})` });
  }

  // Enforce the split queue: HR Staff only handles non-salary requests,
  // HR Director only handles salary requests.
  if (request.include_salary && u.role !== 'hr_director') {
    return res.status(403).json({ error: 'Only the HR Director can approve salary certificate requests' });
  }
  if (!request.include_salary && u.role !== 'hr_staff') {
    return res.status(403).json({ error: 'Only HR Staff can approve non-salary certificate requests' });
  }

  if (decision === 'Approved' && request.include_salary) {
    if (salary_amount === undefined || salary_amount === null || salary_amount === '' || isNaN(Number(salary_amount))) {
      return res.status(400).json({ error: 'A valid salary amount is required to approve a salary certificate request' });
    }
  }

  await run(`INSERT INTO approvals (request_id, approver_id, status, comment) VALUES (?,?,?,?)`,
    [request.request_id, u.employee_id, decision, comment || null]);

  if (decision === 'Approved') {
    if (request.include_salary) {
      await run(`
        UPDATE certificate_requests
        SET status = 'Completed', approver_id = ?, approval_date = datetime('now'), pdf_ready = 1, salary_amount = ?
        WHERE request_id = ?
      `, [u.employee_id, Number(salary_amount), request.request_id]);
    } else {
      await run(`
        UPDATE certificate_requests
        SET status = 'Completed', approver_id = ?, approval_date = datetime('now'), pdf_ready = 1
        WHERE request_id = ?
      `, [u.employee_id, request.request_id]);
    }
    await audit(u.employee_id, 'APPROVE_REQUEST', 'certificate_request', request.request_id, { comment, salary_amount: request.include_salary ? Number(salary_amount) : undefined });
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

  // Notify the employee of the decision by email (non-blocking)
  const employee = await get('SELECT full_name, email FROM employees WHERE employee_id = ?', [request.employee_id]);
  if (employee) {
    notifyRequestDecision({ employeeEmail: employee.email, employeeName: employee.full_name, request: updated }).catch(() => {});
  }

  res.status(200).json({ request: updated });
}

module.exports = requireAuth(handler);
