/**
 * Thin Resend API wrapper for Cloudflare Workers.
 * Uses raw fetch — no npm package needed, no Node.js APIs.
 *
 * Free tier: 3,000 emails/month, 100/day.
 * Sends from "onboarding@resend.dev" — no custom domain required.
 */

const RESEND_API = "https://api.resend.com/emails";
const FROM = "ralph-auth <noreply@115jon.site>";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  apiKey: string;
}

export async function sendEmail({ to, subject, html, apiKey }: SendEmailOptions) {
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Email templates ───────────────────────────────────────────────────────────

export function verificationEmail(url: string) {
  return {
    subject: "Verify your email — ralph-auth",
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <div style="margin-bottom:24px">
          <span style="font-weight:700;font-size:18px">ralph<span style="color:#818cf8">auth</span></span>
        </div>
        <h1 style="font-size:20px;font-weight:700;margin-bottom:8px">Verify your email</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin-bottom:24px">
          Click the button below to verify your email address. This link expires in 24 hours.
        </p>
        <a href="${url}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
          Verify email
        </a>
        <p style="color:#475569;font-size:12px;margin-top:24px">
          If you didn't create an account, you can safely ignore this email.
        </p>
      </div>`,
  };
}

export function resetPasswordEmail(url: string) {
  return {
    subject: "Reset your password — ralph-auth",
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <div style="margin-bottom:24px">
          <span style="font-weight:700;font-size:18px">ralph<span style="color:#818cf8">auth</span></span>
        </div>
        <h1 style="font-size:20px;font-weight:700;margin-bottom:8px">Reset your password</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin-bottom:24px">
          We received a request to reset your password. Click below to choose a new one. This link expires in 1 hour.
        </p>
        <a href="${url}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
          Reset password
        </a>
        <p style="color:#475569;font-size:12px;margin-top:24px">
          If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>`,
  };
}

export function twoFactorOtpEmail(otp: string) {
  return {
    subject: `${otp} — your ralph-auth sign-in code`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <div style="margin-bottom:24px">
          <span style="font-weight:700;font-size:18px">ralph<span style="color:#818cf8">auth</span></span>
        </div>
        <h1 style="font-size:20px;font-weight:700;margin-bottom:8px">Your sign-in code</h1>
        <p style="color:#94a3b8;font-size:14px;margin-bottom:24px">Use this code to complete your sign-in. It expires in 10 minutes.</p>
        <div style="background:#1e293b;border-radius:12px;padding:24px;text-align:center;letter-spacing:0.25em;font-size:36px;font-weight:700;color:#818cf8;font-family:monospace">
          ${otp}
        </div>
        <p style="color:#475569;font-size:12px;margin-top:24px">
          If you didn't try to sign in, please change your password immediately.
        </p>
      </div>`,
  };
}

export function invitationEmail({
  inviterName,
  inviterEmail,
  orgName,
  inviteLink,
  role,
}: {
  inviterName: string;
  inviterEmail: string;
  orgName: string;
  inviteLink: string;
  role: string;
}) {
  return {
    subject: `You've been invited to join ${orgName} on ralph-auth`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
        <div style="margin-bottom:24px">
          <span style="font-weight:700;font-size:18px">ralph<span style="color:#818cf8">auth</span></span>
        </div>
        <h1 style="font-size:20px;font-weight:700;margin-bottom:8px">You're invited to ${orgName}</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin-bottom:8px">
          <strong style="color:#e2e8f0">${inviterName}</strong>
          <span style="color:#64748b">(${inviterEmail})</span>
          has invited you to join <strong style="color:#e2e8f0">${orgName}</strong>
          as a <strong style="color:#818cf8">${role}</strong>.
        </p>
        <p style="color:#94a3b8;font-size:14px;margin-bottom:28px">
          Click the button below to accept the invitation. This link expires in 48 hours.
        </p>
        <a href="${inviteLink}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
          Accept invitation
        </a>
        <p style="color:#475569;font-size:12px;margin-top:24px">
          If you weren't expecting this invitation you can safely ignore this email.
        </p>
      </div>`,
  };
}
