/**
 * update-rankings.js
 * Scrapes current UFC rankings from Wikipedia (Meta rankings + media P4P)
 * and writes rankings.json for the CHAMA site.
 *
 * Run by the existing GitHub Action every 30 minutes.
 */

const https = require('https');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const WIKI_URL = 'https://en.wikipedia.org/wiki/UFC_rankings';
const OUTPUT = 'rankings.json';

// Preferred display order on the site
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

/**
 * Extract clean fighter name from a table cell.
 * Prefers the first meaningful <a> that looks like a person name.
 */
function extractName(cell) {
  if (!cell) return null;

  // Prefer links that point to fighter articles
  const links = cell.querySelectorAll('a');
  for (const a of links) {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const text = (a.textContent || '').trim();

    // Skip flags, citations, events, weight classes, etc.
    if (!text || text.length < 3) continue;
    if (text.startsWith('[')) continue;
    if (/^(ufc|fight night|tbd|win|loss|nc|draw)/i.test(text)) continue;
    if (href.includes('file:') || href.includes('flag') || href.includes('cite_note')) continue;
    if (/^\d+$/.test(text)) continue;

    // Good enough
    if (text.length > 2) return text;
  }

  // Fallback to plain text
  const plain = (cell.textContent || '').trim()
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain && plain.length > 3 && !/^[\d\-–NCWinLoss\s\(\)\+]+$/.test(plain)) {
    return plain;
  }
  return null;
}

/**
 * Normalize rank cell: "C", "IC", "1", "7 (T)", etc.
 */
function normalizeRank(raw) {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();

  if (t === 'C' || t === 'CHAMPION') return 'C';
  if (t === 'IC' || t === 'INTERIM' || t.startsWith('IC')) return 'IC';

  // "7 (T)" or "7(T)" → keep the number part
  const m = t.match(/^(\d+)/);
  if (m) return m[1];

  return null;
}

function parseTable(table) {
  const fighters = [];
  const rows = table.querySelectorAll('tr');

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) continue;

    const rankRaw = (cells[0].textContent || '').trim();
    const rank = normalizeRank(rankRaw);
    if (!rank) continue; // skip header / junk rows

    // Fighter name is usually in column index 2 (Rank | ISO | Fighter | ...)
    // Sometimes layout varies slightly – try a few spots
    let name = null;
    for (const idx of [2, 1, 3]) {
      if (idx >= cells.length) continue;
      name = extractName(cells[idx]);
      if (name) break;
    }
    if (!name) continue;

    fighters.push({ rank, name });
  }

  // Keep only first 15 (champion + top 15 is more than enough)
  return fighters.slice(0, 16);
}

function parseRankings(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Map of normalized title → { name, fighters }
  const raw = {};

  // Walk all headings that could introduce a rankings table
  const headings = doc.querySelectorAll('h2, h3, h4');

  for (const heading of headings) {
    let title = (heading.textContent || '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!title) continue;

    // Skip pure section wrappers
    if (/^men's meta rankings$/i.test(title)) continue;
    if (/^women's meta rankings$/i.test(title)) continue;
    if (/^men's media rankings$/i.test(title)) continue;
    if (/^women's media rankings$/i.test(title)) continue;
    if (/legend|contents|see also|references|external/i.test(title)) continue;

    // We care about:
    // - Weight classes under Meta (Heavyweight, Women's Bantamweight, ...)
    // - Pound-for-pound under media rankings
    const isP4P = /pound-for-pound/i.test(title);
    const isWeightClass = /heavyweight|light heavyweight|middleweight|welterweight|lightweight|featherweight|bantamweight|flyweight|strawweight/i.test(title);

    if (!isP4P && !isWeightClass) continue;

    // Normalize title a bit for consistency
    if (/men's pound-for-pound/i.test(title)) title = "Men's pound-for-pound";
    if (/women's pound-for-pound/i.test(title)) title = "Women's pound-for-pound";

    // Find the next wikitable after this heading
    let el = heading.nextElementSibling;
    let table = null;
    let safety = 0;
    while (el && safety < 12) {
      if (el.tagName === 'TABLE' && el.classList.contains('wikitable')) {
        table = el;
        break;
      }
      // Sometimes there is a paragraph (weight limit / release date) in between
      el = el.nextElementSibling;
      safety++;
    }

    if (!table) continue;

    const fighters = parseTable(table);
    if (fighters.length < 5) continue; // too few → probably not a real rankings table

    const key = title.toLowerCase();
    // Prefer Meta tables when both Meta and media versions exist for the same division.
    // We process the page top-to-bottom, so Meta appears first.
    if (!raw[key]) {
      raw[key] = {
        name: title,
        fighters
      };
    }
  }

  // Build final ordered list
  const divisions = [];
  const used = new Set();

  for (const preferred of PREFERRED_ORDER) {
    const key = preferred.toLowerCase();
    if (raw[key]) {
      divisions.push(raw[key]);
      used.add(key);
    }
  }

  // Append any remaining divisions we found
  for (const [key, div] of Object.entries(raw)) {
    if (!used.has(key)) {
      divisions.push(div);
    }
  }

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
    source: 'Wikipedia (Meta UFC Rankings + media P4P)',
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
