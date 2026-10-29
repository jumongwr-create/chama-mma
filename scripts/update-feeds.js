const Parser = require('rss-parser');
const fs = require('fs');
const { formatDistanceToNow } = require('date-fns');

const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
      ['description', 'description']
    ]
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/',
    'Cache-Control': 'no-cache'
  }
});

const FEEDS = [
  {
    id: 'bloodyelbow',
    name: 'Bloody Elbow',
    url: 'https://bloodyelbow.com/feed/',
    site: 'https://bloodyelbow.com/',
    limit: 6
  },
  {
    id: 'mmafighting',
    name: 'MMA Fighting',
    url: 'https://www.mmafighting.com/rss/current.xml',
    site: 'https://www.mmafighting.com/',
    limit: 6
  },
  {
    id: 'sherdog',
    name: 'Sherdog',
    url: 'https://www.sherdog.com/rss/news.xml',
    site: 'https://www.sherdog.com/',
    limit: 5
  }
];

function extractImage(item) {
  if (item.enclosure?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(item.enclosure.url)) {
    return item.enclosure.url;
  }
  if (item.mediaContent) {
    const arr = Array.isArray(item.mediaContent) ? item.mediaContent : [item.mediaContent];
    for (const m of arr) {
      const url = m?.$?.url || m?.url;
      if (url && /\.(jpg|jpeg|png|webp|gif)/i.test(url)) return url;
    }
  }
  if (item.mediaThumbnail) {
    const arr = Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail : [item.mediaThumbnail];
    for (const m of arr) {
      const url = m?.$?.url || m?.url;
      if (url) return url;
    }
  }
  const htmlSources = [
    item.contentEncoded, item['content:encoded'], item.content,
    item.description, item.summary, item.contentSnippet
  ].filter(Boolean);
  for (const html of htmlSources) {
    const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1]) {
      let src = match[1].replace(/&amp;/g, '&').replace(/&#038;/g, '&').trim();
      if (src && !/pixel|1x1|spacer|blank|logo-small/i.test(src)) return src;
    }
  }
  return null;
}

// Hard timeout wrapper so one slow feed can never hang the job
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    )
  ]);
}

async function fetchFeed(feedConfig) {
  try {
    console.log(`Fetching ${feedConfig.name}...`);
    const feed = await withTimeout(
      parser.parseURL(feedConfig.url),
      12000,
      feedConfig.name
    );

    const items = (feed.items || [])
      .slice(0, feedConfig.limit)
      .map(item => {
        let published = item.isoDate || item.pubDate;
        let relative = '';
        if (published) {
          try {
            relative = formatDistanceToNow(new Date(published), { addSuffix: true });
          } catch (e) {}
        }
        return {
          title: (item.title || 'Untitled').trim(),
          link: item.link || item.guid || '#',
          date: published || null,
          relative,
          image: extractImage(item)
        };
      });

    console.log(`  → ${items.length} items`);
    return {
      id: feedConfig.id,
      name: feedConfig.name,
      site: feedConfig.site,
      updated: new Date().toISOString(),
      items
    };
  } catch (err) {
    console.error(`  ✗ Failed ${feedConfig.name}: ${err.message}`);
    return {
      id: feedConfig.id,
      name: feedConfig.name,
      site: feedConfig.site,
      updated: new Date().toISOString(),
      items: [],
      error: err.message
    };
  }
}

async function main() {
  console.log('Fetching feeds...\n');
  const results = await Promise.all(FEEDS.map(fetchFeed));

  const output = {
    generatedAt: new Date().toISOString(),
    sources: results
  };

  fs.writeFileSync('feeds.json', JSON.stringify(output, null, 2));
  console.log('\nfeeds.json written successfully\n');
  results.forEach(r => {
    const status = r.error ? `ERROR: ${r.error}` : `${r.items.length} items`;
    console.log(`${r.name.padEnd(16)} ${status}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
