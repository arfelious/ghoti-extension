/**
 * LLM Adapter
 * Frontend adapter for sending LLM requests from popup/content scripts
 * 
 * This adapter abstracts the messaging to the background script,
 * making it easy to use LLM functionality from any context.
 */

import { LLM_MESSAGE_TYPES, LLM_STATUS } from './config.js';

// Use browser API (Firefox) or chrome API
const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;

/**
 * LLM Adapter class for frontend usage
 */
export class LLMAdapter {
    constructor(options = {}) {
        this.status = LLM_STATUS.UNINITIALIZED;
        this.onProgress = options.onProgress || null;
        this.onStatusChange = options.onStatusChange || null;
        this._initPromise = null;
    }

    /**
     * Initialize the LLM engine (triggers model loading in background)
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initPromise) {
            return this._initPromise;
        }

        this._initPromise = new Promise(async (resolve, reject) => {
            try {
                this._setStatus(LLM_STATUS.LOADING);

                const response = await runtime.sendMessage({
                    type: LLM_MESSAGE_TYPES.INIT,
                });

                if (response.error) {
                    this._setStatus(LLM_STATUS.ERROR);
                    reject(new Error(response.error));
                } else {
                    this._setStatus(LLM_STATUS.READY);
                    resolve();
                }
            } catch (error) {
                this._setStatus(LLM_STATUS.ERROR);
                reject(error);
            }
        });

        return this._initPromise;
    }

    /**
     * Send a chat message and get a complete response
     * @param {string} message - User message
     * @param {Object} options - Chat options (temperature, max_tokens, etc.)
     * @returns {Promise<string>} - Complete response
     */
    async chat(message, options = {}) {
        await this._ensureReady();
        this._setStatus(LLM_STATUS.GENERATING);

        try {
            const response = await runtime.sendMessage({
                type: LLM_MESSAGE_TYPES.CHAT,
                message,
                options,
            });

            this._setStatus(LLM_STATUS.READY);

            if (response.error) {
                throw new Error(response.error);
            }

            return response.content;
        } catch (error) {
            this._setStatus(LLM_STATUS.ERROR);
            throw error;
        }
    }

    /**
     * Send a chat message and get a streaming response
     * @param {string} message - User message
     * @param {Object} options - Chat options
     * @yields {string} - Response chunks
     */
    async *chatStream(message, options = {}) {
        await this._ensureReady();
        this._setStatus(LLM_STATUS.GENERATING);

        // Create a unique stream ID for this request
        const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Set up message listener for chunks
        const chunks = [];
        let done = false;
        let error = null;

        const listener = (msg) => {
            if (msg.streamId !== streamId) return;

            if (msg.type === LLM_MESSAGE_TYPES.CHAT_STREAM_CHUNK) {
                chunks.push(msg.content);
            } else if (msg.type === LLM_MESSAGE_TYPES.CHAT_STREAM_END) {
                done = true;
            } else if (msg.type === 'LLM_ERROR') {
                error = new Error(msg.error);
                done = true;
            }
        };

        runtime.onMessage.addListener(listener);

        try {
            // Start the stream
            runtime.sendMessage({
                type: LLM_MESSAGE_TYPES.CHAT_STREAM,
                message,
                options,
                streamId,
            });

            // Yield chunks as they arrive
            while (!done || chunks.length > 0) {
                if (chunks.length > 0) {
                    yield chunks.shift();
                } else if (!done) {
                    // Wait for more chunks
                    await new Promise(r => setTimeout(r, 10));
                }
            }

            if (error) {
                throw error;
            }

            this._setStatus(LLM_STATUS.READY);
        } finally {
            runtime.onMessage.removeListener(listener);
        }
    }

    /**
     * Reset the chat history
     */
    async reset() {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.RESET,
        });

        if (response.error) {
            throw new Error(response.error);
        }
    }

    /**
     * Abort current generation
     */
    async abort() {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.ABORT,
        });

        this._setStatus(LLM_STATUS.READY);

        if (response.error) {
            throw new Error(response.error);
        }
    }

    /**
     * Get current status
     * @returns {Promise<Object>}
     */
    async getStatus() {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.GET_STATUS,
        });

        if (response.error) {
            throw new Error(response.error);
        }

        return response;
    }

    // ==================
    // Model Management
    // ==================

    /**
     * Get all available models (custom + presets)
     * @returns {Promise<{custom: Array, presets: Array, all: Array}>}
     */
    async getAvailableModels() {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.GET_AVAILABLE_MODELS,
        });

        if (response.error) {
            throw new Error(response.error);
        }

        return response;
    }

    /**
     * Add a custom model
     * @param {Object} modelRecord - Model record with model, model_id, model_lib
     * @returns {Promise<Object>} The added model record
     */
    async addCustomModel(modelRecord) {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.ADD_CUSTOM_MODEL,
            modelRecord,
        });

        if (response.error) {
            throw new Error(response.error);
        }

        return response;
    }

    /**
     * Remove a custom model
     * @param {string} modelId - ID of the model to remove
     */
    async removeCustomModel(modelId) {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.REMOVE_CUSTOM_MODEL,
            modelId,
        });

        if (response.error) {
            throw new Error(response.error);
        }
    }

    /**
     * Get the currently selected model ID
     * @returns {Promise<string|null>}
     */
    async getSelectedModel() {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.GET_SELECTED_MODEL,
        });

        if (response.error) {
            throw new Error(response.error);
        }

        return response.modelId;
    }

    /**
     * Select a model to use
     * @param {string} modelId - ID of the model to select
     */
    async selectModel(modelId) {
        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.SELECT_MODEL,
            modelId,
        });

        if (response.error) {
            throw new Error(response.error);
        }
    }

    /**
     * Reload with a specific model (unloads current model if different)
     * @param {string} modelId - ID of the model to load
     * @returns {Promise<Object>} Result with the loaded modelId
     */
    async reloadModel(modelId) {
        this._setStatus(LLM_STATUS.LOADING);
        this._initPromise = null;

        const response = await runtime.sendMessage({
            type: LLM_MESSAGE_TYPES.RELOAD_MODEL,
            modelId,
        });

        if (response.error) {
            this._setStatus(LLM_STATUS.ERROR);
            throw new Error(response.error);
        }

        this._setStatus(LLM_STATUS.READY);
        return response;
    }

    // Private methods

    async _ensureReady() {
        if (this.status === LLM_STATUS.UNINITIALIZED) {
            await this.init();
        } else if (this.status === LLM_STATUS.LOADING) {
            await this._initPromise;
        } else if (this.status === LLM_STATUS.ERROR) {
            throw new Error('LLM is in error state. Please reload the extension.');
        }
    }

    _setStatus(status) {
        this.status = status;
        if (this.onStatusChange) {
            this.onStatusChange(status);
        }
    }
}

export default LLMAdapter;
