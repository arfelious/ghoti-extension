/**
 * LLM Module
 * Re-exports all public APIs for the web-llm integration
 * 
 * Usage:
 * 
 * // In popup/content scripts:
 * import { LLMAdapter } from './llm';
 * const llm = new LLMAdapter();
 * const response = await llm.chat("Hello!");
 * 
 * // In background script:
 * import { createLLMHandler, LLM_MESSAGE_TYPES } from './llm';
 * const handler = createLLMHandler();
 * // Attach to message listener
 */

// Adapter for frontend (popup, content scripts)
export { LLMAdapter } from './adapter.js';

// Handler for background script
export { createLLMHandler } from './handler.js';

// Configuration and constants
export {
    LLM_MESSAGE_TYPES,
    DEFAULT_CONFIG,
    ENGINE_OPTIONS,
    LLM_STATUS,
} from './config.js';

// Custom model management
export {
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
} from './models.js';
