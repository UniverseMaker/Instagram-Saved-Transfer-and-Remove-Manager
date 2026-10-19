// 최소한의 RFC 4180 CSV 읽기/쓰기 (캡션 안의 줄바꿈·따옴표·쉼표 처리)
const fs = require('fs');

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map(escapeCell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => escapeCell(r[c])).join(','));
  // BOM: 엑셀에서 한글 깨짐 방지
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function writeCsv(file, columns, rows) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, toCsv(columns, rows), 'utf8');
  fs.renameSync(tmp, file);
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', i = 0, q = false;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// 헤더가 있으면 객체 배열로, 없으면(URL만 나열된 파일 등) { url } 배열로 반환
function readCsvObjects(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => ['shortcode', 'url', 'code', 'media_pk'].includes(h));
  if (!hasHeader) return rows.map((r) => ({ url: r[0] }));
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] ?? ''; });
    return o;
  });
}

module.exports = { writeCsv, readCsvObjects };
