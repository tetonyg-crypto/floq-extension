/**
 * Floq v1.7.0 — Pending notes, single-action buttons, platform fixes.
 * All platforms: sidebar on RIGHT, never left. No double injection.
 * Gmail: collapsed by default, 280px. Instagram DMs + FB Marketplace conversations added.
 * LinkedIn: messaging only. Facebook: messages + marketplace/t only.
 */

import './content/styles.css';

type Platform = 'vinsolutions' | 'gmail' | 'facebook' | 'linkedin' | 'whatsapp' | 'instagram' | 'unknown';

function detectPlatform(): Platform {
  const url = window.location.href;
  if (url.includes('vinsolutions') || url.includes('coxautoinc')) return 'vinsolutions';
  if (url.includes('mail.google.com')) return 'gmail';
  if (url.includes('messenger.com')) return 'facebook';
  if (url.includes('facebook.com/messages')) return 'facebook';
  if (url.includes('facebook.com/marketplace/t/')) return 'facebook';
  if (url.includes('facebook.com')) return 'unknown';
  if (url.includes('linkedin.com/messaging')) return 'linkedin';
  if (url.includes('linkedin.com/in/')) return 'linkedin';
  if (url.includes('linkedin.com')) return 'unknown';
  if (url.includes('instagram.com/direct')) return 'instagram';
  if (url.includes('instagram.com')) return 'unknown';
  if (url.includes('web.whatsapp.com')) return 'whatsapp';
  return 'unknown';
}

const PLATFORM = detectPlatform();

