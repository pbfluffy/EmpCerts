const nodemailer = require('nodemailer');

const APP_URL = process.env.APP_URL || '';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,  // SSL on port 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

async function sendMail({ to, subject, text }) {
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  const t = getTransporter();
  if (!t) {
    console.warn('Email not sent (SMTP not configured):', subject, '->', to);
    return;
  }
  try {
    await t.sendMail({
      from: `"Employee Certificate System" <${process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      text
    });
  } catch (err) {
    console.error('Failed to send email:', subject, '->', to, err.message);
  }
}

async function notifyRequestSubmitted({ recipients, request, employeeName }) {
  const reasonLine = request.reason === 'Other'
    ? `Other: ${request.other_reason || ''}` : request.reason;
  await sendMail({
    to: recipients,
    subject: `[Action needed] Certificate request #${request.request_id} from ${employeeName}`,
    text:
`A new certificate request needs your review.

Request ID: #${request.request_id}
Employee: ${employeeName}
Reason: ${reasonLine}
Includes salary: ${request.include_salary ? 'Yes' : 'No'}
Remarks: ${request.remarks || '(none)'}

Log in to review: ${APP_URL}/approvals.html`
  });
}

async function notifyRequestDecision({ employeeEmail, employeeName, request }) {
  const isApproved = request.status === 'Completed';
  const subject = isApproved
    ? `Your certificate request #${request.request_id} has been approved`
    : `Your certificate request #${request.request_id} has been rejected`;
  const body = isApproved
    ? `Hi ${employeeName},\n\nYour certificate request #${request.request_id} has been approved and is ready to download.\n\n${APP_URL}/dashboard.html`
    : `Hi ${employeeName},\n\nYour certificate request #${request.request_id} was rejected.\nReason: ${request.rejection_reason || '(no reason given)'}\n\n${APP_URL}/dashboard.html`;
  await sendMail({ to: employeeEmail, subject, text: body });
}

module.exports = { sendMail, notifyRequestSubmitted, notifyRequestDecision };
