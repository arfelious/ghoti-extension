import './settings.css';
import { LLMAdapter, LLM_MESSAGE_TYPES, PRESET_MODELS, createModelFromUrl } from './llm';
import { DEFAULTS } from './config/defaults.js';

// Global LLM adapter instance
let llm = null;
let allLogs = []; // Buffer to store all logs for filtering

function getConfiguredOllamaEndpoint() {
    const endpointInput = document.getElementById('ollamaEndpoint');
    const endpoint = endpointInput?.value?.trim() || '';
    return endpoint || DEFAULTS.ollamaEndpoint;
}

function setOllamaAdvancedVisible(visible) {
    const advancedSection = document.getElementById('ollamaAdvancedSection');
    const toggleBtn = document.getElementById('toggleOllamaAdvancedBtn');
    if (!advancedSection || !toggleBtn) return;

    advancedSection.classList.toggle('collapsed', !visible);
    toggleBtn.textContent = visible ? 'Gelişmiş Ayarları Gizle' : 'Gelişmiş Endpoint Ayarı';
}

document.addEventListener('DOMContentLoaded', async () => {
    llm = new LLMAdapter({
        onStatusChange: updateModelStatus,
    });

    await loadSettings();
    await loadExemptList();
    await loadStats();
    await loadServerStats();
    await loadModelInfo();
    await loadAvailableModels();
    await loadLogs();
    setupEventListeners();
    setupProgressListener();
});

async function loadSettings() {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    document.getElementById('autoScan').checked = settings.autoScanOnStartup;
    document.getElementById('preloadLLM').checked = settings.preloadLLM;
    document.getElementById('scanOnSpaNavigation').checked = settings.scanOnSpaNavigation;
    document.getElementById('unloadAfterInactivity').checked = settings.unloadAfterInactivity;
    document.getElementById('uploadLocalResults').checked = settings.uploadLocalResults;
    document.getElementById('showEarlyWarningOnLocalEscalation').checked = settings.showEarlyWarningOnLocalEscalation;
    document.getElementById('maxLogs').value = settings.maxLogs;

    // Block settings
    document.getElementById('blockUntilScanned').checked = settings.blockUntilScanned;
    document.getElementById('blockOnSuspicious').checked = settings.blockOnSuspicious;
    updateBlockWarning();

    // Fallback threshold
    document.getElementById('useCustomFallbackThreshold').checked = settings.useCustomFallbackThreshold;
    document.getElementById('fallbackThresholdSlider').value = settings.localFallbackThreshold;
    document.getElementById('fallbackThresholdVal').textContent = settings.localFallbackThreshold;
    updateFallbackSliderState();

    // Ollama settings
    document.getElementById('ollamaEnabled').checked = settings.ollamaEnabled;
    document.getElementById('ollamaEndpoint').value = (settings.ollamaEndpoint || DEFAULTS.ollamaEndpoint).trim();

    // OpenAI settings
    document.getElementById('openaiEnabled').checked = settings.openaiEnabled;
    document.getElementById('openaiEndpoint').value = (settings.openaiEndpoint || DEFAULTS.openaiEndpoint).trim();
    document.getElementById('openaiModel').value = (settings.openaiModel || '').trim();
    document.getElementById('openaiApiKeyEnabled').checked = settings.openaiApiKeyEnabled;

    // Load locally stored API key
    const localData = await chrome.storage.local.get('openaiApiKey');
    if (localData.openaiApiKey) {
        document.getElementById('openaiApiKey').value = localData.openaiApiKey;
    }

    setOllamaAdvancedVisible(false);
    updateLLMUIState();
    if (settings.ollamaEnabled) {
        await fetchOllamaModels();
    }
}

function updateBlockWarning() {
    const row = document.getElementById('blockUntilScannedRow');
    const blockUntilScanned = document.getElementById('blockUntilScanned').checked;
    const blockOnSuspicious = document.getElementById('blockOnSuspicious').checked;
    if (blockUntilScanned && !blockOnSuspicious) {
        row.classList.add('warning');
    } else {
        row.classList.remove('warning');
    }
}

function updateFallbackSliderState() {
    const enabled = document.getElementById('useCustomFallbackThreshold').checked;
    const sliderGroup = document.querySelector('#fallbackSliderRow .slider-group-settings');
    if (sliderGroup) {
        sliderGroup.classList.toggle('disabled', !enabled);
    }
}

