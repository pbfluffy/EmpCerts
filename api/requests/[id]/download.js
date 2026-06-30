const { get, audit } = require('../../../lib/db');
const { requireAuth } = require('../../../lib/auth');
const { generateCertificateBuffer } = require('../../../lib/pdf');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  if (u.role === 'admin') {
    return res.status(403).json({ error: 'Administrators manage users only and cannot download certificates' });
  }
  const { id } = req.query;

  const request = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Not found' });
  // Only the certificate's own owner can download it — HR Staff/Director can
  // VIEW other employees' request status (see /api/requests/all) but cannot
  // download certificates that aren't theirs.
  if (request.employee_id !== u.employee_id) {
    return res.status(403).json({ error: 'Forbidden: you can only download your own certificates' });
  }
  if (request.status !== 'Completed' || !request.pdf_ready) {
    return res.status(400).json({ error: 'Certificate not yet generated' });
  }

  const employee = await get('SELECT * FROM employees WHERE employee_id = ?', [request.employee_id]);
  const buffer = await generateCertificateBuffer({ request, employee });

  await audit(u.employee_id, 'DOWNLOAD_PDF', 'certificate_request', request.request_id, null);

  const safeName = (employee.full_name || 'Employee').trim().replace(/[^a-zA-Z0-9]+/g, '_');
  const salaryTag = request.include_salary ? 'withSalary' : 'withoutSalary';
  const filename = `${employee.employee_id}_${safeName}_${salaryTag}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(buffer);
}

module.exports = requireAuth(handler);
