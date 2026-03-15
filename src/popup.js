/**
 * Ghoti Popup Script
 * Handles expandable panel UI and settings management
 */

import { DEFAULTS } from './config/defaults.js';
import { SERVER_BASE } from './config/env.js';

// LLM Message types (matching background.js)
const LLM_MESSAGE_TYPES = {
    GET_STATUS: 'LLM_GET_STATUS',
    INIT_PROGRESS: 'LLM_INIT_PROGRESS',
    INIT_COMPLETE: 'LLM_INIT_COMPLETE'
};

// State
let currentScanResult = null;
let currentOutputSource = 'remote'; // 'remote' or 'local'
let isDownloadingSession = false; // Sticky: once downloading is seen in a load session, stay "downloading" until complete

document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    setupEventListeners();
    setupLLMStatusPolling();
    checkAuthStatus();
    fetchInitialScanResult(); // Fetch result of current page if already analyzed
});

/**
 * Load settings from storage
 */
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(DEFAULTS);

        // Sliders
        document.getElementById('slider1').value = result.localThreshold;
        document.getElementById('slider2').value = result.globalThreshold;
        document.getElementById('slider1-val').textContent = result.localThreshold;
        document.getElementById('slider2-val').textContent = result.globalThreshold;

        // Checkboxes
        document.getElementById('checkbox1').checked = result.showConfidenceWhenSuspicious;
        document.getElementById('checkbox2').checked = result.alwaysShowRating;
        document.getElementById('checkbox-block-combined').checked = result.blockUntilScanned || result.blockOnSuspicious;
        document.getElementById('checkbox4').checked = result.cacheScannedPages;
        document.getElementById('checkbox5').checked = result.sendPageContent;
        document.getElementById('checkbox6').checked = result.sendDomainOnlyUntilPhishing;
        document.getElementById('active-checkbox').checked = result.isActive;

        // Panel expansion state
        document.body.dataset.expandedLeft = result.expandedLeft;
        document.body.dataset.expandedBottom = result.expandedBottom;

        // Update button labels based on expansion state
        updateToggleLabels(result.expandedLeft, result.expandedBottom);

        // Apply dimensions
        updatePopupDimensions();

        console.log('[Ghoti Popup] Settings loaded:', result);
    } catch (error) {
        console.error('[Ghoti Popup] Error loading settings:', error);
    }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
    try {
        const settings = {
            localThreshold: parseInt(document.getElementById('slider1').value),
            globalThreshold: parseInt(document.getElementById('slider2').value),
            showConfidenceWhenSuspicious: document.getElementById('checkbox1').checked,
            alwaysShowRating: document.getElementById('checkbox2').checked,
            blockUntilScanned: document.getElementById('checkbox-block-combined').checked,
            blockOnSuspicious: document.getElementById('checkbox-block-combined').checked,
            cacheScannedPages: document.getElementById('checkbox4').checked,
            sendPageContent: document.getElementById('checkbox5').checked,
            sendDomainOnlyUntilPhishing: document.getElementById('checkbox6').checked,
            isActive: document.getElementById('active-checkbox').checked,
            language: "tr",
            expandedLeft: document.body.dataset.expandedLeft === 'true',
            expandedBottom: document.body.dataset.expandedBottom === 'true'
        };

        await chrome.storage.sync.set(settings);
        console.log('[Ghoti Popup] Settings saved:', settings);
    } catch (error) {
        console.error('[Ghoti Popup] Error saving settings:', error);
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Expansion buttons
    document.getElementById('expand-left-btn').addEventListener('click', toggleLeftPanel);
    document.getElementById('expand-bottom-btn').addEventListener('click', toggleBottomPanel);

    // Sliders
    const slider1 = document.getElementById('slider1');
    const slider2 = document.getElementById('slider2');

    slider1.addEventListener('input', () => {
        document.getElementById('slider1-val').textContent = slider1.value;
    });

    slider2.addEventListener('input', () => {
        document.getElementById('slider2-val').textContent = slider2.value;
    });

    slider1.addEventListener('change', saveSettings);
    slider2.addEventListener('change', saveSettings);

    // Checkboxes
    document.getElementById('checkbox1').addEventListener('change', saveSettings);
    document.getElementById('checkbox2').addEventListener('change', saveSettings);
    document.getElementById('checkbox-block-combined').addEventListener('change', saveSettings);
    document.getElementById('checkbox4').addEventListener('change', saveSettings);
    document.getElementById('checkbox5').addEventListener('change', saveSettings);
    document.getElementById('checkbox6').addEventListener('change', saveSettings);
    document.getElementById('active-checkbox').addEventListener('change', saveSettings);

    // Action buttons (main)
    document.getElementById('btn-report').addEventListener('click', reportPage);
    document.getElementById('btn-rescan').addEventListener('click', rescanPage);
    document.getElementById('btn-settings').addEventListener('click', openSettings);

    // Action buttons (quick - visible when left expanded, bottom collapsed)
    document.getElementById('btn-report-quick').addEventListener('click', reportPage);
    document.getElementById('btn-rescan-quick').addEventListener('click', rescanPage);
    document.getElementById('btn-settings-quick').addEventListener('click', openSettings);

    // Output toggle
    document.getElementById('toggle-output-source').addEventListener('click', toggleOutputSource);

    // Risk summary clickable
    const riskSummary = document.getElementById('results-summary');
    if (riskSummary) {
        riskSummary.addEventListener('click', toggleRiskDetails);
    }
}

