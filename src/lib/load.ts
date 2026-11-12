/* On-demand chunks with a reliable second try.
   A dynamic import() that failed once (no network for a moment) is remembered by the browser for the page's life: the
   same import(), and every chunk it imports, keeps failing; a second import with "?retry" gives an untransformed copy
   and still hits the remembered shared chunks. So: the first failure is reported (the page shows "Опитай пак"), and the
   next loadModule() call while online reloads the page. Pages keep their state in the address or in localStorage
   (filters, search, drafts), so the reload continues where the person was. While offline, it fails at once. */
const done = new WeakMap<() => Promise<unknown>, Promise<unknown>>();
let failed = false;

/** Did an on-demand chunk fail on this page (the next try reloads)? */
export function loadFailed(): boolean { return failed; }

export function loadModule<T>(factory: () => Promise<T>): Promise<T> {
  const have = done.get(factory) as Promise<T> | undefined;
  if (have) return have;
  if (failed) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.reject(new Error("offline"));
    if (typeof location !== "undefined") { location.reload(); return new Promise<T>(() => { /* the page reloads */ }); }
  }
  const p = factory();
  done.set(factory, p);
  p.catch(() => { failed = true; if (done.get(factory) === p) done.delete(factory); });
  return p;
}
