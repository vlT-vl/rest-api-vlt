#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '../v1/linux/debian/releases.json');

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function versionDesc(a, b) {
  const av = a['Versione'].split('.').map(Number);
  const bv = b['Versione'].split('.').map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (bv[i] || 0) - (av[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

async function main() {
  const current = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const existing = new Set(current.map(r => r['Versione']));

  const eolData = await get('https://endoflife.date/api/debian.json');
  const newEntries = [];

  for (const item of eolData) {
    const ver = String(item.cycle);
    if (existing.has(ver)) continue;
    if (!item.releaseDate) continue;

    const codename = item.codename
      ? item.codename.charAt(0).toUpperCase() + item.codename.slice(1)
      : 'N/A';

    newEntries.push({
      'Nome Release': `Debian ${ver}`,
      'Versione': ver,
      'Codename': codename,
      'Data Rilascio': item.releaseDate,
      'End Of Support': item.eol || 'N/A'
    });
  }

  if (!newEntries.length) {
    console.log('debian: no new releases');
    return;
  }

  const merged = [...newEntries, ...current].sort(versionDesc);
  const seen = new Set();
  const deduped = merged.filter(r => {
    if (seen.has(r['Versione'])) return false;
    seen.add(r['Versione']);
    return true;
  });

  fs.writeFileSync(OUTPUT, JSON.stringify(deduped, null, 3));
  console.log(`debian: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('debian:', err.message); process.exit(1); });
