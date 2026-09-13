/**
 * _email.ts — Email delivery via Brevo (formerly Sendinblue) REST API.
 *
 * No domain verification required — just verify a single sender email address
 * in the Brevo dashboard: https://app.brevo.com/senders
 *
 * Supabase Edge Function secrets required:
 *   BREVO_API_KEY  — From Brevo dashboard → SMTP & API → API Keys → Create a new API key
 *   SMTP_FROM      — Your verified sender email address (e.g. yourname@gmail.com)
 *   APP_URL        — Your GitHub Pages URL (e.g. https://username.github.io/QC-Candidate-Test)
 *
 * Brevo free tier: 300 emails/day, no credit card required.
 * Sign up at https://www.brevo.com and verify your sender address under
 * Senders & IP → Senders. You only need to click the confirmation link Brevo sends you.
 */

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

function setting(name: string, fallback = ""): string {
  return (Deno.env.get(name) ?? fallback).trim();
}

function emailSettings(): { apiKey: string; sender: string; appUrl: string } {
  const apiKey = setting("BREVO_API_KEY");
  const sender = setting("SMTP_FROM");
  const appUrl = setting("APP_URL").replace(/\/$/, "");
  if (!apiKey || !sender || !appUrl) {
    throw new EmailDeliveryError(
      "Set BREVO_API_KEY, SMTP_FROM, and APP_URL in Supabase Edge Function secrets.",
    );
  }
  return { apiKey, sender, appUrl };
}

async function deliver(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: from },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new EmailDeliveryError(
      `Brevo delivery failed (${res.status}): ${body}`,
    );
  }
}

function formatDate(testDate: string | Date): string {
  const d = typeof testDate === "string" ? new Date(testDate) : testDate;
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Public send functions (mirrors email_service.py signatures)
// ---------------------------------------------------------------------------

export async function sendCandidateInvitation(
  email: string,
  name: string,
  username: string,
  temporaryPassword: string,
  testDate: string | Date,
  discipline = "",
): Promise<void> {
  const { apiKey, sender, appUrl } = emailSettings();
  const displayDate = formatDate(testDate);
  await deliver(
    apiKey,
    sender,
    email,
    `QC Candidate Assessment Scheduled - ${displayDate}`,
    `Dear ${name},\n\n` +
      "Your QC Candidate Assessment has been scheduled. Please review the details below and " +
      "keep this message available for the assessment date.\n\n" +
      `Scheduled date: ${displayDate}\n` +
      `Discipline: ${discipline || "As assigned in the portal"}\n` +
      `Assessment portal: ${appUrl}\n\n` +
      "Login credentials\n" +
      `Username: ${username}\n` +
      `Temporary password: ${temporaryPassword}\n\n` +
      `Your login is valid only on ${displayDate}. The portal will not accept your candidate ` +
      "login before or after this scheduled date.\n\n" +
      "On the scheduled date, open the assessment portal, enter the credentials above, and " +
      "follow the on-screen instructions. Please keep these credentials confidential and do " +
      "not forward this email.\n\n" +
      "If your schedule or candidate information is incorrect, contact your assessment " +
      "coordinator before the test date.\n\n" +
      "Regards,\nQC Candidate Test Portal\n",
  );
}

export async function sendReviewerCredentials(
  email: string,
  name: string,
  username: string,
  initialPassword: string,
): Promise<void> {
  const { apiKey, sender, appUrl } = emailSettings();
  await deliver(
    apiKey,
    sender,
    email,
    "Your QC Candidate Test Portal reviewer account",
    `Dear ${name},\n\n` +
      "A Reviewer account has been created for you in the QC Candidate Test Portal. " +
      "You can use this account to manage candidate schedules, review assigned assessments, " +
      "and record grades and feedback.\n\n" +
      `Portal link: ${appUrl}\n` +
      "Role: Reviewer\n" +
      `Username: ${username}\n` +
      `Initial password: ${initialPassword}\n\n` +
      "Open the portal and sign in with the credentials above. After signing in, use " +
      "Change password in the sidebar to choose your own password.\n\n" +
      "Keep these credentials confidential and do not forward this email. If you did not " +
      "expect this account or cannot sign in, contact the portal administrator.\n\n" +
      "Regards,\nQC Candidate Test Portal\n",
  );
}

export async function sendTestEmail(
  email: string,
  name = "Administrator",
): Promise<void> {
  const { apiKey, sender, appUrl } = emailSettings();
  await deliver(
    apiKey,
    sender,
    email,
    "QC Candidate Test Portal email test",
    `Dear ${name},\n\n` +
      "This is a test email from the QC Candidate Test Portal. " +
      "Your email configuration is working correctly.\n\n" +
      `Portal link: ${appUrl}\n\n` +
      "Regards,\nQC Candidate Test Portal\n",
  );
}
