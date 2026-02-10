const REMOTE_WHOIS = "http://localhost:9701/whois";
const REMOTE_QUERY = "http://localhost:9701/query";
const REMOTE_QUERY_WS = "ws://localhost:9701/query";
const REMOTE_SUBMIT_RESULT = "http://localhost:9701/submit-result";
const REMOTE_STATS = "http://localhost:9701/stats";
const whitelistDbName = 'GhotiDefaultWL';
import { createLLMHandler, LLM_MESSAGE_TYPES } from './llm';
import { buildSimplePrompt, PHISHING_SCHEMA } from 'shared/prompt-builder.js';

// Initialize LLM handler
const llmHandler = createLLMHandler({
    onProgress: (progress) => {
        console.log('[Ghoti LLM] Loading:', progress.text);
    }
});

// Stats management
const STATS_KEY = 'ghoti_stats';

async function getStats() {
    const data = await chrome.storage.local.get(STATS_KEY);
    return data[STATS_KEY] || {
        totalScans: 0,
        localAnalyses: 0,
        remoteAnalyses: 0,
        phishingDetected: 0,
        safeDetected: 0,
        resultsUploaded: 0,
        lastScan: null,
        recentScans: [] // Keep last 50 scans
    };
}

async function updateStats(update) {
    const stats = await getStats();

    if (update.scan) {
        stats.totalScans++;
        stats.lastScan = new Date().toISOString();

        // Add to recent scans
        stats.recentScans.unshift({
            domain: update.scan.domain,
            url: update.scan.url,
            confidence: update.scan.confidence,
            isPhishing: update.scan.isPhishing,
            source: update.scan.source,
            timestamp: stats.lastScan
        });

        // Keep only last 50
        if (stats.recentScans.length > 50) {
            stats.recentScans = stats.recentScans.slice(0, 50);
        }

        if (update.scan.source === 'local') {
            stats.localAnalyses++;
        } else {
            stats.remoteAnalyses++;
        }

        if (update.scan.isPhishing) {
            stats.phishingDetected++;
        } else {
            stats.safeDetected++;
        }
    }

    if (update.uploaded) {
        stats.resultsUploaded++;
    }

    await chrome.storage.local.set({ [STATS_KEY]: stats });
    return stats;
}

// Upload result to server for improvement
async function uploadResultToServer(result, settings) {
    if (!settings.uploadLocalResults) {
        return { skipped: true, reason: 'Upload disabled' };
    }

    try {
        const response = await fetch(REMOTE_SUBMIT_RESULT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        });

        if (response.ok) {
            await updateStats({ uploaded: true });
            console.log('[Ghoti Background] Result uploaded to server');
            return { success: true };
        } else {
            return { success: false, error: await response.text() };
        }
    } catch (error) {
        console.warn('[Ghoti Background] Failed to upload result:', error.message);
        return { success: false, error: error.message };
    }
}

let dbInitPromise = new Promise(async (resolve, reject) => {
    const request = indexedDB.open(whitelistDbName, 1);
    let initDb = false;
    request.onupgradeneeded = async (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('whitelist')) {
            const objectStore = db.createObjectStore('whitelist', { keyPath: 'domain' });
            objectStore.createIndex('domain', 'domain', { unique: true });
            initDb = true;
            console.log('[Ghoti Background] Creating whitelist object store');
        }
    }
    request.onsuccess = async (event) => {
        console.log('[Ghoti Background] Whitelist DB initialized successfully');
        const db = event.target.result;
        if (initDb) {
            let csvFile = await fetch(chrome.runtime.getURL('whitelist.csv')).then(r => r.text());
            let entries = csvFile.split('\n').map(line => line.trim()).slice(1).filter(line => line && !line.startsWith('#')).map(line => {
                let domain = line.split(',')[1].trim();
                if (domain) {
                    if (domain.startsWith('"')) {
                        domain = JSON.parse(domain);
                    }
                    return domain;
                }
            }).filter(e => e);
            const domainObjectStore = db.transaction('whitelist', 'readwrite').objectStore('whitelist');
            console.log('[Ghoti Background] Adding initial whitelist entries');
            entries.forEach(domain => {
                domainObjectStore.add({ domain });
            });
            console.log('[Ghoti Background] Waiting for whitelist entries to be added');
            await new Promise(res => {
                domainObjectStore.transaction.oncomplete = () => res();
            });
            console.log('[Ghoti Background] Whitelist entries added');
        }
        db.close();
        resolve();
    }
    request.onerror = (event) => {
        console.error('[Ghoti Background] Error initializing whitelist DB:', event.target.error);
        reject(event.target.error);
    }
});

