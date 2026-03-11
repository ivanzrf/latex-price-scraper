/**
 * Supatex scraper (https://www.supatex.com/shop/)
 * WooCommerce-based, paginated, ~6 pages
 */
const { chromium } = require('playwright');

const BASE_URL = 'https://www.supatex.com';
const SHOP_URL = `${BASE_URL}/shop/`;

async function scrapeListingPage(page, url) {
  console.log(`  Loading: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Scroll to trigger lazy loading
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(300);
  }
  // Scroll back up
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Extract product cards from the listing
  const products = await page.evaluate((baseUrl) => {
    const items = [];

    // WooCommerce product elements typically have class 'product' or 'type-product'
    const cards = document.querySelectorAll(
      '.product, .type-product, li.product, .products > *, ' +
      '[class*="product-card"], [class*="product-item"], ' +
      '.grid-item, .shop-item'
    );

    for (const card of cards) {
      const item = {};

      // Product link - find the first link to an individual product
      const links = card.querySelectorAll('a[href]');
      for (const a of links) {
        const href = a.href;
        if (href && href.includes('/shop/') && !href.includes('/page/') &&
            !href.includes('/shop/#') && href !== baseUrl + '/shop/') {
          item.url = href;
          break;
        }
      }

      // Product name from heading or link title
      const heading = card.querySelector('h2, h3, h4, .product-title, [class*="title"], .woocommerce-loop-product__title');
      if (heading) item.name = heading.textContent.trim();

      // Price
      const priceEl = card.querySelector('.price, [class*="price"], .amount');
      if (priceEl) {
        item.priceText = priceEl.textContent.trim();
        const match = item.priceText.match(/[£€$]([\d,.]+)/);
        if (match) item.priceFrom = parseFloat(match[1].replace(',', ''));
      }

      // Image
      const img = card.querySelector('img[src]:not([src*="data:"])');
      if (img) item.image = img.src;
      // Also check lazy-load attributes
      if (!item.image) {
        const lazyImg = card.querySelector('img[data-src], img[data-lazy-src]');
        if (lazyImg) item.image = lazyImg.getAttribute('data-src') || lazyImg.getAttribute('data-lazy-src');
      }

      if (item.name || item.url) items.push(item);
    }

    // Fallback: if no product cards found, try parsing all product-like links
    if (items.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="/shop/"]');
      const seen = new Set();
      for (const a of allLinks) {
        const href = a.href;
        if (!href || href.includes('/page/') || href === baseUrl + '/shop/' || seen.has(href)) continue;
        // Must be a product page (has a slug after /shop/)
        const path = new URL(href).pathname;
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 2 && parts[0] === 'shop' && parts[1] !== 'page') {
          seen.add(href);
          const item = { url: href };
          // Try to get text from the link
          const text = a.textContent.trim();
          if (text && text.length < 100) item.name = text;
          items.push(item);
        }
      }
    }

    return items;
  }, BASE_URL);

  return products;
}

async function scrapeProductDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    const data = await page.evaluate(() => {
      const result = {};

      // Title
      const h1 = document.querySelector('h1');
      if (h1) result.name = h1.textContent.trim();

      // All price info
      const priceEl = document.querySelector('.price, [class*="price"], .summary .amount');
      if (priceEl) result.priceText = priceEl.textContent.trim();

      // Variants/options (thickness selections)
      const options = {};
      document.querySelectorAll('.variations select, select[name*="attribute"]').forEach(sel => {
        const label = sel.closest('tr')?.querySelector('label, th')?.textContent?.trim() ||
                      sel.getAttribute('name')?.replace('attribute_', '') || 'option';
        const values = [];
        sel.querySelectorAll('option').forEach(opt => {
          const text = opt.textContent.trim();
          if (text && !text.match(/^(choose|select|--|---)/i)) values.push(text);
        });
        if (values.length) options[label] = values;
      });
      if (Object.keys(options).length) result.options = options;

      // Description
      const desc = document.querySelector('.product-description, .woocommerce-product-details__short-description, [class*="description"]');
      if (desc) result.description = desc.textContent.trim().substring(0, 500);

      // Product meta / categories
      const cats = [];
      document.querySelectorAll('.product_meta a[href*="category"], .posted_in a').forEach(a => {
        cats.push(a.textContent.trim());
      });
      if (cats.length) result.categories = cats;

      // Images (non-placeholder)
      const imgs = [];
      document.querySelectorAll('.product img, .woocommerce-product-gallery img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-large_image');
        if (src && !src.includes('data:image') && !src.includes('placeholder')) imgs.push(src);
      });
      if (imgs.length) result.images = [...new Set(imgs)];

      // Additional info table (may have weight, dimensions)
      const addInfo = {};
      document.querySelectorAll('.additional_information th, .shop_attributes th').forEach(th => {
        const td = th.closest('tr')?.querySelector('td');
        if (td) addInfo[th.textContent.trim()] = td.textContent.trim();
      });
      if (Object.keys(addInfo).length) result.additionalInfo = addInfo;

      return result;
    });

    // Parse price
    if (data.priceText) {
      // Handle "From £X.XX" format
      const match = data.priceText.match(/[£€$]([\d,.]+)/);
      if (match) data.price = parseFloat(match[1].replace(',', ''));
      data.currency = 'GBP';

      // Check for "per meter" indicator
      if (data.priceText.match(/mtr|meter|m\b/i)) {
        data.priceUnit = 'per_meter';
      }
    }

    // Extract thicknesses from options
    if (data.options) {
      for (const [key, values] of Object.entries(data.options)) {
        if (key.toLowerCase().includes('thick') || key.toLowerCase().includes('gauge')) {
          data.thicknesses = values;
        }
      }
    }

    return { url, ...data };
  } catch (e) {
    console.error(`  Error on ${url}: ${e.message}`);
    return null;
  }
}

async function scrape() {
  console.log('Starting Supatex scrape...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Step 1: Discover all products across paginated listing pages
  let allListings = [];
  let currentUrl = SHOP_URL;
  const visitedPages = new Set();

  while (currentUrl && !visitedPages.has(currentUrl)) {
    visitedPages.add(currentUrl);
    const products = await scrapeListingPage(page, currentUrl);
    allListings.push(...products);

    // Find next page link
    const nextUrl = await page.evaluate((baseUrl) => {
      const next = document.querySelector('a.next, a[rel="next"], .pagination .next a, a.page-numbers.next, .woocommerce-pagination a.next');
      if (next) {
        const href = next.href;
        return href.startsWith('http') ? href : baseUrl + href;
      }
      // Fallback: look for numbered page links
      const pageLinks = document.querySelectorAll('a[href*="/page/"]');
      let maxPage = 0;
      let maxUrl = null;
      for (const a of pageLinks) {
        const match = a.href.match(/\/page\/(\d+)/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxPage) { maxPage = num; maxUrl = a.href; }
        }
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

  // Deduplicate by URL
  const seen = new Set();
  allListings = allListings.filter(p => {
    const key = p.url || p.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Found ${allListings.length} unique products across ${visitedPages.size} pages`);

  // Step 2: Visit each product detail page
  const allProducts = [];
  for (let i = 0; i < allListings.length; i++) {
    const listing = allListings[i];
    if (!listing.url) {
      allProducts.push({ ...listing, source: 'supatex', scrapedAt: new Date().toISOString() });
      continue;
    }

    console.log(`  [${i + 1}/${allListings.length}] ${listing.name || listing.url}`);
    const detail = await scrapeProductDetail(page, listing.url);
    if (detail) {
      // Merge listing + detail (detail takes priority)
      const merged = { ...listing, ...detail };
      merged.source = 'supatex';
      merged.scrapedAt = new Date().toISOString();
      allProducts.push(merged);
    } else {
      allProducts.push({ ...listing, source: 'supatex', scrapedAt: new Date().toISOString() });
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();
  console.log(`Supatex complete: ${allProducts.length} products`);
  return allProducts;
}

module.exports = { scrape };
