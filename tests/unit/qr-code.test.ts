/* The QR encoder of the admin (src/admin/qr-code.ts) is the port of the approved prototype's (design/pages-admin/qr.html,
   between QR-START and QR-END): the same matrix module by module for every level and many lengths, and an independent
   decoder (tests/e2e/qr-read.ts) reads the text back (the address of a table label: version 4, 33 × 33, level Q). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { makeQr, qrPath, type Ecl } from "../../src/admin/qr-code.ts";
import { readQr, matrixOfPath } from "../e2e/qr-read.ts";

type ProtoQr = { make(t: string, e: string): { size: number; version: number; mask: number; get(x: number, y: number): boolean }; svgPath(q: unknown, quiet?: number): string };
const html = fs.readFileSync("design/pages-admin/qr.html", "utf8");
const src = html.slice(html.indexOf("/*QR-START*/"), html.indexOf("/*QR-END*/"));
const PROTO = new Function("unescape", "encodeURIComponent", src + "\nreturn QR;")(unescape, encodeURIComponent) as ProtoQr;

const TEXTS = ["https://siracusa-sofia.com/masa/p85tt7ke/", "https://siracusa-sofia.com/masa/23456789/", "/masa/abcdefgh/", "Маса 12", "a", "x".repeat(120), "y".repeat(150), "z".repeat(200), "w".repeat(260), "0894 36 55 77 · Дружба 2"];

describe("QR encoder: the port of the prototype", () => {
  it("the same matrix, version and mask as the prototype (all levels)", () => {
    for (const t of TEXTS) for (const e of ["L", "M", "Q", "H"] as Ecl[]) {
      let p; try { p = PROTO.make(t, e); } catch { expect(() => makeQr(t, e)).toThrow(); continue; }
      const q = makeQr(t, e);
      expect([q.size, q.version, q.mask], t + " " + e).toEqual([p.size, p.version, p.mask]);
      expect(qrPath(q), t + " " + e).toBe(PROTO.svgPath(p, 4));
    }
  });
  it("an independent decoder reads it back", () => {
    for (const t of TEXTS) for (const e of ["L", "M", "Q", "H"] as Ecl[]) {
      let q; try { q = makeQr(t, e); } catch { continue; }
      const r = readQr(matrixOfPath(qrPath(q)));
      expect(r.text).toBe(t);
      expect(r.ecl).toBe(e);
    }
  });
  it("a table label: version 4, 33 × 33 modules, level Q", () => {
    const q = makeQr("https://siracusa-sofia.com/masa/p85tt7ke/", "Q");
    expect([q.version, q.size, q.ecl]).toEqual([4, 33, "Q"]);
  });
});