let domainExistsInWhitelist = async (domain, skipInit = false) => {
    if (!skipInit) await dbInitPromise;
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(whitelistDbName, 1);
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction('whitelist', 'readonly');
            const objectStore = transaction.objectStore('whitelist');
            const getRequest = objectStore.get(domain);
            getRequest.onsuccess = (event) => {
                resolve(!!event.target.result);
            };
            getRequest.onerror = (event) => {
                reject(event.target.error);
            };
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
};

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle LLM messages
    if (request.type?.startsWith('LLM_')) {
        llmHandler.handleMessage(request, sender)
            .then(sendResponse)
            .catch(error => {
                console.error('[Ghoti LLM] Error:', error);
                sendResponse({ error: error.message });
            });
        return true;
    }

    if (request.type === 'ANALYZE_PAGE') {
        handlePageAnalysis(request.data, sender.tab.id)
            .then(sendResponse)
            .catch(error => {
                console.error('[Ghoti Background] Error:', error);
                sendResponse({ error: error.message });
            });
        return true;
    }

    if (request.type === 'WHOIS_LOOKUP') {
        handleWhoisLookup(request.data)
            .then(sendResponse)
            .catch(error => {
                console.error('[Ghoti Background] WHOIS Error:', error);
                sendResponse({ error: error.message });
            });
        return true;
    }

    // Stats requests
    if (request.type === 'GET_STATS') {
        getStats()
            .then(sendResponse)
            .catch(error => {
                console.error('[Ghoti Background] Stats Error:', error);
                sendResponse({ error: error.message });
            });
        return true;
    }

    if (request.type === 'GET_SERVER_STATS') {
        fetch(REMOTE_STATS)
            .then(r => r.json())
            .then(sendResponse)
            .catch(error => {
                console.error('[Ghoti Background] Server Stats Error:', error);
                sendResponse({ error: error.message });
            });
        return true;
    }
});
let urlInWhiteList = async (url) => {
    //TODO: implement
    return false;
}

