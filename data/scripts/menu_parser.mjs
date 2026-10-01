import { load } from "cheerio";

export const MENU_PARSER_VERSION = 2;

const norm = (text) => text.trim().toLowerCase().replace(/\s+/g, " ");
const uniq = (items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

export function extractMealItems(html, meal) {
 const $ = load(html);
 const classicKitchen = [];
 const globalFare = [];

 $(".k10-course.k10-course_level_1").each((_, el) => {
 const title = norm($(el).find(".k10-course__name_level_1").first().text());
 const items = $(el).find(".k10-recipe__name").map((_, item) => $(item).text()).get();
 // Breakfast uses Jumpstart, Sweet Shop and Soupside, not the lunch stations.
 // Keep the existing two-column feed format so older clients can read it too.
 if (title === "classic kitchen" || (meal === "breakfast" && title === "jumpstart")) {
 classicKitchen.push(...items);
 } else if (title === "global fare" || meal === "breakfast") {
 globalFare.push(...items);
 }
 });

 return { classicKitchen: uniq(classicKitchen), globalFare: uniq(globalFare) };
}
