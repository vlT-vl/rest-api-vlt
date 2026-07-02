#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUT_FILE = path.resolve(__dirname, '../v1/kubernetes/downloads.json');
const K8S_STABLE_URL = 'https://dl.k8s.io/release/stable.txt';
const K8S_RELEASES_FILE = path.resolve(__dirname, '../v1/kubernetes/releases.json');
const DOWNLOAD_BASE = 'https://dl.k8s.io/release';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return 'N/A';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function semverMinor(v) {
  const [, major, minor] = v.replace(/^v/, '').split('.');
  return `${major}.${minor}`;
}

async function main() {
  // Load existing releases to find the latest patch for each of the 3 most recent minor versions
  const releases = JSON.parse(fs.readFileSync(K8S_RELEASES_FILE, 'utf8'));
  const current = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));

  // Group by minor version, pick latest patch
  const byMinor = {};
  for (const rel of releases) {
    const minor = semverMinor(rel['Versione']);
    if (!byMinor[minor]) byMinor[minor] = rel;
  }

  // Sort minor versions descending, take top 3
  const top3 = Object.keys(byMinor)
    .sort((a, b) => {
      const av = a.split('.').map(Number);
      const bv = b.split('.').map(Number);
      for (let i = 0; i < 2; i++) {
        if (bv[i] !== av[i]) return bv[i] - av[i];
      }
      return 0;
    })
    .slice(0, 3);

  const existingVersions = new Set(current.map(r => r.versione));
  const newEntries = [];

  for (const minor of top3) {
    const rel = byMinor[minor];
    const versione = rel['Versione'];
    if (existingVersions.has(versione)) continue;

    const isoUrl = `${DOWNLOAD_BASE}/v${versione}/bin/linux/amd64/kubectl`;
    const shaUrl = `${DOWNLOAD_BASE}/v${versione}/bin/linux/amd64/kubectl.sha256`;

    let size = 'N/A';
    let sha256 = null;
    let date = rel['Data Rilascio'] || new Date().toISOString().slice(0, 10);

    try {
      const res = await fetch(isoUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' }
      });
      const cl = res.headers.get('content-length');
      if (cl) size = formatBytes(parseInt(cl, 10));
      const lm = res.headers.get('last-modified');
      if (lm) { const d = new Date(lm); if (!isNaN(d)) date = d.toISOString().slice(0, 10); }
    } catch (e) {
      console.warn(`HEAD kubectl v${versione}: ${e.message}`);
    }

    try {
      sha256 = (await fetchText(shaUrl)).trim();
    } catch (e) {
      console.warn(`SHA256 kubectl v${versione}: ${e.message}`);
    }

    newEntries.push({
      nome: `kubectl v${versione} (linux/amd64)`,
      release: minor,
      versione,
      tipo: 'Binary',
      dimensione_file: size,
      data_ultimo_aggiornamento: date,
      sha256sum: sha256,
      link: isoUrl
    });
  }

  if (!newEntries.length) {
    console.log('kubernetes-downloads: no new entries');
    return;
  }

  const merged = [...newEntries, ...current];
  merged.sort((a, b) => {
    const av = a.versione.split('.').map(Number);
    const bv = b.versione.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (bv[i] !== av[i]) return (bv[i] || 0) - (av[i] || 0);
    }
    return 0;
  });

  const seen = new Set();
  const deduped = merged.filter(r => {
    if (seen.has(r.versione)) return false;
    seen.add(r.versione);
    return true;
  });

  // Keep only top 3 minor versions
  const keptMinors = new Set();
  const trimmed = deduped.filter(r => {
    const m = semverMinor(r.versione);
    if (keptMinors.size < 3 || keptMinors.has(m)) {
      keptMinors.add(m);
      return true;
    }
    return false;
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(trimmed, null, 2));
  console.log(`kubernetes-downloads: +${newEntries.length} entries`);
}

main().catch(err => { console.error('kubernetes-downloads:', err.message); process.exit(1); });
