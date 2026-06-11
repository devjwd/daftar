import puppeteer from 'puppeteer';
import { SupabaseClient } from '@supabase/supabase-js';

export async function updateNFTFloorPrices(supabase: SupabaseClient) {
  console.log('[NFTPriceService] 🔍 Starting Puppeteer scraper to fetch NFT floor prices...');

  try {
    // 1. Fetch the list of known collections from the database
    const { data: collections, error } = await supabase
      .from('nft_collection_stats')
      .select('collection_id, name, slug');

    if (error || !collections || collections.length === 0) {
      console.log('[NFTPriceService] ⚠️ No collections found in database to scrape. Exiting.');
      return;
    }

    console.log(`[NFTPriceService] 🚀 Found ${collections.length} collections. Launching browser...`);

    // 2. Launch headless browser
    const browser = await puppeteer.launch({ 
      headless: true, 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    // Use a generic user-agent to avoid basic bot blocks
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const statsToUpsert: any[] = [];

    // 3. Loop through collections and scrape data
    for (const col of collections) {
      try {
        // Use slug if available, fallback to collection_id
        const identifier = col.slug || col.collection_id;
        const url = `https://www.tradeport.xyz/movement/collection/${identifier}`;
        
        console.log(`[NFTPriceService] 🌐 Scraping ${col.name}: ${url}`);
        
        // Navigate and wait for network to settle (meaning page is fully loaded)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Extract Floor Price and Top Bid using DOM traversal
        const extractedData = await page.evaluate(() => {
          let floor = 0;
          let topBid = 0;

          // Find text elements on the page
          const elements = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3'));
          
          for (let i = 0; i < elements.length; i++) {
             const text = elements[i].textContent || '';
             const lowerText = text.toLowerCase().trim();
             
             // Simple heuristic parsing (works for most common NFT marketplace structures)
             if (lowerText === 'floor' || lowerText === 'floor price') {
                // Check next sibling or next element in DOM for the value
                const nextText = elements[i + 1]?.textContent || '';
                const match = nextText.match(/([\d.]+)/);
                if (match && match[1]) floor = parseFloat(match[1]);
             }
             if (lowerText === 'top bid' || lowerText === 'highest bid') {
                const nextText = elements[i + 1]?.textContent || '';
                const match = nextText.match(/([\d.]+)/);
                if (match && match[1]) topBid = parseFloat(match[1]);
             }
          }
          return { floor, topBid };
        });

        console.log(`[NFTPriceService] 📊 Scraped Data for ${col.name} -> Floor: ${extractedData.floor}, Top Bid: ${extractedData.topBid}`);

        // Only update if we successfully scraped at least one valid number
        if (extractedData.floor > 0 || extractedData.topBid > 0) {
          statsToUpsert.push({
            collection_id: col.collection_id,
            name: col.name,
            floor_price: extractedData.floor,
            top_bid: extractedData.topBid,
            updated_at: new Date().toISOString()
          });
        }
      } catch (scrapeErr: any) {
        console.log(`[NFTPriceService] ❌ Failed to scrape ${col.name}: ${scrapeErr.message}`);
      }
    }

    await browser.close();

    // 4. Save results to the database
    if (statsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('nft_collection_stats')
        .upsert(statsToUpsert, { onConflict: 'collection_id' });

      if (upsertError) throw upsertError;

      console.log(`[NFTPriceService] ✅ Successfully updated ${statsToUpsert.length} NFT collection stats via Scraper.`);
    } else {
      console.log(`[NFTPriceService] ⚠️ No new valid data scraped.`);
    }

  } catch (err: any) {
    console.error('[NFTPriceService] ❌ Fatal error in Puppeteer scraper:', err.message);
  }
}
