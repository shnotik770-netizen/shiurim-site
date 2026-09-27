// 770 דליים של שמחה – שמירת הדיווחים בגוגל שיטס.
// הוראות התקנה: ראו README.md בתיקייה dliim.

// אם ממלאים כאן סיסמה – יש להגדיר אותה גם ב-Railway במשתנה APPS_SCRIPT_TOKEN.
var TOKEN = "";

var SHEET_NAME = "דיווחים";
var HEADERS = ["id", "time", "family", "activity", "activityName", "buckets"];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, message: "דליים של שמחה – השרת פועל" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (TOKEN && body.token !== TOKEN) return json_({ ok: false, error: "אין הרשאה" });

    var sh = getSheet_();

    if (body.action === "list") {
      var values = sh.getDataRange().getValues();
      var rows = [];
      for (var i = 1; i < values.length; i++) {
        var v = values[i];
        if (!v[0]) continue;
        rows.push({
          id: String(v[0]),
          time: v[1] instanceof Date ? v[1].toISOString() : String(v[1]),
          family: String(v[2]),
          activity: String(v[3]),
          activityName: String(v[4]),
          buckets: Number(v[5]) || 0
        });
      }
      return json_({ ok: true, rows: rows });
    }

    if (body.action === "add") {
      var r = body.row || {};
      sh.appendRow([r.id, r.time, r.family, r.activity, r.activityName, r.buckets]);
      return json_({ ok: true });
    }

    if (body.action === "remove") {
      var data = sh.getDataRange().getValues();
      for (var j = data.length - 1; j >= 1; j--) {
        if (String(data[j][0]) === String(body.id) && String(data[j][2]) === String(body.family)) {
          sh.deleteRow(j + 1);
          return json_({ ok: true });
        }
      }
      return json_({ ok: false, error: "הדיווח לא נמצא" });
    }

    return json_({ ok: false, error: "פעולה לא מוכרת" });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