// Local LLM Analysis
async function analyzeWithLocalLLM(url, extractedData, whoisData, localThreshold) {
    const startTime = performance.now();
    const domain = new URL(url).hostname;

    console.log(`[Ghoti LLM] ▶ Starting analysis for: ${domain}`);
    console.log(`[Ghoti LLM]   URL: ${url}`);

    try {
        const handler = llmHandler; // Use existing handler instance

        console.log('[Ghoti LLM]   Current status:', handler.getStatus());

        // Ensure engine is initialized
        if (handler.getStatus() === 'uninitialized' || handler.getStatus() === 'error') {
            console.log('[Ghoti LLM]   Initializing engine...');
            const initResult = await handler.handleMessage({ type: LLM_MESSAGE_TYPES.INIT });
            console.log('[Ghoti LLM]   Init result:', initResult);
            if (initResult.error) {
                throw new Error('LLM init failed: ' + initResult.error);
            }
        }

        console.log('[Ghoti LLM]   Status after init:', handler.getStatus());

        // Build prompt using shared prompt builder (now with WHOIS data)
        const prompt = buildSimplePrompt({ url, extractedData, whoisData });
        console.log(`[Ghoti LLM]   Prompt length: ${prompt.length} chars`);

        // Reset chat history before each analysis to prevent message sequence errors
        await handler.handleMessage({ type: LLM_MESSAGE_TYPES.RESET });

        console.log(`[Ghoti LLM]   Generating response for ${domain}...`);
        const genStartTime = performance.now();

        const result = await handler.handleMessage({
            type: LLM_MESSAGE_TYPES.CHAT,
            message: prompt,
            options: {
                temperature: 0.1,
                max_tokens: 512, // Limit output tokens
                response_format: { type: "json_object" }
            }
        });

        const genTime = ((performance.now() - genStartTime) / 1000).toFixed(2);
        console.log(`[Ghoti LLM]   Generation complete in ${genTime}s`);

        if (result.error) throw new Error(result.error);

        console.log(`[Ghoti LLM]   Response length: ${result.content?.length || 0} chars`);
        console.log('[Ghoti LLM]   Raw response:', result.content);

        try {
            // Attempt to parse JSON from the response
            // Handle markdown code blocks if present
            let jsonStr = result.content;
            if (jsonStr.includes('```json')) {
                jsonStr = jsonStr.split('```json')[1].split('```')[0];
            } else if (jsonStr.includes('```')) {
                jsonStr = jsonStr.split('```')[1].split('```')[0];
            }

            const analysis = JSON.parse(jsonStr.trim());
            let confidence = analysis.confidence || 0;
            const reasoning = analysis.reasoning || "";

            // Lightweight sentiment analysis to detect contradictions
            const reasoningLower = reasoning.toLowerCase();

            // Negative indicators (suggesting phishing/danger) with weights
            const negativePatterns = [
                [/\bfake\b/g, 3], [/\bphishing\b/g, 4], [/\bmalicious\b/g, 4],
                [/\bscam\b/g, 4], [/\bfraudulent\b/g, 4], [/\bsuspicious\b/g, 2],
                [/\bnot legitimate\b/g, 3], [/\bnot real\b/g, 3], [/\bcredential.?theft\b/g, 4],
                [/\bimpersonat/g, 3], [/\bdeceptive\b/g, 3], [/\buntrustworthy\b/g, 3],
                [/\bdangerous\b/g, 3], [/\bharmful\b/g, 3], [/\bthreat\b/g, 2],
                [/\brisk factors?\b/g, 1], [/\bred flags?\b/g, 2], [/\bwarning\b/g, 1],
                [/\bsteal/g, 3], [/\bharvest/g, 3], [/\bcapture\b/g, 2],
            ];

            // Positive indicators (suggesting safety/legitimacy) with weights
            const positivePatterns = [
                [/\bsafe\b/g, 3], [/\blegitimate\b/g, 3], [/\btrustworthy\b/g, 3],
                [/\bgenuine\b/g, 3], [/\bauthentic\b/g, 3], [/\bno.{0,5}risk/g, 2],
                [/\blow.{0,5}risk/g, 2], [/\bnot.{0,10}phishing/g, 3], [/\bverified\b/g, 2],
                [/\bestablished\b/g, 2], [/\breputable\b/g, 3], [/\bbenign\b/g, 2],
                [/\bnormal\b/g, 1], [/\bstandard\b/g, 1], [/\blegit\b/g, 2],
            ];

            // Calculate sentiment scores
            let negativeScore = 0, positiveScore = 0;
            for (const [pattern, weight] of negativePatterns) {
                const matches = reasoningLower.match(pattern);
                if (matches) negativeScore += matches.length * weight;
            }
            for (const [pattern, weight] of positivePatterns) {
                const matches = reasoningLower.match(pattern);
                if (matches) positiveScore += matches.length * weight;
            }

            // Net sentiment: positive = safe, negative = dangerous
            const netSentiment = positiveScore - negativeScore;

            // Detect and correct contradictions based on sentiment vs confidence
            // If reasoning is very negative (sentiment < -3) but confidence is low
            if (netSentiment <= -3 && confidence < 50) {
                const adjustedConfidence = Math.min(75, 50 + Math.abs(netSentiment) * 3);
                console.warn(`[Ghoti LLM] ⚠ Sentiment contradiction: reasoning sentiment=${netSentiment} (negative) but confidence=${confidence}. Adjusting to ${adjustedConfidence}.`);
                confidence = adjustedConfidence;
            }
            // If reasoning is very positive (sentiment > 3) but confidence is high
            else if (netSentiment >= 3 && confidence > 50) {
                const adjustedConfidence = Math.max(15, 50 - netSentiment * 3);
                console.warn(`[Ghoti LLM] ⚠ Sentiment contradiction: reasoning sentiment=${netSentiment} (positive) but confidence=${confidence}. Adjusting to ${adjustedConfidence}.`);
                confidence = adjustedConfidence;
            }

            // Derive isPhishing from confidence vs localThreshold
            const isPhishing = confidence > localThreshold;

            const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`[Ghoti LLM] ✓ Analysis complete for: ${domain}`);
            console.log(`[Ghoti LLM]   Confidence: ${confidence}% | Phishing: ${isPhishing} | Sentiment: ${netSentiment} | Total time: ${totalTime}s`);
            console.log(`[Ghoti LLM]   Reasoning: ${reasoning.slice(0, 100)}...`);

            return {
                isPhishing,
                confidence,
                reasoning: reasoning || "No reasoning provided",
                raw: result.content
            };
        } catch (e) {
            const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
            console.warn(`[Ghoti LLM] ⚠ Parse failed for: ${domain} (${totalTime}s)`);
            console.warn('[Ghoti LLM]   Error:', e.message);
            return {
                isPhishing: false, // Default to safe if parse fails
                confidence: 0,
                error: "JSON_PARSE_ERROR",
                reasoning: "Failed to parse local analysis. Raw response: " + (result.content || "").slice(0, 200),
                raw: result.content
            };
        }
    } catch (error) {
        const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
        console.error(`[Ghoti LLM] ✗ Analysis failed for: ${domain} (${totalTime}s)`);
        console.error('[Ghoti LLM]   Error:', error.message);
        return { error: error.message };
    }
}

