/**
 * Thin Resend API wrapper for Cloudflare Workers.
 * Uses raw fetch — no npm package needed, no Node.js APIs.
 *
 * Free tier: 3,000 emails/month, 100/day.
 */

const RESEND_API = "https://api.resend.com/emails";
/** Sender when the EMAIL_FROM var is unset. */
export const DEFAULT_EMAIL_FROM = "Kova <noreply@115jon.com>";

/** The K mark as a PNG (Gmail and Outlook drop SVG). Served from public/email. */
const LOGO_URL = "https://auth.115jon.com/email/kova-mark.png";
const SITE_LABEL = "auth.115jon.com";

// ── Design tokens ─────────────────────────────────────────────────────────────
// The dashboard's "clear ink" palette. Everything is inlined because many
// clients ignore <style>; the <style> block only adds dark mode where it is
// honoured (Apple Mail, iOS, some Outlook). Font stacks use single quotes so
// they cannot close the style="" attribute they sit in.
const T = {
  page: "#f4f5f5",
  card: "#ffffff",
  border: "#e3e5e5",
  ink: "#131515",
  body: "#494d4d",
  muted: "#6b7070",
  faint: "#8a9090",
  accent: "#0283a7",
  accentText: "#026f8e",
  codeBg: "#f0f4f5",
  sans: "'Figtree',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  mono: "'IBM Plex Mono','SF Mono',Menlo,Consolas,monospace",
};

/** Escapes text that came from users (names, org names) before it goes in HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Shared email shell ────────────────────────────────────────────────────────

/** Who an email is from. Kova's own mark unless an app's branding is given. */
export interface EmailBrand {
  /** Display name, raw (escaped here). */
  name: string;
  /** https logo URL, or null for the Kova mark. */
  logoUrl: string | null;
  /** Button colour as #hex; anything else falls back to Kova's accent. */
  accent: string | null;
}

const KOVA_BRAND: EmailBrand = { name: "Kova", logoUrl: LOGO_URL, accent: T.accent };

function safeAccent(value: string | null): string {
  return value && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : T.accent;
}

function safeLogoUrl(value: string | null): string {
  if (!value) return LOGO_URL;
  try {
    return new URL(value).protocol === "https:" ? value : LOGO_URL;
  } catch {
    return LOGO_URL;
  }
}

/**
 * @param preheader Inbox preview text, hidden in the body.
 * @param body      Card content.
 * @param brand     Header name and logo; Kova when omitted.
 */