export default defineContentScript({
  matches: [
    '*://*.vinsolutions.com/*',
    '*://vinsolutions.app.coxautoinc.com/*',
    '*://mail.google.com/*',
    '*://www.facebook.com/messages/*',
    '*://www.facebook.com/marketplace/t/*',
    '*://www.messenger.com/*',
    '*://www.linkedin.com/messaging/*',
    '*://www.linkedin.com/in/*',
    '*://www.instagram.com/direct/*',
    '*://www.instagram.com/direct/t/*',
    '*://web.whatsapp.com/*'
  ],
  allFrames: true,
  runAt: 'document_idle',

  async main() {
    console.log('[Floq] Content script loaded on', PLATFORM, window.location.href);
    if (PLATFORM === 'unknown') return;

    const isVinSolutions = PLATFORM === 'vinsolutions';
    const isGmail = PLATFORM === 'gmail';
    const isFacebook = PLATFORM === 'facebook';
    const isLinkedIn = PLATFORM === 'linkedin';
    const isInstagram = PLATFORM === 'instagram';

    function getOutputLabels() {
      if (isVinSolutions) return { text: 'TEXT MESSAGE', email: 'EMAIL', crm: 'CRM NOTE' };
      if (isGmail) return { text: 'REPLY', email: 'EMAIL REPLY', crm: 'NOTE' };
      if (isFacebook) return { text: 'MESSAGE', email: 'EMAIL', crm: 'NOTE' };
      if (isLinkedIn) return { text: 'LINKEDIN MSG', email: 'EMAIL', crm: 'NOTE' };
      if (isInstagram) return { text: 'DM REPLY', email: 'EMAIL', crm: 'NOTE' };
      return { text: 'REPLY', email: 'EMAIL', crm: 'NOTE' };
    }
    const outputLabels = getOutputLabels();

    // ===== ADDNOTE POPUP RECEIVER (VinSolutions only) =====
    if (isVinSolutions) {
      const pageUrl = window.location.href || '';
      if (pageUrl.includes('AddNote') || (document.body?.innerText || '').includes('Add Note')) {
        setTimeout(async () => {
          try {
            const r = await browser.storage.local.get(['oper8er_paste_note', 'oper8er_paste_note_time']);
            if (r.oper8er_paste_note && r.oper8er_paste_note_time > Date.now() - 30000) {
              const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
              if (textarea) {
                textarea.focus(); textarea.value = r.oper8er_paste_note;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
                textarea.style.border = '2px solid #16a34a';
                setTimeout(() => { textarea.style.border = ''; }, 2000);
                await browser.storage.local.remove(['oper8er_paste_note', 'oper8er_paste_note_time']);
              }
            }
          } catch(e) {}
        }, 1000);
      }
    }

    let leadData: any = null;
    let sidebarOpen = false;
    let sidebarRoot: HTMLElement | null = null;
    let isGenerating = false;
    let currentTier = 'group'; // Demo build: everything unlocked

    async function getTier(): Promise<string> {
      currentTier = 'group';
      return 'group';
    }
    async function isFeatureUnlocked(_feature: string): Promise<boolean> {
      return true; // Demo build: all features unlocked
    }

    // ===== BUG FIX 1: Safe message sender with reconnect =====
    async function safeSend(msg: any): Promise<any> {
      try {
        // Ping first to check if service worker is alive
        await browser.runtime.sendMessage({ type: 'PING' });
      } catch(e: any) {
        // Service worker dead — show reconnect prompt
        throw new Error('Floq lost connection. Reload this page to reconnect.');
      }
      return browser.runtime.sendMessage(msg);
    }

    function showReconnectBanner(shadow: ShadowRoot) {
      const existing = shadow.getElementById('floq-reconnect'); if (existing) return;
      const banner = document.createElement('div'); banner.id = 'floq-reconnect';
      banner.innerHTML = `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:10px;margin:8px;text-align:center;font-size:12px;font-family:system-ui">
        <div style="font-weight:600;color:#92400E;margin-bottom:6px">Floq needs a refresh</div>
        <button id="floq-reload-btn" style="padding:4px 16px;background:#7F77DD;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">Reload Page</button>
      </div>`;
      shadow.getElementById('o8')?.prepend(banner);
      shadow.getElementById('floq-reload-btn')?.addEventListener('click', () => window.location.reload());
    }

    // ===== VINSOLUTIONS SCANNING =====
    const MAKES = 'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';
    const STOP_WORDS = 'Created|Attempted|Contacted|Looking|Wants|Also|Stock|Source|Status|miles|General|Customer|Interested|Trade|lineup|options|inventory|Calculated|Equity|Payoff|hover|details|Bad|Sold|Active|Lost';
    const POISON_BEFORE = /(?:Equity|Payoff|Trade-in|trade\s+value|Credit)\b[\s\S]{0,50}$/i;
    const POISON_AFTER = /^[\s\S]{0,20}(?:Calculated|Payoff|payoff|appraised)/i;

    function isPoisoned(text: string, mi: number, ml: number): boolean {
      return POISON_BEFORE.test(text.slice(Math.max(0, mi - 60), mi)) || POISON_AFTER.test(text.slice(mi + ml, mi + ml + 40));
    }

    function extractVehicle(text: string): string {
      let v = '';
      const vi = text.match(new RegExp('Vehicle Info[\\s\\n]+(20\\d{2}\\s+(?:' + MAKES + ')\\s+[^\\n(]+?)\\s*(?:\\(|\\n|$)', 'i'));
      if (vi) v = vi[1].trim().replace(/\s+/g, ' ').slice(0, 50);
      if (!v) { const am = text.match(new RegExp('Active\\t[\\s\\S]{0,80}?(20\\d{2}\\s+(?:' + MAKES + ')[^\\t\\n]*)', 'i')); if (am) { let x = am[1].trim().replace(/\s+/g, ' '); x = x.replace(new RegExp('\\s+(?:' + STOP_WORDS + ')\\b.*', 'i'), ''); v = x.slice(0, 50); } }
      if (!v) { for (const m of text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')(?:\\s+(?!(?:' + STOP_WORDS + ')\\b)[A-Za-z0-9./-]+){0,5})', 'gi'))) { if (!isPoisoned(text, m.index!, m[0].length)) { v = m[1].trim().replace(/\s+/g, ' ').slice(0, 50); break; } } }
      if (!v) { for (const m of text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + '))', 'gi'))) { if (!isPoisoned(text, m.index!, m[0].length)) { v = m[1].trim().slice(0, 40); break; } } }
      if (!v) { const sv = text.match(/(?:Stock\s*#|Vehicle)\s*:?\s*[\s\S]{0,30}?(20\d{2}\s+\w+\s+[\w-]+)/i); if (sv) v = sv[1].trim().slice(0, 50); }
      return v ? v.replace(/[.,;:!]+$/, '').trim() : '';
    }

    function scanText(text: string): any {
      let name = '';
      const dm = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/);
      if (dm) name = dm[1].trim();
      if (!name) { const im = text.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/); if (im) name = im[1].trim(); }
      let phone = ''; const pm = text.match(/[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/); if (pm) phone = pm[0].replace(/^[CHW]:\s*/, '');
      // FIX 8: Extract email from VinSolutions DOM
      let email = ''; const em = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/); if (em) email = em[0];
      // Also try mailto links
      if (!email) {
        const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
        for (const link of mailtoLinks) {
          const href = (link as HTMLAnchorElement).href;
          if (href) { email = href.replace('mailto:', '').split('?')[0]; break; }
        }
      }
      // Search iframes for email
      if (!email && isVinSolutions) {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (!doc) continue;
            const links = doc.querySelectorAll('a[href^="mailto:"]');
            for (const link of links) { const href = (link as HTMLAnchorElement).href; if (href) { email = href.replace('mailto:', '').split('?')[0]; break; } }
            if (email) break;
            const bodyEmail = (doc.body?.innerText || '').match(/[\w.-]+@[\w.-]+\.\w{2,}/);
            if (bodyEmail) { email = bodyEmail[0]; break; }
          } catch(e) {}
        }
      }
      const vehicle = extractVehicle(text) || null; // FIX 1: null, never empty string
      let source = ''; const sm = text.match(/Source:\s*(.+)/i); if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);
      let status = ''; const stm = text.match(/Status:\s*(.+)/i); if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);
      let lastContact = ''; const cm = text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i); if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);
      return { customerName: name, phone, email, vehicle, source, status, lastContact };
    }

    // Only inject in top frame — scanning, sidebar, pill all belong to the top frame only
    if (window !== window.top) return;

    // ===== FIX 6: HARD GUARD — never inject twice =====
    if (document.getElementById('floq-sidebar')) return;
    if (document.getElementById('oper8er-host')) return;

    // ===== FIX 1: Wait for VinSolutions page to be ready =====
    if (isVinSolutions) {
      const waitForReady = () => new Promise<void>((resolve) => {
        const check = () => {
          const hasContent = document.querySelector('iframe') || document.body.innerText.length > 100;
          if (hasContent && document.readyState === 'complete') {
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        if (document.readyState === 'complete') {
          setTimeout(check, 1000);
        } else {
          window.addEventListener('load', () => setTimeout(check, 1000));
        }
      });
      await waitForReady();
    }

    // Clean stale markers from failed SPA injects
    if (isFacebook || isInstagram) {
      const staleMarker = document.getElementById('floq-sidebar');
      const staleHost = document.getElementById('oper8er-host');
      if (staleMarker && !staleHost) staleMarker.remove();
    }
    if (document.getElementById('floq-sidebar')) return;
    if (document.getElementById('oper8er-host')) return;

    console.log(`[Floq] Injection proceeding — platform: ${PLATFORM}, isTop: ${window === window.top}`);

    // ===== VINSOLUTIONS SCANNING (top frame only, anchored to Customer Dashboard) =====
    if (isVinSolutions) {
      // Gather text from page + all accessible iframes
      function gatherAllText(): string {
        let text = document.body?.innerText || '';
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (doc?.body) text += '\n' + doc.body.innerText;
          } catch(e) {}
        }
        return text;
      }

      // Extract ONLY the text after "Customer Dashboard" heading to avoid picking up
      // names from the left lead list panel. Everything before that marker is ignored.
      function getDashboardScopedText(): string {
        const full = gatherAllText();
        const idx = full.search(/Customer Dashboard/i);
        if (idx === -1) return '';
        return full.slice(idx);
      }

      function attemptScan() {
        const dashText = getDashboardScopedText();
        if (!dashText || dashText.length < 30) return;
        // Name/phone/email come from dashboard-scoped text only
        const s = scanText(dashText);
        // Vehicle can also come from broader page context
        if (!s.vehicle) {
          const allText = gatherAllText();
          s.vehicle = extractVehicle(allText) || null;
        }
        if (s.customerName) browser.storage.local.set({ oper8er_lead: s, oper8er_lead_time: Date.now() });
        if (s.vehicle) browser.storage.local.set({ oper8er_vehicle_info: s.vehicle, oper8er_vehicle_info_time: Date.now() });
      }
      attemptScan();
      let lastScannedName = '';
      setInterval(() => {
        const dashText = getDashboardScopedText();
        const nm = dashText.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/) || dashText.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
        const curName = nm ? nm[1].trim() : '';
        if (curName && curName !== lastScannedName) { lastScannedName = curName; attemptScan(); }
      }, 2000);

      const vinObserver = new MutationObserver(() => {
        const dashText = getDashboardScopedText();
        const nm = dashText.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/) || dashText.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
        const curName = nm ? nm[1].trim() : '';
        if (curName && curName !== lastScannedName) { lastScannedName = curName; attemptScan(); }
      });
      vinObserver.observe(document.body, { childList: true, subtree: true });

      // Poll storage for lead data and update sidebar
      setInterval(async () => {
        try {
          const r = await browser.storage.local.get(['oper8er_lead', 'oper8er_lead_time', 'oper8er_vehicle_info', 'oper8er_vehicle_info_time']);
          const lead = r.oper8er_lead; if (!lead?.customerName) return;
          if (!lead.vehicle && r.oper8er_vehicle_info && r.oper8er_vehicle_info_time > Date.now() - 15000) { lead.vehicle = r.oper8er_vehicle_info; await browser.storage.local.set({ oper8er_lead: lead, oper8er_lead_time: Date.now() }); }
          if (lead.customerName !== leadData?.customerName || lead.vehicle !== leadData?.vehicle) { leadData = lead; updateSidebar(); }
        } catch(e) {}
      }, 2000);
    }

    // ===== SIDEBAR WIDTH PER PLATFORM =====
    function getSidebarWidth(): string {
      if (isGmail || isInstagram) return '280px';
      if (isVinSolutions) return '320px';
      return '300px';
    }

    // ===== PILL — draggable, position saved to storage =====
    let pill: HTMLElement | null = document.createElement('div');
    pill.id = 'oper8er-pill';
    pill.textContent = '⚡ FQ';

    // Default position — can be overridden by saved position
    Object.assign(pill.style, {
      position:'fixed', right:'16px', top:'50%', zIndex:'2147483646',
      background:'#7F77DD', color:'#fff', padding:'8px 12px', borderRadius:'8px',
      fontSize:'12px', fontWeight:'700', fontFamily:'system-ui,sans-serif', cursor:'grab',
      boxShadow:'0 2px 12px rgba(127,119,221,0.35)', letterSpacing:'0.5px', opacity:'0.9',
      transition:'opacity 0.15s', userSelect:'none', touchAction:'none'
    });

    // Load saved position from storage
    browser.storage.local.get(['floq_pill_x', 'floq_pill_y']).then(saved => {
      if (pill && saved.floq_pill_x !== undefined && saved.floq_pill_y !== undefined) {
        pill.style.left = saved.floq_pill_x + 'px';
        pill.style.top = saved.floq_pill_y + 'px';
        pill.style.right = 'auto';
      }
    }).catch(() => {});

    // Drag logic — distinguish drag from click
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let pillStartX = 0, pillStartY = 0;
    let didDrag = false;

    pill.addEventListener('mousedown', (e: MouseEvent) => {
      if (!pill) return;
      isDragging = true; didDrag = false;
      dragStartX = e.clientX; dragStartY = e.clientY;
      const rect = pill.getBoundingClientRect();
      pillStartX = rect.left; pillStartY = rect.top;
      pill.style.cursor = 'grabbing';
      pill.style.transition = 'none'; // disable transitions during drag
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isDragging || !pill) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDrag = true;
      if (didDrag) {
        pill.style.left = (pillStartX + dx) + 'px';
        pill.style.top = (pillStartY + dy) + 'px';
        pill.style.right = 'auto';
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging || !pill) { isDragging = false; return; }
      isDragging = false;
      pill.style.cursor = 'grab';
      pill.style.transition = 'opacity 0.15s';
      if (didDrag) {
        // Save position
        const rect = pill.getBoundingClientRect();
        browser.storage.local.set({ floq_pill_x: rect.left, floq_pill_y: rect.top });
      }
    });

    pill.onmouseenter = () => { if(pill && !isDragging) { pill.style.opacity = '1'; pill.textContent = '⚡ Floq'; } };
    pill.onmouseleave = () => { if(pill && !isDragging) { pill.style.opacity = '0.9'; pill.textContent = '⚡ FQ'; } };
    pill.onclick = (e: MouseEvent) => { if (didDrag) { e.preventDefault(); return; } sidebarOpen ? closeSidebar() : openSidebar(); };
    document.body.appendChild(pill);
    console.log('[Floq] Pill injected on', PLATFORM);

    // ===== SPA OBSERVER for Facebook/Instagram — re-inject pill if DOM rebuilds =====
    if (isFacebook || isInstagram) {
      const target = document.querySelector('[role="main"]') || document.querySelector('[class*="x1n2onr6"]') || document.body;
      const spaObserver = new MutationObserver(() => {
        // If Facebook/Instagram SPA navigation destroyed the pill, re-inject it
        if (!document.getElementById('oper8er-pill') && !document.getElementById('oper8er-host')) {
          const container = document.querySelector('[role="main"], [data-testid="conversation"], [class*="messages"], [class*="messenger"], [class*="direct"]');
          if (container) {
            console.log('[Floq] SPA re-injection: pill was removed, re-creating');
            pill = document.createElement('div');
            pill.id = 'oper8er-pill';
            pill.textContent = '⚡ FQ';
            Object.assign(pill.style, {
              position:'fixed', right:'16px', top:'50%', zIndex:'2147483646',
              background:'#7F77DD', color:'#fff', padding:'8px 12px', borderRadius:'8px',
              fontSize:'12px', fontWeight:'700', fontFamily:'system-ui,sans-serif', cursor:'pointer',
              boxShadow:'0 2px 12px rgba(127,119,221,0.35)', letterSpacing:'0.5px', opacity:'0.9',
              transition:'opacity 0.15s', userSelect:'none'
            });
            pill.onclick = () => { sidebarOpen ? closeSidebar() : openSidebar(); };
            pill.onmouseenter = () => { if(pill) { pill.style.opacity = '1'; pill.textContent = '⚡ Floq'; } };
            pill.onmouseleave = () => { if(pill) { pill.style.opacity = '0.9'; pill.textContent = '⚡ FQ'; } };
            document.body.appendChild(pill);
          }
        }
      });
      spaObserver.observe(target, { childList: true, subtree: true });
      // No timeout — keep watching for SPA navigation for the life of the page
    }

    // ===== FIX 7: VinSolutions SPA navigation observer =====
    if (isVinSolutions) {
      let lastVinUrl = window.location.href;
      const vinUrlObserver = new MutationObserver(() => {
        if (window.location.href !== lastVinUrl) {
          lastVinUrl = window.location.href;
          const existing = document.getElementById('oper8er-host');
          if (existing) existing.remove();
          const marker = document.getElementById('floq-sidebar');
          if (marker) marker.remove();
          sidebarRoot = null; sidebarOpen = false;
          // Re-inject after page renders
          setTimeout(() => { openSidebar(); }, 1500);
        }
      });
      vinUrlObserver.observe(document.body, { childList: true, subtree: true });

      // Auto-open sidebar on VinSolutions after page loads
      setTimeout(() => {
        if (!sidebarOpen) openSidebar();
      }, 2000);
    }

    // ===== PENDING NOTES BADGE (VinSolutions only) =====
    let pendingNotes: any[] = [];
    let pendingBadge: HTMLElement | null = null;
    let pendingPanel: HTMLElement | null = null;

    function refreshPendingBadge() {
      if (!isVinSolutions) return;
      safeSend({ type: 'GET_PENDING_NOTES' }).then((resp: any) => {
        pendingNotes = resp?.notes || [];
        if (pendingNotes.length > 0) {
          if (!pendingBadge) {
            pendingBadge = document.createElement('div');
            pendingBadge.id = 'floq-pending-badge';
            Object.assign(pendingBadge.style, { position:'fixed', bottom:'16px', right:'16px', zIndex:'2147483645', background:'#7F77DD', color:'#fff', padding:'8px 14px', borderRadius:'20px', fontSize:'12px', fontWeight:'600', fontFamily:'system-ui,sans-serif', cursor:'pointer', boxShadow:'0 2px 12px rgba(127,119,221,0.4)', transition:'transform .15s' });
            pendingBadge.onmouseenter = () => { if (pendingBadge) pendingBadge.style.transform = 'scale(1.05)'; };
            pendingBadge.onmouseleave = () => { if (pendingBadge) pendingBadge.style.transform = 'scale(1)'; };
            pendingBadge.onclick = () => togglePendingPanel();
            document.body.appendChild(pendingBadge);
          }
          pendingBadge.textContent = `📋 ${pendingNotes.length} note${pendingNotes.length > 1 ? 's' : ''} to log`;
          pendingBadge.style.display = 'block';
        } else if (pendingBadge) {
          pendingBadge.style.display = 'none';
        }
      }).catch(() => {});
    }

    function togglePendingPanel() {
      if (pendingPanel) { pendingPanel.remove(); pendingPanel = null; return; }
      pendingPanel = document.createElement('div');
      Object.assign(pendingPanel.style, { position:'fixed', bottom:'56px', right:'16px', width:'320px', maxHeight:'400px', zIndex:'2147483645', background:'#fff', borderRadius:'12px', border:'1px solid #e2e8f0', boxShadow:'0 8px 32px rgba(0,0,0,0.15)', fontFamily:'system-ui,sans-serif', overflow:'hidden', display:'flex', flexDirection:'column' });

      let html = '<div style="padding:12px 16px;border-bottom:1px solid #e8eaed;font-size:13px;font-weight:700;color:#1a202c;display:flex;justify-content:space-between;align-items:center"><span>Pending Notes</span><span id="floq-pn-close" style="cursor:pointer;color:#94a3b8;font-size:18px">&times;</span></div>';
      html += '<div style="overflow-y:auto;flex:1;padding:8px">';

      if (pendingNotes.length === 0) {
        html += '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:20px">No pending notes</div>';
      } else {
        for (const note of pendingNotes) {
          const preview = (note.note_text || '').slice(0, 80) + ((note.note_text || '').length > 80 ? '...' : '');
          const time = new Date(note.created_at).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
          html += `<div class="floq-pn-card" data-id="${note.id}" data-text="${esc(note.note_text)}" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-bottom:6px">`;
          html += `<div style="font-size:12px;font-weight:600;color:#1a202c">${esc(note.customer_name || 'Unknown customer')}</div>`;
          html += `<div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.4">${esc(preview)}</div>`;
          html += `<div style="font-size:10px;color:#94a3b8;margin-top:4px">${time}</div>`;
          html += `<div style="display:flex;gap:6px;margin-top:6px">`;
          html += `<button class="floq-pn-log" data-id="${note.id}" style="padding:4px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Log It</button>`;
          html += `<button class="floq-pn-dismiss" data-id="${note.id}" style="padding:4px 12px;background:transparent;color:#94a3b8;border:1px solid #e2e8f0;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit">Dismiss</button>`;
          html += `</div></div>`;
        }
      }
      html += '</div>';
      pendingPanel.innerHTML = html;
      document.body.appendChild(pendingPanel);

      // Close button
      pendingPanel.querySelector('#floq-pn-close')?.addEventListener('click', () => { if (pendingPanel) { pendingPanel.remove(); pendingPanel = null; } });

      // Log It buttons
      pendingPanel.querySelectorAll('.floq-pn-log').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id;
          const card = (btn as HTMLElement).closest('.floq-pn-card') as HTMLElement;
          const noteText = card?.dataset.text || '';
          (btn as HTMLElement).textContent = 'Pasting...';
          const statusEl = document.createElement('span');
          await pasteIntoCRM(noteText, statusEl);
          // Mark as logged regardless — rep can see if it actually pasted
          try { await browser.runtime.sendMessage({ type: 'MARK_NOTE_LOGGED', payload: { id, status: 'logged' } }); } catch(e) {}
          card?.remove();
          refreshPendingBadge();
        });
      });

      // Dismiss buttons
      pendingPanel.querySelectorAll('.floq-pn-dismiss').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = (btn as HTMLElement).dataset.id;
          const card = (btn as HTMLElement).closest('.floq-pn-card') as HTMLElement;
          try { await browser.runtime.sendMessage({ type: 'MARK_NOTE_LOGGED', payload: { id, status: 'dismissed' } }); } catch(e) {}
          card?.remove();
          refreshPendingBadge();
        });
      });
    }

    // Poll pending notes every 30 seconds on VinSolutions
    if (isVinSolutions) {
      setTimeout(refreshPendingBadge, 5000); // first check after 5s
      setInterval(refreshPendingBadge, 30000);
    }

    // ===== INLINE MIC =====
    // Each mic instance gets its own isListening + recognition so they don't interfere
    function attachInlineMic(shadow: ShadowRoot, inputEl: HTMLTextAreaElement | HTMLInputElement, micBtn: HTMLElement) {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { micBtn.style.display = 'none'; return; }
      let isListening = false;
      let recognition: any = null;
      let fullTranscript = '';

      micBtn.onclick = () => {
        if (isListening) {
          // STOP — finalize transcript, clean up
          isListening = false;
          micBtn.classList.remove('mic-active');
          if (recognition) { try { recognition.stop(); } catch(e) {} }
          // Final transcript is already in the input from onresult
          return;
        }

        // START
        try {
          recognition = new SR();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';
          recognition.maxAlternatives = 1;
          fullTranscript = inputEl.value; // preserve existing text

          recognition.onresult = (e: any) => {
            let transcript = fullTranscript;
            for (let i = 0; i < e.results.length; i++) {
              transcript += e.results[i][0].transcript;
              if (e.results[i].isFinal) {
                fullTranscript += e.results[i][0].transcript + ' ';
              }
            }
            // Show final + interim combined
            let display = fullTranscript;
            for (let i = 0; i < e.results.length; i++) {
              if (!e.results[i].isFinal) display += e.results[i][0].transcript;
            }
            inputEl.value = display;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          };

          recognition.onerror = (e: any) => {
            if (e.error === 'aborted') return; // normal stop, ignore
            isListening = false;
            micBtn.classList.remove('mic-active');
            showToast(shadow, 'Mic error — type your message');
          };

          // Auto-restart on silence instead of stopping
          recognition.onend = () => {
            if (isListening) {
              try { recognition.start(); } catch(e) {
                isListening = false;
                micBtn.classList.remove('mic-active');
              }
            }
          };

          recognition.start();
          isListening = true;
          micBtn.classList.add('mic-active');
        } catch(e) {
          micBtn.style.display = 'none';
          showToast(shadow, 'Voice not available — type your message');
        }
      };
    }

    // ===== IMAGE COMPRESSION for Context Reply =====
    function compressImage(base64: string, maxWidth: number = 800, quality: number = 0.7): Promise<string> {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ratio = Math.min(maxWidth / img.width, 1);
          canvas.width = img.width * ratio;
          canvas.height = img.height * ratio;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(base64); // fallback to original if compression fails
        img.src = base64;
      });
    }

    function showToast(shadow: ShadowRoot, msg: string) {
      const existing = shadow.getElementById('floq-toast'); if (existing) existing.remove();
      const toast = document.createElement('div'); toast.id = 'floq-toast'; toast.textContent = msg;
      Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#1a202c', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'11px', fontWeight:'500', zIndex:'99', opacity:'1', transition:'opacity 0.3s' });
      shadow.getElementById('o8')?.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
    }

    // ===== SIDEBAR =====
    async function openSidebar() {
      try { const check = await browser.storage.sync.get(['profile_onboarded']); if (!check.profile_onboarded) { browser.runtime.sendMessage({ type: 'OPEN_ONBOARDING' }); return; } } catch(e) {}
      if (sidebarRoot) { sidebarRoot.style.display = 'block'; sidebarOpen = true; if (pill) pill.style.display = 'none'; pushContent(true); return; }
      if (document.getElementById('oper8er-host')) return;

      await getTier();

      const host = document.createElement('div');
      host.id = 'oper8er-host';
      const w = getSidebarWidth();
      // Gmail: LEFT side below header. All others: RIGHT side.
      if (isGmail) {
        // Position below Gmail labels section — labels nav ends around 200px from top
        Object.assign(host.style, { position:'fixed', bottom:'0', left:'0', width: w, height:'auto', maxHeight:'calc(100vh - 200px)', zIndex:'2147483647' });
      } else if (!isVinSolutions) {
        // Cross-platform compact: right side, auto height
        Object.assign(host.style, { position:'fixed', top:'0', right:'0', width: w, height:'auto', maxHeight:'100vh', zIndex:'2147483647' });
      } else {
        // VinSolutions: flush left side
        Object.assign(host.style, {
          position:'fixed', left:'0', top:'0', margin:'0', padding:'0',
          width:'320px', height:'100vh',
          zIndex:'2147483647',
          boxShadow:'2px 0 8px rgba(0,0,0,0.1)',
          overflowY:'hidden', overflowX:'hidden'
        });
      }

      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = getCSS(w); shadow.appendChild(style);
      const container = document.createElement('div'); container.id = 'o8'; container.innerHTML = getHTML(); shadow.appendChild(container);

      document.body.appendChild(host);
      const marker = document.createElement('div'); marker.id = 'floq-sidebar'; marker.style.display = 'none'; document.body.appendChild(marker);

      sidebarRoot = host; sidebarOpen = true;
      if (pill) pill.style.display = 'none';
      pushContent(true);

      const s = shadow;

      // Close
      s.getElementById('o8-close')!.onclick = closeSidebar;

      // Output chips
      s.querySelectorAll('.chip').forEach(c => { c.addEventListener('click', () => c.classList.toggle('on')); });

      // Generate
      s.getElementById('o8-generate')!.onclick = () => doGenerate(s);
      const mainInput = s.getElementById('o8-input') as HTMLTextAreaElement;
      mainInput.addEventListener('keydown', (e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doGenerate(s); } });

      // Main mic
      attachInlineMic(s, mainInput, s.getElementById('o8-mic')!);

      const settingsBtn = s.getElementById('o8-settings-btn');
      const settingsPanel = s.getElementById('o8-settings-panel');
      const settingsBack = s.getElementById('o8-settings-back');
      if (settingsBack) {
        settingsBack.onclick = () => { settingsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; };
      }

      // Settings tone/goal radio buttons — all unlocked
      s.querySelectorAll('input[name="floq-tone"]').forEach(radio => {
        radio.addEventListener('change', () => { browser.storage.local.set({ floq_tone: (radio as HTMLInputElement).value }); });
      });
      s.querySelectorAll('input[name="floq-goal"]').forEach(radio => {
        radio.addEventListener('change', () => { browser.storage.local.set({ floq_goal: (radio as HTMLInputElement).value }); });
      });
      browser.storage.local.get(['floq_tone', 'floq_goal']).then(r => {
        if (r.floq_tone) { const el = s.querySelector(`input[name="floq-tone"][value="${r.floq_tone}"]`) as HTMLInputElement; if (el) el.checked = true; }
        if (r.floq_goal) { const el = s.querySelector(`input[name="floq-goal"][value="${r.floq_goal}"]`) as HTMLInputElement; if (el) el.checked = true; }
      });

      // Tools panel
      const toolsPanel = s.getElementById('o8-tools-panel');
      const toolsBack = s.getElementById('o8-tools-back');
      const openTools = () => { s.getElementById('o8-quick')!.style.display = 'none'; if (toolsPanel) toolsPanel.style.display = 'flex'; };
      const toolsBtn = s.getElementById('o8-tools-btn');
      if (toolsBtn) toolsBtn.onclick = openTools;
      const toolsBtnInline = s.getElementById('o8-tools-btn-inline');
      if (toolsBtnInline) toolsBtnInline.onclick = openTools;
      if (toolsBack) { toolsBack.onclick = () => { toolsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; }; }

      // Settings — both footer and inline
      const openSettings = () => { s.getElementById('o8-quick')!.style.display = 'none'; if (toolsPanel) toolsPanel.style.display = 'none'; if (settingsPanel) settingsPanel.style.display = 'flex'; };
      const settingsBtnInline = s.getElementById('o8-settings-btn-inline');
      if (settingsBtnInline) settingsBtnInline.onclick = openSettings;
      if (settingsBtn) settingsBtn.onclick = openSettings;

      s.querySelectorAll('.tool-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          s.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.remove('active'));
          s.querySelectorAll('.tool-content').forEach(c => (c as HTMLElement).style.display = 'none');
          btn.classList.add('active');
          s.getElementById('tool-' + (btn as HTMLElement).dataset.tool)!.style.display = 'block';
        });
      });

      // Coach
      const coachInput = s.getElementById('o8-coach-input') as HTMLTextAreaElement;
      const coachMic = s.getElementById('o8-coach-mic');
      if (coachInput && coachMic) attachInlineMic(s, coachInput, coachMic);
      s.querySelectorAll('.coach-chip').forEach(chip => { chip.addEventListener('click', () => { if (coachInput) coachInput.value = chip.textContent || ''; }); });
      const coachBtn = s.getElementById('o8-coach-btn');
      if (coachBtn) {
        coachBtn.addEventListener('click', async () => {
          const input = coachInput?.value.trim(); if (!input) return;
          coachBtn.textContent = 'Thinking...'; (coachBtn as any).disabled = true;
          try {
            const resp = await safeSend({ type: 'COACH_ME', payload: { situation: input, vehicleContext: leadData?.vehicle || '' } });
            const output = s.getElementById('o8-coach-output')!;
            output.innerHTML = resp.error ? '<div class="tool-result">' + esc(resp.error) + '</div>' : '<div class="tool-result"><strong>YOUR NEXT MOVE:</strong><br>' + esc(resp.coaching).replace(/\n/g, '<br>') + '</div>';
          } catch(e: any) { s.getElementById('o8-coach-output')!.innerHTML = '<div class="tool-result">' + esc(e.message) + '</div>'; }
          coachBtn.textContent = 'Coach Me'; (coachBtn as any).disabled = false;
        });
      }

      // Alerts
      const alertInput = s.getElementById('o8-alert-input') as HTMLInputElement;
      const alertMic = s.getElementById('o8-alert-mic');
      if (alertInput && alertMic) attachInlineMic(s, alertInput, alertMic);
      const alertBtn = s.getElementById('o8-alert-btn');
      if (alertBtn) {
        alertBtn.addEventListener('click', async () => {
          const input = alertInput?.value.trim(); if (!input) return;
          try { await safeSend({ type: 'SET_ALERT', payload: { task: input, alertTime: parseAlertTime(input) } }); } catch(e: any) { if (e.message.includes('Reload') || e.message.includes('connection') || e.message.includes('invalidated')) { showReconnectBanner(s); } return; }
          alertInput.value = ''; loadAlerts(s);
        });
      }

      // Command
      const cmdInput = s.getElementById('o8-cmd-input') as HTMLTextAreaElement;
      const cmdMic = s.getElementById('o8-cmd-mic');
      if (cmdInput && cmdMic) attachInlineMic(s, cmdInput, cmdMic);
      const cmdExec = s.getElementById('o8-cmd-execute');
      if (cmdExec) {
        cmdExec.addEventListener('click', async () => {
          const input = cmdInput?.value.trim(); if (!input) return;
          cmdExec.textContent = 'Processing...'; (cmdExec as any).disabled = true;
          const sa = s.getElementById('o8-cmd-status')!; sa.innerHTML = '';
          try {
            const resp = await safeSend({ type: 'EXECUTE_COMMAND', payload: { command: input, currentUrl: window.location.href, vehicleContext: leadData?.vehicle || '' } });
            if (resp.error) sa.innerHTML = '<div class="tool-result" style="color:#FF3B30">' + esc(resp.error) + '</div>';
            else { const p = resp.parsed; if (p.content) { const injected = injectContent(p); sa.innerHTML = '<div class="tool-result">' + (injected ? 'Injected' : esc(p.content).replace(/\n/g, '<br>')) + '</div>'; } else sa.innerHTML = '<div class="tool-result">Done</div>'; }
          } catch(e: any) { sa.innerHTML = '<div class="tool-result" style="color:#FF3B30">' + esc(e.message) + '</div>'; }
          cmdExec.textContent = 'Execute'; (cmdExec as any).disabled = false;
        });
      }

      // Context
      let contextImage: string | null = null;
      const dropZone = s.getElementById('o8-ctx-dropzone');
      const ctxPreview = s.getElementById('o8-ctx-preview');
      const ctxImg = s.getElementById('o8-ctx-img') as HTMLImageElement;
      const ctxDir = s.getElementById('o8-ctx-direction') as HTMLTextAreaElement;
      const ctxGen = s.getElementById('o8-ctx-generate') as HTMLButtonElement;
      const ctxOut = s.getElementById('o8-ctx-output');
      function updCtx() { if (ctxGen) ctxGen.disabled = !contextImage || !ctxDir?.value.trim(); }
      function setContextImage(dataUrl: string) {
        contextImage = dataUrl;
        if (ctxImg) ctxImg.src = contextImage;
        if (ctxPreview) ctxPreview.style.display = 'block';
        if (dropZone) dropZone.style.display = 'none';
        updCtx();
      }
      if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e: any) => { e.preventDefault(); dropZone.classList.remove('dragover'); const f = e.dataTransfer?.files?.[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => setContextImage(r.result as string); r.readAsDataURL(f); } });
      }
      // Ctrl+V paste support for screenshots
      document.addEventListener('paste', (e: ClipboardEvent) => {
        // Only handle if context tab is visible
        const ctxTab = s.getElementById('tool-context');
        if (!ctxTab || ctxTab.style.display === 'none') return;
        const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
        if (!item) return;
        const blob = item.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => setContextImage(reader.result as string);
        reader.readAsDataURL(blob);
        e.preventDefault();
      });
      function clearContextImage() { contextImage = null; if (ctxPreview) ctxPreview.style.display = 'none'; if (dropZone) dropZone.style.display = 'flex'; updCtx(); }
      if (s.getElementById('o8-ctx-remove')) s.getElementById('o8-ctx-remove')!.addEventListener('click', clearContextImage);
      if (ctxDir) ctxDir.addEventListener('input', updCtx);
      // BUG 3: Attach mic to context direction input
      const ctxMic = s.getElementById('o8-ctx-mic');
      if (ctxDir && ctxMic) attachInlineMic(s, ctxDir, ctxMic);
      if (ctxGen) {
        ctxGen.addEventListener('click', async () => {
          if (!contextImage || !ctxDir?.value.trim()) return;
          ctxGen.textContent = 'Compressing...'; ctxGen.disabled = true; if (ctxOut) ctxOut.innerHTML = '';
          try {
            const compressed = await compressImage(contextImage, 800, 0.7);
            ctxGen.textContent = 'Analyzing...';
            const resp = await safeSend({ type: 'CONTEXT_REPLY', payload: { image: compressed, direction: ctxDir.value.trim() } });
            if (resp.error) {
              const msg = resp.error.includes('413') ? 'Screenshot too large — try a smaller crop' : resp.error;
              addOutput(s, 'Error', msg, 'o8-ctx-output');
            } else { addOutput(s, 'REPLY', resp.reply || resp.raw || '', 'o8-ctx-output'); }
          } catch(e: any) {
            if (e.message.includes('Reload') || e.message.includes('connection')) { showReconnectBanner(s); }
            const msg = e.message.includes('413') ? 'Screenshot too large — try a smaller crop' : e.message;
            addOutput(s, 'Error', msg, 'o8-ctx-output');
          }
          ctxGen.textContent = 'Generate Reply'; ctxGen.disabled = false; updCtx();
        });
      }

      if (isVinSolutions) updateSidebar();
    }

    function pushContent(open: boolean) {
      if (!isVinSolutions) return;
      const target = document.querySelector('#mainAreaPanel') as HTMLElement
        || document.querySelector('.main-content') as HTMLElement
        || document.querySelector('#page-content') as HTMLElement
        || document.body;
      target.style.marginLeft = open ? '320px' : '';
      target.style.transition = 'margin-left 0.2s';
    }

    function closeSidebar() {
      if (sidebarRoot) { sidebarRoot.style.display = 'none'; sidebarOpen = false; }
      if (pill) pill.style.display = 'block';
      pushContent(false);
    }

    function updateSidebar() {
      if (!sidebarRoot || !isVinSolutions) return;
      const s = sidebarRoot.shadowRoot!;
      const card = s.getElementById('o8-card'); if (!card) return;
      if (leadData?.customerName) {
        card.style.display = 'block';
        const nameEl = s.getElementById('o8-name')!;
        nameEl.textContent = leadData.customerName;
        nameEl.style.fontStyle = 'normal'; nameEl.style.color = '#1a202c';
        const vehEl = s.getElementById('o8-vehicle')!;
        if (leadData.vehicle) { vehEl.textContent = leadData.vehicle; vehEl.style.fontStyle = 'normal'; vehEl.style.color = '#2563eb'; }
        else { vehEl.textContent = 'No vehicle selected'; vehEl.style.fontStyle = 'italic'; vehEl.style.color = '#94a3b8'; }
        let meta = '';
        if (leadData.phone) meta += leadData.phone;
        if (leadData.email) meta += (meta ? ' · ' : '') + leadData.email;
        if (leadData.source) meta += (meta ? ' · ' : '') + leadData.source;
        s.getElementById('o8-meta')!.textContent = meta;

        // Auto-match pending notes for this customer
        const matchDiv = s.getElementById('o8-pending-match');
        if (matchDiv) matchDiv.remove();
        const matched = pendingNotes.find(n => n.customer_name && leadData.customerName && n.customer_name.toLowerCase() === leadData.customerName.toLowerCase());
        if (matched) {
          const div = document.createElement('div');
          div.id = 'o8-pending-match';
          div.innerHTML = `<div style="background:#FFF7ED;border:1px solid #FBBF24;border-radius:8px;padding:10px;margin-top:8px;font-size:11px"><strong style="color:#92400E">Pending note for ${esc(matched.customer_name)}</strong><div style="color:#64748b;margin:4px 0;line-height:1.4">${esc((matched.note_text || '').slice(0, 100))}</div><button id="o8-pn-log-match" style="padding:4px 12px;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">Log It</button></div>`;
          card.appendChild(div);
          div.querySelector('#o8-pn-log-match')?.addEventListener('click', async () => {
            const statusEl = document.createElement('span');
            await pasteIntoCRM(matched.note_text, statusEl);
            try { await browser.runtime.sendMessage({ type: 'MARK_NOTE_LOGGED', payload: { id: matched.id, status: 'logged' } }); } catch(e) {}
            div.remove();
            refreshPendingBadge();
          });
        }
      } else {
        card.style.display = 'block';
        const nameEl = s.getElementById('o8-name')!;
        nameEl.textContent = 'Open a customer record';
        nameEl.style.fontStyle = 'italic'; nameEl.style.color = '#94a3b8';
        s.getElementById('o8-vehicle')!.textContent = '';
        s.getElementById('o8-meta')!.textContent = '';
      }
    }

    // ===== GENERATE =====
    async function doGenerate(s: ShadowRoot) {
      if (isGenerating) return; isGenerating = true;
      // Demo build: no platform feature gates
      const input = (s.getElementById('o8-input') as HTMLTextAreaElement).value.trim();
      if (!input && !leadData?.customerName) { isGenerating = false; return; }
      const chips = s.querySelectorAll('.chip.on');
      const selected = Array.from(chips).map(c => c.getAttribute('data-type'));
      if (selected.length === 0) { isGenerating = false; return; }
      const type = selected.length === 3 ? 'all' : selected.length === 1 ? selected[0]! : 'all';
      const btn = s.getElementById('o8-generate') as HTMLButtonElement;
      btn.textContent = 'Generating...'; btn.disabled = true; btn.style.background = '#94a3b8';
      s.getElementById('o8-outputs')!.innerHTML = '';

      // Read tone/goal from storage for FIX 7
      let tone = 'professional'; let goal = 'close_deal';
      try { const stored = await browser.storage.local.get(['floq_tone', 'floq_goal']); tone = stored.floq_tone || 'professional'; goal = stored.floq_goal || 'close_deal'; } catch(e) {}

      try {
        const response = await safeSend({
          type: 'GENERATE_OUTPUT',
          payload: { type, leadContext: leadData || {}, repInput: input + (leadData?.vehicle ? '' : '\n[SYSTEM: No vehicle of interest detected. Do not mention or invent a vehicle in the response.]'), repName: '', dealership: '', platform: PLATFORM, tone, goal,
            metadata: { workflow_type: type === 'all' ? 'all' : type, customer_name: leadData?.customerName || null, vehicle: leadData?.vehicle || null, email: leadData?.email || null } }
        });
        if (response.error) addOutput(s, 'Error', response.error);
        else { const sec = response.sections; if (selected.includes('text') && sec.text) addOutput(s, outputLabels.text, sec.text); if (selected.includes('email') && sec.email) addOutput(s, outputLabels.email, sec.email); if (selected.includes('crm') && sec.crm) addOutput(s, outputLabels.crm, sec.crm); if (!sec.text && !sec.email && !sec.crm) addOutput(s, 'OUTPUT', response.text || 'Generation returned empty.'); }
      } catch (e: any) {
        if (e.message.includes('Reload') || e.message.includes('connection') || e.message.includes('invalidated')) { showReconnectBanner(s); }
        addOutput(s, 'Error', e.message.includes('invalidated') ? 'Floq needs a refresh. Click Reload Page above.' : e.message);
      }
      btn.textContent = 'Generate'; btn.disabled = false; btn.style.background = '#7F77DD'; isGenerating = false;
    }

    // ===== CRM PASTE =====
    function findNoteTextarea(): HTMLTextAreaElement | null { if (!isVinSolutions) return null; const iframes = document.querySelectorAll('iframe'); for (const iframe of iframes) { try { if (iframe.src?.includes('AddNote')) { const doc = iframe.contentDocument || (iframe as any).contentWindow?.document; if (doc) { const ta = doc.querySelector('textarea'); if (ta) return ta; } } } catch(e) {} } for (const iframe of iframes) { try { const doc = iframe.contentDocument || (iframe as any).contentWindow?.document; if (!doc) continue; if ((doc.body?.innerText || '').includes('Add Note') || (doc.body?.innerText || '').includes('Note Type')) { const ta = doc.querySelector('textarea'); if (ta) return ta; } } catch(e) {} } return null; }
    function clickNoteIcon(): boolean { if (!isVinSolutions) return false; for (const el of document.querySelectorAll('a, button, div, span, td')) { if (el.textContent?.trim() === 'Note' && (el as HTMLElement).offsetWidth > 0) { (el as HTMLElement).click(); return true; } } return false; }
    async function pasteIntoCRM(noteText: string, statusEl: HTMLElement) {
      if (!isVinSolutions) { statusEl.textContent = 'VinSolutions only'; return; }
      statusEl.textContent = 'Opening note form...'; statusEl.style.color = '#2563eb';
      await browser.storage.local.set({ oper8er_paste_note: noteText, oper8er_paste_note_time: Date.now() });
      let textarea = findNoteTextarea();
      if (!textarea) { const clicked = clickNoteIcon(); if (clicked) { for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 500)); textarea = findNoteTextarea(); if (textarea) break; } } }
      if (textarea) { textarea.focus(); textarea.value = noteText; textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true })); statusEl.textContent = 'Pasted'; statusEl.style.color = '#16a34a'; textarea.style.border = '2px solid #16a34a'; setTimeout(() => { textarea!.style.border = ''; }, 2000); browser.storage.local.remove(['oper8er_paste_note', 'oper8er_paste_note_time']); }
      else {
        statusEl.textContent = 'Saved to pending notes'; statusEl.style.color = '#2563eb';
        // Persist to Supabase so it survives session/navigation
        try { browser.runtime.sendMessage({ type: 'SAVE_PENDING_NOTE', payload: { customer_name: leadData?.customerName || '', note_text: noteText, contact_id: null } }); } catch(e) {}
        refreshPendingBadge();
      }
    }

    // Paste email subject+body into VinSolutions Send Email popup
    async function pasteIntoEmail(emailContent: string, statusEl: HTMLElement) {
      if (!isVinSolutions) { navigator.clipboard.writeText(emailContent); statusEl.textContent = 'Copied'; statusEl.style.color = '#16a34a'; return; }
      statusEl.textContent = 'Finding email form...'; statusEl.style.color = '#2563eb';

      // Parse subject and body
      let subject = ''; let body = emailContent;
      const subjectMatch = emailContent.match(/^Subject:\s*(.+)/im);
      if (subjectMatch) { subject = subjectMatch[1].trim(); body = emailContent.slice(subjectMatch.index! + subjectMatch[0].length).trim(); }
      body = body.replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/#{1,6}\s/g, '').trim();

      // Search ALL iframes (nested too) for the email compose form
      function tryInjectInDoc(doc: Document): boolean {
        // Subject field
        if (subject) {
          const subj = doc.querySelector('input[id*="ubject"], input[name*="ubject"], input[id*="Subject"], input[name*="Subject"]') as HTMLInputElement;
          if (subj) { subj.focus(); subj.value = subject; subj.dispatchEvent(new Event('input', { bubbles: true })); subj.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        // Body: contenteditable > textarea > nested iframe body
        const editable = doc.querySelector('[contenteditable="true"]') as HTMLElement;
        if (editable) { editable.focus(); editable.innerText = body; editable.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        const ta = doc.querySelector('textarea') as HTMLTextAreaElement;
        if (ta) { ta.focus(); ta.value = body; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        // Nested iframe (rich text editor like TinyMCE)
        for (const nf of doc.querySelectorAll('iframe')) {
          try { const nd = nf.contentDocument || (nf as any).contentWindow?.document; if (nd?.body) { nd.body.innerText = body; return true; } } catch(e) {}
        }
        return false;
      }

      let found = false;
      // Search all iframes for email-related ones
      const allIframes = document.querySelectorAll('iframe');
      for (const iframe of allIframes) {
        try {
          const src = (iframe.src || '').toLowerCase();
          if (!src.includes('email') && !src.includes('sendemail') && !src.includes('send_email') && !src.includes('communication')) continue;
          const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
          if (doc && tryInjectInDoc(doc)) { found = true; break; }
        } catch(e) {}
      }

      // Also check popup windows via VinSolutions texting/email popups
      if (!found) {
        // The email popup is often a rims2.aspx Communication page — look for it
        for (const iframe of allIframes) {
          try {
            const src = (iframe.src || '').toLowerCase();
            if (!src.includes('rims2') && !src.includes('communication')) continue;
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (!doc) continue;
            // Search nested iframes inside this communication frame
            for (const inner of doc.querySelectorAll('iframe')) {
              try {
                const innerDoc = inner.contentDocument || (inner as any).contentWindow?.document;
                if (innerDoc && tryInjectInDoc(innerDoc)) { found = true; break; }
              } catch(e) {}
            }
            if (found) break;
          } catch(e) {}
        }
      }

      if (found) {
        statusEl.textContent = 'Pasted to email'; statusEl.style.color = '#16a34a';
      } else {
        // Fallback: copy to clipboard + stage for auto-paste
        navigator.clipboard.writeText(emailContent);
        await browser.storage.local.set({ oper8er_paste_email_subject: subject, oper8er_paste_email_body: body, oper8er_paste_email_time: Date.now() });
        statusEl.textContent = 'Copied — paste into email manually'; statusEl.style.color = '#2563eb';
      }
    }

    function addOutput(s: ShadowRoot, label: string, content: string, containerId: string = 'o8-outputs') {
      const container = s.getElementById(containerId) || s.getElementById('o8-outputs')!;
      const card = document.createElement('div'); card.className = 'out-card';
      const isCRM = label === 'CRM NOTE';
      const isEmail = label === 'EMAIL' || label === 'EMAIL REPLY';

      // ONE button per output type
      let actionBtn = '';
      if (isCRM && isVinSolutions) actionBtn = '<button class="out-action out-paste">Paste to CRM</button>';
      else if (isEmail && isVinSolutions) actionBtn = '<button class="out-action out-send-email">Send to Email</button>';
      else actionBtn = '<button class="out-action out-copy">Copy + Log</button>';

      card.innerHTML = `<div class="out-label">${esc(label)}</div><div class="out-text">${esc(content).replace(/\n/g, '<br>')}</div><div class="out-actions">${actionBtn}</div><div class="out-status"></div>`;

      // Text: Copy + Log
      const copyBtn = card.querySelector('.out-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function(this: HTMLElement) {
          navigator.clipboard.writeText(content);
          this.textContent = 'Copied'; this.style.background = '#16a34a'; this.style.color = '#fff';
          try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label, platform: PLATFORM, customer: leadData?.customerName || null } }); } catch(e) {}
          setTimeout(() => { this.textContent = 'Copy + Log'; this.style.background = ''; this.style.color = ''; }, 1500);
        });
      }

      // CRM Note: Paste to CRM
      const pasteBtn = card.querySelector('.out-paste');
      if (pasteBtn && isCRM && isVinSolutions) {
        pasteBtn.addEventListener('click', function(this: HTMLElement) {
          const st = card.querySelector('.out-status') as HTMLElement;
          (this as any).disabled = true; this.textContent = 'Pasting...';
          pasteIntoCRM(content, st).then(() => { this.textContent = 'Paste to CRM'; (this as any).disabled = false; });
        });
      }

      // Email: Send to Email — inject into popup OR copy
      const sendBtn = card.querySelector('.out-send-email');
      if (sendBtn && isEmail && isVinSolutions) {
        sendBtn.addEventListener('click', function(this: HTMLElement) {
          const st = card.querySelector('.out-status') as HTMLElement;
          (this as any).disabled = true; this.textContent = 'Sending...';
          pasteIntoEmail(content, st).then(() => {
            this.textContent = 'Send to Email'; (this as any).disabled = false;
            // Also log
            try { browser.runtime.sendMessage({ type: 'LOG_COPY', payload: { label: 'EMAIL_SENT', platform: PLATFORM, customer: leadData?.customerName || null } }); } catch(e) {}
          });
        });
      }

      container.appendChild(card);
    }

    function injectContent(parsed: any): boolean {
      const { action, content, subject } = parsed;
      if ((action === 'write_email' || PLATFORM === 'gmail') && isGmail) { const body = document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement; if (body) { body.focus(); document.execCommand('insertText', false, content); if (subject) { const subj = document.querySelector('input[name="subjectbox"]') as HTMLInputElement; if (subj) { subj.focus(); subj.value = subject; subj.dispatchEvent(new Event('input', { bubbles: true })); } } return true; } }
      if ((action === 'write_facebook_message' || PLATFORM === 'facebook') && isFacebook) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { box.focus(); document.execCommand('insertText', false, content); return true; } }
      if ((action === 'write_linkedin_message' || PLATFORM === 'linkedin') && isLinkedIn) { const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement; if (box) { box.focus(); document.execCommand('insertText', false, content); return true; } }
      if (action === 'log_crm_note' && isVinSolutions) { pasteIntoCRM(content, document.createElement('span')); return true; }
      return false;
    }

    // ===== LISTENERS =====
    browser.runtime.onMessage.addListener((msg: any) => {
      if (msg.type === 'OPEN_COMMAND_TAB' && sidebarRoot) { if (!sidebarOpen) openSidebar(); const s = sidebarRoot.shadowRoot!; s.getElementById('o8-quick')!.style.display = 'none'; const tp = s.getElementById('o8-tools-panel'); if (tp) tp.style.display = 'flex'; s.querySelectorAll('.tool-tab-btn').forEach(b => b.classList.remove('active')); s.querySelector('.tool-tab-btn[data-tool="command"]')?.classList.add('active'); s.querySelectorAll('.tool-content').forEach(c => (c as HTMLElement).style.display = 'none'); s.getElementById('tool-command')!.style.display = 'block'; }
      if (msg.type === 'SHOW_ALERT_BANNER') { const existing = document.getElementById('floq-alert-banner'); if (existing) existing.remove(); const banner = document.createElement('div'); banner.id = 'floq-alert-banner'; Object.assign(banner.style, { position:'fixed', top:'0', left:'0', right:'0', zIndex:'999999', background:'#FF3B30', color:'#fff', padding:'12px 20px', fontFamily:'system-ui,sans-serif', fontSize:'14px', fontWeight:'600', display:'flex', alignItems:'center', gap:'10px', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }); banner.innerHTML = `<span>🔔</span><span style="flex:1">${esc(msg.payload.task)}</span><button style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:6px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Dismiss</button>`; banner.querySelector('button')!.addEventListener('click', () => { banner.remove(); browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id: msg.payload.id } }); }); document.body.appendChild(banner); }
    });

    function parseAlertTime(text: string): number { const now = Date.now(); const inMin = text.match(/in\s+(\d+)\s*min/i); if (inMin) return now + parseInt(inMin[1]) * 60000; const inHr = text.match(/in\s+(\d+)\s*hour/i); if (inHr) return now + parseInt(inHr[1]) * 3600000; const byTime = text.match(/(?:by|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i); if (byTime) { let h = parseInt(byTime[1]); const m = byTime[2] ? parseInt(byTime[2]) : 0; const ampm = (byTime[3] || '').toLowerCase(); if (ampm === 'pm' && h < 12) h += 12; if (ampm === 'am' && h === 12) h = 0; if (!ampm && h < 7) h += 12; const d = new Date(); d.setHours(h, m, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); } return now + 30 * 60000; }

    async function loadAlerts(s: ShadowRoot) { let alerts: any[] = []; try { alerts = await safeSend({ type: 'GET_ALERTS' }); } catch(e: any) { if (e.message.includes('Reload') || e.message.includes('connection') || e.message.includes('invalidated')) { showReconnectBanner(s); } return; } const list = s.getElementById('o8-alert-list'); if (!list) return; if (!alerts || alerts.length === 0) { list.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:12px">No active reminders</div>'; return; } list.innerHTML = alerts.map((a: any) => `<div class="alert-item"><span>${esc(a.task)}</span><span class="alert-time">${new Date(a.alertTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="alert-dismiss" data-id="${a.id}">&times;</button></div>`).join(''); list.querySelectorAll('.alert-dismiss').forEach(btn => { btn.addEventListener('click', async () => { const id = (btn as HTMLElement).dataset.id; if (id) { await browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id } }); loadAlerts(s); } }); }); }

    function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function getBadge() {
      switch (PLATFORM) {
        case 'vinsolutions': return { label: 'VinSolutions', color: '#7F77DD', bg: '#F0EFFF' };
        case 'gmail': return { label: 'Gmail', color: '#dc2626', bg: '#fef2f2' };
        case 'facebook': return { label: 'Messenger', color: '#1877f2', bg: '#eff6ff' };
        case 'linkedin': return { label: 'LinkedIn', color: '#0a66c2', bg: '#eff6ff' };
        case 'whatsapp': return { label: 'WhatsApp', color: '#25D366', bg: '#f0fdf4' };
        case 'instagram': return { label: 'Instagram', color: '#E1306C', bg: '#fef2f8' };
        default: return { label: '', color: '#64748b', bg: '#f1f5f9' };
      }
    }

    // Demo build: no gate cards — all features unlocked

    // Settings HTML — all unlocked (demo build)
    function getSettingsHTML(): string {
      return `<div class="settings-section">
        <div class="settings-label">Tone</div>
        <div class="settings-options"><label><input type="radio" name="floq-tone" value="professional" checked> Professional</label><label><input type="radio" name="floq-tone" value="friendly"> Friendly</label><label><input type="radio" name="floq-tone" value="casual"> Casual</label><label><input type="radio" name="floq-tone" value="direct"> Direct</label></div>
        <div class="settings-label">Goal</div>
        <div class="settings-options"><label><input type="radio" name="floq-goal" value="close_deal" checked> Close the deal</label><label><input type="radio" name="floq-goal" value="book_appointment"> Book appointment</label><label><input type="radio" name="floq-goal" value="gather_info"> Gather info</label><label><input type="radio" name="floq-goal" value="nurture"> Nurture long-term</label></div>
      </div>`;
    }

    function getHTML(): string {
      const badge = getBadge();
      const customerCard = isVinSolutions ? `<div id="o8-card" class="card"><div id="o8-name" class="name" style="font-style:italic;color:#94a3b8">Open a customer record</div><div id="o8-vehicle" class="vehicle"></div><div id="o8-meta" class="meta"></div></div>` : '';
      const placeholder = isVinSolutions ? 'Describe the situation or tap the mic...' : isGmail ? 'Describe the email situation...' : isFacebook ? 'Describe the conversation...' : isLinkedIn ? 'Describe the LinkedIn interaction...' : isInstagram ? 'Describe the DM...' : 'Describe the situation...';

      return `
<div class="header">
  <span class="logo">FLOQ</span>
  <span class="badge" style="color:${badge.color};background:${badge.bg}">${esc(badge.label)}</span>
  <span id="o8-close" class="close">&times;</span>
</div>
<div id="o8-quick" class="quick-mode">
  ${customerCard}
  <div class="input-section">
    <div class="chips">
      <button class="chip on" data-type="text">Message</button>
      <button class="chip on" data-type="email">Email</button>
      <button class="chip on" data-type="crm">CRM Note</button>
    </div>
    <div class="input-wrap">
      <textarea id="o8-input" class="main-input" placeholder="${esc(placeholder)}" rows="3"></textarea>
      <button id="o8-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button>
    </div>
    <button id="o8-generate" class="gen-btn">Generate</button>
    <div class="inline-links"><button id="o8-tools-btn-inline" class="link-btn">Tools</button><span class="link-sep">|</span><button id="o8-settings-btn-inline" class="link-btn">Settings</button></div>
  </div>
  <div id="o8-outputs" class="outputs"></div>
</div>
<div id="o8-tools-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-tools-back" class="back-btn">← Back</button><span class="tools-title">Tools</span></div>
  <div class="tool-tabs">
    <button class="tool-tab-btn active" data-tool="coach">Coach</button>
    <button class="tool-tab-btn" data-tool="alerts">Alerts</button>
    <button class="tool-tab-btn" data-tool="context">Context</button>
    <button class="tool-tab-btn" data-tool="command">Command</button>
  </div>
  <div id="tool-coach" class="tool-content" style="display:block"><div class="tool-section"><div class="input-wrap"><textarea id="o8-coach-input" class="main-input" placeholder="What did the customer just say?" rows="2"></textarea><button id="o8-coach-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><div class="coach-chips"><button class="coach-chip">Need to think about it</button><button class="coach-chip">Price too high</button><button class="coach-chip">Bad credit</button><button class="coach-chip">Spouse not here</button></div><button id="o8-coach-btn" class="gen-btn">Coach Me</button></div><div id="o8-coach-output" class="tool-output"></div></div>
  <div id="tool-alerts" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><input id="o8-alert-input" class="main-input" placeholder="e.g. Move the Tacoma by noon" /><button id="o8-alert-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-alert-btn" class="gen-btn" style="background:#FF9500">Set Alert</button></div><div id="o8-alert-list" class="tool-output"></div></div>
  <div id="tool-context" class="tool-content" style="display:none"><div class="tool-section"><div id="o8-ctx-dropzone" class="ctx-dropzone"><span>Drop screenshot or paste (Ctrl+V)</span></div><div id="o8-ctx-preview" class="ctx-preview" style="display:none"><img id="o8-ctx-img" class="ctx-img" /><button id="o8-ctx-remove" class="ctx-remove">&times;</button></div><div class="input-wrap"><textarea id="o8-ctx-direction" class="main-input" placeholder="What do you want to say?" rows="2"></textarea><button id="o8-ctx-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-ctx-generate" class="gen-btn" disabled>Generate Reply</button></div><div id="o8-ctx-output" class="tool-output"></div></div>
  <div id="tool-command" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><textarea id="o8-cmd-input" class="main-input" placeholder="Type a command..." rows="2"></textarea><button id="o8-cmd-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-cmd-execute" class="gen-btn">Execute</button></div><div id="o8-cmd-status" class="tool-output"></div></div>
</div>
<div id="o8-settings-panel" class="tools-panel" style="display:none">
  <div class="tools-header"><button id="o8-settings-back" class="back-btn">← Back</button><span class="tools-title">Settings</span></div>
  ${getSettingsHTML()}
</div>
<div class="sidebar-footer">
  <button id="o8-tools-btn" class="tools-btn">⚙ Tools</button>
  <button id="o8-settings-btn" class="tools-btn">Settings</button>
  <div class="tcpa">Messages are for human review. TCPA compliance is your responsibility.</div>
</div>`;
    }

    function getCSS(width: string): string {
      return `
* { margin:0; padding:0; box-sizing:border-box; }
:host { all:initial; font-family:system-ui,-apple-system,sans-serif; font-size:13px; color:#1a202c; }
#o8 { width:${width}; height:${isVinSolutions ? '100vh' : '480px'}; max-height:100vh; background:#fff; ${isVinSolutions ? 'border-right:1px solid #e2e8f0;' : 'border-left:1px solid #e2e8f0; border-right:1px solid #e2e8f0;'} overflow-y:auto; overscroll-behavior:contain; ${isVinSolutions ? '' : 'box-shadow:0 0 16px rgba(0,0,0,0.06);'} display:flex; flex-direction:column; padding-bottom:${isVinSolutions ? '60px' : '0'}; ${!isVinSolutions ? 'border-radius:0 0 8px 0;' : ''} }
.header { padding:10px 14px; border-bottom:1px solid #e8eaed; display:flex; align-items:center; gap:8px; flex-shrink:0; }
.logo { font-size:14px; font-weight:800; color:#7F77DD; letter-spacing:3px; }
.badge { font-size:9px; font-weight:600; padding:2px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:0.5px; flex:1; text-align:center; }
.close { font-size:20px; color:#94a3b8; cursor:pointer; padding:0 4px; } .close:hover { color:#475569; }
.quick-mode { display:flex; flex-direction:column; flex:1; overflow:hidden; }
.card { padding:10px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
.name { font-size:14px; font-weight:600; } .vehicle { font-size:11px; color:#2563eb; margin-top:1px; } .meta { font-size:10px; color:#64748b; margin-top:2px; }
.input-section { padding:12px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
.chips { display:flex; gap:5px; margin-bottom:8px; }
.chip { padding:5px 12px; border-radius:16px; font-size:11px; font-weight:600; font-family:inherit; border:1.5px solid #e2e8f0; background:#fff; color:#94a3b8; cursor:pointer; transition:all 0.15s; position:relative; }
.chip.on { border-color:#7F77DD; color:#7F77DD; background:#F0EFFF; }
.chip.on::after { content:''; position:absolute; top:-2px; right:-2px; width:7px; height:7px; border-radius:50%; background:#16a34a; border:1.5px solid #fff; }
.input-wrap { position:relative; display:flex; align-items:flex-start; }
.main-input { flex:1; padding:8px 40px 8px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:13px; font-family:inherit; resize:none; outline:none; color:#1a202c; }
.main-input:focus { border-color:#7F77DD; } .main-input::placeholder { color:#94a3b8; }
/* FIX 6: Visible mic button */
.inline-mic { position:absolute; right:6px; top:6px; width:28px; height:28px; border-radius:50%; border:none; background:#7F77DD; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
.inline-mic:hover { background:#534AB7; transform:scale(1.05); }
.inline-mic.mic-active { background:#EF4444; animation:mic-pulse 1s infinite; }
@keyframes mic-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }
.gen-btn { width:100%; padding:10px; background:#7F77DD; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; margin-top:8px; transition:background 0.15s; }
.gen-btn:hover { background:#534AB7; } .gen-btn:disabled { background:#94a3b8; cursor:wait; }
.outputs { padding:8px 14px; flex:1; overflow-y:auto; }
.out-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:8px; }
.out-label { font-size:9px; font-weight:700; color:#7F77DD; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
.out-text { font-size:12px; line-height:1.5; max-height:180px; overflow-y:auto; }
.out-actions { display:flex; gap:6px; margin-top:6px; }
.out-status { font-size:10px; margin-top:4px; min-height:14px; }
.out-action { padding:5px 14px; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s; }
.out-copy { background:#f0f2f5; border:1px solid #dde1e6; color:#475569; } .out-copy:hover { background:#e2e8f0; }
.out-paste, .out-send-email { background:#7F77DD; border:1px solid #6B63C7; color:#fff; } .out-paste:hover, .out-send-email:hover { background:#534AB7; }
.tools-panel { display:flex; flex-direction:column; flex:1; overflow:hidden; }
.tools-header { padding:10px 14px; border-bottom:1px solid #e8eaed; display:flex; align-items:center; gap:8px; }
.back-btn { background:none; border:none; color:#7F77DD; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; } .tools-title { font-size:13px; font-weight:600; }
.tool-tabs { display:flex; border-bottom:1px solid #e8eaed; }
.tool-tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; } .tool-tab-btn.active { color:#7F77DD; border-bottom-color:#7F77DD; }
.tool-content { padding:12px 14px; flex:1; overflow-y:auto; display:none; }
.tool-section { display:flex; flex-direction:column; gap:8px; } .tool-output { padding:8px 0; }
.tool-result { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; font-size:12px; line-height:1.6; margin-top:8px; }
.coach-chips { display:flex; flex-wrap:wrap; gap:4px; } .coach-chip { padding:4px 10px; border-radius:14px; font-size:10px; font-weight:500; font-family:inherit; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; cursor:pointer; } .coach-chip:hover { border-color:#7F77DD; color:#7F77DD; background:#F0EFFF; }
.inline-links { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:8px; } .link-btn { background:none; border:none; color:#7F77DD; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; padding:2px 4px; } .link-btn:hover { text-decoration:underline; } .link-sep { color:#e2e8f0; font-size:11px; }
.ctx-dropzone { border:2px dashed #7F77DD; border-radius:8px; background:#F0EFFF; padding:16px; text-align:center; font-size:11px; color:#7F77DD; display:flex; align-items:center; justify-content:center; min-height:60px; cursor:pointer; } .ctx-dropzone.dragover { background:#e8e4ff; }
.ctx-preview { position:relative; text-align:center; margin-bottom:8px; } .ctx-img { max-width:180px; max-height:100px; border-radius:6px; border:1px solid #e2e8f0; } .ctx-remove { position:absolute; top:-6px; right:calc(50% - 96px); width:18px; height:18px; border-radius:50%; background:#FF3B30; color:#fff; border:none; font-size:11px; cursor:pointer; }
.alert-item { display:flex; align-items:center; padding:6px 8px; background:#FFF7ED; border:1px solid #FBBF24; border-radius:6px; margin-bottom:4px; font-size:11px; gap:6px; } .alert-time { font-size:10px; color:#92400E; margin-left:auto; } .alert-dismiss { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:14px; }
.sidebar-footer { position:sticky; bottom:0; padding:8px 16px; border-top:1px solid #2a2a3e; display:flex; align-items:center; gap:12px; flex-shrink:0; flex-wrap:wrap; background:#1a1a2e; z-index:10; }
.tools-btn { background:rgba(127,119,221,0.15); border:1px solid rgba(127,119,221,0.3); border-radius:6px; padding:4px 10px; font-size:11px; font-weight:600; color:#c4c0f0; cursor:pointer; font-family:inherit; } .tools-btn:hover { background:rgba(127,119,221,0.3); color:#fff; border-color:#7F77DD; }
.tcpa { width:100%; font-size:9px; color:#6b6b8a; line-height:1.3; margin-top:4px; }
/* Settings */
.settings-section { padding:16px 14px; } .settings-label { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; margin-top:12px; }
.settings-options { display:flex; flex-direction:column; gap:6px; position:relative; } .settings-options label { font-size:12px; color:#1a202c; display:flex; align-items:center; gap:6px; } .settings-options input[type="radio"] { accent-color:#7F77DD; }
`;
    }

    // ===== NETWORK INTERCEPTION (VinSolutions) =====
    if (isVinSolutions) {
      try { const script = document.createElement('script'); script.src = browser.runtime.getURL('oper8er-intercept.js'); (document.head || document.documentElement).appendChild(script); script.onload = () => script.remove(); } catch(e) {}
      window.addEventListener('message', (event) => { if (event.data?.type === 'OPER8ER_LEAD_DATA' && event.data?.data?.customerName) { leadData = event.data.data; updateSidebar(); } });
    }
  },
});