function updateLLMUIState() {
    const ollamaEnabled = document.getElementById('ollamaEnabled').checked;
    const openaiEnabled = document.getElementById('openaiEnabled').checked;
    const anyExternalLLM = ollamaEnabled || openaiEnabled;
    
    // External provider sections
    const ollamaSection = document.getElementById('ollamaSettingsSection');
    const openaiSection = document.getElementById('openaiSettingsSection');
    
    // Main cards
    const mlcActiveCard = document.getElementById('mlcActiveCard');
    const mlcPresetsCard = document.getElementById('mlcPresetsCard');
    const mlcCustomCard = document.getElementById('mlcCustomCard');

    // Update visibility for external provider settings content
    if (ollamaSection) {
        ollamaSection.classList.toggle('disabled-section', !ollamaEnabled);
    }
    if (openaiSection) {
        openaiSection.classList.toggle('disabled-section', !openaiEnabled);
    }

    // Handle OpenAI API Key visibility/interactivity
    const apiKeyEnabled = document.getElementById('openaiApiKeyEnabled').checked;
    const apiKeyInput = document.getElementById('openaiApiKey');
    if (apiKeyInput) {
        apiKeyInput.disabled = !apiKeyEnabled || !openaiEnabled;
        apiKeyInput.style.opacity = (apiKeyEnabled && openaiEnabled) ? '1' : '0.5';
    }

    // Only dim the Active Model card if using external LLM
    if (mlcActiveCard) {
        mlcActiveCard.classList.toggle('disabled-section', anyExternalLLM);
    }

    // Explicitly ENSURE other cards are NOT dimmed
    if (mlcPresetsCard) mlcPresetsCard.classList.remove('disabled-section');
    if (mlcCustomCard) mlcCustomCard.classList.remove('disabled-section');
    
    // Reset any ad-hoc opacity/pointerEvents styles from older versions
    const allCards = document.querySelectorAll('#model-tab .card');
    allCards.forEach(card => {
        if (card.id !== 'mlcActiveCard') {
            card.style.opacity = '';
            card.style.pointerEvents = '';
        }
    });
}

async function fetchOllamaModels() {
    const endpoint = getConfiguredOllamaEndpoint();
    const select = document.getElementById('ollamaModelSelect');
    const btn = document.getElementById('ollamaRefreshModelsBtn');

    try {
        btn.disabled = true;
        btn.textContent = '...';

        const response = await fetch(`${endpoint}/api/tags`);
        if (!response.ok) throw new Error('Ollama API error');

        const data = await response.json();
        const models = data.models || [];

        const settings = await chrome.storage.sync.get('ollamaModel');

        select.innerHTML = models.length > 0 
            ? models.map(m => `<option value="${m.name}" ${m.name === settings.ollamaModel ? 'selected' : ''}>${m.name}</option>`).join('')
            : '<option value="">Model bulunamadı</option>';

        if (models.length > 0 && !select.value) {
            // Auto-select first model if none selected
            await chrome.storage.sync.set({ ollamaModel: models[0].name });
        }

    } catch (e) {
        console.error('[Settings] Ollama fetch error:', e);
        select.innerHTML = '<option value="">Hata: Bağlantı kurulamadı</option>';
        showStatus('Ollama bağlantı hatası', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Modelleri Getir';
    }
}

async function loadStats() {
    try {
        const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

        // Update stats overview (Local stats)
        document.getElementById('statTotalScans').textContent = stats.totalScans || 0;
        document.getElementById('statSafeDetected').textContent = stats.safeDetected || 0;
        document.getElementById('statPhishingDetected').textContent = stats.phishingDetected || 0;
        document.getElementById('statLocalAnalyses').textContent = stats.localAnalyses || 0;
        document.getElementById('statRemoteAnalyses').textContent = stats.remoteAnalyses || 0;
        document.getElementById('statUploaded').textContent = stats.resultsUploaded || 0;

        // Render recent scans
        renderRecentScans(stats.recentScans || []);
    } catch (e) {
        console.error('Error loading stats:', e);
    }
}

async function loadServerStats() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SERVER_STATS' });
        if (response && response.success && response.stats) {
            document.getElementById('serverTotalSites').textContent = response.stats.totalSites || 0;
            document.getElementById('serverPhishingSites').textContent = response.stats.phishingSites || 0;
            document.getElementById('serverExtensionAnalyses').textContent = response.stats.extensionAnalyses || 0;
        } else {
            document.getElementById('serverTotalSites').textContent = '-';
            document.getElementById('serverPhishingSites').textContent = '-';
            document.getElementById('serverExtensionAnalyses').textContent = '-';
        }
    } catch (e) {
        console.error('Error loading server stats:', e);
    }
}

