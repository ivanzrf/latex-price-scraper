/**
 * Supatex scraper (https://www.supatex.com/shop/)
 * WooCommerce-based, paginated, ~6 pages
 * Extracts full variation data (thickness × price × stock) from detail pages
 * Writes incrementally to avoid data loss on crash
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.supatex.com';
const SHOP_URL = `${BASE_URL}/shop/`;
const DATA_DIR = path.join(__dirname, '..', 'data');
const PROGRESS_FILE = path.join(DATA_DIR, '_supatex_progress.json');

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  } catch { return { completed: [], products: [] }; }
}

function saveProgress(progress) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function scrapeListingPage(page, url) {
  console.log(`  Loading: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  return page.evaluate((baseUrl) => {
    const items = [];
    const cards = document.querySelectorAll(
      '.product, .type-product, li.product, .products > *, ' +
      '[class*="product-card"], [class*="product-item"], .grid-item, .shop-item'
    );

    for (const card of cards) {
      const item = {};
      const links = card.querySelectorAll('a[href]');
      for (const a of links) {
        if (a.href && a.href.includes('/product/') && !a.href.includes('#')) {
          item.url = a.href; break;
        }
      }
      if (!item.url) {
        for (const a of links) {
          const href = a.href;
          if (href && href.includes('/shop/') && !href.includes('/page/') && href !== baseUrl + '/shop/') {
            const parts = new URL(href).pathname.split('/').filter(Boolean);
            if (parts.length >= 2 && parts[1] !== 'page') { item.url = href; break; }
          }
        }
      }
      const heading = card.querySelector('h2, h3, h4, .product-title, [class*="title"], .woocommerce-loop-product__title');
      if (heading) item.name = heading.textContent.trim();
      const priceEl = card.querySelector('.price, [class*="price"], .amount');
      if (priceEl) {
        item.priceText = priceEl.textContent.trim();
        const match = item.priceText.match(/[£€$]([\d,.]+)/);
        if (match) item.priceFrom = parseFloat(match[1].replace(',', ''));
      }
      const img = card.querySelector('img[src]:not([src*="data:"])');
      if (img) item.image = img.src;
      if (!item.image) {
        const li = card.querySelector('img[data-src], img[data-lazy-src]');
        if (li) item.image = li.getAttribute('data-src') || li.getAttribute('data-lazy-src');
      }
      if (item.name || item.url) items.push(item);
    }
    return items;
  }, BASE_URL);
}

async function scrapeProductDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    const data = await page.evaluate(() => {
      const result = {};
      const h1 = document.querySelector('h1');
      if (h1) result.name = h1.textContent.trim();

      const priceEl = document.querySelector('.price, [class*="price"], .summary .amount');
      if (priceEl) result.priceText = priceEl.textContent.trim();

      // WooCommerce variation data
      const form = document.querySelector('form.variations_form');
      if (form) {
        const dataStr = form.getAttribute('data-product_variations');
        if (dataStr) {
          try {
            const variations = JSON.parse(dataStr);
            result.variations = variations.map(v => ({
              attributes: v.attributes,
              price: v.display_price,
              regularPrice: v.display_regular_price,
              sku: v.sku,
              description: v.variation_description?.replace(/<[^>]*>/g, '').trim(),
              inStock: v.is_in_stock,
              stock: v.stock_level ?? v.max_qty,
              minQty: v.min_qty ? parseInt(v.min_qty) : null,
              maxQty: v.max_qty,
              weight: v.weight,
            }));
          } catch (e) {}
        }
      }

      const qtyInput = document.querySelector('input[name="quantity"]');
      if (qtyInput) {
        result.orderMin = parseInt(qtyInput.min) || null;
        result.orderMax = parseInt(qtyInput.max) || null;
        result.orderStep = parseInt(qtyInput.step) || null;
      }

      // Discount structure
      const bodyText = document.body.innerText;
      const lines = bodyText.split('\n').map(l => l.trim());
      const discIdx = lines.findIndex(l => l.includes('DISCOUNT STRUCTURE'));
      if (discIdx >= 0) {
        const tiers = [];
        for (let i = discIdx + 1; i < Math.min(discIdx + 10, lines.length); i++) {
          if (lines[i].match(/£[\d,.]+/) && lines[i].match(/\d+(\.\d+)?%/)) tiers.push(lines[i]);
          if (lines[i].includes('DELIVERY') || lines[i].includes('YOU MAY')) break;
        }
        if (tiers.length) result.discountTiers = tiers;
      }

      const desc = document.querySelector('.woocommerce-product-details__short-description, .product-description');
      if (desc) result.description = desc.textContent.trim().substring(0, 500);

      const cats = [];
      document.querySelectorAll('.product_meta a[href*="category"], .posted_in a').forEach(a => cats.push(a.textContent.trim()));
      if (cats.length) result.categories = cats;

      return result;
    });

    // Try expanding discount tab
    try {
      const discTab = await page.locator('text=DISCOUNT STRUCTURE').first();
      if (discTab) {
        await discTab.click();
        await page.waitForTimeout(600);
        const tiers = await page.evaluate(() => {
          const lines = document.body.innerText.split('\n').map(l => l.trim());
          const idx = lines.findIndex(l => l.includes('DISCOUNT STRUCTURE'));
          const t = [];
          if (idx >= 0) {
            for (let i = idx + 1; i < Math.min(idx + 15, lines.length); i++) {
              if (lines[i].match(/£[\d,.]+/) && lines[i].match(/\d+(\.\d+)?%/)) t.push(lines[i]);
              if (lines[i].includes('DELIVERY') || lines[i].includes('YOU MAY')) break;
            }
          }
          return t;
        });
        if (tiers.length) data.discountTiers = tiers;
      }
    } catch (e) {}

    if (data.priceText) {
      const match = data.priceText.match(/[£€$]([\d,.]+)/);
      if (match) data.priceFrom = parseFloat(match[1].replace(',', ''));
      data.currency = 'GBP';
    }

    if (data.variations?.length) {
      data.thicknesses = data.variations.map(v => {
        const attr = v.attributes?.attribute_pa_thickness || '';
        return attr.replace('0-', '0.').replace(/mm$/, '') + (attr ? 'mm' : '');
      }).filter(Boolean);
    }

    return { url, ...data };
  } catch (e) {
    console.error(`  Error on ${url}: ${e.message}`);
    return null;
  }
}

async function scrape() {
  console.log('Starting Supatex scrape...');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const progress = loadProgress();
  const completedUrls = new Set(progress.completed);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Step 1: Get all listings (always re-fetch for freshness)
  let allListings = [];
  let currentUrl = SHOP_URL;
  const visitedPages = new Set();

  while (currentUrl && !visitedPages.has(currentUrl)) {
    visitedPages.add(currentUrl);
    const products = await scrapeListingPage(page, currentUrl);
    allListings.push(...products);

    const nextUrl = await page.evaluate((baseUrl) => {
      const next = document.querySelector('a.next, a[rel="next"], a.page-numbers.next, .woocommerce-pagination a.next');
      if (next) return next.href.startsWith('http') ? next.href : baseUrl + next.href;
      const pageLinks = document.querySelectorAll('a[href*="/page/"]');
      let maxPage = 0, maxUrl = null;
      for (const a of pageLinks) {
        const m = a.href.match(/\/page\/(\d+)/);
        if (m) { const n = parseInt(m[1]); if (n > maxPage) { maxPage = n; maxUrl = a.href; } }
      }
      return maxUrl;
    }, BASE_URL);

    if (nextUrl && !visitedPages.has(nextUrl)) {
      currentUrl = nextUrl;
      await page.waitForTimeout(1500);
    } else {
      currentUrl = null;
    }
  }

  // Deduplicate
  const seen = new Set();
  allListings = allListings.filter(p => {
    const key = p.url || p.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const toScrape = allListings.filter(p => p.url && !completedUrls.has(p.url));
  const alreadyDone = allListings.filter(p => p.url && completedUrls.has(p.url));

  console.log(`Found ${allListings.length} products, ${alreadyDone.length} already scraped, ${toScrape.length} remaining`);

  // Step 2: Scrape remaining detail pages (incremental)
  for (let i = 0; i < toScrape.length; i++) {
    const listing = toScrape[i];
    console.log(`  [${i + 1}/${toScrape.length}] ${listing.name || listing.url}`);

    const detail = await scrapeProductDetail(page, listing.url);
    const merged = detail ? { ...listing, ...detail } : { ...listing };
    merged.source = 'supatex';
    merged.scrapedAt = new Date().toISOString();

    progress.products.push(merged);
    progress.completed.push(listing.url);
    saveProgress(progress);  // Write after each product!

    await page.waitForTimeout(1500);
  }

  await browser.close();

  const allProducts = progress.products;
  console.log(`Supatex complete: ${allProducts.length} products`);

  // Clean up progress file
  try { fs.unlinkSync(PROGRESS_FILE); } catch {}

  return allProducts;
}

module.exports = { scrape };
