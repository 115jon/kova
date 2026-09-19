/**
 * Thin Resend API wrapper for Cloudflare Workers.
 * Uses raw fetch — no npm package needed, no Node.js APIs.
 *
 * Free tier: 3,000 emails/month, 100/day.
 */

const RESEND_API = "https://api.resend.com/emails";
const FROM = "kova-auth <noreply@115jon.site>";

// ── Design tokens (inlined — email clients strip <style> tags) ────────────────
const T = {
  bg: "#0a0a0a",   // --color-bg
  surface: "#111111",   // --color-surface
  surfaceRaised: "#1a1a1a",  // --color-surface-raised
  border: "#222222",   // --color-border
  borderStrong: "#2d2d2d",   // --color-border-strong
  textPrimary: "#f0f0f0",   // --color-text-primary
  textSecondary: "#a0a0a0",  // --color-text-secondary
  textTertiary: "#5a5a5a",  // --color-text-tertiary
  accent: "#3b82f6",   // --color-accent (blue)
  accentDark: "#2563eb",   // darker on hover (fallback)
  red: "#f87171",   // --color-red
  green: "#34d399",   // --color-green
  amber: "#fbbf24",   // --color-amber
  mono: "\"IBM Plex Mono\",\"Fira Mono\",Consolas,monospace",
  sans: "\"IBM Plex Sans\",Inter,system-ui,sans-serif",
};

// ── Shared email shell ────────────────────────────────────────────────────────

function emailShell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:${T.bg};-webkit-text-size-adjust:100%">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${T.bg};padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px">

        <!-- Wordmark header -->
        <tr><td style="padding-bottom:28px">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="width:24px;height:24px;background:${T.accent};border-radius:4px;text-align:center;vertical-align:middle">
                <span style="font-family:${T.mono};font-weight:800;font-size:13px;color:#ffffff;line-height:24px">R</span>
              </td>
              <td style="padding-left:9px;font-family:${T.mono};font-weight:700;font-size:15px;color:${T.textPrimary};letter-spacing:-0.02em">
                kovaauth
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Card body -->
        <tr><td style="background:${T.surface};border:1px solid ${T.borderStrong};border-radius:6px;overflow:hidden">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:20px;text-align:center;font-family:${T.mono};font-size:11px;color:${T.textTertiary};line-height:1.6">
          Sent by kova-auth &bull; You're receiving this because an action was taken on your account.<br>
          If you didn't initiate this, you can safely ignore it.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── CTA button ────────────────────────────────────────────────────────────────

function ctaButton(href: string, label: string): string {
  return `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td style="border-radius:4px;background:${T.accent}">
        <a href="${href}"
           style="display:inline-block;padding:11px 24px;font-family:${T.mono};font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;border-radius:4px;background:${T.accent}">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

// ── Email body helpers ────────────────────────────────────────────────────────

function cardPadding(content: string): string {
  return `<div style="padding:28px 28px 24px">${content}</div>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 10px;font-family:${T.mono};font-size:18px;font-weight:700;color:${T.textPrimary};letter-spacing:-0.03em;line-height:1.2">${text}</h1>`;
}

function subtext(text: string): string {
  return `<p style="margin:0 0 22px;font-family:${T.sans};font-size:14px;line-height:1.65;color:${T.textSecondary}">${text}</p>`;
}

function footerNote(text: string): string {
  return `<p style="margin:22px 0 0;font-family:${T.mono};font-size:11px;color:${T.textTertiary};line-height:1.6">${text}</p>`;
}

// ── SendEmail ─────────────────────────────────────────────────────────────────

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
    subject: "Verify your email — kova-auth",
    html: emailShell(cardPadding(`
      ${heading("Verify your email")}
      ${subtext("Click the button below to verify your email address and activate your account. This link expires in <strong style=\"color:${T.textPrimary}\">24 hours</strong>.")}
      ${ctaButton(url, "Verify email →")}
      ${footerNote("If you didn't create an account, you can safely ignore this email.")}
    `)),
  };
}

export function resetPasswordEmail(url: string) {
  return {
    subject: "Reset your password — kova-auth",
    html: emailShell(cardPadding(`
      ${heading("Reset your password")}
      ${subtext("We received a request to reset the password for this account. Click below to choose a new one. This link expires in <strong style=\"color:${T.textPrimary}\">1 hour</strong>.")}
      ${ctaButton(url, "Reset password →")}
      ${footerNote("If you didn't request a password reset, you can safely ignore this email. Your account is not at risk.")}
    `)),
  };
}

export function twoFactorOtpEmail(otp: string) {
  return {
    subject: `${otp} — your kova-auth sign-in code`,
    html: emailShell(cardPadding(`
      ${heading("Your sign-in code")}
      ${subtext("Use the code below to complete your sign-in. It expires in <strong style=\"color:${T.textPrimary}\">10 minutes</strong> and can only be used once.")}
      <div style="margin:0 0 22px;background:${T.surfaceRaised};border:1px solid ${T.borderStrong};border-radius:4px;padding:22px;text-align:center">
        <span style="font-family:${T.mono};font-size:38px;font-weight:700;color:${T.accent};letter-spacing:0.2em;line-height:1">${otp}</span>
      </div>
      ${footerNote("If you didn't try to sign in, please change your password immediately.")}
    `)),
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
    subject: `You've been invited to join ${orgName} on kova-auth`,
    html: emailShell(`
      <!-- Org banner -->
      <div style="padding:20px 28px;border-bottom:1px solid ${T.border};display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;background:${T.accent}18;border:1px solid ${T.accent}30;border-radius:4px;text-align:center;vertical-align:middle;line-height:36px;font-family:${T.mono};font-weight:700;font-size:16px;color:${T.accent}">
          ${orgName[0]?.toUpperCase() ?? "O"}
        </div>
        <span style="font-family:${T.mono};font-size:14px;font-weight:700;color:${T.textPrimary};letter-spacing:-0.02em">${orgName}</span>
      </div>
      ${cardPadding(`
        ${heading(`You're invited to ${orgName}`)}
        <p style="margin:0 0 22px;font-family:${T.sans};font-size:14px;line-height:1.65;color:${T.textSecondary}">
          <strong style="color:${T.textPrimary}">${inviterName}</strong>
          <span style="color:${T.textTertiary}"> &lt;${inviterEmail}&gt;</span>
          has invited you to join <strong style="color:${T.textPrimary}">${orgName}</strong>
          as a <strong style="color:${T.accent}">${role}</strong>.
          Click the button below to accept. This link expires in <strong style="color:${T.textPrimary}">48 hours</strong>.
        </p>
        ${ctaButton(inviteLink, "Accept invitation →")}
        ${footerNote("If you weren't expecting this invitation, you can safely ignore this email.")}
      `)}
    `),
  };
}

export function magicLinkEmail(url: string) {
  return {
    subject: "Your sign-in link — kova-auth",
    html: emailShell(cardPadding(`
      ${heading("Sign in to kova-auth")}
      ${subtext("Click the button below to sign in. This link expires in <strong style=\"color:${T.textPrimary}\">10 minutes</strong> and can only be used once.")}
      ${ctaButton(url, "Sign in →")}
      ${footerNote("If you didn't request this link, you can safely ignore this email. Your account is not at risk.")}
    `)),
  };
}