/**
 * Update toggle button labels based on expansion state
 */
/**
 * Update toggle button labels based on expansion state
 */
function updateToggleLabels(expandedLeft, expandedBottom) {
    // Left button is just an arrow, no label to update
    // Bottom button label updates
    const bottomLabel = document.querySelector('#expand-bottom-btn .expand-label');
    if (bottomLabel) {
        bottomLabel.textContent = expandedBottom ? 'Daha Az' : 'Daha Fazla';
    }
}


/**
 * Toggle left panel expansion
 */
function toggleLeftPanel() {
    const current = document.body.dataset.expandedLeft === 'true';
    document.body.dataset.expandedLeft = !current;

    updatePopupDimensions();
    saveSettings();
}

/**
 * Toggle bottom panel expansion
 */
function toggleBottomPanel() {
    const current = document.body.dataset.expandedBottom === 'true';
    const newState = !current;
    document.body.dataset.expandedBottom = newState;

    // Update button label
    const btn = document.getElementById('expand-bottom-btn');
    const label = btn.querySelector('.expand-label');
    if (label) {
        label.textContent = newState ? 'Daha Az' : 'Daha Fazla';
    }

    updatePopupDimensions();
    saveSettings();
}

/**
 * Update popup dimensions (Critical for Chrome resizing)
 */
function updatePopupDimensions() {
    const isLeft = document.body.dataset.expandedLeft === 'true';
    const isBottom = document.body.dataset.expandedBottom === 'true';

    // Base widths (must match CSS)
    const sidebarWidth = 24;
    const mainContentMinWidth = 300; // Comfortable width for main content

    let targetWidth = sidebarWidth + mainContentMinWidth;

    if (isLeft) {
        if (isBottom) {
            // Wider left panel when bottom is also expanded
            targetWidth += 250;
        } else {
            targetWidth += 140;
        }
    }

    document.body.style.width = `${targetWidth}px`;
    document.body.style.minWidth = `${targetWidth}px`;
}

/**
 * Check authentication status and show in popup
 */
function checkAuthStatus() {
    console.log('[Ghoti Popup] Requesting auth state...');
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (response) => {
        console.log('[Ghoti Popup] Auth state response:', response);
        renderAuthUI(response && response.isAuthenticated);
    });
}

/**
 * Setup LLM status polling
 */
