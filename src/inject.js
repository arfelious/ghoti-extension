import { extractPageData, initParsers } from 'shared/extractor.js';

// Internal state Symbols for robust deduplication (non-enumerable, hidden from page scripts)
// Using Symbol.for to ensure these are consistent across possible script re-injections
const ACTIVE_SCAN_ID = Symbol.for('GhotiActiveScanId');
const INJECTED_TOOLBAR_ID = Symbol.for('GhotiInjectedToolbarId');

let blockedInputs = [];

function blockAllInputs() {
  if (blockedInputs.length > 0) return; // Already blocked
  // Find all inputs, textareas, selects, and buttons that are NOT already disabled
  const elements = document.querySelectorAll('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])');
  elements.forEach(el => {
    el.dataset.ghotiBlocked = "true";
    el.disabled = true;
    blockedInputs.push(el);
  });
  console.log(`[Ghoti] Blocked ${blockedInputs.length} user input elements.`);
}

function unblockAllInputs() {
  if (blockedInputs.length === 0) return;
  let count = 0;
  blockedInputs.forEach(el => {
    if (el && el.dataset.ghotiBlocked === "true") {
      el.disabled = false;
      delete el.dataset.ghotiBlocked;
      count++;
    }
  });
  console.log(`[Ghoti] Unblocked ${count} user input elements.`);
  blockedInputs = [];
}

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
    ['onclick', 'onsubmit', 'onload', 'onerror'].forEach(attr => {
      if (el.hasAttribute(attr)) {
        const val = el.getAttribute(attr);
        // Move the potentially malicious part to a non-executable attribute
        el.setAttribute(`data-analyzed-${attr}`, val);
        // Remove the original so the phishing trigger is neutralized
        el.removeAttribute(attr);
      }
    });
  });

  // Remove script contents but keep script tags (for structure analysis)
  clone.querySelectorAll('script').forEach(script => {
    // 1. Change type so it doesn't execute in analysis 
    script.setAttribute('type', 'text/phish-analysis');
    // 2. Optional: If it's an external script, save the URL but disable it
    if (script.src) {
      script.setAttribute('data-original-src', script.src);
      script.removeAttribute('src');
    }
  });

  return clone.outerHTML;
}

function isVisible(el) {
  const style = getComputedStyle(el);
  return el.offsetParent !== null && style.visibility !== 'hidden' && style.display !== 'none';
}

const toolbarHeight = 60;

function removeToolbar() {
  const toolbar = document.getElementById('ghoti-toolbar');
  if (toolbar) {
    document.body.style.marginTop = toolbar.dataset.originalBodyMarginTop || '';
    toolbar.remove();
  }
  const spacer = document.getElementById('ghoti-spacer');
  if (spacer) spacer.remove();

  // Restore pushed fixed elements
  document.querySelectorAll('[data-ghoti-original-top]').forEach(el => {
    el.style.top = el.dataset.ghotiOriginalTop;
    delete el.dataset.ghotiOriginalTop;
  });
}

