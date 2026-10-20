import { Activity, Building2, Fingerprint } from "lucide-react";
import { useState } from "react";
import { CoastField } from "./CoastField";
import { KovaLogo } from "./KovaLogo";

const SOURCE_URL = "https://github.com/115jon/kova";

const PRODUCTS = [
  { title: "Passkeys", body: "A tap, not a password.", icon: Fingerprint, tone: "" },
  { title: "Organizations", body: "Roles, invites, and a switcher.", icon: Building2, tone: "tone-warning" },
  { title: "Sessions", body: "Checked at the edge, close to the user.", icon: Activity, tone: "tone-success" },
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="shore">
      <section className="shore-hero" id="top" aria-labelledby="shore-title">
        <header className="shore-header">
          <a className="shore-brand" href="#top" aria-label="Kova home" onClick={closeMenu}>
            <KovaLogo size={28} variant="full" />
          </a>
          <div className="shore-header-actions">
            <a className="shore-link" href={SOURCE_URL} rel="noreferrer" target="_blank">Source</a>
            <a className="hero-btn hero-btn-light" href="/sign-in">Sign in</a>
          </div>
          <button
            className="shore-menu"
            type="button"
            aria-controls="shore-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="shore-menu-bars" aria-hidden="true" />
          </button>
          <nav
            id="shore-nav"
            className={menuOpen ? "shore-nav is-open" : "shore-nav"}
            aria-label="Primary"
            hidden={!menuOpen}
          >
            <a href="/sign-in" onClick={closeMenu}>Sign in</a>
            <a href={SOURCE_URL} rel="noreferrer" target="_blank" onClick={closeMenu}>Source</a>
          </nav>
        </header>

        <div className="shore-window">
          <div className="shore-field-slot" aria-hidden="true">
            <CoastField />
          </div>
          <div className="shore-vignette" aria-hidden="true" />
          <div className="shore-copy">
            <p className="shore-eyebrow shore-enter">Hosted auth</p>
            <h1 id="shore-title" className="shore-enter">Sign-in that stays out of the way.</h1>
            <p className="shore-lead shore-enter">Passkeys, organizations, and sessions for the apps you already run.</p>
            <div className="shore-ctas shore-enter">
              <a className="hero-btn hero-btn-light hero-btn-lg" href="/sign-in">Sign in</a>
              <a className="hero-btn hero-btn-ghost hero-btn-lg" href={SOURCE_URL} rel="noreferrer" target="_blank">View source</a>
            </div>
          </div>
        </div>
      </section>

      <section className="shore-product" id="product" aria-labelledby="shore-product-title">
        <div className="shore-product-inner">
          <p className="section-label">What you get</p>
          <h2 id="shore-product-title">The parts of auth you'd rather not build.</h2>
          <div className="shore-bento">
            {PRODUCTS.map(({ title, body, icon: Icon, tone }) => (
              <article key={title} className="card">
                <span className={`icon-tile icon-tile-lg ${tone}`} aria-hidden="true"><Icon /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="shore-footer">
        <span className="shore-brand"><KovaLogo size={24} variant="full" /></span>
        <div className="shore-footer-links">
          <a href={SOURCE_URL} rel="noreferrer" target="_blank">Source</a>
          <span>Secured by Kova · auth.115jon.site</span>
        </div>
      </footer>
    </div>
  );
}
