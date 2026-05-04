// Apps Script Web App — receives rows from the Next.js app and appends them
// to the bound Google Sheet. Deploy as: Execute as Me, Access Anyone.

const SHARED_SECRET = "REPLACE_WITH_LONG_RANDOM_STRING";
const SHEET_NAME = "Entries";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut({ ok: false, error: "no body" });
    }
    const body = JSON.parse(e.postData.contents);

    if (body.secret !== SHARED_SECRET) {
      return jsonOut({ ok: false, error: "unauthorized" });
    }

    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonOut({ ok: false, error: "sheet '" + SHEET_NAME + "' not found" });
    }

    const action = body.action || "create";

    if (action === "create") {
      const rows = body.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return jsonOut({ ok: false, error: "no rows" });
      }
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      return jsonOut({ ok: true, count: rows.length });
    }

    if (action === "delete") {
      const id = body.id;
      if (!id) return jsonOut({ ok: false, error: "no id" });
      
      const rowIndex = findRowIndexById(sheet, id);
      if (rowIndex > -1) {
        sheet.deleteRow(rowIndex);
        return jsonOut({ ok: true, deleted: true });
      } else {
        return jsonOut({ ok: false, error: "id not found" });
      }
    }

    if (action === "update") {
      const id = body.id;
      const row = body.row;
      if (!id || !row) return jsonOut({ ok: false, error: "no id or row" });

      const rowIndex = findRowIndexById(sheet, id);
      if (rowIndex > -1) {
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
        return jsonOut({ ok: true, updated: true });
      } else {
        return jsonOut({ ok: false, error: "id not found" });
      }
    }

    return jsonOut({ ok: false, error: "invalid action" });

  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function findRowIndexById(sheet, id) {
  const textFinder = sheet.createTextFinder(id).matchEntireCell(true);
  const match = textFinder.findNext();
  if (match) {
    return match.getRow();
  }
  return -1;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
