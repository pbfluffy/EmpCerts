const { get, audit } = require('../../lib/db');
const { requireAuth } = require('../../lib/auth');
const { generateCertificateBuffer } = require('../../lib/pdf');

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const u = req.user;
  if (u.role === 'admin') {
    return res.status(403).json({ error: 'Administrators manage users only and cannot view certificate requests' });
  }
  const { id } = req.query;

  const request = await get('SELECT * FROM certificate_requests WHERE request_id = ?', [id]);
  if (!request) return res.status(404).json({ error: 'Not found' });

  // ?download=1 -> stream the PDF (owner only, regardless of role)
  if (req.query.download === '1') {
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
    return res.status(200).send(buffer);
  }

  // Default: JSON detail. Employees see only their own; HR Staff/Director can view any.
  if (u.role === 'employee' && request.employee_id !== u.employee_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const row = await get(`
    SELECT r.*, e.full_name AS employee_name, e.email AS employee_email
    FROM certificate_requests r JOIN employees e ON e.employee_id = r.employee_id
    WHERE r.request_id = ?
  `, [id]);
  res.status(200).json({ request: row });
}

module.exports = requireAuth(handler);
