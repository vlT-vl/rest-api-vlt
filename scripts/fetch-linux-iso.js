#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LINUX_DIR = path.resolve(__dirname, '../v1/linux');

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function headRequest(url) {
  return fetch(url, {
    method: 'HEAD',
    headers: { 'User-Agent': 'Mozilla/5.0 rest-api-vlt/1.0' }
  });
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return 'N/A';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

function parseDate(headerVal) {
  if (!headerVal) return null;
  const d = new Date(headerVal);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

async function headMeta(url) {
  try {
    const r = await headRequest(url);
    const cl = r.headers.get('content-length');
    const lm = r.headers.get('last-modified');
    return { size: cl ? formatBytes(parseInt(cl, 10)) : 'N/A', date: parseDate(lm) };
  } catch (e) {
    console.warn(`HEAD ${url}: ${e.message}`);
    return { size: 'N/A', date: null };
  }
}

function sortDesc(arr) {
  return arr.sort((a, b) => {
    const av = String(a.versione).split(/[-.]/).map(Number);
    const bv = String(b.versione).split(/[-.]/).map(Number);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const diff = (bv[i] || 0) - (av[i] || 0);
      if (diff) return diff;
    }
    return 0;
  });
}

function mergeAndSave(file, current, newEntries) {
  const existingVersions = new Set(current.map(r => r.versione));
  const toAdd = newEntries.filter(e => !existingVersions.has(e.versione));
  if (!toAdd.length) return false;
  const merged = sortDesc([...toAdd, ...current]);
  const seen = new Set();
  const deduped = merged.filter(r => {
    if (seen.has(r.versione)) return false;
    seen.add(r.versione);
    return true;
  });
  fs.writeFileSync(file, JSON.stringify(deduped, null, 2));
  return toAdd.length;
}

// ── Debian ──────────────────────────────────────────────────────────────────────
async function fetchDebian() {
  const FILE = path.join(LINUX_DIR, 'debian/downloads.json');
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const entries = [];

  // current = latest stable, current-oldstable = previous stable
  for (const slot of ['current', 'current-oldstable']) {
    const sha256url = `https://cdimage.debian.org/debian-cd/${slot}/amd64/iso-cd/SHA256SUMS`;
    try {
      const text = await fetchText(sha256url);
      for (const line of text.split('\n')) {
        const m = line.trim().match(/^([0-9a-f]{64})\s+(debian-([\d.]+)-amd64-netinst\.iso)$/i);
        if (!m) continue;
        const [, sha256, filename, versione] = m;
        const release = versione.split('.')[0];
        const isoUrl = `https://cdimage.debian.org/debian-cd/${versione}/amd64/iso-cd/${filename}`;
        const { size, date } = await headMeta(isoUrl);
        entries.push({
          nome: `Debian ${versione} Netinst`,
          release, versione, tipo: 'ISO',
          dimensione_file: size,
          data_ultimo_aggiornamento: date || new Date().toISOString().slice(0, 10),
          sha256sum: sha256, link: isoUrl
        });
        break;
      }
    } catch (e) {
      console.warn(`debian-iso [${slot}]: ${e.message}`);
    }
  }

  const added = mergeAndSave(FILE, current, entries);
  console.log(added ? `debian-iso: +${added} entries` : 'debian-iso: no new ISOs');
}

// ── Ubuntu ──────────────────────────────────────────────────────────────────────
function getUbuntuLts(count = 3) {
  const year = new Date().getFullYear();
  const base = year % 2 === 0 ? year : year - 1;
  const lts = [];
  for (let y = base; lts.length < count; y -= 2) lts.push(`${y}.04`);
  return lts;
}

async function fetchUbuntu() {
  const FILE = path.join(LINUX_DIR, 'ubuntu/downloads.json');
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const entries = [];

  for (const lts of getUbuntuLts()) {
    try {
      const sha256url = `https://releases.ubuntu.com/${lts}/SHA256SUMS`;
      const text = await fetchText(sha256url);
      for (const line of text.split('\n')) {
        const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(ubuntu-([\d.]+)-live-server-amd64\.iso)$/i);
        if (!m) continue;
        const [, sha256, filename, versione] = m;
        const isoUrl = `https://releases.ubuntu.com/${lts}/${filename}`;
        const { size, date } = await headMeta(isoUrl);
        entries.push({
          nome: `Ubuntu ${versione} LTS Server`,
          release: lts, versione, tipo: 'ISO',
          dimensione_file: size,
          data_ultimo_aggiornamento: date || new Date().toISOString().slice(0, 10),
          sha256sum: sha256, link: isoUrl
        });
        break;
      }
    } catch (e) {
      console.warn(`ubuntu-iso [${lts}]: ${e.message}`);
    }
  }

  const added = mergeAndSave(FILE, current, entries);
  console.log(added ? `ubuntu-iso: +${added} entries` : 'ubuntu-iso: no new ISOs');
}