function setupLLMStatusPolling() {
    updateLLMStatus();
    // Poll every 2 seconds
    setInterval(updateLLMStatus, 2000);

    // Listen for progress updates from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === LLM_MESSAGE_TYPES.INIT_PROGRESS) {
            updateProgressBar(message.progress, 'loading');

            // Once downloading is seen in a session, keep "downloading" label until complete
            if (message.activity === 'downloading') isDownloadingSession = true;

            const statusEl = document.getElementById('llm-status');
            if (statusEl && message.activity) {
                statusEl.textContent = isDownloadingSession ? 'İndiriliyor...' : 'Yükleniyor...';
                statusEl.className = 'status-value loading';
            }
        } else if (message.type === LLM_MESSAGE_TYPES.INIT_COMPLETE) {
            isDownloadingSession = false; // Reset for next load session
            updateLLMStatus();
        } else if (message.type === 'SCAN_PROGRESS') {
            // Only show progress for the active tab
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (tab && message.tabId === tab.id) {
                    const pageStatusEl = document.getElementById('page-status');
                    if (pageStatusEl) {
                        pageStatusEl.textContent = message.message;
                        pageStatusEl.className = 'status-value loading';
                    }
                }
            });
        } else if (message.type === 'SCAN_COMPLETE') {
            // Get current active tab to ensure result is for this page
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (tab && message.tabId === tab.id) {
                    console.log('[Ghoti Popup] Scan complete received for current tab');
                    const domain = new URL(tab.url).hostname;

                    // Update local state and output
                    currentScanResult = message.result;
                    updateModelOutput(message.result, domain, true);

                    const pageStatusEl = document.getElementById('page-status');
                    if (pageStatusEl) {
                        pageStatusEl.textContent = 'Tamamlandı';
                        pageStatusEl.className = 'status-value ready';
                    }

                    // Show risk factor summary and details
                    const riskSummaryEl = document.getElementById('results-summary');
                    const riskCountEl = document.getElementById('risk-count-display');
                    if (riskSummaryEl && riskCountEl) {
                        const count = message.riskCount || 0;
                        riskCountEl.textContent = `${count} Oltalama Riski Tespit Edildi`;
                        riskSummaryEl.style.display = count > 0 ? 'flex' : 'none';
                        riskSummaryEl.className = count > 3 ? 'results-summary phishing' : 'results-summary';

                        // Render full details
                        const riskFactors = message.result?.queryResult?.riskFactors ||
                            message.result?.localResult?.riskFactors || [];
                        renderRiskDetails(riskFactors);
                    }
                }
            });
        } else if (message.type === 'AUTH_STATE_CHANGED') {
            renderAuthUI(message.isAuthenticated);
        }
    });
}

/**
 * Update all auth-related UI elements
 */
/**
 * Update all auth-related UI elements (Modularized)
 */
function renderAuthUI(isAuthenticated) {
    // 1. Left panel text indicator
    const authEl = document.getElementById('auth-status');
    if (authEl) {
        if (isAuthenticated) {
            authEl.textContent = 'Giriş yapıldı';
            authEl.className = 'status-value ready';
        } else {
            authEl.textContent = 'Giriş yapılmadı';
            authEl.className = 'status-value error';
        }
    }

    // 2. Header checkmark indicator
    const headerIndicator = document.getElementById('header-auth-indicator');
    if (headerIndicator) {
        if (isAuthenticated) {
            headerIndicator.classList.add('authenticated');
            headerIndicator.title = 'Giriş başarılı. Sunucu analizleri aktif.';
        } else {
            headerIndicator.classList.remove('authenticated');
            headerIndicator.title = 'Giriş yapılmadı. Sunucu analizi için ghoti.com.tr sitesinde giriş yapın.';
        }
    }
}

/**
 * Fetch initial scan result from content script
 */
