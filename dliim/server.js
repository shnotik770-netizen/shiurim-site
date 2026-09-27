// 770 דליים של שמחה – שרת קטן בלי תלויות.
// מגיש את האתר מתיקיית public ושומר את הדיווחים בקובץ JSON על Volume של Railway.
// משתני סביבה:
//   RAILWAY_VOLUME_MOUNT_PATH – מוגדר אוטומטית כשמחברים Volume בשירות
//   DATA_DIR                  – תיקיית נתונים חלופית (ברירת מחדל ./data)
//   ADMIN_PASSWORD            – סיסמה לדף המנהל (/admin)
//   GOAL                      – יעד הדליים ההתחלתי (ברירת מחדל 770; אפשר לשנות בדף המנהל)
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

// ברירות המחדל (מהמודעה). אחרי השינוי הראשון בדף המנהל הן נשמרות ב-config.json.
// value = כמה דליים שווה כל יחידה, unit = היחידה ("חצי שעה"; ריק = לכל פעם).
const DEFAULT_CONFIG = {
  goal: GOAL,
  families: [
    "אמא", "נוטיק קריית גת", "נוטיק חריש", "סקולניק", "נוטיק עפולה", "נוטיק תל ציון",
    "ויינר", "דהאן", "פרידמן", "נוטיק אור יהודה", "לויק",
  ],
  activities: [
    { id: "dance",   name: "רבע שעה של ריקודים בבית",       icon: "💃", unit: "",       value: 1 },
    { id: "nophone", name: "זמן משפחתי בלי פלאפונים",       icon: "📵", unit: "חצי שעה", value: 2 },
    { id: "lulav",   name: "מבצע ארבעת המינים",             icon: "🌿", unit: "חצי שעה", value: 1 },
    { id: "visit",   name: "משמחים משפחה אחרת בביקור משמח", icon: "🏠", unit: "",       value: 2 },
    { id: "shoeva",  name: "יוצאים עם הילדים לשמחת בית השואבה בחוץ", icon: "🎶", unit: "שעה",    value: 2 },
  ],
};
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const bucketsText = (n) => (n === 1 ? "דלי אחד" : `${n} דליים`);
const ruleOf = (a) => (a.unit ? `על כל ${a.unit} — ${bucketsText(a.value)}` : bucketsText(a.value));
const publicConfig = () => ({
  goal: config.goal,
  families: config.families,
  activities: config.activities.map((a) => ({ ...a, rule: ruleOf(a) })),
});

// ---------- אחסון ----------
// כל הדיווחים בזיכרון, ונשמרים לקובץ אחרי כל שינוי (כתיבה לקובץ זמני ואז החלפה).
fs.mkdirSync(DATA_DIR, { recursive: true });
function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    console.error("לא ניתן לקרוא את", file, err);
    process.exit(1);
  }
}
let rows = loadJson(DATA_FILE, []);
let config = loadJson(CONFIG_FILE, DEFAULT_CONFIG);
// שם הקטגוריה בדיווחים תמיד לפי ההגדרות העדכניות
for (const r of rows) {
  const act = config.activities.find((a) => a.id === r.activity);
  if (act) r.activityName = act.name;
}

let saving = Promise.resolve();
function writeJson(file, obj) {
  const snapshot = JSON.stringify(obj, null, 1);
  saving = saving.then(async () => {
    const tmp = file + ".tmp";
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, file);
  });
  return saving;
}
const save = () => writeJson(DATA_FILE, rows);
const saveConfig = () => writeJson(CONFIG_FILE, config);

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
  const families = Object.fromEntries(config.families.map((f) => [f, 0]));
  let total = 0;
  for (const r of rows) {
    const b = Number(r.buckets) || 0;
    total += b;
    families[r.family] = (families[r.family] || 0) + b;
  }
  const board = Object.entries(families)
    .map(([family, buckets]) => ({ family, buckets }))
    .sort((a, b) => b.buckets - a.buckets);
  const reports = rows.slice().sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return { goal: config.goal, total, families: board, reports };
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
      if (size > 100_000) { reject(new Error("גדול מדי")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("JSON לא תקין")); }
    });
    req.on("error", reject);
  });
}

const cleanText = (s, max = 40) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanFamily = (s) => cleanText(s);

