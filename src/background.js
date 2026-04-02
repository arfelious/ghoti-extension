
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (url, options) {
    console.log('[Ghoti SW Fetch]', url);
    try {
        const res = await originalFetch(url, options);
        console.log('[Ghoti SW Fetch Success]', url, res.status);
        return res;
    } catch (e) {
        console.error('[Ghoti SW Fetch Error]', url, e.message);
        throw e;
    }
};

const REMOTE_INIT = "http://localhost:9701/extension-init";
const REMOTE_QUERY = "http://localhost:9701/query";
const REMOTE_QUERY_WS = "ws://localhost:9701/query";
const REMOTE_SUBMIT_RESULT = "http://localhost:9701/submit-result";
const REMOTE_STATS = "http://localhost:9701/stats";
const REMOTE_WHOIS = "http://localhost:9701/whois";
const REMOTE_AUTH_VERIFY = "http://localhost:9701/auth/verify";
const whitelistDbName = 'GhotiDefaultWL';
import { createLLMHandler, LLM_MESSAGE_TYPES } from './llm';
import { buildSimplePrompt, buildLocalReasoningPrompt, buildLocalScoringPrompt, PHISHING_SCHEMA, verdictToScore } from 'shared/prompt-builder.js';
import { DEFAULTS } from './config/defaults.js';
import { SERVER_BASE } from './config/env.js';

// Logging buffer for Settings page
let MAX_LOGS = DEFAULTS.maxLogs;
const logBuffer = [];

// Keep MAX_LOGS in sync with user settings
chrome.storage.sync.get({ maxLogs: DEFAULTS.maxLogs }, data => { MAX_LOGS = data.maxLogs; });
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.maxLogs) {
        MAX_LOGS = changes.maxLogs.newValue;
    }

    /*
    // Diagnostic Trace for Auth Keys (Phase 2.3)
    if (area === 'local') {
        const trackedKeys = ['AUTH_TOKEN', 'USER_SUB', 'auth_token', 'user_sub', 'SESSION_NONCE'];
        const intersection = Object.keys(changes).filter(key => trackedKeys.includes(key));

        if (intersection.length > 0) {
            console.log('[Ghoti Storage Trace] Auth-related keys changed:');
            intersection.forEach(key => {
                const { oldValue, newValue } = changes[key];
                console.log(`  - ${key}: ${JSON.stringify(oldValue)} -> ${JSON.stringify(newValue)}`);
            });
        }
    }
    */
});

// Global state
let analysisResult = null;
let currentTabId = null;
let llmLoaded = false;
let llmLoadingPromise = null;
// Auth state
let AUTH_TOKEN = null;
let USER_SUB = null;
let SESSION_NONCE = null; // Legacy fallback, kept for backward compat

// Initialization promise to handle race conditions - initialized early
let backgroundInitResolve;
const backgroundInitPromise = new Promise(resolve => {
    backgroundInitResolve = resolve;
});

// Track last scanned URL per tab to prevent duplicate scans
const lastScannedUrl = new Map();

// Track main document ETag for cloaking detection (tabId -> etag)
const tabEtags = new Map();

chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (details.type === 'main_frame') {
            const etagHeader = details.responseHeaders.find(h => h.name.toLowerCase() === 'etag');
            if (etagHeader) {
                tabEtags.set(details.tabId, etagHeader.value);
            } else {
                tabEtags.delete(details.tabId);
            }
        }
    },
    { urls: ['<all_urls>'], types: ['main_frame'] },
    ['responseHeaders']
);

// Track tabs that need scanning but weren't ready
const pendingScans = new Map();

// Debounce timers for same-domain navigations (tabId -> timeoutId)
const sameDomainDebounceTimers = new Map();

// LRU Cache Limits
const DECISION_CACHE_LIMIT = 1000;
const DETAILED_CACHE_LIMIT = 200;
const CACHE_KEYS = {
    DECISIONS: 'ghoti_decision_cache',
    DETAILS: 'ghoti_detailed_cache',
    STATUS: 'ghoti_tab_status'
};

/**
 * Prune a result object for storage by removing redundant/large fields.
 */
function pruneResultForStorage(result) {
    if (!result) return null;
    const pruned = JSON.parse(JSON.stringify(result));
    if (pruned.localResult) delete pruned.localResult.raw;
    if (pruned.queryResult) delete pruned.queryResult.raw;
    return pruned;
}

/**
 * Update an LRU cache in chrome.storage.local.
 */
async function updateLRUCache(cacheKey, itemKey, value, limit) {
    const data = await chrome.storage.local.get(cacheKey);
    const cache = data[cacheKey] || {};

    cache[itemKey] = { ...value, _cachedAt: Date.now() };

    const keys = Object.keys(cache);
    if (keys.length > limit) {
        const sorted = keys.sort((a, b) => cache[a]._cachedAt - cache[b]._cachedAt);
        const toRemove = sorted.slice(0, keys.length - limit);
        toRemove.forEach(k => delete cache[k]);
    }

    await chrome.storage.local.set({ [cacheKey]: cache });
}

