/**
 * Default settings for the Ghoti extension
 * Shared between popup.js, settings.js, background.js, and inject.js
 */

export const DEFAULTS = {
    // Thresholds
    localThreshold: 30,        // Local LLM suspicion threshold for escalation
    globalThreshold: 60,       // Server-side threshold for phishing classification

    // Display options
    showConfidenceWhenSuspicious: false,  // Show confidence % when site is suspicious
    alwaysShowRating: false,              // Always show toolbar with rating

    // Behavior options
    autoScanOnStartup: false,             // Automatically scan all open tabs when the browser starts TODO: true on PROD
    preloadLLM: true,                     // Pre-load LLM model on startup to reduce initial scan delay
    unloadAfterInactivity: false,         // Auto-unload model after 30 minutes of inactivity
    blockUntilScanned: false,             // Block page until scan completes
    blockOnSuspicious: false,             // Block inputs if page is suspicious
    cacheScannedPages: true,             // Cache results for previously scanned pages
    sendPageContent: true,                // Send page content from extension instead of server fetching
    sendDomainOnlyUntilPhishing: true,    // Only send the domain for initial detection until local analysis flags it
    showEarlyWarningOnLocalEscalation: false, // Show warning toolbar while waiting for remote confirmation
    uploadLocalResults: false,            // Upload local analysis results to server
    scanOnSpaNavigation: false,           // Trigger scans on in-page URL changes (SPAs) 
    isActive: true,                       // Extension active state

    // Fallback
    useCustomFallbackThreshold: false,    // Use a separate threshold when server is unavailable
    localFallbackThreshold: 60,           // Custom threshold for local-fallback decisions (0-100)

    // Ollama
    ollamaEnabled: false,                 // Use Ollama instead of Web-LLM
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: '',

    // OpenAI Compatible
    openaiEnabled: false,                 // Use OpenAI compatible API instead of Web-LLM
    openaiEndpoint: '',                   // e.g. https://api.openai.com/v1 or custom
    openaiModel: '',
    openaiApiKeyEnabled: false,           // Use API key for authentication

    // Testing/Development
    compareMode: false,                   // Run both local and remote for comparison

    // Whitelist exemptions — subdomains that should be analyzed even if their parent is whitelisted
    whitelistExemptions: [
        'sites.google.com',       // Google Sites — anyone can publish pages
        'forms.google.com',       // Google Forms — used for credential harvesting
        'groups.google.com',      // Google Groups — public posts with arbitrary links
        'docs.google.com',        // Google Docs/Sheets — phishing documents shared publicly
        'drive.google.com',       // Google Drive — shared phishing files/pages
    ],

    // Logging
    maxLogs: 100,                             // Maximum number of log entries to keep in buffer

    // Localization
    language: "tr",

    // UI state
    expandedLeft: false,
    expandedBottom: false
};

export default DEFAULTS;