// ---------- מנהל ----------
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const given = Buffer.from(String(req.headers["x-admin-password"] || ""));
  const want = Buffer.from(ADMIN_PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// בודק ומנקה הגדרות שנשלחו מדף המנהל. זורק שגיאה בעברית אם משהו לא תקין.
function validateConfig(body) {
  const goal = Math.floor(Number(body.goal));
  if (!(goal >= 1 && goal <= 100000)) throw new Error("יעד לא תקין");

  const families = (Array.isArray(body.families) ? body.families : []).map((f) => cleanFamily(f)).filter(Boolean);
  if (!families.length) throw new Error("צריך לפחות משפחה אחת");
  if (new Set(families).size !== families.length) throw new Error("יש שם משפחה כפול");

  const activities = (Array.isArray(body.activities) ? body.activities : []).map((a) => {
    const name = cleanText(a.name, 60);
    const value = Math.floor(Number(a.value));
    if (!name) throw new Error("לכל קטגוריה צריך שם");
    if (!(value >= 1 && value <= 100)) throw new Error(`שווי לא תקין בקטגוריה "${name}"`);
    return {
      id: /^[\w-]{1,40}$/.test(a.id || "") ? a.id : crypto.randomUUID().slice(0, 8),
      name,
      icon: cleanText(a.icon, 8) || "🪣",
      unit: cleanText(a.unit, 20),
      value,
    };
  });
  if (!activities.length) throw new Error("צריך לפחות קטגוריה אחת");
  if (new Set(activities.map((a) => a.id)).size !== activities.length) throw new Error("מזהה קטגוריה כפול");

  // renames: [[שם ישן, שם חדש], ...] – מעדכן גם דיווחים קיימים
  const renames = (Array.isArray(body.renames) ? body.renames : [])
    .map(([from, to]) => [cleanFamily(from), cleanFamily(to)])
    .filter(([from, to]) => from && to && from !== to && families.includes(to));

  return { goal, families, activities, renames };
}

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
  const rel = urlPath === "/" ? "index.html" : urlPath === "/admin" ? "admin.html" : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
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
      return sendJson(res, 200, { ok: true, ...publicConfig() });
    }

    if (pathname === "/api/summary" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, ...summarize() });
    }

    if (pathname === "/api/report" && req.method === "POST") {
      const body = await readBody(req);
      const family = cleanFamily(body.family);
      const act = config.activities.find((a) => a.id === body.activity);
      const buckets = Math.floor(Number(body.buckets));
      if (!config.families.includes(family)) return sendJson(res, 400, { ok: false, error: "נא לבחור משפחה מהרשימה" });
      if (!act) return sendJson(res, 400, { ok: false, error: "נא לבחור קטגוריה" });
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

    if (pathname.startsWith("/api/admin/")) {
      if (!ADMIN_PASSWORD) return sendJson(res, 503, { ok: false, error: "לא הוגדרה סיסמת מנהל (ADMIN_PASSWORD)" });
      if (!isAdmin(req)) {
        await new Promise((r) => setTimeout(r, 800)); // מאט ניחושי סיסמה
        return sendJson(res, 401, { ok: false, error: "סיסמה שגויה" });
      }

      if (pathname === "/api/admin/data" && req.method === "GET") {
        const all = rows.slice().sort((a, b) => String(b.time).localeCompare(String(a.time)));
        return sendJson(res, 200, { ok: true, config, rows: all });
      }

      if (pathname === "/api/admin/delete-report" && req.method === "POST") {
        const body = await readBody(req);
        const i = rows.findIndex((r) => r.id === String(body.id || ""));
        if (i < 0) return sendJson(res, 404, { ok: false, error: "הדיווח לא נמצא" });
        rows.splice(i, 1);
        await save();
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === "/api/admin/config" && req.method === "POST") {
        let next;
        try { next = validateConfig(await readBody(req)); }
        catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }
        const { renames, ...newConfig } = next;
        let changed = false;
        for (const r of rows) {
          for (const [from, to] of renames) if (r.family === from) { r.family = to; changed = true; }
          const act = newConfig.activities.find((a) => a.id === r.activity);
          if (act && r.activityName !== act.name) { r.activityName = act.name; changed = true; }
        }
        config = newConfig;
        await saveConfig();
        if (changed) await save();
        return sendJson(res, 200, { ok: true, config });
      }

      return sendJson(res, 404, { ok: false, error: "לא נמצא" });
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
