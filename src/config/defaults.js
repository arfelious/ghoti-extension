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
    autoScanOnStartup: false,             // Automatically scan all open tabs when the browser starts
    preloadLLM: true,                     // Pre-load LLM model on startup to reduce initial scan delay
    unloadAfterInactivity: false,         // Auto-unload model after 30 minutes of inactivity
    blockUntilScanned: false,             // Block page until scan completes
    blockOnSuspicious: false,             // Block inputs if page is suspicious
    cacheScannedPages: false,             // Cache results for previously scanned pages
    sendPageContent: true,                // Send page content from extension instead of server fetching
    sendDomainOnlyUntilPhishing: true,    // Only send the domain for initial detection until local analysis flags it
    uploadLocalResults: false,            // Upload local analysis results to server
    isActive: true,                       // Extension active state

    // Testing/Development
    compareMode: false,                   // Run both local and remote for comparison

    // Logging
    maxLogs: 100,                             // Maximum number of log entries to keep in buffer

    // Localization
    language: "tr",

    // UI state
    expandedLeft: false,
    expandedBottom: false
};

export default DEFAULTS;
