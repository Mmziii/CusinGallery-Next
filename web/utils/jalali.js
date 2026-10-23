/** Jalali (Solar Hijri) dates in Tehran time, computed at render time --
 * never hard-coded. Intl knows the Persian calendar ("fa-IR" defaults to it
 * with timeZone Asia/Tehran), so the clock of the server/browser is all we
 * need; no dependency and no frozen year.
 */

export function jalaliYear(date = new Date()) {
  return String(
    date.toLocaleDateString("fa-IR", {
      timeZone: "Asia/Tehran",
      calendar: "persian",
      year: "numeric",
    })
  );
}
