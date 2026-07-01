const PDFDocument = require('pdfkit');

const COMPANY_NAME = 'PumbaFluffy Company';

function generateCertificateBuffer({ request, employee, approver }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 70, autoFirstPage: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW   = doc.page.width;   // 595.28
    const pageH   = doc.page.height;  // 841.89
    const mL      = 70;
    const mR      = 70;
    const mTop    = 70;
    const mBottom = 70;
    const contentW = pageW - mL - mR;

    // Reserve space at bottom: footer (30) + sig block (signature 55 + name lines 4×14 = 56 + gap 20) = ~161
    const SIG_BLOCK_H = 130;   // image/line (55) + name/role/dept/company (4 × ~14) + gap
    const FOOTER_H    = 40;
    const bodyBottom  = pageH - mBottom - FOOTER_H - SIG_BLOCK_H - 20; // last Y body text can reach

    const issueDate = new Date();
    const issueDateFormatted = issueDate.toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    const certNo = `COE-${issueDate.getFullYear()}${String(issueDate.getMonth()+1).padStart(2,'0')}${String(issueDate.getDate()).padStart(2,'0')}-${String(request.request_id).padStart(6,'0')}`;

    // ── Header ────────────────────────────────────────────────────────────
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#000')
      .text('CERTIFICATE OF EMPLOYMENT', mL, mTop, { width: contentW, align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#555')
      .text(COMPANY_NAME, mL, doc.y, { width: contentW, align: 'center' });
    doc.fillColor('#000').moveDown(0.7);

    doc.moveTo(mL, doc.y).lineTo(pageW - mR, doc.y)
      .strokeColor('#cccccc').lineWidth(0.8).stroke();
    doc.moveDown(0.8);

    // ── Date of Issue ─────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica').fillColor('#000')
      .text(`Date of Issue: ${issueDateFormatted}`, mL, doc.y, { width: contentW, align: 'right' });
    doc.moveDown(1.2);

    // ── Body ──────────────────────────────────────────────────────────────
    const reasonClause = (() => {
      if (request.reason === 'Travel')   return 'for travel purposes';
      if (request.reason === 'Financial') return 'for financial purposes';
      return `for the purpose of: ${request.other_reason || 'other purposes'}`;
    })();

    // Helper: write a paragraph, then a small gap
    const para = (text, opts = {}) => {
      doc.fontSize(12).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000')
        .text(text, mL, doc.y, { width: contentW, align: opts.align || 'justify', lineGap: 4 });
      doc.moveDown(0.7);
    };

    para(`This is to certify that ${employee.full_name} (Employee ID: ${employee.employee_id}) ` +
      `is employed by ${COMPANY_NAME} as ${employee.position || 'N/A'} ` +
      `in the ${employee.department || 'N/A'} Department.`);

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
      para(`Date of Joining: ${jdFormatted}`, { align: 'left' });
      para(`Length of Service: ${duration} (as of ${issueDateFormatted})`, { align: 'left' });
    }

    if (request.include_salary && request.salary_amount != null) {
      const salaryFmt = Number(request.salary_amount).toLocaleString('en-US', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
      para(`Current Gross Monthly Salary: THB ${salaryFmt}`, { bold: true });
    }

    if (request.remarks) {
      para(`Remarks: ${request.remarks}`);
    }

    para(`This certificate is issued upon the employee's request ${reasonClause}.`);
    para('This certificate is issued without any alteration and is valid for the purpose stated above.');

    // ── Signature block — pinned above footer ─────────────────────────────
    // Always place signature at a fixed Y so it never overflows.
    const sigBlockTop = pageH - mBottom - FOOTER_H - SIG_BLOCK_H;
    const sigX        = pageW - mR - 200;   // right-aligned block, 200px wide

    let nameY = sigBlockTop + 62; // default: below a blank line

    if (approver && approver.signature) {
      try {
        const match = approver.signature.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
        if (match) {
          const imgBuf = Buffer.from(match[2], 'base64');
          doc.image(imgBuf, sigX, sigBlockTop, { width: 160, fit: [160, 55] });
          nameY = sigBlockTop + 62;
        }
      } catch (_) {
        doc.moveTo(sigX, sigBlockTop + 50).lineTo(sigX + 160, sigBlockTop + 50)
          .strokeColor('#000').lineWidth(0.5).stroke();
      }
    } else {
      doc.moveTo(sigX, sigBlockTop + 50).lineTo(sigX + 160, sigBlockTop + 50)
        .strokeColor('#000').lineWidth(0.5).stroke();
    }

    const roleLabel = approver && approver.role === 'hr_director' ? 'HR Director' : 'HR Staff';
    const sigName   = approver ? approver.full_name : '___________________';
    const sigRole   = approver ? roleLabel : 'Authorized Signatory';

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000')
      .text(sigName, sigX, nameY, { width: 200, lineGap: 1 });
    doc.fontSize(10).font('Helvetica').fillColor('#000')
      .text(sigRole, sigX, nameY + 16, { width: 200, lineGap: 1 });
    doc.text('Human Resources Department', sigX, nameY + 30, { width: 200, lineGap: 1 });
    doc.text(COMPANY_NAME, sigX, nameY + 44, { width: 200 });

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = pageH - mBottom - 20;
    doc.moveTo(mL, footerY - 12).lineTo(pageW - mR, footerY - 12)
      .strokeColor('#cccccc').lineWidth(0.5).stroke();

    const genTime = issueDate.toLocaleString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    });
    doc.fontSize(8).fillColor('#888')
      .text(`Certificate No.: ${certNo}`, mL, footerY, { width: contentW / 2 });
    doc.text(`Generated on: ${genTime}`, mL, footerY, { width: contentW, align: 'right' });

    doc.end();
  });
}

module.exports = { generateCertificateBuffer };
