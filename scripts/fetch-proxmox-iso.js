#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ISO_BASE = 'https://enterprise.proxmox.com/iso/';
const SHA256SUMS_URL = `${ISO_BASE}SHA256SUMS`;
const DOWNLOADS_DIR = path.resolve(__dirname, '../v1/proxmox/downloads');

// ISO filename → product config
const PRODUCTS = {
  pve: {
    pattern: /^proxmox-ve_([\d.]+-[\d]+)\.iso$/,
    file: 'pve.json',
    label: ver => `Proxmox VE ${ver.replace(/-\d+$/, '')} ISO`,
    nameKey: 'pve'
  },
  pbs: {
    pattern: /^proxmox-backup-server_([\d.]+-[\d]+)\.iso$/,
    file: 'pbs.json',
    label: ver => `Proxmox Backup Server ${ver.replace(/-\d+$/, '')} ISO`,
    nameKey: 'pbs'
  },
  pdm: {
    pattern: /^proxmox-datacenter-manager_([\d.]+-[\d]+)\.iso$/,
    file: 'pdm.json',
    label: ver => `Proxmox Datacenter Manager ${ver.replace(/-\d+$/, '')} ISO`,
    nameKey: 'pdm'
  }
};

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return 'N/A';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function extractRelease(versione) {
  // "9.2-1" → "9.2"
  return versione.replace(/-\d+$/, '');
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function headRequest(url) {
  const res = await fetch(url, {
    method: 'HEAD',
    headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' }
  });
  return res;
}

async function main() {
  // 1. Fetch SHA256SUMS
  const sha256Text = await fetchText(SHA256SUMS_URL);
  // Format: "<hash>  <filename>"
  const checksums = {};
  for (const line of sha256Text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+(.+\.iso)$/i);
    if (m) checksums[m[2]] = m[1];
  }

  // 2. Group by product
  const byProduct = { pve: [], pbs: [], pdm: [] };
  for (const [filename, sha256] of Object.entries(checksums)) {
    for (const [key, prod] of Object.entries(PRODUCTS)) {
      const m = filename.match(prod.pattern);
      if (m) {
        byProduct[key].push({ filename, versione: m[1], sha256 });
        break;
      }
    }
  }

  // 3. For each product, get metadata via HEAD and update JSON
  let totalAdded = 0;

  for (const [key, isos] of Object.entries(byProduct)) {
    if (!isos.length) continue;

    const prod = PRODUCTS[key];
    const outFile = path.join(DOWNLOADS_DIR, prod.file);
    const current = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    const existingVersions = new Set(current.map(r => r['versione']));

    const newEntries = [];
    for (const iso of isos) {
      if (existingVersions.has(iso.versione)) continue;

      const isoUrl = `${ISO_BASE}${iso.filename}`;
      let size = 'N/A';
      let date = null;

      try {
        const headRes = await headRequest(isoUrl);
        const cl = headRes.headers.get('content-length');
        if (cl) size = formatBytes(parseInt(cl, 10));
        const lm = headRes.headers.get('last-modified');
        if (lm) {
          const d = new Date(lm);
          if (!isNaN(d)) {
            date = d.toISOString().slice(0, 10);
          }
        }
      } catch (e) {
        console.warn(`HEAD ${iso.filename}: ${e.message}`);
      }

      const release = extractRelease(iso.versione);
      newEntries.push({
        nome: prod.label(iso.versione),
        release,
        versione: iso.versione,
        tipo: 'ISO',
        dimensione_file: size,
        data_ultimo_aggiornamento: date || new Date().toISOString().slice(0, 10),
        sha256sum: iso.sha256,
        link: isoUrl
      });
    }

    if (!newEntries.length) continue;

    // Sort: newest release first (by versione descending)
    const merged = [...newEntries, ...current];
    merged.sort((a, b) => {
      const av = a.versione.split(/[-.]/).map(Number);
      const bv = b.versione.split(/[-.]/).map(Number);
      for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const diff = (bv[i] || 0) - (av[i] || 0);
        if (diff) return diff;
      }
      return 0;
    });
    const seen = new Set();
    const deduped = merged.filter(r => {
      if (seen.has(r.versione)) return false;
      seen.add(r.versione);
      return true;
    });

    fs.writeFileSync(outFile, JSON.stringify(deduped, null, 2));
    totalAdded += newEntries.length;
    console.log(`proxmox-iso/${key}: added ${newEntries.map(r => r.versione).join(', ')}`);
  }

  if (!totalAdded) console.log('proxmox-iso: no new ISOs');
}

main().catch(err => { console.error('proxmox-iso:', err.message); process.exit(1); });
