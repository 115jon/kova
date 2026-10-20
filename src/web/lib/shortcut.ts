import { useSyncExternalStore } from "react";

/** "⌘K" on Apple platforms, "Ctrl K" everywhere else. */
export function searchShortcutLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}

function clientLabel() {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return searchShortcutLabel(uaData?.platform || navigator.platform || navigator.userAgent);
}

const subscribeNever = () => () => {};

/**
 * The search shortcut for this device. It is null on the server and while
 * hydrating, so the server markup always matches, and filled in right after.
 */
export function useSearchShortcut() {
  return useSyncExternalStore(subscribeNever, clientLabel, () => null);
}
