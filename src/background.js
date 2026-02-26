const REMOTE_INIT = "http://localhost:9701/extension-init";
const REMOTE_QUERY = "http://localhost:9701/query";
const REMOTE_QUERY_WS = "ws://localhost:9701/query";
const REMOTE_SUBMIT_RESULT = "http://localhost:9701/submit-result";
const REMOTE_STATS = "http://localhost:9701/stats";
const REMOTE_WHOIS = "http://localhost:9701/whois";
const whitelistDbName = 'GhotiDefaultWL';
import { createLLMHandler, LLM_MESSAGE_TYPES } from './llm';
import { buildSimplePrompt, buildLocalReasoningPrompt, buildLocalScoringPrompt, PHISHING_SCHEMA, verdictToScore } from 'shared/prompt-builder.js';
import { DEFAULTS } from './config/defaults.js';

// Logging buffer for Settings page
let MAX_LOGS = DEFAULTS.maxLogs;
const logBuffer = [];

// Keep MAX_LOGS in sync with user settings
chrome.storage.sync.get({ maxLogs: DEFAULTS.maxLogs }, data => { MAX_LOGS = data.maxLogs; });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.maxLogs) {
        MAX_LOGS = changes.maxLogs.newValue;
    }
});
let SESSION_NONCE = null;

// Track last scanned URL per tab to prevent duplicate auto-scans
const lastScannedUrl = new Map();

async function initSessionNonce() {
    const data = await chrome.storage.local.get('SESSION_NONCE');
    if (data.SESSION_NONCE) {
        SESSION_NONCE = data.SESSION_NONCE;
        console.log(`[Ghoti Background] Restored Session Nonce: ${SESSION_NONCE}`);
    } else {
        SESSION_NONCE = Math.random().toString(36).substring(2, 15);
        await chrome.storage.local.set({ SESSION_NONCE });
        console.log(`[Ghoti Background] Generated New Session Nonce: ${SESSION_NONCE}`);
    }

    // Sync with server
    try {
        const response = await fetch("http://localhost:9701/register-session", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghoti-Nonce': SESSION_NONCE
            },
            body: JSON.stringify({ nonce: SESSION_NONCE })
        });
        if (response.ok) {
            console.log('[Ghoti Background] Session registered with server');
        }
    } catch (e) {
        console.warn('[Ghoti Background] Failed to register session with server:', e.message);
    }
}

