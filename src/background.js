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

// Global state
let analysisResult = null;
let currentTabId = null;
let llmLoaded = false;
let llmLoadingPromise = null;

let SESSION_NONCE = null;

// Track last scanned URL per tab to prevent duplicate scans
const lastScannedUrl = new Map();

// TrackTabs that need scanning but wasn't ready to receive START_SCAN
const pendingScans = new Map();

// Helper to manage per-tab scan status in session storage (persists through SW suspension)
async function getTabScanStatus(tabId) {
    const key = `scan_status_${tabId}`;
    const data = await chrome.storage.session.get(key);
    return data[key];
}

async function setTabScanStatus(tabId, statusObj) {
    const key = `scan_status_${tabId}`;
    await chrome.storage.session.set({ [key]: statusObj });
}

// Cache scan results for cacheScannedPages setting
const pageCache = new Map(); // url -> { timestamp, result }

// Generate unique scan ID
function generateScanId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Update the extension icon badge
 */
function updateBadge(tabId, count, isScanning) {
    if (isScanning) {
        chrome.action.setBadgeText({ tabId, text: "..." });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#6B7280" }); // Grey
        return;
    }

    if (count > 0) {
        chrome.action.setBadgeText({ tabId, text: count.toString() });
        // Set color based on risk level if we have a threshold, but for now red/orange
        chrome.action.setBadgeBackgroundColor({ tabId, color: count > 3 ? "#F87171" : "#FBBF24" }); // Red or Orange
    } else {
        chrome.action.setBadgeText({ tabId, text: "" });
    }
}

/**
 * Broadcast scan progress to both the content script (tab) and popup/extension views.
 */
async function broadcastScanProgress(tabId, status, message) {
    const statusObj = { status, message, timestamp: Date.now() };
    await setTabScanStatus(tabId, statusObj);
    updateBadge(tabId, null, true);
    chrome.tabs.sendMessage(tabId, { type: 'SCAN_PROGRESS', status, message }).catch(() => { });
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', tabId, status, message }).catch(() => { });
}

/**
 * Finalize a scan result and broadcast completion.
 */
async function finalizeAndReturn(tabId, result, count) {
    // Signal completion to tab and popup
    const statusObj = {
        status: 'complete',
        riskCount: count,
        result: result, // Store full result for popup sync
        timestamp: Date.now()
    };
    await setTabScanStatus(tabId, statusObj);

    updateBadge(tabId, count, false);

    chrome.tabs.sendMessage(tabId, { type: 'SCAN_COMPLETE', result }).catch(() => { });
    chrome.runtime.sendMessage({
        type: 'SCAN_COMPLETE',
        tabId,
        result,
        riskCount: count
    }).catch(() => { });

    return result;
}

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
            body: JSON.stringify({
                ...result,
                clientId: SESSION_NONCE
            })
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

/**
 * Get candidate domains for whitelist lookup.
 * For "www.google.com" returns ["www.google.com", "google.com"].
 * For "policies.google.com" returns ["policies.google.com", "google.com"].
 * Respects multi-part TLDs like .com.tr, .co.uk.
 */
function getWhitelistCandidates(hostname) {
    const candidates = [hostname];
    const parts = hostname.split('.');
    // Determine how many parts the TLD occupies
    const tldParts = (parts.length >= 3 && parts[parts.length - 2].length <= 3) ? 3 : 2;
    // Strip subdomains progressively down to root+TLD
    for (let i = 1; i <= parts.length - tldParts; i++) {
        candidates.push(parts.slice(i).join('.'));
    }
    return candidates;
}

