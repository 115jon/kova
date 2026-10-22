import { describe, expect, it } from "vitest";
import type { DevicePageApp, DevicePageModel } from "./hosted-device";
import {
  FORMAT_CODE_SOURCE,
  initials,
  pageColors,
  prettyPlatform,
  renderDevicePage,
  spelledCode,
  TERMINAL_COPY,
  waitPhrase,
} from "./hosted-device-view";

const app: DevicePageApp = {
  id: "app_1",
  name: "Ralph Meet",
  logoUrl: "https://cdn.example.com/logo.svg",
  faviconUrl: null,
  primaryColor: "#5865f2",
  backgroundColor: "#070709",
  hideBranding: false,
};

const XSS = `<img src=x onerror=alert(1)>"'&`;

function review(overrides: Partial<Extract<DevicePageModel, { state: "review" }>> = {}): Extract<DevicePageModel, { state: "review" }> {
  return {
    state: "review",
    app,
    userCode: "ABCD-EFGH",
    device: { hostname: "ada-laptop", platform: "win32", label: "Ralph Meet Desktop" },
    requester: { ip: "203.0.113.7", country: "US", city: "Nashville" },
    account: { name: "Ada Lovelace", email: "ada@example.com", image: "https://img.example.com/ada.png" },
    switchAccountPath: "/sign-in?device_return=%2Fdevice%3Fcode%3DABCD-EFGH",
    ...overrides,
  };
}

function scripts(html: string): string[] {
  return [...html.matchAll(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/g)].map((m) => m[2]!);
}