async function fetchInitialScanResult() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url.startsWith('http')) return;

        // Check if a scan is currently in progress for this tab
        const scanStatus = await chrome.runtime.sendMessage({ type: 'GET_SCAN_STATUS' });

        // Even if not scanning, the background might have the result stored from a previous scan in this session
        if (scanStatus) {
            if (scanStatus.scanning) {
                const pageStatusEl = document.getElementById('page-status');
                if (pageStatusEl) {
                    pageStatusEl.textContent = scanStatus.message || 'Taranıyor...';
                    pageStatusEl.className = 'status-value loading';
                }
                return; // Result will arrive via SCAN_COMPLETE listener
            } else if (scanStatus.result) {
                // Background has a result! Use it instead of asking tab (persistence fix)
                console.log('[Ghoti Popup] Stored result found in background:', scanStatus.result);
                const domain = new URL(tab.url).hostname;
                updateModelOutput(scanStatus.result, domain, true);

                const pageStatusEl = document.getElementById('page-status');
                if (pageStatusEl) {
                    pageStatusEl.textContent = 'Tamamlandı';
                    pageStatusEl.className = 'status-value ready';
                }

                // Show risk factor summary
                const riskSummaryEl = document.getElementById('results-summary');
                const riskCountEl = document.getElementById('risk-count-display');
                if (riskSummaryEl && riskCountEl) {
                    const riskFactors = scanStatus.result.queryResult?.riskFactors ||
                        scanStatus.result.localResult?.riskFactors || [];
                    const count = riskFactors.length;

                    riskCountEl.textContent = `${count} Oltalama Riski Tespit Edildi`;
                    riskSummaryEl.style.display = count > 0 ? 'flex' : 'none';
                    riskSummaryEl.className = count > 3 ? 'results-summary phishing' : 'results-summary';

                    renderRiskDetails(riskFactors);
                }
                return;
            }
        }

        console.log('[Ghoti Popup] Requesting initial scan result from tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'GET_SCAN_RESULT' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Ghoti Popup] Content script not ready or no result');
                return;
            }

            if (response && response.success && response.result) {
                console.log('[Ghoti Popup] Initial result received:', response.result);
                const domain = new URL(tab.url).hostname;
                updateModelOutput(response.result, domain, true);

                const pageStatusEl = document.getElementById('page-status');
                if (pageStatusEl) {
                    pageStatusEl.textContent = 'Tamamlandı';
                    pageStatusEl.className = 'status-value ready';
                }

                // Show risk factor summary
                const riskSummaryEl = document.getElementById('results-summary');
                const riskCountEl = document.getElementById('risk-count-display');
                if (riskSummaryEl && riskCountEl) {
                    // Extract risk factors from result
                    const riskFactors = response.result.queryResult?.riskFactors ||
                        response.result.localResult?.riskFactors || [];
                    const count = riskFactors.length;

                    riskCountEl.textContent = `${count} Oltalama Riski Tespit Edildi`;
                    riskSummaryEl.style.display = count > 0 ? 'flex' : 'none';
                    riskSummaryEl.className = count > 3 ? 'results-summary phishing' : 'results-summary';

                    renderRiskDetails(riskFactors);
                }
            } else {
                // Final fallback: try LRU Cache directly to catch extension restarts where session is lost
                chrome.storage.local.get(['ghoti_decision_cache', 'ghoti_detailed_cache'], (caches) => {
                    const decisions = caches['ghoti_decision_cache'] || {};
                    const detailsMap = caches['ghoti_detailed_cache'] || {};
                    const cachedDecision = decisions[tab.url];
                    if (cachedDecision) {
                        const details = detailsMap[tab.url] || {};
                        const reasoning = details.reasoning;
                        // Skip stale placeholder entries
                        if (!reasoning || reasoning === 'Yükleniyor...') return;
                        const result = {
                            success: true,
                            isKnownPhishing: cachedDecision.isKnownPhishing,
                            // In cache, we store the final reasoning. Use the new 'source' field 
                            // to avoid mirroring the same text into both slots.
                            queryResult: details.source === 'remote' ? { finalRating: cachedDecision.rating, response: reasoning, riskFactors: details.riskFactors || [], isCached: true } : null,
                            localResult: details.source !== 'remote' ? { finalRating: cachedDecision.rating, response: reasoning, riskFactors: details.riskFactors || [], isCached: true } : null,
                            isCachedFull: true
                        };
                        const domain = new URL(tab.url).hostname;
                        updateModelOutput(result, domain, true);

                        const pageStatusEl = document.getElementById('page-status');
                        if (pageStatusEl) {
                            pageStatusEl.textContent = 'Önbellekten Yüklendi';
                            pageStatusEl.className = 'status-value ready';
                        }
                    }
                });
            }
        });
    } catch (e) {
        console.warn('[Ghoti Popup] Failed to fetch initial scan result:', e);
    }
}

/**
 * Update LLM status display
 */
async function updateLLMStatus() {
    try {
        const response = await chrome.runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.GET_STATUS
        });

        if (response) {
            const statusEl = document.getElementById('llm-status');
            const modelEl = document.getElementById('model-name');
            const progressEl = document.getElementById('load-progress');

            // Update status with color coding — respect sticky download session
            statusEl.textContent = (response.status === 'loading' && isDownloadingSession)
                ? 'İndiriliyor...'
                : formatStatus(response.status, response);
            statusEl.className = 'status-value ' + response.status;
            statusEl.title = response.status === 'error' && response.errorMessage
                ? response.errorMessage
                : (response.engine || '');

            // Update model name (truncate if too long)
            if (response.modelId) {
                const shortName = response.modelId.split('-').slice(0, 2).join('-');
                modelEl.textContent = shortName;
                modelEl.title = response.modelId; // Full name on hover
            }

            // Update progress bar
            if (response.loadProgress !== undefined) {
                updateProgressBar(response.loadProgress, response.status);
            }
        }
    } catch (error) {
        console.error('[Ghoti Popup] Error getting LLM status:', error);
        document.getElementById('llm-status').textContent = 'Bağlantı yok';
        document.getElementById('llm-status').className = 'status-value error';
    }
}

