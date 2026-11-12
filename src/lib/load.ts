/* A dynamic import() that failed once (no network for a moment) is remembered by the browser: the same import() keeps
   failing until a reload. loadModule(() => import("./x.ts")) remembers success, and after a failure tries again with the
   chunk's address + "?retry=N" (a new module request), up to 2 times. Use it for every on-demand chunk.
   Note: the retried copy is a second instance of that module (fine for stateless UI / API modules). */
const done = new WeakMap<() => Promise<unknown>, Promise<unknown>>();
let n = 0;

/** the chunk address from the browser's error ("Failed to fetch dynamically imported module: https://.../x.js") */
export function failedUrl(err: unknown): string | null {
  const m = /(https?:\/\/[^\s'"]+?\.js)\b/.exec(String((err as Error)?.message || err));
  return m ? m[1] : null;
}

export function loadModule<T>(factory: () => Promise<T>, tries = 2): Promise<T> {
  const have = done.get(factory) as Promise<T> | undefined;
  if (have) return have;
  const p = factory().catch(async (err: unknown): Promise<T> => {
    const url = failedUrl(err);
    for (let i = 0; url && i < tries; i++) {
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      try { return (await import(/* @vite-ignore */ url + "?retry=" + ++n)) as T; } catch { /* next try */ }
    }
    throw err;
  });
  done.set(factory, p);
  /* a failure is not remembered: the next call tries again */
  p.catch(() => { if (done.get(factory) === p) done.delete(factory); });
  return p;
}
