# Latex Price Scraper

Web scraping tools for comparing latex sheeting prices across suppliers.

## Supported Sites

| Supplier | URL | Type | Currency |
|----------|-----|------|----------|
| **Supatex** | [supatex.com](https://www.supatex.com/shop/) | Manufacturer (UK) | GBP |
| **Blackstyle** | [blackstyle.de](https://www.blackstyle.de) | Retailer (Berlin) | EUR |

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
# Scrape both sites
node main.js

# Scrape only one
node main.js supatex
node main.js blackstyle
```

Output goes to `data/` as timestamped JSON and CSV files.

## Project Structure

```
├── main.js              # Entry point
├── scrapers/
│   ├── supatex.js       # Supatex shop scraper (Playwright)
│   └── blackstyle.js    # Blackstyle catalog scraper (Playwright)
└── data/                # Output directory (gitignored)
```

## Notes

- Uses Playwright (headless Chromium) since both sites are JS-rendered
- 1.5-2s delay between requests to be polite
- Supatex is the actual manufacturer; Blackstyle is primarily a garment maker
