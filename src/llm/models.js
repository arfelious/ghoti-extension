/**
 * Custom Models Configuration
 * Allows adding and managing custom web-llm models
 * 
 * Model format follows web-llm's ModelRecord interface:
 * - model: HuggingFace URL (e.g., https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC)
 * - model_id: Unique identifier for the model
 * - model_lib: URL to the WASM model library
 * - vram_required_MB: (optional) VRAM requirement in MB
 * - low_resource_required: (optional) Whether it can run on low-resource devices
 * - overrides: (optional) Chat config overrides like context_window_size
 */

// Use browser API (Firefox), chrome API, or mock for Node.js
const storage = (typeof browser !== 'undefined' && browser.storage)
    ? browser.storage
    : ((typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null);

// Model library URL prefix from web-llm
export const MODEL_LIB_URL_PREFIX = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/';
export const MODEL_VERSION = 'v0_2_80';

/**
 * Preset custom models that users can easily add
 * These are models available in MLC but may require specific configuration
*/
export const PRESET_MODELS = [
    // Qwen2.5 models
    {
        model: 'https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
        model_id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen2-0.5B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 600,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // Qwen3 models
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
        model_id: 'Qwen3-0.6B-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 946,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f32_1-MLC',
        model_id: 'Qwen3-0.6B-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-0.6B-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 1200, // Estimated
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC',
        model_id: 'Qwen3-1.7B-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-1.7B-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 1770,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f32_1-MLC',
        model_id: 'Qwen3-1.7B-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-1.7B-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 2000, // Estimated
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC',
        model_id: 'Qwen3-4B-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-4B-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 3432,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-4B-q4f32_1-MLC',
        model_id: 'Qwen3-4B-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-4B-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 4328,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC',
        model_id: 'Qwen3-8B-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-8B-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 5696,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Qwen3-8B-q4f32_1-MLC',
        model_id: 'Qwen3-8B-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen3-8B-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 7100, // Estimated
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Llama 3.2 models
    {
        model: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC',
        model_id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Llama-3.2-1B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 879,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f32_1-MLC',
        model_id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Llama-3.2-1B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 1150, // Estimated
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC',
        model_id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Llama-3.2-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 2264,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f32_1-MLC',
        model_id: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Llama-3.2-3B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 3000, // Estimated
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // Phi-3.5 models
    {
        model: 'https://huggingface.co/mlc-ai/Phi-3.5-mini-instruct-q4f16_1-MLC',
        model_id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Phi-3.5-mini-instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 2870,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/Phi-3.5-mini-instruct-q4f32_1-MLC',
        model_id: 'Phi-3.5-mini-instruct-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Phi-3.5-mini-instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 3600, // Estimated
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // DeepSeek-R1 distillations
    {
        model: 'https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
        model_id: 'DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen2-7B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 5438,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: 'https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Qwen-7B-q4f32_1-MLC',
        model_id: 'DeepSeek-R1-Distill-Qwen-7B-q4f32_1-MLC',
        model_lib: `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/Qwen2-7B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm`,
        vram_required_MB: 7000, // Estimated
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
];

/**
 * Storage key for custom models
 */
const STORAGE_KEY_CUSTOM_MODELS = 'ghoti_custom_models';
const STORAGE_KEY_SELECTED_MODEL = 'ghoti_selected_model';

/**
 * Get all custom models from storage
 * @returns {Promise<Array>} Array of custom model records
 */
export async function getCustomModels() {
    try {
        const result = await storage.local.get(STORAGE_KEY_CUSTOM_MODELS);
        return result[STORAGE_KEY_CUSTOM_MODELS] || [];
    } catch (e) {
        console.error('[Models] Error loading custom models:', e);
        return [];
    }
}

/**
 * Save custom models to storage
 * @param {Array} models - Array of model records
 */
export async function saveCustomModels(models) {
    try {
        await storage.local.set({ [STORAGE_KEY_CUSTOM_MODELS]: models });
    } catch (e) {
        console.error('[Models] Error saving custom models:', e);
        throw e;
    }
}

/**
 * Add a custom model
 * @param {Object} modelRecord - Model record following ModelRecord interface
 * @returns {Promise<Object>} The added model record
 */
export async function addCustomModel(modelRecord) {
    // Validate required fields
    if (!modelRecord.model_id) {
        throw new Error('model_id is required');
    }
    if (!modelRecord.model) {
        throw new Error('model (HuggingFace URL) is required');
    }
    if (!modelRecord.model_lib) {
        throw new Error('model_lib (WASM URL) is required');
    }

    const models = await getCustomModels();

    // Check for duplicate model_id
    if (models.some(m => m.model_id === modelRecord.model_id)) {
        throw new Error(`Model with ID "${modelRecord.model_id}" already exists`);
    }

    // Add default values
    const newModel = {
        ...modelRecord,
        vram_required_MB: modelRecord.vram_required_MB || 0,
        low_resource_required: modelRecord.low_resource_required ?? true,
        overrides: modelRecord.overrides || { context_window_size: 4096 },
        isCustom: true, // Mark as user-added
    };

    models.push(newModel);
    await saveCustomModels(models);

    return newModel;
}

/**
 * Remove a custom model
 * @param {string} modelId - The model_id to remove
 */
export async function removeCustomModel(modelId) {
    const models = await getCustomModels();
    const filtered = models.filter(m => m.model_id !== modelId);

    if (filtered.length === models.length) {
        throw new Error(`Model "${modelId}" not found`);
    }

    await saveCustomModels(filtered);
}

/**
 * Get the currently selected model ID
 * @returns {Promise<string|null>}
 */
export async function getSelectedModel() {
    try {
        const result = await storage.local.get(STORAGE_KEY_SELECTED_MODEL);
        return result[STORAGE_KEY_SELECTED_MODEL] || null;
    } catch (e) {
        console.error('[Models] Error getting selected model:', e);
        return null;
    }
}

/**
 * Set the selected model ID
 * @param {string} modelId
 */
export async function setSelectedModel(modelId) {
    try {
        await storage.local.set({ [STORAGE_KEY_SELECTED_MODEL]: modelId });
    } catch (e) {
        console.error('[Models] Error setting selected model:', e);
        throw e;
    }
}

/**
 * Add a preset model to custom models
 * @param {string} modelId - ID of the preset model to add
 */
export async function addPresetModel(modelId) {
    const preset = PRESET_MODELS.find(m => m.model_id === modelId);
    if (!preset) {
        throw new Error(`Preset model "${modelId}" not found`);
    }
    return addCustomModel({ ...preset });
}

/**
 * Create a custom model record from a HuggingFace URL
 * Attempts to auto-detect model library from model name patterns
 * @param {string} huggingfaceUrl - URL like https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC
 * @param {Object} options - Additional options
 * @returns {Object} Model record
 */
export function createModelFromUrl(huggingfaceUrl, options = {}) {
    // Extract model ID from URL
    const urlMatch = huggingfaceUrl.match(/huggingface\.co\/([^/]+)\/([^/]+)/);
    if (!urlMatch) {
        throw new Error('Invalid HuggingFace URL format');
    }

    const [, org, modelName] = urlMatch;
    const modelId = options.model_id || modelName;

    // Try to auto-detect model library based on common patterns
    let modelLib = options.model_lib;
    if (!modelLib) {
        // Common model family detection patterns
        const patterns = [
            { regex: /Qwen3\.5-(\d+\.?\d*)B/i, lib: (m) => `Qwen3.5-${m[1]}B` },
            { regex: /Qwen3-(\d+\.?\d*)B/i, lib: (m) => `Qwen3-${m[1]}B` },
            { regex: /Qwen2\.5?-(\d+\.?\d*)B/i, lib: (m) => `Qwen2-${m[1]}B-Instruct` },
            { regex: /Llama-3\.2?-(\d+)B/i, lib: (m) => `Llama-3.2-${m[1]}B-Instruct` },
            { regex: /Llama-3\.1?-(\d+)B/i, lib: (m) => `Llama-3.1-${m[1]}B-Instruct` },
            { regex: /Phi-3\.5/i, lib: () => `Phi-3.5-mini-instruct` },
            { regex: /SmolLM2-(\d+\.?\d*)(M|B)/i, lib: (m) => `SmolLM2-${m[1]}${m[2]}-Instruct` },
        ];

        // Extract quantization from model name
        const quantMatch = modelName.match(/(q\d+f\d+(?:_\d+)?)/i);
        const quant = quantMatch ? quantMatch[1] : 'q4f16_1';

        for (const { regex, lib } of patterns) {
            const match = modelName.match(regex);
            if (match) {
                const baseName = lib(match);
                modelLib = `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/${baseName}-${quant}-ctx4k_cs1k-webgpu.wasm`;
                break;
            }
        }
    }

    if (!modelLib) {
        throw new Error(
            'Could not auto-detect model library. Please provide model_lib option manually.\n' +
            'Format: https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_80/{MODEL_NAME}-webgpu.wasm'
        );
    }

    return {
        model: huggingfaceUrl.replace(/\/$/, ''), // Remove trailing slash
        model_id: modelId,
        model_lib: modelLib,
        vram_required_MB: options.vram_required_MB || 0,
        low_resource_required: options.low_resource_required ?? true,
        overrides: options.overrides || { context_window_size: 4096 },
    };
}

/**
 * Get all available models (presets + custom)
 * @returns {Promise<Array>}
 */
export async function getAllAvailableModels() {
    const custom = await getCustomModels();

    // Use full list of presets, UI will handle installed status
    return {
        custom,
        presets: PRESET_MODELS,
        all: [...custom, ...PRESET_MODELS],
    };
}

/**
 * Build an AppConfig for web-llm with custom models
 * @param {Array} customModels - Array of custom model records
 * @returns {Object} AppConfig object
 */
export function buildAppConfig(customModels = []) {
    return {
        useIndexedDBCache: true, // Use IndexedDB for better caching
        model_list: customModels,
    };
}

export default {
    PRESET_MODELS,
    MODEL_LIB_URL_PREFIX,
    MODEL_VERSION,
    getCustomModels,
    saveCustomModels,
    addCustomModel,
    removeCustomModel,
    getSelectedModel,
    setSelectedModel,
    addPresetModel,
    createModelFromUrl,
    getAllAvailableModels,
    buildAppConfig,
};