/**
 * Update progress bar
 */
function updateProgressBar(progress, status) {
    const progressEl = document.getElementById('load-progress');
    if (progressEl) {
        progressEl.style.width = `${(progress * 100)}%`;

        // Disable animation if already ready to prevent "filling up" on popup open
        if (status === 'ready' || progress >= 1) {
            progressEl.classList.add('ready');
        } else {
            progressEl.classList.remove('ready');
        }
    }
}

/**
 * Format status for display
 */
function formatStatus(status, response = {}) {
    const statusMap = {
        'uninitialized': 'Başlatılmadı',
        'loading': 'Yükleniyor...',
        'ready': 'Hazır',
        'generating': 'Üretiliyor...',
        'error': 'Hata'
    };
    const baseStatus = statusMap[status] || status;

    if (status === 'error') {
        if (response.errorSource === 'ollama') {
            return response.errorCode ? `Hata (Ollama ${response.errorCode})` : 'Hata (Ollama)';
        }
        if (response.errorSource === 'web-llm') {
            return 'Hata (Web-LLM)';
        }
        return baseStatus;
    }

    if (response.engine === 'Ollama') {
        return `${baseStatus} (Ollama)`;
    }

    return baseStatus;
}

/**
 * Toggle model output source (Yerel vs Genel)
 */
function toggleOutputSource() {
    currentOutputSource = currentOutputSource === 'remote' ? 'local' : 'remote';

    // Update title
    const titleEl = document.getElementById('output-title');
    if (titleEl) {
        titleEl.textContent = currentOutputSource === 'remote' ? 'Genel Çıktı' : 'Yerel Çıktı';
    }

    // Refresh display
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        const domain = tab ? new URL(tab.url).hostname : null;
        updateModelOutput(currentScanResult, domain);
    });
}

/**
 * Update model output display
 */
function updateModelOutput(result, domain = null, autoSwitch = false) {
    if (!result) return;
    currentScanResult = result;

    const outputEl = document.getElementById('model-output');
    if (outputEl) {
        // Auto-switch: If remote is requested but only local exists, switch to local
        if (autoSwitch && currentOutputSource === 'remote' && !result.queryResult && result.localResult) {
            console.log('[Ghoti Popup] Remote missing, auto-switching to local view');
            currentOutputSource = 'local';
            const titleEl = document.getElementById('output-title');
            if (titleEl) titleEl.textContent = 'Yerel Çıktı';
        }

        let content = null;
        let sourceData = currentOutputSource === 'remote' ? result.queryResult : result.localResult;

        if (sourceData) {
            console.log('[Ghoti Popup] Rendering sourceData:', sourceData);
            let response = sourceData.response || sourceData.reasoning || sourceData.text || sourceData.raw || "";

            // Strip <think>...</think> tags and content
            response = response.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();

            const rating = sourceData.finalRating !== undefined ? `Risk: %${sourceData.finalRating}\n\n` : "";
            const domainHeader = domain ? `${domain}\n-------------------\n` : "";
            const sourceLabel = sourceData.isCached ? " (Önbellek)" : "";
            const llmLabel = (currentOutputSource === 'remote' && sourceData.llmSource)
                ? (sourceData.llmSource === 'external' ? ' · Gemini' : ' · Ollama')
                : '';
            const prefix = currentOutputSource === 'remote' ? `GENEL ANALİZ${sourceLabel}${llmLabel}:\n` : `YEREL ANALİZ${sourceLabel}:\n`;
            content = response ? `${domainHeader}${prefix}${rating}${response}` : null;
        }

        if (!content) {
            const domainHeader = domain ? `${domain}\n-------------------\n` : "";
            const prefix = currentOutputSource === 'remote' ? `GENEL ANALİZ:\n` : `YEREL ANALİZ:\n`;
            const msg = currentOutputSource === 'remote'
                ? 'Sunucu analizi henüz tamamlanmadı veya bu site için gerekmedi.'
                : 'Yerel analiz henüz tamamlanmadı veya kapatıldı.';
            content = `${domainHeader}${prefix}${msg}`;
        }

        outputEl.textContent = content;
    }
}

