// Enhanced Email Extractor Web Scraper
// This script requires Node.js and Puppeteer.
// To run this script:
// 1. Ensure you have Node.js installed on your system.
// 2. Create a new directory for your project (e.g., `my-scraper`).
// 3. Open your terminal or command prompt, navigate into that directory: `cd my-scraper`.
// 4. Initialize a Node.js project: `npm init -y`.
// 5. Install Puppeteer: `npm install puppeteer`.
// 6. Create a file named `companydetails.txt` with your company data in Markdown table format.
// 7. Save this code as a JavaScript file (e.g., `scrape.js`) inside your `my-scraper` directory.
// 8. Run the script from your terminal: `node scrape.js`

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration constants
const MAX_CONCURRENT_PAGES = 2;
const COMPANY_DETAILS_FILE = 'companydetails.txt';
const OUTPUT_DIR = 'scraped_data';
const MIN_DELAY_BETWEEN_REQUESTS = 3000; // 3 seconds minimum
const MAX_DELAY_BETWEEN_REQUESTS = 7000; // 7 seconds maximum
const PAGE_TIMEOUT = 60000; // 60 seconds
const MAX_RETRIES = 3;
const MAX_PAGES_PER_SITE = 25; // Limit pages per website

// User agents pool for rotation
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0'
];

