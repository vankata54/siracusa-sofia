/* Storage interface of the business core. Implementations:
   - MemoryRepo (tests),
   - KVRepo over any string key-value store (browser localStorage in the demo: src/client/api.ts),
   - SqliteRepo on the server (server/db/repo.ts). */
export interface Doc { id: string }

export interface Repo {
  list<T extends Doc>(col: string, where?: Partial<T>): Promise<T[]>;
  get<T extends Doc>(col: string, id: string): Promise<T | null>;
  put<T extends Doc>(col: string, doc: T): Promise<T>;
  del(col: string, id: string): Promise<void>;
  /** Atomic counter (order numbers). Returns start on first call, then +1. */
  seq(name: string, start: number): Promise<number>;
  /** Optional: run fn atomically (SQLite transaction). */
  transaction?<R>(fn: () => Promise<R>): Promise<R>;
}

export function matches<T extends Doc>(d: T, where?: Partial<T>): boolean {
  if (!where) return true;
  for (const k of Object.keys(where)) if ((d as unknown as Record<string, unknown>)[k] !== (where as unknown as Record<string, unknown>)[k]) return false;
  return true;
}

const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

export class MemoryRepo implements Repo {
  protected data: Record<string, Record<string, Doc>> = {};
  protected seqs: Record<string, number> = {};
  async list<T extends Doc>(col: string, where?: Partial<T>): Promise<T[]> {
    return Object.values(this.data[col] || {}).map((d) => clone(d) as T).filter((d) => matches(d, where));
  }
  async get<T extends Doc>(col: string, id: string): Promise<T | null> {
    const d = (this.data[col] || {})[id];
    return d ? (clone(d) as T) : null;
  }
  async put<T extends Doc>(col: string, doc: T): Promise<T> {
    (this.data[col] ||= {})[doc.id] = clone(doc);
    return doc;
  }
  async del(col: string, id: string): Promise<void> { if (this.data[col]) delete this.data[col][id]; }
  async seq(name: string, start: number): Promise<number> {
    this.seqs[name] = this.seqs[name] == null ? start : this.seqs[name] + 1;
    return this.seqs[name];
  }
}

/** Minimal string store (window.localStorage fits). */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** One key per collection: `${prefix}${col}` = JSON {id: doc}. Good enough for the demo (small data, one browser). */
export class KVRepo implements Repo {
  private kv: KV;
  private prefix: string;
  constructor(kv: KV, prefix = "sc-db-") { this.kv = kv; this.prefix = prefix; }
  private read(col: string): Record<string, Doc> {
    try { return JSON.parse(this.kv.getItem(this.prefix + col) || "{}"); } catch { return {}; }
  }
  private write(col: string, v: Record<string, Doc>) { this.kv.setItem(this.prefix + col, JSON.stringify(v)); }
  async list<T extends Doc>(col: string, where?: Partial<T>): Promise<T[]> {
    return (Object.values(this.read(col)) as T[]).filter((d) => matches(d, where));
  }
  async get<T extends Doc>(col: string, id: string): Promise<T | null> { return (this.read(col)[id] as T) || null; }
  async put<T extends Doc>(col: string, doc: T): Promise<T> {
    const all = this.read(col); all[doc.id] = clone(doc); this.write(col, all); return doc;
  }
  async del(col: string, id: string): Promise<void> { const all = this.read(col); delete all[id]; this.write(col, all); }
  async seq(name: string, start: number): Promise<number> {
    const k = this.prefix + "seq-" + name, cur = this.kv.getItem(k);
    const n = cur == null ? start : +cur + 1;
    this.kv.setItem(k, String(n));
    return n;
  }
}