async function getTabScanStatus(tabId) {
    const key = `scan_status_${tabId}`;
    const data = await chrome.storage.session.get(key);
    const status = data[key];

    if (status && status.url && status.status === 'complete') {
        const detailData = await chrome.storage.local.get(CACHE_KEYS.DETAILS);
        const details = (detailData[CACHE_KEYS.DETAILS] || {})[status.url];
        if (details) {
            if (status.result.queryResult) {
                status.result.queryResult.response = details.queryReasoning || details.reasoning;
                status.result.queryResult.riskFactors = details.riskFactors;
            }
            if (status.result.localResult) {
                status.result.localResult.response = details.localReasoning || details.reasoning;
                status.result.localResult.riskFactors = details.riskFactors;
            }

            // Re-evaluate if it's suspicious based on hydrated result
            let finalRating = status.result.queryResult ? status.result.queryResult.finalRating : (status.result.localResult ? status.result.localResult.finalRating : 0);
            let isSuspicious = finalRating > 60 || status.result.isKnownPhishing;
            status.riskCount = isSuspicious ? details.riskFactors.length : 0;
        }
    }
    return status;
}

async function setTabScanStatus(tabId, statusObj) {
    const key = `scan_status_${tabId}`;
    if (!statusObj) {
        await chrome.storage.session.remove(key);
        return;
    }

    if (statusObj.status === 'complete' && statusObj.result) {
        const url = statusObj.result.url || statusObj.url;
        const prunedResult = pruneResultForStorage(statusObj.result);

        const rating = statusObj.result.queryResult?.finalRating || statusObj.result.localResult?.finalRating || 0;
        const decision = {
            rating: rating,
            isKnownPhishing: !!statusObj.result.isKnownPhishing,
            timestamp: Date.now()
        };
        await updateLRUCache(CACHE_KEYS.DECISIONS, url, decision, DECISION_CACHE_LIMIT);

        const details = {
            reasoning: prunedResult.queryResult?.response || prunedResult.localResult?.response,
            queryReasoning: prunedResult.queryResult?.response || null,
            localReasoning: prunedResult.localResult?.response || null,
            riskFactors: prunedResult.queryResult?.riskFactors || prunedResult.localResult?.riskFactors || [],
            source: prunedResult.queryResult ? 'remote' : 'local'
        };
        await updateLRUCache(CACHE_KEYS.DETAILS, url, details, DETAILED_CACHE_LIMIT);

        const sessionStatus = {
            status: 'complete',
            url: url,
            riskCount: details.riskFactors.length,
            timestamp: statusObj.timestamp || Date.now(),
            result: {
                success: true,
                isKnownPhishing: decision.isKnownPhishing,
                queryResult: statusObj.result.queryResult ? { finalRating: rating } : null,
                localResult: statusObj.result.localResult ? { finalRating: rating } : null
            }
        };
        await chrome.storage.session.set({ [key]: sessionStatus });
    } else {
        await chrome.storage.session.set({ [key]: statusObj });
    }
}

// Decisions and Details are managed via CACHE_KEYS and updateLRUCache

// Generate unique scan ID
function generateScanId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Update the extension icon badge
 */
