import React from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  Github,
  Globe2,
  Layers3,
  LockKeyhole,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { KovaLogo } from "./KovaLogo";

const clientCode = `import { kova } from "@kova/auth";

const auth = kova({
  domain: "auth.kova.dev",
  redirectUri: window.location.origin + "/callback"
});

await auth.loginWithRedirect();`;

const workerCode = `const session = await auth.getSession(request);

if (!session) {
  return new Response("Unauthorized", { status: 401 });
}

return Response.json({ user: session.user });`;

const arrowField = Array.from({ length: 324 }, (_, index) => {
  const columns = 18;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const edgeDistance = Math.min(row, column, 17 - row, 17 - column);
  const strength = Math.max(0.08, Math.min(0.8, 0.72 - edgeDistance * 0.105));
  const rotation = (column + row) % 3 === 0 ? -2 : (column + row) % 3 === 1 ? 1 : 0;

  return { index, row, column, strength, rotation };
});

export function LandingPage() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"client" | "worker">("client");
  const [copied, setCopied] = React.useState(false);
  const pageRef = React.useRef<HTMLDivElement>(null);
  const pointerFrame = React.useRef<number | null>(null);
  const pendingPointer = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const handlePointerMove = (event: PointerEvent) => {
      pendingPointer.current = { x: event.clientX, y: event.clientY };
      if (pointerFrame.current !== null) return;
      pointerFrame.current = window.requestAnimationFrame(() => {
        const { x, y } = pendingPointer.current;
        page.style.setProperty("--pointer-x", `${x}px`);
        page.style.setProperty("--pointer-y", `${y}px`);
        pointerFrame.current = null;
      });
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    };
  }, []);

  const handleCopy = async () => {
    const code = activeTab === "client" ? clientCode : workerCode;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="landing-page" ref={pageRef}>
      <div className="landing-grain" aria-hidden="true" />

      <header className="landing-header">
        <a className="landing-brand" href="#top" aria-label="Kova home" onClick={closeMenu}>
          <KovaLogo size={27} variant="icon" theme="monochrome" withBackground={false} />
          <span>kova<span className="brand-accent">auth</span></span>
        </a>

        <nav className={`landing-nav ${menuOpen ? "is-open" : ""}`} aria-label="Primary navigation">
          <a href="#top" onClick={closeMenu}>Home</a>
          <a href="#platform" onClick={closeMenu}>About</a>
          <a href="#how-it-works" onClick={closeMenu}>How it works</a>
          <a href="#compare" onClick={closeMenu}>Compare</a>
        </nav>

        <div className="landing-header-actions">
          <button
            className="menu-toggle"
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-signal-field" aria-hidden="true">
            {arrowField.map(({ index, row, column, strength, rotation }) => (
              <span
                className="signal-arrow"
                key={index}
                style={{
                  left: `${(column / 17) * 100}%`,
                  top: `${(row / 17) * 100}%`,
                  opacity: strength,
                  transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                  animationDelay: `${(index % 11) * -0.24}s`,
                }}
              >
                ↗
              </span>
            ))}
          </div>
          <div className="hero-ambient hero-ambient-top" aria-hidden="true" />
          <div className="hero-ambient hero-ambient-bottom" aria-hidden="true" />
          <div className="hero-pointer-beam" aria-hidden="true" />

          <div className="hero-content">
            <div className="landing-eyebrow hero-enter hero-enter-1">
              <span className="eyebrow-mark">■</span>
              Kova identity infrastructure
            </div>
            <h1 id="hero-title" className="hero-title hero-enter hero-enter-2">
              Identity that <em>connects</em><br />
              your product to every user.
            </h1>
            <div className="hero-actions hero-enter hero-enter-3">
              <a className="landing-button landing-button-primary" href="/sign-in">
                Start building <ArrowRight aria-hidden="true" />
              </a>
              <a className="landing-button landing-button-secondary" href="#platform">
                Explore Kova
              </a>
            </div>
          </div>

        </section>

        <section className="platform-intro" id="platform" aria-labelledby="platform-title">
          <div className="section-lattice" aria-hidden="true" />
          <div className="platform-intro-copy">
            <p className="section-kicker">The auth layer for ambitious teams</p>
            <h2 id="platform-title">Build better products.<br />Identity for your users.</h2>
            <p>
              Sign-in, sessions, organizations, and edge-native security on a platform made for your team.
            </p>
          </div>
          <div className="platform-node-wrap" aria-hidden="true">
            <div className="platform-node-glow" />
            <div className="platform-node">
              <KovaLogo size={72} variant="icon" theme="monochrome" />
            </div>
            <div className="platform-node-label">KOVA EDGE</div>
          </div>
          <div className="platform-line" aria-hidden="true" />
        </section>

        <section className="capabilities-section" id="how-it-works" aria-labelledby="capabilities-title">
          <div className="capabilities-heading">
            <p className="section-kicker">What we do</p>
            <h2 id="capabilities-title">One identity system.<br /><em>Everywhere</em> your product goes.</h2>
          </div>

          <div className="capabilities-grid">
            <article className="capability-card capability-card-wide">
              <div className="capability-number">01</div>
              <div className="capability-icon"><Globe2 aria-hidden="true" /></div>
              <h3>Global by default</h3>
              <p>Sessions verify close to your users, on the same edge where your application already runs.</p>
              <div className="latency-rail" aria-hidden="true">
                <span className="latency-track"><span className="latency-pulse" /></span>
                <span className="latency-caption">request / response / ready</span>
              </div>
            </article>
            <article className="capability-card">
              <div className="capability-number">02</div>
              <div className="capability-icon"><LockKeyhole aria-hidden="true" /></div>
              <h3>Quietly secure</h3>
              <p>Passkeys, OAuth, rotating sessions, and audit trails are ready when you are.</p>
              <div className="capability-status"><Check aria-hidden="true" /> protected at the edge</div>
            </article>
            <article className="capability-card capability-card-tall">
              <div className="capability-number">03</div>
              <div className="capability-icon"><Layers3 aria-hidden="true" /></div>
              <h3>Made for teams</h3>
              <p>Multi-tenant organizations, roles, invitations, and branded auth flows without the platform tax.</p>
              <div className="org-stack" aria-hidden="true">
                <span>acme / product</span>
                <span>acme / growth</span>
                <span>acme / admin</span>
              </div>
            </article>
            <article className="capability-card capability-card-code" id="compare">
              <div className="capability-code-heading">
                <div>
                  <div className="capability-number">04</div>
                  <div className="capability-icon"><Code2 aria-hidden="true" /></div>
                </div>
                <div>
                  <h3>Small surface area</h3>
                  <p>One import to get started. A platform that stays out of your way as you scale.</p>
                </div>
              </div>
              <div className="code-window">
                <div className="code-tabs" role="tablist" aria-label="Code examples">
                  <button className={activeTab === "client" ? "is-active" : ""} role="tab" aria-selected={activeTab === "client"} onClick={() => setActiveTab("client")} type="button">client.ts</button>
                  <button className={activeTab === "worker" ? "is-active" : ""} role="tab" aria-selected={activeTab === "worker"} onClick={() => setActiveTab("worker")} type="button">worker.ts</button>
                  <button className="code-copy" type="button" onClick={handleCopy} aria-label="Copy code" title="Copy code">
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </button>
                </div>
                <pre><code>{activeTab === "client" ? clientCode : workerCode}</code></pre>
              </div>
            </article>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="closing-rule" aria-hidden="true" />
          <div className="closing-orbit" aria-hidden="true"><span /></div>
          <p className="section-kicker">Ready when you are</p>
          <h2 id="closing-title">Let your product<br /><em>take it from here.</em></h2>
          <a className="landing-button landing-button-primary" href="/sign-in">Open the console <ArrowRight aria-hidden="true" /></a>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-brand landing-brand-footer">
          <KovaLogo size={24} variant="icon" theme="monochrome" withBackground={false} />
          <span>kova<span className="brand-accent">auth</span></span>
        </div>
        <span className="footer-note">Identity infrastructure for the edge.</span>
        <a href="https://github.com/115jon/kova" target="_blank" rel="noreferrer" className="footer-github">
          <Github aria-hidden="true" /> View source <ArrowUpRight aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
