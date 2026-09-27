// 770 דליים של שמחה – שרת קטן בלי תלויות.
// מגיש את האתר מתיקיית public ושומר את הדיווחים בקובץ JSON על Volume של Railway.
// משתני סביבה:
//   RAILWAY_VOLUME_MOUNT_PATH – מוגדר אוטומטית כשמחברים Volume בשירות
//   DATA_DIR                  – תיקיית נתונים חלופית (ברירת מחדל ./data)
//   GOAL                      – יעד הדליים (ברירת מחדל 770)
//   PORT                      – מוגדר אוטומטית ב-Railway

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const GOAL = Number(process.env.GOAL) || 770;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "reports.json");
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
// כל הדיווחים בזיכרון, ונשמרים לקובץ אחרי כל שינוי (כתיבה לקובץ זמני ואז החלפה).
fs.mkdirSync(DATA_DIR, { recursive: true });
let rows = [];
try {
  rows = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") { console.error("לא ניתן לקרוא את", DATA_FILE, err); process.exit(1); }
}

let saving = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(rows);
  saving = saving.then(async () => {
    const tmp = DATA_FILE + ".tmp";
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, DATA_FILE);
  });
  return saving;
}

async function addRow(row) {
  rows.push(row);
  await save();
}

async function removeRow(id, family) {
  const i = rows.findIndex((r) => r.id === id && r.family === family);
  if (i < 0) throw new Error("הדיווח לא נמצא");
  rows.splice(i, 1);
  await save();
}

function toCsv() {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["תאריך", "משפחה", "קטגוריה", "דליים"].map(q).join(",")];
  for (const r of rows) {
    const t = new Date(r.time).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
    lines.push([t, r.family, r.activityName, r.buckets].map(q).join(","));
  }
  return "\ufeff" + lines.join("\r\n");
}

function summarize() {
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
  return { goal: GOAL, total, families: board, recent };
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
      return sendJson(res, 200, { ok: true, ...summarize() });
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

    if (pathname === "/api/export.csv" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="dliim-reports.csv"',
        "Cache-Control": "no-store",
      });
      return res.end(toCsv());
    }

    if (pathname.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "לא נמצא" });

    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { ok: false, error: err.message || "שגיאה" });
  }
});

server.listen(PORT, () => {
  console.log(`דליים של שמחה פועל על פורט ${PORT} · נתונים: ${DATA_FILE} · ${rows.length} דיווחים`);
});
