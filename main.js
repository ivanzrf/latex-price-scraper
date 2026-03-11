#!/usr/bin/env node
/**
 * Latex sheeting price scraper - main entry point
 */
const fs = require('fs');
const path = require('path');
const supatex = require('./scrapers/supatex');
const blackstyle = require('./scrapers/blackstyle');

const DATA_DIR = path.join(__dirname, 'data');

function saveJson(products, filename) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(products, null, 2));
  console.log(`Saved ${products.length} products to ${filepath}`);
}

function saveCsv(products, filename) {
  if (!products.length) return;
  const filepath = path.join(DATA_DIR, filename);

  // Collect all keys
  const keys = [];
  for (const p of products) {
    for (const k of Object.keys(p)) {
      if (!keys.includes(k)) keys.push(k);
    }
  }

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [keys.join(',')];
  for (const p of products) {
    lines.push(keys.map(k => escape(p[k])).join(','));
  }
  fs.writeFileSync(filepath, lines.join('\n'));
  console.log(`Saved ${products.length} products to ${filepath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args : ['supatex', 'blackstyle'];

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const allProducts = [];

  if (targets.includes('supatex')) {
    console.log('='.repeat(60));
    console.log('SCRAPING SUPATEX');
    console.log('='.repeat(60));
    try {
      const products = await supatex.scrape();
      saveJson(products, `supatex_${timestamp}.json`);
      saveCsv(products, `supatex_${timestamp}.csv`);
      allProducts.push(...products);
    } catch (e) {
      console.error(`Supatex failed: ${e.message}`);
    }
  }

  if (targets.includes('blackstyle')) {
    console.log('='.repeat(60));
    console.log('SCRAPING BLACKSTYLE');
    console.log('='.repeat(60));
    try {
      const products = await blackstyle.scrape();
      saveJson(products, `blackstyle_${timestamp}.json`);
      saveCsv(products, `blackstyle_${timestamp}.csv`);
      allProducts.push(...products);
    } catch (e) {
      console.error(`Blackstyle failed: ${e.message}`);
    }
  }

  if (targets.length > 1 && allProducts.length) {
    saveJson(allProducts, `combined_${timestamp}.json`);
    saveCsv(allProducts, `combined_${timestamp}.csv`);
  }

  console.log('='.repeat(60));
  console.log(`TOTAL: ${allProducts.length} products`);
  const sources = [...new Set(allProducts.map(p => p.source))];
  for (const s of sources) {
    console.log(`  ${s}: ${allProducts.filter(p => p.source === s).length}`);
  }
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
