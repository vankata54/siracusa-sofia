/* Reads a QR code back (tests only): the modules of an SVG path "M4 4h1v1h-1z…" (src/admin/qr-code.ts qrPath) -> the text.
   An independent small decoder for a clean code (no damage): the format information (both copies must agree and pass
   BCH), the mask, the data modules in the zigzag (outside the function patterns), the blocks taken apart again (the
   interleaving), the Reed-Solomon codewords checked by the syndromes (all zero = no error), byte mode. Versions 1-10.
   It never uses the encoder: a mistake there shows here. */
const ECC: Record<string, number[]> = { L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28] };
const BLK: Record<string, number[]> = { L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5], Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8], H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8] };
const LEVEL = ["M", "L", "H", "Q"]; /* the 2 bits of the format -> the level */

/** the modules of a path (quiet zone `quiet`), as rows of booleans */
export function matrixOfPath(d: string, quiet = 4): boolean[][] {
  const pts = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [+m[1] - quiet, +m[2] - quiet]);
  const size = Math.max(...pts.flat()) + 1;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (const [x, y] of pts) m[y][x] = true;
  return m;
}

function bchOk(v: number): boolean { let r = v; for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10); return r === 0; }
function gmul(x: number, y: number): number { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 255; }
/** the syndromes of one block (data + ecc): all zero when nothing is damaged */
function syndromesZero(block: number[], ecLen: number): boolean {
  for (let i = 0, a = 1; i < ecLen; i++, a = gmul(a, 2)) { let s = 0; for (const c of block) s = gmul(s, a) ^ c; if (s) return false; }
  return true;
}

export function readQr(m: boolean[][]): { text: string; version: number; ecl: string; mask: number } {
  const size = m.length, v = (size - 17) / 4;
  if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error("QR: size " + size);
  /* the format information, both copies */
  let f1 = 0, f2 = 0;
  const c1: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  c1.forEach(([x, y], i) => { if (m[y][x]) f1 |= 1 << i; });
  for (let i = 0; i < 8; i++) if (m[8][size - 1 - i]) f2 |= 1 << i;
  for (let i = 8; i < 15; i++) if (m[size - 15 + i][8]) f2 |= 1 << i;
  if (f1 !== f2) throw new Error("QR: the two format copies differ");
  const fmt = f1 ^ 0x5412;
  if (!bchOk(fmt)) throw new Error("QR: format BCH");
  const ecl = LEVEL[fmt >>> 13], mask = (fmt >>> 10) & 7;
  /* the function patterns */
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) fn[y][x] = true; };
  mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8); mark(6, 0, 1, size); mark(0, 6, size, 1);
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, ap = [6];
    for (let p = size - 7; ap.length < n; p -= step) ap.splice(1, 0, p);
    const z = ap.length - 1;
    ap.forEach((a, i) => ap.forEach((b, j) => { if ((i === 0 && j === 0) || (i === 0 && j === z) || (i === z && j === 0)) return; mark(a - 2, b - 2, 5, 5); }));
  }
  if (v >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }
  const maskAt = (x: number, y: number) => [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask];
  /* the zigzag */
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x]) bits.push(m[y][x] !== maskAt(x, y) ? 1 : 0);
    }
  }
  const cws: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; cws.push(b); }
  /* the blocks apart again */
  const nb = BLK[ecl][v], ecLen = ECC[ecl][v], raw = cws.length, nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const lens = Array.from({ length: nb }, (_, i) => shortLen - ecLen + (i < nShort ? 0 : 1));
  const blocks: number[][] = lens.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...lens); i++) for (let j = 0; j < nb; j++) if (i < lens[j]) blocks[j].push(cws[k++]);
  for (let i = 0; i < ecLen; i++) for (let j = 0; j < nb; j++) blocks[j].push(cws[k++]);
  blocks.forEach((b) => { if (!syndromesZero(b, ecLen)) throw new Error("QR: Reed-Solomon"); });
  const data = blocks.flatMap((b, j) => b.slice(0, lens[j]));
  /* byte mode */
  const dbits: number[] = [];
  data.forEach((b) => { for (let i = 7; i >= 0; i--) dbits.push((b >>> i) & 1); });
  let p = 0;
  const take = (n: number) => { let x = 0; for (let i = 0; i < n; i++) x = (x << 1) | dbits[p++]; return x; };
  if (take(4) !== 4) throw new Error("QR: not byte mode");
  const len = take(v < 10 ? 8 : 16), out: number[] = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  return { text: new TextDecoder().decode(new Uint8Array(out)), version: v, ecl, mask };
}
