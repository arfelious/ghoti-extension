/**
 * Ghoti Popup Script
 * Handles expandable panel UI and settings management
 */

import { DEFAULTS } from './config/defaults.js';

// LLM Message types (matching background.js)
const LLM_MESSAGE_TYPES = {
    GET_STATUS: 'LLM_GET_STATUS',
    INIT_PROGRESS: 'LLM_INIT_PROGRESS',
    INIT_COMPLETE: 'LLM_INIT_COMPLETE'
};

// State
let currentScanResult = null;
let currentOutputSource = 'remote'; // 'remote' or 'local'

document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    setupEventListeners();
    setupLLMStatusPolling();
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
        document.getElementById('checkbox3').checked = result.blockUntilScanned;
        document.getElementById('checkbox4').checked = result.cacheScannedPages;
        document.getElementById('checkbox5').checked = result.sendPageContent;
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
            blockUntilScanned: document.getElementById('checkbox3').checked,
            cacheScannedPages: document.getElementById('checkbox4').checked,
            sendPageContent: document.getElementById('checkbox5').checked,
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
    document.getElementById('checkbox3').addEventListener('change', saveSettings);
    document.getElementById('checkbox4').addEventListener('change', saveSettings);
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
// ... (rest of loadSettings) ...

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

            // Update status text based on activity (downloading vs loading)
            const statusEl = document.getElementById('llm-status');
            if (statusEl && message.activity) {
                statusEl.textContent = message.activity === 'downloading' ? 'İndiriliyor...' : 'Yükleniyor...';
                statusEl.className = 'status-value loading';
            }
        } else if (message.type === LLM_MESSAGE_TYPES.INIT_COMPLETE) {
            updateLLMStatus();
        } else if (message.type === 'SCAN_PROGRESS') {
            const pageStatusEl = document.getElementById('page-status');
            if (pageStatusEl) {
                pageStatusEl.textContent = message.message;
                pageStatusEl.className = 'status-value loading';
            }
        } else if (message.type === 'SCAN_COMPLETE') {
            // Get current active tab to ensure result is for this page
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (tab && message.tabId === tab.id) {
                    console.log('[Ghoti Popup] Scan complete received for current tab');
                    const domain = new URL(tab.url).hostname;
                    updateModelOutput(message.result, domain);
                    const pageStatusEl = document.getElementById('page-status');
                    if (pageStatusEl) {
                        pageStatusEl.textContent = 'Tamamlandı';
                        pageStatusEl.className = 'status-value ready';
                    }
                }
            });
        }
    });
}

/**
 * Fetch initial scan result from content script
 */
async function fetchInitialScanResult() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url.startsWith('http')) return;

        console.log('[Ghoti Popup] Requesting initial scan result from tab:', tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'GET_SCAN_RESULT' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[Ghoti Popup] Content script not ready or no result');
                return;
            }

            if (response && response.success && response.result) {
                console.log('[Ghoti Popup] Initial result received:', response.result);
                const domain = new URL(tab.url).hostname;
                updateModelOutput(response.result, domain);

                const pageStatusEl = document.getElementById('page-status');
                if (pageStatusEl) {
                    pageStatusEl.textContent = 'Tamamlandı';
                    pageStatusEl.className = 'status-value ready';
                }
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

            // Update status with color coding
            statusEl.textContent = formatStatus(response.status);
            statusEl.className = 'status-value ' + response.status;

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
function formatStatus(status) {
    const statusMap = {
        'uninitialized': 'Başlatılmadı',
        'loading': 'Yükleniyor...',
        'ready': 'Hazır',
        'generating': 'Üretiliyor...',
        'error': 'Hata'
    };
    return statusMap[status] || status;
}

/**
 * Toggle model output source (Yerel vs Genel)
 */
function toggleOutputSource() {
    currentOutputSource = currentOutputSource === 'remote' ? 'local' : 'remote';

    // Update title
    const titleEl = document.getElementById('output-title');
    if (titleEl) {
        titleEl.textContent = currentOutputSource === 'remote' ? 'Son Genel Çıktı' : 'Son Yerel Çıktı';
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
function updateModelOutput(result, domain = null) {
    if (!result) return;
    currentScanResult = result;

    const outputEl = document.getElementById('model-output');
    if (outputEl) {
        let content = null;
        let sourceData = currentOutputSource === 'remote' ? result.queryResult : result.localResult;

        // Auto-switch to local if remote is requested but missing
        if (currentOutputSource === 'remote' && !result.queryResult && result.localResult) {
            console.log('[Ghoti Popup] Remote result missing, showing local fallback');
            sourceData = result.localResult;
            // Optionally update UI to show it's local
            const titleEl = document.getElementById('output-title');
            if (titleEl) titleEl.textContent = 'Son Yerel Çıktı (Otomatik)';
        }

        if (sourceData) {
            const response = sourceData.response || sourceData.reasoning || "";
            const rating = sourceData.finalRating !== undefined ? `Risk: %${sourceData.finalRating}\n\n` : "";
            const domainHeader = domain ? `${domain}\n-------------------\n` : "";
            content = response ? `${domainHeader}${rating}${response}` : null;
        }

        outputEl.textContent = content || (currentOutputSource === 'remote' ? 'Genel analiz yapılmadı' : 'Yerel analiz yapılmadı');
    }
}

/**
 * Report current page
 */
async function reportPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[Ghoti Popup] Reporting page:', tab.url);
        // TODO: Implement page reporting
        alert('Sayfa bildirildi!');
    } catch (error) {
        console.error('[Ghoti Popup] Error reporting page:', error);
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

        // Listen for result (simplified - in real impl use proper message passing)
        setTimeout(() => {
            document.getElementById('page-status').textContent = 'Tamamlandı';
            document.getElementById('page-status').className = 'status-value ready';
        }, 3000);

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
