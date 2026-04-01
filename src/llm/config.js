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
    ERROR: 'LLM_ERROR',

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
    UNLOAD_MODEL: 'LLM_UNLOAD_MODEL',
};

// Default model configuration
export const DEFAULT_CONFIG = {
    // Small model for quick testing - change to larger model for production
    modelId: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    // modelId: "Qwen3-0.6B-q4f32_1-MLC"
    // Alternative models (uncomment to use):
    // modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    // modelId: 'Phi-3-mini-4k-instruct-q4f16_1-MLC',
    // modelId: 'gemma-2b-it-q4f16_1-MLC',
};

// LLM generation options
export const LLM_OPTIONS = {
    temperature: 0.25, // Slightly higher for better generation quality
    repetition_penalty: 1.1,
    // Add these for smaller models to ensure they stop generating after JSON is complete
    stop: ["}", "}\n", "```", "```json", "<|endoftext|>", "<|im_end|>"],
    max_tokens: 3072,  // Limit output to ~2048 tokens (plenty for JSON response)
    response_format: { type: "json_object" }
};

// Status states
export const LLM_STATUS = {
    UNINITIALIZED: 'uninitialized',
    LOADING: 'loading',
    READY: 'ready',
    GENERATING: 'generating',
    ERROR: 'error',
};