// Advanced email regex patterns
const EMAIL_PATTERNS = [
    // Standard email pattern
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    // Email with encoded characters
    /\b[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\s*\.\s*[A-Z|a-z]{2,}\b/g,
    // Email with [at] or (at) replacements
    /\b[A-Za-z0-9._%+-]+\s*(?:\[at\]|\(at\)|@)\s*[A-Za-z0-9.-]+\s*(?:\[dot\]|\(dot\)|\.)s*[A-Z|a-z]{2,}\b/gi,
    // Email with DOT spelled out
    /\b[A-Za-z0-9._%+-]+\s*@\s*[A-Za-z0-9.-]+\s*(?:dot|DOT)\s*[A-Z|a-z]{2,}\b/gi,
    // Obfuscated emails with spaces
    /\b[A-Za-z0-9._%-]+\s+at\s+[A-Za-z0-9.-]+\s+dot\s+[A-Za-z]{2,}\b/gi
];

/**
 * Rate limiter class with randomized delays
 */
class RateLimiter {
    constructor(maxRequests, timeWindow) {
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
        this.requests = [];
    }

    async waitForSlot() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.timeWindow);

        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = this.timeWindow - (now - oldestRequest);
            console.log(`⏰ Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            this.requests = this.requests.filter(time => Date.now() - time < this.timeWindow);
        }

        this.requests.push(now);
        
        // Add random delay between requests
        const randomDelay = Math.random() * (MAX_DELAY_BETWEEN_REQUESTS - MIN_DELAY_BETWEEN_REQUESTS) + MIN_DELAY_BETWEEN_REQUESTS;
        await new Promise(resolve => setTimeout(resolve, randomDelay));
    }
}

const rateLimiter = new RateLimiter(8, 60000); // 8 requests per minute

/**
 * Helper function to get random user agent
 */
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Helper function to extract the domain from a given URL
 */
function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        console.warn(`⚠️  Could not parse domain from URL: ${url}. Error: ${e.message}`);
        return null;
    }
}

/**
 * Helper function to sanitize company name for filename
 */
function sanitizeCompanyName(companyName) {
    return companyName
        .replace(/[^a-zA-Z0-9_\-\s]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .trim()
        .substring(0, 100);
}

/**
 * Advanced email extraction function with multiple patterns and cleanup
 */
function extractEmails(htmlContent) {
    const foundEmails = new Set();
    
    // Decode HTML entities first
    const decodedContent = htmlContent
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x40;/g, '@')
        .replace(/&#64;/g, '@');
    
    // Apply all email patterns
    EMAIL_PATTERNS.forEach(pattern => {
        const matches = decodedContent.match(pattern);
        if (matches) {
            matches.forEach(email => {
                // Clean and normalize the email
                let cleanEmail = email
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, '') // Remove spaces
                    .replace(/\[at\]/g, '@')
                    .replace(/\(at\)/g, '@')
                    .replace(/\sat\s/g, '@')
                    .replace(/\[dot\]/g, '.')
                    .replace(/\(dot\)/g, '.')
                    .replace(/\sdot\s/g, '.')
                    .replace(/\sdot$/g, '.');
                
                // Validate email format
                if (isValidEmail(cleanEmail)) {
                    foundEmails.add(cleanEmail);
                }
            });
        }
    });
    
    // Additional extraction from common HTML attributes
    const attributePatterns = [
        /mailto:([^"'\s>]+)/gi,
        /href="mailto:([^"]+)"/gi,
        /data-email="([^"]+)"/gi,
        /email:\s*"([^"]+)"/gi
    ];
    
    attributePatterns.forEach(pattern => {
        const matches = decodedContent.match(pattern);
        if (matches) {
            matches.forEach(match => {
                const emailMatch = match.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/);
                if (emailMatch && isValidEmail(emailMatch[1].toLowerCase())) {
                    foundEmails.add(emailMatch[1].toLowerCase());
                }
            });
        }
    });
    
    return Array.from(foundEmails).sort();
}

/**
 * Validate email format
 */
function isValidEmail(email) {
    // Basic validation to filter out false positives
    const validPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    
    // Filter out common false positives
    const invalidPatterns = [
        /example\.com$/i,
        /test\.com$/i,
        /dummy\.com$/i,
        /placeholder\./i,
        /yoursite\./i,
        /yourdomain\./i,
        /samplesite\./i,
        /\.(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|zip|rar)$/i,
        /^[0-9]+@/,
        /\.{2,}/,
        /@\.+/,
        /^\.+@/
    ];
    
    if (!validPattern.test(email)) return false;
    
    for (const invalidPattern of invalidPatterns) {
        if (invalidPattern.test(email)) return false;
    }
    
    // Must have at least 5 characters and reasonable length
    return email.length >= 5 && email.length <= 254;
}

/**
 * Check if output file already exists for a company
 */
function checkIfFileExists(companyName) {
    const sanitizedName = sanitizeCompanyName(companyName);
    const fileName = `${sanitizedName}_emails.txt`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    return fs.existsSync(filePath);
}

/**
 * Read and parse company details from file
 */
function readCompanyDetails() {
    try {
        if (!fs.existsSync(COMPANY_DETAILS_FILE)) {
            console.error(`❌ Error: ${COMPANY_DETAILS_FILE} not found. Please create this file with your company data.`);
            return [];
        }

        const fileContent = fs.readFileSync(COMPANY_DETAILS_FILE, 'utf8');
        const lines = fileContent.trim().split('\n');
        const companyUrls = [];
        const seenEntries = new Set();

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
                const parts = trimmedLine.substring(1, trimmedLine.length - 1).split('|').map(part => part.trim());

                if (parts.length === 2 &&
                    !parts[0].startsWith('---') &&
                    parts[1] && (parts[1].startsWith('http://') || parts[1].startsWith('https://')) &&
                    !(parts[0].toLowerCase() === 'company name' && parts[1].toLowerCase() === 'website url')
                ) {
                    const companyName = parts[0];
                    const url = parts[1];
                    const entryKey = `${companyName}::${url}`;

                    if (!seenEntries.has(entryKey)) {
                        companyUrls.push({ companyName, url });
                        seenEntries.add(entryKey);
                    }
                }
            }
        }

        console.log(`✅ Successfully parsed ${companyUrls.length} companies from ${COMPANY_DETAILS_FILE}`);
        return companyUrls;
    } catch (error) {
        console.error(`❌ Error reading ${COMPANY_DETAILS_FILE}: ${error.message}`);
        return [];
    }
}

/**
 * Process a single page and extract HTML content
 */
async function processPage(browser, url, retryCount = 0) {
    let page;
    try {
        page = await browser.newPage();
        
        // Set random user agent and viewport
        await page.setUserAgent(getRandomUserAgent());
        await page.setViewport({ 
            width: 1366 + Math.floor(Math.random() * 100), 
            height: 768 + Math.floor(Math.random() * 100) 
        });
        
        // Set realistic headers
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        });

        // Block images and media to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'media', 'font'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
        
        // Apply rate limiting
        await rateLimiter.waitForSlot();

        console.log(`🌐 Navigating to: ${url} (Attempt ${retryCount + 1})`);
        
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT 
        });

        // Wait for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));

        // Get full HTML content
        const htmlContent = await page.content();
        
        // Extract same-domain links for crawling
        const currentDomain = getDomain(url);
        let links = [];
        
        if (currentDomain) {
            links = await page.evaluate((domain) => {
                return Array.from(document.querySelectorAll('a[href]'))
                    .map(anchor => {
                        try {
                            return new URL(anchor.href, document.baseURI).href;
                        } catch {
                            return null;
                        }
                    })
                    .filter(href => {
                        if (!href) return false;
                        try {
                            const linkHostname = new URL(href).hostname;
                            return linkHostname === domain;
                        } catch {
                            return false;
                        }
                    })
                    .slice(0, 15); // Limit to 15 links per page
            }, currentDomain);
        }

        return { htmlContent, links };

    } catch (error) {
        console.error(`❌ Error processing page ${url}: ${error.message}`);
        
        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 Retrying ${url} (${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 5000 * (retryCount + 1)));
            return processPage(browser, url, retryCount + 1);
        }
        
        return { htmlContent: `Error: Could not process page ${url} after ${MAX_RETRIES} attempts: ${error.message}`, links: [] };
    } finally {
        if (page) {
            await page.close();
        }
    }
}

/**
 * Process a single website and extract all emails
 */
async function processSingleWebsite(browser, initialUrl, companyName) {
    const allEmails = new Set();
    const visitedUrls = new Set();
    const urlsToVisitQueue = [initialUrl];
    const pageResults = [];

    const initialDomain = getDomain(initialUrl);
    if (!initialDomain) {
        console.error(`❌ Error: Invalid initial URL '${initialUrl}' for ${companyName}. Skipping.`);
        return;
    }

    console.log(`🚀 Starting email extraction for ${companyName}...`);

    while (urlsToVisitQueue.length > 0 && visitedUrls.size < MAX_PAGES_PER_SITE) {
        const currentUrl = urlsToVisitQueue.shift();
        
        if (visitedUrls.has(currentUrl)) {
            continue;
        }
        
        visitedUrls.add(currentUrl);

        try {
            const result = await processPage(browser, currentUrl);
            
            if (result.htmlContent) {
                // Extract emails from HTML content
                const emails = extractEmails(result.htmlContent);
                
                if (emails.length > 0) {
                    console.log(`📧 Found ${emails.length} emails on ${currentUrl}`);
                    emails.forEach(email => allEmails.add(email));
                }
                
                pageResults.push({
                    url: currentUrl,
                    emailCount: emails.length,
                    emails: emails
                });

                // Add discovered links to queue
                if (result.links && result.links.length > 0) {
                    result.links.forEach(link => {
                        if (!visitedUrls.has(link) && !urlsToVisitQueue.includes(link)) {
                            urlsToVisitQueue.push(link);
                        }
                    });
                }
            }

        } catch (error) {
            console.error(`❌ Failed to process ${currentUrl} for ${companyName}: ${error.message}`);
        }

        // Progress update
        if (visitedUrls.size % 5 === 0) {
            console.log(`📊 Progress for ${companyName}: ${visitedUrls.size} pages processed, ${allEmails.size} unique emails found, ${urlsToVisitQueue.length} remaining in queue`);
        }
    }

    // Save results
    const sanitizedName = sanitizeCompanyName(companyName);
    const fileName = `${sanitizedName}_emails.txt`;
    const filePath = path.join(OUTPUT_DIR, fileName);

    const emailsArray = Array.from(allEmails).sort();
    
    let fileContent = `Company: ${companyName}\n`;
    fileContent += `Website: ${initialUrl}\n`;
    fileContent += `Extraction Date: ${new Date().toISOString()}\n`;
    fileContent += `Total Pages Scanned: ${pageResults.length}\n`;
    fileContent += `Total Unique Emails Found: ${emailsArray.length}\n`;
    fileContent += `Domain: ${initialDomain}\n\n`;
    
    fileContent += `${'='.repeat(60)}\n`;
    fileContent += `EXTRACTED EMAIL ADDRESSES\n`;
    fileContent += `${'='.repeat(60)}\n\n`;
    
    if (emailsArray.length > 0) {
        emailsArray.forEach((email, index) => {
            fileContent += `${index + 1}. ${email}\n`;
        });
    } else {
        fileContent += `No email addresses found.\n`;
    }
    
    fileContent += `\n\n${'='.repeat(60)}\n`;
    fileContent += `PAGE-BY-PAGE BREAKDOWN\n`;
    fileContent += `${'='.repeat(60)}\n\n`;
    
    pageResults.forEach((result, index) => {
        fileContent += `Page ${index + 1}: ${result.url}\n`;
        fileContent += `Emails found: ${result.emailCount}\n`;
        if (result.emails.length > 0) {
            fileContent += `Emails: ${result.emails.join(', ')}\n`;
        }
        fileContent += `\n`;
    });

    fs.writeFileSync(filePath, fileContent, 'utf8');
    console.log(`✅ Email extraction complete for ${companyName}!`);
    console.log(`   📧 Total unique emails found: ${emailsArray.length}`);
    console.log(`   📄 Results saved to: ${filePath}`);
    
    return emailsArray.length;
}

/**
 * Main function
 */
async function main() {
    console.log('🚀 Starting Enhanced Email Extractor...\n');

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`📁 Created output directory: ${OUTPUT_DIR}`);
    }

    // Read company details
    const companies = readCompanyDetails();
    if (companies.length === 0) {
        console.error('❌ No companies found to process. Exiting.');
        return;
    }

    // Filter out already processed companies
    const companiesToProcess = companies.filter(company => {
        const exists = checkIfFileExists(company.companyName);
        if (exists) {
            console.log(`⏭️  Skipping ${company.companyName} - email file already exists`);
        }
        return !exists;
    });

    if (companiesToProcess.length === 0) {
        console.log('✅ All companies have already been processed!');
        return;
    }

    console.log(`📊 Processing ${companiesToProcess.length} companies (${companies.length - companiesToProcess.length} already completed)\n`);

    let browser;
    let totalEmailsFound = 0;
    
    try {
        // Launch browser with stealth settings
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-blink-features=AutomationControlled',
                '--no-default-browser-check',
                '--disable-extensions'
            ],
            defaultViewport: null
        });

        for (let i = 0; i < companiesToProcess.length; i++) {
            const company = companiesToProcess[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`🏢 [${i + 1}/${companiesToProcess.length}] Processing: ${company.companyName}`);
            console.log(`🌐 URL: ${company.url}`);
            console.log(`${'='.repeat(80)}`);

            try {
                const emailCount = await processSingleWebsite(browser, company.url, company.companyName);
                totalEmailsFound += emailCount || 0;
            } catch (error) {
                console.error(`❌ Error processing ${company.companyName}: ${error.message}`);
            }

            // Delay between companies
            if (i < companiesToProcess.length - 1) {
                const delay = Math.random() * 15000 + 10000; // 10-25 seconds
                console.log(`⏳ Waiting ${Math.ceil(delay / 1000)} seconds before next company...\n`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log(`\n🎉 Email extraction completed successfully!`);
        console.log(`📧 Total emails extracted across all companies: ${totalEmailsFound}`);

    } catch (error) {
        console.error('💥 Critical error in main process:', error);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed.');
        }
    }
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Start the email extractor
main().catch(err => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
});
