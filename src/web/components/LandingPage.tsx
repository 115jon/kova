import { useState } from "react";
import coastUrl from "../assets/coast.webp";
import { CoastField } from "./CoastField";

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="shore">
      <section className="shore-hero" id="top" aria-labelledby="shore-title">
        <div className="shore-field-slot" aria-hidden="true">
          <CoastField />
        </div>
        <header className="shore-header">
          <a className="shore-brand" href="#top" aria-label="Kova home" onClick={closeMenu}>
            <span className="shore-mark" aria-hidden="true">K</span>
            <span className="shore-word">Kova</span>
          </a>
          <a className="shore-signin" href="/sign-in">Sign in</a>
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
            <a href="#top" onClick={closeMenu}>Home</a>
            <a href="/sign-in" onClick={closeMenu}>Sign in</a>
          </nav>
        </header>
        <div className="shore-stage">
          <div className="shore-window">
            <img className="shore-pane" src={coastUrl} alt="" />
            <div className="shore-dots" aria-hidden="true">
              <span className="shore-dot shore-dot-red" />
              <span className="shore-dot shore-dot-amber" />
              <span className="shore-dot shore-dot-green" />
            </div>
            <div className="shore-card">
              <p className="shore-eyebrow">Hosted auth</p>
              <h1 id="shore-title">Sign-in that stays out of the way.</h1>
              <p className="shore-lead">Passkeys, organizations, and sessions for the apps you already run.</p>
              <a className="shore-pill" href="/sign-in">Sign in</a>
            </div>
          </div>
        </div>
      </section>

      <section className="shore-product" id="product" aria-label="Product">
        <div className="shore-rows">
          <div className="shore-row">
            <h2>Passkeys</h2>
            <p>A tap, not a password.</p>
          </div>
          <div className="shore-row">
            <h2>Organizations</h2>
            <p>Roles, invites, and a switcher.</p>
          </div>
          <div className="shore-row">
            <h2>Sessions</h2>
            <p>Checked at the edge, close to the user.</p>
          </div>
        </div>
      </section>

      <footer className="shore-footer">
        <div className="shore-brand">
          <span className="shore-mark" aria-hidden="true">K</span>
          <span className="shore-word">Kova</span>
        </div>
        <a className="shore-source" href="https://github.com/115jon/kova" rel="noreferrer" target="_blank">
          Source
        </a>
      </footer>
    </div>
  );
}