function renderRecentScans(scans) {
    const tbody = document.getElementById('recentScansBody');
    if (!tbody) return;

    if (!scans || scans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Henüz tarama yapılmadı</td></tr>';
        return;
    }

    tbody.innerHTML = scans.slice(0, 50).map(scan => {
        const confidence = scan.confidence;
        const confidenceClass = confidence <= 30 ? 'confidence-low' :
            confidence <= 60 ? 'confidence-medium' : 'confidence-high';

        const sourceMap = {
            'local': 'Yerel',
            'remote': 'Genel',
            'compare': 'Karşılaştırma',
            'local-fallback': 'Yerel (Yedek)'
        };
        const sourceLabel = sourceMap[scan.source] || scan.source;

        // Tooltip for dual confidence
        let tooltip = '';
        if (scan.localConfidence !== undefined || scan.remoteConfidence !== undefined) {
            const local = (scan.localConfidence !== null && scan.localConfidence !== undefined) ? `%${scan.localConfidence}` : '-';
            const remote = (scan.remoteConfidence !== null && scan.remoteConfidence !== undefined) ? `%${scan.remoteConfidence}` : '-';
            tooltip = `Yerel: ${local} / Genel: ${remote}`;
        }

        const date = new Date(scan.timestamp).toLocaleString('tr-TR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        return `
            <tr>
                <td title="${scan.url}">${scan.domain}</td>
                <td>
                    <span class="confidence-badge ${confidenceClass}" data-tooltip="${tooltip}">
                        %${confidence}
                    </span>
                </td>
                <td><span class="source-badge">${sourceLabel}</span></td>
                <td style="font-size: 11px; color: var(--text-muted);">${date}</td>
            </tr>
        `;
    }).join('');
}

async function loadLogs() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
        if (response && response.logs) {
            allLogs = response.logs;
            renderLogs(allLogs);
        }
    } catch (e) {
        console.error('Error loading logs:', e);
    }
}

function renderLogs(logs) {
    const viewer = document.getElementById('logViewer');
    if (!viewer) return;

    const filter = document.getElementById('logFilter')?.value || 'all';
    const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.type === filter);

    if (filteredLogs.length === 0) {
        viewer.innerHTML = `<div class="log-entry">Filtreye uygun log bulunamadı. (${filter})</div>`;
        return;
    }

    viewer.innerHTML = filteredLogs.map(log => {
        const time = new Date(log.timestamp).toLocaleTimeString('tr-TR');
        return `
            <div class="log-entry">
                <span class="log-time">[${time}]</span>
                <span class="log-type-${log.type}">${log.type.toUpperCase()}:</span>
                <span class="log-message">${log.message}</span>
            </div>
        `;
    }).join('');

    // Auto scroll to bottom
    viewer.scrollTop = viewer.scrollHeight;
}

function setupEventListeners() {
    // General settings
    document.getElementById('autoScan').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ autoScanOnStartup: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('preloadLLM').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ preloadLLM: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('scanOnSpaNavigation').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ scanOnSpaNavigation: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('unloadAfterInactivity').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ unloadAfterInactivity: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('uploadLocalResults').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ uploadLocalResults: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('showEarlyWarningOnLocalEscalation').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ showEarlyWarningOnLocalEscalation: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    // Block settings
    document.getElementById('blockUntilScanned').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ blockUntilScanned: e.target.checked });
        updateBlockWarning();
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('blockOnSuspicious').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ blockOnSuspicious: e.target.checked });
        updateBlockWarning();
        showStatus('Ayarlar kaydedildi');
    });

    // Fallback threshold
    document.getElementById('useCustomFallbackThreshold').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ useCustomFallbackThreshold: e.target.checked });
        updateFallbackSliderState();
        showStatus('Ayarlar kaydedildi');
    });

    const fallbackSlider = document.getElementById('fallbackThresholdSlider');
    fallbackSlider.addEventListener('input', () => {
        document.getElementById('fallbackThresholdVal').textContent = fallbackSlider.value;
    });
    fallbackSlider.addEventListener('change', async () => {
        await chrome.storage.sync.set({ localFallbackThreshold: parseInt(fallbackSlider.value) });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('maxLogs').addEventListener('change', async (e) => {
        const value = Math.max(10, parseInt(e.target.value) || 100);
        e.target.value = value;
        await chrome.storage.sync.set({ maxLogs: value });
        // Trim the current buffer to the new limit
        while (allLogs.length > value) allLogs.shift();
        showStatus('Ayarlar kaydedildi');
    });

    // Model selection
    document.getElementById('loadModelBtn').addEventListener('click', handleLoadModel);
    const unloadBtn = document.getElementById('unloadModelBtn');
    if (unloadBtn) unloadBtn.addEventListener('click', handleUnloadModel);

    // Tab switching (Main)
    document.querySelectorAll('.settings-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });

    // Add custom model
    document.getElementById('addCustomModelBtn').addEventListener('click', handleAddCustomModel);

    // Toggle form logic
    const formContainer = document.getElementById('customModelFormContainer');
    const toggleBtn = document.getElementById('toggleCustomFormBtn');

    toggleBtn.addEventListener('click', () => {
        const isHidden = formContainer.style.display === 'none';
        formContainer.style.display = isHidden ? 'block' : 'none';
        toggleBtn.style.display = 'none'; // Hide FAB when form is open
        if (isHidden) {
            document.getElementById('customModelId').focus();
            // Scroll to form
            formContainer.scrollIntoView({ behavior: 'smooth' });
        }
    });

    // Cancel custom model
    document.getElementById('cancelCustomModelBtn').addEventListener('click', () => {
        formContainer.style.display = 'none';
        toggleBtn.style.display = 'flex'; // Show FAB again
    });

    // Auto-detect model lib from URL
    document.getElementById('customModelUrl').addEventListener('blur', handleModelUrlBlur);

    // Refresh server stats
    document.getElementById('refreshServerStats').addEventListener('click', async () => {
        await loadServerStats();
        showStatus('Sunucu istatistikleri yenilendi');
    });

    // Clear scans
    document.getElementById('clearScansBtn').addEventListener('click', async () => {
        if (confirm('Tüm tarama geçmişini temizlemek istediğinize emin misiniz?')) {
            await chrome.runtime.sendMessage({ type: 'CLEAR_STATS' });
            await loadStats();
            showStatus('Geçmiş temizlendi');
        }
    });

    // Ollama events
    document.getElementById('ollamaEnabled').addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        if (enabled) {
            document.getElementById('openaiEnabled').checked = false;
            await chrome.storage.sync.set({ openaiEnabled: false });
        }
        await chrome.storage.sync.set({ ollamaEnabled: enabled });
        updateLLMUIState();
        if (enabled) {
            await fetchOllamaModels();
        }
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('ollamaEndpoint').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ ollamaEndpoint: e.target.value.trim() });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('ollamaModelSelect').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ ollamaModel: e.target.value });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('ollamaRefreshModelsBtn').addEventListener('click', fetchOllamaModels);
    document.getElementById('toggleOllamaAdvancedBtn').addEventListener('click', () => {
        const advancedSection = document.getElementById('ollamaAdvancedSection');
        const isCollapsed = advancedSection?.classList.contains('collapsed');
        setOllamaAdvancedVisible(isCollapsed);
    });

    // OpenAI events
    document.getElementById('openaiEnabled').addEventListener('change', async (e) => {
        const enabled = e.target.checked;
        if (enabled) {
            document.getElementById('ollamaEnabled').checked = false;
            await chrome.storage.sync.set({ ollamaEnabled: false });
        }
        await chrome.storage.sync.set({ openaiEnabled: enabled });
        updateLLMUIState();
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('openaiEndpoint').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ openaiEndpoint: e.target.value.trim() });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('openaiModel').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ openaiModel: e.target.value.trim() });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('openaiApiKeyEnabled').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ openaiApiKeyEnabled: e.target.checked });
        updateLLMUIState();
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('openaiApiKey').addEventListener('change', async (e) => {
        await chrome.storage.local.set({ openaiApiKey: e.target.value.trim() });
        showStatus('API anahtarı yerel olarak kaydedildi');
    });

    // Log controls
    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        allLogs = [];
        document.getElementById('logViewer').innerHTML = '<div class="log-entry">Loglar temizlendi.</div>';
    });

    document.getElementById('logFilter').addEventListener('change', () => {
        renderLogs(allLogs);
    });

    document.getElementById('downloadLogsBtn').addEventListener('click', downloadLogs);

    // Exempt list
    document.getElementById('addExemptBtn').addEventListener('click', handleAddExempt);
    document.getElementById('exemptDomainInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAddExempt();
    });

    // Event delegation for dynamically added buttons (CSP fix)
    document.addEventListener('click', (e) => {
        // Handle preset model add
        const addPresetBtn = e.target.closest('[data-action="add-preset"]');
        if (addPresetBtn) {
            const modelId = addPresetBtn.dataset.modelId;
            window.addPresetModel(modelId);
        }

        // Handle preset model select
        const selectPresetBtn = e.target.closest('[data-action="select-preset"]');
        if (selectPresetBtn) {
            const modelId = selectPresetBtn.dataset.modelId;
            window.selectPresetModel(modelId);
        }

        // Handle custom model remove
        const removeCustomBtn = e.target.closest('[data-action="remove-custom"]');
        if (removeCustomBtn) {
            const modelId = removeCustomBtn.dataset.modelId;
            window.removeCustomModel(modelId);
        }

        // Handle exempt domain remove
        const removeExemptBtn = e.target.closest('[data-action="remove-exempt"]');
        if (removeExemptBtn) {
            const domain = removeExemptBtn.dataset.domain;
            handleRemoveExempt(domain);
        }
    });
}

function downloadLogs() {
    try {
        const filter = document.getElementById('logFilter').value;
        const filteredLogs = filter === 'all' ? allLogs : allLogs.filter(l => l.type === filter);

        if (filteredLogs.length === 0) {
            showStatus('İndirilecek log bulunamadı', 'error');
            return;
        }

        const logText = filteredLogs.map(l => {
            const time = new Date(l.timestamp).toLocaleString('tr-TR');
            return `[${time}] ${l.type.toUpperCase()}: ${l.message}`;
        }).join('\n');

        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `ghoti_logs_${date}_${filter}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('Loglar indirildi');
    } catch (e) {
        console.error('Download error:', e);
        showStatus('Loglar indirilemedi', 'error');
    }
}

function setupProgressListener() {
    // Listen for model loading progress
    const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
    runtime.onMessage.addListener((message) => {
        if (message.type === LLM_MESSAGE_TYPES.INIT_PROGRESS) {
            const activityText = message.activity === 'downloading' ? 'Model indiriliyor...' : 'Model yükleniyor...';
            updateProgress(message.progress, `${activityText}`);
        } else if (message.type === LLM_MESSAGE_TYPES.INIT_COMPLETE) {
            hideProgress();
            loadModelInfo();
            showStatus('Model başarıyla yüklendi!');
        } else if (message.type === 'LOG_ENTRY') {
            allLogs.push(message.log);
            const maxLogs = parseInt(document.getElementById('maxLogs')?.value) || 100;
            if (allLogs.length > maxLogs) allLogs.shift();
            appendLog(message.log);
        }
    });
}

function appendLog(log) {
    const viewer = document.getElementById('logViewer');
    if (!viewer) return;

    // Respect filter
    const filter = document.getElementById('logFilter')?.value || 'all';
    if (filter !== 'all' && log.type !== filter) return;

    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date(log.timestamp).toLocaleTimeString('tr-TR');
    div.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="log-type-${log.type}">${log.type.toUpperCase()}:</span>
        <span class="log-message">${log.message}</span>
    `;
    viewer.appendChild(div);

    // Auto scroll if at bottom
    if (viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 50) {
        viewer.scrollTop = viewer.scrollHeight;
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.settings-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${tabName}-tab`);
    });
}