function injectToolbar(probability, scanId = null) {
  const existingToolbar = document.getElementById('ghoti-toolbar');

  // If already injected for this scan, just update the text
  if (scanId && window[INJECTED_TOOLBAR_ID] === scanId && existingToolbar) {
    console.log('[Ghoti] Toolbar for this scan already injected, updating text.');
    if (probability === 'known_phishing') {
      existingToolbar.textContent = '🚨 UYARI: Bu site daha önceki analizlerde oltalama (phishing) olarak tespit edilmiştir. İnceleme bitene kadar kişisel bilgilerinizi girmeyin!';
    } else if (probability === null) {
      existingToolbar.textContent = '🚨 UYARI: Bu site tehlikeli olabilir! Kişisel bilgilerinizi girmeyin.';
    } else if (probability === undefined) {
      existingToolbar.textContent = 'Analiz ediliyor...';
    } else {
      existingToolbar.textContent = `🚨 UYARI: Oltalama riski %${probability} - Kişisel bilgilerinizi girmeyin!`;
    }
    return;
  }

  // Remove existing before re-injecting
  removeToolbar();

  // Push down any existing fixed elements at the top
  document.querySelectorAll('*').forEach(el => {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' && parseInt(style.top || '0') < toolbarHeight && el.id !== 'ghoti-toolbar') {
      if (el.dataset.ghotiOriginalTop === undefined) {
        el.dataset.ghotiOriginalTop = style.top || '0px';
      }
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
  if (probability === 'known_phishing') {
    toolbar.textContent = '🚨 UYARI: Bu site daha önceki analizlerde oltalama (phishing) olarak tespit edilmiştir. İnceleme bitene kadar kişisel bilgilerinizi girmeyin!';
  } else if (probability === null) {
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

  // Store the scanId we just injected for
  if (scanId) {
    window[INJECTED_TOOLBAR_ID] = scanId;
  }
}

async function analyzePage(scanId = null) {
  // If scanId is provided, track it as the active scan for this window
  if (scanId) {
    window[ACTIVE_SCAN_ID] = scanId;
  }

  const settings = await chrome.storage.sync.get({
    globalThreshold: 60,
    showConfidenceWhenSuspicious: false,  // Show confidence % on toolbar when suspicious
    alwaysShowRating: false,  // Always show toolbar even for safe sites
    sendPageContent: true,  // Send page content instead of server fetching (better for personalized/geo-blocked content)
    blockUntilScanned: false,
    blockOnSuspicious: false,
    isActive: true,
    language: "tr"
  });
  if (!settings.isActive) {
    console.log('[Ghoti] Extension is inactive, skipping analysis.');
    return;
  }

  if (settings.blockUntilScanned) {
    blockAllInputs();
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
    data: { ...messageData, scanId }
  }, response => {
    if (chrome.runtime.lastError) {
      console.error('[Ghoti] Communication error:', chrome.runtime.lastError);
      return;
    }

    if (response.error) {
      console.error('[Ghoti] Analysis error:', response.error);
      if (settings.blockUntilScanned) {
        unblockAllInputs(); // Unblock on error so we don't trap the user
      }
      // Still save error state so popup can show it instead of being stuck
      document.documentElement.dataset.ghotiResult = JSON.stringify({
        success: false,
        error: response.error,
        timestamp: Date.now()
      });
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
      const localResult = response.localResult;

      // If remote analysis was skipped (site trusted locally), fall back to local result
      let rating = 0;
      if (queryResult && queryResult.finalRating !== undefined) {
        rating = queryResult.finalRating;
      } else if (localResult && localResult.finalRating !== undefined) {
        rating = localResult.finalRating;
        console.log('[Ghoti] No remote result, using local rating:', rating);
      }

      const isSuspicious = rating > THRESHOLD;
      console.log('[Ghoti] Final rating:', rating, '| Threshold:', THRESHOLD, '| Suspicious:', isSuspicious);

      // Input blocking logic based on verdict
      if (settings.blockUntilScanned) {
        if (!isSuspicious || !settings.blockOnSuspicious) {
          unblockAllInputs();
        } else {
          console.log('[Ghoti] Page is suspicious and blockOnSuspicious is true. Leaving inputs disabled.');
        }
      } else if (isSuspicious && settings.blockOnSuspicious) {
        // Edge case: blockUntilScanned was false, but blockOnSuspicious is true
        console.log('[Ghoti] Page is suspicious. Blocking inputs defensively.');
        blockAllInputs();
      }

      if (settings.alwaysShowRating) {
        // Always show toolbar with rating
        console.log('[Ghoti] Showing toolbar with rating (alwaysShowRating=true)');
        injectToolbar(rating, scanId);
      } else if (isSuspicious) {
        // Site is suspicious - always show toolbar
        if (settings.showConfidenceWhenSuspicious) {
          // Show with confidence percentage
          console.log('[Ghoti] Showing toolbar with rating (suspicious + showConfidence=true)');
          injectToolbar(rating, scanId);
        } else {
          // Show without confidence percentage (just warning)
          console.log('[Ghoti] Showing toolbar without rating (suspicious + showConfidence=false)');
          injectToolbar(null, scanId);  // null = show warning but not the percentage
        }
      } else {
        console.log('[Ghoti] Site is safe, not showing toolbar');
        // Un-inject warning if it was shown previously (e.g. from early WHOIS prediction)
        removeToolbar();
      }
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'RESCAN_PAGE' || request.type === 'START_SCAN') {
    const incomingScanId = request.scanId;

    // Deduplication check: If we already have this scan active or a toolbar for it, skip
    if (incomingScanId && (window[ACTIVE_SCAN_ID] === incomingScanId || window[INJECTED_TOOLBAR_ID] === incomingScanId)) {
      console.log(`[Ghoti] Scan ID ${incomingScanId} already active or injected, skipping duplicate trigger.`);
      sendResponse({ success: true, skipped: true });
      return;
    }

    // Remove existing toolbar if it belongs to a different scan or if no ID provided
    removeToolbar();

    // Analyze
    analyzePage(incomingScanId);
    sendResponse({ success: true });
  } else if (request.type === 'SHOW_EARLY_WARNING') {
    const incomingScanId = request.scanId;
    injectToolbar('known_phishing', incomingScanId);
    sendResponse({ success: true });
  } else if (request.type === 'GET_SCAN_RESULT') {
    // Return the result stored in the data attribute
    const resultJson = document.documentElement.dataset.ghotiResult;
    if (resultJson) {
      try {
        sendResponse({ success: true, result: JSON.parse(resultJson) });
      } catch (e) {
        sendResponse({ error: 'Failed to parse result' });
      }
    } else {
      sendResponse({ error: 'No scan result available' });
    }
  }
  return true; // Keep channel open for async sendResponse
});

window.addEventListener('ghoti-trigger-scan', (e) => {
  const incomingScanId = e.detail?.scanId || 'puppeteer-' + Date.now();
  if (window[ACTIVE_SCAN_ID] === incomingScanId || window[INJECTED_TOOLBAR_ID] === incomingScanId) {
    return;
  }
  removeToolbar();
  analyzePage(incomingScanId);
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

// Announce to the background script that we are injected and ready to receive messages
try {
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    url: window.location.href
  });
} catch (e) {
  // Extension context might be invalid if it was updated
}
