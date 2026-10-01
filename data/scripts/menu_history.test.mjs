import assert from "node:assert/strict";
import { test } from "node:test";
import { retainPastMenus } from "./menu_history.mjs";

const menu = { breakfast: { classicKitchen: [], globalFare: ["Eggs"] } };

test("retains exactly the past seven calendar days across a month boundary", () => {
 const days = Object.fromEntries([
 "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27",
 "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"
 ].map((date) => [date, menu]));
 const retained = retainPastMenus({ days }, "2026-10-01");
 assert.deepEqual(Object.keys(retained), [
 "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27",
 "2026-09-28", "2026-09-29", "2026-09-30"
 ]);
 assert.deepEqual(retained["2026-09-30"], menu);
});

test("next daily run preserves yesterday and expires only the oldest day", () => {
 const existing = { days: { "2026-09-24": menu, "2026-09-25": menu, "2026-09-30": menu } };
 const firstRun = { days: { ...retainPastMenus(existing, "2026-10-01"), "2026-10-01": menu } };
 assert.deepEqual(retainPastMenus(firstRun, "2026-10-02"), {
 "2026-09-25": menu, "2026-09-30": menu, "2026-10-01": menu
 });
});

test("preserves legacy menus without inventing missing historical dates", () => {
 assert.deepEqual(retainPastMenus({ menuDate: "2026-12-31", menus: menu }, "2027-01-01"), {
 "2026-12-31": menu
 });
 assert.deepEqual(retainPastMenus(null, "2027-01-01"), {});
});

test("keeps calendar dates across the daylight saving transition", () => {
 assert.deepEqual(retainPastMenus({ days: { "2026-10-28": menu, "2026-10-29": menu } }, "2026-11-05"), {
 "2026-10-29": menu
 });
});
