// Apps Script Web App — receives entry rows from the Next.js app and writes
// them to the bound Google Sheet (first sheet). Deploy as: Execute as Me,
// Access Anyone.
//
// NOTE: SECRET_KEY is currently hardcoded and must match APPS_SCRIPT_SECRET in
// the Next.js .env. TODO: move this into a Script Property (SHARED_SECRET).

var SECRET_KEY = "k7Hx9mQ2pR4vN8sT3wY5zL6jB1aD0fE"; // Khớp với file .env.local của bạn
var PC_POLICY_SOURCE_SPREADSHEET_ID = "1ByO8MDhCUiBO_QVhxsDHR55ixw6AxL_gq-ghwgbgJXI";
var PC_POLICY_SOURCE_SHEET = "Policy Tracker";
var PC_POLICY_SOURCE_COLUMN_COUNT = 11;

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

  if (action === "pcPolicyTracker") {
    try {
      return jsonOutput(readPcPolicyTracker());
    } catch (err) {
      return jsonOutput({
        ok: false,
        error: err && err.message ? err.message : "Failed to read Policy Tracker"
      });
    }
  }

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
      return jsonOutput({ok: true});
    }

    return jsonOutput({ok: false, error: "ID not found"});
  }

  return jsonOutput({ok: false, error: "Unknown action"});
}

function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readPcPolicyTracker() {
  var sourceSS = SpreadsheetApp.openById(PC_POLICY_SOURCE_SPREADSHEET_ID);
  var sourceSheet = sourceSS.getSheetByName(PC_POLICY_SOURCE_SHEET);

  if (!sourceSheet) {
    throw new Error("Policy Tracker sheet not found");
  }

  var lastRow = sourceSheet.getLastRow();

  if (lastRow < 2) {
    return {
      ok: true,
      headers: [],
      rows: [],
      lastBlackRow: null,
      basePolicyCount: 0,
      newPolicyCount: 0
    };
  }

  var range = sourceSheet.getRange(
    1,
    1,
    lastRow,
    PC_POLICY_SOURCE_COLUMN_COUNT
  );
  var values = range.getValues();
  var backgrounds = range.getBackgrounds();
  var lastBlackRow = null;

  for (var r = 0; r < backgrounds.length; r++) {
    var bg = backgrounds[r];

    if (
      bg[0] === "#000000" &&
      bg[1] === "#000000" &&
      bg[2] === "#000000" &&
      bg[3] === "#000000"
    ) {
      lastBlackRow = r + 1;
    }
  }

  var headers = values[0].map(function(value) {
    return value === null || value === undefined ? "" : String(value);
  });
  var rows = [];
  var basePolicyCount = 0;
  var newPolicyCount = 0;

  for (var i = 1; i < values.length; i++) {
    var sourceRowNumber = i + 1;
    var isBlackLine = lastBlackRow !== null && sourceRowNumber === lastBlackRow;
    var isNewPolicy = lastBlackRow !== null && sourceRowNumber > lastBlackRow;

    if (isBlackLine) {
      continue;
    }

    rows.push({
      sourceRowNumber: sourceRowNumber,
      isNewPolicy: isNewPolicy ? 1 : 0,
      values: values[i]
    });

    if (isNewPolicy) {
      newPolicyCount++;
    } else {
      basePolicyCount++;
    }
  }

  return {
    ok: true,
    headers: headers,
    rows: rows,
    lastBlackRow: lastBlackRow,
    basePolicyCount: basePolicyCount,
    newPolicyCount: newPolicyCount
  };
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
