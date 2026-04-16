/**
 * Shared log panel used across demo pages to show SDK activity.
 */

import { useState } from "react";

type Level = "ok" | "err" | "info";

interface LogLine {
  ts: string;
  msg: string;
  level: Level;
}

export function useLog() {
  const [lines, setLines] = useState<LogLine[]>([]);

  const log = (msg: string, level: Level = "info") => {
    const ts = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLines((prev) => [...prev.slice(-49), { ts, msg, level }]);
  };

  return { log, lines };
}

export function Log({ lines }: { lines: ReturnType<typeof useLog>["lines"] }) {
  if (lines.length === 0) return null;

  return (
    <div className="log-panel">
      {lines.map((l, i) => (
        <div key={i} className="log-line">
          <span className="log-ts">{l.ts}</span>
          <span className={`log-msg ${l.level}`}>{l.msg}</span>
        </div>
      ))}
    </div>
  );
}