function nonceOf(html: string): string {
  const match = /script-src 'nonce-([^']+)'/.exec(html);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("hosted device view", () => {
  describe("enter", () => {
    it("is a plain GET form that works without JS, with code-friendly input attributes", () => {
      const html = renderDevicePage({ state: "enter", app });
      expect(html).toContain('<form class="enter" method="get" action="/device"');
      expect(html).toContain('name="code"');
      for (const attr of ['autocomplete="one-time-code"', 'autocapitalize="characters"', 'spellcheck="false"', 'inputmode="text"']) {
        expect(html).toContain(attr);
      }
      expect(html).toMatch(/<label for="device-code"[^>]*>Device code<\/label>/);
      expect(html).toContain('<button type="submit"');
      expect(html).not.toMatch(/<input[^>]*aria-invalid/);
    });

    it("shows the format error, marks the input invalid, and escapes the echoed code", () => {
      const html = renderDevicePage({ state: "enter", app, code: `"><script>x</script>`, error: "invalid_format" });
      expect(html).toContain("Codes are 8 letters and numbers");
      expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
      expect(html).toContain('role="alert"');
      expect(html).toContain('value="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
      expect(html).not.toContain("<script>x</script>");
    });

    it("formats codes: any case, with or without the dash, alphabet only, capped at 8", () => {
      const formatCode = new Function(`${FORMAT_CODE_SOURCE}; return formatCode;`)() as (raw: string) => string;
      expect(formatCode("abcdefgh")).toBe("ABCD-EFGH");
      expect(formatCode("ABCD-EFGH")).toBe("ABCD-EFGH");
      expect(formatCode(" abcd efgh ")).toBe("ABCD-EFGH");
      expect(formatCode("abc")).toBe("ABC");
      expect(formatCode("abcd")).toBe("ABCD");
      expect(formatCode("abcde")).toBe("ABCD-E");
      expect(formatCode("ABCD-EFGHJK")).toBe("ABCD-EFGH");
      // 0, O, 1 and I are not in the alphabet; they are dropped, not mapped.
      expect(formatCode("O0I1abcd")).toBe("ABCD");
    });
  });

  describe("review", () => {
    it("shows app, code, device, requester, account, actions, and the safety line", () => {
      const html = renderDevicePage(review());
      expect(html).toContain("Sign in to Ralph Meet?</h1>");
      // Device-supplied text never goes into the title.
      expect(html).toContain("<title>Sign in to Ralph Meet?</title>");
      expect(html).toContain("Make sure this matches the code on your device.");
      expect(html).toContain('<span aria-hidden="true">ABCD-EFGH</span>');
      expect(html).toContain('<span class="sr-only">Code: A B C D, E F G H</span>');
      expect(html).toContain("Ralph Meet Desktop · Windows");
      expect(html).toContain('<span class="muted">ada-laptop</span>');
      expect(html).toContain("Nashville, US");
      expect(html).toContain('<span class="muted ip" title="203.0.113.7">203.0.113.7</span>');
      expect(html).toContain("Ada Lovelace");
      expect(html).toContain("ada@example.com");
      expect(html).toMatch(/<span class="avatar" aria-hidden="true">AL<img /);
      expect(html).toContain('id="approve-device"');
      expect(html).toContain('id="deny-device"');
      expect(html).toContain('Not you?<span class="sr-only"> Use another account</span>');
      expect(html).toContain("Only approve if you started this sign-in yourself.");
      expect(html).toContain('role="status" aria-live="polite"');
      expect(html).toContain('"switchAccountPath":"/sign-in?device_return=%2Fdevice%3Fcode%3DABCD-EFGH"');
    });

    it("marks device details as reported by the device, below the observed location", () => {
      const html = renderDevicePage(review());
      expect(html).toContain('<dd class="reported">Ralph Meet Desktop · Windows<span class="muted">ada-laptop</span><span class="caption">Reported by the device</span></dd>');
      expect(html).toContain("<dt>Requested from</dt><dd>Nashville, US");
      expect(html).toMatch(/dd\.reported \{ color: var\(--secondary\); \}/);
    });

    it("omits missing details gracefully", () => {
      const html = renderDevicePage(review({
        device: {},
        requester: { ip: "198.51.100.4" },
        account: { name: "", email: "solo@example.com", image: null },
      }));
      expect(html).not.toContain("<dt>Device</dt>");
      expect(html).toContain("<dt>Requested from</dt><dd>198.51.100.4</dd>");
      expect(html).toContain('<span class="name">solo@example.com</span>');
      expect(html).not.toContain('class="email"');
      expect(html).toContain('<span class="avatar" aria-hidden="true">S</span>');

      const bare = renderDevicePage(review({ device: {}, requester: {} }));
      expect(bare).not.toContain('<dl class="details">');
      expect(bare).toContain("<title>Sign in to Ralph Meet?</title>");
    });

    it("escapes every untrusted string in markup and in the inline script", () => {
      const html = renderDevicePage(review({
        app: { ...app, name: XSS },
        device: { hostname: XSS, platform: XSS, label: `${XSS}label` },
        requester: { ip: XSS, country: XSS, city: `${XSS}city` },
        account: { name: `${XSS}name`, email: `${XSS}@x`, image: `javascript:"><script>bad()</script>` },
      }));
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("<script>bad()");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;");
      for (const script of scripts(html)) {
        expect(script).not.toMatch(/<\/script|<img/i);
      }
      // The only executable <script> elements are ours, all carrying the nonce.
      const nonce = nonceOf(html);
      const tags = html.match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length).toBe(1);
      expect(tags[0]).toBe(`<script nonce="${nonce}">`);
    });

    it("ships inline scripts that parse", () => {
      for (const html of [renderDevicePage(review()), renderDevicePage({ state: "enter", app })]) {
        const all = scripts(html);
        expect(all.length).toBe(1);
        expect(() => new Function(all[0]!)).not.toThrow();
      }
    });
  });

  describe("terminal states", () => {
    const states = ["approved", "denied", "expired", "invalid", "used", "claimed", "rate_limited", "unavailable"] as const;

    it.each(states)("%s renders its copy without a script", (state) => {
      const html = renderDevicePage({ state, app });
      expect(html).toContain(`<h1 id="title">${TERMINAL_COPY[state].title.replace(/'/g, "&#39;")}</h1>`);
      expect(html).toContain(TERMINAL_COPY[state].body.replace(/'/g, "&#39;"));
      expect(html).not.toContain("<script");
    });

    it("offers the most useful next step", () => {
      for (const state of ["expired", "invalid", "used", "claimed"] as const) {
        expect(renderDevicePage({ state, app })).toContain('<a class="btn secondary" href="/device">Enter a different code</a>');
      }
      for (const state of ["rate_limited", "unavailable"] as const) {
        expect(renderDevicePage({ state, app })).toContain('<a class="btn secondary" href="">Try again</a>');
      }
      expect(renderDevicePage({ state: "rate_limited", app })).toContain("Wait a few minutes");
      expect(renderDevicePage({ state: "rate_limited", app, retryAfterSeconds: 61 })).toContain("Wait 2 minutes before trying this code again.");
      expect(waitPhrase(30)).toBe("a minute");
      expect(waitPhrase(0)).toBeUndefined();
      expect(renderDevicePage({ state: "approved", app })).toContain('class="check"');
      expect(renderDevicePage({ state: "denied", app })).toContain("Nothing was signed in.");
    });
  });

  describe("shell", () => {
    it("sets a nonce CSP shared by the inline style and script, and only loads the hosted fonts", () => {
      const html = renderDevicePage(review());
      const nonce = nonceOf(html);
      expect(html).toContain(`<style nonce="${nonce}">`);
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("connect-src 'self'");
      expect(html).toContain("form-action 'self'");
      expect(html).not.toMatch(/\son[a-z]+="/i);
      expect(html).not.toMatch(/\sstyle="/i);
      const hrefs = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => new URL(m[1]!.replace(/&amp;/g, "&")).host);
      expect(new Set(hrefs)).toEqual(new Set(["fonts.gstatic.com", "fonts.googleapis.com", "cdn.example.com", "img.example.com"]));
      expect(renderDevicePage(review())).not.toContain(nonce);
    });

    it("constrains the logo and falls back to a monogram", () => {
      const html = renderDevicePage({ state: "enter", app });
      expect(html).toContain('<img class="logo" src="https://cdn.example.com/logo.svg" alt="" width="48" height="48"');
      expect(html).toMatch(/\.logo \{[^}]*max-width: 160px;[^}]*max-height: 48px;/);
      const plain = renderDevicePage({ state: "enter", app: { ...app, logoUrl: null } });
      expect(plain).toContain('<span class="logo monogram" aria-hidden="true">RM</span>');
    });

    it("uses the built-in brand mark and the Secured by Kova footer like the sign-in page", () => {
      const ralph = renderDevicePage({ state: "enter", app: { ...app, logoUrl: null, brandMark: "ralph-radio" } });
      expect(ralph).toMatch(/<span class="logo mark" aria-hidden="true"><svg [^>]*>/);
      expect(ralph).not.toContain('class="logo monogram"');
      expect(ralph).toContain('<p class="brand">Secured by Kova</p>');
      // A real logo still wins over the mark.
      expect(renderDevicePage({ state: "enter", app: { ...app, brandMark: "ralph-radio" } })).toContain('<img class="logo"');
      expect(renderDevicePage({ state: "invalid", app: { ...app, hideBranding: true } })).not.toContain("Secured by Kova");
    });

    it("only puts hex colors into CSS and keeps the page dark", () => {
      expect(pageColors({ ...app, primaryColor: "red;}body{display:none", backgroundColor: "#fff" })).toEqual({ primary: "#3b82f6", background: "#0a0a0a" });
      expect(pageColors(app)).toEqual({ primary: "#5865f2", background: "#070709" });
      const html = renderDevicePage({ state: "enter", app: { ...app, primaryColor: "</style><script>x()</script>" } });
      expect(html).not.toContain("x()");
      expect(html).toContain("--primary: #3b82f6;");
    });

    it("honors reduced motion, gates hover, and never transitions everything", () => {
      const html = renderDevicePage(review());
      expect(html).toContain("@media (prefers-reduced-motion: reduce)");
      expect(html).toContain("@media (hover: hover) and (pointer: fine)");
      expect(html).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
      expect(html).toContain("env(safe-area-inset-bottom)");
      expect(html).not.toMatch(/transition:\s*all/);
      expect(html).not.toMatch(/scale\(0\)/);
    });
  });

  describe("helpers", () => {
    it("prettifies platforms and spells codes", () => {
      expect(prettyPlatform("win32")).toBe("Windows");
      expect(prettyPlatform("darwin")).toBe("macOS");
      expect(prettyPlatform("IOS")).toBe("iOS");
      expect(prettyPlatform("Haiku")).toBe("Haiku");
      expect(prettyPlatform("  ")).toBeUndefined();
      expect(spelledCode("AB2D-EF3H")).toBe("A B 2 D, E F 3 H");
      expect(initials("Ada King Lovelace", "a@x")).toBe("AL");
      expect(initials("", "zed@example.com")).toBe("Z");
    });
  });
});