async function loadModelInfo() {
    const modelInfoDiv = document.getElementById('modelInfo');
    if (!modelInfoDiv) return;

    try {
        const status = await llm.getStatus();
        const statusClass = getStatusClass(status.status);
        const statusLabels = {
            'ready': 'Hazır',
            'loading': 'Yükleniyor',
            'error': 'Hata',
            'uninitialized': 'Başlatılmadı'
        };

        modelInfoDiv.innerHTML = `
            <div class="model-status">
                <p><strong>Aktif Model:</strong> ${status.modelId || 'Yüklü model yok'}</p>
                <p><strong>Durum:</strong> <span class="status-badge ${statusClass}">${statusLabels[status.status] || status.status}</span></p>
                <p><strong>Motor:</strong> ${status.engine === 'Ollama' ? 'Ollama' : 'Web-LLM (MLC)'}</p>
            </div>
        `;
    } catch (e) {
        modelInfoDiv.innerHTML = `<p class="error">Model bilgileri yüklenemedi: ${e.message}</p>`;
    }
}

function getStatusClass(status) {
    switch (status) {
        case 'ready': return 'status-ready';
        case 'loading': return 'status-loading';
        case 'error': return 'status-error';
        default: return 'status-uninitialized';
    }
}

function updateModelStatus() {
    loadModelInfo();
}

