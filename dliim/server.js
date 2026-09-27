// 770 דליים של שמחה – שרת קטן בלי תלויות.
// מגיש את האתר מתיקיית public ומעביר דיווחים לגוגל שיטס (Apps Script).
// משתני סביבה:
//   APPS_SCRIPT_URL   – כתובת ה-Web App של Apps Script (חובה לשמירה קבועה)
//   APPS_SCRIPT_TOKEN – אותו TOKEN שמוגדר בקוד Apps Script (רשות)
//   GOAL              – יעד הדליים (ברירת מחדל 770)
//   PORT              – מוגדר אוטומטית ב-Railway

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const APPS_SCRIPT_URL = (process.env.APPS_SCRIPT_URL || "").trim();
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || "";
const GOAL = Number(process.env.GOAL) || 770;
const PUBLIC_DIR = path.join(__dirname, "public");

// הקטגוריות מהמודעה. rule = ההנחיה כמה דליים מגיעים (לתצוגה בלבד; המשפחה מדווחת כמה דליים).
const ACTIVITIES = [
  { id: "dance",   name: "רבע שעה של ריקודים",              rule: "דלי אחד של שמחה",           icon: "💃" },
  { id: "nophone", name: "זמן משפחתי בלי פלאפונים",         rule: "על כל חצי שעה — 2 דליים",    icon: "📵" },
  { id: "lulav",   name: "מבצע ארבעת המינים",               rule: "על כל חצי שעה — דלי אחד",    icon: "🌿" },
  { id: "visit",   name: "משמחים משפחה אחרת בביקור משמח",   rule: "2 דליים",                    icon: "🏠" },
  { id: "shoeva",  name: "שמחת בית השואבה עם הילדים",       rule: "על כל שעה — 2 דליים",        icon: "🎶" },
];
// רשימת המשפחות (בחירה מרשימה נפתחת בלבד)
const FAMILIES = [
  "אמא",
  "נוטיק קריית גת",
  "נוטיק חריש",
  "סקולניק",
  "נוטיק עפולה",
  "נוטיק תל ציון",
  "ויינר",
  "דהאן",
  "פרידמן",
  "נוטיק אור יהודה",
  "לויק",
];

const ACT_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

// ---------- אחסון ----------
// כשאין APPS_SCRIPT_URL – נשמר בזיכרון בלבד (מצב הדגמה, נמחק בכל הפעלה מחדש).
const demoRows = [];

async function callSheet(payload) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, token: APPS_SCRIPT_TOKEN }),
    redirect: "follow",
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("תשובה לא תקינה מגוגל שיטס"); }
  if (!data.ok) throw new Error(data.error || "שגיאה בגוגל שיטס");
  return data;
}

let cache = { at: 0, rows: null };
async function getRows() {
  if (!APPS_SCRIPT_URL) return demoRows;
  if (cache.rows && Date.now() - cache.at < 5000) return cache.rows;
  const data = await callSheet({ action: "list" });
  cache = { at: Date.now(), rows: data.rows || [] };
  return cache.rows;
}

async function addRow(row) {
  if (!APPS_SCRIPT_URL) { demoRows.push(row); return; }
  await callSheet({ action: "add", row });
  cache.at = 0;
}

async function removeRow(id, family) {
  if (!APPS_SCRIPT_URL) {
    const i = demoRows.findIndex((r) => r.id === id && r.family === family);
    if (i < 0) throw new Error("הדיווח לא נמצא");
    demoRows.splice(i, 1);
    return;
  }
  await callSheet({ action: "remove", id, family });
  cache.at = 0;
}

function summarize(rows) {
  const families = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  let total = 0;
  for (const r of rows) {
    const b = Number(r.buckets) || 0;
    total += b;
    families[r.family] = (families[r.family] || 0) + b;
  }
  const board = Object.entries(families)
    .map(([family, buckets]) => ({ family, buckets }))
    .sort((a, b) => b.buckets - a.buckets);
  const recent = rows
    .slice()
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, 12);
  return { goal: GOAL, total, families: board, recent, demo: !APPS_SCRIPT_URL };
}

// ---------- HTTP ----------
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 10_000) { reject(new Error("גדול מדי")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("JSON לא תקין")); }
    });
    req.on("error", reject);
  });
}

const cleanFamily = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 40);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // כל נתיב לא מוכר מחזיר את העמוד הראשי
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[".html"] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (pathname === "/health") return sendJson(res, 200, { ok: true });

    if (pathname === "/api/config" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, goal: GOAL, families: FAMILIES, activities: ACTIVITIES });
    }

    if (pathname === "/api/summary" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, ...summarize(await getRows()) });
    }

    if (pathname === "/api/report" && req.method === "POST") {
      const body = await readBody(req);
      const family = cleanFamily(body.family);
      const act = ACT_BY_ID[body.activity];
      const buckets = Math.floor(Number(body.buckets));
      if (!FAMILIES.includes(family)) return sendJson(res, 400, { ok: false, error: "נא לבחור משפחה מהרשימה" });
      if (!act) return sendJson(res, 400, { ok: false, error: "נא לבחור פעילות" });
      if (!(buckets >= 1 && buckets <= 100)) return sendJson(res, 400, { ok: false, error: "מספר דליים לא תקין" });
      const row = {
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        family,
        activity: act.id,
        activityName: act.name,
        buckets,
      };
      await addRow(row);
      return sendJson(res, 200, { ok: true, row });
    }

    if (pathname === "/api/undo" && req.method === "POST") {
      const body = await readBody(req);
      await removeRow(String(body.id || ""), cleanFamily(body.family));
      return sendJson(res, 200, { ok: true });
    }

    if (pathname.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "לא נמצא" });

    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: err.message || "שגיאה" });
  }
});

server.listen(PORT, () => {
  console.log(`דליים של שמחה פועל על פורט ${PORT}` + (APPS_SCRIPT_URL ? "" : " (מצב הדגמה – אין APPS_SCRIPT_URL)"));
});
