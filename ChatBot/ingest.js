require('dotenv').config();
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ─── SETTINGS ───
const MAX_PAGES_SAVED = 60;    // stop after saving this many useful pages
const MAX_PAGES_VISITED = 150; // hard limit on pages opened

// Pages the bot should NOT learn from
const SKIP_URL_PATTERNS = [
  '/product/', // product details come from the product cards instead
  '/auth/',
  '/account',
];

// Fixes for known mistakes on the website (checked against seabrooktx.gov)
const CORRECTIONS = [
  {
    // City Hall card: wrong address (1400 Cook St is the police station)
    find: /Located at 1400 Cook Street, Seabrook, TX 77586/g,
    replace: 'Located at 1700 1st Street, Seabrook, TX 77586. Phone: (281) 291-5600',
  },
  {
    // City Hall card: vague hours
    find: /Open Monday\s*[–-]\s*Friday during standard municipal hours/g,
    replace: 'Open Monday to Thursday 7:30 a.m. to 5 p.m., and Friday 8 a.m. to 5 p.m.',
  },
  {
    // Police card: the police station is NOT at City Hall
    find: /Located at City Hall \(1400 Cook St\)/g,
    replace: 'Police station located at 1400 Cook St. Non-emergency phone: (281) 291-5610',
  },
];

// Counts how many times each correction was used
const correctionCounts = CORRECTIONS.map(() => 0);

function applyCorrections(text) {
  CORRECTIONS.forEach((c, i) => {
    const found = text.match(c.find);
    if (found) correctionCounts[i] += found.length;
    text = text.replace(c.find, c.replace);
  });
  return text;
}

function normalizeVector(vec) {
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return vec;
  return vec.map(val => val / norm);
}

// Get the base domain so we stay on the same site
function getBaseUrl(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

// Check if a link belongs to the same site
function isSameSite(link, baseUrl) {
  return link.startsWith(baseUrl);
}

// Check if a page is on the skip list
function shouldSkip(url) {
  const path = new URL(url).pathname;
  return SKIP_URL_PATTERNS.some(p => path.startsWith(p));
}

// Removes the live weather widget text, e.g. "81°SeabrookClouds"
function removeWeather(text) {
  return text.replace(/-?\d+\s*°\s*[FC]?\s*Seabrook\s*[A-Za-z]+/g, ' ');
}

// Removes the product sorting/filter bar on category pages
function removeShopClutter(text) {
  return text.replace(/Featured\s*Price: Low to High.*?Page \d+ of \d+/g, ' ');
}

// Clean up spaces
function tidy(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// "canvas-beach-bag" -> "Canvas Beach Bag"
function slugToName(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Writes email addresses and outside-site links into the text,
// e.g. "Help & Support" becomes "Help & Support (support@...)"
function addLinkTargets($, baseUrl) {
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.startsWith('mailto:')) {
      $(el).append(` (${href.replace('mailto:', '')}) `);
    } else if (href.startsWith('http') && !href.startsWith(baseUrl)) {
      $(el).append(` (${href}) `);
    }
  });
}

// Reads product cards (name + price) from a page
function collectProducts($, currentUrl, products) {
  const path = new URL(currentUrl).pathname;
  const category = path.startsWith('/category/') ? slugToName(path.split('/')[2]) : null;

  $('a[href*="/product/"]').each((_, el) => {
    let link;
    try {
      link = new URL($(el).attr('href'), currentUrl).href.split('?')[0];
    } catch {
      return;
    }

    const fullText = tidy($(el).text());
    const priceMatch = fullText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    if (!priceMatch) return;

    // The separate bits of text in the card, e.g. ["Merchandise", "Seabrook Marina Cap"]
    const pieces = $(el).find('*').addBack().contents()
      .filter((_, n) => n.type === 'text')
      .map((_, n) => tidy($(n).text()))
      .get()
      .flatMap(p => p.split(/From\s*\$[\d,.]+|\$[\d,.]+/i))
      .map(tidy)
      .filter(p => p && !/^from$/i.test(p));
    if (pieces.length === 0) return;

    // The longest bit is the product name, a shorter one is its type
    const name = pieces.reduce((a, b) => (b.length > a.length ? b : a));
    const type = pieces.find(p => p !== name) || '';

    if (!products.has(link)) {
      products.set(link, { name, type, price: priceMatch[1], categories: new Set() });
    }
    if (category) products.get(link).categories.add(category);
  });
}

