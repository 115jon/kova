/**
 * Work that must finish but must not hold up the response (alert emails,
 * session refresh writes). Better Auth's database hooks get no ExecutionContext,
 * so the worker entry runs each request inside `withExecutionContext` and code
 * anywhere below it calls `inBackground`.
 *
 * nodejs_compat provides AsyncLocalStorage on Workers; the store is per
 * request, so nothing crosses requests.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = Pick<ExecutionContext, "waitUntil">;

const store = new AsyncLocalStorage<WaitUntil>();

export function withExecutionContext<T>(ctx: WaitUntil, fn: () => T): T {
  return store.run(ctx, fn);
}

/**
 * Hands `task` to ctx.waitUntil when a request context is active and resolves
 * at once; otherwise (tests, scripts) awaits it. Never rejects.
 */
export function inBackground(task: Promise<unknown>, label = "background"): Promise<void> {
  const guarded = task.then(
    () => undefined,
    (error: unknown) => { console.error(`[kova-auth] ${label} failed`, error); },
  );
  const ctx = store.getStore();
  if (!ctx) return guarded;
  ctx.waitUntil(guarded);
  return Promise.resolve();
}
