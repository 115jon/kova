/**
 * Notice shown above the SignIn / SignUp form inside in-app browsers
 * (Instagram, TikTok, …), where Google sign-in is often blocked.
 * Detection runs in an effect, so server and first client render match.
 */

import { useEffect, useRef, useState } from "react";
import { detectInAppBrowser, suggestedBrowser } from "../in-app-browser";
import type { AppearanceElements } from "../types";
import { CloseIcon } from "./icons";

type CopyState = "idle" | "copied" | "manual";

export function InAppBrowserNotice({ elements }: { elements?: AppearanceElements }) {
  const [detected, setDetected] = useState<{ app: string; browser: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [url, setUrl] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const app = detectInAppBrowser(ua);
    if (app) setDetected({ app, browser: suggestedBrowser(ua) });
  }, []);

  useEffect(() => {
    if (copy !== "manual") return;
    urlRef.current?.focus();
    urlRef.current?.select();
  }, [copy]);

  if (!detected || dismissed) return null;

  const copyLink = async () => {
    const href = window.location.href;
    setUrl(href);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(href);
      setCopy("copied");
    } catch {
      setCopy("manual");
    }
  };

  return (
    <div
      data-ra-element="inAppBrowserNotice"
      role="region"
      aria-label="Browser notice"
      style={elements?.inAppBrowserNotice}
    >
      <p>
        You&apos;re in the {detected.app} browser. Google sign-in may not work here. Open this
        page in {detected.browser} for the best experience.
      </p>
      <div data-ra-in-app-actions="">
        <button
          type="button"
          data-ra-in-app-copy=""
          onClick={() => void copyLink()}
        >
          Copy link
        </button>
        <span data-ra-in-app-status="" role="status" aria-live="polite">
          {copy === "copied" ? "Link copied" : ""}
        </span>
      </div>
      {copy === "manual" && (
        <input
          ref={urlRef}
          data-ra-in-app-url=""
          type="text"
          readOnly
          value={url}
          aria-label="Page link. Copy it and open it in your browser."
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <button
        type="button"
        data-ra-in-app-dismiss=""
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
