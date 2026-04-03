/**
 * Floq v1.6.1 — Platform fixes, Settings panel, consistent right-side injection.
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
    '*://www.instagram.com/direct/*',
    '*://web.whatsapp.com/*'
  ],
  allFrames: true,
  runAt: 'document_idle',

  main() {
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
    let currentTier = 'floor';

    async function getTier(): Promise<string> {
      try { const resp = await browser.runtime.sendMessage({ type: 'CHECK_FEATURES' }); currentTier = resp?.tier || 'floor'; return currentTier; } catch(e) { return 'floor'; }
    }
    async function isFeatureUnlocked(feature: string): Promise<boolean> {
      try { const resp = await browser.runtime.sendMessage({ type: 'CHECK_FEATURES' }); return resp?.features?.[feature] || false; } catch(e) { return true; }
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
      const vehicle = extractVehicle(text);
      let source = ''; const sm = text.match(/Source:\s*(.+)/i); if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);
      let status = ''; const stm = text.match(/Status:\s*(.+)/i); if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);
      let lastContact = ''; const cm = text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i); if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);
      return { customerName: name, phone, email, vehicle, source, status, lastContact };
    }

    const bodyText = document.body?.innerText || '';
    const isUIFrame = bodyText.length > 2000 || !isVinSolutions;

    if (isVinSolutions) {
      function attemptScan() {
        const t = document.body?.innerText || '';
        if (t.length < 50) return;
        const s = scanText(t);
        if (s.customerName) browser.storage.local.set({ oper8er_lead: s, oper8er_lead_time: Date.now() });
        const v = extractVehicle(t);
        if (v) browser.storage.local.set({ oper8er_vehicle_info: v, oper8er_vehicle_info_time: Date.now() });
      }
      attemptScan();
      let lastScannedName = '';
      setInterval(() => {
        const t = document.body?.innerText || '';
        const nm = t.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/) || t.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
        const curName = nm ? nm[1].trim() : '';
        if (curName && curName !== lastScannedName) { lastScannedName = curName; attemptScan(); }
      }, 2000);
    }

    if (isVinSolutions && isUIFrame) {
      setInterval(async () => {
        try {
          const r = await browser.storage.local.get(['oper8er_lead', 'oper8er_lead_time', 'oper8er_vehicle_info', 'oper8er_vehicle_info_time']);
          const lead = r.oper8er_lead; if (!lead?.customerName) return;
          if (!lead.vehicle && r.oper8er_vehicle_info && r.oper8er_vehicle_info_time > Date.now() - 15000) { lead.vehicle = r.oper8er_vehicle_info; await browser.storage.local.set({ oper8er_lead: lead, oper8er_lead_time: Date.now() }); }
          if (lead.customerName !== leadData?.customerName || lead.vehicle !== leadData?.vehicle) { leadData = lead; updateSidebar(); }
        } catch(e) {}
      }, 2000);
    }

    if (!isVinSolutions && window !== window.top) return;
    if (isVinSolutions && bodyText.length < 500) return;

    // ===== HARD INJECTION GUARD =====
    if (document.getElementById('floq-sidebar')) return;
    if (document.getElementById('oper8er-pill')) return;
    if (document.getElementById('oper8er-host')) return;

    // ===== SIDEBAR WIDTH PER PLATFORM =====
    function getSidebarWidth(): string {
      if (isGmail || isInstagram) return '280px';
      return '300px';
    }

    // ===== PILL =====
    const pill = document.createElement('div');
    pill.id = 'oper8er-pill';
    pill.textContent = '⚡ FQ';
    // FIX 9: ALL platforms on the RIGHT side
    Object.assign(pill.style, {
      position:'fixed', right:'0', top:'50%', transform:'translateY(-50%)', zIndex:'2147483646',
      background:'#7F77DD', color:'#fff', padding:'6px 8px 6px 6px', borderRadius:'6px 0 0 6px',
      fontSize:'11px', fontWeight:'700', fontFamily:'system-ui,sans-serif', cursor:'pointer',
      boxShadow:'0 2px 8px rgba(127,119,221,0.25)', letterSpacing:'0.5px', opacity:'0.85',
      transition:'opacity 0.15s, padding 0.15s'
    });
    pill.onmouseenter = () => { pill.style.opacity = '1'; pill.style.padding = '8px 12px 8px 10px'; pill.textContent = '⚡ Floq'; };
    pill.onmouseleave = () => { pill.style.opacity = '0.85'; pill.style.padding = '6px 8px 6px 6px'; pill.textContent = '⚡ FQ'; };
    pill.onclick = () => { sidebarOpen ? closeSidebar() : openSidebar(); };
    document.body.appendChild(pill);

    // ===== INLINE MIC =====
    function attachInlineMic(shadow: ShadowRoot, inputEl: HTMLTextAreaElement | HTMLInputElement, micBtn: HTMLElement) {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) { micBtn.style.display = 'none'; return; }
      let active = false; let recog: any = null;
      micBtn.onclick = () => {
        if (active) { active = false; if (recog) { recog.onend = null; try { recog.stop(); } catch(e) {} recog = null; } micBtn.classList.remove('mic-active'); return; }
        try {
          recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
          let finalText = '';
          recog.onresult = (e: any) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript; } inputEl.value = finalText + interim; inputEl.dispatchEvent(new Event('input', { bubbles: true })); };
          recog.onerror = () => { active = false; micBtn.classList.remove('mic-active'); showToast(shadow, 'Voice not available — type your message'); };
          recog.onend = () => { if (active) { active = false; micBtn.classList.remove('mic-active'); } };
          recog.start(); active = true; micBtn.classList.add('mic-active');
          setTimeout(() => { if (active) { active = false; micBtn.classList.remove('mic-active'); if (recog) { try { recog.stop(); } catch(e) {} recog = null; } } }, 10000);
        } catch(e) { micBtn.style.display = 'none'; showToast(shadow, 'Voice not available — type your message'); }
      };
    }

    function showToast(shadow: ShadowRoot, msg: string) {
      const existing = shadow.getElementById('floq-toast'); if (existing) existing.remove();
      const toast = document.createElement('div'); toast.id = 'floq-toast'; toast.textContent = msg;
      Object.assign(toast.style, { position:'fixed', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:'#1a202c', color:'#fff', padding:'8px 16px', borderRadius:'6px', fontSize:'11px', fontWeight:'500', zIndex:'99', opacity:'1', transition:'opacity 0.3s' });
      shadow.getElementById('o8')?.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
    }

    // ===== VIN MAIN CONTAINER for margin push =====
    function getVinMainContainer(): HTMLElement | null {
      if (!isVinSolutions) return null;
      return document.querySelector('#mainAreaPanel') as HTMLElement
        || document.querySelector('.main-content') as HTMLElement
        || document.querySelector('#page-content') as HTMLElement
        || document.querySelector('body') as HTMLElement;
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
      // FIX 1 + FIX 9: Always right side, fixed position
      Object.assign(host.style, { position:'fixed', top:'0', right:'0', width: w, height:'100vh', zIndex:'2147483647' });

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

      // Settings link → open settings panel
      const settingsBtn = s.getElementById('o8-settings-btn');
      const settingsPanel = s.getElementById('o8-settings-panel');
      const settingsBack = s.getElementById('o8-settings-back');
      if (settingsBtn && settingsPanel) {
        settingsBtn.onclick = () => { s.getElementById('o8-quick')!.style.display = 'none'; s.getElementById('o8-tools-panel')!.style.display = 'none'; settingsPanel.style.display = 'flex'; };
      }
      if (settingsBack) {
        settingsBack.onclick = () => { settingsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; };
      }

      // FIX 7: Settings tone/goal radio buttons (Command+ only)
      if (currentTier !== 'floor') {
        s.querySelectorAll('input[name="floq-tone"]').forEach(radio => {
          radio.addEventListener('change', () => { browser.storage.local.set({ floq_tone: (radio as HTMLInputElement).value }); });
        });
        s.querySelectorAll('input[name="floq-goal"]').forEach(radio => {
          radio.addEventListener('change', () => { browser.storage.local.set({ floq_goal: (radio as HTMLInputElement).value }); });
        });
        // Load saved values
        browser.storage.local.get(['floq_tone', 'floq_goal']).then(r => {
          if (r.floq_tone) { const el = s.querySelector(`input[name="floq-tone"][value="${r.floq_tone}"]`) as HTMLInputElement; if (el) el.checked = true; }
          if (r.floq_goal) { const el = s.querySelector(`input[name="floq-goal"][value="${r.floq_goal}"]`) as HTMLInputElement; if (el) el.checked = true; }
        });
      }

      // Tools panel
      const toolsBtn = s.getElementById('o8-tools-btn');
      const toolsPanel = s.getElementById('o8-tools-panel');
      const toolsBack = s.getElementById('o8-tools-back');
      if (toolsBtn && toolsPanel) { toolsBtn.onclick = () => { s.getElementById('o8-quick')!.style.display = 'none'; toolsPanel.style.display = 'flex'; }; }
      if (toolsBack) { toolsBack.onclick = () => { toolsPanel!.style.display = 'none'; s.getElementById('o8-quick')!.style.display = 'flex'; }; }

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
          if (currentTier === 'floor') return;
          const input = coachInput?.value.trim(); if (!input) return;
          coachBtn.textContent = 'Thinking...'; (coachBtn as any).disabled = true;
          try {
            const resp = await browser.runtime.sendMessage({ type: 'COACH_ME', payload: { situation: input, vehicleContext: leadData?.vehicle || '' } });
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
          await browser.runtime.sendMessage({ type: 'SET_ALERT', payload: { task: input, alertTime: parseAlertTime(input) } });
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
            const resp = await browser.runtime.sendMessage({ type: 'EXECUTE_COMMAND', payload: { command: input, currentUrl: window.location.href, vehicleContext: leadData?.vehicle || '' } });
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
      if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e: any) => { e.preventDefault(); dropZone.classList.remove('dragover'); const f = e.dataTransfer?.files?.[0]; if (f?.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => { contextImage = r.result as string; if (ctxImg) ctxImg.src = contextImage; if (ctxPreview) ctxPreview.style.display = 'block'; if (dropZone) dropZone.style.display = 'none'; updCtx(); }; r.readAsDataURL(f); } });
      }
      if (s.getElementById('o8-ctx-remove')) s.getElementById('o8-ctx-remove')!.addEventListener('click', () => { contextImage = null; if (ctxPreview) ctxPreview.style.display = 'none'; if (dropZone) dropZone.style.display = 'flex'; updCtx(); });
      if (ctxDir) ctxDir.addEventListener('input', updCtx);
      if (ctxGen) {
        ctxGen.addEventListener('click', async () => {
          if (!contextImage || !ctxDir?.value.trim()) return;
          ctxGen.textContent = 'Analyzing...'; ctxGen.disabled = true; if (ctxOut) ctxOut.innerHTML = '';
          try { const resp = await browser.runtime.sendMessage({ type: 'CONTEXT_REPLY', payload: { image: contextImage, direction: ctxDir.value.trim() } }); if (resp.error) addOutput(s, 'Error', resp.error, 'o8-ctx-output'); else addOutput(s, 'REPLY', resp.reply || resp.raw || '', 'o8-ctx-output'); } catch(e: any) { addOutput(s, 'Error', e.message, 'o8-ctx-output'); }
          ctxGen.textContent = 'Generate Reply'; ctxGen.disabled = false; updCtx();
        });
      }

      if (isVinSolutions) updateSidebar();
    }

    function pushContent(open: boolean) {
      const w = getSidebarWidth();
      if (isVinSolutions) {
        const main = getVinMainContainer();
        if (main) main.style.marginRight = open ? w : '0';
      }
      if (isGmail) {
        const gmailMain = document.querySelector('.nH') as HTMLElement;
        if (gmailMain) gmailMain.style.marginRight = open ? w : '0';
      }
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
        s.getElementById('o8-name')!.textContent = leadData.customerName;
        s.getElementById('o8-vehicle')!.textContent = leadData.vehicle || 'No vehicle detected';
        let meta = '';
        if (leadData.phone) meta += leadData.phone;
        if (leadData.email) meta += (meta ? ' · ' : '') + leadData.email;
        if (leadData.source) meta += (meta ? ' · ' : '') + leadData.source;
        s.getElementById('o8-meta')!.textContent = meta;
      } else card.style.display = 'none';
    }

    // ===== GENERATE =====
    async function doGenerate(s: ShadowRoot) {
      if (isGenerating) return; isGenerating = true;
      if (isGmail || isFacebook || isLinkedIn || isInstagram) {
        const featureKey = isGmail ? 'gmail' : isFacebook ? 'facebook' : isInstagram ? 'facebook' : 'linkedin';
        if (!(await isFeatureUnlocked(featureKey))) { const out = s.getElementById('o8-outputs'); if (out) out.innerHTML = '<div class="gate-card">Cross-platform available in Floq Command. Contact yancy@yenes.ai</div>'; isGenerating = false; return; }
      }
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
        const response = await browser.runtime.sendMessage({
          type: 'GENERATE_OUTPUT',
          payload: { type, leadContext: leadData || {}, repInput: input, repName: '', dealership: '', platform: PLATFORM, tone, goal,
            metadata: { workflow_type: type === 'all' ? 'all' : type, customer_name: leadData?.customerName || null, vehicle: leadData?.vehicle || null, email: leadData?.email || null } }
        });
        if (response.error) addOutput(s, 'Error', response.error);
        else { const sec = response.sections; if (selected.includes('text') && sec.text) addOutput(s, outputLabels.text, sec.text); if (selected.includes('email') && sec.email) addOutput(s, outputLabels.email, sec.email); if (selected.includes('crm') && sec.crm) addOutput(s, outputLabels.crm, sec.crm); if (!sec.text && !sec.email && !sec.crm) addOutput(s, 'OUTPUT', response.text || 'Generation returned empty.'); }
      } catch (e: any) { addOutput(s, 'Error', e.message); }
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
      else { statusEl.textContent = 'Staged — auto-pastes when form loads'; statusEl.style.color = '#2563eb'; }
    }

    function addOutput(s: ShadowRoot, label: string, content: string, containerId: string = 'o8-outputs') {
      const container = s.getElementById(containerId) || s.getElementById('o8-outputs')!;
      const card = document.createElement('div'); card.className = 'out-card';
      const isCRM = label === 'CRM NOTE';
      card.innerHTML = `<div class="out-label">${esc(label)}</div><div class="out-text">${esc(content).replace(/\n/g, '<br>')}</div><div class="out-actions"><button class="out-copy">Copy</button>${isCRM && isVinSolutions ? '<button class="out-paste">Paste to CRM</button>' : ''}</div>${isCRM && isVinSolutions ? '<div class="out-paste-status"></div>' : ''}`;
      card.querySelector('.out-copy')!.addEventListener('click', function(this: HTMLElement) { navigator.clipboard.writeText(content); this.textContent = 'Copied'; this.style.background = '#16a34a'; this.style.color = '#fff'; setTimeout(() => { this.textContent = 'Copy'; this.style.background = ''; this.style.color = ''; }, 1500); });
      if (isCRM && isVinSolutions) card.querySelector('.out-paste')!.addEventListener('click', function(this: HTMLElement) { const st = card.querySelector('.out-paste-status') as HTMLElement; (this as any).disabled = true; this.textContent = 'Pasting...'; pasteIntoCRM(content, st).then(() => { this.textContent = 'Paste to CRM'; (this as any).disabled = false; }); });
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

    async function loadAlerts(s: ShadowRoot) { const alerts = await browser.runtime.sendMessage({ type: 'GET_ALERTS' }); const list = s.getElementById('o8-alert-list'); if (!list) return; if (!alerts || alerts.length === 0) { list.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:12px">No active reminders</div>'; return; } list.innerHTML = alerts.map((a: any) => `<div class="alert-item"><span>${esc(a.task)}</span><span class="alert-time">${new Date(a.alertTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="alert-dismiss" data-id="${a.id}">&times;</button></div>`).join(''); list.querySelectorAll('.alert-dismiss').forEach(btn => { btn.addEventListener('click', async () => { const id = (btn as HTMLElement).dataset.id; if (id) { await browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id } }); loadAlerts(s); } }); }); }

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

    const GATE_CARD = `<div class="gate-card"><div class="gate-icon">🔒</div><div class="gate-title">Available in Floq Command</div><div class="gate-text">Upgrade to unlock Coach, Voice, and Screenshot mode.</div><div class="gate-contact">Contact yancy@yenes.ai</div></div>`;

    // ===== FIX 7: SETTINGS HTML =====
    function getSettingsHTML(): string {
      if (currentTier === 'floor') {
        return `<div class="settings-section">
          <div class="settings-label">Tone</div>
          <div class="settings-options locked"><label><input type="radio" disabled checked> Professional</label><label><input type="radio" disabled> Friendly</label><label><input type="radio" disabled> Casual</label><label><input type="radio" disabled> Direct</label><div class="lock-overlay">🔒 Available in Floq Command</div></div>
          <div class="settings-label">Goal</div>
          <div class="settings-options locked"><label><input type="radio" disabled checked> Close the deal</label><label><input type="radio" disabled> Book appointment</label><label><input type="radio" disabled> Gather info</label><label><input type="radio" disabled> Nurture long-term</label><div class="lock-overlay">🔒 Available in Floq Command</div></div>
          <div class="upgrade-banner">Upgrade to Floq Command at $4,999/mo to customize your AI's tone and goals.<br><strong>Contact yancy@yenes.ai</strong></div>
        </div>`;
      }
      return `<div class="settings-section">
        <div class="settings-label">Tone</div>
        <div class="settings-options"><label><input type="radio" name="floq-tone" value="professional" checked> Professional</label><label><input type="radio" name="floq-tone" value="friendly"> Friendly</label><label><input type="radio" name="floq-tone" value="casual"> Casual</label><label><input type="radio" name="floq-tone" value="direct"> Direct</label></div>
        <div class="settings-label">Goal</div>
        <div class="settings-options"><label><input type="radio" name="floq-goal" value="close_deal" checked> Close the deal</label><label><input type="radio" name="floq-goal" value="book_appointment"> Book appointment</label><label><input type="radio" name="floq-goal" value="gather_info"> Gather info</label><label><input type="radio" name="floq-goal" value="nurture"> Nurture long-term</label></div>
      </div>`;
    }

    function getHTML(): string {
      const badge = getBadge();
      const isFloor = currentTier === 'floor';
      const customerCard = isVinSolutions ? `<div id="o8-card" class="card" style="display:none"><div id="o8-name" class="name"></div><div id="o8-vehicle" class="vehicle"></div><div id="o8-meta" class="meta"></div></div>` : '';
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
  <div id="tool-coach" class="tool-content" style="display:block">${isFloor ? GATE_CARD : `<div class="tool-section"><div class="input-wrap"><textarea id="o8-coach-input" class="main-input" placeholder="What did the customer just say?" rows="2"></textarea><button id="o8-coach-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><div class="coach-chips"><button class="coach-chip">Need to think about it</button><button class="coach-chip">Price too high</button><button class="coach-chip">Bad credit</button><button class="coach-chip">Spouse not here</button></div><button id="o8-coach-btn" class="gen-btn">Coach Me</button></div><div id="o8-coach-output" class="tool-output"></div>`}</div>
  <div id="tool-alerts" class="tool-content" style="display:none"><div class="tool-section"><div class="input-wrap"><input id="o8-alert-input" class="main-input" placeholder="e.g. Move the Tacoma by noon" /><button id="o8-alert-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-alert-btn" class="gen-btn" style="background:#FF9500">Set Alert</button></div><div id="o8-alert-list" class="tool-output"></div></div>
  <div id="tool-context" class="tool-content" style="display:none">${isFloor ? GATE_CARD : `<div class="tool-section"><div id="o8-ctx-dropzone" class="ctx-dropzone"><span>Drop screenshot or paste (Ctrl+V)</span></div><div id="o8-ctx-preview" class="ctx-preview" style="display:none"><img id="o8-ctx-img" class="ctx-img" /><button id="o8-ctx-remove" class="ctx-remove">&times;</button></div><textarea id="o8-ctx-direction" class="main-input" placeholder="What do you want to say?" rows="2"></textarea><button id="o8-ctx-generate" class="gen-btn" disabled>Generate Reply</button></div><div id="o8-ctx-output" class="tool-output"></div>`}</div>
  <div id="tool-command" class="tool-content" style="display:none">${isFloor ? GATE_CARD : `<div class="tool-section"><div class="input-wrap"><textarea id="o8-cmd-input" class="main-input" placeholder="Type a command..." rows="2"></textarea><button id="o8-cmd-mic" class="inline-mic" title="Tap to dictate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></button></div><button id="o8-cmd-execute" class="gen-btn">Execute</button></div><div id="o8-cmd-status" class="tool-output"></div>`}</div>
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
#o8 { width:${width}; height:100vh; background:#fff; border-left:1px solid #e2e8f0; overflow-y:auto; overscroll-behavior:contain; box-shadow:-4px 0 16px rgba(0,0,0,0.06); display:flex; flex-direction:column; }
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
.out-copy { padding:4px 12px; background:#f0f2f5; border:1px solid #dde1e6; border-radius:4px; font-size:11px; font-weight:600; color:#475569; cursor:pointer; font-family:inherit; } .out-copy:hover { background:#e2e8f0; }
.out-paste { padding:4px 12px; background:#2563eb; border:1px solid #1d4ed8; border-radius:4px; font-size:11px; font-weight:600; color:#fff; cursor:pointer; font-family:inherit; } .out-paste:hover { background:#1d4ed8; }
.out-paste-status { font-size:10px; margin-top:4px; min-height:14px; }
.tools-panel { display:flex; flex-direction:column; flex:1; overflow:hidden; }
.tools-header { padding:10px 14px; border-bottom:1px solid #e8eaed; display:flex; align-items:center; gap:8px; }
.back-btn { background:none; border:none; color:#7F77DD; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; } .tools-title { font-size:13px; font-weight:600; }
.tool-tabs { display:flex; border-bottom:1px solid #e8eaed; }
.tool-tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; } .tool-tab-btn.active { color:#7F77DD; border-bottom-color:#7F77DD; }
.tool-content { padding:12px 14px; flex:1; overflow-y:auto; display:none; }
.tool-section { display:flex; flex-direction:column; gap:8px; } .tool-output { padding:8px 0; }
.tool-result { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; font-size:12px; line-height:1.6; margin-top:8px; }
.coach-chips { display:flex; flex-wrap:wrap; gap:4px; } .coach-chip { padding:4px 10px; border-radius:14px; font-size:10px; font-weight:500; font-family:inherit; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; cursor:pointer; } .coach-chip:hover { border-color:#7F77DD; color:#7F77DD; background:#F0EFFF; }
.gate-card { text-align:center; padding:24px 16px; } .gate-icon { font-size:24px; margin-bottom:8px; } .gate-title { font-size:14px; font-weight:700; margin-bottom:4px; } .gate-text { font-size:12px; color:#64748b; line-height:1.5; margin-bottom:8px; } .gate-contact { font-size:11px; color:#7F77DD; font-weight:600; }
.ctx-dropzone { border:2px dashed #7F77DD; border-radius:8px; background:#F0EFFF; padding:16px; text-align:center; font-size:11px; color:#7F77DD; display:flex; align-items:center; justify-content:center; min-height:60px; cursor:pointer; } .ctx-dropzone.dragover { background:#e8e4ff; }
.ctx-preview { position:relative; text-align:center; margin-bottom:8px; } .ctx-img { max-width:180px; max-height:100px; border-radius:6px; border:1px solid #e2e8f0; } .ctx-remove { position:absolute; top:-6px; right:calc(50% - 96px); width:18px; height:18px; border-radius:50%; background:#FF3B30; color:#fff; border:none; font-size:11px; cursor:pointer; }
.alert-item { display:flex; align-items:center; padding:6px 8px; background:#FFF7ED; border:1px solid #FBBF24; border-radius:6px; margin-bottom:4px; font-size:11px; gap:6px; } .alert-time { font-size:10px; color:#92400E; margin-left:auto; } .alert-dismiss { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:14px; }
.sidebar-footer { padding:8px 14px; border-top:1px solid #e8eaed; display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap:wrap; }
.tools-btn { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:600; color:#64748b; cursor:pointer; font-family:inherit; } .tools-btn:hover { background:#F0EFFF; color:#7F77DD; border-color:#7F77DD; }
.tcpa { width:100%; font-size:9px; color:#9CA3AF; line-height:1.3; margin-top:4px; }
/* Settings */
.settings-section { padding:16px 14px; } .settings-label { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; margin-top:12px; }
.settings-options { display:flex; flex-direction:column; gap:6px; position:relative; } .settings-options label { font-size:12px; color:#1a202c; display:flex; align-items:center; gap:6px; } .settings-options input[type="radio"] { accent-color:#7F77DD; }
.settings-options.locked { opacity:0.5; pointer-events:none; } .lock-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:600; color:#7F77DD; pointer-events:auto; opacity:1; }
.upgrade-banner { margin-top:16px; padding:12px; background:#F0EFFF; border:1px solid #7F77DD; border-radius:8px; font-size:11px; color:#534AB7; line-height:1.5; text-align:center; }
`;
    }

    // ===== NETWORK INTERCEPTION (VinSolutions) =====
    if (isVinSolutions && isUIFrame) {
      try { const script = document.createElement('script'); script.src = browser.runtime.getURL('oper8er-intercept.js'); (document.head || document.documentElement).appendChild(script); script.onload = () => script.remove(); } catch(e) {}
      window.addEventListener('message', (event) => { if (event.data?.type === 'OPER8ER_LEAD_DATA' && event.data?.data?.customerName) { leadData = event.data.data; updateSidebar(); } });
    }
  },
});
