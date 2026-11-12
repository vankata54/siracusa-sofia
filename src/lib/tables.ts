/* The floor plan of the reservation: NOT in consts.ts, which is part of the shared runtime (size budget). */
import type { Table } from "./consts.ts";

/* Mock floor plan for the mockups: 12 in the hall, 8 in the garden. Not a real capacity. */
export const TABLES: Table[] = (() => {
  const t: Table[] = [];
  const hall: [number, Table["shape"]][] = [[2, "round"], [2, "round"], [4, "square"], [4, "square"], [4, "square"], [6, "rect"], [2, "round"], [4, "square"], [4, "square"], [6, "rect"], [2, "round"], [4, "square"]];
  hall.forEach((h, i) => t.push({ id: "S" + (i + 1), n: i + 1, zone: "salon", seats: h[0], shape: h[1], x: i % 4, y: Math.floor(i / 4), window: i < 4, stroller: [5, 9].indexOf(i) > -1, access: [2, 6].indexOf(i) > -1 }));
  const gar: [number, Table["shape"]][] = [[4, "square"], [4, "square"], [6, "rect"], [2, "round"], [4, "square"], [2, "round"], [6, "rect"], [4, "square"]];
  gar.forEach((g, i) => t.push({ id: "G" + (i + 1), n: i + 13, zone: "garden", seats: g[0], shape: g[1], x: i % 4, y: Math.floor(i / 4), window: false, stroller: true, access: [0, 4].indexOf(i) > -1 }));
  return t;
})();
