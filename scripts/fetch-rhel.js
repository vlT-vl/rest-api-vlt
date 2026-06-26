#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '../v1/linux/rhel/releases.json');

const CODENAMES = {
  '10': 'Coughlan', '9': 'Plow', '8': 'Ootpa',
  '7': 'Maipo', '6': 'Santiago', '5': 'Tikanga', '4': 'Nahant'
};

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

  const eolData = await get('https://endoflife.date/api/rhel.json');
  const newEntries = [];

  for (const item of eolData) {
    const major = String(item.cycle).split('.')[0];
    const codename = CODENAMES[major] || 'N/A';

    // endoflife.date RHEL: cycle is the major version, latest is the latest minor
    if (item.latest && !existing.has(item.latest)) {
      const date = item.latestReleaseDate || item.releaseDate;
      if (!date) continue;
      newEntries.push({
        'Nome Release': `Red Hat Enterprise Linux ${item.latest}`,
        'Versione': item.latest,
        'Codename': codename,
        'Data Rilascio': date,
        'End Of Support': item.eol || 'N/A'
      });
    }

    // Add the major.0 if missing
    const v0 = `${major}.0`;
    if (!existing.has(v0) && !newEntries.find(e => e['Versione'] === v0)) {
      const date = item.releaseDate;
      if (date) {
        newEntries.push({
          'Nome Release': `Red Hat Enterprise Linux ${v0}`,
          'Versione': v0,
          'Codename': codename,
          'Data Rilascio': date,
          'End Of Support': item.eol || 'N/A'
        });
      }
    }
  }

  if (!newEntries.length) {
    console.log('rhel: no new releases');
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
  console.log(`rhel: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('rhel:', err.message); process.exit(1); });
