import { describe, it, expect, afterEach } from "vitest";
import { state, status, eta, lastSaturday } from "../../src/lib/status.ts";
import { setClock, minutes, now } from "../../src/lib/time.ts";

afterEach(() => setClock(null));

describe("hours and the three states", () => {
  it("08:30 before opening: closed, nothing works", () => {
    const s = state("08:30");
    expect(s).toMatchObject({ open: false, kitchen: false, delivery: false, lunch: false, lunchDiscount: false, breakfast: false });
    expect(status("08:30")).toEqual({ cls: "", html: '<b>Затворено</b> <span class="nw">· отваряме в 10:00</span>' });
  });
  it("12:30 open: delivery, lunch; busy only from the kitchen switch", () => {
    const s = state("12:30");
    expect(s).toMatchObject({ open: true, kitchen: true, delivery: true, lunch: true, lunchDiscount: false, breakfast: false });
    expect(status("12:30").cls).toBe("ok");
    expect(status("12:30").html).toContain("Отворено до 23:00");
    expect(eta("12:30").min).toBe(35);
    expect(eta("12:30", true)).toEqual({ min: 55, busy: true, text: "Възможни са закъснения · около 55\u00a0мин" });
  });
  it("10:30 breakfast and lunch", () => {
    expect(state("10:30")).toMatchObject({ breakfast: true, lunch: true });
    expect(eta("10:30").min).toBe(35);
  });
  it("16:30 lunch only with -30% pickup", () => {
    expect(state("16:30")).toMatchObject({ open: true, delivery: true, lunch: false, lunchDiscount: true });
  });
  it("21:30 delivery is over, pickup until 22:30 (state 2)", () => {
    const s = state("21:30");
    expect(s).toMatchObject({ open: true, kitchen: true, delivery: false, lunchDiscount: true });
    expect(status("21:30")).toEqual({ cls: "warn", html: '<b>Доставката приключи за днес</b> <span class="nw">· Поръчки за вземане до 22:30</span>' });
  });
  it("22:45 kitchen closed", () => {
    expect(state("22:45")).toMatchObject({ open: true, kitchen: false, lunchDiscount: false });
    expect(status("22:45").html).toContain("Кухнята затвори");
  });
  it("23:30 closed until tomorrow (state 3)", () => {
    expect(state("23:30").open).toBe(false);
    expect(status("23:30").html).toContain("отваряме утре в 10:00");
  });
  it("boundaries: 21:00 no delivery, 20:59 delivery, 15:00 discount", () => {
    expect(state("20:59").delivery).toBe(true);
    expect(state("21:00").delivery).toBe(false);
    expect(state("14:59").lunch).toBe(true);
    expect(state("15:00")).toMatchObject({ lunch: false, lunchDiscount: true });
    expect(state("11:30").breakfast).toBe(false);
  });
  it("global override is used when no argument is given", () => {
    setClock("21:30");
    expect(minutes()).toBe(1290);
    expect(state().delivery).toBe(false);
    setClock("now");
    expect(now()).toHaveProperty("h");
  });
});

describe("lastSaturday", () => {
  it("finds the last Saturday of the month", () => {
    const r = lastSaturday(new Date(2026, 10, 4));
    expect(r.d.getDate()).toBe(28);
    expect(r.d.getDay()).toBe(6);
    expect(r.days).toBe(24);
  });
  it("rolls to next month after it passed", () => {
    const r = lastSaturday(new Date(2026, 10, 29));
    expect(r.d.getMonth()).toBe(11);
    expect(r.d.getDay()).toBe(6);
  });
});
