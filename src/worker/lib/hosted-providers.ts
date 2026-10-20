import { HOSTED_PROVIDERS, type HostedProvider } from "../../shared/hosted-brand";

const defaults = new Set<string>(["google", "github", "discord", "microsoft"]);

/** App policy and real runtime credentials must both permit a hosted provider. */
export async function hostedProviders(env: Env, appId: string): Promise<HostedProvider[]> {
  const result = await env.DB.prepare(
    "SELECT provider, enabled FROM app_oauth_provider WHERE app_id = ?",
  ).bind(appId).all<{ provider: string; enabled: number }>();
  if (!result.success || !Array.isArray(result.results)) throw new Error("Provider policy unavailable");
  const enabled = result.results.length === 0
    ? defaults
    : new Set(result.results.filter(row => row.enabled === 1).map(row => row.provider));
  const configured: Record<HostedProvider, boolean> = {
    google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    github: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
    microsoft: !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
    apple: !!(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET),
    facebook: !!(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET),
  };
  return HOSTED_PROVIDERS.filter(provider => enabled.has(provider) && configured[provider]);
}