function updateBadge(tabId, count, isScanning) {
    if (isScanning) {
        chrome.action.setBadgeText({ tabId, text: "..." }).catch(() => { });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#6B7280" }).catch(() => { }); // Grey
        return;
    }

    if (count > 0) {
        chrome.action.setBadgeText({ tabId, text: count.toString() }).catch(() => { });
        // Set color based on risk level if we have a threshold, but for now red/orange
        chrome.action.setBadgeBackgroundColor({ tabId, color: count > 3 ? "#F87171" : "#FBBF24" }).catch(() => { }); // Red or Orange
    } else {
        chrome.action.setBadgeText({ tabId, text: "" }).catch(() => { });
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
    let finalRating = result.queryResult ? result.queryResult.finalRating : (result.localResult ? result.localResult.finalRating : 0);
    // Settings are async, but since this is an older finalize wrapper, we assume globalThreshold=60 if missing
    let isSuspicious = finalRating > 60 || result.isKnownPhishing;

    // Signal completion to tab and popup
    const statusObj = {
        status: 'complete',
        riskCount: count,
        result: result, // Store full result for popup sync
        timestamp: Date.now()
    };
    await setTabScanStatus(tabId, statusObj);

    updateBadge(tabId, isSuspicious ? count : 0, false);

    chrome.tabs.sendMessage(tabId, { type: 'SCAN_COMPLETE', result }).catch(() => { });
    chrome.runtime.sendMessage({
        type: 'SCAN_COMPLETE',
        tabId,
        result,
        riskCount: count
    }).catch(() => { });

    return result;
}

// ========== AUTH LAYER ==========

// Domains where we watch for ghoti login
const GHOTI_DOMAINS = ['ghoti.com.tr', 'www.ghoti.com.tr', 'localhost', '127.0.0.1'];

function isGhotiUrl(url) {
    try {
        const u = new URL(url);
        // Match official domains or local dev server
        const isOfficial = ['ghoti.com.tr', 'www.ghoti.com.tr'].includes(u.hostname);
        const isLocalDev = (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.port === '9701' || u.port === 9701);

        const match = isOfficial || isLocalDev;
        if (match) console.log('[Ghoti Auth] isGhotiUrl true for:', url);
        return match;
    } catch { return false; }
}

/**
 * Get the auth headers for server requests.
 * Uses Bearer token if authenticated, falls back to nonce.
 */
function getAuthHeaders() {
    if (AUTH_TOKEN) {
        return { 'Authorization': `Bearer ${AUTH_TOKEN}` };
    }
    if (SESSION_NONCE) {
        return { 'X-Ghoti-Nonce': SESSION_NONCE };
    }
    return {};
}

/**
 * Get the clientId for request bodies.
 */
function getClientId() {
    return USER_SUB || SESSION_NONCE || null;
}

/**
 * Check if the user is authenticated (has a valid server-issued token).
 */
function isAuthenticated() {
    return !!(AUTH_TOKEN && USER_SUB);
}

/**
 * Layer 1: On startup, try to restore auth from chrome.storage.local
 */
async function initAuth() {
    console.log('[Ghoti Auth] Starting initAuth...');
    // Check both casings to support migration from older buggy builds
    const data = await chrome.storage.local.get(['AUTH_TOKEN', 'USER_SUB', 'auth_token', 'user_sub', 'SESSION_NONCE']);
    console.log('[Ghoti Auth] Storage Load Result:', JSON.stringify(data));
    console.log('[Ghoti Auth] Raw storage keys found:', Object.keys(data));

    // Try restoring OAuth session first (preferring uppercase)
    const token = data.AUTH_TOKEN || data.auth_token;
    const sub = data.USER_SUB || data.user_sub;

    if (token && sub) {
        AUTH_TOKEN = token;
        USER_SUB = sub;
        console.log(`[Ghoti Auth] Restored token for user: ${USER_SUB} (Token length: ${token.length})`);

        // Migrate to uppercase if we found lowercase
        if (data.auth_token || data.user_sub) {
            console.log('[Ghoti Auth] Migrating lowercase storage keys to uppercase...');
            await chrome.storage.local.set({ AUTH_TOKEN: token, USER_SUB: sub });
            await chrome.storage.local.remove(['auth_token', 'user_sub']);
        }

        // Verify token with server
        try {
            console.log('[Ghoti Auth] Verifying token with server...');
            const response = await fetch(REMOTE_AUTH_VERIFY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${AUTH_TOKEN}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                console.log('[Ghoti Auth] Token verified successfully for:', result.user?.name || 'Unknown');
                // Update sub in case it changed
                if (result.user?.sub && result.user.sub !== USER_SUB) {
                    console.log(`[Ghoti Auth] Updating USER_SUB: ${USER_SUB} -> ${result.user.sub}`);
                    USER_SUB = result.user.sub;
                    await chrome.storage.local.set({ USER_SUB });
                }
            } else {
                console.warn('[Ghoti Auth] Token verification failed (status:', response.status, '), clearing auth');
                const errText = await response.text().catch(() => 'No body');
                console.debug('[Ghoti Auth] Server response:', errText);
                await clearAuth();
            }
        } catch (e) {
            console.warn('[Ghoti Auth] Server unreachable for verification, keeping stored token:', e.message);
            // Keep token - server might just be down
        }
    } else {
        console.log('[Ghoti Auth] No stored token found in storage.');
    }

    // Legacy nonce fallback
    if (!AUTH_TOKEN && data.SESSION_NONCE) {
        SESSION_NONCE = data.SESSION_NONCE;
        console.log(`[Ghoti Auth] Restored legacy session nonce: ${SESSION_NONCE}`);
    }

    // Broadcast auth state to popup/settings
    broadcastAuthState();
}

/**
 * Layer 2: Tab watcher — detect login on ghoti.com.tr or localhost:9701
 */
function setupLoginWatcher() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        // Only check completed navigations
        if (changeInfo.status !== 'complete' || !tab.url) return;

        if (!isGhotiUrl(tab.url)) return;

        // Already authenticated? No need to check
        if (isAuthenticated()) {
            console.log('[Ghoti Auth] Already authenticated, skipping watcher check for tab:', tabId);
            return;
        }

        console.log(`[Ghoti Auth] Watcher detected ghoti page load: ${tab.url}, checking for session in localStorage...`);

        try {
            // Read localStorage from the ghoti page to get token
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    return {
                        token: localStorage.getItem('ghoti_token'),
                        sub: localStorage.getItem('ghoti_user_sub'),
                        name: localStorage.getItem('ghoti_user_name')
                    };
                }
            });

            const pageData = results?.[0]?.result;
            if (pageData?.token && pageData?.sub) {
                console.log(`[Ghoti Auth] Scraped session from page! User: ${pageData.name} (${pageData.sub})`);
                AUTH_TOKEN = pageData.token;
                USER_SUB = pageData.sub;
                await chrome.storage.local.set({
                    AUTH_TOKEN: pageData.token,
                    USER_SUB: pageData.sub
                });
                console.log('[Ghoti Auth] Scraped session saved to storage.');
                broadcastAuthState();
            } else {
                console.log('[Ghoti Auth] No session tokens found in page localStorage.');
            }
        } catch (e) {
            console.debug('[Ghoti Auth] Could not read login state from tab:', e.message);
        }
    });
}

/**
 * Startup sweep: Query all open tabs for a Ghoti session to avoid needing a reload
 */
