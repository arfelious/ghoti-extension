function isVisible(el) {
    const style = getComputedStyle(el);
    return el.offsetParent !== null && style.visibility !== 'hidden' && style.display !== 'none';
  }
  const toolbarHeight = 60;
  function injectToolbar(probability) {
    document.querySelectorAll('*').forEach(el => {
        const style = getComputedStyle(el);
        if (style.position === 'fixed' && parseInt(style.top || '0') < toolbarHeight) {
          el.style.top = `${toolbarHeight}px`;
        }
      });
  const toolbar = document.createElement('div');
  toolbar.id = 'ghoti-toolbar';
  toolbar.style.cssText = `
    position: relative;
    z-index: 999999;
    width: 100%;
    height: ${toolbarHeight}px;
    background-color: #111;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  toolbar.textContent = 'Phishing probability: ' + (probability ? `${probability}%` : 'Analysing...');
  const spacer = document.createElement('div');
  spacer.id = 'ghoti-spacer';
  spacer.style.height = `${toolbarHeight}px`;
  spacer.style.width = '100%';

  if (document.body.firstChild) {
    document.body.insertBefore(toolbar, document.body.firstChild);
    toolbar.insertAdjacentElement('afterend', spacer);
  } else {
    document.body.appendChild(toolbar);
    document.body.appendChild(spacer);
  }
}
const REMOTE_WHOIS = "http://localhost:9701/whois"
const LOCAL_QUERY = "http://localhost:9702/query"
const REMOTE_QUERY = "http://localhost:9701/query"
const THRESHOLD = 50; // should normally be taken from extension pop-up or saved config
fetch(REMOTE_WHOIS,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({version:"0.1.0",domain:new URL(window.location).host})}).then(r=>r.json()).then(console.log)
fetch(REMOTE_QUERY,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({version:"0.1.0",url:window.location.href,pageContent:document.body.outerHTML})}).then(r=>r.json()).then(data=>{
  console.log('[Ghoti] Query result:', data);
  if(data.finalRating && data.finalRating> THRESHOLD) {
    injectToolbar(data.finalRating);
  }
})
  function ensureToolbarVisible() {
    const toolbar = document.getElementById('ghoti-toolbar');
    if (!toolbar || !isVisible(toolbar)) {
      console.warn('[Ghoti] Toolbar is not visible, reinjecting...');
      if (toolbar) toolbar.remove();
      injectToolbar();
    }
  }