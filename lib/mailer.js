// Email via Resend API (https://resend.com) — free tier, works on Vercel Hobby.
// Set RESEND_API_KEY in Vercel environment variables to enable.
// Falls back to console logging if not configured — workflow is never blocked.

const APP_URL = process.env.APP_URL || '';

async function sendMail({ to, subject, text }) {
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('Email not sent (RESEND_API_KEY not set):', subject, '->', to);
    return;
  }
  const recipients = Array.isArray(to) ? to : [to];
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to: recipients,
        subject,
        text
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Resend API error:', res.status, err);
    } else {
      console.log('Email sent:', subject, '->', recipients.join(', '));
    }
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
