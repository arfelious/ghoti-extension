/**
 * LLM Module Configuration
 * Constants and default settings for the web-llm integration
 */

// Message types for communication between popup/content scripts and background
export const LLM_MESSAGE_TYPES = {
    // Initialization
    INIT: 'LLM_INIT',
    INIT_PROGRESS: 'LLM_INIT_PROGRESS',
    INIT_COMPLETE: 'LLM_INIT_COMPLETE',

    // Chat
    CHAT: 'LLM_CHAT',
    CHAT_STREAM: 'LLM_CHAT_STREAM',
    CHAT_STREAM_CHUNK: 'LLM_CHAT_STREAM_CHUNK',
    CHAT_STREAM_END: 'LLM_CHAT_STREAM_END',

    // Control
    RESET: 'LLM_RESET',
    GET_STATUS: 'LLM_GET_STATUS',
    ABORT: 'LLM_ABORT',

    // Model Management
    GET_AVAILABLE_MODELS: 'LLM_GET_AVAILABLE_MODELS',
    ADD_CUSTOM_MODEL: 'LLM_ADD_CUSTOM_MODEL',
    REMOVE_CUSTOM_MODEL: 'LLM_REMOVE_CUSTOM_MODEL',
    SELECT_MODEL: 'LLM_SELECT_MODEL',
    GET_SELECTED_MODEL: 'LLM_GET_SELECTED_MODEL',
    RELOAD_MODEL: 'LLM_RELOAD_MODEL',
};

// Default model configuration
export const DEFAULT_CONFIG = {
    // Small model for quick testing - change to larger model for production
    modelId: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',

    // Alternative models (uncomment to use):
    // modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    // modelId: 'Phi-3-mini-4k-instruct-q4f16_1-MLC',
    // modelId: 'gemma-2b-it-q4f16_1-MLC',
};

// Engine initialization options
export const ENGINE_OPTIONS = {
    // Optional: Override chat options
    chatOpts: {
        // temperature: 0.7,
        // max_tokens: 2048,
    },
};

// Default generation options for phishing analysis
export const GENERATION_DEFAULTS = {
    max_tokens: 512,  // Limit output to ~512 tokens (plenty for JSON response)
    temperature: 0.1, // Low temperature for consistent output
};

// Status states
export const LLM_STATUS = {
    UNINITIALIZED: 'uninitialized',
    LOADING: 'loading',
    READY: 'ready',
    GENERATING: 'generating',
    ERROR: 'error',
};

// Prompt for phishing analysis (legacy - actual prompt is in shared/prompt-builder.js)
export const PHISHING_ANALYSIS_PROMPT = `You are a phishing detection expert. Analyze the webpage and provide a risk assessment.

CONFIDENCE SCALE (must match your reasoning):
- 0-15: SAFE - Legitimate site with clear trust signals
- 16-35: LOW RISK - Minor concerns but no real threats  
- 36-55: MODERATE - Suspicious elements, needs caution
- 56-75: HIGH RISK - Multiple phishing indicators
- 76-100: PHISHING - Clear malicious intent detected

RESPOND WITH JSON ONLY:
{"confidence": NUMBER, "reasoning": "Your analysis"}

Webpage Content:
`;
