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
export const MODEL_VERSION = 'v0_2_84';

/**
 * Preset custom models that users can easily select and use
 * Verified against HuggingFace (mlc-ai) and MLC WASM binary libraries
 */
export const PRESET_MODELS = [
    // Qwen 2.5 Instruct
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 945,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1060,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 1630,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1889,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2505,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2.5-3B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2894,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 5107,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-7B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-7B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-7B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5900,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Qwen 2.5 Coder
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 945,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-Coder-0.5B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1060,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 1630,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1889,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2505,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-Coder-3B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2.5-3B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2894,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
        model_id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 5107,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC",
        model_id: "Qwen2.5-Coder-7B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-7B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5900,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Qwen 3
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC",
        model_id: "Qwen3-0.6B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 1403,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f32_1-MLC",
        model_id: "Qwen3-0.6B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1925,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC",
        model_id: "Qwen3-1.7B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2037,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f32_1-MLC",
        model_id: "Qwen3-1.7B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-1.7B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2635,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC",
        model_id: "Qwen3-4B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 3432,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-4B-q4f32_1-MLC",
        model_id: "Qwen3-4B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-4B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 4328,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC",
        model_id: "Qwen3-8B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-8B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 5696,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3-8B-q4f32_1-MLC",
        model_id: "Qwen3-8B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3-8B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 6853,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Qwen 3.5
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC",
        model_id: "Qwen3.5-0.8B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 1629,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-0.8B-q4f32_1-MLC",
        model_id: "Qwen3.5-0.8B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1894,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-2B-q4f16_1-MLC",
        model_id: "Qwen3.5-2B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-2B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2245,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-2B-q4f32_1-MLC",
        model_id: "Qwen3.5-2B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-2B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2592,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-4B-q4f16_1-MLC",
        model_id: "Qwen3.5-4B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-4B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 3868,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-4B-q4f32_1-MLC",
        model_id: "Qwen3.5-4B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-4B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 4680,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-9B-q4f16_1-MLC",
        model_id: "Qwen3.5-9B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-9B-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 6433,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Qwen3.5-9B-q4f32_1-MLC",
        model_id: "Qwen3.5-9B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-9B-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 7545,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Llama 3.2
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC",
        model_id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 879,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f32_1-MLC",
        model_id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-1B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 1129,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC",
        model_id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2264,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f32_1-MLC",
        model_id: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-3B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2952,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // Llama 3.1
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f16_1-MLC",
        model_id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 5001,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f32_1-MLC",
        model_id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 6101,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f16_1-MLC",
        model_id: "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 4598,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f32_1-MLC",
        model_id: "Llama-3.1-8B-Instruct-q4f32_1-MLC-1k",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5296,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // DeepSeek-R1 Distill
    {
        model: "https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
        model_id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 5107,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Qwen-7B-q4f32_1-MLC",
        model_id: "DeepSeek-R1-Distill-Qwen-7B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2-7B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5900,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC",
        model_id: "DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 5001,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/DeepSeek-R1-Distill-Llama-8B-q4f32_1-MLC",
        model_id: "DeepSeek-R1-Distill-Llama-8B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 6101,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Phi 3.5 & Phi 4
    {
        model: "https://huggingface.co/mlc-ai/Phi-3.5-mini-instruct-q4f16_1-MLC",
        model_id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Phi-3.5-mini-instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 3672,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Phi-3.5-mini-instruct-q4f32_1-MLC",
        model_id: "Phi-3.5-mini-instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Phi-3.5-mini-instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5483,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Phi-3.5-vision-instruct-q4f16_1-MLC",
        model_id: "Phi-3.5-vision-instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Phi-3.5-vision-instruct-q4f16_1_cs2k-webgpu.wasm",
        vram_required_MB: 3952,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Phi-3.5-vision-instruct-q4f32_1-MLC",
        model_id: "Phi-3.5-vision-instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Phi-3.5-vision-instruct-q4f32_1_cs2k-webgpu.wasm",
        vram_required_MB: 5880,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Phi-4-mini-instruct-q4f16_1-MLC",
        model_id: "Phi-4-mini-instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Phi-4-mini-instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 3438,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Phi-4-mini-instruct-q4f32_1-MLC",
        model_id: "Phi-4-mini-instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Phi-4-mini-instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 4221,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // SmolLM2
    {
        model: "https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC",
        model_id: "SmolLM2-135M-Instruct-q0f16-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-135M-Instruct-q0f16_cs1k-webgpu.wasm",
        vram_required_MB: 360,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/SmolLM2-135M-Instruct-q0f32-MLC",
        model_id: "SmolLM2-135M-Instruct-q0f32-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-135M-Instruct-q0f32_cs1k-webgpu.wasm",
        vram_required_MB: 719,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f16_1-MLC",
        model_id: "SmolLM2-360M-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-360M-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 376,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC",
        model_id: "SmolLM2-360M-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 580,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/SmolLM2-1.7B-Instruct-q4f16_1-MLC",
        model_id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-1.7B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 1774,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/SmolLM2-1.7B-Instruct-q4f32_1-MLC",
        model_id: "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/SmolLM2-1.7B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2692,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // Gemma & Gemma 3
    {
        model: "https://huggingface.co/mlc-ai/gemma3-1b-it-q4f16_1-MLC",
        model_id: "gemma3-1b-it-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma3-1b-it-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 711,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC",
        model_id: "gemma-2-2b-it-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 1895,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f32_1-MLC",
        model_id: "gemma-2-2b-it-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma-2-2b-it-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2509,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/gemma-2-9b-it-q4f16_1-MLC",
        model_id: "gemma-2-9b-it-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma-2-9b-it-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 6422,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/gemma-2-9b-it-q4f32_1-MLC",
        model_id: "gemma-2-9b-it-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/gemma-2-9b-it-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 8383,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Hermes 3
    {
        model: "https://huggingface.co/mlc-ai/Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
        model_id: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-3B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2264,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Hermes-3-Llama-3.2-3B-q4f32_1-MLC",
        model_id: "Hermes-3-Llama-3.2-3B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-3B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 2952,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
        model_id: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 4876,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Hermes-3-Llama-3.1-8B-q4f32_1-MLC",
        model_id: "Hermes-3-Llama-3.1-8B-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3_1-8B-Instruct-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5779,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    // Mistral & Ministral
    {
        model: "https://huggingface.co/mlc-ai/Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
        model_id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Mistral-7B-Instruct-v0.3-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 4573,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Mistral-7B-Instruct-v0.3-q4f32_1-MLC",
        model_id: "Mistral-7B-Instruct-v0.3-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Mistral-7B-Instruct-v0.3-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 5619,
        low_resource_required: false,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC",
        model_id: "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Ministral-3-3B-Instruct-2512-BF16-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 2864,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/Ministral-3-3B-Instruct-2512-BF16-q4f32_1-MLC",
        model_id: "Ministral-3-3B-Instruct-2512-BF16-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Ministral-3-3B-Instruct-2512-BF16-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 3532,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    // TinyLlama
    {
        model: "https://huggingface.co/mlc-ai/TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
        model_id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/TinyLlama-1.1B-Chat-v1.0-q4f16_1_cs1k-webgpu.wasm",
        vram_required_MB: 697,
        low_resource_required: true,
        overrides: { context_window_size: 4096 },
    },
    {
        model: "https://huggingface.co/mlc-ai/TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
        model_id: "TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC",
        model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/TinyLlama-1.1B-Chat-v1.0-q4f32_1_cs1k-webgpu.wasm",
        vram_required_MB: 840,
        low_resource_required: true,
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

    // Check if known in PRESET_MODELS
    const existing = PRESET_MODELS.find(m => m.model_id === modelId || m.model === huggingfaceUrl.replace(/\/$/, ''));
    if (existing) {
        return {
            ...existing,
            ...options,
        };
    }

    // Try to auto-detect model library based on common patterns
    let modelLib = options.model_lib;
    if (!modelLib) {
        // Common model family detection patterns
        const patterns = [
            { regex: /Qwen3\.5-(\d+\.?\d*)B/i, lib: (m) => `Qwen3.5-${m[1]}B` },
            { regex: /Qwen3-(\d+\.?\d*)B/i, lib: (m) => `Qwen3-${m[1]}B` },
            { regex: /Qwen2\.5-Coder-(\d+\.?\d*)B/i, lib: (m) => `Qwen2-${m[1]}B-Instruct` },
            { regex: /Qwen2\.5-(\d+\.?\d*)B/i, lib: (m) => `Qwen2-${m[1]}B-Instruct` },
            { regex: /Llama-3\.2-(\d+)B/i, lib: (m) => `Llama-3.2-${m[1]}B-Instruct` },
            { regex: /Llama-3\.1-(\d+)B/i, lib: (m) => `Llama-3_1-${m[1]}B-Instruct` },
            { regex: /DeepSeek-R1-Distill-Qwen-(\d+)B/i, lib: (m) => `Qwen2-${m[1]}B-Instruct` },
            { regex: /DeepSeek-R1-Distill-Llama-(\d+)B/i, lib: (m) => `Llama-3_1-${m[1]}B-Instruct` },
            { regex: /Phi-3\.5/i, lib: () => `Phi-3.5-mini-instruct` },
            { regex: /Phi-4/i, lib: () => `Phi-4-mini-instruct` },
            { regex: /SmolLM2-(\d+\.?\d*)(M|B)/i, lib: (m) => `SmolLM2-${m[1]}${m[2]}-Instruct` },
            { regex: /gemma-2-(\d+)b/i, lib: (m) => `gemma-2-${m[1]}b-it` },
            { regex: /gemma3-(\d+)b/i, lib: (m) => `gemma3-${m[1]}b-it` },
        ];

        // Extract quantization from model name
        const quantMatch = modelName.match(/(q\d+f\d+(?:_\d+)?)/i);
        const quant = quantMatch ? quantMatch[1] : 'q4f16_1';

        for (const { regex, lib } of patterns) {
            const match = modelName.match(regex);
            if (match) {
                const baseName = lib(match);
                modelLib = `${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/base/${baseName}-${quant}_cs1k-webgpu.wasm`;
                break;
            }
        }
    }

    if (!modelLib) {
        throw new Error(
            'Could not auto-detect model library. Please provide model_lib option manually.\n' +
            `Format: ${MODEL_LIB_URL_PREFIX}${MODEL_VERSION}/base/{MODEL_NAME}-webgpu.wasm`
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