function emailShell(preheader: string, body: string, brand: EmailBrand = KOVA_BRAND): string {
  const brandName = escapeHtml(brand.name);
  const logo = escapeHtml(safeLogoUrl(brand.logoUrl));
  const footer = brand === KOVA_BRAND
    ? "You got this email because someone used this address on Kova."
    : `You got this email because this address has an account on ${brandName}, which uses Kova for sign-in.`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${brandName}</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&amp;family=IBM+Plex+Mono:wght@500&amp;display=swap" rel="stylesheet">
<style>
  @media (prefers-color-scheme: dark) {
    .k-page { background:#0f1111 !important; }
    .k-card { background:#181a1a !important; border-color:#2a2d2d !important; }
    .k-ink { color:#f2f3f3 !important; }
    .k-body { color:#b8bdbd !important; }
    .k-muted { color:#8a9090 !important; }
    .k-code { background:#202424 !important; color:#f2f3f3 !important; }
    .k-link { color:#4fb8d6 !important; }
    .k-rule { border-color:#2a2d2d !important; }
  }
</style>
</head>
<body class="k-page" style="margin:0;padding:0;background:${T.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}${"&#8199;&#65279;&#847;".repeat(20)}</div>
<table role="presentation" class="k-page" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${T.page};">
  <tr><td align="center" style="padding:40px 16px 48px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;">
      <tr><td style="padding:0 4px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td style="vertical-align:middle;"><img src="${logo}" width="32" height="32" alt="" style="display:block;border:0;width:32px;height:32px;"></td>
          <td class="k-ink" style="vertical-align:middle;padding-left:10px;font-family:${T.sans};font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">${brandName}</td>
        </tr></table>
      </td></tr>
      <tr><td class="k-card" style="background:${T.card};border:1px solid ${T.border};border-radius:14px;padding:36px 36px 32px;">
        ${body}
      </td></tr>
      <tr><td class="k-muted" style="padding:24px 8px 0;font-family:${T.sans};font-size:12px;line-height:1.6;color:${T.faint};text-align:center;">
        Sent by Kova, the sign-in service at <a class="k-link" href="https://${SITE_LABEL}" style="color:${T.muted};text-decoration:underline;">${SITE_LABEL}</a>.<br>
        ${footer}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Building blocks ───────────────────────────────────────────────────────────

function heading(text: string): string {
  return `<h1 class="k-ink" style="margin:0 0 12px;font-family:${T.sans};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${T.ink};">${text}</h1>`;
}

function paragraph(html: string): string {
  return `<p class="k-body" style="margin:0 0 24px;font-family:${T.sans};font-size:16px;line-height:1.6;color:${T.body};">${html}</p>`;
}

function strong(text: string): string {
  return `<strong class="k-ink" style="font-weight:600;color:${T.ink};">${text}</strong>`;
}

function ctaButton(href: string, label: string, accent: string = T.accent): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;"><tr>
    <td align="center" bgcolor="${accent}" style="border-radius:10px;background:${accent};">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${T.sans};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
    </td>
  </tr></table>`;
}

/** The link spelled out, for clients that block buttons. */
function fallbackLink(href: string): string {
  return `<p class="k-muted" style="margin:0 0 4px;font-family:${T.sans};font-size:13px;line-height:1.5;color:${T.muted};">Button not working? Paste this link into your browser:</p>
  <p style="margin:0 0 24px;font-family:${T.sans};font-size:13px;line-height:1.5;word-break:break-all;"><a class="k-link" href="${href}" style="color:${T.accentText};text-decoration:underline;">${href}</a></p>`;
}

function note(text: string): string {
  return `<p class="k-muted k-rule" style="margin:0;padding-top:20px;border-top:1px solid ${T.border};font-family:${T.sans};font-size:13px;line-height:1.6;color:${T.muted};">${text}</p>`;
}

// ── SendEmail ─────────────────────────────────────────────────────────────────

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  apiKey: string;
  /** Log the message and its links instead of sending it. See devEmailCaptureEnabled. */
  capture?: boolean;
  /** `Name <address>`; the EMAIL_FROM var. Defaults to DEFAULT_EMAIL_FROM. */
  from?: string;
}

/**
 * EMAIL_FROM's address under another display name ("Acme via Kova"). Only the
 * name changes, so the sending domain stays the verified one.
 */
export function fromWithDisplayName(from: string | undefined, displayName: string): string {
  const raw = from?.trim() || DEFAULT_EMAIL_FROM;
  const address = raw.match(/<([^<>]+)>\s*$/)?.[1]?.trim() ?? raw;
  const name = displayName.replace(/[\r\n"<>\\]/g, "").trim();
  return name ? `"${name}" <${address}>` : address;
}

const LOCAL_AUTH_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|(.+\.)?lvh\.me)$/;

/**
 * Local test hook: with KOVA_DEV_EMAIL_CAPTURE=1 the worker prints each email's
 * links to its log instead of calling Resend, so magic-link, reset and
 * verification flows can be driven without real mail. The flag only exists in
 * a local, gitignored .dev.vars, and it is ignored unless AUTH_URL is a
 * loopback or lvh.me host, so a deployed worker can never honor it.
 */
export function devEmailCaptureEnabled(env: { AUTH_URL?: string; KOVA_DEV_EMAIL_CAPTURE?: string }): boolean {
  if (env.KOVA_DEV_EMAIL_CAPTURE !== "1" || !env.AUTH_URL) return false;
  try {
    return LOCAL_AUTH_HOST.test(new URL(env.AUTH_URL).hostname);
  } catch {
    return false;
  }
}

function captureEmail(to: string, subject: string, html: string) {
  // Action links only: each appears twice (button and spelled out), and the
  // footer's link to the Kova site is not an action.
  const links = [...new Set([...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => m[1]))]
    .filter((href) => href !== `https://${SITE_LABEL}`);
  console.log(`[kova-dev-mail] ${JSON.stringify({ to, subject, links })}`);
  return { captured: true };
}

export async function sendEmail({ to, subject, html, apiKey, capture, from }: SendEmailOptions) {
  if (capture) return captureEmail(to, subject, html);

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: from?.trim() || DEFAULT_EMAIL_FROM, to, subject, html }),
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
    subject: "Verify your email for Kova",
    html: emailShell("Confirm this address to finish setting up your account.", `
      ${heading("Verify your email")}
      ${paragraph(`Confirm this is your address to finish setting up your Kova account. The link works for ${strong("1 hour")}.`)}
      ${ctaButton(url, "Verify email")}
      ${fallbackLink(url)}
      ${note("Didn&#39;t create an account? You can ignore this email.")}
    `),
  };
}

export function resetPasswordEmail(url: string) {
  return {
    subject: "Reset your Kova password",
    html: emailShell("Choose a new password. The link works for 1 hour.", `
      ${heading("Reset your password")}
      ${paragraph(`Someone asked to reset the password for this account. Choose a new one below. The link works for ${strong("1 hour")}.`)}
      ${ctaButton(url, "Choose a new password")}
      ${fallbackLink(url)}
      ${note("Didn&#39;t ask for this? Ignore this email. Your password stays the same.")}
    `),
  };
}

export function twoFactorOtpEmail(otp: string) {
  const code = escapeHtml(otp);
  return {
    subject: `${otp} is your Kova sign-in code`,
    html: emailShell(`Your code is ${code}. It works for 3 minutes.`, `
      ${heading("Your sign-in code")}
      ${paragraph(`Enter this code to finish signing in. It works for ${strong("3 minutes")} and only once.`)}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;"><tr>
        <td class="k-code" align="center" style="background:${T.codeBg};border-radius:10px;padding:20px 12px;font-family:${T.mono};font-size:34px;font-weight:500;letter-spacing:0.18em;color:${T.ink};">${code}</td>
      </tr></table>
      ${note("Didn&#39;t try to sign in? Someone may know your password. Change it now.")}
    `),
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
  const org = escapeHtml(orgName);
  const inviter = escapeHtml(inviterName);
  const article = /^[aeiou]/i.test(role) ? "an" : "a";
  return {
    subject: `${inviterName} invited you to ${orgName} on Kova`,
    html: emailShell(`Join ${org} on Kova. The invitation works for 48 hours.`, `
      ${heading(`Join ${org}`)}
      ${paragraph(`${strong(inviter)} (${escapeHtml(inviterEmail)}) invited you to join ${strong(org)} as ${article} ${strong(escapeHtml(role))}. The invitation works for ${strong("48 hours")}.`)}
      ${ctaButton(inviteLink, "Accept invitation")}
      ${fallbackLink(inviteLink)}
      ${note("Not expecting this? You can ignore this email.")}
    `),
  };
}

export function magicLinkEmail(url: string) {
  return {
    subject: "Your Kova sign-in link",
    html: emailShell("Sign in with one click. The link works for 10 minutes.", `
      ${heading("Sign in to Kova")}
      ${paragraph(`Use the button below to sign in. The link works for ${strong("10 minutes")} and only once.`)}
      ${ctaButton(url, "Sign in")}
      ${fallbackLink(url)}
      ${note("Didn&#39;t ask for this? Ignore this email. No one can sign in without the link.")}
    `),
  };
}

// ── Sign-in alert ─────────────────────────────────────────────────────────────

export interface SignInAlertDetails {
  /** App the sign-in happened in, or null for Kova itself. */
  appName: string | null;
  /** "Safari on iOS"; null when the browser could not be identified. */
  device: string | null;
  /** In-app browser name ("Instagram") when the sign-in came from one. */
  inAppBrowser: string | null;
  /** "Austin, US"; null when unknown. */
  location: string | null;
  /** Sign-in time, epoch ms. Rendered in UTC. */
  at: number;
  /** "This wasn't me" link (GET; the page it opens asks before acting). */
  notMeUrl: string;
}

/** "Thu, 5 Nov 2026, 14:03 UTC" */
export function formatUtc(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(ms)) + " UTC";
}

/**
 * "New sign-in to <App>". Every interpolated value is escaped. `brand` is the
 * app's (name, logo, primary colour) or omitted for Kova.
 */
export function signInAlertEmail(details: SignInAlertDetails, brand?: EmailBrand) {
  const product = details.appName ?? "Kova";
  const rows: Array<[string, string]> = [
    ["Where", details.location ?? "Unknown location"],
    ["Device", details.device ?? "Unknown device"],
    ...(details.inAppBrowser ? [["In-app browser", details.inAppBrowser] as [string, string]] : []),
    ["When", formatUtc(details.at)],
    ["App", product],
  ];
  const table = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">${rows
    .map(([label, value]) => `<tr>
      <td class="k-muted" style="padding:6px 12px 6px 0;font-family:${T.sans};font-size:14px;color:${T.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td class="k-ink" style="padding:6px 0;font-family:${T.sans};font-size:14px;font-weight:600;color:${T.ink};">${escapeHtml(value)}</td>
    </tr>`)
    .join("")}</table>`;
  const url = escapeHtml(details.notMeUrl);
  return {
    subject: `New sign-in to ${product}`,
    html: emailShell(`Your account was signed in to from ${escapeHtml(details.device ?? "a new device")}.`, `
      ${heading(`New sign-in to ${escapeHtml(product)}`)}
      ${paragraph("Your account was just signed in to from a device or place we haven&#39;t seen recently.")}
      ${table}
      ${paragraph(`If this was you, no action is needed.`)}
      ${paragraph(`If it wasn&#39;t, sign out everywhere and then reset your password.`)}
      ${ctaButton(url, "This wasn&#39;t me", safeAccent(brand?.accent ?? null))}
      ${fallbackLink(url)}
      ${note("This link works for 7 days and only once.")}
    `, brand),
  };
}
