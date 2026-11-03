/** Writes every auth email template to <outDir>/<name>.html for visual review. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as m from "../src/worker/email";

const out = process.argv[2] ?? "email-previews";
mkdirSync(out, { recursive: true });
const url = "https://auth.115jon.com/api/auth/reset-password/abc123?callbackURL=%2F";
const samples = {
  verification: m.verificationEmail(url),
  "reset-password": m.resetPasswordEmail(url),
  "two-factor": m.twoFactorOtpEmail("482913"),
  invitation: m.invitationEmail({ inviterName: "Jon", inviterEmail: "jm43677@gmail.com", orgName: "House", inviteLink: url, role: "admin" }),
  "magic-link": m.magicLinkEmail(url),
};
for (const [name, mail] of Object.entries(samples)) {
  writeFileSync(join(out, `${name}.html`), mail.html);
  console.log(`${name}: ${mail.subject}`);
}
