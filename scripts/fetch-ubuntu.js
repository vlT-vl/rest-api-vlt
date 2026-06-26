#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '../v1/linux/ubuntu/releases.json');

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

  // EoS dates from endoflife.date
  const eolData = await get('https://endoflife.date/api/ubuntu.json');
  const eolMap = {};
  for (const item of eolData) {
    const ver = item.cycle.replace(' LTS', '').trim();
    eolMap[ver] = { releaseDate: item.releaseDate, eol: item.eol };
  }

  // Codenames from Launchpad
  const lpData = await get('https://api.launchpad.net/1.0/ubuntu/series?ws.size=100&ws.orderby=-version');
  const codenameMap = {};
  for (const entry of lpData.entries || []) {
    if (entry.version && entry.title) {
      codenameMap[entry.version] = entry.title;
    }
  }

  const newEntries = [];
  for (const [ver, data] of Object.entries(eolMap)) {
    if (existing.has(ver)) continue;
    if (!data.releaseDate) continue;

    const codename = codenameMap[ver] || 'N/A';
    newEntries.push({
      'Nome Release': `Ubuntu ${ver}`,
      'Versione': ver,
      'Codename': codename,
      'Data Rilascio': data.releaseDate,
      'End Of Support': data.eol || 'N/A'
    });
  }

  if (!newEntries.length) {
    console.log('ubuntu: no new releases');
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
  console.log(`ubuntu: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('ubuntu:', err.message); process.exit(1); });
