import './settings.css';
import { LLMAdapter, LLM_MESSAGE_TYPES, PRESET_MODELS, createModelFromUrl } from './llm';
import { DEFAULTS } from './config/defaults.js';


// Global LLM adapter instance
let llm = null;

document.addEventListener('DOMContentLoaded', async () => {
    llm = new LLMAdapter({
        onStatusChange: updateModelStatus,
    });

    await loadSettings();
    await loadStats();
    await loadServerStats();
    await loadModelInfo();
    await loadAvailableModels();
    setupEventListeners();
    setupProgressListener();
});

async function loadSettings() {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    document.getElementById('autoScan').checked = settings.autoScanOnStartup;
    document.getElementById('uploadLocalResults').checked = settings.uploadLocalResults;
}

async function loadStats() {
    try {
        const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });

        // Update stats overview
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
            document.getElementById('serverSafeSites').textContent = response.stats.safeSites || 0;
            document.getElementById('serverExtensionAnalyses').textContent = response.stats.extensionAnalyses || 0;
        } else {
            document.getElementById('serverTotalSites').textContent = '-';
            document.getElementById('serverPhishingSites').textContent = '-';
            document.getElementById('serverSafeSites').textContent = '-';
            document.getElementById('serverExtensionAnalyses').textContent = '-';
        }
    } catch (e) {
        console.error('Error loading server stats:', e);
    }
}

