/**
 * update-rankings.js
 * Scrapes current UFC rankings from Wikipedia (reliable, free, no API key)
 * and writes rankings.json for the CHAMA site.
 *
 * Run by the existing GitHub Action every 30 minutes.
 */

const https = require('https');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const WIKI_URL = 'https://en.wikipedia.org/wiki/UFC_rankings';
const OUTPUT = 'rankings.json';

const PREFERRED_ORDER = [
  "Men's pound-for-pound",
  "Women's pound-for-pound",
  "Heavyweight",
  "Light Heavyweight",
  "Middleweight",
  "Welterweight",
  "Lightweight",
  "Featherweight",
  "Bantamweight",
  "Flyweight",
  "Women's Bantamweight",
  "Women's Flyweight",
  "Women's Strawweight"
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CHAMA-RankingsBot/1.0; +https://github.com/jumongwr-create/chama-mma)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 20000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function parseRankings(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const tables = doc.querySelectorAll('table.wikitable');
  const raw = {};

  tables.forEach(table => {
    let el = table.previousElementSibling;
    let title = '';
    while (el) {
      if (/^H[2-4]$/i.test(el.tagName)) {
        title = el.textContent.replace(/\[.*?\]/g, '').trim();
        break;
      }
      el = el.previousElementSibling;
    }
    if (!title || /legend|contents/i.test(title)) return;

    const fighters = [];
    const rows = table.querySelectorAll('tr');

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;

      let rank = (cells[0].textContent || '').trim();
      if (!rank || /^(rank|result|iso|fighter|record|m|win streak)$/i.test(rank)) return;

      if (/^c$/i.test(rank)) rank = 'C';
      else if (/^ic$|^interim$/i.test(rank)) rank = 'IC';

      let name = null;
      for (const idx of [2, 1, 3]) {
        if (idx >= cells.length) continue;
        const a = cells[idx].querySelector('a');
        if (a) {
          const n = a.textContent.trim();
          if (n && n.length > 2 && !n.startsWith('[')) {
            name = n;
            break;
          }
        } else {
          const t = cells[idx].textContent.trim();
          if (t && t.length > 3 && !/^[\d\-–NCWinLoss\s\(\)]+$/.test(t)) {
            name = t;
            break;
          }
        }
      }
      if (!name) return;

      fighters.push({ rank: rank || 'C', name });
    });

    if (fighters.length >= 5) {
      const key = title.toLowerCase();
      if (!raw[key]) {
        raw[key] = {
          name: title,
          fighters: fighters.slice(0, 15)
        };
      }
    }
  });

  const divisions = [];
  for (const preferred of PREFERRED_ORDER) {
    const key = preferred.toLowerCase();
    if (raw[key]) {
      divisions.push(raw[key]);
      delete raw[key];
    }
  }
  Object.values(raw).forEach(d => divisions.push(d));

  return divisions;
}

async function main() {
  console.log('Fetching UFC rankings from Wikipedia...');
  const html = await fetch(WIKI_URL);
  const divisions = parseRankings(html);

  if (divisions.length < 5) {
    throw new Error(`Only found ${divisions.length} divisions – page structure may have changed`);
  }

  const payload = {
    updated: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    source: 'Wikipedia (based on official UFC rankings)',
    sourceUrl: WIKI_URL,
    divisions
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${OUTPUT} with ${divisions.length} divisions`);
  divisions.forEach(d => {
    const top = d.fighters[0];
    console.log(`  ${d.name}: ${top.rank} ${top.name} (+${d.fighters.length - 1} more)`);
  });
}

main().catch(err => {
  console.error('Rankings update failed:', err.message);
  process.exit(1);
});