/**
 * Check if the browser supports shader-f16 WebGPU feature
 */
async function checkShaderF16Support() {
    if (!navigator.gpu) return false;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return false;
        return adapter.features.has('shader-f16');
    } catch (e) {
        console.warn('[Settings] Failed to check shader-f16 support:', e);
        return false;
    }
}

async function loadAvailableModels() {
    const modelSelect = document.getElementById('modelSelect');
    const presetsList = document.getElementById('presetModelsList');
    const customList = document.getElementById('customModelsList');

    const hasShaderF16 = await checkShaderF16Support();
    console.log('[Settings] shader-f16 support:', hasShaderF16);

    try {
        const { custom, presets } = await llm.getAvailableModels();
        const status = await llm.getStatus();
        const selectedModel = (await llm.getSelectedModel()) || status.modelId;

        console.log('[Settings] Loading models:', { customCount: custom.length, presetsCount: presets.length, active: selectedModel });

        // Populate model selector
        modelSelect.innerHTML = '';

        // Add custom models first
        if (custom.length > 0) {
            const customGroup = document.createElement('optgroup');
            customGroup.label = 'Özel Modeller';
            custom.forEach(model => {
                const option = document.createElement('option');
                option.value = model.model_id;
                option.textContent = `${model.model_id} (${model.vram_required_MB || '?'}MB)`;
                if (model.model_id === selectedModel) option.selected = true;
                customGroup.appendChild(option);
            });
            modelSelect.appendChild(customGroup);
        }

        // Add preset models
        const presetGroup = document.createElement('optgroup');
        presetGroup.label = 'Hazır Modeller';
        presets.forEach(model => {
            // Hide f16 models if shader-f16 is not supported
            if (model.model_id.toLowerCase().includes('f16') && !hasShaderF16) {
                return;
            }
            const option = document.createElement('option');
            option.value = model.model_id;
            option.textContent = `${model.model_id} (${model.vram_required_MB}MB)`;
            if (model.model_id === selectedModel) option.selected = true;
            presetGroup.appendChild(option);
        });
        modelSelect.appendChild(presetGroup);

        // Render preset models list
        renderPresetModels(presetsList, presets, custom, hasShaderF16, selectedModel);

        // Filter custom models for display (exclude presets)
        const displayCustom = custom.filter(m => !presets.some(p => p.model_id === m.model_id));

        // Render custom models list
        renderCustomModels(customList, displayCustom, hasShaderF16);

    } catch (e) {
        console.error('Error loading models:', e);
        modelSelect.innerHTML = '<option value="">Modeller yüklenemedi</option>';
    }
}

