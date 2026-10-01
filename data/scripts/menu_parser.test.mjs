import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMealItems } from "./menu_parser.mjs";

const section = (name, items) => `<div class="k10-course k10-course_level_1">
 <div class="k10-course__name_level_1">${name}</div>
 ${items.map((item) => `<span class="k10-recipe__name">${item}</span>`).join("")}
</div>`;

test("breakfast includes the school's breakfast stations", () => {
 const html = section(" Jumpstart ", ["Scrambled Eggs", "French Toast", "Scrambled Eggs"]) +
 section("Sweet Shop", ["Blueberry Muffin"]) + section("Soupside", ["Oatmeal"]);
 assert.deepEqual(extractMealItems(html, "breakfast"), {
 classicKitchen: ["Scrambled Eggs", "French Toast"],
 globalFare: ["Blueberry Muffin", "Oatmeal"]
 });
});

test("breakfast includes new stations without losing legacy station items", () => {
 const html = section("Classic Kitchen", ["Eggs"]) + section("Global Fare", ["Potatoes"]) +
 section("Bakery", ["Toast"]);
 assert.deepEqual(extractMealItems(html, "breakfast"), {
 classicKitchen: ["Eggs"], globalFare: ["Potatoes", "Toast"]
 });
});

test("lunch and dinner keep their existing station selection", () => {
 const html = section("Classic Kitchen", ["Chicken"]) + section("Global Fare", ["Rice"]) +
 section("Sweet Shop", ["Cake"]);
 for (const meal of ["lunch", "dinner"]) {
 assert.deepEqual(extractMealItems(html, meal), {
 classicKitchen: ["Chicken"], globalFare: ["Rice"]
 });
 }
});

test("an unpublished meal stays empty", () => {
 assert.deepEqual(extractMealItems("<div>No menu</div>", "breakfast"), {
 classicKitchen: [], globalFare: []
 });
});
