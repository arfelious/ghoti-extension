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

    // Periodic engine reload to reclaim accumulated WebGPU VRAM fragments.
    // After this many inferences the engine is fully unloaded and reloaded.
    const RELOAD_AFTER_N_INFERENCES = 50;
    let inferenceCount = 0;

    // Request queue for thread-safe sequential processing
    let requestQueue = [];
    let isProcessing = false;
    let activeOllamaAbortController = null;
    let lastErrorSource = null;
    let lastErrorCode = null;
    let lastErrorMessage = null;

    function clearLastError() {
        lastErrorSource = null;
        lastErrorCode = null;
        lastErrorMessage = null;
    }

    function setLastError(source, message, code = null) {
        lastErrorSource = source || null;
        lastErrorCode = code ?? null;
        lastErrorMessage = message || null;
    }

    async function buildOllamaHttpError(response) {
        let detail = '';
        try {
            detail = (await response.text()).trim();
        } catch (_) {
            // Ignore body read errors for error shaping
        }

        const preview = detail ? `: ${detail.slice(0, 240)}` : '';
        const err = new Error(`Ollama API error (${response.status})${preview}`);
        err.source = 'ollama';
        err.code = response.status;
        return err;
    }

    function getNormalizedOllamaEndpoint(settings) {
        const rawEndpoint = (settings.ollamaEndpoint || '').trim() || DEFAULTS.ollamaEndpoint;
        return rawEndpoint.replace(/\/+$/, '');
    }

    function getValidatedOllamaModel(settings) {
        const model = (settings.ollamaModel || '').trim();
        if (!model) {
            const err = new Error('Ollama enabled but no model selected. Please choose a model in settings.');
            err.source = 'ollama';
            throw err;
        }
        return model;
    }

    function sendStreamMessage(sender, payload) {
        if (sender?.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, payload).catch(() => { });
            return;
        }
        runtime.sendMessage(payload).catch(() => { });
    }

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
        const settings = await chrome.storage.sync.get(DEFAULTS);
        if (settings.ollamaEnabled) {
            const model = getValidatedOllamaModel(settings);
            status = LLM_STATUS.READY;
            currentModelId = model;
            clearLastError();
            return;
        }
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
            clearLastError();
            resetInactivityTimer(); // Start/Reset timer when engine is ready

            runtime.sendMessage({
                type: LLM_MESSAGE_TYPES.INIT_COMPLETE,
                modelId: currentModelId,
            }).catch(() => { });

        } catch (error) {
            status = LLM_STATUS.ERROR;
            currentModelId = null;
            setLastError('web-llm', error?.message || 'Web-LLM init failed');
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
        clearLastError();
        chatHistory = [];
        loadProgress = 0;
        inferenceCount = 0;

        if (inactivityTimer) {
            clearTimeout(inactivityTimer);
            inactivityTimer = null;
        }
    }

    /**
     * Reload the engine to flush accumulated WebGPU VRAM fragments.
     * Called automatically after every RELOAD_AFTER_N_INFERENCES inferences.
     */
    async function maybeReloadForVramReclaim() {
        if (inferenceCount < RELOAD_AFTER_N_INFERENCES) return;
        const modelToReload = currentModelId;
        console.log(`[LLM Handler] Inference count reached ${RELOAD_AFTER_N_INFERENCES}. Reloading engine to reclaim VRAM...`);
        await unloadEngine();
        await initEngine(modelToReload);
        console.log('[LLM Handler] Engine reloaded. VRAM reclaimed.');
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
            const { type, payload, resolve, reject } = requestQueue.shift();

            try {
                console.log(`[LLM Handler] Processing queued request: ${type}`);
                let result;

                switch (type) {
                    case 'INIT':
                        await initEngine(payload.modelId);
                        result = { success: true, status };
                        break;
                    case 'CHAT':
                        result = await executeChat(payload.message, payload.options);
                        break;
                    case 'CHAT_STREAM':
                        result = await executeChatStream(payload.message, payload.options, payload.streamId, payload.sender);
                        break;
                    case 'RESET':
                        if (engine) await engine.resetChat();
                        chatHistory = [];
                        result = { success: true };
                        break;
                    case 'RELOAD':
                        await unloadEngine();
                        await initEngine(payload.modelId);
                        result = { success: true, modelId: currentModelId };
                        break;
                    case 'UNLOAD':
                        await unloadEngine();
                        result = { success: true };
                        break;
                    case 'CUSTOM_MODEL_ADD':
                        result = await addCustomModel(payload.modelRecord);
                        break;
                    case 'CUSTOM_MODEL_REMOVE':
                        await removeCustomModel(payload.modelId);
                        result = { success: true };
                        break;
                    default:
                        throw new Error(`Unknown queued request type: ${type}`);
                }
                resolve(result);
            } catch (error) {
                console.error(`[LLM Handler] Error processing ${type}:`, error);
                reject(error);
            }
        }

        isProcessing = false;
    }

    /**
     * Enqueue a request for sequential processing
     * @param {string} type - Request type
     * @param {Object} payload - Data for the request
     * @returns {Promise<any>}
     */
    function enqueue(type, payload = {}) {
        return new Promise((resolve, reject) => {
            requestQueue.push({ type, payload, resolve, reject });
            processQueue();
        });
    }

    /**
     * Execute chat completion (internal, called by queue processor)
     */
    async function executeChat(message, options = {}) {
        const settings = await chrome.storage.sync.get(DEFAULTS);

        if (settings.ollamaEnabled) {
            status = LLM_STATUS.GENERATING;
            const endpoint = getNormalizedOllamaEndpoint(settings);
            const model = getValidatedOllamaModel(settings);
            const abortController = new AbortController();
            activeOllamaAbortController = abortController;
            try {
                const response = await fetch(`${endpoint}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: abortController.signal,
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: message }],
                        stream: false,
                        options: {
                            temperature: options.temperature ?? 0.25,
                            num_predict: options.max_tokens ?? 2048,
                            stop: options.stop || []
                        },
                        format: options.response_format?.type === 'json_object' ? 'json' : undefined
                    })
                });

                if (!response.ok) throw await buildOllamaHttpError(response);
                const data = await response.json();

                status = LLM_STATUS.READY;
                clearLastError();
                return { content: data.message?.content || '' };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    status = LLM_STATUS.READY;
                    clearLastError();
                    throw new Error('Generation aborted');
                }
                setLastError('ollama', error?.message || 'Ollama request failed', error?.code ?? null);
                status = LLM_STATUS.ERROR;
                throw error;
            } finally {
                if (activeOllamaAbortController === abortController) {
                    activeOllamaAbortController = null;
                }
            }
        }

        if (settings.openaiEnabled) {
            status = LLM_STATUS.GENERATING;
            const endpoint = (settings.openaiEndpoint || '').trim().replace(/\/+$/, '');
            const model = (settings.openaiModel || '').trim();
            const localData = await chrome.storage.local.get('openaiApiKey');
            const apiKey = settings.openaiApiKeyEnabled ? (localData.openaiApiKey || '') : '';

            const abortController = new AbortController();
            activeOllamaAbortController = abortController;

            try {
                const response = await fetch(`${endpoint}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
                    },
                    signal: abortController.signal,
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: message }],
                        stream: false,
                        temperature: options.temperature ?? 0.25,
                        max_tokens: options.max_tokens ?? 2048,
                        stop: options.stop || [],
                        response_format: options.response_format
                    })
                });

                if (!response.ok) {
                    const detail = await response.text();
                    const err = new Error(`OpenAI API error (${response.status}): ${detail.slice(0, 200)}`);
                    err.source = 'openai';
                    throw err;
                }
                const data = await response.json();

                status = LLM_STATUS.READY;
                clearLastError();
                return { content: data.choices[0]?.message?.content || '' };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    status = LLM_STATUS.READY;
                    throw new Error('Generation aborted');
                }
                setLastError('openai', error?.message || 'OpenAI request failed');
                status = LLM_STATUS.ERROR;
                throw error;
            } finally {
                if (activeOllamaAbortController === abortController) {
                    activeOllamaAbortController = null;
                }
            }
        }

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

            inferenceCount++;
            status = LLM_STATUS.READY;
            clearLastError();
            resetInactivityTimer(); // Reset timer after each chat execution
            await maybeReloadForVramReclaim();
            return { content: assistantMessage };
        } catch (error) {
            status = LLM_STATUS.ERROR;
            setLastError('web-llm', error?.message || 'Web-LLM request failed');
            // Reset on error to recover
            chatHistory = [];
            if (engine) {
                await engine.resetChat();
            }
            throw error;
        }
    }

    /**
     * Execute streaming chat completion (internal, called by queue processor)
     */
    async function executeChatStream(message, options = {}, streamId, sender) {
        const settings = await chrome.storage.sync.get(DEFAULTS);

        if (settings.ollamaEnabled) {
            status = LLM_STATUS.GENERATING;
            const endpoint = getNormalizedOllamaEndpoint(settings);
            const model = getValidatedOllamaModel(settings);
            const abortController = new AbortController();
            activeOllamaAbortController = abortController;
            try {
                const response = await fetch(`${endpoint}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: abortController.signal,
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: message }],
                        stream: true,
                        options: {
                            temperature: options.temperature ?? 0.25,
                            num_predict: options.max_tokens ?? 2048,
                            stop: options.stop || []
                        },
                        format: options.response_format?.type === 'json_object' ? 'json' : undefined
                    })
                });

                if (!response.ok) throw await buildOllamaHttpError(response);
                if (!response.body) throw new Error('Ollama API returned empty stream body');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullContent = '';
                let chunkBuffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunkBuffer += decoder.decode(value, { stream: true });
                    const lines = chunkBuffer.split('\n');
                    chunkBuffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        try {
                            const data = JSON.parse(trimmedLine);
                            const delta = data.message?.content || '';

                            if (delta) {
                                fullContent += delta;
                                sendStreamMessage(sender, {
                                    type: LLM_MESSAGE_TYPES.CHAT_STREAM_CHUNK,
                                    streamId,
                                    content: delta,
                                });
                            }

                            if (data.done) {
                                break;
                            }
                        } catch (e) {
                            console.warn('[LLM Handler] Failed to parse Ollama chunk:', trimmedLine);
                        }
                    }
                }

                chunkBuffer += decoder.decode();
                const trailing = chunkBuffer.trim();
                if (trailing) {
                    try {
                        const data = JSON.parse(trailing);
                        const delta = data.message?.content || '';
                        if (delta) {
                            fullContent += delta;
                            sendStreamMessage(sender, {
                                type: LLM_MESSAGE_TYPES.CHAT_STREAM_CHUNK,
                                streamId,
                                content: delta,
                            });
                        }
                    } catch (e) {
                        console.warn('[LLM Handler] Failed to parse trailing Ollama chunk:', trailing);
                    }
                }

                status = LLM_STATUS.READY;
                clearLastError();
                // Send end signal
                sendStreamMessage(sender, { type: LLM_MESSAGE_TYPES.CHAT_STREAM_END, streamId });
                return { success: true };
            } catch (error) {
                if (error?.name === 'AbortError' || error?.message === 'Generation aborted') {
                    status = LLM_STATUS.READY;
                    clearLastError();
                    sendStreamMessage(sender, {
                        type: LLM_MESSAGE_TYPES.ERROR,
                        streamId,
                        error: 'Generation aborted',
                    });
                    return { success: false, aborted: true };
                }

                setLastError('ollama', error?.message || 'Ollama streaming failed', error?.code ?? null);
                status = LLM_STATUS.ERROR;
                sendStreamMessage(sender, {
                    type: LLM_MESSAGE_TYPES.ERROR,
                    streamId,
                    error: error?.message || 'Ollama streaming failed',
                });
                throw error;
            } finally {
                if (activeOllamaAbortController === abortController) {
                    activeOllamaAbortController = null;
                }
            }
        }

        if (settings.openaiEnabled) {
            status = LLM_STATUS.GENERATING;
            const endpoint = (settings.openaiEndpoint || '').trim().replace(/\/+$/, '');
            const model = (settings.openaiModel || '').trim();
            const localData = await chrome.storage.local.get('openaiApiKey');
            const apiKey = settings.openaiApiKeyEnabled ? (localData.openaiApiKey || '') : '';

            const abortController = new AbortController();
            activeOllamaAbortController = abortController;

            try {
                const response = await fetch(`${endpoint}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
                    },
                    signal: abortController.signal,
                    body: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: message }],
                        stream: true,
                        temperature: options.temperature ?? 0.25,
                        max_tokens: options.max_tokens ?? 2048,
                        stop: options.stop || [],
                        response_format: options.response_format
                    })
                });

                if (!response.ok) {
                    const detail = await response.text();
                    const err = new Error(`OpenAI API error (${response.status}): ${detail.slice(0, 200)}`);
                    err.source = 'openai';
                    throw err;
                }
                if (!response.body) throw new Error('OpenAI API returned empty stream body');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullContent = '';
                let chunkBuffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    chunkBuffer += decoder.decode(value, { stream: true });
                    const lines = chunkBuffer.split('\n');
                    chunkBuffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

                        const jsonStr = trimmedLine.slice(6);
                        if (jsonStr === '[DONE]') break;

                        try {
                            const data = JSON.parse(jsonStr);
                            const delta = data.choices[0]?.delta?.content || '';

                            if (delta) {
                                fullContent += delta;
                                sendStreamMessage(sender, {
                                    type: LLM_MESSAGE_TYPES.CHAT_STREAM_CHUNK,
                                    streamId,
                                    content: delta,
                                });
                            }
                        } catch (e) {
                            console.warn('[LLM Handler] Failed to parse OpenAI chunk:', jsonStr);
                        }
                    }
                }

                status = LLM_STATUS.READY;
                clearLastError();
                sendStreamMessage(sender, { type: LLM_MESSAGE_TYPES.CHAT_STREAM_END, streamId });
                return { success: true };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    status = LLM_STATUS.READY;
                    sendStreamMessage(sender, { type: LLM_MESSAGE_TYPES.ERROR, streamId, error: 'Generation aborted' });
                    return { success: false, aborted: true };
                }

                setLastError('openai', error?.message || 'OpenAI streaming failed');
                status = LLM_STATUS.ERROR;
                sendStreamMessage(sender, { type: LLM_MESSAGE_TYPES.ERROR, streamId, error: error?.message || 'OpenAI streaming failed' });
                throw error;
            } finally {
                if (activeOllamaAbortController === abortController) {
                    activeOllamaAbortController = null;
                }
            }
        }

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

            inferenceCount++;
            status = LLM_STATUS.READY;
            clearLastError();
            resetInactivityTimer();
            await maybeReloadForVramReclaim();
            return { success: true };
        } catch (error) {
            status = LLM_STATUS.ERROR;
            setLastError('web-llm', error?.message || 'Web-LLM streaming failed');
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
                    return await enqueue('INIT', { modelId: message.modelId });

                case LLM_MESSAGE_TYPES.CHAT:
                    return await enqueue('CHAT', { message: message.message, options: message.options });

                case LLM_MESSAGE_TYPES.CHAT_STREAM:
                    // Enqueue but don't strictly await the result for the caller, 
                    // although the background process WILL be sequential.
                    enqueue('CHAT_STREAM', { message: message.message, options: message.options, streamId: message.streamId, sender });
                    return { success: true, streaming: true };

                case LLM_MESSAGE_TYPES.RESET:
                    return await enqueue('RESET');

                case LLM_MESSAGE_TYPES.ABORT:
                    // ABORT is one of the few messages that should interrupt immediately if possible
                    if (activeOllamaAbortController) {
                        activeOllamaAbortController.abort();
                        activeOllamaAbortController = null;
                    }
                    if (engine) {
                        await engine.interruptGenerate();
                    }
                    status = LLM_STATUS.READY;
                    clearLastError();
                    return { success: true };

                case LLM_MESSAGE_TYPES.GET_STATUS:
                    const settings = await chrome.storage.sync.get(DEFAULTS);
                    return {
                        status,
                        loadProgress: (settings.ollamaEnabled || settings.openaiEnabled) ? 1 : loadProgress,
                        modelId: settings.ollamaEnabled ? (settings.ollamaModel || 'Ollama') : (settings.openaiEnabled ? (settings.openaiModel || 'OpenAI') : (currentModelId || config.modelId)),
                        historyLength: chatHistory.length,
                        engine: settings.ollamaEnabled ? 'Ollama' : (settings.openaiEnabled ? 'OpenAI Uyumlu' : 'Web-LLM'),
                        errorSource: lastErrorSource,
                        errorCode: lastErrorCode,
                        errorMessage: lastErrorMessage,
                    };

                // Model Management
                case LLM_MESSAGE_TYPES.GET_AVAILABLE_MODELS:
                    return await getAllAvailableModels();

                case LLM_MESSAGE_TYPES.ADD_CUSTOM_MODEL:
                    return await enqueue('CUSTOM_MODEL_ADD', { modelRecord: message.modelRecord });

                case LLM_MESSAGE_TYPES.REMOVE_CUSTOM_MODEL:
                    return await enqueue('CUSTOM_MODEL_REMOVE', { modelId: message.modelId });

                case LLM_MESSAGE_TYPES.GET_SELECTED_MODEL:
                    return { modelId: await getSelectedModel() };

                case LLM_MESSAGE_TYPES.SELECT_MODEL:
                    await setSelectedModel(message.modelId);
                    return { success: true };

                case LLM_MESSAGE_TYPES.RELOAD_MODEL:
                    return await enqueue('RELOAD', { modelId: message.modelId });

                case LLM_MESSAGE_TYPES.UNLOAD_MODEL:
                    return await enqueue('UNLOAD');

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