async function handlePageAnalysis(data, tabId) {
    const { url, extractedData, domain, automatedMode } = data;
    let urlObj = new URL(url);

    // Check Settings
    const settings = await chrome.storage.sync.get({
        localThreshold: 30,
        globalThreshold: 60,
        autoScanOnStartup: false,
        uploadLocalResults: false, // New setting for result upload
        compareMode: false // Run both local and remote for testing
    });

    // Auto-enable compareMode when running under Puppeteer/automation
    if (automatedMode) {
        settings.compareMode = true;
        console.log('[Ghoti Background] Automated mode detected - compareMode enabled');
    }

    let domainInWhitelist = await domainExistsInWhitelist(urlObj.hostname);
    if (domainInWhitelist) {
        console.log('[Ghoti Background] Domain in whitelist, skipping analysis:', urlObj.hostname);
        return { success: true, whoisResult: null, queryResult: { finalRating: 0, response: "Domain is whitelisted." } };
    }
    let urlInWhitelist = await urlInWhiteList(url);
    if (urlInWhitelist) {
        console.log('[Ghoti Background] URL in whitelist, skipping analysis:', url);
        return { success: true, whoisResult: null, queryResult: { finalRating: 0, response: "URL is whitelisted." } }
    }

    console.log('[Ghoti Background] Analyzing page:', url);
    console.log('[Ghoti Background] Extracted data:', extractedData);

    // 0. Fetch WHOIS first (needed for both local and remote)
    let whoisData = null;
    try {
        const whoisResponse = await fetch(REMOTE_WHOIS, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version: "0.1.0", domain })
        });
        if (whoisResponse.ok) {
            whoisData = await whoisResponse.json();
            console.log('[Ghoti Background] WHOIS data:', whoisData);
        }
    } catch (e) {
        console.warn('[Ghoti Background] WHOIS fetch failed:', e.message);
    }

    // 1. Run Local Analysis (with WHOIS data)
    const localAnalysis = await analyzeWithLocalLLM(url, extractedData, whoisData, settings.localThreshold);
    console.log('[Ghoti Background] Local Analysis Result:', localAnalysis);

    let localSuspicion = 0;
    if (!localAnalysis.error) {
        localSuspicion = localAnalysis.confidence || 0;
    }

    // 2. Decide whether to use Remote Analysis
    // In compareMode, always run both
    const shouldUseRemote = settings.compareMode ||
        localSuspicion > settings.localThreshold ||
        localAnalysis.error;

    if (!shouldUseRemote) {
        console.log(`[Ghoti Background] Local suspicion (${localSuspicion}%) <= Threshold (${settings.localThreshold}%). Trusted locally.`);

        const isPhishing = localSuspicion > settings.localThreshold;

        // Update stats for local analysis
        await updateStats({
            scan: {
                domain: urlObj.hostname,
                url: url,
                confidence: localSuspicion,
                isPhishing: isPhishing,
                source: 'local'
            }
        });

        // Upload result to server if enabled
        if (settings.uploadLocalResults) {
            uploadResultToServer({
                url: url,
                domain: urlObj.hostname,
                confidence: localSuspicion,
                isPhishing: isPhishing,
                reasoning: localAnalysis.reasoning,
                riskFactors: extractedData?.riskIndicators || [],
                extractedData: extractedData,
                modelUsed: 'local-webllm'
            }, settings).catch(err => console.warn('[Ghoti Background] Upload failed:', err));
        }

        return {
            success: true,
            whoisResult: null,
            queryResult: {
                finalRating: localSuspicion,
                response: localAnalysis.reasoning || "Analyzed locally, deemed safe.",
                source: "local"
            }
        };
    }

    // If in compareMode, log that we're running both
    if (settings.compareMode) {
        console.log(`[Ghoti Background] Compare mode: running remote analysis alongside local (${localSuspicion}%)...`);
    } else if (localAnalysis.error) {
        console.log(`[Ghoti Background] Local analysis failed: ${localAnalysis.error}. Escalating to remote...`);
    } else {
        console.log(`[Ghoti Background] Local suspicion (${localSuspicion}%) > Threshold (${settings.localThreshold}%). Escalating to remote...`);
    }

    try {
        // Reuse the WHOIS data we already fetched for local analysis
        const whoisResult = whoisData;
        const queryPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(REMOTE_QUERY_WS);
            let connectionEstablished = false;

            ws.onopen = () => {
                console.log('[Ghoti Background] WebSocket connected');
                // Wait for connection confirmation before sending data
            };

            ws.onmessage = (event) => {
                const response = JSON.parse(event.data);
                console.log('[Ghoti Background] WebSocket message:', response);

                if (response.type === 'connected') {
                    // Connection established, send the query
                    connectionEstablished = true;
                    // Send extracted data to server
                    // If we have page content from the extension, send it; otherwise tell server to fetch
                    const payload = {
                        version: "0.1.0",
                        url: url,
                        extractedData: extractedData,
                    };

                    if (data.sendPageContent && data.pageContent) {
                        // Use page content from extension (captures personalized/geo-specific content)
                        payload.pageContent = data.pageContent;
                        payload.fetchContent = false;
                        console.log('[Ghoti Background] Sending page content from extension');
                    } else {
                        // Tell server to fetch page content itself
                        payload.fetchContent = true;
                        console.log('[Ghoti Background] Server will fetch page content');
                    }

                    ws.send(JSON.stringify(payload));
                } else if (response.type === 'progress') {
                    // Progress update - log it
                    console.log('[Ghoti Background] Progress:', response.status, '-', response.message);
                } else if (response.type === 'result') {
                    // Final result received
                    ws.close();
                    if (response.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response.error || 'WebSocket query failed'));
                    }
                } else if (response.type === 'error') {
                    // Error received
                    ws.close();
                    reject(new Error(response.error || 'WebSocket query failed'));
                }
            };

            ws.onerror = (error) => {
                console.error('[Ghoti Background] WebSocket error:', error);
                ws.close();
                reject(new Error('WebSocket connection error'));
            };

            ws.onclose = (event) => {
                if (!event.wasClean && connectionEstablished) {
                    console.error('[Ghoti Background] WebSocket closed unexpectedly');
                }
            };
        });

        // Wait for query to complete (we already have whoisResult)
        const queryResult = await queryPromise;

        console.log('[Ghoti Background] WHOIS result:', whoisResult);
        console.log('[Ghoti Background] Query result:', queryResult);

        // Update stats for remote analysis
        const isPhishing = queryResult.finalRating >= settings.globalThreshold;
        await updateStats({
            scan: {
                domain: urlObj.hostname,
                url: url,
                confidence: queryResult.finalRating,
                isPhishing: isPhishing,
                source: settings.compareMode ? 'compare' : 'remote'
            }
        });

        // In compare mode, return both results
        if (settings.compareMode) {
            return {
                success: true,
                whoisResult,
                queryResult: { ...queryResult, source: "remote" },
                localResult: {
                    finalRating: localSuspicion,
                    response: localAnalysis.reasoning || "Local analysis result",
                    source: "local",
                    error: localAnalysis.error || null
                }
            };
        }

        return {
            success: true,
            whoisResult,
            queryResult: { ...queryResult, source: "remote" }
        };
    } catch (error) {
        console.error('[Ghoti Background] Remote Analysis failed:', error);
        // Fallback to local result if remote fails?
        if (!localAnalysis.error) {
            // Update stats for local fallback
            await updateStats({
                scan: {
                    domain: urlObj.hostname,
                    url: url,
                    confidence: localSuspicion,
                    isPhishing: localSuspicion > settings.localThreshold,
                    source: 'local'
                }
            });

            return {
                success: true,
                whoisResult: null,
                queryResult: {
                    finalRating: localSuspicion,
                    response: localAnalysis.reasoning + " (Remote analysis failed)",
                    source: "local-fallback"
                }
            };
        }
        throw error;
    }
}

