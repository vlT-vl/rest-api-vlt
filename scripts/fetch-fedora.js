#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '../v1/linux/fedora/releases.json');

// Fedora named releases (F1-F20 had codenames; F21+ are "N/A")
const LEGACY_CODENAMES = {
  '20': 'Heisenbug', '19': "Schrödinger's Cat", '18': 'Spherical Cow',
  '17': 'Beefy Miracle', '16': 'Verne', '15': 'Lovelock', '14': 'Laughlin',
  '13': 'Goddard', '12': 'Constantine', '11': 'Leonidas', '10': 'Cambridge',
  '9': 'Sulphur', '8': 'Werewolf', '7': 'Moonshine', '6': 'Zod',
  '5': 'Bordeaux', '4': 'Stentz', '3': 'Heidelberg', '2': 'Tettnang', '1': 'Yarrow'
};

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function versionDesc(a, b) {
  return Number(b['Versione']) - Number(a['Versione']);
}

function releaseLabel(ver) {
  return Number(ver) >= 21 ? 'Fedora Linux' : 'Fedora Core';
}

async function main() {
  const current = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const existing = new Set(current.map(r => r['Versione']));

  const eolData = await get('https://endoflife.date/api/fedora.json');
  const newEntries = [];

  for (const item of eolData) {
    const ver = String(item.cycle);
    if (existing.has(ver)) continue;
    if (!item.releaseDate) continue;

    const codename = LEGACY_CODENAMES[ver] || 'N/A';
    const label = releaseLabel(ver);

    newEntries.push({
      'Nome Release': `${label} ${ver}`,
      'Versione': ver,
      'Codename': codename,
      'Data Rilascio': item.releaseDate,
      'End Of Support': item.eol || 'N/A'
    });
  }

  if (!newEntries.length) {
    console.log('fedora: no new releases');
    return;
  }

  const merged = [...newEntries, ...current].sort(versionDesc);
  const seen = new Set();
  const deduped = merged.filter(r => {
    if (seen.has(r['Versione'])) return false;
    seen.add(r['Versione']);
    return true;
  });

  fs.writeFileSync(OUTPUT, JSON.stringify(deduped, null, 2));
  console.log(`fedora: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('fedora:', err.message); process.exit(1); });
