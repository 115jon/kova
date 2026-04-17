import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function relativeTime(date: string | Date) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then; // positive = past, negative = future

  if (diff >= 0) {
    // Past
    const mins = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } else {
    // Future
    const absDiff = -diff;
    const mins = Math.ceil(absDiff / 60_000);
    const hours = Math.ceil(absDiff / 3_600_000);
    const days = Math.ceil(absDiff / 86_400_000);
    if (mins < 1) return "in a moment";
    if (mins < 60) return `in ${mins}m`;
    if (hours < 24) return `in ${hours}h`;
    return `in ${days}d`;
  }
}
