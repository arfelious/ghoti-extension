import { extractPageData, initParsers } from 'shared/extractor.js';

/**
 * Serialize the DOM with sanitized inputs (empty all input values for privacy)
 * This captures the page as the user sees it, not what the server would fetch
 */
function serializeDomSanitized() {
  // Clone the document to avoid modifying the live page
  const clone = document.documentElement.cloneNode(true);

  // Sanitize all input values
  clone.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.tagName === 'INPUT') {
      const type = el.type?.toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        // Keep checked state but remove any value
        el.removeAttribute('value');
      } else if (type === 'hidden') {
        // Keep hidden fields but sanitize common sensitive ones
        const name = (el.name || '').toLowerCase();
        if (name.includes('token') || name.includes('csrf') || name.includes('session') ||
          name.includes('password') || name.includes('secret') || name.includes('key')) {
          el.value = '[REDACTED]';
        }
      } else {
        // Clear text, password, email, etc.
        el.value = '';
        el.removeAttribute('value');
      }
    } else if (el.tagName === 'TEXTAREA') {
      el.textContent = '';
      el.value = '';
    } else if (el.tagName === 'SELECT') {
      // Keep the structure but note it was cleared
      el.selectedIndex = -1;
    }
  });

  // Remove any inline event handlers that might contain sensitive data
  clone.querySelectorAll('[onclick], [onsubmit], [onload], [onerror]').forEach(el => {
    // Keep the attribute names but redact complex handlers
    ['onclick', 'onsubmit', 'onload', 'onerror'].forEach(attr => {
      if (el.hasAttribute(attr)) {
        const val = el.getAttribute(attr);
        if (val && val.length > 100) {
          el.setAttribute(attr, '[HANDLER_REDACTED]');
        }
      }
    });
  });

  // Remove script contents but keep script tags (for structure analysis)
  clone.querySelectorAll('script').forEach(script => {
    if (script.textContent && script.textContent.length > 500) {
      // Keep first 500 chars for analysis, redact rest
      script.textContent = script.textContent.slice(0, 500) + '\n// [TRUNCATED]';
    }
  });

  // Remove potentially sensitive meta tags
  clone.querySelectorAll('meta[name*="token"], meta[name*="csrf"]').forEach(el => {
    el.setAttribute('content', '[REDACTED]');
  });

  return clone.outerHTML;
}

function isVisible(el) {
  const style = getComputedStyle(el);
  return el.offsetParent !== null && style.visibility !== 'hidden' && style.display !== 'none';
}

