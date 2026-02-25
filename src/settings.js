import './settings.css';
import { LLMAdapter, LLM_MESSAGE_TYPES, PRESET_MODELS, createModelFromUrl } from './llm';
import { DEFAULTS } from './config/defaults.js';

// Global LLM adapter instance
let llm = null;
let allLogs = []; // Buffer to store all logs for filtering

document.addEventListener('DOMContentLoaded', async () => {
    llm = new LLMAdapter({
        onStatusChange: updateModelStatus,
    });

    await loadSettings();
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
    document.getElementById('unloadAfterInactivity').checked = settings.unloadAfterInactivity;
    document.getElementById('uploadLocalResults').checked = settings.uploadLocalResults;
    document.getElementById('maxLogs').value = settings.maxLogs;
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

    document.getElementById('unloadAfterInactivity').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ unloadAfterInactivity: e.target.checked });
        showStatus('Ayarlar kaydedildi');
    });

    document.getElementById('uploadLocalResults').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ uploadLocalResults: e.target.checked });
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

    // Log controls
    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        allLogs = [];
        document.getElementById('logViewer').innerHTML = '<div class="log-entry">Loglar temizlendi.</div>';
    });

    document.getElementById('logFilter').addEventListener('change', () => {
        renderLogs(allLogs);
    });

    document.getElementById('downloadLogsBtn').addEventListener('click', downloadLogs);

    // Event delegation for dynamically added buttons (CSP fix)
    document.addEventListener('click', (e) => {
        // Handle preset model add
        const addPresetBtn = e.target.closest('[data-action="add-preset"]');
        if (addPresetBtn) {
            const modelId = addPresetBtn.dataset.modelId;
            window.addPresetModel(modelId);
        }

        // Handle custom model remove
        const removeCustomBtn = e.target.closest('[data-action="remove-custom"]');
        if (removeCustomBtn) {
            const modelId = removeCustomBtn.dataset.modelId;
            window.removeCustomModel(modelId);
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
                <p><strong>Motor:</strong> Web-LLM (MLC)</p>
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
            const option = document.createElement('option');
            option.value = model.model_id;
            option.textContent = `${model.model_id} (${model.vram_required_MB}MB)`;
            if (model.model_id === selectedModel) option.selected = true;
            presetGroup.appendChild(option);
        });
        modelSelect.appendChild(presetGroup);

        // Render preset models list
        renderPresetModels(presetsList, presets, custom, hasShaderF16);

        // Filter custom models for display (exclude presets)
        const displayCustom = custom.filter(m => !presets.some(p => p.model_id === m.model_id));

        // Render custom models list
        renderCustomModels(customList, displayCustom, hasShaderF16);

    } catch (e) {
        console.error('Error loading models:', e);
        modelSelect.innerHTML = '<option value="">Modeller yüklenemedi</option>';
    }
}

function renderPresetModels(container, presets, customModels, hasShaderF16) {
    const customIds = new Set(customModels.map(m => m.model_id));

    container.innerHTML = presets.map(model => {
        const isInstalled = customIds.has(model.model_id);
        const needsF16 = model.model_id.toLowerCase().includes('f16');
        const showWarning = needsF16 && !hasShaderF16;

        return `
            <div class="model-card ${isInstalled ? 'installed' : ''}">
                <div class="model-info">
                    <div class="model-name">
                        ${model.model_id}
                        ${showWarning ? `<span class="warning-icon" data-tooltip="Tarayıcınız veya donanımınız 16-bit (f16) shader desteğine sahip değil. Bu model çalışmayabilir.">⚠️</span>` : ''}
                    </div>
                    <div class="model-meta">
                        ${model.vram_required_MB}MB VRAM
                        ${model.low_resource_required ? ' • Düşük Kaynak' : ''}
                    </div>
                </div>
                <button 
                    class="btn ${isInstalled ? 'btn-secondary' : 'btn-primary'}"
                    data-action="add-preset"
                    data-model-id="${model.model_id}"
                    ${isInstalled ? 'disabled' : ''}
                >
                    ${isInstalled ? 'Yüklendi' : 'Ekle'}
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
    } catch (e) {
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
