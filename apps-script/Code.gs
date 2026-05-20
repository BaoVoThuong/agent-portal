// Apps Script Web App — receives entry rows from the Next.js app and writes
// them to the bound Google Sheet (first sheet). Deploy as: Execute as Me,
// Access Anyone.
//
// NOTE: SECRET_KEY is currently hardcoded and must match APPS_SCRIPT_SECRET in
// the Next.js .env. TODO: move this into a Script Property (SHARED_SECRET).

var SECRET_KEY = "k7Hx9mQ2pR4vN8sT3wY5zL6jB1aD0fE"; // Khớp với file .env.local của bạn

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  if (data.secret !== SECRET_KEY) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: "Invalid secret"})).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var action = data.action;

  if (action === "create") {
    data.rows.forEach(function(row) {
      sheet.appendRow(row);
    });
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "update" || action === "delete") {
    var idToFind = data.id;
    var rows = sheet.getDataRange().getValues();
    var foundIndex = -1;

    // Tìm ID ở cột cuối cùng (cột L)
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][rows[i].length - 1] === idToFind) {
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
}
