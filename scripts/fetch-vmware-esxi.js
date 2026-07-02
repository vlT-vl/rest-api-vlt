#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KB_URL = 'https://knowledge.broadcom.com/external/article/316595/build-numbers-and-versions-of-vmware-esx.html';
const BASE_DIR = path.resolve(__dirname, '../v1/vmware/esxi');

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12'
};

function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // "May 27, 2026" → "2026/05/27"
  const m1 = s.match(/^(\w+)\s+(\d+),?\s+(\d{4})$/i);
  if (m1) {
    const mm = MONTHS[m1[1].toLowerCase()];
    if (mm) return `${m1[3]}/${mm}/${m1[2].padStart(2, '0')}`;
  }
  // "2026-05-27" or "2026/05/27"
  const m2 = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (m2) return `${m2[1]}/${m2[2]}/${m2[3]}`;
  return null;
}

function versionDir(versionStr) {
  // "ESXi 9.1.0.0100" → "9.0"
  // "ESXi 8.0.3 P09" → "8.0"
  const m = versionStr.match(/ESXi\s+(\d+)\.(\d+)/i);
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

function detectBuild(cells) {
  for (let i = 0; i < cells.length; i++) {
    if (/^\d{7,9}$/.test(cells[i].trim())) return { idx: i, val: parseInt(cells[i].trim(), 10) };
  }
  return null;
}

function detectVersion(cells) {
  for (let i = 0; i < cells.length; i++) {
    if (/ESXi\s+\d/i.test(cells[i])) return { idx: i, val: cells[i] };
  }
  return null;
}

function detectDate(cells) {
  for (let i = 0; i < cells.length; i++) {
    const d = parseDate(cells[i]);
    if (d) return { idx: i, val: d };
  }
  return null;
}

async function main() {
  const res = await fetch(KB_URL, { headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${KB_URL}`);
  const html = await res.text();

  // Split by major version sections; look for h2/h3 containing "ESXi X"
  const sectionRe = /<h[23][^>]*>([\s\S]*?ESXi\s+(\d+)\.[^\s<]*[\s\S]*?)<\/h[23]>/gi;
  // Fall back: parse all rows from all tables
  const rows = parseRows(html);

  // Map: dirName → [entries]
  const byDir = {};

  for (const cells of rows) {
    const buildInfo = detectBuild(cells);
    if (!buildInfo) continue;
    const verInfo = detectVersion(cells);
    if (!verInfo) continue;
    const dateInfo = detectDate(cells);
    if (!dateInfo) continue;

    const versionRaw = verInfo.val;
    const dir = versionDir(versionRaw);

    // Build the release name: look for "Update Xj" or "Express Patch N" pattern
    let releaseName = '';
    let versionTag = '';
    // Try to find two distinct ESXi strings (version tag vs release name)
    const esxiStrings = cells.filter(c => /ESXi\s+\d/i.test(c));
    if (esxiStrings.length >= 2) {
      // Shorter one is likely the version tag ("ESXi 8.0.3 P09")
      // Longer/label one is the release name ("ESXi 8.0 Update 3j")
      esxiStrings.sort((a, b) => a.length - b.length);
      versionTag = esxiStrings[0].trim();
      releaseName = esxiStrings[1].trim();
    } else {
      versionTag = versionRaw.trim();
      // Try to reconstruct release name from version tag
      releaseName = versionTag;
    }

    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push({
      'Versione': versionTag,
      'Nome Release': releaseName,
      'Data Rilascio': dateInfo.val,
      'Build Number': buildInfo.val,
      'Tipo': 'ISO'
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

    fs.writeFileSync(file, JSON.stringify(deduped, null, 3));
    totalAdded += newEntries.length;
    console.log(`esxi/${dir}: added builds ${newEntries.map(r => r['Build Number']).join(', ')}`);
  }

  if (!totalAdded) console.log('esxi: no new releases');
}

main().catch(err => { console.error('esxi:', err.message); process.exit(1); });
