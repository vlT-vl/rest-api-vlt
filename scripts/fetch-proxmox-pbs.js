#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEARCH_URL = 'https://git.proxmox.com/?p=proxmox-backup.git;a=search;s=bump+version+to;st=commit';
const OUTPUT = path.resolve(__dirname, '../v1/proxmox/pbs/releases.json');

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

function semverDesc(a, b) {
  const av = a['Versione'].split('.').map(Number);
  const bv = b['Versione'].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (bv[i] !== av[i]) return bv[i] - av[i];
  }
  return 0;
}

function parseCommitRows(html) {
  const results = [];
  const rowRe = /<tr[^>]*class="(?:light|dark)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const subjectMatch = rowHtml.match(/class="subject"[^>]*>([\s\S]*?)<\/td>/i)
      || rowHtml.match(/class="title"[^>]*>([\s\S]*?)<\/td>/i)
      || rowHtml.match(/<td[^>]*>([\s\S]*?bump version to[\s\S]*?)<\/td>/i);
    if (!subjectMatch) continue;
    const subject = stripTags(subjectMatch[1]);
    const verMatch = subject.match(/bump version to\s+([\d]+\.[\d]+\.[\d]+)/i);
    if (!verMatch) continue;
    const version = verMatch[1];

    const dateMatch = rowHtml.match(/<i>(\d{4}-\d{2}-\d{2})<\/i>/)
      || rowHtml.match(/title="(\d{4}-\d{2}-\d{2})\s/)
      || rowHtml.match(/datetime="(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : null;

    results.push({ version, date });
  }
  return results;
}

async function main() {
  const current = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const existing = new Set(current.map(r => r['Versione']));

  const res = await fetch(SEARCH_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0', Accept: 'text/html' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${SEARCH_URL}`);
  const html = await res.text();

  const commits = parseCommitRows(html);
  const newEntries = [];

  for (const { version, date } of commits) {
    if (existing.has(version)) continue;
    newEntries.push({
      'Nome Release': `Proxmox Backup Server ${version}`,
      'Versione': version,
      'Codename': `pbs-${version}`,
      'Data Rilascio': date || new Date().toISOString().slice(0, 10),
      'End Of Support': 'Attualmente in supporto'
    });
  }

  if (!newEntries.length) {
    console.log('proxmox-pbs: no new releases');
    return;
  }

  const merged = [...newEntries, ...current].sort(semverDesc);
  const seen = new Set();
  const deduped = merged.filter(r => {
    if (seen.has(r['Versione'])) return false;
    seen.add(r['Versione']);
    return true;
  });

  fs.writeFileSync(OUTPUT, JSON.stringify(deduped, null, 3));
  console.log(`proxmox-pbs: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('proxmox-pbs:', err.message); process.exit(1); });
