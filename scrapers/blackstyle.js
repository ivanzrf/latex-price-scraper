/**
 * Blackstyle scraper (https://www.blackstyle.de)
 */
const { chromium } = require('playwright');

const BASE_URL = 'https://www.blackstyle.de';

const CATEGORIES = [
  ['latex_meterware', 'Latex by the metre'],
  ['neu', 'New items'],
  ['angebote', 'Special offers'],
  ['einzelstuecke', 'Unique pieces'],
  ['heavy_rubber', 'Heavy Rubber'],
  ['latex_damen', 'Latex for Ladies'],
  ['latex_herren', 'Latex for Gentlemen'],
  ['masken', 'Masks'],
  ['bondage', 'Bondage'],
  ['accessoires', 'Accessories'],
  ['latex_bettwaesche', 'Latex Bedding'],
  ['latex_schlafsaecke', 'Latex sleep sacks'],
  ['liquid_latex', 'Liquid Latex'],
  ['latex_zubehoer', 'Latex supplies'],
  ['auslaufartikel', 'Discontinued items'],
];

function categoryUrl(catId, lang = 'e') {
  return `${BASE_URL}/lshop,showrub,,${lang},,${catId},,,,.htm`;
}

async function scrapeCategory(page, catId, catName) {
  const url = categoryUrl(catId);
  console.log(`  Category '${catName}': ${url}`);
  const products = [];

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);

    const content = await page.content();
    if (content.includes('keine Angebote') || content.includes('no offers') || content.includes('No items available')) {
      console.log(`    Empty category`);
      return [];
    }

    // Extract products from the page
    const items = await page.evaluate((baseUrl) => {
      const results = [];
      const seen = new Set();

      // Find all product links (detail pages)
      document.querySelectorAll('a[href]').forEach(a => {
        let href = a.href || a.getAttribute('href');
        if (!href) return;
        if (!href.includes('showdetail') && !href.includes('detail')) return;
        if (!href.startsWith('http')) href = baseUrl + '/' + href.replace(/^\//, '');
        if (seen.has(href)) return;
        seen.add(href);

        const item = { url: href };

        // Get text from the link and surrounding cells
        const text = a.textContent.trim();
        if (text) item.name = text;

        // Look for price in parent row/cell
        const row = a.closest('tr') || a.parentElement;
        if (row) {
          const rowText = row.textContent;
          // European price format: 123,45 € or € 123,45
          const priceMatch = rowText.match(/([\d.,]+)\s*€|€\s*([\d.,]+)/);
          if (priceMatch) {
            item.priceText = priceMatch[0];
            const priceStr = (priceMatch[1] || priceMatch[2]).replace(/\./g, '').replace(',', '.');
            const price = parseFloat(priceStr);
            if (!isNaN(price)) item.price = price;
            item.currency = 'EUR';
          }
        }

        results.push(item);
      });

      return results;
    }, BASE_URL);

    for (const item of items) {
      item.category = catName;
      item.categoryId = catId;
      products.push(item);
    }

    console.log(`    Found ${products.length} products`);
  } catch (e) {
    console.error(`    Error: ${e.message}`);
  }

  return products;
}

async function scrapeProductDetail(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    const data = await page.evaluate((baseUrl) => {
      const result = {};

      // Title
      for (const sel of ['h1', 'h2', 'font[size="+1"]', 'font[size="+2"]', '.arttitle']) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 2) {
          result.name = el.textContent.trim();
          break;
        }
      }

      // Price from page text
      const bodyText = document.body.innerText;
      const priceMatch = bodyText.match(/([\d.,]+)\s*€|€\s*([\d.,]+)|EUR\s*([\d.,]+)/);
      if (priceMatch) {
        result.priceText = priceMatch[0];
        const priceStr = (priceMatch[1] || priceMatch[2] || priceMatch[3]).replace(/\./g, '').replace(',', '.');
        const price = parseFloat(priceStr);
        if (!isNaN(price)) {
          result.price = price;
          result.currency = 'EUR';
        }
      }

      // Description
      const desc = document.querySelector('.artdesc, .description, td.arttext');
      if (desc) result.description = desc.textContent.trim().substring(0, 500);
      
      // If no description, grab main text area
      if (!result.description) {
        const tds = document.querySelectorAll('td');
        for (const td of tds) {
          const text = td.textContent.trim();
          if (text.length > 50 && text.length < 2000 && !text.includes('Warenkorb') && !text.includes('shopping')) {
            result.description = text.substring(0, 500);
            break;
          }
        }
      }

      // Images
      const imgs = [];
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('src');
        if (src && (src.includes('artikel') || src.includes('product') || src.includes('pix')) && !src.includes('nav')) {
          imgs.push(src.startsWith('http') ? src : baseUrl + '/' + src.replace(/^\//, ''));
        }
      });
      if (imgs.length) result.images = imgs;

      // Size/variant options
      const options = [];
      document.querySelectorAll('select option').forEach(opt => {
        const text = opt.textContent.trim();
        if (text && text !== '--' && text !== '---') options.push(text);
      });
      if (options.length) result.options = options;

      return result;
    }, BASE_URL);

    return { url, ...data };
  } catch (e) {
    console.error(`  Detail error ${url}: ${e.message}`);
    return null;
  }
}

async function scrape() {
  console.log('Starting Blackstyle scrape...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Step 1: Scrape all categories
  const allProducts = [];
  for (const [catId, catName] of CATEGORIES) {
    const products = await scrapeCategory(page, catId, catName);
    allProducts.push(...products);
    await page.waitForTimeout(2000);
  }

  // Step 2: Fetch detail pages
  const withUrls = allProducts.filter(p => p.url);
  console.log(`Fetching details for ${withUrls.length} products...`);

  for (let i = 0; i < withUrls.length; i++) {
    const prod = withUrls[i];
    console.log(`  [${i + 1}/${withUrls.length}] ${prod.url}`);
    const detail = await scrapeProductDetail(page, prod.url);
    if (detail) Object.assign(prod, detail);
    await page.waitForTimeout(1500);
  }

  await browser.close();

  // Add metadata
  for (const p of allProducts) {
    p.source = 'blackstyle';
    p.scrapedAt = new Date().toISOString();
  }

  console.log(`Blackstyle complete: ${allProducts.length} products`);
  return allProducts;
}

module.exports = { scrape };