function renderPresetModels(container, presets, customModels, hasShaderF16, selectedModel) {
    const customIds = new Set(customModels.map(m => m.model_id));

    // Filter out f16 models if not supported
    const visiblePresets = presets.filter(model => {
        return !(model.model_id.toLowerCase().includes('f16') && !hasShaderF16);
    });

    container.innerHTML = visiblePresets.map(model => {
        const isSelected = model.model_id === selectedModel;
        const isInstalled = customIds.has(model.model_id) || isSelected;

        // Define button properties based on state
        let btnClass = 'btn-primary';
        let btnAction = 'add-preset';
        let btnText = 'Ekle';
        let disabled = false;

        if (isSelected) {
            btnClass = 'btn-success'; // Or whatever class represents 'active/selected'
            btnAction = ''; // No action needed since it's already selected
            btnText = 'Seçilen';
            disabled = true;
        } else if (isInstalled) {
            btnClass = 'btn-secondary';
            btnAction = 'select-preset';
            btnText = 'Seç';
            disabled = false; // Make it clickable to select!
        }

        return `
            <div class="model-card ${isInstalled ? 'installed' : ''}">
                <div class="model-info">
                    <div class="model-name">
                        ${model.model_id}
                    </div>
                    <div class="model-meta">
                        ${model.vram_required_MB}MB VRAM
                        ${model.low_resource_required ? ' • Düşük Kaynak' : ''}
                    </div>
                </div>
                <button 
                    class="btn ${btnClass}"
                    data-action="${btnAction}"
                    data-model-id="${model.model_id}"
                    ${disabled ? 'disabled' : ''}
                >
                    ${btnText}
                </button>
            </div>
        `;
    }).join('');
}