/**
 * Report current page
 */
async function reportPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[Ghoti Popup] Reporting page:', tab.url);
        const btn = document.getElementById('btn-report');
        const oldText = btn.innerHTML;
        btn.innerHTML = 'Bildiriliyor...';
        btn.disabled = true;

        const baseUrl = SERVER_BASE; // Use configured server base
        const domain = new URL(tab.url).hostname;

        // Get auth token for authentication
        const authData = await chrome.storage.local.get(['AUTH_TOKEN', 'SESSION_NONCE']);
        const authHeaders = authData.AUTH_TOKEN
            ? { 'Authorization': `Bearer ${authData.AUTH_TOKEN}` }
            : { 'X-Ghoti-Nonce': authData.SESSION_NONCE || '' };

        // Note: The /report endpoint takes { url, domain } and records in DB.
        const response = await fetch(`${baseUrl}/report`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders
            },
            body: JSON.stringify({ url: tab.url, domain })
        });

        if (response.ok) {
            btn.innerHTML = 'Bildirildi ✓';
            setTimeout(() => { btn.innerHTML = oldText; btn.disabled = false; }, 2000);
        } else {
            throw new Error(await response.text());
        }
    } catch (error) {
        console.error('[Ghoti Popup] Error reporting page:', error);
        const btn = document.getElementById('btn-report');
        if (btn) {
            btn.innerHTML = 'Hata';
            setTimeout(() => { btn.innerHTML = '<span class="icon">🚩</span><span>Raporla</span>'; btn.disabled = false; }, 2000);
        }
    }
}

/**
 * Rescan current page
 */
async function rescanPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[Ghoti Popup] Rescanning page:', tab.url);

        // Update page status
        document.getElementById('page-status').textContent = 'Taranıyor...';
        document.getElementById('page-status').className = 'status-value loading';

        // Send message to content script to trigger rescan
        await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN_PAGE' });
        // Status will be updated to 'Tamamlandı' when SCAN_COMPLETE message arrives

    } catch (error) {
        console.error('[Ghoti Popup] Error rescanning page:', error);
        document.getElementById('page-status').textContent = 'Hata';
        document.getElementById('page-status').className = 'status-value error';
    }
}

/**
 * Open settings page
 */
function openSettings() {
    console.log('[Ghoti Popup] Opening settings...');
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('settings.html'));
    }
}

/**
 * Render detailed risk factors in the popup
 */
function renderRiskDetails(riskFactors) {
    const listEl = document.getElementById('risk-details-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    let hasHighRisk = false;
    if (!riskFactors || riskFactors.length === 0) {
        document.getElementById('results-summary').style.display = 'none';
        return;
    }

    riskFactors.forEach(risk => {
        const item = document.createElement('div');
        const isHigh = risk.includes('🚨') || risk.includes('SENSITIVE PII') || risk.includes('FAKE') || risk.includes('IMPERSONATION') || risk.includes('CREDENTIAL');
        if (isHigh) hasHighRisk = true;
        item.className = isHigh ? 'risk-item high' : 'risk-item';

        // Add icon
        const icon = document.createElement('span');
        icon.className = 'risk-icon';
        icon.textContent = isHigh ? '🚨' : '⚠️';

        const text = document.createElement('span');
        text.className = 'risk-text';
        text.textContent = risk;

        item.appendChild(icon);
        item.appendChild(text);
        listEl.appendChild(item);
    });

    // Risk details are collapsed by default as requested
    document.getElementById('results-summary').classList.remove('expanded');
    document.getElementById('risk-details-list').style.display = 'none';
    const tipEl = document.querySelector('.click-tip');
    if (tipEl) tipEl.textContent = 'Tıkla ve Detayları Gör';

}

/**
 * Toggle risk details visibility
 */
function toggleRiskDetails() {
    const container = document.getElementById('results-summary');
    const list = document.getElementById('risk-details-list');
    const tip = container.querySelector('.click-tip');
    if (!container || !list) return;

    const isExpanded = container.classList.contains('expanded');
    if (isExpanded) {
        container.classList.remove('expanded');
        list.style.display = 'none';
        if (tip) tip.firstChild.textContent = 'Detayları Göster ';
    } else {
        container.classList.add('expanded');
        list.style.display = 'flex';
        if (tip) tip.firstChild.textContent = 'Detayları Gizle ';
    }
}
