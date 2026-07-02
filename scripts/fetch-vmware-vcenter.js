#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KB_URL = 'https://knowledge.broadcom.com/external/article/326316/vmware-vcenter-server-versions-and-build.html';
const BASE_DIR = path.resolve(__dirname, '../v1/vmware/vcenter');

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12'
};

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // "May 27, 2026" → "2026-05-27"
  const m1 = s.match(/^(\w+)\s+(\d+),?\s+(\d{4})$/i);
  if (m1) {
    const mm = MONTHS[m1[1].toLowerCase()];
    if (mm) return `${m1[3]}-${mm}-${m1[2].padStart(2, '0')}`;
  }
  // "2026-05-27"
  const m2 = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

// vCenter version like "8.0.3.00900" → dir "8.0"
function versionDir(ver) {
  const m = ver.match(/^(\d+)\.(\d+)/);
  if (!m) return 'legacy';
  return `${m[1]}.0`;
}

function buildDesc(a, b) {
  return (b['Build Number'] || 0) - (a['Build Number'] || 0);
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim();
}

function parseCells(rowHtml) {
  const cells = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    cells.push(stripTags(m[1]));
  }
  return cells;
}

function parseRows(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = parseCells(m[1]);
    if (cells.length >= 3) rows.push(cells);
  }
  return rows;
}

// vCenter version strings: "8.0.3.00900" (dotted quads with leading zeros)
const VCENTER_VERSION_RE = /\b(\d+\.\d+\.\d+\.\d{4,})\b/;
// Release name: "vCenter Server 8.0 Update 3j"
const VCENTER_NAME_RE = /vCenter\s+Server[^<\n]*/i;

async function main() {
  const res = await fetch(KB_URL, { headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${KB_URL}`);
  const html = await res.text();

  const rows = parseRows(html);
  const byDir = {};

  for (const cells of rows) {
    // Find build number
    let buildVal = null;
    for (const c of cells) {
      if (/^\d{7,9}$/.test(c.trim())) { buildVal = parseInt(c.trim(), 10); break; }
    }
    if (!buildVal) continue;

    // Find vCenter version (X.X.X.XXXXX pattern)
    let verStr = null;
    for (const c of cells) {
      const m = c.match(VCENTER_VERSION_RE);
      if (m) { verStr = m[1]; break; }
    }
    if (!verStr) continue;

    // Find release name ("vCenter Server X.X Update Yj")
    let relName = '';
    for (const c of cells) {
      const m = c.match(VCENTER_NAME_RE);
      if (m) { relName = m[0].trim(); break; }
    }
    if (!relName) relName = `vCenter Server ${verStr}`;

    // Find date
    let dateStr = null;
    for (const c of cells) {
      const d = parseDate(c);
      if (d) { dateStr = d; break; }
    }
    if (!dateStr) continue;

    const dir = versionDir(verStr);
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push({
      'Versione': verStr,
      'Nome Release': relName,
      'Data Rilascio': dateStr,
      'Build Number': buildVal
    });
  }

  let totalAdded = 0;
  for (const [dir, fetched] of Object.entries(byDir)) {
    const file = path.join(BASE_DIR, dir, 'releases.json');
    if (!fs.existsSync(file)) continue;

    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    const existingBuilds = new Set(current.map(r => r['Build Number']));

    const newEntries = fetched.filter(r => !existingBuilds.has(r['Build Number']));
    if (!newEntries.length) continue;

    const merged = [...newEntries, ...current].sort(buildDesc);
    const seen = new Set();
    const deduped = merged.filter(r => {
      if (seen.has(r['Build Number'])) return false;
      seen.add(r['Build Number']);
      return true;
    });

    fs.writeFileSync(file, JSON.stringify(deduped, null, 2));
    totalAdded += newEntries.length;
    console.log(`vcenter/${dir}: added builds ${newEntries.map(r => r['Build Number']).join(', ')}`);
  }

  if (!totalAdded) console.log('vcenter: no new releases');
}

main().catch(err => { console.error('vcenter:', err.message); process.exit(1); });