function renderCustomModels(container, customModels, hasShaderF16) {
    if (customModels.length === 0) {
        container.innerHTML = '<p class="empty-state">Yüklü özel model bulunamadı.</p>';
        return;
    }

    container.innerHTML = customModels.map(model => {
        const needsF16 = model.model_id.toLowerCase().includes('f16');
        const showWarning = needsF16 && !hasShaderF16;

        return `
        <div class="model-card custom">
            <div class="model-info">
                <div class="model-name">
                    ${model.model_id}
                    ${showWarning ? `<span class="warning-icon" data-tooltip="Tarayıcınız veya donanımınız 16-bit (f16) shader desteğine sahip değil. Bu model çalışmayabilir.">⚠️</span>` : ''}
                </div>
                <div class="model-meta">
                    ${model.vram_required_MB || '?'}MB VRAM
                </div>
            </div>
            <button class="btn btn-danger" data-action="remove-custom" data-model-id="${model.model_id}">Kaldır</button>
        </div>
    `;
    }).join('');
}

window.addPresetModel = async function (modelId) {
    try {
        const { presets } = await llm.getAvailableModels();
        const preset = presets.find(m => m.model_id === modelId);
        if (!preset) throw new Error('Model bulunamadı');

        await llm.addCustomModel({ ...preset });
        showStatus(`${modelId} eklendi`);
        await loadAvailableModels();

        // Auto-select after download for convenience? (Optional, maybe just let them click it)
        // await llm.selectModel(modelId);
        // await llm.reloadModel(modelId);
    } catch (e) {
        showStatus(`Hata: ${e.message}`, 'error');
    }
};

window.selectPresetModel = async function (modelId) {
    try {
        showProgress();
        await llm.selectModel(modelId);
        await llm.reloadModel(modelId);
        showStatus(`${modelId} seçildi`);
        await loadAvailableModels();
        // Also update the dropdown to match
        const select = document.getElementById('modelSelect');
        if (select) select.value = modelId;
    } catch (e) {
        hideProgress();
        showStatus(`Hata: ${e.message}`, 'error');
    }
};

window.removeCustomModel = async function (modelId) {
    if (!confirm(`"${modelId}" modelini kaldırmak istediğinize emin misiniz?`)) return;

    try {
        await llm.removeCustomModel(modelId);
        showStatus(`${modelId} kaldırıldı`);
        await loadAvailableModels();
    } catch (e) {
        showStatus(`Hata: ${e.message}`, 'error');
    }
};

async function handleLoadModel() {
    const modelSelect = document.getElementById('modelSelect');
    const modelId = modelSelect.value;

    if (!modelId) {
        showStatus('Lütfen bir model seçin', 'error');
        return;
    }

    try {
        showProgress();
        await llm.selectModel(modelId);
        await llm.reloadModel(modelId);
    } catch (e) {
        hideProgress();
        showStatus(`Model yüklenirken hata: ${e.message}`, 'error');
    }
}

async function handleUnloadModel() {
    try {
        await llm.unloadModel();
        showStatus('Model bellekten çıkarıldı');
        await loadAvailableModels();
        await loadModelInfo();
    } catch (e) {
        showStatus(`Model çıkarılırken hata: ${e.message}`, 'error');
    }
}

