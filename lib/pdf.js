const PDFDocument = require('pdfkit');

function generateCertificateBuffer({ request, employee, approver }) {
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

    if (employee.joining_date) {
      const jd = new Date(employee.joining_date);
      const issueD = new Date();
      const jdFormatted = jd.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

      // Calculate full years and remaining months
      let years = issueD.getFullYear() - jd.getFullYear();
      let months = issueD.getMonth() - jd.getMonth();
      if (issueD.getDate() < jd.getDate()) months--;
      if (months < 0) { years--; months += 12; }

      // Build a readable duration string
      const parts = [];
      if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
      if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
      const duration = parts.length > 0 ? parts.join(' and ') : 'less than 1 month';

      doc.moveDown(0.5);
      doc.text(`Date of Joining: ${jdFormatted}`, { align: 'justify', lineGap: 4 });
      doc.text(`Length of Service: ${duration} (as of the date of issue)`, { align: 'justify', lineGap: 4 });
    }
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
    doc.moveDown(2);

    const roleLabel = approver && approver.role === 'hr_director' ? 'HR Director' : 'HR Staff';

    if (approver && approver.signature) {
      try {
        const match = approver.signature.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
        if (match) {
          const imgBuffer = Buffer.from(match[2], 'base64');
          const imgWidth = 150;
          const pageRight = doc.page.width - doc.page.margins.right;
          doc.image(imgBuffer, pageRight - imgWidth, doc.y, { width: imgWidth });
          doc.moveDown(0.5);
        }
      } catch (e) {
        // If the stored signature is malformed for any reason, just fall back
        // to a blank line below rather than failing the whole PDF.
        doc.text('_____________________________', { align: 'right' });
      }
    } else {
      doc.text('_____________________________', { align: 'right' });
    }

    doc.text(approver ? approver.full_name : 'Authorized Signatory', { align: 'right' });
    doc.text(approver ? roleLabel : 'Human Resources Department', { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888').text(
      `Request ID: ${request.request_id} | Generated: ${new Date().toISOString()}`,
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateCertificateBuffer };
