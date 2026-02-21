/**
 * Google Apps Script for sending new rows to CRM webhook
 * 
 * 1. Open Google Sheets -> Extensions -> Apps Script
 * 2. Paste this code
 * 3. Update the WEBHOOK_URL with your actual production URL
 * 4. Run `setupTrigger` once to authorize and install the trigger
 */

const WEBHOOK_URL = 'https://your-crm-domain.com/api/webhooks/google-sheets?token=secret123';

function onRowAdded(e) {
  // If not triggered by edit, exit
  if (!e) return;
  
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  const row = range.getRow();
  
  // Ignore header row (assuming row 1 is header)
  if (row === 1) return;

  // Assuming columns: A=Name, B=Phone, C=Email, D=Source
  const name = sheet.getRange(row, 1).getValue();
  const phone = sheet.getRange(row, 2).getValue();
  const email = sheet.getRange(row, 3).getValue();
  const source = sheet.getRange(row, 4).getValue();

  if (!name) return; // Skip if no name

  const payload = {
    name: name,
    phone: phone,
    email: email,
    source: source || 'Google Sheets',
    rowId: sheet.getId() + '_row_' + row // Unique ID to prevent duplicates
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  };

  try {
    UrlFetchApp.fetch(WEBHOOK_URL, options);
  } catch (error) {
    Logger.log('Error sending to webhook: ' + error);
  }
}

// Run this function ONCE to setup the trigger
function setupTrigger() {
  const sheet = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onRowAdded')
    .forSpreadsheet(sheet)
    .onChange()
    .create();
}