const toolbarHeight = 60;
function injectToolbar(probability) {
  // Push down any existing fixed elements at the top
  document.querySelectorAll('*').forEach(el => {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' && parseInt(style.top || '0') < toolbarHeight) {
      el.style.top = `${parseInt(style.top || '0') + toolbarHeight}px`;
    }
  });

  const toolbar = document.createElement('div');
  toolbar.id = 'ghoti-toolbar';
  toolbar.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    width: 100%;
    height: ${toolbarHeight}px;
    background-color: #c0392b;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
    font-weight: 600;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    box-sizing: border-box;
  `;

  // Show different message based on whether probability is provided
  if (probability === null) {
    toolbar.textContent = '🚨 UYARI: Bu site tehlikeli olabilir! Kişisel bilgilerinizi girmeyin.';
  } else if (probability === undefined) {
    toolbar.textContent = 'Analiz ediliyor...';  // "Analysing..."
  } else {
    toolbar.textContent = `🚨 UYARI: Oltalama riski %${probability} - Kişisel bilgilerinizi girmeyin!`;
  }

  // Add spacer to push page content down
  const spacer = document.createElement('div');
  spacer.id = 'ghoti-spacer';
  spacer.style.cssText = `
    height: ${toolbarHeight}px;
    width: 100%;
    flex-shrink: 0;
  `;

  // Also adjust body margin/padding to account for fixed toolbar
  const originalBodyMarginTop = document.body.style.marginTop;
  const originalBodyPaddingTop = document.body.style.paddingTop;
  document.body.style.marginTop = `${toolbarHeight}px`;

  // Store original values for potential removal
  toolbar.dataset.originalBodyMarginTop = originalBodyMarginTop || '';
  toolbar.dataset.originalBodyPaddingTop = originalBodyPaddingTop || '';

  // Insert toolbar at the very beginning of body
  document.body.insertBefore(toolbar, document.body.firstChild);
}

async function analyzePage() {
  const settings = await chrome.storage.sync.get({
    globalThreshold: 60,
    showConfidenceWhenSuspicious: false,  // Show confidence % on toolbar when suspicious
    alwaysShowRating: false,  // Always show toolbar even for safe sites
    sendPageContent: true,  // Send page content instead of server fetching (better for personalized/geo-blocked content)
    isActive: true,
    language: "tr"
  });
  if (!settings.isActive) {
    console.log('[Ghoti] Extension is inactive, skipping analysis.');
    return;
  }
  const THRESHOLD = settings.globalThreshold;

  // Initialize parsers and extract page data
  await initParsers();
  const html = document.documentElement.outerHTML;
  const extractedData = await extractPageData(document, html, window.location.href, {
    extractComments: true,
    extractValidations: true,
    extractLegitimacy: true,
    extractRisk: true,
    maxTextLength: 2000
  });

  console.log('[Ghoti] Extracted data:', extractedData);

  // Prepare message data
  const messageData = {
    url: window.location.href,
    domain: new URL(window.location).host,
    extractedData,  // Rich structured data instead of raw HTML
    automatedMode: navigator.webdriver === true  // Detect if running under Puppeteer/automation
  };

  // If sendPageContent is enabled, include sanitized DOM
  if (settings.sendPageContent) {
    console.log('[Ghoti] Serializing page content for analysis...');
    messageData.pageContent = serializeDomSanitized();
    messageData.sendPageContent = true;
    console.log('[Ghoti] Page content size:', (messageData.pageContent.length / 1024).toFixed(1), 'KB');
  }

  if (messageData.automatedMode) {
    console.log('[Ghoti] Running in automated mode (Puppeteer) - compareMode enabled');
  }

  chrome.runtime.sendMessage({
    type: 'ANALYZE_PAGE',
    data: messageData
  }, response => {
    if (chrome.runtime.lastError) {
      console.error('[Ghoti] Communication error:', chrome.runtime.lastError);
      return;
    }

    if (response.error) {
      console.error('[Ghoti] Analysis error:', response.error);
      return;
    }

    if (response.success) {
      console.log('[Ghoti] WHOIS result:', response.whoisResult);
      console.log('[Ghoti] Query result:', response.queryResult);

      // Expose results for Puppeteer/automated testing
      // Using data attribute instead of script injection (CSP-safe)
      const resultData = {
        success: true,
        whoisResult: response.whoisResult,
        queryResult: response.queryResult,
        localResult: response.localResult || null,  // Present in compareMode
        extractedData: extractedData,
        timestamp: Date.now()
      };
      document.documentElement.dataset.ghotiResult = JSON.stringify(resultData);
      console.log('[Ghoti] Results exposed to document.documentElement.dataset.ghotiResult');
      if (response.localResult) {
        console.log('[Ghoti] Local result:', response.localResult);
      }

      const queryResult = response.queryResult;
      const rating = queryResult.finalRating || 0;
      const isSuspicious = rating > THRESHOLD;

      console.log('[Ghoti] Final rating:', rating, '| Threshold:', THRESHOLD, '| Suspicious:', isSuspicious);

      if (settings.alwaysShowRating) {
        // Always show toolbar with rating
        console.log('[Ghoti] Showing toolbar with rating (alwaysShowRating=true)');
        injectToolbar(rating);
      } else if (isSuspicious) {
        // Site is suspicious - always show toolbar
        if (settings.showConfidenceWhenSuspicious) {
          // Show with confidence percentage
          console.log('[Ghoti] Showing toolbar with rating (suspicious + showConfidence=true)');
          injectToolbar(rating);
        } else {
          // Show without confidence percentage (just warning)
          console.log('[Ghoti] Showing toolbar without rating (suspicious + showConfidence=false)');
          injectToolbar(null);  // null = show warning but not the percentage
        }
      } else {
        console.log('[Ghoti] Site is safe, not showing toolbar');
      }
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'RESCAN_PAGE') {
    console.log('[Ghoti] Rescanning page...');
    // Remove existing toolbar
    const existingToolbar = document.getElementById('ghoti-toolbar');
    if (existingToolbar) existingToolbar.remove();
    const existingSpacer = document.getElementById('ghoti-spacer');
    if (existingSpacer) existingSpacer.remove();

    // Reanalyze
    analyzePage();
    sendResponse({ success: true });
  }
});

/**
 * Wait for the DOM to settle (no mutations for a period)
 * This handles SPAs that render content after page load
 */
function waitForDomSettle(timeout = 5000, settleTime = 1800) {
  return new Promise((resolve) => {
    let timeoutId;
    let settleTimeoutId;
    let resolved = false;

    const done = (reason) => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      clearTimeout(settleTimeoutId);
      console.log(`[Ghoti] DOM settled: ${reason}`);
      resolve();
    };

    // Maximum wait time
    timeoutId = setTimeout(() => done('max timeout reached'), timeout);

    // Start settle timer
    const resetSettleTimer = () => {
      clearTimeout(settleTimeoutId);
      settleTimeoutId = setTimeout(() => done('no mutations for ' + settleTime + 'ms'), settleTime);
    };

    // Watch for DOM changes
    const observer = new MutationObserver((mutations) => {
      // Ignore our own toolbar injection
      const dominated = mutations.some(m =>
        m.target.id === 'ghoti-toolbar' ||
        m.target.id === 'ghoti-spacer' ||
        (m.addedNodes && Array.from(m.addedNodes).some(n => n.id === 'ghoti-toolbar' || n.id === 'ghoti-spacer'))
      );
      if (!dominated) {
        resetSettleTimer();
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false,  // Ignore attribute changes for performance
      characterData: false
    });

    // Start the settle timer
    resetSettleTimer();
  });
}

// Wait for page to fully load before analyzing
async function startAnalysis() {
  console.log('[Ghoti] Waiting for page to load...');

  // First, wait for basic page load
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve, { once: true });
      }
    });
  }

  console.log('[Ghoti] Page load event fired, waiting for DOM to settle...');

  // Then wait for DOM to settle (handles SPA rendering)
  await waitForDomSettle(5000, 1800);

  console.log('[Ghoti] Starting analysis...');
  analyzePage();
}

startAnalysis();

function ensureToolbarVisible() {
  const toolbar = document.getElementById('ghoti-toolbar');
  if (!toolbar || !isVisible(toolbar)) {
    console.warn('[Ghoti] Toolbar is not visible, reinjecting...');
    if (toolbar) toolbar.remove();
    injectToolbar();
  }
}