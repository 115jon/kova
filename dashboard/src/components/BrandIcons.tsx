import type { ProviderId } from "@/lib/providers";

/**
 * Returns the correct brand icon for a given provider id.
 * Add a new case here when adding a new provider to SOCIAL_PROVIDERS.
 */
export function ProviderIcon({ id, size = 16 }: { id: ProviderId; size?: number }) {
  switch (id) {
    case "google": return <GoogleIcon size={size} />;
    case "discord": return <DiscordIcon size={size} />;
    case "github": return <GitHubIcon size={size} />;
    case "microsoft": return <MicrosoftIcon size={size} />;
    case "facebook": return <FacebookIcon size={size} />;
    case "apple": return <AppleIcon size={size} />;
    default: return null;
  }
}

/**
 * Square provider badge for card displays (OAuth Apps page).
 * Google: white bg + 4-color G. Discord: blurple bg + white mark.
 */
export function ProviderIconBadge({ provider, size = 36 }: { provider: ProviderId; size?: number }) {
  const iconSize = Math.round(size * 0.55);
  type BadgeConfig = { bg: string; border: string; icon: React.ReactNode };
  const configs: Partial<Record<ProviderId, BadgeConfig>> = {
    google: { bg: "#fff", border: "1px solid #e5e7eb", icon: <GoogleIcon size={iconSize} /> },
    discord: { bg: "#5865F2", border: "none", icon: <DiscordIconWhite size={iconSize} /> },
    github: { bg: "#24292e", border: "none", icon: <GitHubIconWhite size={iconSize} /> },
    microsoft: { bg: "#fff", border: "1px solid #e5e7eb", icon: <MicrosoftIcon size={iconSize} /> },
    facebook: { bg: "#1877F2", border: "none", icon: <FacebookIconWhite size={iconSize} /> },
    apple: { bg: "#000", border: "none", icon: <AppleIconWhite size={iconSize} /> },
  };
  const config: BadgeConfig = configs[provider] ?? {
    bg: "var(--color-surface-raised)",
    border: "1px solid var(--color-border)",
    icon: <span style={{ fontSize: iconSize * 0.7, color: "var(--color-text-secondary)" }}>?</span>,
  };

  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: config.bg, border: config.border,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {config.icon}
    </div>
  );
}

// ── Icon primitives ──────────────────────────────────────────────────────────
import type React from "react";

/** Official 4-color Google G mark */
export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/** Discord logo in brand blurple (#5865F2) */
export function DiscordIcon({ size = 18 }: { size?: number }) {
  return <DiscordSvg size={size} fill="#5865F2" />;
}

/** Discord logo in white — for use on blurple backgrounds */
function DiscordIconWhite({ size = 18 }: { size?: number }) {
  return <DiscordSvg size={size} fill="white" />;
}

function DiscordSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.056A19.9 19.9 0 0 0 5.99 21.05a.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.037.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/** GitHub mark — dark (for light backgrounds) */
export function GitHubIcon({ size = 18 }: { size?: number }) {
  return <GitHubSvg size={size} fill="currentColor" />;
}

/** GitHub mark — white (for dark #24292e badge background) */
function GitHubIconWhite({ size = 18 }: { size?: number }) {
  return <GitHubSvg size={size} fill="white" />;
}

function GitHubSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

/** Microsoft Windows logo (4-square) */
export function MicrosoftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M11.4 11.4H2V2h9.4v9.4z" fill="#F35325" />
      <path d="M22 11.4h-9.4V2H22v9.4z" fill="#81BC06" />
      <path d="M11.4 22H2v-9.4h9.4V22z" fill="#05A6F0" />
      <path d="M22 22h-9.4v-9.4H22V22z" fill="#FFBA08" />
    </svg>
  );
}

/** Facebook "f" logo in brand blue */
export function FacebookIcon({ size = 18 }: { size?: number }) {
  return <FacebookSvg size={size} fill="#1877F2" />;
}

/** Facebook "f" logo in white — for use on blue badge background */
function FacebookIconWhite({ size = 18 }: { size?: number }) {
  return <FacebookSvg size={size} fill="white" />;
}

function FacebookSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

/** Apple logo mark */
export function AppleIcon({ size = 18 }: { size?: number }) {
  return <AppleSvg size={size} fill="currentColor" />;
}

/** Apple logo mark in white — for use on black badge background */
function AppleIconWhite({ size = 18 }: { size?: number }) {
  return <AppleSvg size={size} fill="white" />;
}

function AppleSvg({ size, fill }: { size: number; fill: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}
