const PDFDocument = require('pdfkit');

const COMPANY_NAME = 'PumbaFluffy Company';

function generateCertificateBuffer({ request, employee, approver }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 70 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const issueDate = new Date();
    const issueDateFormatted = issueDate.toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // ── Certificate No. ──────────────────────────────────────────────────
    const certNo = `COE-${issueDate.getFullYear()}${String(issueDate.getMonth()+1).padStart(2,'0')}${String(issueDate.getDate()).padStart(2,'0')}-${String(request.request_id).padStart(6,'0')}`;

    // ── Header ────────────────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold')
      .text('CERTIFICATE OF EMPLOYMENT', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555')
      .text(COMPANY_NAME, { align: 'center' });
    doc.fillColor('#000');

    // Divider
    doc.moveDown(0.6);
    doc.moveTo(70, doc.y).lineTo(doc.page.width - 70, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
    doc.moveDown(0.8);

    // Date of Issue — right aligned
    doc.fontSize(11).font('Helvetica')
      .text(`Date of Issue: ${issueDateFormatted}`, { align: 'right' });
    doc.moveDown(1.5);

    // ── Body ──────────────────────────────────────────────────────────────
    doc.fontSize(12).font('Helvetica');

    // Main certification paragraph
    const reasonClause = (() => {
      const r = request.reason === 'Other' ? (request.other_reason || 'other purposes') : request.reason;
      if (request.reason === 'Travel') return 'for travel purposes';
      if (request.reason === 'Financial') return 'for financial purposes';
      return `for the purpose of: ${r}`;
    })();

    doc.text(
      `This is to certify that ${employee.full_name} (Employee ID: ${employee.employee_id}) ` +
      `is employed by ${COMPANY_NAME} as ${employee.position || 'N/A'} ` +
      `in the ${employee.department || 'N/A'} Department.`,
      { align: 'justify', lineGap: 5 }
    );

    // Joining date + service length
    if (employee.joining_date) {
      const jd = new Date(employee.joining_date);
      const jdFormatted = jd.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

      let years = issueDate.getFullYear() - jd.getFullYear();
      let months = issueDate.getMonth() - jd.getMonth();
      if (issueDate.getDate() < jd.getDate()) months--;
      if (months < 0) { years--; months += 12; }

      const parts = [];
      if (years > 0) parts.push(`${years} year${years > 1 ? 's' : ''}`);
      if (months > 0) parts.push(`${months} month${months > 1 ? 's' : ''}`);
      const duration = parts.length > 0 ? parts.join(', ') : 'less than 1 month';

      doc.moveDown(0.8);
      doc.text(`Date of Joining: ${jdFormatted}`, { align: 'justify', lineGap: 5 });
      doc.text(
        `Length of Service: ${duration} (as of ${issueDateFormatted})`,
        { align: 'justify', lineGap: 5 }
      );
    }

    // Salary
    if (request.include_salary && request.salary_amount != null) {
      doc.moveDown(0.8);
      const salaryFmt = Number(request.salary_amount).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
      doc.font('Helvetica-Bold')
        .text(`Current Gross Monthly Salary: THB ${salaryFmt}`, { align: 'justify', lineGap: 5 });
      doc.font('Helvetica');
    }

    // Remarks
    if (request.remarks) {
      doc.moveDown(0.8);
      doc.text(`Remarks: ${request.remarks}`, { align: 'justify', lineGap: 5 });
    }

    // Purpose sentence
    doc.moveDown(1.2);
    doc.text(
      `This certificate is issued upon the employee's request ${reasonClause}.`,
      { align: 'justify', lineGap: 5 }
    );

    // Closing sentence
    doc.moveDown(0.8);
    doc.text(
      'This certificate is issued without any alteration and is valid for the purpose stated above.',
      { align: 'justify', lineGap: 5 }
    );

    // ── Signature block ───────────────────────────────────────────────────
    doc.moveDown(3);

    const sigBlockX = doc.page.width - 280; // ~230px from right edge
    const sigY = doc.y;
    const roleLabel = approver && approver.role === 'hr_director' ? 'HR Director' : 'HR Staff';

    if (approver && approver.signature) {
      try {
        const match = approver.signature.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
        if (match) {
          const imgBuffer = Buffer.from(match[2], 'base64');
          doc.image(imgBuffer, sigBlockX, sigY, { width: 160, height: 60, fit: [160, 60] });
          doc.moveDown(0.3);
        }
      } catch (e) {
        doc.moveDown(1.5);
      }
    } else {
      // Blank signature line
      doc.moveTo(sigBlockX, sigY + 50)
        .lineTo(sigBlockX + 160, sigY + 50)
        .strokeColor('#000').lineWidth(0.5).stroke();
      doc.moveDown(1.5);
    }

    // Name, title, department — left-align within the sig block
    doc.fontSize(11).font('Helvetica-Bold')
      .text(approver ? approver.full_name : '___________________', sigBlockX, doc.y, { width: 200 });
    doc.fontSize(10).font('Helvetica')
      .text(approver ? roleLabel : 'Authorized Signatory', sigBlockX, doc.y, { width: 200 });
    doc.text('Human Resources Department', sigBlockX, doc.y, { width: 200 });
    doc.text(COMPANY_NAME, sigBlockX, doc.y, { width: 200 });

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc.moveTo(70, footerY - 8).lineTo(doc.page.width - 70, footerY - 8)
      .strokeColor('#cccccc').lineWidth(0.5).stroke();

    const genTime = issueDate.toLocaleString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });
    doc.fontSize(8).fillColor('#888')
      .text(`Certificate No.: ${certNo}`, 70, footerY, { continued: true, width: 300 })
      .text(`Generated on: ${genTime}`, { align: 'right', width: doc.page.width - 140 });

    doc.end();
  });
}

module.exports = { generateCertificateBuffer };
