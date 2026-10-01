import { load } from "cheerio";

export const MENU_PARSER_VERSION = 3;

const norm = (text) => text.trim().toLowerCase().replace(/\s+/g, " ");
const uniq = (items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

export function extractMealItems(html, meal) {
 const $ = load(html);
 const classicKitchen = [];
 const globalFare = [];

 $(".k10-course.k10-course_level_1").each((_, el) => {
 const title = norm($(el).find(".k10-course__name_level_1").first().text());
 const items = $(el).find(".k10-recipe__name").map((_, item) => $(item).text()).get();
 // These fields represent physical pickup locations: Global Fare is the popup's
 // left column, Classic Kitchen its right. They are not arbitrary display groups.
 // Provisionally place breakfast Jumpstart on the left at the user's request;
 // their recollection of its location is not yet confirmed. Sweet Shop, Soupside
 // and unmapped stations stay outside these columns rather than being guessed.
 if (title === "classic kitchen") {
 classicKitchen.push(...items);
 } else if (title === "global fare" || (meal === "breakfast" && /^(jumpstart|jump start)$/.test(title))) {
 globalFare.push(...items);
 }
 });

 return { classicKitchen: uniq(classicKitchen), globalFare: uniq(globalFare) };
}
