/**
 * LLM Handler
 * Background script handler with MLCEngine
 * 
 * This handler manages the web-llm engine and processes
 * messages from the frontend adapter.
 */

import { CreateMLCEngine } from '../web-llm';
import { LLM_MESSAGE_TYPES, DEFAULT_CONFIG, LLM_STATUS } from './config.js';
import { DEFAULTS } from '../config/defaults.js';
import {
    getCustomModels,
    addCustomModel,
    removeCustomModel,
    getSelectedModel,
    setSelectedModel,
    getAllAvailableModels,
    buildAppConfig,
    PRESET_MODELS,
} from './models.js';

// Use browser API (Firefox) or chrome API
const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;

/**
 * Create an LLM handler for the background script
 * @param {Object} options - Handler options
 * @returns {Object} Handler with handleMessage method
 */
export function createLLMHandler(options = {}) {
    const config = {
        modelId: options.model || DEFAULT_CONFIG.modelId,
        onProgress: options.onProgress || null,
    };

    let engine = null;
    let status = LLM_STATUS.UNINITIALIZED;
    let loadProgress = 0;
    let chatHistory = [];
    let currentModelId = null;
    let inactivityTimer = null;
    const INACTIVITY_LIMIT = 30 * 60 * 1000; // 30 minutes in milliseconds

    // Request queue for thread-safe sequential processing
    let requestQueue = [];
    let isProcessing = false;

    /**
     * Get the model ID to use (from storage or default)
     */
    async function getModelIdToUse() {
        const selectedModel = await getSelectedModel();
        return selectedModel || config.modelId;
    }

    /**
     * Reset the inactivity timer. If it expires, the engine will be unloaded.
     */
    async function resetInactivityTimer() {
        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }

        const settings = await chrome.storage.sync.get(DEFAULTS);
        if (settings.unloadAfterInactivity && status !== LLM_STATUS.UNINITIALIZED) {
            inactivityTimer = setTimeout(async () => {
                console.log(`[LLM Handler] Inactivity limit (${INACTIVITY_LIMIT / 1000 / 60}m) reached. Unloading engine...`);
                await unloadEngine();
            }, INACTIVITY_LIMIT);
        }
    }

    /**
     * Build engine config with custom models
     */
    async function buildEngineConfig() {
        const customModels = await getCustomModels();

        // Build appConfig with custom models if any exist
        if (customModels.length > 0) {
            return {
                appConfig: buildAppConfig(customModels),
            };
        }

        return {}; // Use default prebuilt config
    }

    /**
     * Initialize the MLCEngine
     * @param {string} modelId - Optional model ID to load (uses selected or default if not provided)
     */
    async function initEngine(modelId = null) {
        const targetModelId = modelId || await getModelIdToUse();

        // If already loaded with same model, skip
        if (engine && currentModelId === targetModelId) {
            return;
        }

        // If different model requested, unload current
        if (engine && currentModelId !== targetModelId) {
            await unloadEngine();
        }

        if (status === LLM_STATUS.LOADING) {
            // Wait for existing load to complete
            while (status === LLM_STATUS.LOADING) {
                await new Promise(r => setTimeout(r, 100));
            }
            return;
        }

        status = LLM_STATUS.LOADING;
        currentModelId = targetModelId;

        try {
            const initProgressCallback = (progress) => {
                loadProgress = progress.progress;

                // Detect activity type from text
                let activity = 'loading';
                const text = progress.text || '';
                const lowerText = text.toLowerCase();
                if (lowerText.includes('populate the cache')) {
                    activity = 'downloading';
                } else if (lowerText.includes('loading') || lowerText.includes('init')) {
                    activity = 'loading';
                }

                if (config.onProgress) {
                    config.onProgress({ ...progress, activity });
                }
                // Broadcast progress to all extension contexts
                runtime.sendMessage({
                    type: LLM_MESSAGE_TYPES.INIT_PROGRESS,
                    progress: progress.progress,
                    text: progress.text,
                    activity, // New field for UI granularity
                    modelId: currentModelId,
                }).catch(() => { }); // Ignore errors if no listeners
            };

            const engineConfig = await buildEngineConfig();
            engineConfig.initProgressCallback = initProgressCallback;
            engineConfig.unsafeBufferCreation = true;
            engineConfig.deviceSyncFrequency = 100;
            engine = await CreateMLCEngine(targetModelId, engineConfig);

            status = LLM_STATUS.READY;
            resetInactivityTimer(); // Start/Reset timer when engine is ready

            runtime.sendMessage({
                type: LLM_MESSAGE_TYPES.INIT_COMPLETE,
                modelId: currentModelId,
            }).catch(() => { });

        } catch (error) {
            status = LLM_STATUS.ERROR;
            currentModelId = null;
            console.error('[LLM Handler] Init error:', error);
            throw error;
        }
    }

    /**
     * Unload the current engine
     */
    async function unloadEngine() {
        if (engine) {
            try {
                await engine.unload();
            } catch (e) {
                console.warn('[LLM Handler] Error unloading engine:', e);
            }
            engine = null;
        }
        status = LLM_STATUS.UNINITIALIZED;
        currentModelId = null;
        chatHistory = [];
        loadProgress = 0;

        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
    }

    /**
     * Process the request queue sequentially
     */
    async function processQueue() {
        if (isProcessing || requestQueue.length === 0) {
            return;
        }

        isProcessing = true;

        while (requestQueue.length > 0) {
            const { message, options, resolve, reject } = requestQueue.shift();

            try {
                console.log("processing", message, options)
                const result = await executeChat(message, options);
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }

        isProcessing = false;
    }

    /**
     * Execute chat completion (internal, called by queue processor)
     */
    async function executeChat(message, options = {}) {
        await initEngine();
        status = LLM_STATUS.GENERATING;

        try {
            await engine.resetChat();
            chatHistory = [{ role: 'user', content: message }];

            const response = await engine.chat.completions.create({
                messages: chatHistory,
                ...options,
            });

            const assistantMessage = response.choices[0].message.content;

            // Log generation statistics (tokens/sec) - Use modern usage API instead of deprecated runtimeStatsText
            if (response.usage) {
                const u = response.usage;
                const statsMsg = `[LLM Handler] Generation complete. Tokens: ${u.prompt_tokens}p + ${u.completion_tokens}c = ${u.total_tokens}t`;
                console.log(statsMsg);

                // WebLLM specific performance stats if available in extra
                if (u.extra) {
                    const perf = `[LLM Handler] Performance: Prefill ${u.extra.prefill_tokens_per_s?.toFixed(1)} t/s, Decode ${u.extra.decode_tokens_per_s?.toFixed(1)} t/s`;
                    console.log(perf);
                }
            }

            status = LLM_STATUS.READY;
            resetInactivityTimer(); // Reset timer after each chat execution
            return { content: assistantMessage };
        } catch (error) {
            status = LLM_STATUS.ERROR;
            // Reset on error to recover
            chatHistory = [];
            if (engine) {
                await engine.resetChat();
            }
            throw error;
        }
    }

    /**
     * Handle chat completion (non-streaming) - queued for thread safety
     */
    function handleChat(message, options = {}) {
        return new Promise((resolve, reject) => {
            requestQueue.push({ message, options, resolve, reject });
            processQueue();
        });
    }

    /**
     * Handle streaming chat completion
     */
    async function handleChatStream(message, options = {}, streamId, sender) {
        await initEngine();
        status = LLM_STATUS.GENERATING;

        try {
            // Reset for a fresh stream if it's the start of a turn
            await engine.resetChat();
            chatHistory = [{ role: 'user', content: message }];

            const stream = await engine.chat.completions.create({
                messages: chatHistory,
                stream: true,
                stream_options: { include_usage: true },
                ...options,
            });

            let fullContent = '';

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content || '';

                // Handle usage stats in the last chunk
                if (chunk.usage) {
                    const u = chunk.usage;
                    console.log(`[LLM Handler] Stream complete. Tokens: ${u.prompt_tokens}p + ${u.completion_tokens}c = ${u.total_tokens}t`);
                    if (u.extra) {
                        console.log(`[LLM Handler] Stream Performance: Prefill ${u.extra.prefill_tokens_per_s?.toFixed(1)} t/s, Decode ${u.extra.decode_tokens_per_s?.toFixed(1)} t/s`);
                    }
                }

                if (delta) {
                    fullContent += delta;
                    // Send chunk to the requesting tab/popup
                    if (sender?.tab?.id) {
                        chrome.tabs.sendMessage(sender.tab.id, {
                            type: LLM_MESSAGE_TYPES.CHAT_STREAM_CHUNK,
                            streamId,
                            content: delta,
                        }).catch(() => { });
                    } else {
                        runtime.sendMessage({
                            type: LLM_MESSAGE_TYPES.CHAT_STREAM_CHUNK,
                            streamId,
                            content: delta,
                        }).catch(() => { });
                    }
                }
            }

            chatHistory.push({ role: 'assistant', content: fullContent });

            // Send end signal
            const endMsg = {
                type: LLM_MESSAGE_TYPES.CHAT_STREAM_END,
                streamId,
            };
            if (sender?.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, endMsg).catch(() => { });
            } else {
                runtime.sendMessage(endMsg).catch(() => { });
            }

            status = LLM_STATUS.READY;
            return { success: true };
        } catch (error) {
            status = LLM_STATUS.ERROR;
            throw error;
        }
    }

    /**
     * Main message handler
     */
    async function handleMessage(message, sender) {
        try {
            switch (message.type) {
                case LLM_MESSAGE_TYPES.INIT:
                    await initEngine();
                    return { success: true, status };

                case LLM_MESSAGE_TYPES.CHAT:
                    return await handleChat(message.message, message.options);

                case LLM_MESSAGE_TYPES.CHAT_STREAM:
                    // Don't await - let it stream
                    handleChatStream(message.message, message.options, message.streamId, sender);
                    return { success: true, streaming: true };

                case LLM_MESSAGE_TYPES.RESET:
                    if (engine) {
                        await engine.resetChat();
                    }
                    chatHistory = [];
                    return { success: true };

                case LLM_MESSAGE_TYPES.ABORT:
                    if (engine) {
                        await engine.interruptGenerate();
                    }
                    status = LLM_STATUS.READY;
                    return { success: true };

                case LLM_MESSAGE_TYPES.GET_STATUS:
                    return {
                        status,
                        loadProgress,
                        modelId: currentModelId || config.modelId,
                        historyLength: chatHistory.length,
                    };

                // Model Management
                case LLM_MESSAGE_TYPES.GET_AVAILABLE_MODELS:
                    return await getAllAvailableModels();

                case LLM_MESSAGE_TYPES.ADD_CUSTOM_MODEL:
                    return await addCustomModel(message.modelRecord);

                case LLM_MESSAGE_TYPES.REMOVE_CUSTOM_MODEL:
                    await removeCustomModel(message.modelId);
                    return { success: true };

                case LLM_MESSAGE_TYPES.GET_SELECTED_MODEL:
                    return { modelId: await getSelectedModel() };

                case LLM_MESSAGE_TYPES.SELECT_MODEL:
                    await setSelectedModel(message.modelId);
                    return { success: true };

                case LLM_MESSAGE_TYPES.RELOAD_MODEL:
                    // Unload current and load new model
                    await unloadEngine();
                    await initEngine(message.modelId);
                    return { success: true, modelId: currentModelId };

                default:
                    return { error: `Unknown message type: ${message.type}` };
            }
        } catch (error) {
            console.error('[LLM Handler] Error:', error);
            return { error: error.message };
        }
    }

    return {
        handleMessage,
        getEngine: () => engine,
        getStatus: () => status,
        getCurrentModelId: () => currentModelId,
    };
}

export default createLLMHandler;
