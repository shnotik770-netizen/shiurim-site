// תאריך עברי (לפי שעון ירושלים) עם אותיות: "יום שני, י"ז תשרי תשפ"ז".
// משמש גם בדפדפן (window.hebDate) וגם בשרת (require).
(function (root) {
  const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const HUNDREDS = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];

  // 17 → י"ז, 5 → ה', 787 → תשפ"ז (ט"ו/ט"ז במקום י"ה/י"ו)
  function gematria(n) {
    const rest = n % 100;
    let s = HUNDREDS[Math.floor(n / 100) % 10];
    s += rest === 15 ? "טו" : rest === 16 ? "טז" : TENS[Math.floor(rest / 10)] + ONES[rest % 10];
    return s.length === 1 ? s + "'" : s.slice(0, -1) + '"' + s.slice(-1);
  }

  const fmt = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
    timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  function hebDate(t, { weekday = false, year = false } = {}) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    let s = `${gematria(Number(p.day))} ${p.month}`;
    if (year) s += ` ${gematria(Number(p.year) % 1000)}`;
    const day = p.weekday === "יום שבת" ? "שבת" : p.weekday;
    return weekday ? `${day}, ${s}` : s;
  }

  const time = (t) => new Date(t).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });

  if (typeof module !== "undefined" && module.exports) module.exports = { hebDate, gematria, time };
  else Object.assign(root, { hebDate, hebTime: time });
})(typeof window !== "undefined" ? window : globalThis);
