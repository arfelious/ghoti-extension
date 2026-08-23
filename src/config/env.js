/**
 * Environment configuration for Ghoti Extension
 * 
 * IS_PROD: When true, uses production URLs (ghoti.com.tr) and requires authentication.
 * AUTH_TEST: When true, requires auth even in dev mode (for local auth debugging).
 * USE_LOCAL_WEB_LLM: When true, uses ./src/web-llm; when false, uses node_modules (@mlc-ai/web-llm).
 * 
 * These are injected at build time via webpack DefinePlugin.
 * To change, edit this file and rebuild.
 */

// Set to true for production builds
const IS_PROD = true;

// Set to true to test auth flow on localhost
const AUTH_TEST = false;

// Set to true to use ./src/web-llm, false to use node_modules (@mlc-ai/web-llm)
const USE_LOCAL_WEB_LLM = false;

const SERVER_BASE = IS_PROD
    ? 'https://ghoti.com.tr'
    : 'http://localhost:9701';

const WS_BASE = IS_PROD
    ? 'wss://ghoti.com.tr'
    : 'ws://localhost:9701';

// Whether auth is required (production OR auth testing)
const REQUIRE_AUTH = IS_PROD || AUTH_TEST;

export { IS_PROD, AUTH_TEST, SERVER_BASE, WS_BASE, REQUIRE_AUTH, USE_LOCAL_WEB_LLM };
export default { IS_PROD, AUTH_TEST, SERVER_BASE, WS_BASE, REQUIRE_AUTH, USE_LOCAL_WEB_LLM };

