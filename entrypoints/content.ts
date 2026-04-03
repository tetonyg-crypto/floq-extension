/**
 * Oper8er — Universal Content Script
 * Runs on every website. Context-aware: auto-scans on VinSolutions, manual input everywhere else.
 * Platform-adaptive output labels. Logs detected platform to Supabase.
 */

import './content/styles.css';

export default defineContentScript({
  matches: [
    '*://*.vinsolutions.com/*',
    '*://*.coxautoinc.com/*',
    '*://www.facebook.com/*',
    '*://mail.google.com/*',
    '*://www.linkedin.com/*'
  ],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    // ===== PLATFORM DETECTION =====
    const hostname = window.location.hostname || '';
    const isVinSolutions = hostname.includes('vinsolutions') || hostname.includes('coxautoinc');
    const isGmail = hostname === 'mail.google.com';
    const isOutlook = hostname.includes('outlook.live.com') || hostname.includes('outlook.office');
    const isFacebook = hostname.includes('facebook.com');
    const isLinkedIn = hostname.includes('linkedin.com');

    function detectPlatform(): string {
      if (isVinSolutions) return 'vinsolutions';
      if (isGmail) return 'gmail';
      if (isOutlook) return 'outlook';
      if (isFacebook) return 'facebook';
      if (isLinkedIn) return 'linkedin';
      return 'other';
    }

    function getOutputLabels(): { text: string; email: string; crm: string } {
      if (isVinSolutions) return { text: 'TEXT MESSAGE', email: 'EMAIL', crm: 'CRM NOTE' };
      if (isGmail || isOutlook) return { text: 'REPLY', email: 'EMAIL REPLY', crm: 'NOTE' };
      if (isFacebook) return { text: 'MESSAGE REPLY', email: 'EMAIL', crm: 'NOTE' };
      if (isLinkedIn) return { text: 'LINKEDIN REPLY', email: 'EMAIL', crm: 'NOTE' };
      return { text: 'REPLY', email: 'EMAIL', crm: 'NOTE' };
    }

    const platform = detectPlatform();
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
                textarea.focus();
                textarea.value = r.oper8er_paste_note;
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

    // Feature gating helper — shows upgrade message in output area
    async function checkFeatureGate(feature: string, outputEl: HTMLElement): Promise<boolean> {
      try {
        const resp = await browser.runtime.sendMessage({ type: 'CHECK_FEATURES' });
        const features = resp?.features || {};
        if (features[feature]) return true;

        // Show gated message
        if (feature === 'gm_dashboard') {
          outputEl.innerHTML = '<div style="padding:14px;background:#F0EFFF;border:1px solid #7F77DD;border-radius:8px;margin:8px 14px;font-size:12px;line-height:1.6;color:#534AB7">Floor insights are available in Floq Command. Ask your GM to upgrade at floqsales.com</div>';
        } else if (feature === 'voice_coach' || feature === 'command_mode') {
          outputEl.innerHTML = '<div style="padding:14px;background:#F0EFFF;border:1px solid #7F77DD;border-radius:8px;margin:8px 14px;font-size:12px;line-height:1.6;color:#534AB7">This feature is available in Floq Command starting at $4,999/mo. Talk to your account manager.</div>';
        } else if (feature === 'facebook' || feature === 'gmail' || feature === 'linkedin') {
          outputEl.innerHTML = '<div style="padding:14px;background:#F0EFFF;border:1px solid #7F77DD;border-radius:8px;margin:8px 14px;font-size:12px;line-height:1.6;color:#534AB7">Cross-platform generation is available in Floq Command starting at $4,999/mo. Talk to your account manager.</div>';
        }
        return false;
      } catch(e) { return true; } // Fail open so demo doesn't break
    }

    // ===== VINSOLUTIONS AUTO-SCAN (only runs on VinSolutions domains) =====
    const MAKES = 'Chevrolet|Chevy|Subaru|Toyota|Ford|Ram|Dodge|Jeep|GMC|Honda|Nissan|Hyundai|Kia|BMW|Mercedes|Buick|Cadillac|Lexus|Acura|Audi|Volvo|Mazda|Chrysler|Lincoln|Infiniti|Volkswagen|VW|Porsche|Tesla|Rivian';
    const STOP_WORDS = 'Created|Attempted|Contacted|Looking|Wants|Also|Stock|Source|Status|miles|General|Customer|Interested|Trade|lineup|options|inventory|Calculated|Equity|Payoff|hover|details|Bad|Sold|Active|Lost';
    const POISON_BEFORE = /(?:Equity|Payoff|Trade-in|trade\s+value|Credit)\b[\s\S]{0,50}$/i;
    const POISON_AFTER = /^[\s\S]{0,20}(?:Calculated|Payoff|payoff|appraised)/i;

    function isPoisoned(text: string, matchIndex: number, matchLength: number): boolean {
      const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
      const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 40);
      return POISON_BEFORE.test(before) || POISON_AFTER.test(after);
    }

    function extractVehicle(text: string): string {
      let vehicle = '';
      const vi = text.match(new RegExp('Vehicle Info[\\s\\n]+(20\\d{2}\\s+(?:' + MAKES + ')\\s+[^\\n(]+?)\\s*(?:\\(|\\n|$)', 'i'));
      if (vi) vehicle = vi[1].trim().replace(/\s+/g, ' ').slice(0, 50);
      if (!vehicle) {
        const activeMatch = text.match(new RegExp('Active\\t[\\s\\S]{0,80}?(20\\d{2}\\s+(?:' + MAKES + ')[^\\t\\n]*)', 'i'));
        if (activeMatch) {
          let v = activeMatch[1].trim().replace(/\s+/g, ' ');
          v = v.replace(new RegExp('\\s+(?:' + STOP_WORDS + ')\\b.*', 'i'), '');
          vehicle = v.slice(0, 50);
        }
      }
      if (!vehicle) {
        const allMatches = text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + ')(?:\\s+(?!(?:' + STOP_WORDS + ')\\b)[A-Za-z0-9./-]+){0,5})', 'gi'));
        for (const m of allMatches) {
          if (isPoisoned(text, m.index!, m[0].length)) continue;
          vehicle = m[1].trim().replace(/\s+/g, ' ').slice(0, 50);
          break;
        }
      }
      if (!vehicle) {
        const allMakes = text.matchAll(new RegExp('(20\\d{2}\\s+(?:' + MAKES + '))', 'gi'));
        for (const m of allMakes) {
          if (isPoisoned(text, m.index!, m[0].length)) continue;
          vehicle = m[1].trim().slice(0, 40);
          break;
        }
      }
      if (!vehicle) {
        const sv = text.match(/(?:Stock\s*#|Vehicle)\s*:?\s*[\s\S]{0,30}?(20\d{2}\s+\w+\s+[\w-]+)/i);
        if (sv) vehicle = sv[1].trim().slice(0, 50);
      }
      if (vehicle) vehicle = vehicle.replace(/[.,;:!]+$/, '').trim();
      return vehicle;
    }

    function scanText(text: string): any {
      let name = '';
      const dm = text.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/);
      if (dm) name = dm[1].trim();
      if (!name) { const im = text.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/); if (im) name = im[1].trim(); }
      let phone = '';
      const pm = text.match(/[CHW]:\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      if (pm) phone = pm[0].replace(/^[CHW]:\s*/, '');
      let email = '';
      const em = text.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
      if (em) email = em[0];
      const vehicle = extractVehicle(text);
      let source = '';
      const sm = text.match(/Source:\s*(.+)/i);
      if (sm) source = sm[1].trim().split('\n')[0].slice(0, 50);
      let status = '';
      const stm = text.match(/Status:\s*(.+)/i);
      if (stm) status = stm[1].trim().split('\n')[0].slice(0, 30);
      let lastContact = '';
      const cm = text.match(/Attempted:\s*(.+)/i) || text.match(/Contacted:\s*(.+)/i) || text.match(/Created:\s*(.+)/i);
      if (cm) lastContact = cm[1].trim().split('\n')[0].slice(0, 30);
      return { customerName: name, phone, email, vehicle, source, status, lastContact };
    }

    // ===== FRAME ROLE DETECTION =====
    const bodyText = document.body?.innerText || '';
    const isUIFrame = bodyText.length > 2000 || !isVinSolutions; // Non-VIN pages are always the UI frame

    // ===== VINSOLUTIONS AUTO-SCAN (conditional) =====
    if (isVinSolutions) {
      function attemptScan() {
        const t = document.body?.innerText || '';
        if (t.length < 50) return;
        const s = scanText(t);
        if (s.customerName) {
          browser.storage.local.set({ oper8er_lead: s, oper8er_lead_time: Date.now() });
        }
        const v = extractVehicle(t);
        if (v) {
          browser.storage.local.set({ oper8er_vehicle_info: v, oper8er_vehicle_info_time: Date.now() });
        }
      }
      attemptScan();
      let lastScannedName = '';
      setInterval(() => {
        const t = document.body?.innerText || '';
        const nm = t.match(/Customer Dashboard\s*\n([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+)/) ||
                   t.match(/([A-Z][a-zA-Z'-]+ [A-Z][a-zA-Z'-]+(?:\s[A-Z][a-zA-Z'-]+)?)\s*\n\s*\((?:Individual|Business)\)/);
        const curName = nm ? nm[1].trim() : '';
        if (curName && curName !== lastScannedName) { lastScannedName = curName; attemptScan(); }
      }, 2000);
    }

    // ===== VEHICLE MERGE + SIDEBAR UPDATE (VinSolutions) =====
    if (isVinSolutions && isUIFrame) {
      setInterval(async () => {
        try {
          const r = await browser.storage.local.get(['oper8er_lead', 'oper8er_lead_time', 'oper8er_vehicle_info', 'oper8er_vehicle_info_time']);
          const lead = r.oper8er_lead;
          if (!lead?.customerName) return;
          if (!lead.vehicle && r.oper8er_vehicle_info && r.oper8er_vehicle_info_time > Date.now() - 15000) {
            lead.vehicle = r.oper8er_vehicle_info;
            await browser.storage.local.set({ oper8er_lead: lead, oper8er_lead_time: Date.now() });
          }
          if (lead.customerName !== leadData?.customerName || lead.vehicle !== leadData?.vehicle) {
            leadData = lead;
            updateSidebar();
          }
        } catch(e) {}
      }, 2000);
    }

    // On non-VinSolutions pages with iframes: only inject pill in the TOP frame
    if (!isVinSolutions && window !== window.top) return;
    // On VinSolutions: skip tiny utility iframes
    if (isVinSolutions && bodyText.length < 500) return;

    // ===== PILL BUTTON (UNIVERSAL) =====
    // Skip if pill already exists (prevents duplicates in iframe-heavy pages)
    if (document.getElementById('oper8er-pill')) return;

    const pill = document.createElement('div');
    pill.id = 'oper8er-pill';
    pill.textContent = '⚡ FQ';
    Object.assign(pill.style, {
      position:'fixed', right:'0', top:'50%', transform:'translateY(-50%)', zIndex:'2147483646',
      background:'#7F77DD', color:'#fff', padding:'6px 8px 6px 6px', borderRadius:'6px 0 0 6px',
      fontSize:'11px', fontWeight:'700', fontFamily:'system-ui,sans-serif', cursor:'pointer',
      boxShadow:'0 2px 8px rgba(37,99,235,0.25)', letterSpacing:'0.5px', opacity:'0.85',
      transition:'opacity 0.15s, padding 0.15s'
    });
    pill.onmouseenter = () => { pill.style.opacity = '1'; pill.style.padding = '8px 12px 8px 10px'; pill.textContent = '⚡ Floq'; };
    pill.onmouseleave = () => { pill.style.opacity = '0.85'; pill.style.padding = '6px 8px 6px 6px'; pill.textContent = '⚡ FQ'; };
    pill.onclick = () => { sidebarOpen ? closeSidebar() : openSidebar(); };
    document.body.appendChild(pill);

    // ===== SIDEBAR =====
    async function openSidebar() {
      // Onboarding gate: if no profile exists, open onboarding page
      try {
        const check = await browser.storage.sync.get(['profile_onboarded']);
        if (!check.profile_onboarded) {
          // Must open via background script — Chrome blocks extension pages opened from content scripts
          browser.runtime.sendMessage({ type: 'OPEN_ONBOARDING' });
          return;
        }
      } catch(e) {}

      if (sidebarRoot) { sidebarRoot.style.display = 'block'; sidebarOpen = true; return; }

      // Prevent double sidebar — check DOM for existing host from another frame's content script
      if (document.getElementById('oper8er-host')) { return; }

      const host = document.createElement('div');
      host.id = 'oper8er-host';
      Object.assign(host.style, { position:'fixed',top:'0',right:'0',width:'320px',height:'100vh',zIndex:'2147483647' });

      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);

      const container = document.createElement('div');
      container.id = 'o8';
      container.innerHTML = isVinSolutions ? HTML_VINSOLUTIONS : HTML_UNIVERSAL;
      shadow.appendChild(container);

      document.body.appendChild(host);
      sidebarRoot = host;
      sidebarOpen = true;

      const s = shadow;
      s.getElementById('o8-close')!.onclick = closeSidebar;
      s.getElementById('o8-generate')!.onclick = () => doGenerate(s);

      s.querySelectorAll('.chip').forEach(c => {
        c.addEventListener('click', () => c.classList.toggle('on'));
      });

      // Settings link
      const settingsLink = s.getElementById('o8-settings');
      if (settingsLink) {
        settingsLink.addEventListener('click', () => {
          browser.runtime.openOptionsPage();
        });
      }

      // Voice input
      let voiceActive = false;
      let recognition: any = null;
      s.getElementById('o8-mic')!.onclick = () => {
        if (voiceActive) {
          voiceActive = false;
          if (recognition) { recognition.onend = null; try { recognition.stop(); } catch(e) {} recognition = null; }
          const mic = s.getElementById('o8-mic')!;
          mic.style.borderColor = '#e2e8f0'; mic.style.background = '#f8fafc';
          return;
        }
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SR) {
          try {
            recognition = new SR();
            recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
            let finalText = '';
            recognition.onresult = (e: any) => {
              let interim = '';
              for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
                else interim += e.results[i][0].transcript;
              }
              (s.getElementById('o8-input') as HTMLTextAreaElement).value = finalText + interim;
            };
            recognition.onerror = (e: any) => {
              if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                voiceActive = false;
                const mic = s.getElementById('o8-mic')!;
                mic.style.borderColor = '#e2e8f0'; mic.style.background = '#f8fafc';
                openVoicePopup(s);
              }
            };
            recognition.onend = () => { if (voiceActive) try { recognition.start(); } catch(e) {} };
            recognition.start(); voiceActive = true;
            const mic = s.getElementById('o8-mic')!;
            mic.style.borderColor = '#dc2626'; mic.style.background = '#fef2f2';
            return;
          } catch(e) {}
        }
        openVoicePopup(s);
      };

      function openVoicePopup(shadow: ShadowRoot) {
        const voiceUrl = browser.runtime.getURL('voice.html');
        window.open(voiceUrl, 'oper8er_voice', 'width=380,height=300,top=200,left=200');
        const poll = setInterval(async () => {
          try {
            const r = await browser.storage.local.get(['oper8er_voice', 'oper8er_voice_time']);
            if (r.oper8er_voice && r.oper8er_voice_time > Date.now() - 30000) {
              (shadow.getElementById('o8-input') as HTMLTextAreaElement).value = r.oper8er_voice;
              await browser.storage.local.remove(['oper8er_voice', 'oper8er_voice_time']);
              clearInterval(poll);
            }
          } catch(e) {}
        }, 500);
        setTimeout(() => clearInterval(poll), 60000);
      }

      s.getElementById('o8-input')!.addEventListener('keydown', (e: any) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doGenerate(s); }
      });

      // ===== TAB SWITCHING =====
      s.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tab = (btn as HTMLElement).dataset.tab!;

          // Feature gate: coach and command require Floq Command tier
          if (tab === 'coach') {
            const outputEl = s.getElementById('o8-coach-output');
            if (outputEl && !(await checkFeatureGate('voice_coach', outputEl))) {
              s.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
              s.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
              btn.classList.add('active');
              s.getElementById('tab-coach')?.classList.add('active');
              return;
            }
          }
          if (tab === 'command') {
            const outputEl = s.getElementById('o8-cmd-output') || s.getElementById('tab-command');
            if (outputEl && !(await checkFeatureGate('command_mode', outputEl))) {
              s.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
              s.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
              btn.classList.add('active');
              s.getElementById('tab-command')?.classList.add('active');
              return;
            }
          }

          s.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          s.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          s.getElementById('tab-' + tab)?.classList.add('active');
          if (tab === 'alerts') loadAlerts(s);
        });
      });

      // ===== COACH CHIPS =====
      s.querySelectorAll('.coach-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const ta = s.getElementById('o8-coach-input') as HTMLTextAreaElement;
          if (ta) ta.value = chip.textContent || '';
        });
      });

      // ===== COACH BUTTON =====
      const coachBtn = s.getElementById('o8-coach-btn');
      if (coachBtn) {
        coachBtn.addEventListener('click', async () => {
          const input = (s.getElementById('o8-coach-input') as HTMLTextAreaElement)?.value.trim();
          if (!input) return;
          coachBtn.textContent = 'Thinking...'; (coachBtn as any).disabled = true; coachBtn.style.background = '#94a3b8';
          try {
            const resp = await browser.runtime.sendMessage({
              type: 'COACH_ME',
              payload: { situation: input, vehicleContext: leadData?.vehicle || '' }
            });
            const output = s.getElementById('o8-coach-output')!;
            if (resp.error) {
              output.innerHTML = '<div class="coach-direction"><div class="coach-label">ERROR</div><div class="coach-text">' + esc(resp.error) + '</div></div>';
            } else {
              output.innerHTML = '<div class="coach-direction"><div class="coach-label">YOUR NEXT MOVE:</div><div class="coach-text">' + esc(resp.coaching).replace(/\n/g, '<br>') + '</div></div>';
            }
          } catch(e: any) {
            s.getElementById('o8-coach-output')!.innerHTML = '<div class="coach-direction"><div class="coach-label">ERROR</div><div class="coach-text">' + esc(e.message) + '</div></div>';
          }
          coachBtn.textContent = '⚡ Coach Me'; (coachBtn as any).disabled = false; coachBtn.style.background = '#7F77DD';
        });
      }

      // ===== ALERT BUTTON =====
      const alertBtn = s.getElementById('o8-alert-btn');
      if (alertBtn) {
        alertBtn.addEventListener('click', async () => {
          const input = (s.getElementById('o8-alert-input') as HTMLInputElement)?.value.trim();
          if (!input) return;
          const alertTime = parseAlertTime(input);
          await browser.runtime.sendMessage({ type: 'SET_ALERT', payload: { task: input, alertTime } });
          (s.getElementById('o8-alert-input') as HTMLInputElement).value = '';
          loadAlerts(s);
        });
      }

      // ===== COMMAND MODE SETUP =====
      let cmdUsedVoice = false;

      // Quick command chips
      s.querySelectorAll('.cmd-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const ta = s.getElementById('o8-cmd-input') as HTMLTextAreaElement;
          const prefix = (chip as HTMLElement).dataset.prefix || '';
          if (ta) { ta.value = prefix + ta.value; ta.focus(); }
        });
      });

      // Voice recording (hold to speak)
      const cmdMic = s.getElementById('o8-cmd-mic');
      let cmdRecognition: any = null;
      if (cmdMic) {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        cmdMic.addEventListener('mousedown', () => {
          if (!SR) {
            (s.getElementById('o8-cmd-mic-label') as HTMLElement).textContent = 'Voice not supported — type your command below';
            return;
          }
          cmdUsedVoice = true;
          cmdRecognition = new SR();
          cmdRecognition.continuous = true;
          cmdRecognition.interimResults = true;
          cmdRecognition.lang = 'en-US';
          let finalText = '';
          const transcriptEl = s.getElementById('o8-cmd-transcript')!;
          transcriptEl.style.display = 'block';
          cmdMic.classList.add('recording');
          (s.getElementById('o8-cmd-mic-label') as HTMLElement).textContent = 'Listening...';

          cmdRecognition.onresult = (e: any) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
              else interim += e.results[i][0].transcript;
            }
            transcriptEl.textContent = finalText + interim;
          };
          cmdRecognition.onerror = () => {};
          try { cmdRecognition.start(); } catch(e) {}
        });

        const stopRecording = () => {
          if (cmdRecognition) {
            try { cmdRecognition.stop(); } catch(e) {}
            const transcriptEl = s.getElementById('o8-cmd-transcript')!;
            const ta = s.getElementById('o8-cmd-input') as HTMLTextAreaElement;
            if (transcriptEl.textContent && ta) ta.value = transcriptEl.textContent.trim();
            cmdMic.classList.remove('recording');
            (s.getElementById('o8-cmd-mic-label') as HTMLElement).textContent = 'Hold to speak your command';
            cmdRecognition = null;
          }
        };
        cmdMic.addEventListener('mouseup', stopRecording);
        cmdMic.addEventListener('mouseleave', stopRecording);
      }

      // Execute Command button
      const cmdExec = s.getElementById('o8-cmd-execute');
      if (cmdExec) {
        cmdExec.addEventListener('click', async () => {
          const input = (s.getElementById('o8-cmd-input') as HTMLTextAreaElement)?.value.trim();
          if (!input) return;

          cmdExec.textContent = '⚡ Processing...'; (cmdExec as any).disabled = true; cmdExec.style.opacity = '0.6';
          const statusArea = s.getElementById('o8-cmd-status')!;
          statusArea.innerHTML = '';

          try {
            const resp = await browser.runtime.sendMessage({
              type: 'EXECUTE_COMMAND',
              payload: { command: input, currentUrl: window.location.href, vehicleContext: leadData?.vehicle || '' }
            });

            if (resp.error) {
              statusArea.innerHTML = `<div class="cmd-result error"><div class="cmd-result-label">ERROR</div><div class="cmd-result-text">${esc(resp.error)}</div><div class="cmd-result-actions"><button class="cmd-retry">Try again</button></div></div>`;
              statusArea.querySelector('.cmd-retry')?.addEventListener('click', () => { statusArea.innerHTML = ''; cmdExec.click(); });
            } else {
              const p = resp.parsed;
              const actionLabel = p.action?.replace(/_/g, ' ') || 'command';
              const recipientLabel = p.recipient ? ` for ${p.recipient}` : '';
              let confirmText = '';

              // Handle injection based on action
              if (p.action === 'set_reminder' && p.metadata?.reminder_time) {
                await browser.runtime.sendMessage({ type: 'SET_ALERT', payload: { task: input, alertTime: new Date(p.metadata.reminder_time).getTime() } });
                const timeStr = new Date(p.metadata.reminder_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                confirmText = `Reminder set for ${timeStr}`;
              } else if (p.content) {
                // Try platform injection
                const injected = injectContent(p);
                confirmText = injected
                  ? `${actionLabel}${recipientLabel} — injected`
                  : `${actionLabel}${recipientLabel} — copy below`;
                if (!injected) {
                  // Show content for manual copy
                  statusArea.innerHTML += `<div class="out-card"><div class="out-label">GENERATED — COPY AND SEND</div><div class="out-text">${esc(p.content).replace(/\n/g, '<br>')}</div><div class="out-actions"><button class="out-copy">Copy</button></div></div>`;
                  statusArea.querySelector('.out-copy')?.addEventListener('click', function(this: HTMLElement) {
                    navigator.clipboard.writeText(p.content);
                    this.textContent = '✓ Copied'; this.style.background = '#16a34a'; this.style.color = '#fff';
                    setTimeout(() => { this.textContent = 'Copy'; this.style.background = ''; this.style.color = ''; }, 1500);
                  });
                }
              } else {
                confirmText = `Command processed${recipientLabel}`;
              }

              // Show success card
              const successDiv = document.createElement('div');
              successDiv.className = 'cmd-result success';
              successDiv.innerHTML = `<div class="cmd-result-label">✓ SUCCESS</div><div class="cmd-result-text">${esc(confirmText)}</div>`;
              statusArea.prepend(successDiv);
              setTimeout(() => successDiv.remove(), 4000);

              // Voice confirmation (only if rep used voice)
              if (cmdUsedVoice && confirmText && window.speechSynthesis) {
                const u = new SpeechSynthesisUtterance(confirmText);
                u.rate = 1.1; u.pitch = 1.0;
                window.speechSynthesis.speak(u);
              }
              cmdUsedVoice = false;
            }
          } catch(e: any) {
            statusArea.innerHTML = `<div class="cmd-result error"><div class="cmd-result-label">ERROR</div><div class="cmd-result-text">${esc(e.message)}</div></div>`;
          }

          cmdExec.textContent = '⚡ Execute Command'; (cmdExec as any).disabled = false; cmdExec.style.opacity = '1';
        });
      }

      if (isVinSolutions) updateSidebar();
    }

    function closeSidebar() {
      if (sidebarRoot) { sidebarRoot.style.display = 'none'; sidebarOpen = false; }
    }

    function updateSidebar() {
      if (!sidebarRoot || !isVinSolutions) return;
      const s = sidebarRoot.shadowRoot!;
      const empty = s.getElementById('o8-empty');
      const card = s.getElementById('o8-card');
      if (!empty || !card) return;

      if (leadData?.customerName) {
        empty.style.display = 'none';
        card.style.display = 'block';
        s.getElementById('o8-name')!.textContent = leadData.customerName;
        s.getElementById('o8-vehicle')!.textContent = leadData.vehicle || 'No vehicle detected';
        let meta = '';
        if (leadData.phone) meta += leadData.phone;
        if (leadData.source) meta += (meta ? ' · ' : '') + leadData.source;
        if (leadData.status) meta += (meta ? ' · ' : '') + leadData.status;
        s.getElementById('o8-meta')!.textContent = meta;
        s.getElementById('o8-last')!.textContent = leadData.lastContact ? `Last: ${leadData.lastContact}` : '';
        s.getElementById('o8-ctx')!.textContent = `✓ Context loaded — ${leadData.customerName}`;
        s.getElementById('o8-ctx')!.style.display = 'block';
      } else {
        empty.style.display = 'flex';
        card.style.display = 'none';
      }
    }

    // ===== GENERATE =====
    async function doGenerate(s: ShadowRoot) {
      // Debounce: prevent double-click generating twice
      if (isGenerating) return;
      isGenerating = true;

      // Platform feature gate: Gmail/Facebook/LinkedIn require Floq Command
      if (isGmail || isFacebook || isLinkedIn) {
        const featureKey = isGmail ? 'gmail' : isFacebook ? 'facebook' : 'linkedin';
        const outputEl = s.getElementById('o8-outputs');
        if (outputEl && !(await checkFeatureGate(featureKey, outputEl))) { isGenerating = false; return; }
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

      try {
        const response = await browser.runtime.sendMessage({
          type: 'GENERATE_OUTPUT',
          payload: {
            type,
            leadContext: leadData || {},
            repInput: input,
            repName: '',
            dealership: '',
            platform: platform
          }
        });

        if (response.error) {
          addOutput(s, 'Error', response.error);
        } else {
          const sec = response.sections;
          if (selected.includes('text') && sec.text) addOutput(s, outputLabels.text, sec.text);
          if (selected.includes('email') && sec.email) addOutput(s, outputLabels.email, sec.email);
          if (selected.includes('crm') && sec.crm) addOutput(s, outputLabels.crm, sec.crm);
          if (!sec.text && !sec.email && !sec.crm) {
            addOutput(s, 'OUTPUT', response.text || 'Generation returned empty — try rephrasing your input or check that a customer is loaded.');
          }
        }
      } catch (e: any) {
        addOutput(s, 'Error', e.message);
      }

      btn.textContent = '✨ Generate'; btn.disabled = false; btn.style.background = '#7F77DD';
      isGenerating = false;
    }

    // ===== PASTE TO CRM (VinSolutions only) =====
    function findNoteTextarea(): HTMLTextAreaElement | null {
      if (!isVinSolutions) return null;
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          if (iframe.src?.includes('AddNote')) {
            const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
            if (doc) { const ta = doc.querySelector('textarea'); if (ta) return ta; }
          }
        } catch(e) {}
      }
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
          if (!doc) continue;
          const text = doc.body?.innerText || '';
          if (text.includes('Add Note') || text.includes('Note Type')) {
            const ta = doc.querySelector('textarea'); if (ta) return ta;
          }
        } catch(e) {}
      }
      return null;
    }

    function clickNoteIcon(): boolean {
      if (!isVinSolutions) return false;
      const allElements = document.querySelectorAll('a, button, div, span, td');
      for (const el of allElements) {
        if (el.textContent?.trim() === 'Note' && (el as HTMLElement).offsetWidth > 0) {
          (el as HTMLElement).click(); return true;
        }
      }
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || (iframe as any).contentWindow?.document;
          if (!doc) continue;
          for (const el of doc.querySelectorAll('a, button, div, span, td, img')) {
            const text = el.textContent?.trim();
            if ((text === 'Note' || (el as HTMLImageElement).alt === 'Note') && (el as HTMLElement).offsetWidth > 0) {
              (el as HTMLElement).click(); return true;
            }
          }
        } catch(e) {}
      }
      return false;
    }

    async function pasteIntoCRM(noteText: string, statusEl: HTMLElement) {
      if (!isVinSolutions) {
        statusEl.textContent = 'Paste to CRM only works on VinSolutions.';
        statusEl.style.color = '#94a3b8';
        return;
      }
      statusEl.textContent = 'Opening note form...'; statusEl.style.color = '#2563eb';
      await browser.storage.local.set({ oper8er_paste_note: noteText, oper8er_paste_note_time: Date.now() });
      let textarea = findNoteTextarea();
      if (!textarea) {
        const clicked = clickNoteIcon();
        if (clicked) {
          for (let attempt = 0; attempt < 15; attempt++) {
            await new Promise(r => setTimeout(r, 500));
            textarea = findNoteTextarea(); if (textarea) break;
          }
        }
      }
      if (textarea) {
        textarea.focus(); textarea.value = noteText;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.dispatchEvent(new Event('blur', { bubbles: true }));
        statusEl.textContent = '✓ Pasted to CRM. Click Save in VinSolutions.';
        statusEl.style.color = '#16a34a'; statusEl.style.fontWeight = '600';
        const origBorder = textarea.style.border;
        textarea.style.border = '2px solid #16a34a';
        setTimeout(() => { textarea!.style.border = origBorder; }, 2000);
        browser.storage.local.remove(['oper8er_paste_note', 'oper8er_paste_note_time']);
      } else {
        statusEl.textContent = '✓ Note staged. It will auto-paste when the Add Note form loads.';
        statusEl.style.color = '#2563eb'; statusEl.style.fontWeight = '500';
      }
    }

    function addOutput(s: ShadowRoot, label: string, content: string) {
      const container = s.getElementById('o8-outputs')!;
      const card = document.createElement('div');
      card.className = 'out-card';
      const isCRM = label === 'CRM NOTE';
      card.innerHTML = `
        <div class="out-label">${esc(label)}</div>
        <div class="out-text">${esc(content).replace(/\n/g, '<br>')}</div>
        <div class="out-actions">
          <button class="out-copy">Copy</button>
          ${isCRM && isVinSolutions ? '<button class="out-paste">Paste to CRM</button>' : ''}
        </div>
        ${isCRM && isVinSolutions ? '<div class="out-paste-status"></div>' : ''}
      `;
      card.querySelector('.out-copy')!.addEventListener('click', function(this: HTMLElement) {
        navigator.clipboard.writeText(content);
        this.textContent = '✓ Copied'; this.style.background = '#16a34a'; this.style.color = '#fff';
        setTimeout(() => { this.textContent = 'Copy'; this.style.background = ''; this.style.color = ''; }, 1500);
      });
      if (isCRM && isVinSolutions) {
        card.querySelector('.out-paste')!.addEventListener('click', function(this: HTMLElement) {
          const statusEl = card.querySelector('.out-paste-status') as HTMLElement;
          (this as any).disabled = true; this.textContent = 'Pasting...'; this.style.background = '#94a3b8';
          pasteIntoCRM(content, statusEl).then(() => {
            this.textContent = 'Paste to CRM'; (this as any).disabled = false; this.style.background = '';
          });
        });
      }
      container.appendChild(card);
    }

    // ===== PLATFORM INJECTION =====
    function injectContent(parsed: any): boolean {
      const { action, content, subject } = parsed;

      // Gmail injection
      if ((action === 'write_email' || platform === 'gmail') && isGmail) {
        const body = document.querySelector('div[aria-label="Message Body"][contenteditable="true"]') as HTMLElement;
        if (body) {
          body.focus();
          document.execCommand('insertText', false, content);
          if (subject) {
            const subj = document.querySelector('input[name="subjectbox"]') as HTMLInputElement;
            if (subj) { subj.focus(); subj.value = subject; subj.dispatchEvent(new Event('input', { bubbles: true })); }
          }
          return true;
        }
      }

      // Facebook injection
      if ((action === 'write_facebook_message' || platform === 'facebook') && isFacebook) {
        const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement;
        if (box) { box.focus(); document.execCommand('insertText', false, content); return true; }
      }

      // LinkedIn injection
      if ((action === 'write_linkedin_message' || platform === 'linkedin') && isLinkedIn) {
        const box = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement;
        if (box) { box.focus(); document.execCommand('insertText', false, content); return true; }
      }

      // VinSolutions CRM injection
      if ((action === 'log_crm_note') && isVinSolutions) {
        const statusEl = document.createElement('span');
        pasteIntoCRM(content, statusEl);
        return true;
      }

      return false; // fallback to manual copy
    }

    // ===== OPEN COMMAND TAB LISTENER (for Alt+K shortcut) =====
    browser.runtime.onMessage.addListener((msg: any) => {
      if (msg.type === 'OPEN_COMMAND_TAB') {
        if (!sidebarOpen) {
          openSidebar().then(() => {
            if (sidebarRoot) {
              const s = sidebarRoot.shadowRoot!;
              s.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
              s.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
              s.querySelector('.tab-btn[data-tab="command"]')?.classList.add('active');
              s.getElementById('tab-command')?.classList.add('active');
            }
          });
        } else if (sidebarRoot) {
          const s = sidebarRoot.shadowRoot!;
          s.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          s.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          s.querySelector('.tab-btn[data-tab="command"]')?.classList.add('active');
          s.getElementById('tab-command')?.classList.add('active');
        }
      }
    });

    // ===== ALERT HELPERS =====
    function parseAlertTime(text: string): number {
      const now = Date.now();
      const inMin = text.match(/in\s+(\d+)\s*min/i);
      if (inMin) return now + parseInt(inMin[1]) * 60000;
      const inHr = text.match(/in\s+(\d+)\s*hour/i);
      if (inHr) return now + parseInt(inHr[1]) * 3600000;
      const byTime = text.match(/(?:by|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (byTime) {
        let h = parseInt(byTime[1]);
        const m = byTime[2] ? parseInt(byTime[2]) : 0;
        const ampm = (byTime[3] || '').toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        if (!ampm && h < 7) h += 12; // assume PM for low numbers
        const d = new Date(); d.setHours(h, m, 0, 0);
        if (d.getTime() < now) d.setDate(d.getDate() + 1);
        return d.getTime();
      }
      const noonMatch = text.match(/\bnoon\b/i);
      if (noonMatch) { const d = new Date(); d.setHours(12, 0, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); }
      return now + 30 * 60000; // default 30 min
    }

    async function loadAlerts(s: ShadowRoot) {
      const alerts = await browser.runtime.sendMessage({ type: 'GET_ALERTS' });
      const list = s.getElementById('o8-alert-list');
      if (!list) return;
      if (!alerts || alerts.length === 0) {
        list.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px">No active reminders</div>';
        return;
      }
      list.innerHTML = alerts.map((a: any) => {
        const time = new Date(a.alertTime);
        const timeStr = time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return `<div class="alert-item" data-id="${a.id}"><span class="alert-task">${esc(a.task)}</span><span class="alert-time">${timeStr}</span><button class="alert-dismiss" title="Dismiss">&times;</button></div>`;
      }).join('');
      list.querySelectorAll('.alert-dismiss').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = (btn.closest('.alert-item') as HTMLElement)?.dataset.id;
          if (id) { await browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id } }); loadAlerts(s); }
        });
      });
    }

    // ===== ALERT BANNER LISTENER =====
    browser.runtime.onMessage.addListener((msg: any) => {
      if (msg.type === 'SHOW_ALERT_BANNER') {
        const existing = document.getElementById('floq-alert-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.id = 'floq-alert-banner';
        Object.assign(banner.style, {
          position: 'fixed', top: '0', left: '0', right: '0', zIndex: '999999',
          background: '#FF3B30', color: '#fff', padding: '12px 20px',
          fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontWeight: '600',
          display: 'flex', alignItems: 'center', gap: '10px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        });
        banner.innerHTML = `<span style="font-size:18px">🔔</span><span style="flex:1">${esc(msg.payload.task)}</span><button style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:6px 16px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Dismiss</button>`;
        banner.querySelector('button')!.addEventListener('click', () => {
          banner.remove();
          browser.runtime.sendMessage({ type: 'DISMISS_ALERT', payload: { id: msg.payload.id } });
        });
        document.body.appendChild(banner);
        // Audio chime
        try {
          const ac = new AudioContext();
          const g = ac.createGain(); g.gain.value = 0.3; g.connect(ac.destination);
          const o1 = ac.createOscillator(); o1.frequency.value = 800; o1.connect(g); o1.start(); o1.stop(ac.currentTime + 0.15);
          setTimeout(() => { const o2 = ac.createOscillator(); o2.frequency.value = 1000; o2.connect(g); o2.start(); o2.stop(ac.currentTime + 0.2); }, 180);
        } catch(e) {}
      }
    });

    function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ===== HTML: VINSOLUTIONS (auto-scan + customer card) =====
    const HTML_VINSOLUTIONS = `
      <div class="header">
        <span class="logo">FLOQ</span>
        <span id="o8-close" class="close">&times;</span>
      </div>
      <div class="tab-bar">
        <button class="tab-btn active" data-tab="generate">✨ Generate</button>
        <button class="tab-btn" data-tab="coach">⚡ Coach</button>
        <button class="tab-btn" data-tab="alerts">🔔 Alerts</button>
        <button class="tab-btn" data-tab="command">⚡ Command</button>
      </div>
      <div id="tab-generate" class="tab-content active">
        <div id="o8-empty" class="empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          <span>Open a customer lead to activate</span>
        </div>
        <div id="o8-card" class="card" style="display:none">
          <div id="o8-name" class="name"></div>
          <div id="o8-vehicle" class="vehicle"></div>
          <div id="o8-meta" class="meta"></div>
          <div id="o8-last" class="last"></div>
          <div id="o8-ctx" class="ctx" style="display:none"></div>
        </div>
        <div class="input-section">
          <div class="chips">
            <button class="chip on" data-type="text">Text</button>
            <button class="chip on" data-type="email">Email</button>
            <button class="chip on" data-type="crm">CRM Note</button>
          </div>
          <div class="input-row">
            <button id="o8-mic" class="mic-btn" title="Voice input">🎙</button>
            <textarea id="o8-input" class="input" placeholder="Describe the situation..." rows="3"></textarea>
          </div>
          <button id="o8-generate" class="gen-btn">✨ Generate</button>
        </div>
        <div id="o8-outputs" class="outputs"></div>
      </div>
      <div id="tab-coach" class="tab-content">
        <div class="input-section">
          <textarea id="o8-coach-input" class="input" placeholder="What did the customer just say?" rows="3"></textarea>
          <div class="coach-chips">
            <button class="coach-chip">Need to think about it</button>
            <button class="coach-chip">Price too high</button>
            <button class="coach-chip">Bad credit</button>
            <button class="coach-chip">Spouse not here</button>
            <button class="coach-chip">Already talking to another dealer</button>
          </div>
          <button id="o8-coach-btn" class="gen-btn" style="background:#7F77DD">⚡ Coach Me</button>
        </div>
        <div id="o8-coach-output" class="outputs"></div>
      </div>
      <div id="tab-alerts" class="tab-content">
        <div class="input-section">
          <div class="input-row">
            <input id="o8-alert-input" class="input" placeholder="Set a reminder... e.g. Move the Tacoma by noon" style="padding:10px;border-radius:6px" />
          </div>
          <button id="o8-alert-btn" class="gen-btn" style="background:#FF9500">🔔 Set Alert</button>
        </div>
        <div id="o8-alert-list" class="outputs" style="padding:10px 14px"></div>
      </div>
      ${HTML_COMMAND_TAB}
      <div class="sidebar-footer"><a id="o8-settings" class="settings-link" title="Profile Settings">&#9881; Settings</a></div>
    `;

    // ===== SHARED COMMAND TAB HTML =====
    const HTML_COMMAND_TAB = `
      <div id="tab-command" class="tab-content">
        <div class="cmd-section">
          <div class="cmd-mic-wrap">
            <button id="o8-cmd-mic" class="cmd-mic" title="Hold to speak">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <div id="o8-cmd-mic-label" class="cmd-mic-label">Hold to speak your command</div>
          </div>
          <div id="o8-cmd-transcript" class="cmd-transcript" style="display:none"></div>
          <textarea id="o8-cmd-input" class="input cmd-input" placeholder="Or type a command...&#10;Example: Write an email to Yancy that Wyatt has not made his calls today" rows="3"></textarea>
          <div class="cmd-chips">
            <button class="cmd-chip" data-prefix="Write email ">Write email</button>
            <button class="cmd-chip" data-prefix="Write text ">Write text</button>
            <button class="cmd-chip" data-prefix="Facebook message ">Facebook message</button>
            <button class="cmd-chip" data-prefix="Log CRM note ">Log CRM note</button>
            <button class="cmd-chip" data-prefix="Set reminder ">Set reminder</button>
          </div>
          <button id="o8-cmd-execute" class="gen-btn cmd-execute">⚡ Execute Command</button>
          <div class="cmd-hint">Floq will generate and inject the output</div>
        </div>
        <div id="o8-cmd-status" class="cmd-status-area"></div>
      </div>
    `;

    // ===== HTML: UNIVERSAL (manual input, no customer card) =====
    const platformHint = isGmail || isOutlook ? 'Describe the email situation...'
      : isFacebook ? 'Describe the conversation...'
      : isLinkedIn ? 'Describe the LinkedIn interaction...'
      : "What's happening right now?";

    const HTML_UNIVERSAL = `
      <div class="header">
        <span class="logo">FLOQ</span>
        <span class="platform-badge">${esc(platform)}</span>
        <span id="o8-close" class="close">&times;</span>
      </div>
      <div class="tab-bar">
        <button class="tab-btn active" data-tab="generate">✨ Generate</button>
        <button class="tab-btn" data-tab="coach">⚡ Coach</button>
        <button class="tab-btn" data-tab="alerts">🔔 Alerts</button>
        <button class="tab-btn" data-tab="command">⚡ Command</button>
      </div>
      <div id="tab-generate" class="tab-content active">
        <div class="input-section" style="padding-top:8px">
          <div class="chips">
            <button class="chip on" data-type="text">${esc(outputLabels.text.split(' ')[0])}</button>
            <button class="chip on" data-type="email">Email</button>
            <button class="chip on" data-type="crm">Note</button>
          </div>
          <div class="input-row">
            <button id="o8-mic" class="mic-btn" title="Voice input">🎙</button>
            <textarea id="o8-input" class="input" placeholder="${esc(platformHint)}" rows="4"></textarea>
          </div>
          <button id="o8-generate" class="gen-btn">✨ Generate</button>
        </div>
        <div id="o8-outputs" class="outputs"></div>
      </div>
      <div id="tab-coach" class="tab-content">
        <div class="input-section">
          <textarea id="o8-coach-input" class="input" placeholder="What did the customer just say?" rows="3"></textarea>
          <div class="coach-chips">
            <button class="coach-chip">Need to think about it</button>
            <button class="coach-chip">Price too high</button>
            <button class="coach-chip">Bad credit</button>
            <button class="coach-chip">Spouse not here</button>
            <button class="coach-chip">Already talking to another dealer</button>
          </div>
          <button id="o8-coach-btn" class="gen-btn" style="background:#7F77DD">⚡ Coach Me</button>
        </div>
        <div id="o8-coach-output" class="outputs"></div>
      </div>
      <div id="tab-alerts" class="tab-content">
        <div class="input-section">
          <div class="input-row">
            <input id="o8-alert-input" class="input" placeholder="Set a reminder... e.g. Move the Tacoma by noon" style="padding:10px;border-radius:6px" />
          </div>
          <button id="o8-alert-btn" class="gen-btn" style="background:#FF9500">🔔 Set Alert</button>
        </div>
        <div id="o8-alert-list" class="outputs" style="padding:10px 14px"></div>
      </div>
      ${HTML_COMMAND_TAB}
      <div class="sidebar-footer"><a id="o8-settings" class="settings-link" title="Profile Settings">&#9881; Settings</a></div>
    `;

    // ===== CSS =====
    const CSS = `
      * { margin:0; padding:0; box-sizing:border-box; }
      :host { all:initial; font-family:system-ui,-apple-system,sans-serif; font-size:13px; color:#1a202c; }
      #o8 { width:320px; height:100vh; background:#fff; border-left:1px solid #e2e8f0; overflow-y:auto; overscroll-behavior:contain; box-shadow:-4px 0 16px rgba(0,0,0,0.06); display:flex; flex-direction:column; }

      .header { padding:12px 14px; border-bottom:1px solid #e8eaed; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:8px; }
      .logo { font-size:14px; font-weight:700; color:#7F77DD; letter-spacing:3px; }
      .platform-badge { font-size:9px; font-weight:600; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:10px; text-transform:uppercase; letter-spacing:1px; flex:1; text-align:center; }
      .close { font-size:20px; color:#94a3b8; cursor:pointer; padding:0 4px; }
      .close:hover { color:#475569; }

      .empty { padding:28px 14px; text-align:center; color:#94a3b8; font-size:12px; display:flex; flex-direction:column; align-items:center; gap:8px; flex-shrink:0; }

      .card { padding:12px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
      .name { font-size:15px; font-weight:600; color:#1a202c; }
      .vehicle { font-size:12px; color:#2563eb; margin-top:1px; }
      .meta { font-size:11px; color:#64748b; margin-top:4px; }
      .last { font-size:11px; color:#94a3b8; margin-top:2px; }
      .ctx { font-size:11px; color:#16a34a; margin-top:4px; font-weight:500; }

      .input-section { padding:12px 14px; border-bottom:1px solid #e8eaed; flex-shrink:0; }
      .chips { display:flex; gap:5px; margin-bottom:8px; }
      .chip { padding:5px 12px; border-radius:16px; font-size:11px; font-weight:600; font-family:inherit; border:1.5px solid #e2e8f0; background:#fff; color:#94a3b8; cursor:pointer; transition:all 0.15s; position:relative; }
      .chip.on { border-color:#7F77DD; color:#7F77DD; background:#F0EFFF; }
      .chip.on::after { content:''; position:absolute; top:-2px; right:-2px; width:7px; height:7px; border-radius:50%; background:#16a34a; border:1.5px solid #fff; }

      .input-row { display:flex; gap:6px; align-items:flex-start; }
      .mic-btn { width:40px; height:40px; border-radius:50%; border:2px solid #e2e8f0; background:#f8fafc; cursor:pointer; font-size:18px; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all .15s; }
      .mic-btn:hover { border-color:#2563eb; }
      .input { flex:1; padding:8px 10px; border:1px solid #e2e8f0; border-radius:6px; font-size:13px; font-family:inherit; resize:none; outline:none; color:#1a202c; }
      .input:focus { border-color:#2563eb; }
      .input::placeholder { color:#94a3b8; }

      .gen-btn { width:100%; padding:10px; background:#7F77DD; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; margin-top:8px; transition:all 0.15s; }
      .gen-btn:hover { background:#534AB7; }
      .gen-btn:disabled { background:#94a3b8; cursor:wait; }

      .outputs { padding:10px 14px; flex:1; overflow-y:auto; }
      .out-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:8px; }
      .out-label { font-size:9px; font-weight:700; color:#2563eb; letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
      .out-text { font-size:12px; line-height:1.5; color:#1a202c; max-height:180px; overflow-y:auto; padding-right:4px; }
      .out-text::-webkit-scrollbar { width:4px; }
      .out-text::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:2px; }
      .out-text::-webkit-scrollbar-track { background:transparent; }
      .out-actions { display:flex; gap:6px; margin-top:6px; }
      .out-copy { padding:5px 14px; background:#f0f2f5; border:1px solid #dde1e6; border-radius:4px; font-size:11px; font-weight:600; color:#475569; cursor:pointer; font-family:inherit; transition:all 0.15s; }
      .out-copy:hover { background:#e2e8f0; }
      .out-paste { padding:5px 14px; background:#2563eb; border:1px solid #1d4ed8; border-radius:4px; font-size:11px; font-weight:600; color:#fff; cursor:pointer; font-family:inherit; transition:all 0.15s; }
      .out-paste:hover { background:#1d4ed8; }
      .out-paste:disabled { background:#94a3b8; border-color:#94a3b8; cursor:wait; }
      .out-paste-status { font-size:10px; margin-top:4px; min-height:14px; }

      .tab-bar { display:flex; border-bottom:1px solid #e8eaed; flex-shrink:0; }
      .tab-btn { flex:1; padding:8px 4px; font-size:11px; font-weight:600; font-family:inherit; border:none; background:transparent; color:#94a3b8; cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; }
      .tab-btn.active { color:#2563eb; border-bottom-color:#2563eb; }
      .tab-btn:hover { color:#475569; }
      .tab-content { display:none; flex-direction:column; flex:1; overflow:hidden; }
      .tab-content.active { display:flex; }

      .coach-chips { display:flex; flex-wrap:wrap; gap:4px; margin:8px 0; }
      .coach-chip { padding:4px 10px; border-radius:14px; font-size:10px; font-weight:500; font-family:inherit; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; cursor:pointer; transition:all .15s; }
      .coach-chip:hover { border-color:#7F77DD; color:#7F77DD; background:#F0EFFF; }

      .coach-direction { background:#F0EFFF; border:1px solid #7F77DD; border-radius:8px; padding:12px; margin:8px 14px; }
      .coach-label { font-size:9px; font-weight:700; color:#7F77DD; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; }
      .coach-text { font-size:13px; line-height:1.6; color:#1a202c; }

      .alert-item { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:#FFF7ED; border:1px solid #FBBF24; border-radius:6px; margin-bottom:6px; font-size:11px; }
      .alert-task { flex:1; color:#1a202c; font-weight:500; }
      .alert-time { font-size:10px; color:#92400E; margin:0 8px; }
      .alert-dismiss { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:14px; padding:0 4px; }

      .sidebar-footer { padding:8px 14px; border-top:1px solid #e8eaed; flex-shrink:0; text-align:center; }
      .settings-link { font-size:10px; color:#94a3b8; cursor:pointer; text-decoration:none; }
      .settings-link:hover { color:#6D28D9; }

      .cmd-section { padding:12px 14px; display:flex; flex-direction:column; align-items:center; gap:8px; }
      .cmd-mic-wrap { display:flex; flex-direction:column; align-items:center; gap:8px; margin:8px 0; }
      .cmd-mic { width:80px; height:80px; border-radius:50%; background:#7F77DD; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .2s; box-shadow:0 2px 12px rgba(127,119,221,0.3); }
      .cmd-mic:hover { transform:scale(1.05); box-shadow:0 4px 16px rgba(127,119,221,0.4); }
      .cmd-mic.recording { background:#FF3B30; animation:mic-pulse 1.5s infinite; }
      @keyframes mic-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,59,48,0.4)} 50%{box-shadow:0 0 0 16px rgba(255,59,48,0)} }
      .cmd-mic-label { font-size:12px; color:#636366; }
      .cmd-transcript { width:100%; font-size:12px; color:#7F77DD; font-style:italic; text-align:center; padding:4px 8px; min-height:20px; }
      .cmd-input { width:100%; font-size:12px; }
      .cmd-chips { display:flex; flex-wrap:wrap; gap:4px; width:100%; }
      .cmd-chip { padding:4px 10px; border-radius:14px; font-size:10px; font-weight:500; font-family:inherit; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; cursor:pointer; transition:all .15s; }
      .cmd-chip:hover { border-color:#7F77DD; color:#7F77DD; background:#F0EFFF; }
      .cmd-execute { background:#7F77DD !important; }
      .cmd-execute:hover { background:#534AB7 !important; }
      .cmd-hint { font-size:11px; color:#636366; text-align:center; }
      .cmd-status-area { padding:8px 14px; }
      .cmd-result { border-radius:8px; padding:12px; margin-bottom:8px; font-size:12px; line-height:1.5; }
      .cmd-result.success { background:#F0FDF4; border:1px solid #34C759; color:#1a202c; }
      .cmd-result.error { background:#FEF2F2; border:1px solid #FF3B30; color:#1a202c; }
      .cmd-result-label { font-size:9px; font-weight:700; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px; }
      .cmd-result.success .cmd-result-label { color:#34C759; }
      .cmd-result.error .cmd-result-label { color:#FF3B30; }
      .cmd-result-text { font-size:12px; line-height:1.5; }
      .cmd-result-actions { display:flex; gap:6px; margin-top:8px; }
      .cmd-retry { padding:5px 14px; background:#FF3B30; border:none; border-radius:4px; font-size:11px; font-weight:600; color:#fff; cursor:pointer; font-family:inherit; }
    `;

    // ===== NETWORK INTERCEPTION (VinSolutions only) =====
    if (isVinSolutions && isUIFrame) {
      try {
        const script = document.createElement('script');
        script.src = browser.runtime.getURL('oper8er-intercept.js');
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();
      } catch(e) {}

      window.addEventListener('message', (event) => {
        if (event.data?.type === 'OPER8ER_LEAD_DATA' && event.data?.data?.customerName) {
          leadData = event.data.data;
          updateSidebar();
        }
      });
    }
  },
});
