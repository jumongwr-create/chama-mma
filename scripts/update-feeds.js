const Parser = require('rss-parser');
const fs = require('fs');
const { formatDistanceToNow } = require('date-fns');

const parser = new Parser({
  timeout: 15000,
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
    id: 'ufc',
    name: 'UFC',
    url: 'https://www.ufc.com/rss/news',
    site: 'https://www.ufc.com/',
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
  },
  {
    id: 'bloodyelbow',
    name: 'Bloody Elbow',
    url: 'https://bloodyelbow.com/feed/',
    site: 'https://bloodyelbow.com/',
    limit: 5
  }
];

async function fetchFeed(feedConfig) {
  try {
    console.log(`Fetching ${feedConfig.name}...`);
    const feed = await parser.parseURL(feedConfig.url);

    const items = (feed.items || [])
      .slice(0, feedConfig.limit)
      .map(item => {
        let published = item.isoDate || item.pubDate;
        let relative = '';

        if (published) {
          try {
            relative = formatDistanceToNow(new Date(published), { addSuffix: true });
          } catch (e) {
            relative = '';
          }
        }

        return {
          title: (item.title || 'Untitled').trim(),
          link: item.link || item.guid || '#',
          date: published || null,
          relative,
          image: item.enclosure?.url || item['media:content']?.$?.url || null
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