function generateScanId() {
    return `${SESSION_NONCE}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function addBufferedLog(type, message) {
    // Privacy filter: Do not log messages that look like huge prompts
    // Prompts usually have many newlines and instructions
    if (typeof message === 'string') {
        const newlineCount = (message.match(/\n/g) || []).length;
        if (newlineCount > 10 || message.length > 2000) {
            // Check for common prompt keywords to be sure
            const promptKeywords = ['system', 'user', 'assistant', 'phishing', 'score', 'reasoning'];
            const lowerMsg = message.toLowerCase();
            const hasKeywords = promptKeywords.filter(k => lowerMsg.includes(k)).length >= 2;

            if (hasKeywords || newlineCount > 20) {
                // Log a placeholder instead
                message = `[Prompt Filtered for Privacy] (${message.length} chars)`;
            }
        }
    }

    const log = {
        timestamp: new Date().toISOString(),
        type,
        message
    };
    logBuffer.push(log);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();

    // Broadcast to settings page if open
    chrome.runtime.sendMessage({ type: 'LOG_ENTRY', log }).catch(() => { });
}

// Heartbeat to keep background script / service worker alive
function setupHeartbeat() {
    const ALARM_NAME = 'GhotiHeartbeat';
    const INTERVAL_SECONDS = 25;

    console.log(`[Ghoti Heartbeat] Setting up heartbeat every ${INTERVAL_SECONDS}s...`);

    chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_SECONDS / 60 });

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === ALARM_NAME) {
            // Trivial extension API call to reset the idle timer
            chrome.storage.local.get([STATS_KEY], () => {
                const now = new Date().toLocaleTimeString();
                // We don't want to spam the log buffer with heartbeats, 
                // so we just log to the real console
                originalLog.apply(console, [`[Ghoti Heartbeat] 💓 Pulsed at ${now}`]);
            });
        }
    });

    // Also send a heartbeat message to the script itself every 25s
    // to ensure the internal timers and event loop stay active
    setInterval(() => {
        chrome.runtime.sendMessage({ type: 'HEARTBEAT_TICK' }).catch(() => { });
    }, INTERVAL_SECONDS * 1000);
}

// Override console methods to buffer logs
const originalLog = console.log;
console.log = function (...args) {
    originalLog.apply(console, args);
    addBufferedLog('info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

const originalWarn = console.warn;
console.warn = function (...args) {
    originalWarn.apply(console, args);
    addBufferedLog('warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

const originalError = console.error;
console.error = function (...args) {
    originalError.apply(console, args);
    addBufferedLog('error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
};

// Initialize LLM handler
const llmHandler = createLLMHandler({
    onProgress: (progress) => {
        console.log('[Ghoti LLM] Loading:', progress.text);
    }
});

// Initialize settings on installation
chrome.runtime.onInstalled.addListener(async () => {
    console.log('[Ghoti Background] Extension installed/updated, initializing settings...');
    const currentSettings = await chrome.storage.sync.get(null);
    const newSettings = { ...DEFAULTS, ...currentSettings };
    await chrome.storage.sync.set(newSettings);
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
            confidence: update.scan.confidence, // Primary confidence (remote if available)
            localConfidence: update.scan.localConfidence || null,
            remoteConfidence: update.scan.remoteConfidence || null,
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
        const { SESSION_NONCE } = await chrome.storage.local.get('SESSION_NONCE');
        const response = await fetch(REMOTE_SUBMIT_RESULT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Ghoti-Nonce': SESSION_NONCE || ''
            },
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

    if (request.type === 'GET_LOGS') {
        sendResponse({ logs: logBuffer });
        return true;
    }

    if (request.type === 'CLEAR_STATS') {
        chrome.storage.local.set({ [STATS_KEY]: null }, () => {
            sendResponse({ success: true });
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

        // === STEP 1: GENERATE REASONING ===
        const reasoningPrompt = buildLocalReasoningPrompt({ url, extractedData, whoisData });
        console.log(`[Ghoti LLM] Step 1: Generating reasoning for ${domain}...`);

        // Reset chat history
        await handler.handleMessage({ type: LLM_MESSAGE_TYPES.RESET });

        const genStartTime = performance.now();
        const step1Result = await handler.handleMessage({
            type: LLM_MESSAGE_TYPES.CHAT,
            message: reasoningPrompt,
            options: {
                temperature: 0.2, // Slightly higher for reasoning
                max_tokens: 512
            }
        });

        if (step1Result.error) throw new Error("Reasoning step failed: " + step1Result.error);
        const reasoning = step1Result.content || "No reasoning generated.";
        console.log(`[Ghoti LLM] Step 1 complete. Reasoning length: ${reasoning.length}`);

        // === STEP 2: GENERATE SCORE ===
        const scoringPrompt = buildLocalScoringPrompt(reasoning);
        console.log(`[Ghoti LLM] Step 2: Generating score for ${domain}...`);

        const step2Result = await handler.handleMessage({
            type: LLM_MESSAGE_TYPES.CHAT,
            message: scoringPrompt,
            options: {
                temperature: 0.15, // Low temperature for consistent scoring
                max_tokens: 128,
                response_format: { type: "json_object" }
            }
        });

        if (step2Result.error) throw new Error("Scoring step failed: " + step2Result.error);

        const genTime = ((performance.now() - genStartTime) / 1000).toFixed(2);
        console.log(`[Ghoti LLM] Chain complete in ${genTime}s`);

        let confidence = 0;
        try {
            let jsonStr = step2Result.content.trim();
            // Try to extract from markdown blocks first
            if (jsonStr.includes('```')) {
                const matches = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (matches && matches[1]) jsonStr = matches[1].trim();
            }

            try {
                const analysis = JSON.parse(jsonStr);
                if (analysis.verdict !== undefined && analysis.severity !== undefined) {
                    confidence = verdictToScore(analysis.verdict, analysis.severity);
                } else {
                    confidence = analysis.phishingRisk !== undefined ? analysis.phishingRisk : (analysis.confidence !== undefined ? analysis.confidence : analysis.score !== undefined ? analysis.score : 0);
                }
            } catch (jsonErr) {
                // Fallback 1: Regex for properties
                const verdictMatch = jsonStr.match(/"?verdict"?\s*:\s*"?([A-Za-z]+)"?/i);
                const severityMatch = jsonStr.match(/"?severity"?\s*:\s*(\d+)/i);

                const riskMatch = jsonStr.match(/"?phishingRisk"?\s*:\s*(\d+)/i);
                const confMatch = jsonStr.match(/"?confidence"?\s*:\s*(\d+)/i);
                const scoreMatch = jsonStr.match(/"?score"?\s*:\s*(\d+)/i);

                if (verdictMatch && severityMatch) {
                    confidence = verdictToScore(verdictMatch[1], parseInt(severityMatch[1]));
                } else if (riskMatch) {
                    confidence = parseInt(riskMatch[1]);
                } else if (confMatch) {
                    confidence = parseInt(confMatch[1]);
                } else if (scoreMatch) {
                    confidence = parseInt(scoreMatch[1]);
                } else {
                    // Fallback 2: Any number in a response that looks like just a number or "Score: 10"
                    const simpleNumberMatch = jsonStr.match(/(\d+)/);
                    if (simpleNumberMatch) {
                        confidence = parseInt(simpleNumberMatch[1]);
                    } else {
                        throw jsonErr;
                    }
                }
            }
        } catch (e) {
            console.error("[Ghoti LLM] All score extraction methods failed:", e);
            confidence = 0; // Default to safe if we truly can't parse anything
        }

        // Derive isPhishing from confidence vs localThreshold
        const isPhishing = confidence > localThreshold;

        console.log(`[Ghoti LLM] ✓ Analysis complete: ${confidence}% | Phishing: ${isPhishing}`);

        return {
            isPhishing,
            confidence,
            reasoning,
            raw: step1Result.content + "\n\nSCORE_JSON: " + step2Result.content
        };

    } catch (error) {
        const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
        console.error(`[Ghoti LLM] ✗ Chain failed for: ${domain} (${totalTime}s)`);
        console.error('[Ghoti LLM]   Error:', error.message);
        return {
            isPhishing: false,
            confidence: 0,
            error: error.message,
            reasoning: "Local analysis failed: " + error.message
        };
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
        compareMode: false, // Run both local and remote for testing
        sendDomainOnlyUntilPhishing: true // New setting for privacy
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

    // 0. Fetch Extension-Init Data (WHOIS + known phishing check)
    let whoisData = null;
    let isKnownPhishing = false;
    try {
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROGRESS', status: 'fetching_init', message: 'Sunucuyla iletişim kuruluyor...' }).catch(() => { });
        let payloadUrl = settings.sendDomainOnlyUntilPhishing ? urlObj.hostname : url;
        const { SESSION_NONCE } = await chrome.storage.local.get('SESSION_NONCE');
        const initResponse = await fetch(REMOTE_INIT, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "X-Ghoti-Nonce": SESSION_NONCE || ''
            },
            body: JSON.stringify({ version: "0.1.0", url: payloadUrl })
        });
        if (initResponse.ok) {
            const initData = await initResponse.json();
            if (initData.success) {
                whoisData = initData.whoisData;
                isKnownPhishing = initData.isKnownPhishing;
                console.log('[Ghoti Background] WHOIS data:', whoisData);
                console.log('[Ghoti Background] Known Phishing status:', isKnownPhishing);

                // If known phishing, trigger early warning in the browser tab immediately
                if (isKnownPhishing) {
                    chrome.tabs.sendMessage(tabId, { type: 'SHOW_EARLY_WARNING', scanId: data.scanId }).catch(() => { });
                }
            }
        }
    } catch (e) {
        console.warn('[Ghoti Background] Extension-Init fetch failed:', e.message);
    }

    // 1. Run Local Analysis (with WHOIS data)
    chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROGRESS', status: 'local_analysis', message: 'Yerel analiz yapılıyor...' }).catch(() => { });
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
                localConfidence: localSuspicion,
                remoteConfidence: null,
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

        const result = {
            success: true,
            whoisResult: null,
            queryResult: null, // No remote analysis for trusted sites
            localResult: {
                finalRating: localSuspicion,
                response: localAnalysis.reasoning || "Analyzed locally, deemed safe.",
                source: "local",
                error: null
            }
        };

        // Broadcast completion
        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            tabId: tabId,
            result: result
        }).catch(() => { });

        return result;
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
        chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROGRESS', status: 'remote_analysis', message: 'Sunucu-tabanlı analiz yapılıyor...' }).catch(() => { });
        // Reuse the WHOIS data we already fetched for local analysis
        const whoisResult = whoisData;
        const queryPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(REMOTE_QUERY_WS);
            let connectionEstablished = false;

            ws.onopen = () => {
                console.log('[Ghoti Background] WebSocket connected');
                // Start keep-alive ping
                const pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 20000); // Ping every 20s

                // Clean up interval on close
                ws.addEventListener('close', () => clearInterval(pingInterval));
                ws.addEventListener('error', () => clearInterval(pingInterval));
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
                localConfidence: localSuspicion,
                remoteConfidence: queryResult.finalRating,
                isPhishing: isPhishing,
                source: settings.compareMode ? 'compare' : 'remote'
            }
        });

        // In compare mode, return both results
        if (settings.compareMode) {
            const result = {
                success: true,
                scanId: data.scanId, // Echo back the scanId
                whoisResult,
                queryResult: { ...queryResult, source: "remote" },
                localResult: {
                    finalRating: localSuspicion,
                    response: localAnalysis.reasoning || "Local analysis result",
                    source: "local",
                    error: localAnalysis.error || null
                }
            };

            // Broadcast completion
            chrome.runtime.sendMessage({
                type: 'SCAN_COMPLETE',
                tabId: tabId,
                result: result
            }).catch(() => { });

            return result;
        }

        const result = {
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

        // Broadcast completion to all extension views (including popup)
        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            tabId: tabId,
            result: result
        }).catch(() => { });

        return result;
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
                    localConfidence: localSuspicion,
                    remoteConfidence: null,
                    isPhishing: localSuspicion > settings.localThreshold,
                    source: 'local'
                }
            });

            const result = {
                success: true,
                whoisResult: whoisData, // Preserve WHOIS if it was fetched before remote failed
                queryResult: null, // Remote failed
                localResult: {
                    finalRating: localSuspicion,
                    response: localAnalysis.reasoning || "Local analysis result",
                    source: "local",
                    error: localAnalysis.error || null
                }
            };

            // Broadcast completion (remote failed, falling back to local)
            chrome.runtime.sendMessage({
                type: 'SCAN_COMPLETE',
                tabId: tabId,
                result: result
            }).catch(() => { });

            return result;
        }

        // Both local and remote failed - return graceful error instead of throwing
        console.error('[Ghoti Background] Both local and remote analysis failed');
        const errorResult = {
            success: true,
            whoisResult: whoisData,
            queryResult: null,
            localResult: {
                finalRating: 0,
                response: `Analiz başarısız: ${localAnalysis.error || 'Bilinmeyen hata'}. Sunucuya da ulaşılamadı.`,
                source: "error",
                error: error.message
            }
        };

        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            tabId: tabId,
            result: errorResult
        }).catch(() => { });

        return errorResult;
    }
}

