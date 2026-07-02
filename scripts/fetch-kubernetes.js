#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUTPUT = path.resolve(__dirname, '../v1/kubernetes/releases.json');

async function get(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'rest-api-vlt/1.0', ...headers }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function semverDesc(a, b) {
  const av = a['Versione'].split('.').map(Number);
  const bv = b['Versione'].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (bv[i] !== av[i]) return bv[i] - av[i];
  }
  return 0;
}

async function main() {
  const current = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const existing = new Set(current.map(r => r['Versione']));

  // EoS dates per minor version
  const eolData = await get('https://endoflife.date/api/kubernetes.json');
  const eolMap = {};
  for (const item of eolData) {
    eolMap[item.cycle] = item.eol || 'N/A';
  }

  // All patch releases from GitHub API
  const authHeader = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const newEntries = [];

  for (let page = 1; page <= 10; page++) {
    const releases = await get(
      `https://api.github.com/repos/kubernetes/kubernetes/releases?per_page=100&page=${page}`,
      authHeader
    );
    if (!releases.length) break;

    for (const rel of releases) {
      if (rel.prerelease || rel.draft) continue;
      if (!/^v\d+\.\d+\.\d+$/.test(rel.tag_name)) continue;

      const version = rel.tag_name.slice(1);
      if (existing.has(version)) continue;

      const minor = version.split('.').slice(0, 2).join('.');
      const eos = eolMap[minor] || 'N/A';
      const date = rel.published_at.slice(0, 10);

      newEntries.push({
        'Nome Release': `Kubernetes ${version}`,
        'Versione': version,
        'Codename': `k8s-${version}`,
        'Data Rilascio': date,
        'End Of Support': eos
      });
    }
  }

  if (!newEntries.length) {
    console.log('kubernetes: no new releases');
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
  console.log(`kubernetes: added ${newEntries.map(r => r['Versione']).join(', ')}`);
}

main().catch(err => { console.error('kubernetes:', err.message); process.exit(1); });