async function run() {
  const startUrl = process.env.WEBSITE_URL;
  const baseUrl = getBaseUrl(startUrl);

  console.log(`🌐 Starting crawl of: ${baseUrl}`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const visited = new Set();
  const toVisit = [startUrl];
  const allPages = [];
  const products = new Map();
  let footerText = '';

  // ─── A. CRAWL PAGES ───
  while (
    toVisit.length > 0 &&
    allPages.length < MAX_PAGES_SAVED &&
    visited.size < MAX_PAGES_VISITED
  ) {
    const currentUrl = toVisit.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      console.log(`\n📄 Visiting: ${currentUrl}`);
      await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      const html = await page.content();
      const $ = cheerio.load(html);
      const title = tidy($('title').text()) || currentUrl;

      // 1. Find links FIRST (the menu and footer hold many of them)
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        try {
          const absolute = new URL(href, currentUrl).href;
          const clean = absolute.split('#')[0].split('?')[0];
          const isFile = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(clean);

          if (
            isSameSite(clean, baseUrl) &&
            !isFile &&
            !shouldSkip(clean) &&
            !visited.has(clean) &&
            !toVisit.includes(clean)
          ) {
            toVisit.push(clean);
          }
        } catch {}
      });

      // 2. Read the product cards (name + price) before removing them
      const before = products.size;
      collectProducts($, currentUrl, products);
      if (products.size > before) console.log(`   🛍️ +${products.size - before} products`);

      // 3. Keep email addresses and outside links in the text
      addLinkTargets($, baseUrl);

      // 4. Save the footer once (it repeats on every page)
      if (!footerText) {
        footerText = removeWeather(tidy($('footer').text()));
      }

      // 5. Remove product cards from the page text (they become shop pages below)
      $('a[href*="/product/"]').remove();

      // 6. Get the main page text (without menu, header, footer)
      $('script, style, noscript, nav, footer, header').remove();
      const pageText = applyCorrections(removeShopClutter(tidy(removeWeather($('body').text()))));

      if (pageText.length > 100) {
        allPages.push({ url: currentUrl, title, content: pageText });
        console.log(`   ✓ Captured ${pageText.length} chars`);
      } else {
        console.log('   – Too little text, not saved');
      }
    } catch (err) {
      console.log(`   ⚠️ Failed: ${err.message}`);
    }
  }

  await browser.close();

  // Add the footer as its own page
  if (footerText.length > 50) {
    allPages.push({ url: baseUrl, title: 'Contact information and links (site footer)', content: footerText });
    console.log(`\n📇 Footer saved. Emails found: ${(footerText.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || ['none']).join(', ')}`);
  } else {
    console.log('\n⚠️ No footer text found');
  }

  // ─── A2. TURN PRODUCTS INTO SHOP PAGES ───
  const productList = [...products.values()];
  console.log(`\n🛍️ Found ${productList.length} products. Examples:`);
  productList.slice(0, 5).forEach(p => console.log(`   ${p.name} | type: ${p.type} | $${p.price}`));

  if (productList.length > 0) {
    // Group products by category
    const groups = new Map();
    for (const p of productList) {
      const cats = p.categories.size ? [...p.categories] : [p.type || 'Other items'];
      for (const c of cats) {
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(p);
      }
    }

    const toNumber = s => parseFloat(s.replace(/,/g, ''));

    // One overview page: the types of products sold
    const overview = [...groups.entries()]
      .map(([c, items]) => `${c} (${items.length} items, from $${Math.min(...items.map(i => toNumber(i.price))).toFixed(2)})`)
      .join('; ');

    allPages.push({
      url: `${baseUrl}/shop`,
      title: 'Seabrook online shop – types of products sold',
      content: `The Seabrook Texas Town website has an online shop at ${baseUrl}/shop selling Seabrook merchandise and other items. Types of products sold: ${overview}.`,
    });

    // One price list per category
    for (const [c, items] of groups) {
      const list = items.map(i => `${i.name}: from $${i.price}`).join('. ');
      allPages.push({
        url: `${baseUrl}/shop`,
        title: `Seabrook shop – ${c} prices`,
        content: `${c} sold in the Seabrook online shop (${baseUrl}/shop), with prices. ${list}.`,
      });
    }
    console.log(`🛍️ Created ${groups.size} shop price lists.`);
  }

  console.log(`\n✅ Visited ${visited.size} pages, kept ${allPages.length}.`);
  CORRECTIONS.forEach((c, i) => {
    const n = correctionCounts[i];
    console.log(`🔧 Correction ${i + 1}: applied ${n} time(s)${n === 0 ? '  ⚠️ NOT FOUND' : ''}`);
  });

  // ─── B. CHUNK ALL PAGES ───
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const allChunks = [];
  for (const p of allPages) {
    const chunks = await splitter.splitText(p.content);
    chunks.forEach(chunk => {
      if (chunk.trim().length > 20) {
        allChunks.push({
          content: `${p.title}\n${chunk}`,
          metadata: { source: p.url, title: p.title },
        });
      }
    });
  }

  console.log(`✂️  Total chunks across all pages: ${allChunks.length}`);

  // ─── C. EMBED + SAVE ───
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Skip chunks that are already saved (lets you resume after hitting the daily limit)
  const { data: existing, error: existingError } = await supabase
    .from('documents')
    .select('content')
    .limit(5000);
  if (existingError) {
    console.error('❌ Could not read existing rows:', existingError.message);
    return;
  }
  const alreadySaved = new Set((existing || []).map(r => r.content));
  console.log(`♻️ ${alreadySaved.size} chunks already saved; they will be skipped.`);

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i];
    if (alreadySaved.has(chunk.content)) {
      skippedCount++;
      continue;
    }

    console.log(`🧠 [${i + 1}/${allChunks.length}] ${chunk.metadata.title.slice(0, 40)}`);

    try {
      const result = await model.embedContent(chunk.content);
      const embedding = normalizeVector(result.embedding.values);

      const { error } = await supabase.from('documents').insert({
        content: chunk.content,
        metadata: chunk.metadata,
        embedding: embedding,
      });

      if (error) {
        console.error(`   ❌ Save error: ${error.message}`);
        errorCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      if (String(err.message).includes('429')) {
        console.error('\n⛔ Google embedding limit reached. Stopping now.');
        console.error('   Run "node ingest.js" again after the limit resets. Saved chunks will be skipped.');
        break;
      }
      console.error(`   ❌ Embed error: ${err.message}`);
      errorCount++;
    }

    // Slower pace to stay under Google's free-tier limits
    await new Promise(r => setTimeout(r, 700));
  }

  console.log(`\n✅ DONE!`);
  console.log(`   Saved: ${successCount} chunks`);
  console.log(`   Failed: ${errorCount} chunks`);
  console.log(`   Skipped (already saved): ${skippedCount} chunks`);
}

run().catch(console.error);