let domainExistsInWhitelist = async (domain, skipInit = false) => {
    if (!skipInit) await dbInitPromise;
    const candidates = getWhitelistCandidates(domain);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(whitelistDbName, 1);
        request.onsuccess = (event) => {
            const db = event.target.result;
            const transaction = db.transaction('whitelist', 'readonly');
            const objectStore = transaction.objectStore('whitelist');
            let remaining = candidates.length;
            let found = false;
            for (const candidate of candidates) {
                const getRequest = objectStore.get(candidate);
                getRequest.onsuccess = (event) => {
                    if (event.target.result) found = true;
                    remaining--;
                    if (remaining === 0) resolve(found);
                };
                getRequest.onerror = (event) => {
                    remaining--;
                    if (remaining === 0) resolve(found);
                };
            }
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

    // Whitelist exemption management
    if (request.type === 'GET_EXEMPT_LIST') {
        chrome.storage.sync.get({ whitelistExemptions: DEFAULTS.whitelistExemptions }, (data) => {
            sendResponse({ exemptions: data.whitelistExemptions });
        });
        return true;
    }

    if (request.type === 'ADD_EXEMPT_DOMAIN') {
        chrome.storage.sync.get({ whitelistExemptions: DEFAULTS.whitelistExemptions }, (data) => {
            const list = data.whitelistExemptions || [];
            const domain = request.domain?.trim().toLowerCase();
            if (domain && !list.includes(domain)) {
                list.push(domain);
                chrome.storage.sync.set({ whitelistExemptions: list }, () => {
                    sendResponse({ success: true, exemptions: list });
                });
            } else {
                sendResponse({ success: false, exemptions: list, error: 'Zaten listede veya geçersiz.' });
            }
        });
        return true;
    }

    if (request.type === 'GET_SCAN_STATUS') {
        chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
            if (tab) {
                const statusData = await getTabScanStatus(tab.id);
                if (statusData) {
                    sendResponse({
                        scanning: statusData.status !== 'complete',
                        ...statusData
                    });
                } else {
                    sendResponse({ scanning: false });
                }
            } else {
                sendResponse({ scanning: false });
            }
        });
        return true;
    }

    if (request.type === 'REMOVE_EXEMPT_DOMAIN') {
        chrome.storage.sync.get({ whitelistExemptions: DEFAULTS.whitelistExemptions }, (data) => {
            const list = (data.whitelistExemptions || []).filter(d => d !== request.domain);
            chrome.storage.sync.set({ whitelistExemptions: list }, () => {
                sendResponse({ success: true, exemptions: list });
            });
        });
        return true;
    }

    if (request.type === 'CONTENT_SCRIPT_READY') {
        const tabId = sender.tab?.id;
        const url = request.url || sender.tab?.url;

        if (tabId && url) {
            console.log(`[Ghoti Background] Content script ready acknowledged for tab ${tabId} (${url})`);

            // Only trigger a scan if we explicitly queued this tab because it failed the initial onUpdated attempt
            // OR if autoScanOnStartup is enabled and we haven't scanned it yet
            chrome.storage.sync.get(DEFAULTS, (settings) => {
                if (settings.isActive) {
                    if (pendingScans.get(tabId) === url || (settings.autoScanOnStartup && lastScannedUrl.get(tabId) !== url)) {
                        // Move from pending to scanned
                        pendingScans.delete(tabId);
                        lastScannedUrl.set(tabId, url);

                        console.log(`[Ghoti Background] Late injection or auto-startup scan triggered on tab ${tabId}`);
                        chrome.tabs.sendMessage(tabId, {
                            type: 'START_SCAN',
                            scanId: generateScanId()
                        }).catch(() => { });
                    } else if (!settings.autoScanOnStartup) {
                        console.log(`[Ghoti Background] Tab ${tabId} ready, but no pending scan required`);
                    }
                }
            });
        }
        sendResponse({ success: true });
        return false; // synchronous response
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
                max_tokens: 2048 // Increased to prevent truncation of thinking/reasoning
            }
        });

        if (step1Result.error) throw new Error("Reasoning step failed: " + step1Result.error);
        let reasoning = step1Result.content || "No reasoning generated.";

        // Strip <think>...</think> blocks (Qwen 3 chain-of-thought)
        // These are internal reasoning tokens that shouldn't be passed to Step 2
        // However, some small models put their entire output in the think block.
        const thinkMatch = reasoning.match(/<think>([\s\S]*?)<\/think>/i);
        let strippedReasoning = reasoning.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();

        if (!strippedReasoning && thinkMatch && thinkMatch[1].trim()) {
            // Model outputted nothing but a think block. We must use its internal thoughts as the reasoning.
            reasoning = "(Düşünce Zinciri) " + thinkMatch[1].trim();
            console.log(`[Ghoti LLM] Model only outputted <think> block. Falling back to thinking as reasoning.`);
        } else if (strippedReasoning) {
            reasoning = strippedReasoning;
        }

        if (!reasoning) reasoning = "No reasoning generated.";

        console.log(`[Ghoti LLM] Step 1 complete. Reasoning length: ${reasoning.length}`);

        // === STEP 2: GENERATE SCORE ===
        const scoringPrompt = buildLocalScoringPrompt(reasoning);
        console.log(`[Ghoti LLM] Step 2: Generating score for ${domain}...`);

        const step2Result = await handler.handleMessage({
            type: LLM_MESSAGE_TYPES.CHAT,
            message: scoringPrompt,
            options: {
                temperature: 0.15, // Low temperature for consistent scoring
                max_tokens: 512 // Increased buffer
            }
        });

        if (step2Result.error) throw new Error("Scoring step failed: " + step2Result.error);

        const genTime = ((performance.now() - genStartTime) / 1000).toFixed(2);
        console.log(`[Ghoti LLM] Chain complete in ${genTime}s`);

        // Fallback: derive score from Step 1's own conclusion when Step 2 fails
        // Fallback: derive score from Step 1's own analysis when Step 2 fails
        const fallbackToStep1 = (reason) => {
            const fullText = reasoning.toUpperCase();
            const riskIndicators = extractedData?.riskIndicators || [];

            // Check if the analysis acknowledges severe risks
            const phishingKeywords = [
                'RISK INDICATOR', 'IMPERSONATION', 'DECEPTIVE', 'ALMOST ALWAYS PHISHING',
                'HIGH RISK', 'HIGH-RISK', 'CREDENTIAL THEFT', 'MALICIOUS',
                'SUSPICIOUS TLD', 'PHISHING ATTEMPT', 'FAKE APPLICATION', '🚨'
            ];

            // Check if analysis explicitly concludes it's safe without risks
            const safeKeywords = [
                'LEGITIMATE', 'NO DECEPTIVE PATTERNS', 'NO SUSPICIOUS',
                'NORMAL AND EXPECTED', 'HARMLESS'
            ];

            const phishingHits = phishingKeywords.filter(k => fullText.includes(k)).length;
            const safeHits = safeKeywords.filter(k => fullText.includes(k)).length;

            if (phishingHits > 0 && phishingHits >= safeHits) {
                const score = verdictToScore('PHISHING', 4, reasoning, riskIndicators);
                console.log(`[Ghoti LLM] Step 1 fallback (${reason}): detected ${phishingHits} risk keywords in analysis → ${score}%`);
                return score;
            } else if (safeHits > 0 && safeHits > phishingHits) {
                const score = verdictToScore('SAFE', 4);
                console.log(`[Ghoti LLM] Step 1 fallback (${reason}): detected mostly safe keywords → ${score}%`);
                return score;
            } else {
                console.log(`[Ghoti LLM] Step 1 fallback (${reason}): ambiguous analysis → 12.5%`);
                return 12.5;
            }
        };

        let confidence = 0;
        try {
            let jsonStr = step2Result.content.trim();
            console.log(`[Ghoti LLM] Step 2 raw output:`, jsonStr);
            // Try to extract from markdown blocks first
            if (jsonStr.includes('```')) {
                const matches = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (matches && matches[1]) jsonStr = matches[1].trim();
            }

            try {
                const analysis = JSON.parse(jsonStr);
                const riskIndicators = extractedData?.riskIndicators || [];
                if (analysis.verdict !== undefined && analysis.severity !== undefined) {
                    confidence = verdictToScore(analysis.verdict, analysis.severity, reasoning, riskIndicators);
                } else if (analysis.phishingRisk !== undefined) {
                    confidence = analysis.phishingRisk;
                } else if (analysis.confidence !== undefined) {
                    confidence = analysis.confidence;
                } else if (analysis.score !== undefined) {
                    confidence = analysis.score;
                } else {
                    // Valid JSON but no useful fields (e.g. {})
                    confidence = fallbackToStep1('empty JSON');
                }
            } catch (jsonErr) {
                const riskIndicators = extractedData?.riskIndicators || [];
                const verdictMatch = jsonStr.match(/"?verdict"?\s*:\s*"?([A-Za-z]+)"?/i);
                const severityMatch = jsonStr.match(/"?severity"?\s*:\s*(\d+)/i);

                const riskMatch = jsonStr.match(/"?phishingRisk"?\s*:\s*(\d+)/i);
                const confMatch = jsonStr.match(/"?confidence"?\s*:\s*(\d+)/i);
                const scoreMatch = jsonStr.match(/"?score"?\s*:\s*(\d+)/i);

                if (verdictMatch && severityMatch) {
                    confidence = verdictToScore(verdictMatch[1], parseInt(severityMatch[1]), reasoning, riskIndicators);
                } else if (riskMatch) {
                    confidence = parseInt(riskMatch[1]);
                } else if (confMatch) {
                    confidence = parseInt(confMatch[1]);
                } else if (scoreMatch) {
                    confidence = parseInt(scoreMatch[1]);
                } else {
                    throw jsonErr;
                }
            }
        } catch (e) {
            console.warn("[Ghoti LLM] Step 2 parsing failed completely:", e.message);
            confidence = fallbackToStep1('parse failure');
        }

        // Derive isPhishing from confidence vs localThreshold
        const isPhishing = confidence > localThreshold;

        console.log(`[Ghoti LLM] ✓ Analysis complete: ${confidence}% | Phishing: ${isPhishing}`);

        return {
            isPhishing,
            confidence,
            reasoning,
            riskFactors: extractedData?.riskIndicators || [],
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
    const settings = await chrome.storage.sync.get(DEFAULTS);

    // Auto-enable compareMode when running under Puppeteer/automation
    if (automatedMode) {
        settings.compareMode = true;
        console.log('[Ghoti Background] Automated mode detected - compareMode enabled');
    }

    // Check if domain is exempt from whitelist (e.g. sites.google.com hosts user content)
    const exemptions = settings.whitelistExemptions || [];
    const domainIsExempt = getWhitelistCandidates(urlObj.hostname).some(c => exemptions.includes(c));
    if (domainIsExempt) {
        console.log('[Ghoti Background] Domain is exempt from whitelist, forcing analysis:', urlObj.hostname);
    }

    let domainInWhitelist = !domainIsExempt && await domainExistsInWhitelist(urlObj.hostname);
    if (domainInWhitelist) {
        console.log('[Ghoti Background] Domain in whitelist, skipping analysis:', urlObj.hostname);
        return { success: true, whoisResult: null, queryResult: { finalRating: 0, response: "Domain is whitelisted." } };
    }
    let urlInWhitelist = await urlInWhiteList(url);
    if (urlInWhitelist) {
        console.log('[Ghoti Background] URL in whitelist, skipping analysis:', url);
        return { success: true, whoisResult: null, queryResult: { finalRating: 0, response: "URL is whitelisted." } }
    }

    // Check Cache
    if (settings.cacheScannedPages && pageCache.has(urlObj.href)) {
        const cached = pageCache.get(urlObj.href);
        if (Date.now() - cached.timestamp < 3600000) { // 1 hour
            console.log('[Ghoti Background] Returning cached result for:', urlObj.href);
            // Broadcast completion
            await setTabScanStatus(tabId, null);
            chrome.runtime.sendMessage({
                type: 'SCAN_COMPLETE',
                tabId: tabId,
                result: cached.result
            }).catch(() => { });
            return cached.result;
        } else {
            pageCache.delete(urlObj.href);
        }
    }

    // Helper to finalize, cache, broadcast, and return
    const finalizeAndReturn = async (result) => {
        if (settings.cacheScannedPages && result.success && result.localResult?.source !== 'error') {
            pageCache.set(urlObj.href, { timestamp: Date.now(), result });
        }

        const riskCount = (result.queryResult?.riskFactors?.length) || (extractedData?.riskIndicators?.length) || 0;
        await setTabScanStatus(tabId, { status: 'complete', result, riskCount, timestamp: Date.now() });
        updateBadge(tabId, riskCount, false);

        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            tabId: tabId,
            result: result,
            riskCount: riskCount
        }).catch(() => { });
        return result;
    };

    console.log('[Ghoti Background] Analyzing page:', url);
    console.log('[Ghoti Background] Extracted data:', extractedData);

    // 0. Fetch Extension-Init Data (WHOIS + known phishing check)
    let whoisData = null;
    let isKnownPhishing = false;
    try {
        broadcastScanProgress(tabId, 'fetching_init', 'Sunucuyla iletişim kuruluyor...');
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
    broadcastScanProgress(tabId, 'local_analysis', 'Yerel analiz yapılıyor...');
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
        isKnownPhishing || // Force remote analysis if global DB flagged it but local thinks it's safe
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
            isKnownPhishing: isKnownPhishing, // Pass the known status from DB
            whoisResult: null,
            queryResult: null, // No remote analysis for trusted sites
            localResult: {
                finalRating: localSuspicion,
                response: localAnalysis.reasoning || "Analyzed locally, deemed safe.",
                source: "local",
                riskFactors: localAnalysis.riskFactors || [], // Ensure risks are passed
                error: null
            }
        };

        return finalizeAndReturn(result);
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
        broadcastScanProgress(tabId, 'remote_analysis', 'Sunucu-tabanlı analiz yapılıyor...');
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
                        clientId: SESSION_NONCE,
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

        // Merge extracted risk indicators with server reported ones to fix popup visibility empty array bug
        if (extractedData?.riskIndicators && extractedData.riskIndicators.length > 0) {
            queryResult.riskFactors = [...new Set([...(queryResult.riskFactors || []), ...extractedData.riskIndicators])];
        }

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
                isKnownPhishing: isKnownPhishing,
                scanId: data.scanId, // Echo back the scanId
                whoisResult,
                queryResult: { ...queryResult, source: "remote" },
                localResult: {
                    finalRating: localSuspicion,
                    response: localAnalysis.reasoning || "Local analysis result",
                    source: "local",
                    riskFactors: localAnalysis.riskFactors || [],
                    error: localAnalysis.error || null
                }
            };

            return finalizeAndReturn(result);
        }

        const result = {
            success: true,
            isKnownPhishing: isKnownPhishing,
            whoisResult,
            queryResult: { ...queryResult, source: "remote" },
            localResult: {
                finalRating: localSuspicion,
                response: localAnalysis.reasoning || "Local analysis result",
                source: "local",
                riskFactors: localAnalysis.riskFactors || [],
                error: localAnalysis.error || null
            }
        };

        return finalizeAndReturn(result);
    } catch (error) {
        console.error('[Ghoti Background] Remote Analysis failed:', error);
        // Fallback to local result if remote fails?
        if (!localAnalysis.error) {
            // Determine fallback threshold: custom if enabled, otherwise use global threshold
            const fallbackThreshold = settings.useCustomFallbackThreshold
                ? settings.localFallbackThreshold
                : settings.globalThreshold;

            // Update stats for local fallback
            await updateStats({
                scan: {
                    domain: urlObj.hostname,
                    url: url,
                    confidence: localSuspicion,
                    localConfidence: localSuspicion,
                    remoteConfidence: null,
                    isPhishing: localSuspicion > fallbackThreshold,
                    source: 'local-fallback'
                }
            });

            const result = {
                success: true,
                whoisResult: whoisData, // Preserve WHOIS if it was fetched before remote failed
                queryResult: null, // Remote failed
                localResult: {
                    finalRating: localSuspicion,
                    response: localAnalysis.reasoning || "Local analysis result",
                    source: "local-fallback",
                    error: localAnalysis.error || null
                }
            };

            return finalizeAndReturn(result);
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

        return finalizeAndReturn(errorResult);
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
                // If it succeeds, mark as scanned. If it fails, CONTENT_SCRIPT_READY will catch it when we visit the tab
                chrome.tabs.sendMessage(tab.id, {
                    type: 'START_SCAN',
                    scanId: generateScanId()
                }).then(() => {
                    if (tab.url) lastScannedUrl.set(tab.id, tab.url);
                }).catch(() => { });
            } catch (e) {
                // Content script might not be ready
            }
        }
    }
});