// Handle WHOIS lookup only
async function handleWhoisLookup(data) {
    const { domain } = data;

    try {
        const { SESSION_NONCE } = await chrome.storage.local.get('SESSION_NONCE');
        const response = await fetch(REMOTE_WHOIS, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "X-Ghoti-Nonce": SESSION_NONCE || ''
            },
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

// Auto-scan on startup (Mass scan of all tabs)
chrome.runtime.onStartup.addListener(async () => {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    if (settings.isActive && settings.autoScanOnStartup) {
        console.log('[Ghoti Background] Auto-scan enabled, scanning all tabs...');
        const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
        for (const tab of tabs) {
            try {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'START_SCAN',
                    scanId: generateScanId()
                });
            } catch (e) {
                // Content script might not be ready
            }
        }
    }
});

// Scan on navigation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Clear tracking when a new navigation starts (allows rescan on refresh)
    if (changeInfo.status === 'loading') {
        lastScannedUrl.delete(tabId);
        return;
    }

    // Only trigger when navigation is complete and URL is available
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        // Skip if we already scanned this exact URL in this tab
        // (guards against duplicate 'complete' events from Chromium)
        if (lastScannedUrl.get(tabId) === tab.url) {
            console.log(`[Ghoti Background] Tab ${tabId} already scanned for ${tab.url}, skipping duplicate.`);
            return;
        }

        const settings = await chrome.storage.sync.get(DEFAULTS);
        if (settings.isActive) {
            lastScannedUrl.set(tabId, tab.url);
            console.log(`[Ghoti Background] Navigation detected on tab ${tabId}, triggering scan...`);
            try {
                // We use START_SCAN instead of RESCAN_PAGE for the automatic trigger
                chrome.tabs.sendMessage(tabId, {
                    type: 'START_SCAN',
                    scanId: generateScanId()
                });
            } catch (e) {
                // Content script not yet ready, it will trigger itself via load event if we hadn't removed it
                // Wait, if it's a fresh injection, the content script will be there.
            }
        }
    }
});

// Clean up tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    lastScannedUrl.delete(tabId);
});

// Initialize LLM and Session on boot
(async () => {
    await initSessionNonce();

    const settings = await chrome.storage.sync.get(DEFAULTS);
    if (settings.preloadLLM && settings.isActive) {
        console.log('[Ghoti Background] Pre-loading LLM model...');
        try {
            await llmHandler.handleMessage({ type: LLM_MESSAGE_TYPES.INIT });
        } catch (e) {
            console.error('[Ghoti Background] Failed to pre-load LLM:', e);
        }
    }
})();

// Start heartbeat
setupHeartbeat();
