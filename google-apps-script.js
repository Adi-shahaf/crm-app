/**
 * Google Apps Script for syncing Google Sheets -> CRM (create + update)
 *
 * 1. Open Google Sheets -> Extensions -> Apps Script
 * 2. Paste this code
 * 3. Update WEBHOOK_URL
 * 4. Run setupTriggers() once
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

const WEBHOOK_URL = 'https://crm-app-eight-xi.vercel.app/api/webhooks/google-sheets?token=crm_webhook_8f2a4a6d3a12462bb9c4f2d1f7ad61fe';
const SHEET_NAME = ''; // optional: exact tab name, or leave '' for active tab
const KEY_PREFIX = 'LAST_PROCESSED_ROW_';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getActiveSheet();
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => map[String(h).trim().toLowerCase()] = i);
  return map;
}

function val_(row, map, keys) {
  for (const k of keys) {
    const idx = map[String(k).trim().toLowerCase()];
    if (idx !== undefined) return row[idx];
  }
  return '';
}

function rowId_(sheet, rowNumber) {
  return sheet.getSheetId() + '_row_' + rowNumber;
}

function logFailure_(rowNumber, status, body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName('Webhook_Failures');
  if (!s) s = ss.insertSheet('Webhook_Failures');
  if (s.getLastRow() === 0) s.appendRow(['Time', 'Row', 'Status', 'Body']);
  s.appendRow([new Date(), rowNumber, status, body]);
}

function postWithRetry_(payload, rowNumber) {
  const maxAttempts = 3;
  for (let a = 1; a <= maxAttempts; a++) {
    try {
      const res = UrlFetchApp.fetch(WEBHOOK_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const status = res.getResponseCode();
      const body = res.getContentText();
      if (status >= 200 && status < 300) return true;
      if (a === maxAttempts) logFailure_(rowNumber, status, body);
    } catch (e) {
      if (a === maxAttempts) logFailure_(rowNumber, 'EXCEPTION', String(e));
    }
    Utilities.sleep(500 * a);
  }
  return false;
}

function postRow_(sheet, rowNumber) {
  if (rowNumber <= 1) return;
  const map = headerMap_(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];

  const name = val_(row, map, ['Lead Name', 'Name', 'Full Name']);
  if (!name) return;

  const phone = val_(row, map, ['Phone Number', 'Phone']);
  const email = val_(row, map, ['Email']);
  const campaign = val_(row, map, ['Campaign']);
  const ad = val_(row, map, ['Ad', 'Ad Name']);
  const dateTime = val_(row, map, ['Date/Time', 'Timestamp', 'TimeStamp']);

  const whatsappResponseByHeader = val_(row, map, [
    'WhatsApp Response',
    'Whatsapp Response',
    'Message Status',
    'תגובה להודעת ווטסאפ'
  ]);

  // Exact Column A (1-based): index 0
  const columnA = row.length >= 1 ? row[0] : '';

  // Exact Column O (1-based): index 14
  const columnO = row.length >= 15 ? row[14] : '';
  const whatsappResponse = whatsappResponseByHeader || columnO || '';

  const payload = {
    name: String(name),
    phone: phone ? String(phone) : '',
    email: email ? String(email) : '',
    source: columnA ? String(columnA) : 'Google Sheets',
    dateTime: dateTime instanceof Date ? dateTime.toISOString() : dateTime,
    whatsappResponse: whatsappResponse ? String(whatsappResponse) : '',
    columnO: columnO ? String(columnO) : '',
    campaign: campaign ? String(campaign) : '',
    ad: ad ? String(ad) : '',
    rowId: rowId_(sheet, rowNumber)
  };

  postWithRetry_(payload, rowNumber);
}

/**
 * Handle individual row edits.
 * Renamed from onEdit to avoid simple trigger permission issues.
 */
function handleOnEdit(e) {
  if (!e || !e.range) return;
  postRow_(e.range.getSheet(), e.range.getRow());
}

/**
 * Handle structural changes (pasting, row insertion).
 * Renamed from onChange to maintain consistency.
 */
function handleOnChange(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const sheet = getSheet_();
    const key = KEY_PREFIX + sheet.getSheetId();
    const props = PropertiesService.getScriptProperties();

    const lastProcessed = Number(props.getProperty(key) || sheet.getLastRow());
    const lastRow = sheet.getLastRow();

    for (let r = lastProcessed + 1; r <= lastRow; r++) {
      postRow_(sheet, r);
    }

    props.setProperty(key, String(lastRow));
  } finally {
    lock.releaseLock();
  }
}

function setupTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getSheet_();
  const key = KEY_PREFIX + sheet.getSheetId();

  // Clear all existing triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    ScriptApp.deleteTrigger(t);
  });

  PropertiesService.getScriptProperties().setProperty(key, String(sheet.getLastRow()));

  // Create installable triggers pointing to the renamed functions
  ScriptApp.newTrigger('handleOnEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('handleOnChange').forSpreadsheet(ss).onChange().create();
}