// ── Rocky Linux ─────────────────────────────────────────────────────────────────
const ROCKY_MAJORS = ['10', '9', '8'];

async function fetchRocky() {
  const FILE = path.join(LINUX_DIR, 'rocky/downloads.json');
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const entries = [];

  for (const major of ROCKY_MAJORS) {
    const checkUrl = `https://download.rockylinux.org/pub/rocky/${major}/isos/x86_64/CHECKSUM`;
    try {
      const text = await fetchText(checkUrl);
      // Prefer dvd (full installer), then dvd1 for Rocky 8, then minimal
      const patterns = [
        /SHA256 \((Rocky-([\d.]+)-x86_64-dvd\.iso)\) = ([0-9a-f]{64})/i,
        /SHA256 \((Rocky-([\d.]+)-x86_64-dvd1\.iso)\) = ([0-9a-f]{64})/i,
        /SHA256 \((Rocky-([\d.]+)-x86_64-minimal\.iso)\) = ([0-9a-f]{64})/i
      ];
      for (const pat of patterns) {
        const m = text.match(pat);
        if (!m) continue;
        const [, filename, versione, sha256] = m;
        const isoUrl = `https://download.rockylinux.org/pub/rocky/${major}/isos/x86_64/${filename}`;
        const { size, date } = await headMeta(isoUrl);
        const variant = filename.includes('dvd1') ? 'DVD' : filename.includes('dvd') ? 'DVD' : 'Minimal';
        entries.push({
          nome: `Rocky Linux ${versione} ${variant}`,
          release: major, versione, tipo: 'ISO',
          dimensione_file: size,
          data_ultimo_aggiornamento: date || new Date().toISOString().slice(0, 10),
          sha256sum: sha256, link: isoUrl
        });
        break;
      }
    } catch (e) {
      console.warn(`rocky-iso [${major}]: ${e.message}`);
    }
  }

  const added = mergeAndSave(FILE, current, entries);
  console.log(added ? `rocky-iso: +${added} entries` : 'rocky-iso: no new ISOs');
}

// ── Fedora ──────────────────────────────────────────────────────────────────────
async function fetchFedora() {
  const FILE = path.join(LINUX_DIR, 'fedora/downloads.json');
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const entries = [];

  try {
    const indexHtml = await fetchText('https://dl.fedoraproject.org/pub/fedora/linux/releases/');
    const versions = [...indexHtml.matchAll(/href="(\d{2,3})\/"/g)]
      .map(m => parseInt(m[1], 10))
      .filter(v => v >= 38)
      .sort((a, b) => b - a)
      .slice(0, 3);

    for (const ver of versions) {
      const isoDir = `https://dl.fedoraproject.org/pub/fedora/linux/releases/${ver}/Server/x86_64/iso/`;
      try {
        const dirHtml = await fetchText(isoDir);
        const checksumFile = (dirHtml.match(/href="([^"]*CHECKSUM[^"]*)"/i) || [])[1];
        if (!checksumFile) continue;
        const checkText = await fetchText(`${isoDir}${checksumFile}`);
        for (const line of checkText.split('\n')) {
          const m = line.trim().match(/SHA256 \((Fedora-Server-netinst-x86_64-(\d+)-[\d.]+\.iso)\) = ([0-9a-f]{64})/i);
          if (!m) continue;
          const [, filename, versione, sha256] = m;
          const isoUrl = `${isoDir}${filename}`;
          const { size, date } = await headMeta(isoUrl);
          entries.push({
            nome: `Fedora ${versione} Server Netinst`,
            release: versione, versione, tipo: 'ISO',
            dimensione_file: size,
            data_ultimo_aggiornamento: date || new Date().toISOString().slice(0, 10),
            sha256sum: sha256, link: isoUrl
          });
          break;
        }
      } catch (e) {
        console.warn(`fedora-iso [${ver}]: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`fedora-iso index: ${e.message}`);
  }

  const added = mergeAndSave(FILE, current, entries);
  console.log(added ? `fedora-iso: +${added} entries` : 'fedora-iso: no new ISOs');
}

async function main() {
  const results = await Promise.allSettled([
    fetchDebian(),
    fetchUbuntu(),
    fetchRocky(),
    fetchFedora()
  ]);
  results.forEach(r => { if (r.status === 'rejected') console.error('linux-iso:', r.reason?.message); });
}

main().catch(err => { console.error('linux-iso:', err.message); process.exit(1); });
