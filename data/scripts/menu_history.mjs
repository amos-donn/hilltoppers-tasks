const DAYS_BEHIND = 7;

export function addDays(date, days) {
 const d = new Date(`${date}T12:00:00Z`);
 d.setUTCDate(d.getUTCDate() + days);
 return d.toISOString().slice(0, 10);
}

export function retainPastMenus(existing, today) {
 const previousDays = { ...existing?.days };
 // Older feeds stored only one day; preserve it when it becomes history too.
 if (existing?.menuDate && existing?.menus && !previousDays[existing.menuDate]) {
 previousDays[existing.menuDate] = existing.menus;
 }
 const history = {};
 for (let offset = -DAYS_BEHIND; offset < 0; offset += 1) {
 const date = addDays(today, offset);
 // Keep recorded meals rather than querying a source that may now return today.
 if (previousDays[date]) history[date] = previousDays[date];
 }
 return history;
}