function handleModelUrlBlur() {
    const urlInput = document.getElementById('customModelUrl');
    const modelIdInput = document.getElementById('customModelId');
    const modelLibInput = document.getElementById('customModelLib');

    const url = urlInput.value.trim();
    if (!url) return;

    try {
        const modelRecord = createModelFromUrl(url);

        if (!modelIdInput.value) modelIdInput.value = modelRecord.model_id;
        if (!modelLibInput.value) modelLibInput.value = modelRecord.model_lib;
    } catch (e) {
        console.log('Model detayları algılanamadı:', e.message);
    }
}

async function handleAddCustomModel() {
    const modelId = document.getElementById('customModelId').value.trim();
    const modelUrl = document.getElementById('customModelUrl').value.trim();
    const modelLib = document.getElementById('customModelLib').value.trim();
    const vram = parseInt(document.getElementById('customModelVram').value) || 0;
    const contextSize = parseInt(document.getElementById('customContextSize').value) || 4096;

    if (!modelId || !modelUrl || !modelLib) {
        showStatus('Lütfen tüm gerekli alanları doldurun', 'error');
        return;
    }

    try {
        await llm.addCustomModel({
            model_id: modelId,
            model: modelUrl,
            model_lib: modelLib,
            vram_required_MB: vram,
            overrides: { context_window_size: contextSize },
        });

        // Hide form and show FAB
        document.getElementById('customModelFormContainer').style.display = 'none';
        document.getElementById('toggleCustomFormBtn').style.display = 'flex';

        // Clear inputs
        document.getElementById('customModelId').value = '';
        document.getElementById('customModelUrl').value = '';
        document.getElementById('customModelLib').value = '';
        document.getElementById('customModelVram').value = '0';
        document.getElementById('customContextSize').value = '4096';

        showStatus(`Model "${modelId}" başarıyla eklendi`);

        await loadAvailableModels();
    } catch (e) {
        showStatus(`Hata: ${e.message}`, 'error');
    }
}

function showProgress() {
    const container = document.getElementById('loadProgress');
    container.style.display = 'block';
    updateProgress(0, 'Başlatılıyor...');
}

function hideProgress() {
    const container = document.getElementById('loadProgress');
    container.style.display = 'none';
}

function updateProgress(progress, text) {
    const fill = document.getElementById('progressFill');
    const textEl = document.getElementById('progressText');
    const percentEl = document.getElementById('progressPercent');

    const percent = Math.round(progress * 100);
    fill.style.width = `${percent}%`;
    textEl.textContent = text || `Yükleniyor...`;
    percentEl.textContent = `%${percent}`;
}

function showStatus(msg, type = 'success') {
    const el = document.getElementById('statusMsg');
    if (el) {
        el.textContent = msg;
        el.className = `status-msg ${type === 'error' ? 'error' : ''} show`;
        setTimeout(() => el.classList.remove('show'), 3000);
    }
}

// ---- Whitelist Exemptions ----

async function loadExemptList() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_EXEMPT_LIST' });
        renderExemptList(response.exemptions || []);
    } catch (e) {
        console.error('Error loading exempt list:', e);
    }
}

function renderExemptList(exemptions) {
    const container = document.getElementById('exemptList');
    if (!exemptions.length) {
        container.innerHTML = '<span class="empty-state" style="font-size:13px;">Henüz istisna eklenmedi.</span>';
        return;
    }
    container.innerHTML = exemptions.map(domain =>
        `<span class="exempt-chip">${domain}<button data-action="remove-exempt" data-domain="${domain}" title="Kaldır">&times;</button></span>`
    ).join('');
}

async function handleAddExempt() {
    const input = document.getElementById('exemptDomainInput');
    const domain = input.value.trim().toLowerCase();
    if (!domain) return;
    try {
        const response = await chrome.runtime.sendMessage({ type: 'ADD_EXEMPT_DOMAIN', domain });
        if (response.success) {
            input.value = '';
            renderExemptList(response.exemptions);
            showStatus('İstisna eklendi');
        } else {
            showStatus(response.error || 'Eklenemedi', 'error');
        }
    } catch (e) {
        showStatus('Hata: ' + e.message, 'error');
    }
}

async function handleRemoveExempt(domain) {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'REMOVE_EXEMPT_DOMAIN', domain });
        if (response.success) {
            renderExemptList(response.exemptions);
            showStatus('İstisna kaldırıldı');
        }
    } catch (e) {
        showStatus('Hata: ' + e.message, 'error');
    }
}
