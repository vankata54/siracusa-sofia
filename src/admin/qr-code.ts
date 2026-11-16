/* A small QR encoder (ISO/IEC 18004), the port of the one in design/pages-admin/qr.html (QR-START ... QR-END; checked there
   bit by bit against the reference encoder "qrcode" and read back with "jsQR"): byte mode, versions 1-10, error correction
   L / M / Q / H, Reed-Solomon, the interleaving of the blocks, all 8 masks with the penalty points, the format and version
   information. No outside library. tests/unit/qr-code.test.ts compares it with the prototype's encoder module by module.
     makeQr(text, "Q") -> {size, version, ecl, mask, get(x, y)};  qrPath(q, quiet) -> "M4 4h1v1h-1z…" (one square per dark module) */
export type Ecl = "L" | "M" | "Q" | "H";
export interface Qr { size: number; version: number; ecl: Ecl; mask: number; get(x: number, y: number): boolean }

const ECC: Record<Ecl, number[]> = { L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28] };
const BLK: Record<Ecl, number[]> = { L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5], Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8], H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8] };
const FMT: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

function rawModules(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const dataCw = (v: number, e: Ecl) => Math.floor(rawModules(v) / 8) - ECC[e][v] * BLK[e][v];
function gmul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 255;
}
function rsDiv(deg: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < deg - 1; i++) r.push(0);
  r.push(1);
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gmul(root, 2);
  }
  return r;
}
function rsRem(data: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  data.forEach((b) => { const f = b ^ (r.shift() as number); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); });
  return r;
}
const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s));
function alignPos(v: number, size: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, r = [6];
  for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p);
  return r;
}

export function makeQr(text: string, ecl: Ecl = "M"): Qr {
  const bytes = utf8(text);
  let v = 1, cap = 0;
  for (v = 1; v <= 10; v++) { cap = dataCw(v, ecl) * 8; if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap) break; }
  if (v > 10) throw new Error("QR: текстът е твърде дълъг");
  /* the bits: mode 0100, the count, the data, the terminator, the padding */
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let x = 0; for (let k = 0; k < 8; k++) x = (x << 1) | bits[i + k]; data.push(x); }
  /* the blocks and Reed-Solomon, then the interleaving */
  const nb = BLK[ecl][v], ecLen = ECC[ecl][v], raw = Math.floor(rawModules(v) / 8), nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDiv(ecLen), blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - ecLen + (i < nShort ? 0 : 1), dat = data.slice(k, k + len); k += len;
    const ecc = rsRem(dat, div); if (i < nShort) dat.push(-1);
    blocks.push(dat.concat(ecc));
  }
  const cw: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= nShort) cw.push(b[i]); });
  /* the matrix */
  const size = v * 4 + 17, m: boolean[][] = [], fn: boolean[][] = [];
  for (let i = 0; i < size; i++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
  const set = (x: number, y: number, d: boolean) => { m[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const ap = alignPos(v, size);
  ap.forEach((a, ai) => ap.forEach((b, bi) => {
    if ((ai === 0 && bi === 0) || (ai === 0 && bi === ap.length - 1) || (ai === ap.length - 1 && bi === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask: number) => {
    const d = (FMT[ecl] << 3) | mask;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const vb = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bt = ((vb >>> i) & 1) !== 0, a = size - 11 + (i % 3), b2 = Math.floor(i / 3); set(a, b2, bt); set(b2, a, bt); }
  }
  /* the data in the zigzag */
  let bi = 0;
  const total = cw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x] && bi < total) { m[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
    }
  }
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue;
      let inv: boolean;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (inv) m[y][x] = !m[y][x];
    }
  };
  const penalty = () => {
    let p = 0, dark = 0;
    const line = (get: (a: number, b: number) => boolean) => {
      let s = 0;
      for (let a = 0; a < size; a++) {
        const row: boolean[] = [];
        for (let b = 0; b < size; b++) row.push(get(a, b));
        let run = 1;
        for (let b = 1; b <= size; b++) { if (b < size && row[b] === row[b - 1]) run++; else { if (run >= 5) s += 3 + run - 5; run = 1; } }
        const str = row.map((c) => (c ? "1" : "0")).join("");
        ["10111010000", "00001011101"].forEach((pt) => { let i = str.indexOf(pt); while (i > -1) { s += 40; i = str.indexOf(pt, i + 1); } });
      }
      return s;
    };
    p += line((a, b) => m[a][b]) + line((a, b) => m[b][a]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let mk = 0; mk < 8; mk++) { applyMask(mk); format(mk); const pp = penalty(); if (pp < bestP) { bestP = pp; best = mk; } applyMask(mk); }
  applyMask(best); format(best);
  return { size, version: v, ecl, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && m[y][x] };
}

/** the SVG path: every dark module a 1 × 1 square, shifted by the quiet zone */
export function qrPath(q: Qr, quiet = 4): string {
  let d = "";
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) d += "M" + (x + quiet) + " " + (y + quiet) + "h1v1h-1z";
  return d;
}
