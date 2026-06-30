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
  if (u.role === 'employee' && request.employee_id !== u.employee_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (request.status !== 'Completed' || !request.pdf_ready) {
    return res.status(400).json({ error: 'Certificate not yet generated' });
  }

  const employee = await get('SELECT * FROM employees WHERE employee_id = ?', [request.employee_id]);
  const buffer = await generateCertificateBuffer({ request, employee });

  await audit(u.employee_id, 'DOWNLOAD_PDF', 'certificate_request', request.request_id, null);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate_${request.request_id}.pdf"`);
  res.status(200).send(buffer);
}

module.exports = requireAuth(handler);