function renderRecentScans(scans) {
    const tbody = document.getElementById('recentScansBody');
    if (!tbody) return;

    if (scans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No scans yet</td></tr>';
        return;
    }

    tbody.innerHTML = scans.slice(0, 20).map(scan => {
        const confidenceClass = scan.confidence <= 30 ? 'confidence-low' :
            scan.confidence <= 60 ? 'confidence-medium' : 'confidence-high';
        const sourceClass = scan.source === 'local' ? 'source-local' : 'source-remote';
        const statusClass = scan.isPhishing ? 'status-phishing' : 'status-safe';
        const date = new Date(scan.timestamp).toLocaleDateString('tr-TR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        return `
            <tr>
                <td title="${scan.url}">${scan.domain}</td>
                <td><span class="confidence-badge ${confidenceClass}">${scan.confidence}%</span></td>
                <td><span class="source-badge ${sourceClass}">${scan.source}</span></td>
                <td>${date}</td>
            </tr>
        `;
    }).join('');
}

function setupEventListeners() {
    // General settings
    document.getElementById('autoScan').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ autoScanOnStartup: e.target.checked });
        showStatus('Settings saved');
    });

    document.getElementById('uploadLocalResults').addEventListener('change', async (e) => {
        await chrome.storage.sync.set({ uploadLocalResults: e.target.checked });
        showStatus('Settings saved');
    });

    // Model selection
    document.getElementById('loadModelBtn').addEventListener('click', handleLoadModel);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchTab(tab);
        });
    });

    // Add custom model
    document.getElementById('addCustomModelBtn').addEventListener('click', handleAddCustomModel);

    // Auto-detect model lib from URL
    document.getElementById('customModelUrl').addEventListener('blur', handleModelUrlBlur);

    // Refresh server stats
    document.getElementById('refreshServerStats').addEventListener('click', async () => {
        await loadServerStats();
        showStatus('Server stats refreshed');
    });
}

function setupProgressListener() {
    // Listen for model loading progress
    const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
    runtime.onMessage.addListener((message) => {
        if (message.type === LLM_MESSAGE_TYPES.INIT_PROGRESS) {
            updateProgress(message.progress, message.text);
        } else if (message.type === LLM_MESSAGE_TYPES.INIT_COMPLETE) {
            hideProgress();
            loadModelInfo();
            showStatus('Model loaded successfully!');
        }
    });
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
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

        modelInfoDiv.innerHTML = `
            <div class="model-status">
                <p><strong>Current Model:</strong> ${status.modelId || 'None loaded'}</p>
                <p><strong>Status:</strong> <span class="status-badge ${statusClass}">${status.status}</span></p>
                <p><strong>Engine:</strong> Web-LLM (MLC)</p>
            </div>
        `;
    } catch (e) {
        modelInfoDiv.innerHTML = `<p class="error">Could not load model info: ${e.message}</p>`;
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

function updateModelStatus(status) {
    loadModelInfo();
}

async function loadAvailableModels() {
    const modelSelect = document.getElementById('modelSelect');
    const presetsList = document.getElementById('presetModelsList');
    const customList = document.getElementById('customModelsList');

    try {
        const { custom, presets } = await llm.getAvailableModels();
        const selectedModel = await llm.getSelectedModel();

        // Populate model selector
        modelSelect.innerHTML = '';

        // Add custom models first
        if (custom.length > 0) {
            const customGroup = document.createElement('optgroup');
            customGroup.label = 'Custom Models';
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
        presetGroup.label = 'Preset Models';
        PRESET_MODELS.forEach(model => {
            const option = document.createElement('option');
            option.value = model.model_id;
            option.textContent = `${model.model_id} (${model.vram_required_MB}MB)`;
            if (model.model_id === selectedModel) option.selected = true;
            presetGroup.appendChild(option);
        });
        modelSelect.appendChild(presetGroup);

        // Render preset models list
        renderPresetModels(presetsList, presets, custom);

        // Render custom models list
        renderCustomModels(customList, custom);

    } catch (e) {
        console.error('Error loading models:', e);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
}

function renderPresetModels(container, presets, customModels) {
    const customIds = new Set(customModels.map(m => m.model_id));

    container.innerHTML = PRESET_MODELS.map(model => {
        const isInstalled = customIds.has(model.model_id);
        return `
            <div class="model-item ${isInstalled ? 'installed' : ''}">
                <div class="model-info">
                    <strong>${model.model_id}</strong>
                    <span class="model-meta">
                        ${model.vram_required_MB}MB VRAM
                        ${model.low_resource_required ? ' • Low Resource' : ''}
                    </span>
                </div>
                <button 
                    class="btn btn-small ${isInstalled ? 'btn-disabled' : 'btn-secondary'}"
                    data-model-id="${model.model_id}"
                    ${isInstalled ? 'disabled' : ''}
                    onclick="addPresetModel('${model.model_id}')"
                >
                    ${isInstalled ? 'Installed' : 'Add'}
                </button>
            </div>
        `;
    }).join('');
}

function renderCustomModels(container, customModels) {
    if (customModels.length === 0) {
        container.innerHTML = '<p class="empty-state">No custom models installed.</p>';
        return;
    }

    container.innerHTML = customModels.map(model => `
        <div class="model-item custom">
            <div class="model-info">
                <strong>${model.model_id}</strong>
                <span class="model-meta">
                    ${model.vram_required_MB || '?'}MB VRAM
                    ${model.isCustom ? ' • Custom' : ''}
                </span>
            </div>
            <button 
                class="btn btn-small btn-danger"
                onclick="removeCustomModel('${model.model_id}')"
            >
                Remove
            </button>
        </div>
    `).join('');
}

// Global functions for inline onclick handlers
window.addPresetModel = async function (modelId) {
    try {
        const preset = PRESET_MODELS.find(m => m.model_id === modelId);
        if (!preset) throw new Error('Preset not found');

        await llm.addCustomModel({ ...preset });
        showStatus(`Added ${modelId}`);
        await loadAvailableModels();
    } catch (e) {
        showStatus(`Error: ${e.message}`, 'error');
    }
};

window.removeCustomModel = async function (modelId) {
    if (!confirm(`Remove model "${modelId}"?`)) return;

    try {
        await llm.removeCustomModel(modelId);
        showStatus(`Removed ${modelId}`);
        await loadAvailableModels();
    } catch (e) {
        showStatus(`Error: ${e.message}`, 'error');
    }
};

async function handleLoadModel() {
    const modelSelect = document.getElementById('modelSelect');
    const modelId = modelSelect.value;

    if (!modelId) {
        showStatus('Please select a model', 'error');
        return;
    }

    try {
        showProgress();
        await llm.selectModel(modelId);
        await llm.reloadModel(modelId);
    } catch (e) {
        hideProgress();
        showStatus(`Error loading model: ${e.message}`, 'error');
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

        // Auto-fill if empty
        if (!modelIdInput.value) {
            modelIdInput.value = modelRecord.model_id;
        }
        if (!modelLibInput.value) {
            modelLibInput.value = modelRecord.model_lib;
        }
    } catch (e) {
        // Ignore errors - user can fill manually
        console.log('Could not auto-detect model details:', e.message);
    }
}

async function handleAddCustomModel() {
    const modelId = document.getElementById('customModelId').value.trim();
    const modelUrl = document.getElementById('customModelUrl').value.trim();
    const modelLib = document.getElementById('customModelLib').value.trim();
    const vram = parseInt(document.getElementById('customModelVram').value) || 0;
    const contextSize = parseInt(document.getElementById('customContextSize').value) || 4096;

    if (!modelId || !modelUrl || !modelLib) {
        showStatus('Please fill in Model ID, HuggingFace URL, and WASM Library URL', 'error');
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

        showStatus(`Added custom model: ${modelId}`);

        // Clear form
        document.getElementById('customModelId').value = '';
        document.getElementById('customModelUrl').value = '';
        document.getElementById('customModelLib').value = '';
        document.getElementById('customModelVram').value = '0';
        document.getElementById('customContextSize').value = '4096';

        await loadAvailableModels();
    } catch (e) {
        showStatus(`Error: ${e.message}`, 'error');
    }
}

function showProgress() {
    const container = document.getElementById('loadProgress');
    container.style.display = 'block';
    updateProgress(0, 'Starting...');
}

function hideProgress() {
    const container = document.getElementById('loadProgress');
    container.style.display = 'none';
}

function updateProgress(progress, text) {
    const fill = document.getElementById('progressFill');
    const textEl = document.getElementById('progressText');

    const percent = Math.round(progress * 100);
    fill.style.width = `${percent}%`;
    textEl.textContent = text || `Loading... ${percent}%`;
}

function showStatus(msg, type = 'success') {
    const el = document.getElementById('statusMsg');
    if (el) {
        el.textContent = msg;
        el.className = `status-msg ${type === 'error' ? 'error' : ''}`;
        el.style.opacity = 1;
        setTimeout(() => el.style.opacity = 0, 3000);
    }
}