async function syncAuthenticatedTabs() {
    console.log('[Ghoti Auth] Starting startup sweep for existing sessions in open tabs...');
    try {
        const tabs = await chrome.tabs.query({});
        const ghotiTabs = tabs.filter(t => t.url && isGhotiUrl(t.url));

        if (ghotiTabs.length === 0) {
            console.log('[Ghoti Auth] No Ghoti tabs found in sweep.');
            return;
        }

        console.log(`[Ghoti Auth] Found ${ghotiTabs.length} Ghoti tabs. Proactively checking for sessions...`);

        for (const tab of ghotiTabs) {
            // Already found a token in a previous tab?
            if (isAuthenticated()) break;

            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        return {
                            token: localStorage.getItem('ghoti_token'),
                            sub: localStorage.getItem('ghoti_user_sub'),
                            name: localStorage.getItem('ghoti_user_name')
                        };
                    }
                });

                const pageData = results?.[0]?.result;
                if (pageData?.token && pageData?.sub) {
                    console.log(`[Ghoti Auth] Recovery success from tab ${tab.id}! User: ${pageData.name}`);
                    AUTH_TOKEN = pageData.token;
                    USER_SUB = pageData.sub;
                    await chrome.storage.local.set({
                        AUTH_TOKEN: pageData.token,
                        USER_SUB: pageData.sub
                    });
                    broadcastAuthState();
                    break; // Stop after first success
                }
            } catch (e) {
                console.debug(`[Ghoti Auth] Could not scrape tab ${tab.id}:`, e.message);
            }
        }
    } catch (err) {
        console.error('[Ghoti Auth] Sweep failed:', err);
    }
}

const LLM_PORT_NAME = 'llm-service';
const ngramCache = {}; // Cache for shared text assets (turkish.txt, ngrams.txt)

// --- Initialization ---
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.storage.sync.set(DEFAULTS);
        const loginUrl = `${SERVER_BASE}/login`;
        console.log(`[Ghoti Auth] Extension installed, opening login page: ${loginUrl}`);
        chrome.tabs.create({ url: loginUrl });
    }
    initializeNgramCache();
});

chrome.runtime.onStartup.addListener(() => {
    initializeNgramCache();
});

// Pre-load dictionaries to avoid latency during analysis
async function initializeNgramCache() {
    const assets = ['turkish.txt', 'ngrams.txt'];
    for (const asset of assets) {
        try {
            const url = chrome.runtime.getURL(asset);
            const res = await fetch(url);
            if (res.ok) {
                ngramCache[asset] = await res.text();
                console.log(`[Ghoti Background] Pre-loaded cache for: ${asset}`);
            }
        } catch (e) {
            console.error(`[Ghoti Background] Failed to pre-load ${asset}:`, e);
        }
    }
}

/**
 * Clear auth state
 */
async function clearAuth() {
    AUTH_TOKEN = null;
    USER_SUB = null;
    await chrome.storage.local.remove(['AUTH_TOKEN', 'USER_SUB']);
    broadcastAuthState();
}

/**
 * Broadcast auth state change to popup/settings
 */
function broadcastAuthState() {
    chrome.runtime.sendMessage({
        type: 'AUTH_STATE_CHANGED',
        isAuthenticated: isAuthenticated(),
        userSub: USER_SUB
    }).catch(() => { });
}

// Start login watcher immediately
setupLoginWatcher();

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

    if (chrome.alarms) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_SECONDS / 60 });

        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === ALARM_NAME) {
                // Trivial extension API call to reset the idle timer
                chrome.storage.local.get([STATS_KEY], () => {
                    const now = new Date().toLocaleTimeString();
                    // Log to the real console to avoid flooding the log buffer
                    originalLog.apply(console, [`[Ghoti Heartbeat] 💓 Pulsed at ${now}`]);
                });
            }
        });
    } else {
        console.warn('[Ghoti Heartbeat] chrome.alarms API not available. Heartbeat degraded to setInterval only.');
    }

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

    // Clear persistent caches on update to ensure fresh evaluations
    await chrome.storage.local.remove(['ghoti_decision_cache', 'ghoti_detailed_cache']);
    console.log('[Ghoti Background] Cleared persistent scan caches due to extension update.');
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

async function updateStats(data) {
    const stats = await getStats();

    const newStats = {
        ...stats,
        resultsUploaded: stats.resultsUploaded || 0,
        recentScans: (stats.recentScans || []).slice(0, 100) // Keep last 100
    };

    if (data.scan) {
        newStats.totalScans++;
        newStats.lastScan = new Date().toISOString();
        if (data.scan.isPhishing) {
            newStats.phishingDetected++;
        } else {
            newStats.safeDetected++;
        }
        if (data.scan.source === 'local') newStats.localAnalyses++;
        if (data.scan.source === 'remote') newStats.remoteAnalyses++;

        // Add with total duration if available
        const recentScanEntry = {
            ...data.scan,
            timestamp: Date.now(),
            total_ms: data.timings?.total_ms || 0
        };
        newStats.recentScans.unshift(recentScanEntry);
    }

    if (data.uploaded) {
        newStats.resultsUploaded++;
    }

    await chrome.storage.local.set({ [STATS_KEY]: newStats });
    return newStats;
}

