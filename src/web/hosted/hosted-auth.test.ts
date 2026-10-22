import { afterEach, describe, expect, it, vi } from "vitest";
import { bootHostedAuth, finishRedirectUrl, googleCallbackUrl, isSafeDeviceReturnPath, monogram, orderedProviders } from "./hosted-auth";

describe("hosted auth client", () => {
  it("sends Google through the platform bounce with the pre-signed oauthCtx", () => {
    const callback = googleCallbackUrl({
      publishableKey: "pk_live_test",
      authUrl: "https://mira-wulx5t.auth.115jon.site",
      mainAuthUrl: "https://auth.115jon.site",
      redirectUri: "mira://auth",
      state: "nonce",
      mode: "live",
      page: "sign-in",
      appearance: {
        primaryColor: "#3b82f6",
        backgroundColor: "#0a0a0a",
        theme: "dark",
        logoUrl: null,
        faviconUrl: null,
      },
      app: { id: "app", name: "Mira", homeUrl: null, termsUrl: null, privacyUrl: null },
      hideBranding: false,
      oauthCtx: "payload.sig",
    });

    const url = new URL(callback);
    expect(url.origin).toBe("https://auth.115jon.site");
    expect(url.pathname).toBe("/api/hosted/oauth-complete");
    expect(url.searchParams.get("ctx")).toBe("payload.sig");
  });

  it("hands a custom-scheme redirect the xfr_ code and the app-level state", () => {
    const dest = new URL(finishRedirectUrl(
      { redirectUri: "mira://auth", state: "nonce" },
      "xfr_abc",
      "xfr_abc",
    ));
    expect(dest.protocol).toBe("mira:");
    expect(dest.searchParams.get("code")).toBe("xfr_abc");
    expect(dest.searchParams.get("kova_auth_code")).toBe("xfr_abc");
    expect(dest.searchParams.get("state")).toBe("nonce");
  });

  it("keeps an https redirect on the ticket code without a transfer alias", () => {
    const dest = new URL(finishRedirectUrl(
      { redirectUri: "https://app.example.com/callback", state: "nonce" },
      "ticket_abc",
    ));
    expect(dest.searchParams.get("code")).toBe("ticket_abc");
    expect(dest.searchParams.get("kova_auth_code")).toBeNull();
    expect(dest.searchParams.get("state")).toBe("nonce");
  });

  it("accepts only a same-origin device approval return", () => {
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH")).toBe(true);
    expect(isSafeDeviceReturnPath("https://evil.example/device?code=ABCD-EFGH")).toBe(false);
    expect(isSafeDeviceReturnPath("//evil.example/device?code=ABCD-EFGH")).toBe(false);
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH&redirect_uri=https://evil.example")).toBe(false);
    expect(isSafeDeviceReturnPath("/device?code=ABCD-EFGH#fragment")).toBe(false);
  });
});