// Scan on navigation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Clear tracking when a new navigation starts (allows rescan on refresh)
    if (changeInfo.status === 'loading' && !changeInfo.url) {
        // We only clear if it's a structural load, not just a URL fragment change/SPA
        // Setting it here might be too aggressive if SPAs trigger loading status
        lastScannedUrl.delete(tabId);
        pendingScans.delete(tabId);
        return;
    }

    const settings = await chrome.storage.sync.get(DEFAULTS);

    // Trigger on full page load completion OR SPA URL change (if enabled)
    const isCompleteLoad = changeInfo.status === 'complete' && tab.url;
    const isUrlChange = changeInfo.url !== undefined && tab.status === 'complete';

    // If not a full load, ensure SPA scanning is permitted
    const shouldTriggerBasedOnNavType = isCompleteLoad || (isUrlChange && settings.scanOnSpaNavigation);

    if (shouldTriggerBasedOnNavType && tab.url && tab.url.startsWith('http')) {
        // Skip if we already scanned this exact URL in this tab
        if (lastScannedUrl.get(tabId) === tab.url) {
            console.log(`[Ghoti Background] Tab ${tabId} already scanned for ${tab.url}, skipping duplicate.`);
            return;
        }

        if (settings.isActive) {
            console.log(`[Ghoti Background] Navigation detected on tab ${tabId} (URL: ${tab.url}), triggering scan...`);

            // Try sending immediately. If it fails, inject.js will send CONTENT_SCRIPT_READY later
            chrome.tabs.sendMessage(tabId, {
                type: 'START_SCAN',
                scanId: generateScanId()
            }).then(() => {
                // Success - script was already there
                lastScannedUrl.set(tabId, tab.url);
                pendingScans.delete(tabId);
            }).catch(() => {
                // Failed - script not injected yet. Add to pending scans so CONTENT_SCRIPT_READY will handle it.
                pendingScans.set(tabId, tab.url);
                console.log(`[Ghoti Background] Tab ${tabId} not ready, queued in pendingScans to wait for CONTENT_SCRIPT_READY`);
            });
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

// Tab listeners to persist badge
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const status = await getTabScanStatus(tabId);
    if (status) {
        if (status.status === 'complete') {
            updateBadge(tabId, status.riskCount, false);
        } else {
            updateBadge(tabId, null, true);
        }
    } else {
        chrome.action.setBadgeText({ tabId, text: "" });
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        const url = tab.url;
        const lastScanned = lastScannedUrl.get(tabId);

        // If it's a new URL or a hard reload, clear the badge
        if (url !== lastScanned) {
            await setTabScanStatus(tabId, null);
            chrome.action.setBadgeText({ tabId, text: "" });
        }
    }
});
