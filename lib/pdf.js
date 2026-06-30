const PDFDocument = require('pdfkit');

function generateCertificateBuffer({ request, employee }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text('CERTIFICATE OF EMPLOYMENT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#555').text('Issued by the Human Resources Department', { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown(2);

    const issueDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(11).text(`Date Issued: ${issueDate}`, { align: 'right' });
    doc.moveDown(1.5);

    let reasonClause;
    const r = request.reason === 'Other' ? (request.other_reason || 'Other') : request.reason;
    if (request.reason === 'Travel') reasonClause = 'for travel purposes';
    else if (request.reason === 'Financial') reasonClause = 'for financial purposes';
    else reasonClause = `for the purpose of: ${r}`;

    doc.fontSize(12).font('Helvetica').text(
      `This is to certify that ${employee.full_name} (Employee ID: ${employee.employee_id}) ` +
      `is/was employed at this organization in the position of ${employee.position || 'N/A'}, ` +
      `under the ${employee.department || 'N/A'} department.`,
      { align: 'justify', lineGap: 4 }
    );
    doc.moveDown(1);

    doc.text(`This certificate is issued upon the employee's request, ${reasonClause}.`, { align: 'justify', lineGap: 4 });

    if (request.include_salary) {
      doc.moveDown(1);
      const salaryFmt = request.salary_amount != null
        ? Number(request.salary_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : 'N/A';
      doc.font('Helvetica-Bold').text(`Current Monthly Salary: ${salaryFmt}`, { lineGap: 4 });
      doc.font('Helvetica');
    }

    if (request.remarks) {
      doc.moveDown(1);
      doc.text(`Remarks: ${request.remarks}`, { align: 'justify', lineGap: 4 });
    }

    doc.moveDown(3);
    doc.text('This document is issued for official use as stated above.', { align: 'justify' });
    doc.moveDown(4);
    doc.text('_____________________________', { align: 'right' });
    doc.text('Authorized Signatory', { align: 'right' });
    doc.text('Human Resources Department', { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888').text(
      `Request ID: ${request.request_id} | Generated: ${new Date().toISOString()}`,
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateCertificateBuffer };
