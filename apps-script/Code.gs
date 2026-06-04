// Apps Script Web App — receives entry rows from the Next.js app and writes
// them to the bound Google Sheet (first sheet). Deploy as: Execute as Me,
// Access Anyone.
//
// NOTE: SECRET_KEY is currently hardcoded and must match APPS_SCRIPT_SECRET in
// the Next.js .env. TODO: move this into a Script Property (SHARED_SECRET).

var SECRET_KEY = "k7Hx9mQ2pR4vN8sT3wY5zL6jB1aD0fE"; // Khớp với file .env.local của bạn

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: "Missing POST payload. Deploy this script as a Web App and call it from the app, or run a test function that passes a mock event."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var data = JSON.parse(e.postData.contents);

  if (data.secret !== SECRET_KEY) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: "Invalid secret"})).setMimeType(ContentService.MimeType.JSON);
  }

  var action = data.action;
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getTargetSheet(spreadsheet, data.sheetName, action === "create");

  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: "Sheet not found"})).setMimeType(ContentService.MimeType.JSON);
  }

  ensureHeaders(sheet, data.headers);

  if (action === "create") {
    data.rows.forEach(function(row) {
      sheet.appendRow(row);
    });
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "update" || action === "delete") {
    var idToFind = data.id;
    var lastRow = sheet.getLastRow();
    var lastColumn = Math.max(sheet.getLastColumn(), resolveIdColumn(data));
    var rows = lastRow > 0 ? sheet.getRange(1, 1, lastRow, lastColumn).getValues() : [];
    var foundIndex = -1;
    var idColumnIndex = resolveIdColumn(data) - 1;

    // Tìm ID ở cột cuối cùng của payload tương ứng.
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][idColumnIndex] === idToFind || rows[i].indexOf(idToFind) !== -1) {
        foundIndex = i + 1; // +1 vì index hàng trong Sheet bắt đầu từ 1
        break;
      }
    }

    if (foundIndex !== -1) {
      if (action === "update") {
        sheet.getRange(foundIndex, 1, 1, data.row.length).setValues([data.row]);
      } else {
        sheet.deleteRow(foundIndex);
      }
      return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ok: false, error: "ID not found"})).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ok: false, error: "Unknown action"})).setMimeType(ContentService.MimeType.JSON);
}

function getTargetSheet(spreadsheet, sheetName, createIfMissing) {
  if (!sheetName) {
    return spreadsheet.getSheets()[0];
  }

  var sheet = spreadsheet.getSheetByName(sheetName);
  if (sheet || !createIfMissing) {
    return sheet;
  }

  return spreadsheet.insertSheet(sheetName);
}

function ensureHeaders(sheet, headers) {
  if (!headers || headers.length === 0 || sheet.getLastRow() > 0) {
    return;
  }

  sheet.appendRow(headers);
}

function resolveIdColumn(data) {
  if (data.row && data.row.length) {
    return data.row.length;
  }

  if (data.headers && data.headers.length) {
    return data.headers.length;
  }

  return 1;
}