// Handle WHOIS lookup only
async function handleWhoisLookup(data) {
    const { domain } = data;

    try {
        const response = await fetch(REMOTE_WHOIS, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                version: "0.1.0",
                domain: domain
            })
        });

        const result = await response.json();
        console.log('[Ghoti Background] WHOIS result:', result);

        return {
            success: true,
            result
        };
    } catch (error) {
        console.error('[Ghoti Background] WHOIS lookup failed:', error);
        throw error;
    }
}

// Log when the service worker starts
console.log('[Ghoti Background] Service worker started');

// Auto-scan on startup
chrome.runtime.onStartup.addListener(async () => {
    const settings = await chrome.storage.sync.get({ autoScanOnStartup: false });
    if (settings.autoScanOnStartup) {
        console.log('[Ghoti Background] Auto-scan enabled, scanning all tabs...');
        const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
        for (const tab of tabs) {
            // Inject script if not present (although content script should be automatic for matches)
            // But we need to trigger the analysis explicitly if the content script just sits there waiting for events?
            // Looking at inject.js, it calls analyzePage() on load.
            // So simply reloading might be aggressive. 
            // Best to message the tab to rescan.
            try {
                chrome.tabs.sendMessage(tab.id, { type: 'RESCAN_PAGE' });
            } catch (e) {
                // Content script might not be ready or injected
            }
        }
    }
});