// Only the DOM methods used by this standalone renderer. No browser dependency.
class Node {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  style: Record<string, string> = {};
  textContent = "";
  className = "";
  id = "";
  href = "";
  innerHTML = "";
  constructor(public tag: string) {}
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  appendChild(node: Node) { this.children.push(node); return node; }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  addEventListener(event: string, listener: () => void) { this.listeners[event] = listener; }
  closest() { return null; }
  replaceWith() {}
}
function descendants(node: Node): Node[] { return [node, ...node.children.flatMap(descendants)]; }
function renderPage(returnPath?: string, enabledProviders = ["google", "github"], page = "sign-in") {
  const root = new Node("main");
  root.id = "root";
  const head = new Node("head");
  const assign = vi.fn();
  vi.stubGlobal("document", {
    createElement: (tag: string) => new Node(tag), head,
    getElementById: (id: string) => id === "root" ? root : [...descendants(root), ...descendants(head)].find(node => node.id === id),
    createTextNode: (text: string) => { const node = new Node("text"); node.textContent = text; return node; },
  });
  vi.stubGlobal("window", {
    location: { assign },
    __KOVA_AUTH_HOSTED__: {
      publishableKey: "pk_test", authUrl: "https://test.auth.example", mainAuthUrl: "https://auth.example",
      redirectUri: "", state: "", mode: "live", page, oauthCtx: "signed.context",
      appearance: { primaryColor: "#5865f2", backgroundColor: "#070709", theme: "dark", logoUrl: null },
      app: { id: "app", name: "Ralph Meet", homeUrl: null, termsUrl: "https://app.example/terms", privacyUrl: null },
      hideBranding: true, enabledProviders: enabledProviders as string[], returnPath,
    },
  });
  bootHostedAuth();
  return { nodes: descendants(root), assign };
}
afterEach(() => vi.unstubAllGlobals());
describe("hosted sign-in rendering", () => {
  it.each([undefined, "/device?code=ABCD-EFGH"])("offers enabled providers for return %s", (returnPath) => {
    const { nodes, assign } = renderPage(returnPath);
    const google = nodes.find(node => node.tag === "button" && node.attributes["aria-label"] === "Continue with Google");
    const github = nodes.find(node => node.tag === "button" && node.attributes["aria-label"] === "Continue with GitHub");
    expect(google).toBeDefined();
    expect(github).toBeDefined();
    google!.listeners.click!();
    const url = new URL(assign.mock.calls[0]?.[0] as string);
    expect(url.origin).toBe("https://auth.example");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("ctx")).toBe("signed.context");
    github!.listeners.click!();
    expect(new URL(assign.mock.calls[1]?.[0] as string).searchParams.get("provider")).toBe("github");
  });
  it("links to the reset page on the main auth origin", () => {
    const { nodes } = renderPage();
    const link = nodes.find(node => node.tag === "a" && node.textContent === "Forgot password?");
    expect(link?.attributes.href).toBe("https://auth.example/reset-password?pk=pk_test");
  });
  it("has no reset link on the sign-up page", () => {
    const { nodes } = renderPage(undefined, ["google", "github"], "sign-up");
    expect(nodes.find(node => node.tag === "a" && node.textContent === "Forgot password?")).toBeUndefined();
  });
  it("omits providers when none are enabled", () => {
    expect(renderPage(undefined, []).nodes.some(node => node.textContent.includes("Continue with") || node.attributes["aria-label"]?.includes("Continue with"))).toBe(false);
  });
  it("shows the app logo when configured and a monogram otherwise", () => {
    expect(renderPage().nodes.some(node => node.className.includes("kv-monogram") && node.textContent === "RM")).toBe(true);
    expect(renderPage().nodes.some(node => node.innerHTML.includes("<circle"))).toBe(false);
    expect(monogram("Ralph Meet")).toBe("RM");
    expect(monogram("mira")).toBe("M");
    expect(monogram("  ")).toBe("?");
  });
  it("lays providers out as a grid of short labels once there are three or more", () => {
    const grid = renderPage(undefined, ["google", "github", "discord"]).nodes.find(node => node.className.includes("ra-providers"));
    expect(grid?.className).toContain("is-grid");
    expect(grid?.children.map(button => button.children[1]?.textContent)).toEqual(["Google", "GitHub", "Discord"]);
    expect(orderedProviders(["discord", "nope", "google"])).toEqual(["google", "discord"]);
    const pair = renderPage(undefined, ["google"]).nodes.find(node => node.className.includes("ra-providers"));
    expect(pair?.className).not.toContain("is-grid");
    expect(pair?.children[0]?.children[1]?.textContent).toBe("Continue with Google");
  });
  it("gives inputs visible associated labels and respects configured legal links and hideBranding", () => {
    const { nodes } = renderPage();
    for (const input of nodes.filter(node => node.tag === "input")) {
      expect(input.id).toBeTruthy();
      expect(nodes.some(node => node.tag === "label" && node.attributes.for === input.id && node.textContent)).toBe(true);
    }
    expect(nodes.some(node => node.tag === "a" && (node.href || node.attributes.href) === "https://app.example/terms")).toBe(true);
    expect(nodes.some(node => node.textContent.includes("Secured by"))).toBe(false);
  });
});
