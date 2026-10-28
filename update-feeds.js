const Parser = require('rss-parser');
const fs = require('fs');
const { formatDistanceToNow, parseISO } = require('date-fns');

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'CHAMA-MMA-Feed-Bot/1.0'
  }
});

const FEEDS = [
  {
    id: 'ufc',
    name: 'UFC',
    url: 'https://www.ufc.com/rss/news',
    site: 'https://www.ufc.com/',
    limit: 5
  },
  {
    id: 'mmafighting',
    name: 'MMA Fighting',
    url: 'https://www.mmafighting.com/rss/current.xml',
    site: 'https://www.mmafighting.com/',
    limit: 5
  },
  {
    id: 'sherdog',
    name: 'Sherdog',
    url: 'https://www.sherdog.com/rss/news.xml',
    site: 'https://www.sherdog.com/',
    limit: 5
  }
  // MMA Junkie and ESPN can be added later (they are less reliable via public RSS)
];

async function fetchFeed(feedConfig) {
  try {
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
          title: item.title?.trim() || 'Untitled',
          link: item.link || item.guid || '#',
          date: published || null,
          relative,
          // Some feeds include image, most don't
          image: item.enclosure?.url || item['media:content']?.$?.url || null
        };
      });

    return {
      id: feedConfig.id,
      name: feedConfig.name,
      site: feedConfig.site,
      updated: new Date().toISOString(),
      items
    };
  } catch (err) {
    console.error(`Failed to fetch ${feedConfig.name}:`, err.message);
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
  console.log('Fetching feeds...');
  
  const results = await Promise.all(FEEDS.map(fetchFeed));
  
  const output = {
    generatedAt: new Date().toISOString(),
    sources: results
  };

  fs.writeFileSync('feeds.json', JSON.stringify(output, null, 2));
  console.log('feeds.json written successfully');
  
  // Simple summary
  results.forEach(r => {
    console.log(`${r.name}: ${r.items.length} items${r.error ? ' (ERROR)' : ''}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