// Upload result to server for improvement
async function uploadResultToServer(resultData, settings) {
    if (!settings.uploadLocalResults) {
        return { skipped: true, reason: 'Upload disabled' };
    }

    try {
        const response = await fetch(REMOTE_SUBMIT_RESULT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({
                version: "0.1.0",
                clientId: getClientId(),
                ...resultData
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

    if (request.type === 'GET_NGRAM_DATA') {
        const cached = ngramCache[request.filename];
        if (cached) {
            sendResponse({ text: cached });
            return false; // Sync response
        }

        const url = chrome.runtime.getURL(request.filename);
        fetch(url)
            .then(res => res.ok ? res.text() : Promise.reject(`Status ${res.status}`))
            .then(text => {
                ngramCache[request.filename] = text; // Cache it for next time
                sendResponse({ text });
            })
            .catch(error => {
                console.error(`[Ghoti Background] Failed to load ${request.filename}:`, error);
                sendResponse({ error: error.toString() });
            });
        return true; // Async response
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

    if (request.type === 'REINIT_AUTH') {
        const { token, userSub } = request;
        if (token && userSub) {
            console.log('[Ghoti Background] REINIT_AUTH received:', userSub);
            // Update global state immediately
            AUTH_TOKEN = token;
            USER_SUB = userSub;

            chrome.storage.local.set({
                AUTH_TOKEN: token,
                USER_SUB: userSub
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Ghoti Background] Storage SET error:', chrome.runtime.lastError);
                } else {
                    console.log('[Ghoti Background] Tokens saved to storage. Verifying...');
                }
                initAuth().then(() => {
                    sendResponse({ success: true });
                }).catch(err => {
                    console.error('[Ghoti Background] initAuth failed during REINIT:', err);
                    sendResponse({ success: false, error: err.message });
                });
            });
            return true;
        } else {
            console.warn('[Ghoti Background] REINIT_AUTH missing parameters:', request);
            sendResponse({ success: false, error: 'Missing token or userSub' });
            return false;
        }
    }

    // Auth state queries
    if (request.type === 'GET_AUTH_STATE') {
        // Block until initialization is complete
        backgroundInitPromise.then(() => {
            console.log('[Ghoti Background] Responding to GET_AUTH_STATE. Authenticated:', isAuthenticated());
            sendResponse({
                isAuthenticated: isAuthenticated(),
                userSub: USER_SUB
            });
        });
        return true;
    }

    if (request.type === 'SIGN_OUT') {
        clearAuth().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }

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

    const timings = {
        total_ms: 0,
        init_ms: 0,
        reasoning_ms: 0,
        scoring_ms: 0
    };

    console.log(`[Ghoti LLM] ▶ Starting analysis for: ${domain}`);
    console.log(`[Ghoti LLM]   URL: ${url}`);

    try {
        const handler = llmHandler; // Use existing handler instance

        console.log('[Ghoti LLM]   Current status:', handler.getStatus());

        // Ensure engine is initialized
        if (handler.getStatus() === 'uninitialized' || handler.getStatus() === 'error') {
            const initStart = performance.now();
            console.log('[Ghoti LLM]   Initializing engine...');
            const initResult = await handler.handleMessage({ type: LLM_MESSAGE_TYPES.INIT });
            timings.init_ms = performance.now() - initStart;
            console.log('[Ghoti LLM]   Init result:', initResult);
            if (initResult.error) {
                throw new Error('LLM init failed: ' + initResult.error);
            }
        }

        console.log('[Ghoti LLM]   Status after init:', handler.getStatus());

        // === STEP 1: GENERATE REASONING ===
        const reasoningPrompt = buildLocalReasoningPrompt({ url, extractedData, whoisData }, {});
        console.log(`[Ghoti LLM] Step 1: Generating reasoning for ${domain}...`);

        // Reset chat history
        await handler.handleMessage({ type: LLM_MESSAGE_TYPES.RESET });

        const genStartTime = performance.now();
        const reasoningStart = performance.now();
        const step1Result = await handler.handleMessage({
            type: LLM_MESSAGE_TYPES.CHAT,
            message: reasoningPrompt,
            options: {
                temperature: 0.2, // Slightly higher for reasoning
                max_tokens: 2048 // Increased from 1024 to accommodate chains-of-thought (CoT) and verbose analyses
            }
        });
        timings.reasoning_ms = performance.now() - reasoningStart;

        if (step1Result.error) throw new Error("Reasoning step failed: " + step1Result.error);
        let reasoning = step1Result.content || "No reasoning generated.";

        // Strip <think>...</think> blocks (Qwen 3 chain-of-thought)
        // These are internal reasoning tokens that shouldn't be passed to Step 2
        // If we hit max_tokens, the closing tag might be missing, so we match to $ as well.
        const thinkMatch = reasoning.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
        // Robust stripping: handle nested or multi-line think blocks efficiently
        let strippedReasoning = reasoning.replace(/<think>[\s\S]*?(?:<\/think>|$)\s*/gi, '').trim();

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

        const scoringStart = performance.now();
        const step2Result = await handler.handleMessage({
            type: LLM_MESSAGE_TYPES.CHAT,
            message: scoringPrompt,
            options: {
                temperature: 0.15, // Low temperature for consistent scoring
                max_tokens: 256 // Lowered to speed up generation, we only need a JSON
            }
        });
        timings.scoring_ms = performance.now() - scoringStart;

        if (step2Result.error) throw new Error("Scoring step failed: " + step2Result.error);

        const genTime = ((performance.now() - genStartTime) / 1000).toFixed(2);
        console.log(`[Ghoti LLM] Chain complete in ${genTime}s`);

        // Fallback: derive score from Step 1's own conclusion when Step 2 fails
        const fallbackToStep1 = (reason) => {
            const text = reasoning; // preserve original case for regex
            const riskIndicators = extractedData?.riskIndicators || [];

            // Hard rule: .gov.tr is never flagged by the local model
            if (domain.endsWith('.gov.tr')) {
                console.log(`[Ghoti LLM] Step 1 fallback (${reason}): .gov.tr domain → forced SAFE`);
                return 0;
            }

            // Semantic safe patterns (mirrors verdictToScore)
            const safePatterns = [
                /\bsummary\s*:\s*safe\b/i,
                /\bconclusion\s*:\s*safe\b/i,
                /\bverdict\s*:\s*safe\b/i,
                /\bsonuç\s*:\s*güvenli\b/i,
                /\b(is|are|appears?\s+to\s+be|seems?\s+to\s+be|deemed\s+to\s+be|considered\s+to\s+be|classified\s+as)\s+(safe|legitimate|harmless|benign|trustworthy)\b/i,
                /\b(not|no)\s+(a\s+)?(phishing|scam|malicious|deceptive)\b/i,
                /\b(site|page|domain)\s+(is|appears?|seems?|looks?)\s+(safe|legitimate|harmless|benign)\b/i,
                /\bno\s+(threats?|risks?|malicious\s+intent|phishing\s+signs?)\s+(were\s+)?(found|detected|identified)\b/i,
                /\boltalama\s+değil\b/i,
                /\bgüvenli\s+olarak\s+(değerlendirilir|kabul|görünür)\b/i,
            ];

            // Semantic phishing patterns (mirrors verdictToScore)
            const phishingPatterns = [
                /\bsummary\s*:\s*phishing\b/i,
                /\bconclusion\s*:\s*phishing\b/i,
                /\bverdict\s*:\s*phishing\b/i,
                /\bsonuç\s*:\s*(oltalama|phishing)\b/i,
                /\b(is|are|appears?\s+to\s+be|seems?\s+to\s+be|deemed\s+to\s+be|considered|classified\s+as)\s+(a\s+)?(phishing|malicious|deceptive|fraudulent)\b/i,
                /\b(this|the)\s+(site|page|domain)\s+(is|appears?|seems?|looks?)\s+(like\s+)?(a\s+)?(phishing|scam|fake|malicious)\b/i,
                /\boltalama\s+(saldırısı|girişimi|sitesi)\b/i,
            ];

            const hasSafeConclusion = safePatterns.some(p => p.test(text));
            const hasPhishConclusion = phishingPatterns.some(p => p.test(text));

            // Also check for hard structural risk indicators (🚨 means compound rules fired)
            const hasHardSignal = riskIndicators.some(r => r.includes('🚨'));

            if (hasPhishConclusion || (hasHardSignal && !hasSafeConclusion)) {
                const score = verdictToScore('PHISHING', 4, reasoning, riskIndicators);
                console.log(`[Ghoti LLM] Step 1 fallback (${reason}): phishing conclusion detected → ${score}%`);
                return score;
            } else if (hasSafeConclusion) {
                const score = verdictToScore('SAFE', 4);
                console.log(`[Ghoti LLM] Step 1 fallback (${reason}): safe conclusion detected → ${score}%`);
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

        timings.total_ms = performance.now() - startTime;
        // Return local analysis result (without raw output)
        return {
            success: true,
            isKnownPhishing: false,
            localResult: {
                finalRating: Math.round(confidence),
                response: reasoning,
                riskFactors: extractedData?.riskIndicators || [],
            },
            timings: timings
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
    const overallStart = performance.now();
    const timings = {
        extension: {
            extraction_ms: data.timings?.extraction_ms || 0,
            serialization_ms: data.timings?.serialization_ms || 0,
            init_fetch_ms: 0,
            local_llm: null, // Set if run
            remote_query_ms: 0
        },
        server: {}, // Populated from responses
        total_ms: 0
    };

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
        const whitelistResult = { finalRating: 0, response: "Domain is whitelisted." };
        return { success: true, whoisResult: null, queryResult: whitelistResult, localResult: whitelistResult };
    }
    let urlInWhitelist = await urlInWhiteList(url);
    if (urlInWhitelist) {
        console.log('[Ghoti Background] URL in whitelist, skipping analysis:', url);
        const whitelistResult = { finalRating: 0, response: "URL is whitelisted." };
        return { success: true, whoisResult: null, queryResult: whitelistResult, localResult: whitelistResult };
    }

    // Check Persistent Cache
    // Bypass cache when testing locally or when forcing full analysis via compareMode
    if (settings.cacheScannedPages && !settings.compareMode && urlObj.hostname !== "localhost" && urlObj.hostname !== "127.0.0.1") {
        const decisionData = await chrome.storage.local.get(CACHE_KEYS.DECISIONS);
        const cached = (decisionData[CACHE_KEYS.DECISIONS] || {})[urlObj.href];

        if (cached && (Date.now() - cached._cachedAt < 3600000)) { // 1 hour cache
            console.log('[Ghoti Background] Returning persistent cached result for:', urlObj.href);

            // Reconstruct a minimal result for the UI from the decision summary
            // Full details (reasoning, riskFactors) will be hydrated by getTabScanStatus when popup opens
            const reconstructedResult = {
                success: true,
                isKnownPhishing: cached.isKnownPhishing,
                queryResult: cached.rating > settings.globalThreshold ? { finalRating: cached.rating } : null,
                localResult: cached.rating <= settings.globalThreshold ? { finalRating: cached.rating } : null
            };

            // Write directly to session storage — do NOT go through setTabScanStatus
            // which would overwrite the real DETAILS cache with this skeleton result
            const sessionKey = `scan_status_${tabId}`;
            await chrome.storage.session.set({
                [sessionKey]: {
                    status: 'complete',
                    url: urlObj.href,
                    riskCount: 0, // Hydrated later by getTabScanStatus
                    timestamp: cached._cachedAt,
                    result: reconstructedResult
                }
            });

            chrome.runtime.sendMessage({
                type: 'SCAN_COMPLETE',
                tabId: tabId,
                result: reconstructedResult,
                riskCount: 0
            }).catch(() => { });

            return reconstructedResult;
        }
    }

    // Helper to finalize, cache, broadcast, and return
    const finalizeAndReturn = async (result) => {
        timings.total_ms = performance.now() - overallStart;
        result.timings = timings;

        // Result is already pruned inside setTabScanStatus
        const riskCount = (result.queryResult?.riskFactors?.length) || (result.localResult?.riskFactors?.length) || (extractedData?.riskIndicators?.length) || 0;

        let finalRating = result.queryResult ? result.queryResult.finalRating : (result.localResult ? result.localResult.finalRating : 0);
        let isSuspicious = finalRating > settings.globalThreshold || result.isKnownPhishing;

        // Persist globally and for this tab
        await setTabScanStatus(tabId, {
            status: 'complete',
            url: urlObj.href,
            result,
            riskCount,
            timestamp: Date.now()
        });

        // Only show badge if the site is actually considered suspicious or phishing
        updateBadge(tabId, isSuspicious ? riskCount : 0, false);

        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            tabId: tabId,
            result: pruneResultForStorage(result), // Don't send 'raw' to UI
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
        const initFetchStart = performance.now();
        const initResponse = await fetch(REMOTE_INIT, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...getAuthHeaders()
            },
            body: JSON.stringify({
                version: "0.1.0",
                url: payloadUrl,
                timings: { // Send early timings to server
                    extraction_ms: timings.extension.extraction_ms
                }
            })
        });
        timings.extension.init_fetch_ms = performance.now() - initFetchStart;

        if (initResponse.ok) {
            const initData = await initResponse.json();
            if (initData.success) {
                whoisData = initData.whoisData;
                isKnownPhishing = initData.isKnownPhishing;

                // Capture server-side timings from init if provided
                if (initData.timings) {
                    timings.server.init = initData.timings;
                }

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
    const localResult = await analyzeWithLocalLLM(url, extractedData, whoisData, settings.localThreshold);
    timings.extension.local_llm = localResult.timings;
    const localAnalysis = localResult; // Maintain naming convention for rest of function
    console.log('[Ghoti Background] Local Analysis Result:', localAnalysis);

    let localSuspicion = 0;
    if (!localAnalysis.error && localAnalysis.localResult) {
        localSuspicion = localAnalysis.localResult.finalRating || 0;
    }

    // 2. Decide whether to use Remote Analysis
    // In compareMode, always run both
    const shouldUseRemote = settings.compareMode ||
        data.forceRemote || // Manually triggered scan from popup
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
            },
            timings: timings
        });

        // Upload result to server if enabled
        if (settings.uploadLocalResults) {
            uploadResultToServer({
                url: url,
                domain: urlObj.hostname,
                confidence: localSuspicion,
                isPhishing: isPhishing,
                reasoning: localAnalysis.localResult?.response,
                riskFactors: extractedData?.riskIndicators || [],
                extractedData: extractedData,
                modelUsed: 'local-webllm',
                timings: timings // Include full timings in upload
            }, settings).catch(err => console.warn('[Ghoti Background] Upload failed:', err));
        }

        const result = {
            success: true,
            isKnownPhishing: isKnownPhishing, // Pass the known status from DB
            whoisResult: null,
            queryResult: null, // No remote analysis for trusted sites
            localResult: {
                finalRating: localSuspicion,
                response: localAnalysis.localResult?.response || "Analyzed locally, deemed safe.",
                source: "local",
                riskFactors: localAnalysis.localResult?.riskFactors || extractedData?.riskIndicators || [], // Ensure risks are passed
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
        if (settings.showEarlyWarningOnLocalEscalation) {
            chrome.tabs.sendMessage(tabId, {
                type: 'SHOW_EARLY_WARNING',
                scanId: data.scanId,
                probability: 'local_escalation'
            }).catch(() => { });
        }
    }

    try {
        broadcastScanProgress(tabId, 'remote_analysis', 'Sunucu-tabanlı analiz yapılıyor...');
        // Reuse the WHOIS data we already fetched for local analysis
        const whoisResult = whoisData;
        const remoteQueryStart = performance.now();
        const queryPromise = new Promise((resolve, reject) => {
            // Browser WS API doesn't support custom headers; pass token as query param
            const wsUrl = AUTH_TOKEN
                ? `${REMOTE_QUERY_WS}?token=${encodeURIComponent(AUTH_TOKEN)}`
                : REMOTE_QUERY_WS;
            const ws = new WebSocket(wsUrl);
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
                        clientId: getClientId(),
                        extractedData: extractedData,
                        userAgent: navigator.userAgent, // For device simulation
                        domFingerprint: extractedData.domFingerprint, // For cloaking detection
                        etag: tabEtags.get(tabId), // Capture ETag for hash-collision check
                        timings: { // Send extension timings to server
                            extraction_ms: timings.extension.extraction_ms,
                            serialization_ms: timings.extension.serialization_ms,
                            local_llm_ms: timings.extension.local_llm?.total_ms || 0
                        }
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
                        // Capture server-side timings from query
                        if (response.timings) {
                            timings.server.query = response.timings;
                        }
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
        timings.extension.remote_query_ms = performance.now() - remoteQueryStart;

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
            },
            timings: timings
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
                    response: localAnalysis.localResult?.response || "Local analysis result",
                    source: "local",
                    riskFactors: localAnalysis.localResult?.riskFactors || [],
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
                response: localAnalysis.localResult?.response || "Local analysis result",
                source: "local",
                riskFactors: localAnalysis.localResult?.riskFactors || [],
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
                    response: localAnalysis.localResult?.response || "Local analysis result",
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
        const response = await fetch(REMOTE_WHOIS, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...getAuthHeaders()
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
            const newUrl = tab.url;

            // Determine if this is a same-domain navigation
            let isSameDomain = false;
            const lastUrl = lastScannedUrl.get(tabId);
            if (lastUrl) {
                try {
                    isSameDomain = new URL(lastUrl).hostname === new URL(newUrl).hostname;
                } catch (e) { /* ignore malformed URLs */ }
            }

            // Helper that actually fires the scan
            const fireScan = () => {
                sameDomainDebounceTimers.delete(tabId);
                console.log(`[Ghoti Background] Navigation detected on tab ${tabId} (URL: ${newUrl}), triggering scan...`);
                chrome.tabs.sendMessage(tabId, {
                    type: 'START_SCAN',
                    scanId: generateScanId()
                }).then(() => {
                    lastScannedUrl.set(tabId, newUrl);
                    pendingScans.delete(tabId);
                }).catch(() => {
                    pendingScans.set(tabId, newUrl);
                    console.log(`[Ghoti Background] Tab ${tabId} not ready, queued in pendingScans to wait for CONTENT_SCRIPT_READY`);
                });
            };

            if (isSameDomain) {
                // Cancel any existing debounce for this tab and restart the 3s timer
                const existing = sameDomainDebounceTimers.get(tabId);
                if (existing) clearTimeout(existing);
                console.log(`[Ghoti Background] Same-domain navigation on tab ${tabId}, debouncing scan by 3s...`);
                sameDomainDebounceTimers.set(tabId, setTimeout(fireScan, 3000));
            } else {
                // New domain — cancel any pending same-domain debounce and scan immediately
                const existing = sameDomainDebounceTimers.get(tabId);
                if (existing) { clearTimeout(existing); sameDomainDebounceTimers.delete(tabId); }
                fireScan();
            }
        }
    }
});

// Clean up tracking when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
    lastScannedUrl.delete(tabId);
    pendingScans.delete(tabId);
    const timer = sameDomainDebounceTimers.get(tabId);
    if (timer) { clearTimeout(timer); sameDomainDebounceTimers.delete(tabId); }
});

// Initialize LLM and Session on boot
(async () => {
    console.log('[Ghoti Background] Starting global initialization...');
    try {
        await initAuth();
    } catch (err) {
        console.error('[Ghoti Background] Critical error during initAuth:', err);
    }

    // One-time cleanup: purge stale "Yükleniyor..." entries from a previous buggy build
    try {
        const detailData = await chrome.storage.local.get(CACHE_KEYS.DETAILS);
        const details = detailData[CACHE_KEYS.DETAILS];
        if (details) {
            let changed = false;
            for (const url of Object.keys(details)) {
                if (details[url].reasoning === 'Yükleniyor...') {
                    delete details[url];
                    changed = true;
                }
            }
            if (changed) {
                await chrome.storage.local.set({ [CACHE_KEYS.DETAILS]: details });
                console.log('[Ghoti Background] Cleaned stale cache entries');
            }
        }
    } catch (e) { /* ignore */ }

    const settings = await chrome.storage.sync.get(DEFAULTS);
    if (settings.preloadLLM && settings.isActive) {
        console.log('[Ghoti Background] Pre-loading LLM model...');
        try {
            await llmHandler.handleMessage({ type: LLM_MESSAGE_TYPES.INIT });
        } catch (e) {
            console.error('[Ghoti Background] Failed to pre-load LLM:', e);
        }
    }
    console.log('[Ghoti Background] Global initialization complete.');

    // Final step: Sweep open tabs to recovery session without a reload
    syncAuthenticatedTabs().then(() => {
        backgroundInitResolve(); // Resolve the promise so message listeners can proceed
    });
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
        chrome.action.setBadgeText({ tabId, text: "" }).catch(() => { });
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        const url = tab.url;
        const lastScanned = lastScannedUrl.get(tabId);

        // If it's a new URL or a hard reload, clear the badge
        if (url !== lastScanned) {
            await setTabScanStatus(tabId, null);
            chrome.action.setBadgeText({ tabId, text: "" }).catch(() => { });
        }
    }
});
