#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '../v1/linux/rocky/releases.json');

const CODENAMES = { '10': 'Red Quartz', '9': 'Blue Onyx', '8': 'Green Obsidian' };

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

  const eolData = await get('https://endoflife.date/api/rocky-linux.json');
  const newEntries = [];

  for (const item of eolData) {
    const major = item.cycle;
    const codename = CODENAMES[major] || 'N/A';

    // Add the latest point release if not already present
    if (item.latest && !existing.has(item.latest)) {
      const date = item.latestReleaseDate || item.releaseDate;
      if (!date) continue;
      newEntries.push({
        'Nome Release': `Rocky Linux ${item.latest}`,
        'Versione': item.latest,
        'Codename': codename,
        'Data Rilascio': date,
        'End Of Support': item.eol || 'N/A'
      });
    }

    // Add the major.0 release if missing
    const v0 = `${major}.0`;
    if (!existing.has(v0) && !newEntries.find(e => e['Versione'] === v0)) {
      const date = item.releaseDate;
      if (date) {
        newEntries.push({
          'Nome Release': `Rocky Linux ${v0}`,
          'Versione': v0,
          'Codename': codename,
          'Data Rilascio': date,
          'End Of Support': item.eol || 'N/A'
        });
      }
    }
  }

  if (!newEntries.length) {
    console.log('rocky: no new releases');
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
  console.log(`rocky: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('rocky:', err.message); process.exit(1); });
