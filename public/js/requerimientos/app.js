// ── Jira proxy (same as incidencias) ────────────────────────────────────────
async function jira(method, path, body) {
    const res = await fetch('/api/jira' + path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
    if (!res.ok) {
        const errMsg = json.errorMessages?.[0]
            || (json.errors ? Object.values(json.errors)[0] : null)
            || json.message || json.error || json.detail
            || `HTTP ${res.status}`;
        throw new Error(errMsg);
    }
    return json;
}

function reqEsc(s)   { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function reqFmt(d)   { if (!d) return '—'; return new Date(d).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' }); }
function reqExtractText(body) {
    if (!body) return '—';
    if (typeof body === 'string') return reqEsc(body).slice(0, 200);
    try {
        const texts = [];
        const walk = n => { if (n.type === 'text') texts.push(n.text || ''); (n.content || []).forEach(walk); };
        walk(body);
        return reqEsc(texts.join(' ').slice(0, 200));
    } catch { return '—'; }
}
function reqStatusClass(s) {
    const v = (s || '').toLowerCase();
    if (v.includes('pend') || v.includes('waiting')) return 's-pend';
    if (v.includes('cerr') || v.includes('done') || v.includes('resolved') || v.includes('resuelto')) return 's-cerr';
    if (v.includes('progr') || v.includes('curso')) return 's-n1';
    return 's-pend';
}
function reqPrioClass(p) {
    const v = (p || '').toLowerCase();
    if (v === 'alta' || v === 'high' || v === 'highest' || v === 'critical') return 'prio-alta';
    if (v === 'baja' || v === 'low' || v === 'lowest') return 'prio-baja';
    return 'prio-media';
}

function getJiraEmail() {
    let email = localStorage.getItem('jira_email') || CURRENT_USER_EMAIL;
    if (!email || !email.includes('@')) {
        email = prompt('⚠️ Ingresa tu correo asociado a Jira:', '') || '';
        if (email) localStorage.setItem('jira_email', email);
    }
    return email || null;
}

function reqConfigJiraEmail() {
    const current = localStorage.getItem('jira_email') || CURRENT_USER_EMAIL || '';
    const email = prompt('Correo asociado a tu cuenta Jira:', current);
    if (email && email.includes('@')) {
        localStorage.setItem('jira_email', email);
        const nm = document.getElementById('reqSidebarName');
        const em = document.getElementById('reqSidebarEmail');
        const av = document.getElementById('reqSidebarAvatar');
        if (em) em.textContent = email;
        if (nm) nm.textContent = email.split('@')[0];
        if (av) av.textContent = email.charAt(0).toUpperCase();
        showToast('✅ Correo Jira configurado: ' + email, 'success');
    }
}

function showToast(msg, type) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const d = document.createElement('div');
    d.className = 'toast-msg' + (type ? ' ' + type : '');
    d.innerHTML = `<i class="bi bi-${type==='success'?'check-circle-fill':type==='error'?'x-circle-fill':'info-circle-fill'}"></i> ${msg}`;
    c.appendChild(d);
    setTimeout(() => d.remove(), 4000);
}

// ── Shared inline panels & actions builder ────────────────────────────────────
function _reqActionsHTML(key, isClosed, isPending, hasNote) {
    return `<div class="tc-actions">
        <button class="btn-outline-sm" style="font-size:12px;color:#6366f1;border-color:rgba(99,102,241,.4);" onclick="reqAsignarme('${key}')"><i class="bi bi-person-check-fill"></i> Asignarme</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="reqToggleAsig('${key}')"><i class="bi bi-people"></i> Reasignar</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="reqToggleComentar('${key}')"><i class="bi bi-chat-dots"></i> Comentar</button>
        ${isPending ? `<button class="btn-outline-sm" style="font-size:12px;color:#6366f1;border-color:rgba(99,102,241,.4);" onclick="reqToggleReanudar('${key}')"><i class="bi bi-arrow-counterclockwise"></i> Reanudar</button>` : ''}
        ${!isClosed ? `<button class="btn-outline-sm" style="border-color:#ef4444;color:#ef4444;font-size:12px;" onclick="reqToggleCerrar('${key}')"><i class="bi bi-check2-circle"></i> Cerrar requerimiento</button>` : ''}
        ${!isClosed ? `<button class="btn-outline-sm" style="font-size:12px;color:#0f172a;border-color:rgba(15,23,42,.35);" onclick="reqOpenDerive('${key}')"><i class="bi bi-arrow-right-circle"></i> Derivar</button>` : ''}
        <button class="btn-outline-sm" style="font-size:12px;color:#6366f1;border-color:rgba(99,102,241,.3);" onclick="reqOpenTimeline('${key}')"><i class="bi bi-clock-history"></i> Timeline</button>
        <button class="btn-outline-sm" id="req-noteBtn-${key}" style="font-size:12px;${hasNote?'color:#8b5cf6;border-color:rgba(139,92,246,.4);':''}" onclick="reqToggleNota('${key}',this)"><i class="bi bi-sticky${hasNote?'-fill':''}"></i> Nota${hasNote?' ·':''}</button>
        <a href="https://integratelperu.atlassian.net/browse/${key}" target="_blank" class="btn-outline-sm" style="font-size:12px;text-decoration:none;margin-left:auto;"><i class="bi bi-box-arrow-up-right"></i> Jira</a>
    </div>`;
}

function _reqInlinesHTML(key) {
    const noteVal = reqEsc(localStorage.getItem('req_note_' + key) || '');
    return `
    <div class="asig-inline" id="req-comentar-${key}" style="display:none;padding:12px;border:1px solid var(--border-soft);border-radius:8px;margin-top:8px;background:var(--bg-card);">
      <div style="font-size:11px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;text-transform:uppercase;">Agregar Comentario</div>
      <textarea id="req-cmt-input-${key}" class="form-control-custom" rows="2" placeholder="Escribe un comentario..." style="resize:vertical;margin-bottom:8px;width:100%;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn-create" style="padding:7px 14px;font-size:12px;" onclick="reqEjecutarComentar('${key}')">Enviar</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="reqToggleComentar('${key}')">Cancelar</button>
      </div>
    </div>
    <div class="asig-inline" id="req-asig-${key}" style="display:none;padding:12px;border:1px solid var(--border-soft);border-radius:8px;margin-top:8px;background:var(--bg-card);">
      <div style="font-size:11px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;text-transform:uppercase;">Asignar a</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="req-asig-input-${key}" type="email" class="form-control-custom" placeholder="correo@empresa.com" style="flex:1;padding:8px 12px;font-size:12px;">
        <button class="btn-create" style="padding:7px 14px;font-size:12px;" onclick="reqEjecutarAsignar('${key}')">Asignar</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="reqToggleAsig('${key}')">✕</button>
      </div>
    </div>
    <div class="asig-inline" id="req-cerrar-${key}" style="display:none;padding:12px;border:1px solid rgba(239,68,68,.3);border-radius:8px;margin-top:8px;background:var(--bg-card);">
      <div style="font-size:11px;color:#ef4444;font-family:monospace;margin-bottom:10px;text-transform:uppercase;">Cerrar requerimiento · ${key}</div>
      <textarea id="req-cerrar-cmt-${key}" class="form-control-custom" rows="3" placeholder="Resolución o motivo de cierre..." style="resize:vertical;margin-bottom:8px;border-color:rgba(239,68,68,.3);"></textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn-outline-sm" style="border-color:#ef4444;color:#ef4444;font-size:12px;" onclick="reqEjecutarCerrar('${key}')"><i class="bi bi-check2-circle"></i> Confirmar cierre</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="reqToggleCerrar('${key}')">Cancelar</button>
      </div>
    </div>
    <div class="asig-inline" id="req-reanudar-${key}" style="display:none;padding:12px;border:1px solid rgba(99,102,241,.35);border-radius:8px;margin-top:8px;background:var(--bg-card);">
      <div style="font-size:11px;color:#6366f1;font-family:monospace;margin-bottom:10px;text-transform:uppercase;">Reanudar Requerimiento · ${key}</div>
      <textarea id="req-reanudar-cmt-${key}" class="form-control-custom" rows="3" placeholder="Motivo por el que se reactiva..." style="resize:vertical;margin-bottom:8px;border-color:rgba(99,102,241,.4);"></textarea>
      <div style="display:flex;gap:8px;">
        <button class="btn-outline-sm" style="border-color:#6366f1;color:#6366f1;font-size:12px;" onclick="reqEjecutarReanudar('${key}')"><i class="bi bi-arrow-counterclockwise"></i> Confirmar</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="reqToggleReanudar('${key}')">Cancelar</button>
      </div>
    </div>
    <div class="asig-inline" id="req-nota-${key}" style="display:none;padding:12px;border:1px solid rgba(139,92,246,.3);border-radius:8px;margin-top:8px;background:rgba(139,92,246,.04);">
      <div style="font-size:10px;color:#8b5cf6;font-family:monospace;margin-bottom:8px;display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.04em;"><i class="bi bi-sticky-fill"></i> Nota interna — solo en este navegador</div>
      <textarea id="req-nota-input-${key}" rows="3" placeholder="Escribe una nota privada sobre este requerimiento..." style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid rgba(139,92,246,.3);border-radius:8px;background:var(--bg-main);color:var(--text-main);resize:vertical;margin-bottom:8px;outline:none;font-family:inherit;" oninput="reqSaveNota('${key}',this.value)">${noteVal}</textarea>
      <button class="btn-outline-sm" style="font-size:11px;color:#ef4444;border-color:rgba(239,68,68,.3);" onclick="reqClearNota('${key}',this)"><i class="bi bi-trash3"></i> Borrar nota</button>
    </div>`;
}

function _reqCloseAllInlines(key) {
    ['comentar','asig','cerrar','reanudar','nota'].forEach(id => {
        const el = document.getElementById('req-' + id + '-' + key);
        if (el) el.style.display = 'none';
    });
}

// ── Render ticket card (REQ-adapted) ─────────────────────────────────────────
function renderReqTicket(issue) {
    const f    = issue.fields || {};
    const key  = issue.key;
    const sum  = f.summary || '(sin resumen)';
    const st   = f.status?.name || '—';
    const pr   = f.priority?.name || '—';
    const asgn = f.assignee?.emailAddress || f.assignee?.displayName || 'Sin asignar';
    const rep  = f.reporter?.emailAddress || f.creator?.emailAddress || '—';
    const crea = reqFmt(f.created);
    const upd  = reqFmt(f.updated);
    const comments = f.comment?.comments || [];
    const lastCmt  = comments[comments.length - 1];
    const cmtHtml  = lastCmt
        ? `<div class="tc-comment"><div class="cm-author">${reqEsc(lastCmt.author?.displayName || '—')} · ${reqFmt(lastCmt.created)}</div>${reqExtractText(lastCmt.body)}</div>`
        : '';
    const isClosed  = /done|resuelto|resolved|cerrado|closed/i.test(st);
    const isPending = /pendiente|waiting|pending/i.test(st);
    const hasNote   = !!(localStorage.getItem('req_note_' + key)?.trim());

    return `<div class="ticket-card" id="req-card-${key}">
      <div class="tc-top">
        <span class="tc-key">${key}</span>
        <span class="tc-summary"><span class="inc-prio ${reqPrioClass(pr)}"></span>${reqEsc(sum)}</span>
        <span class="status-badge ${reqStatusClass(st)}">${reqEsc(st)}</span>
      </div>
      <div class="tc-meta">
        <span>Asignado: <b>${reqEsc(asgn)}</b></span>
        <span>Reporter: <b>${reqEsc(rep)}</b></span>
        <span>Prioridad: <b>${reqEsc(pr)}</b></span>
        <span>Creado: <b>${crea}</b></span>
        <span>Actualizado: <b>${upd}</b></span>
      </div>
      ${cmtHtml}
      ${_reqActionsHTML(key, isClosed, isPending, hasNote)}
      ${_reqInlinesHTML(key)}
    </div>`;
}

function reqToggleComentar(key) {
    const wasOpen = document.getElementById('req-comentar-' + key)?.style.display !== 'none';
    _reqCloseAllInlines(key);
    const el = document.getElementById('req-comentar-' + key);
    if (el && !wasOpen) { el.style.display = 'block'; el.querySelector('textarea')?.focus(); }
}
function reqToggleAsig(key) {
    const wasOpen = document.getElementById('req-asig-' + key)?.style.display !== 'none';
    _reqCloseAllInlines(key);
    const el = document.getElementById('req-asig-' + key);
    if (el && !wasOpen) { el.style.display = 'block'; el.querySelector('input')?.focus(); }
}
function reqToggleCerrar(key) {
    const wasOpen = document.getElementById('req-cerrar-' + key)?.style.display !== 'none';
    _reqCloseAllInlines(key);
    const el = document.getElementById('req-cerrar-' + key);
    if (el && !wasOpen) { el.style.display = 'block'; el.querySelector('textarea')?.focus(); }
}
function reqToggleReanudar(key) {
    const wasOpen = document.getElementById('req-reanudar-' + key)?.style.display !== 'none';
    _reqCloseAllInlines(key);
    const el = document.getElementById('req-reanudar-' + key);
    if (el && !wasOpen) { el.style.display = 'block'; el.querySelector('textarea')?.focus(); }
}
function reqToggleNota(key, btn) {
    const wasOpen = document.getElementById('req-nota-' + key)?.style.display !== 'none';
    _reqCloseAllInlines(key);
    const el = document.getElementById('req-nota-' + key);
    if (el && !wasOpen) { el.style.display = 'block'; el.querySelector('textarea')?.focus(); }
}

async function _resolveAssignableUser(key, email) {
    let users = await jira('GET', `/rest/api/3/user/assignable/search?issueKey=${encodeURIComponent(key)}&query=${encodeURIComponent(email)}`);
    if (!users.length) {
        const all = await jira('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
        users = all.filter(u => u.accountType === 'atlassian' || !u.accountType?.startsWith('customer'));
    }
    if (!users.length) throw new Error(`"${email}" no es un agente Jira asignable. Verifica que tenga licencia activa.`);
    return users[0];
}

async function reqAsignarme(key) {
    const email = getJiraEmail();
    if (!email) return;
    try {
        const { accountId, displayName } = await _resolveAssignableUser(key, email);
        await jira('PUT', `/rest/api/3/issue/${key}/assignee`, { accountId });
        showToast(`✓ ${key} asignado a ${displayName}`, 'success');
        const card = document.getElementById('req-card-' + key);
        if (card) card.querySelector('.tc-meta span b')?.parentElement && (card.querySelector('.tc-meta span:first-child b').textContent = displayName);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function reqEjecutarAsignar(key) {
    const email = document.getElementById('req-asig-input-' + key)?.value?.trim();
    if (!email) { showToast('Ingresa un correo', 'error'); return; }
    try {
        const { accountId, displayName } = await _resolveAssignableUser(key, email);
        await jira('PUT', `/rest/api/3/issue/${key}/assignee`, { accountId });
        showToast(`✓ ${key} asignado a ${displayName}`, 'success');
        reqToggleAsig(key);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

async function reqEjecutarComentar(key) {
    const text = document.getElementById('req-cmt-input-' + key)?.value?.trim();
    if (!text) { showToast('Ingresa un comentario', 'error'); return; }
    try {
        await jira('POST', `/rest/api/3/issue/${key}/comment`, {
            body: { type:'doc', version:1, content:[{ type:'paragraph', content:[{ type:'text', text }] }] }
        });
        showToast(`✓ Comentario agregado a ${key}`, 'success');
        reqToggleComentar(key);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}

// ── Cola Jira — Mis asignados ────────────────────────────────────────────────
async function reqLoadMisAsig() {
    const statusFilter = document.getElementById('req-filter-misAsig-status')?.value || '';
    const email = getJiraEmail();
    const list  = document.getElementById('req-list-misAsig');
    if (!list) return;
    if (!email) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>Correo Jira no configurado.<br><button class="btn-outline-sm mt-2" onclick="localStorage.removeItem('jira_email');reqLoadMisAsig()">Configurar correo</button></p></div>`;
        return;
    }
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    let jql = `project = REQ AND assignee = "${email}" AND status != Done ORDER BY updated DESC`;
    if (statusFilter) jql = `project = REQ AND assignee = "${email}" AND status = "${statusFilter}" ORDER BY updated DESC`;
    try {
        const data   = await jira('GET', `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,assignee,reporter,priority,created,updated,comment`);
        const issues = data.issues || [];
        const total  = data.total ?? issues.length;
        const badge  = document.getElementById('req-badge-misAsig');
        if (badge) { badge.textContent = total; badge.style.display = total ? '' : 'none'; }
        const sub = document.getElementById('reqTopbarSub'); if (sub) sub.textContent = `${total} requerimientos`;
        list.innerHTML = issues.length
            ? issues.map(i => renderReqTicket(i)).join('')
            : `<div class="empty-state"><i class="bi bi-inbox"></i><p>No tienes requerimientos asignados</p></div>`;
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

// ── Cola Jira — Sin asignar ──────────────────────────────────────────────────
async function reqLoadSinAsig() {
    const list = document.getElementById('req-list-sinAsig');
    if (!list) return;
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    const jql = `project = REQ AND assignee is EMPTY AND status != Done ORDER BY created DESC`;
    try {
        const data  = await jira('GET', `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,assignee,reporter,priority,created,updated,comment`);
        const items = data.issues || [];
        const total = data.total ?? items.length;
        const badge = document.getElementById('req-badge-sinAsig');
        if (badge) { badge.textContent = total; badge.style.display = total ? '' : 'none'; }
        const sub = document.getElementById('reqTopbarSub'); if (sub) sub.textContent = `${total} sin asignar`;
        list.innerHTML = items.length
            ? items.map(i => renderReqTicket(i)).join('')
            : `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;"></i><p>No hay requerimientos sin asignar</p></div>`;
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

// ── Buscar requerimiento ─────────────────────────────────────────────────────
async function reqBuscarTicket() {
    const val = (document.getElementById('reqSearchJiraInput')?.value || '').trim();
    if (!val) return;
    const key = val.toUpperCase().startsWith('REQ-') ? val.toUpperCase() : 'REQ-' + val;
    const res = document.getElementById('req-result-buscar');
    if (!res) return;
    res.innerHTML = '<div class="inc-skeleton"></div>';
    try {
        const issue = await jira('GET', `/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter,priority,created,updated,comment`);
        res.innerHTML = renderReqTicket(issue);
    } catch (e) {
        res.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><p>No se encontró <b>${key}</b> — ${reqEsc(e.message)}</p></div>`;
    }
}

// ── Histórico ────────────────────────────────────────────────────────────────
let _reqHistChart = null;

function reqAutoLoadHistorico() {
    const input = document.getElementById('reqHistEmail');
    if (!input) return;
    if (!input.value) {
        const saved = localStorage.getItem('jira_email') || (typeof CURRENT_USER_EMAIL !== 'undefined' ? CURRENT_USER_EMAIL : '') || '';
        if (saved) input.value = saved;
    }
    if (input.value) reqBuscarHistorico();
}

async function reqBuscarHistorico() {
    const email = (document.getElementById('reqHistEmail')?.value || '').trim();
    const days  = document.getElementById('reqHistDays')?.value || '30';
    const role  = document.getElementById('reqHistRole')?.value || 'reporter';
    if (!email) { showToast('Ingresa un correo', 'error'); return; }

    const dayClause = (days && days !== '0') ? ` AND created >= -${days}d` : '';
    const jql = `project = REQ AND ${role} = "${email}"${dayClause} ORDER BY created DESC`;

    const res = document.getElementById('req-result-historico');
    if (!res) return;
    res.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';

    try {
        const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate'];
        const data = await jira('POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 200 });
        const issues = data.issues || [];
        const total  = data.total ?? issues.length;

        const sub = document.getElementById('reqTopbarSub'); if (sub) sub.textContent = `${total} requerimientos`;

        if (!issues.length) {
            res.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><p>Sin requerimientos para <b>${reqEsc(email)}</b></p></div>`;
            return;
        }

        // ── Métricas ─────────────────────────────────────────────────────────
        const now = Date.now();
        const SLA_HRS = { highest:4,critical:4,p1:4,high:8,p2:8,medium:24,p3:24,low:48,p4:48,lowest:48 };
        const fmtHrs  = h => h < 1 ? Math.round(h*60)+'min' : h < 24 ? h.toFixed(1)+'h' : Math.round(h/24)+'d';

        let cntOpen = 0, cntClosed = 0, mttrTotal = 0, mttrCount = 0;
        let slaOk = 0, slaBreach = 0;
        const byPrio = {}, resolvedTimes = [];

        for (const issue of issues) {
            const f = issue.fields || {};
            const stL = (f.status?.name || '').toLowerCase();
            const isDone = /cerr|done|closed|resuelto|resolved|completado/.test(stL);
            if (isDone) cntClosed++; else cntOpen++;

            const prioName = f.priority?.name || 'Sin prioridad';
            byPrio[prioName] = (byPrio[prioName] || 0) + 1;

            const pk   = prioName.toLowerCase().replace(/\s+/g,'');
            const sHrs = SLA_HRS[pk] || (pk.includes('high') ? 8 : pk.includes('low') ? 48 : 24);
            const creMs = f.created ? new Date(f.created).getTime() : 0;
            const resMs = f.resolutiondate ? new Date(f.resolutiondate).getTime() : 0;

            if (isDone && creMs && resMs) {
                const hh = (resMs - creMs) / 3600000;
                mttrTotal += hh; mttrCount++;
                resolvedTimes.push(hh);
                if (hh <= sHrs) slaOk++; else slaBreach++;
            } else if (!isDone && creMs) {
                const hh = (now - creMs) / 3600000;
                if (hh > sHrs) slaBreach++; else slaOk++;
            }
        }

        const avgMttr = mttrCount ? mttrTotal / mttrCount : 0;
        const slaPct  = (slaOk + slaBreach) ? Math.round(slaOk / (slaOk + slaBreach) * 100) : null;
        const minMttr = resolvedTimes.length ? Math.min(...resolvedTimes) : null;
        const maxMttr = resolvedTimes.length ? Math.max(...resolvedTimes) : null;

        // ── Chart data (creados y resueltos por día) ──────────────────────────
        const chartDays = Math.min(parseInt(days) || 30, 30);
        const dayBuckets = [], creByDay = {}, resByDay = {};
        for (let i = chartDays - 1; i >= 0; i--) {
            const k = new Date(now - i * 86400000).toISOString().slice(0, 10);
            dayBuckets.push(k); creByDay[k] = 0; resByDay[k] = 0;
        }
        for (const issue of issues) {
            const f = issue.fields || {};
            const cd = f.created?.slice(0, 10);
            const rd = f.resolutiondate?.slice(0, 10);
            if (cd && Object.prototype.hasOwnProperty.call(creByDay, cd)) creByDay[cd]++;
            if (rd && Object.prototype.hasOwnProperty.call(resByDay, rd)) resByDay[rd]++;
        }
        const chartLabels = dayBuckets.map(d => { const [,m,dy] = d.split('-'); return `${dy}/${m}`; });

        // ── Insights ─────────────────────────────────────────────────────────
        const insights = [];
        if (slaPct !== null && slaPct < 80)  insights.push({ icon:'bi-exclamation-triangle-fill', c:'#ef4444', msg:`Solo el <b>${slaPct}%</b> de requerimientos cumplen SLA — objetivo ≥80%` });
        if (slaBreach > 0)                    insights.push({ icon:'bi-lightning-charge-fill',     c:'#ef4444', msg:`<b>${slaBreach}</b> requerimiento${slaBreach>1?'s':''} con SLA vencido` });
        if (avgMttr > 48)                     insights.push({ icon:'bi-clock-history',             c:'#f59e0b', msg:`Tiempo promedio de resolución: <b>${fmtHrs(avgMttr)}</b>` });
        if (cntOpen > 5)                      insights.push({ icon:'bi-inbox-fill',                c:'#3b82f6', msg:`Hay <b>${cntOpen}</b> requerimientos aún abiertos` });
        if (slaPct !== null && slaPct >= 90)  insights.push({ icon:'bi-trophy-fill',               c:'#10b981', msg:`¡Excelente! <b>${slaPct}%</b> de SLA cumplido` });
        if (avgMttr > 0 && avgMttr <= 24)    insights.push({ icon:'bi-lightning-fill',             c:'#10b981', msg:`Buen ritmo: tiempo promedio <b>${fmtHrs(avgMttr)}</b>` });
        if (cntClosed === total && total > 0) insights.push({ icon:'bi-check-circle-fill',         c:'#10b981', msg:`Todos los requerimientos están cerrados — sin pendientes` });

        // ── Priority bars ─────────────────────────────────────────────────────
        const PRIO_COLORS = { highest:'#ef4444',critical:'#ef4444',high:'#f59e0b',medium:'#3b82f6',low:'#10b981',lowest:'#6b7280' };
        const prioEntries = Object.entries(byPrio).sort((a, b) => b[1] - a[1]);
        const maxPrioCount = Math.max(...prioEntries.map(e => e[1]), 1);

        // ── Render ────────────────────────────────────────────────────────────
        res.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:14px;">
            <div class="stat-card"><div class="stat-val c-blue">${total}</div><div class="stat-lbl">Total</div></div>
            <div class="stat-card"><div class="stat-val c-amber">${cntOpen}</div><div class="stat-lbl">Abiertos</div></div>
            <div class="stat-card"><div class="stat-val c-green">${cntClosed}</div><div class="stat-lbl">Cerrados</div></div>
            <div class="stat-card"><div class="stat-val" style="color:#7c3aed;">${avgMttr ? fmtHrs(avgMttr) : '—'}</div><div class="stat-lbl">MTTR prom.</div></div>
            <div class="stat-card"><div class="stat-val ${slaPct!=null?(slaPct>=80?'c-green':'c-red'):''}">${slaPct!=null?slaPct+'%':'—'}</div><div class="stat-lbl">SLA %</div></div>
            ${minMttr!=null?`<div class="stat-card"><div class="stat-val c-green">${fmtHrs(minMttr)}</div><div class="stat-lbl">Más rápido</div></div>`:''}
            ${maxMttr!=null?`<div class="stat-card"><div class="stat-val c-amber">${fmtHrs(maxMttr)}</div><div class="stat-lbl">Más lento</div></div>`:''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 200px;gap:12px;margin-bottom:14px;">
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px;">
                <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Requerimientos — últimos ${chartDays} días</div>
                <div style="height:110px;"><canvas id="reqChartHistorico"></canvas></div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px;">
                <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Por prioridad</div>
                ${prioEntries.map(([prio,cnt]) => {
                    const pk2 = prio.toLowerCase().replace(/\s+/g,'');
                    const clr = Object.entries(PRIO_COLORS).find(([k]) => pk2.includes(k))?.[1] || '#94a3b8';
                    return `<div style="margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
                            <span style="color:var(--text-muted);">${reqEsc(prio)}</span>
                            <b style="color:var(--text-main);">${cnt}</b>
                        </div>
                        <div style="height:4px;background:var(--bg-header);border-radius:2px;">
                            <div style="width:${Math.round(cnt/maxPrioCount*100)}%;height:100%;background:${clr};border-radius:2px;"></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>

        ${insights.length ? `
        <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;"><i class="bi bi-bar-chart-fill" style="margin-right:4px;"></i>Insights</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${insights.map(ins => `<div style="display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.5;">
                    <i class="bi ${ins.icon}" style="color:${ins.c};flex-shrink:0;margin-top:2px;"></i>
                    <span style="color:var(--text-main);">${ins.msg}</span>
                </div>`).join('')}
            </div>
        </div>` : ''}

        <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">${issues.length} requerimientos</div>
        <div>${issues.map(i => renderReqTicket(i)).join('')}</div>`;

        // ── Chart ─────────────────────────────────────────────────────────────
        requestAnimationFrame(() => {
            const canvas = document.getElementById('reqChartHistorico');
            if (!canvas) return;
            if (_reqHistChart) { try { _reqHistChart.destroy(); } catch(_){} }
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const gClr = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
            const tClr = isDark ? '#6b7280' : '#9ca3af';
            _reqHistChart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [
                        { label:'Creados',   data: dayBuckets.map(d => creByDay[d]), backgroundColor:'rgba(99,102,241,.65)',  borderRadius:3, borderSkipped:false },
                        { label:'Resueltos', data: dayBuckets.map(d => resByDay[d]), backgroundColor:'rgba(16,185,129,.65)', borderRadius:3, borderSkipped:false }
                    ]
                },
                options: {
                    responsive:true, maintainAspectRatio:false,
                    plugins: {
                        legend: { position:'top', align:'start', labels:{ font:{size:10}, padding:8, boxWidth:10, boxHeight:10, color:tClr } },
                        tooltip: { mode:'index', intersect:false }
                    },
                    scales: {
                        x: { grid:{display:false}, ticks:{font:{size:9},color:tClr,maxRotation:0,maxTicksLimit:10}, border:{display:false} },
                        y: { grid:{color:gClr}, ticks:{font:{size:9},color:tClr,stepSize:1,maxTicksLimit:5}, beginAtZero:true, border:{display:false} }
                    },
                    animation:{duration:300}
                }
            });
        });

    } catch (e) {
        res.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

// ── En Curso & Kanban ────────────────────────────────────────────────────────
const _REQ_TECH_PALETTE = ['#6366f1','#8b5cf6','#0891b2','#059669','#d97706','#dc2626','#db2777','#2563eb','#0284c7','#16a34a'];
function _reqTechColor(name) {
    if (!name || name === 'Sin asignar') return '#64748b';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return _REQ_TECH_PALETTE[h % _REQ_TECH_PALETTE.length];
}
function _reqAvatar(name) {
    if (!name || name === 'Sin asignar') return '';
    const parts = (name||'').trim().split(/\s+/);
    const ini = ((parts[0]||'')[0]||'') + ((parts[1]||'')[0]||'');
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${_reqTechColor(name)};color:#fff;font-size:9px;font-weight:700;flex-shrink:0;" title="${reqEsc(name)}">${ini.toUpperCase()||'?'}</span>`;
}
function _reqFmtAge(ms) {
    if (!ms || ms <= 0) return '';
    if (ms < 3600000) return Math.ceil(ms/60000)+'min';
    if (ms < 86400000) return Math.floor(ms/3600000)+'h';
    return Math.floor(ms/86400000)+'d';
}

let _reqEnCursoAll = [];
let _reqEnCursoFilter = 'todos';

async function reqLoadEnCurso(force) {
    const list = document.getElementById('req-list-enCurso');
    if (!list) return;
    if (!force && _reqEnCursoAll.length) { _reqApplyEnCurso(); return; }
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    try {
        const data = await jira('POST', '/rest/api/3/search/jql', {
            jql: 'project = REQ AND assignee is not EMPTY AND status NOT IN (Done,Cerrado,Resuelto,Resolved,"Completado") ORDER BY created ASC',
            maxResults: 100,
            fields: ['summary','status','assignee','reporter','priority','created','updated','comment']
        });
        _reqEnCursoAll = data.issues || [];
        const badge = document.getElementById('req-badge-enCurso');
        if (badge) { badge.textContent = _reqEnCursoAll.length; badge.style.display = _reqEnCursoAll.length ? '' : 'none'; }
        _reqApplyEnCurso();
    } catch (e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

function reqFilterEnCurso(f, el) {
    _reqEnCursoFilter = f;
    document.querySelectorAll('.req-ec-pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
    _reqApplyEnCurso();
}

function _reqApplyEnCurso() {
    const list = document.getElementById('req-list-enCurso');
    const sub  = document.getElementById('reqTopbarSub');
    if (!list) return;
    let filtered = _reqEnCursoAll;
    if (_reqEnCursoFilter !== 'todos') {
        filtered = filtered.filter(i => {
            const st = (i.fields?.status?.name || '').toLowerCase();
            if (_reqEnCursoFilter === 'progreso')   return /progr|curso|progress/.test(st);
            if (_reqEnCursoFilter === 'pendiente')  return /pend|wait/.test(st);
            if (_reqEnCursoFilter === 'aprobacion') return /approv|aprob/.test(st);
            return true;
        });
    }
    if (sub) sub.textContent = `${filtered.length} en curso`;
    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;font-size:2rem;"></i><p>Sin requerimientos en este estado</p></div>`;
        return;
    }
    list.innerHTML = filtered.map(i => _renderReqEnCursoCard(i)).join('');
}

function _renderReqEnCursoCard(issue) {
    const f    = issue.fields || {};
    const key  = issue.key;
    const sum  = f.summary || '(sin resumen)';
    const st   = f.status?.name || '—';
    const pr   = f.priority?.name || '—';
    const asgn = f.assignee?.displayName || f.assignee?.emailAddress || 'Sin asignar';
    const rep  = f.reporter?.emailAddress || f.reporter?.displayName || '—';
    const crea = reqFmt(f.created);
    const ageMs   = f.created ? Date.now() - new Date(f.created).getTime() : 0;
    const ageStr  = _reqFmtAge(ageMs);
    const ageColor = ageMs > 5*86400000 ? '#ef4444' : ageMs > 2*86400000 ? '#f59e0b' : '#10b981';
    const comments = f.comment?.comments || [];
    const lastCmt  = comments[comments.length-1];
    const cmtHtml  = lastCmt ? `<div class="tc-comment"><div class="cm-author">${reqEsc(lastCmt.author?.displayName||'—')} · ${reqFmt(lastCmt.created)}</div>${reqExtractText(lastCmt.body)}</div>` : '';
    const isClosed  = /done|resuelto|resolved|cerrado|closed/i.test(st);
    const isPending = /pendiente|waiting|pending/i.test(st);
    const hasNote   = !!(localStorage.getItem('req_note_' + key)?.trim());
    return `<div class="ticket-card" id="req-card-${key}" style="border-left:4px solid ${ageColor};">
      <div class="tc-top">
        <span class="tc-key">${key}</span>
        <span class="tc-summary"><span class="inc-prio ${reqPrioClass(pr)}"></span>${reqEsc(sum)}</span>
        ${ageMs ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:800;padding:2px 8px;border-radius:5px;background:${ageColor}18;color:${ageColor};font-family:monospace;white-space:nowrap;flex-shrink:0;"><i class="bi bi-clock-fill" style="font-size:9px;"></i> ${ageStr}</span>` : ''}
        <span class="status-badge ${reqStatusClass(st)}">${reqEsc(st)}</span>
        ${_reqAvatar(asgn)}
      </div>
      <div class="tc-meta">
        <span>Asignado: <b>${reqEsc(asgn)}</b></span>
        <span>Reporter: <b>${reqEsc(rep)}</b></span>
        <span>Prioridad: <b>${reqEsc(pr)}</b></span>
        <span>Creado: <b>${crea}</b></span>
      </div>
      ${cmtHtml}
      ${_reqActionsHTML(key, isClosed, isPending, hasNote)}
      ${_reqInlinesHTML(key)}
    </div>`;
}

// ── Kanban ────────────────────────────────────────────────────────────────────
let _reqKanbanAll = [];
const _REQ_KB_COLS = [
    { id:'aprobacion', label:'Para Aprobar',  icon:'bi-clipboard-check-fill', color:'#6366f1', match: st => /approv|aprob/i.test(st) },
    { id:'progreso',   label:'En Progreso',   icon:'bi-play-circle-fill',     color:'#0891b2', match: st => /progr|curso|progress|open|abierto/i.test(st) },
    { id:'pendiente',  label:'Pendiente',     icon:'bi-pause-circle-fill',    color:'#f59e0b', match: st => /pend|wait/i.test(st) },
    { id:'otros',      label:'Otros',         icon:'bi-three-dots',           color:'#64748b', match: () => true },
];

async function reqLoadKanban(force) {
    const board = document.getElementById('req-kanban-board');
    if (!board) return;
    if (!force && _reqKanbanAll.length) { _reqRenderKanban(); return; }
    board.innerHTML = `<div style="grid-column:1/-1;padding:20px;color:var(--text-muted);font-size:12px;display:flex;align-items:center;gap:8px;"><span class="req-spin"></span> Cargando Kanban…</div>`;
    try {
        const data = await jira('POST', '/rest/api/3/search/jql', {
            jql: 'project = REQ AND status NOT IN (Done,Cerrado,Resuelto,Resolved,"Completado") ORDER BY priority ASC, created ASC',
            maxResults: 200,
            fields: ['summary','status','assignee','priority','created']
        });
        _reqKanbanAll = data.issues || [];
        _reqRenderKanban();
        const sub = document.getElementById('reqTopbarSub');
        if (sub) sub.textContent = `${_reqKanbanAll.length} activos`;
    } catch (e) {
        board.innerHTML = `<div style="grid-column:1/-1;padding:20px;color:#ef4444;font-size:12px;">${reqEsc(e.message)}</div>`;
        showToast(e.message, 'error');
    }
}

function _reqRenderKanban() {
    const board = document.getElementById('req-kanban-board');
    if (!board) return;
    const cols = _REQ_KB_COLS.map(c => ({ ...c, items: [] }));
    _reqKanbanAll.forEach(issue => {
        const st = issue.fields?.status?.name || '';
        const col = cols.find(c => c.id !== 'otros' && c.match(st)) || cols[cols.length-1];
        col.items.push(issue);
    });
    board.innerHTML = cols.map(col => `
        <div class="req-kb-col">
          <div class="req-kb-col-header" style="border-top:3px solid ${col.color};">
            <span style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text-main);">
              <i class="bi ${col.icon}" style="color:${col.color};"></i> ${col.label}
            </span>
            <span style="font-size:11px;font-weight:700;color:${col.color};background:${col.color}18;padding:1px 8px;border-radius:10px;">${col.items.length}</span>
          </div>
          <div class="req-kb-cards">
            ${col.items.length
              ? col.items.map(i => _reqKbCard(i, col.color)).join('')
              : '<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:16px;opacity:.6;">Sin requerimientos</div>'}
          </div>
        </div>`).join('');
}

function _reqKbCard(issue, colColor) {
    const f    = issue.fields || {};
    const key  = issue.key;
    const sum  = (f.summary||'').length > 80 ? f.summary.slice(0,77)+'…' : (f.summary||'—');
    const pr   = f.priority?.name || '—';
    const asgn = f.assignee?.displayName || f.assignee?.emailAddress || 'Sin asignar';
    const ageMs   = f.created ? Date.now() - new Date(f.created).getTime() : 0;
    const ageStr  = _reqFmtAge(ageMs);
    const ageColor = ageMs > 5*86400000 ? '#ef4444' : ageMs > 2*86400000 ? '#f59e0b' : '#10b981';
    const prioIcon = /high|alta|critico|critical/i.test(pr) ? '🔴' : /medium|media/i.test(pr) ? '🟡' : '🟢';
    return `<div class="req-kb-card" onclick="window.open('https://integratelperu.atlassian.net/browse/${key}','_blank')" title="${reqEsc(f.summary||'')}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
        <span style="font-size:10px;font-family:monospace;font-weight:700;color:${colColor};">${key}</span>
        <span style="font-size:10px;">${prioIcon}</span>
        <span style="margin-left:auto;font-size:10px;font-weight:700;color:${ageColor};font-family:monospace;">${ageStr}</span>
      </div>
      <div style="font-size:11px;font-weight:600;color:var(--text-main);line-height:1.35;margin-bottom:6px;">${reqEsc(sum)}</div>
      <div style="display:flex;align-items:center;gap:6px;">
        ${_reqAvatar(asgn)}
        <span style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${reqEsc(asgn.split(/\s+/).slice(0,2).join(' '))}</span>
      </div>
    </div>`;
}

// ── MONITOREO — shared data cache ───────────────────────────────────────────
let _reqMonData = null;

async function _reqEnsureMonData(force, loadingEl) {
    if (!force && _reqMonData !== null) return _reqMonData;
    if (loadingEl) loadingEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px;font-size:12px;color:var(--text-muted);"><span class="req-spin"></span> Cargando datos…</div>';
    const d = await jira('POST', '/rest/api/3/search/jql', {
        jql: 'project = REQ AND created >= -90d ORDER BY created DESC',
        maxResults: 500,
        fields: ['summary','status','assignee','priority','created','updated','resolutiondate','issuetype','components']
    });
    _reqMonData = d.issues || [];
    return _reqMonData;
}

// SLA thresholds (hours) per priority name
const _REQ_SLA_H = { alta:4, high:4, highest:1, critical:1, critico:1, media:24, medium:24, baja:72, low:72, lowest:72 };
function _reqSlaHrs(prio) {
    return _REQ_SLA_H[(prio||'').toLowerCase().replace(/\s+/g,'')] || 24;
}
function _reqSlaLevel(issue) {
    const f = issue.fields || {};
    const closed = /(done|cerr|resuelto|resolved|completado)/i.test(f.status?.name||'');
    const slaMs  = _reqSlaHrs(f.priority?.name) * 3600000;
    const creMs  = f.created ? new Date(f.created).getTime() : 0;
    if (!creMs) return 'ok';
    if (closed) {
        if (!f.resolutiondate) return 'ok';
        return (new Date(f.resolutiondate).getTime() - creMs) <= slaMs ? 'ok' : 'breach';
    }
    const pct = (Date.now() - creMs) / slaMs * 100;
    if (pct >= 100) return 'breach';
    if (pct >= 80)  return 'critical';
    if (pct >= 50)  return 'warning';
    return 'ok';
}

// ── TÉCNICOS ─────────────────────────────────────────────────────────────────
async function reqLoadTecnicos(force) {
    const el = document.getElementById('req-panel-tecnicos-content');
    if (!el) return;
    try {
        const issues = await _reqEnsureMonData(force, el);
        _reqRenderTecnicos(issues, el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function _reqRenderTecnicos(issues, el) {
    const now = Date.now();
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    const byTech = {};
    issues.forEach(i => {
        const f    = i.fields || {};
        const name = f.assignee?.displayName || f.assignee?.emailAddress || 'Sin asignar';
        if (!byTech[name]) byTech[name] = { name, active:0, closedMonth:0, ages:[] };
        const closed = /(done|cerr|resuelto|resolved|completado)/i.test(f.status?.name||'');
        if (closed) {
            if (f.resolutiondate && new Date(f.resolutiondate) >= monthStart) byTech[name].closedMonth++;
        } else {
            byTech[name].active++;
            if (f.created) byTech[name].ages.push(now - new Date(f.created).getTime());
        }
    });
    const rows = Object.values(byTech).filter(t => t.name !== 'Sin asignar').sort((a,b) => b.active - a.active);
    const unasigned = byTech['Sin asignar'] || { active:0, closedMonth:0 };
    if (!rows.length && !unasigned.active) {
        el.innerHTML = '<div class="empty-state"><p>Sin datos de técnicos en los últimos 90 días</p></div>';
        return;
    }
    const maxActive = Math.max(...rows.map(r => r.active), 1);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        <div class="stat-card"><div class="stat-val" style="color:#6366f1;">${rows.length}</div><div class="stat-lbl">Técnicos activos</div></div>
        <div class="stat-card"><div class="stat-val" style="color:#f59e0b;">${rows.reduce((s,r)=>s+r.active,0)}</div><div class="stat-lbl">REQ asignados</div></div>
        <div class="stat-card"><div class="stat-val" style="color:#10b981;">${rows.reduce((s,r)=>s+r.closedMonth,0)}</div><div class="stat-lbl">Cerrados este mes</div></div>
        ${unasigned.active ? `<div class="stat-card" style="border-top:2px solid #ef4444;"><div class="stat-val" style="color:#ef4444;">${unasigned.active}</div><div class="stat-lbl">Sin asignar</div></div>` : ''}
      </div>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:540px;">
        <thead><tr style="background:var(--bg-header);border-bottom:2px solid var(--border-soft);">
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Técnico</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Activos</th>
          <th style="padding:8px 10px;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;min-width:100px;">Carga</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Cerrados (mes)</th>
          <th style="padding:8px;text-align:center;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Más antiguo</th>
        </tr></thead>
        <tbody>${rows.map((r,idx) => {
          const oldest     = r.ages.length ? Math.max(...r.ages) : 0;
          const oldestStr  = _reqFmtAge(oldest);
          const oldColor   = oldest > 5*86400000 ? '#ef4444' : oldest > 2*86400000 ? '#f59e0b' : '#10b981';
          const barPct     = Math.round(r.active / maxActive * 100);
          const col        = _reqTechColor(r.name);
          return `<tr style="border-bottom:1px solid var(--border-soft);">
            <td style="padding:8px 10px;">
              <div style="display:flex;align-items:center;gap:8px;">
                ${_reqAvatar(r.name)}
                <span style="font-weight:600;color:var(--text-main);">${reqEsc(r.name)}</span>
                ${idx === 0 && r.active > 0 ? '<span style="font-size:9px;background:rgba(99,102,241,.12);color:#6366f1;border-radius:4px;padding:1px 6px;font-weight:700;flex-shrink:0;">MAYOR CARGA</span>' : ''}
              </div>
            </td>
            <td style="padding:8px;text-align:center;font-size:15px;font-weight:800;color:${col};">${r.active}</td>
            <td style="padding:8px 10px;">
              <div style="height:8px;background:var(--bg-header);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${barPct}%;background:${col};border-radius:4px;"></div>
              </div>
            </td>
            <td style="padding:8px;text-align:center;font-size:13px;font-weight:700;color:#10b981;">${r.closedMonth}</td>
            <td style="padding:8px;text-align:center;font-size:11px;font-weight:700;color:${oldColor};font-family:monospace;">${oldestStr || '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
}

// ── SLA ───────────────────────────────────────────────────────────────────────
async function reqLoadSLA(force) {
    const el = document.getElementById('req-panel-sla-content');
    if (!el) return;
    try {
        const issues = await _reqEnsureMonData(force, el);
        _reqRenderSLA(issues, el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function _reqRenderSLA(issues, el) {
    const open   = issues.filter(i => !/(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||''));
    const levels = { breach:[], critical:[], warning:[], ok:[] };
    open.forEach(i => (levels[_reqSlaLevel(i)] || levels.ok).push(i));
    const total  = open.length || 1;
    const { breach, critical, warning, ok } = { breach:levels.breach.length, critical:levels.critical.length, warning:levels.warning.length, ok:levels.ok.length };
    const urgent = [...levels.breach.map(i=>({i,lvl:'breach'})), ...levels.critical.map(i=>({i,lvl:'critical'}))];
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
        <div class="stat-card" style="border-top:3px solid #10b981;"><div class="stat-val" style="color:#10b981;">${ok}</div><div class="stat-lbl">Al día</div></div>
        <div class="stat-card" style="border-top:3px solid #eab308;"><div class="stat-val" style="color:#eab308;">${warning}</div><div class="stat-lbl">Aviso (50%+)</div></div>
        <div class="stat-card" style="border-top:3px solid #f97316;"><div class="stat-val" style="color:#f97316;">${critical}</div><div class="stat-lbl">Crítico (80%+)</div></div>
        <div class="stat-card" style="border-top:3px solid #ef4444;"><div class="stat-val" style="color:#ef4444;">${breach}</div><div class="stat-lbl">Vencido</div></div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="height:10px;background:var(--bg-header);border-radius:5px;overflow:hidden;display:flex;">
          <div style="width:${breach/total*100}%;background:#ef4444;"></div>
          <div style="width:${critical/total*100}%;background:#f97316;"></div>
          <div style="width:${warning/total*100}%;background:#eab308;"></div>
          <div style="width:${ok/total*100}%;background:#10b981;"></div>
        </div>
        <div style="display:flex;gap:14px;margin-top:6px;font-size:10px;color:var(--text-muted);">
          <span><span style="display:inline-block;width:8px;height:8px;background:#ef4444;border-radius:2px;margin-right:3px;"></span>Vencido</span>
          <span><span style="display:inline-block;width:8px;height:8px;background:#f97316;border-radius:2px;margin-right:3px;"></span>Crítico</span>
          <span><span style="display:inline-block;width:8px;height:8px;background:#eab308;border-radius:2px;margin-right:3px;"></span>Aviso</span>
          <span><span style="display:inline-block;width:8px;height:8px;background:#10b981;border-radius:2px;margin-right:3px;"></span>Al día</span>
          <span style="margin-left:auto;font-size:11px;font-weight:600;color:var(--text-muted);">SLA: P1=1h · Alta=4h · Media=24h · Baja=72h</span>
        </div>
      </div>
      ${urgent.length ? `
      <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
        <i class="bi bi-exclamation-triangle-fill" style="color:#ef4444;"></i> Requieren atención (${urgent.length})
      </div>
      <div class="ticket-list">${urgent.slice(0,15).map(({i,lvl}) => {
          const f       = i.fields || {};
          const ageMs   = f.created ? Date.now() - new Date(f.created).getTime() : 0;
          const slaMs   = _reqSlaHrs(f.priority?.name) * 3600000;
          const remain  = slaMs - ageMs;
          const bdrCol  = lvl === 'breach' ? '#ef4444' : '#f97316';
          return `<div class="ticket-card" style="border-left:4px solid ${bdrCol};padding:8px 12px;">
            <div class="tc-top">
              <span class="tc-key">${i.key}</span>
              <span class="tc-summary">${reqEsc(f.summary||'')}</span>
              <span style="font-size:10px;font-weight:800;color:${bdrCol};font-family:monospace;white-space:nowrap;flex-shrink:0;">${lvl==='breach' ? '⚡ VENCIDO +'+_reqFmtAge(-remain) : '⚠ '+_reqFmtAge(remain)+' restante'}</span>
              <a href="https://integratelperu.atlassian.net/browse/${i.key}" target="_blank" style="margin-left:auto;font-size:11px;color:#6366f1;text-decoration:none;flex-shrink:0;"><i class="bi bi-box-arrow-up-right"></i></a>
            </div>
            <div class="tc-meta">
              <span>Asignado: <b>${reqEsc(f.assignee?.displayName||'Sin asignar')}</b></span>
              <span>Prioridad: <b>${reqEsc(f.priority?.name||'—')}</b></span>
              <span>Creado: <b>${reqFmt(f.created)}</b></span>
              <span>SLA: <b>${_reqSlaHrs(f.priority?.name)}h</b></span>
            </div>
          </div>`;
      }).join('')}</div>` :
      '<div class="empty-state" style="padding:20px;"><i class="bi bi-check2-circle" style="color:#10b981;font-size:2rem;"></i><p style="color:#10b981;">Todos los requerimientos están dentro del SLA</p></div>'}`;
}

// ── CATEGORÍAS ────────────────────────────────────────────────────────────────
async function reqLoadCategorias(force) {
    const el = document.getElementById('req-panel-cat-content');
    if (!el) return;
    try {
        const issues = await _reqEnsureMonData(force, el);
        _reqRenderCategorias(issues, el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

// Global PRIOS key registry so inline onclick handlers can access by index
window._reqCatKeys = ['P1 Crítico','P2 Alto','P3 Medio','P4 Bajo'];

function _reqRenderCategorias(issues, el) {
    const CLOSED_RE = /(done|cerr|resuelto|resolved|completado)/i;
    const PEND_RE   = /pend|wait|espera/i;

    // ── Priority groups ────────────────────────────────────────────────────────
    const PRIOS = [
        { key:'P1 Crítico', re:/critico|critical|highest/i, col:'#ef4444', bg:'rgba(239,68,68,.1)' },
        { key:'P2 Alto',    re:/high|alta/i,                 col:'#f59e0b', bg:'rgba(245,158,11,.1)' },
        { key:'P3 Medio',   re:/medium|media|p3/i,           col:'#6366f1', bg:'rgba(99,102,241,.1)' },
        { key:'P4 Bajo',    re:/low|baja/i,                  col:'#10b981', bg:'rgba(16,185,129,.1)' },
    ];
    const prioBuckets = {};
    PRIOS.forEach(p => { prioBuckets[p.key] = { total:0, open:0, inprog:0, pend:0, closed:0, issues:[] }; });

    issues.forEach(i => {
        const f  = i.fields || {};
        const pr = (f.priority?.name||'').toLowerCase();
        const st = (f.status?.name||'');
        const p  = PRIOS.find(p => p.re.test(pr)) || PRIOS[2];
        const b  = prioBuckets[p.key];
        b.total++; b.issues.push(i);
        if (CLOSED_RE.test(st))    b.closed++;
        else if (PEND_RE.test(st)) b.pend++;
        else if (/progress|curso|progres|asig/i.test(st)) b.inprog++;
        else b.open++;
    });

    // ── Status groups ──────────────────────────────────────────────────────────
    const byStatus = {};
    issues.forEach(i => {
        const s = i.fields?.status?.name || 'Sin estado';
        if (!byStatus[s]) byStatus[s] = { total:0, p1:0, p2:0, p3:0, p4:0 };
        byStatus[s].total++;
        const pr = (i.fields?.priority?.name||'').toLowerCase();
        const pk = PRIOS.findIndex(p => p.re.test(pr));
        if (pk===0) byStatus[s].p1++;
        else if (pk===1) byStatus[s].p2++;
        else if (pk===3) byStatus[s].p4++;
        else byStatus[s].p3++;
    });
    const stSorted = Object.entries(byStatus).sort((a,b)=>b[1].total-a[1].total);

    // ── Técnico workload ───────────────────────────────────────────────────────
    const byTech = {};
    issues.forEach(i => {
        const f  = i.fields || {};
        const nm = f.assignee?.displayName || f.assignee?.emailAddress || '(Sin asignar)';
        if (!byTech[nm]) byTech[nm] = { p1:0,p2:0,p3:0,p4:0,closed:0,total:0 };
        byTech[nm].total++;
        const pr = (f.priority?.name||'').toLowerCase();
        const pk = PRIOS.findIndex(p => p.re.test(pr));
        if (pk===0) byTech[nm].p1++;
        else if (pk===1) byTech[nm].p2++;
        else if (pk===3) byTech[nm].p4++;
        else byTech[nm].p3++;
        if (CLOSED_RE.test(f.status?.name||'')) byTech[nm].closed++;
    });
    const techSorted = Object.entries(byTech).sort((a,b)=>b[1].total-a[1].total).slice(0,10);
    const maxTech    = techSorted[0]?.[1].total || 1;

    // ── Resolucion rate per priority ───────────────────────────────────────────
    const resRate = PRIOS.map(p => {
        const b   = prioBuckets[p.key];
        const pct = b.total ? Math.round(b.closed / b.total * 100) : 0;
        return { ...p, ...b, pct };
    });

    const stCols = ['#6366f1','#22c55e','#f59e0b','#0891b2','#7c3aed','#ec4899','#64748b','#ef4444'];

    el.innerHTML = `
    <!-- ── KPI strip ── -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
      ${PRIOS.map(p => { const b=prioBuckets[p.key]; const pct=b.total?Math.round(b.closed/b.total*100):0; return `
      <div onclick="reqCatDrill('prio',_reqCatKeys[${PRIOS.indexOf(p)}])" style="background:var(--bg-card);border:1px solid var(--border-soft);border-left:4px solid ${p.col};border-radius:10px;padding:12px 14px;cursor:pointer;transition:box-shadow .15s,transform .1s;" onmouseover="this.style.boxShadow='0 3px 14px rgba(0,0,0,.1)';this.style.transform='translateY(-1px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:700;color:${p.col};text-transform:uppercase;letter-spacing:.05em;">${p.key}</span>
          <span style="font-size:18px;font-weight:800;font-family:monospace;color:${p.col};">${b.total}</span>
        </div>
        <div style="display:flex;gap:8px;font-size:10px;color:var(--text-muted);margin-bottom:6px;">
          <span><b style="color:#f59e0b;">${b.open+b.inprog}</b> activos</span>
          <span><b style="color:#0891b2;">${b.pend}</b> pend.</span>
          <span><b style="color:#22c55e;">${b.closed}</b> cerr.</span>
        </div>
        <div style="height:5px;background:var(--bg-header);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${p.col};border-radius:3px;"></div>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:3px;text-align:right;">${pct}% resuelto</div>
      </div>`; }).join('')}
    </div>

    <!-- ── Priority × Status matrix + Estado bars ── -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">

      <!-- Prioridad × Estado matrix -->
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
        <div style="padding:10px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;">
          <i class="bi bi-table" style="color:#6366f1;"></i> Distribución por prioridad
        </div>
        <div style="padding:12px 14px;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr>
              <th style="padding:4px 8px;text-align:left;font-size:9px;font-family:monospace;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-soft);">Prioridad</th>
              <th style="padding:4px 8px;text-align:center;font-size:9px;font-family:monospace;text-transform:uppercase;color:#f59e0b;border-bottom:1px solid var(--border-soft);">Activo</th>
              <th style="padding:4px 8px;text-align:center;font-size:9px;font-family:monospace;text-transform:uppercase;color:#0891b2;border-bottom:1px solid var(--border-soft);">Pendiente</th>
              <th style="padding:4px 8px;text-align:center;font-size:9px;font-family:monospace;text-transform:uppercase;color:#22c55e;border-bottom:1px solid var(--border-soft);">Cerrado</th>
              <th style="padding:4px 8px;text-align:center;font-size:9px;font-family:monospace;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-soft);">Total</th>
              <th style="padding:4px 8px;text-align:center;font-size:9px;font-family:monospace;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-soft);">Resol.%</th>
            </tr></thead>
            <tbody>
              ${resRate.map((p,i) => `<tr onclick="reqCatDrill('prio',_reqCatKeys[${i}])" style="${i%2?'background:var(--bg-header)':''};cursor:pointer;" onmouseover="this.style.background='var(--hover-row)'" onmouseout="this.style.background='${i%2?'var(--bg-header)':''}'" >
                <td style="padding:6px 8px;"><span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:2px;background:${p.col};display:inline-block;"></span><b style="color:${p.col};">${p.key}</b></span></td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:#f59e0b;">${p.open+p.inprog}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:#0891b2;">${p.pend}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:#22c55e;">${p.closed}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:var(--text-main);">${p.total}</td>
                <td style="padding:6px 8px;text-align:center;"><span style="font-size:11px;font-weight:700;color:${p.pct>=80?'#22c55e':p.pct>=50?'#f59e0b':'#ef4444'};">${p.pct}%</span></td>
              </tr>`).join('')}
              <tr style="border-top:2px solid var(--border-soft);">
                <td style="padding:6px 8px;font-size:10px;font-weight:700;color:var(--text-muted);font-family:monospace;">TOTAL</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:#f59e0b;">${resRate.reduce((s,p)=>s+p.open+p.inprog,0)}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:#0891b2;">${resRate.reduce((s,p)=>s+p.pend,0)}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:700;font-family:monospace;color:#22c55e;">${resRate.reduce((s,p)=>s+p.closed,0)}</td>
                <td style="padding:6px 8px;text-align:center;font-weight:800;font-family:monospace;color:var(--text-main);">${issues.length}</td>
                <td style="padding:6px 8px;text-align:center;"><span style="font-size:11px;font-weight:800;color:#6366f1;">${issues.length?Math.round(resRate.reduce((s,p)=>s+p.closed,0)/issues.length*100):0}%</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Estado distribution -->
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
        <div style="padding:10px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;">
          <i class="bi bi-bar-chart-steps" style="color:#0891b2;"></i> Distribución por estado
        </div>
        <div style="padding:12px 14px;">
          ${stSorted.slice(0,8).map(([st,d],i) => {
            const col = stCols[i%stCols.length];
            const pct = Math.round(d.total/issues.length*100);
            const maxSt = stSorted[0][1].total;
            const barPct = Math.round(d.total/maxSt*100);
            const stKey = encodeURIComponent(st);
            return `<div onclick="reqCatDrill('status',decodeURIComponent('${stKey}'))" style="margin-bottom:10px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:background .15s;" onmouseover="this.style.background='var(--hover-row)'" onmouseout="this.style.background=''">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;font-size:11px;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;color:var(--text-main);">${reqEsc(st)}</span>
                <div style="display:flex;gap:10px;align-items:center;flex-shrink:0;">
                  <span style="font-size:10px;color:var(--text-muted);">${pct}%</span>
                  <span style="font-weight:700;font-family:monospace;color:${col};">${d.total}</span>
                </div>
              </div>
              <div style="height:6px;background:var(--bg-header);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${barPct}%;background:${col};border-radius:3px;transition:width .4s;"></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- ── Workload por técnico ── -->
    <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
      <div style="padding:10px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;">
        <i class="bi bi-person-fill-gear" style="color:#7c3aed;"></i> Carga por técnico — últimos 90 días
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted);font-weight:400;text-transform:none;">
          <span style="color:#ef4444;">■</span> P1 &nbsp;<span style="color:#f59e0b;">■</span> P2 &nbsp;<span style="color:#6366f1;">■</span> P3 &nbsp;<span style="color:#10b981;">■</span> P4
        </span>
      </div>
      <div style="padding:12px 14px;">
        ${techSorted.length ? techSorted.map(([nm,d]) => {
          const p1w = Math.round(d.p1/maxTech*100), p2w = Math.round(d.p2/maxTech*100);
          const p3w = Math.round(d.p3/maxTech*100), p4w = Math.round(d.p4/maxTech*100);
          const totW = Math.round(d.total/maxTech*100);
          const res = d.total ? Math.round(d.closed/d.total*100) : 0;
          const techKey = encodeURIComponent(nm);
          return `<div onclick="reqCatDrill('tech',decodeURIComponent('${techKey}'))" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;padding:5px 6px;border-radius:7px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='var(--hover-row)'" onmouseout="this.style.background=''">
            <div style="font-size:11px;font-weight:600;color:var(--text-main);min-width:130px;max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${reqEsc(nm)}">${reqEsc(nm.length>20?nm.slice(0,18)+'…':nm)}</div>
            <div style="flex:1;position:relative;">
              <div style="height:16px;background:var(--bg-header);border-radius:4px;overflow:hidden;display:flex;">
                ${d.p1?`<div style="width:${Math.round(d.p1/d.total*totW)}%;background:#ef4444;flex-shrink:0;" title="P1: ${d.p1}"></div>`:''}
                ${d.p2?`<div style="width:${Math.round(d.p2/d.total*totW)}%;background:#f59e0b;flex-shrink:0;" title="P2: ${d.p2}"></div>`:''}
                ${d.p3?`<div style="width:${Math.round(d.p3/d.total*totW)}%;background:#6366f1;flex-shrink:0;" title="P3: ${d.p3}"></div>`:''}
                ${d.p4?`<div style="width:${Math.round(d.p4/d.total*totW)}%;background:#10b981;flex-shrink:0;" title="P4: ${d.p4}"></div>`:''}
              </div>
            </div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;min-width:70px;text-align:right;">
              <b style="color:var(--text-main);font-family:monospace;">${d.total}</b> total &nbsp;
              <b style="color:#22c55e;font-family:monospace;">${res}%</b>
            </div>
          </div>`;
        }).join('') : '<div class="empty-state"><p>Sin técnicos asignados</p></div>'}
      </div>
    </div>`;
}

// ── CATEGORÍAS DRILL-DOWN ─────────────────────────────────────────────────────
let _reqCatDrillIssues = [];
let _reqCatDrillTitle  = '';

function reqCatDrill(type, key) {
    const all = _reqMonData || [];
    const PMAP = {
        'P1 Crítico': /critico|critical|highest/i,
        'P2 Alto':    /high|alta/i,
        'P3 Medio':   /medium|media|p3/i,
        'P4 Bajo':    /low|baja/i,
    };
    if (type === 'prio') {
        const re = PMAP[key];
        _reqCatDrillIssues = re ? all.filter(i => re.test(i.fields?.priority?.name||'')) : all;
        _reqCatDrillTitle  = `Prioridad: ${key}`;
    } else if (type === 'status') {
        _reqCatDrillIssues = all.filter(i => (i.fields?.status?.name||'') === key);
        _reqCatDrillTitle  = `Estado: ${key}`;
    } else {
        _reqCatDrillIssues = key === '(Sin asignar)'
            ? all.filter(i => !i.fields?.assignee)
            : all.filter(i => (i.fields?.assignee?.displayName||i.fields?.assignee?.emailAddress||'') === key);
        _reqCatDrillTitle = `Técnico: ${key}`;
    }
    const el = document.getElementById('req-panel-cat-content');
    if (el) _reqRenderCatDrillTable(el);
}

function reqCatBack() {
    const el = document.getElementById('req-panel-cat-content');
    if (!el || !_reqMonData) return;
    _reqRenderCategorias(_reqMonData, el);
}

function reqCatDrillFilter() {
    const q  = (document.getElementById('req-cat-drill-q')?.value  ||'').toLowerCase().trim();
    const pr = document.getElementById('req-cat-drill-prio')?.value ||'';
    const st = document.getElementById('req-cat-drill-st')?.value   ||'';
    const PMAP = { 'P1 Crítico':/critico|critical|highest/i, 'P2 Alto':/high|alta/i, 'P3 Medio':/medium|media|p3/i, 'P4 Bajo':/low|baja/i };

    let f = _reqCatDrillIssues;
    if (q)  f = f.filter(i => (i.key||'').toLowerCase().includes(q) || (i.fields?.summary||'').toLowerCase().includes(q) || (i.fields?.assignee?.displayName||'').toLowerCase().includes(q) || (i.fields?.reporter?.displayName||'').toLowerCase().includes(q));
    if (pr) f = f.filter(i => PMAP[pr]?.test(i.fields?.priority?.name||''));
    if (st) f = f.filter(i => (i.fields?.status?.name||'') === st);

    const tbody = document.getElementById('req-cat-drill-tbody');
    const cnt   = document.getElementById('req-cat-drill-count');
    if (tbody) tbody.innerHTML = _reqCatDrillRows(f);
    if (cnt)   cnt.textContent  = `${f.length} de ${_reqCatDrillIssues.length} registros`;
}

function _reqCatDrillRows(list) {
    if (!list.length) return `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px;"><i class="bi bi-search" style="display:block;font-size:1.6rem;margin-bottom:8px;opacity:.4;"></i>Sin resultados</td></tr>`;
    const CLOSED_RE = /(done|cerr|resuelto|resolved|completado)/i;
    const PCFG = [
        { re:/critico|critical|highest/i, col:'#ef4444' },
        { re:/high|alta/i,                 col:'#f59e0b' },
        { re:/medium|media|p3/i,           col:'#6366f1' },
        { re:/low|baja/i,                  col:'#10b981' },
    ];
    return list.map((i, idx) => {
        const f   = i.fields || {};
        const pr  = f.priority?.name || '—';
        const pc  = (PCFG.find(p => p.re.test(pr.toLowerCase()))||PCFG[2]).col;
        const st  = f.status?.name || '—';
        const stC = CLOSED_RE.test(st) ? '#22c55e' : /pend|wait|espera/i.test(st) ? '#0891b2' : '#f59e0b';
        const assg = f.assignee?.displayName || `<i style="color:var(--text-muted);font-size:10px;">Sin asignar</i>`;
        const crt  = f.created ? new Date(f.created).toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
        const lvl  = _reqSlaLevel(i);
        const sla  = lvl === 'breach'   ? '<span style="color:#ef4444;font-weight:700;font-size:10px;">Breach</span>'
                   : lvl === 'critical' ? '<span style="color:#f59e0b;font-weight:700;font-size:10px;">Riesgo</span>'
                   : lvl === 'warning'  ? '<span style="color:#0891b2;font-size:10px;">Advertencia</span>'
                   : '<span style="color:#22c55e;font-size:10px;">OK</span>';
        return `<tr style="${idx%2?'background:var(--bg-header)':''}">
          <td style="padding:7px 10px;font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;"><span style="color:#6366f1;">${reqEsc(i.key)}</span></td>
          <td style="padding:7px 10px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${reqEsc(f.summary||'')}">${reqEsc((f.summary||'').slice(0,65))}</td>
          <td style="padding:7px 10px;white-space:nowrap;"><span style="color:${pc};font-weight:700;font-size:11px;">${reqEsc(pr)}</span></td>
          <td style="padding:7px 10px;white-space:nowrap;"><span style="color:${stC};font-weight:600;font-size:11px;">${reqEsc(st)}</span></td>
          <td style="padding:7px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;font-size:11px;" title="${reqEsc(f.assignee?.displayName||'')}">${assg}</td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text-muted);white-space:nowrap;">${crt}</td>
          <td style="padding:7px 10px;white-space:nowrap;">${sla}</td>
        </tr>`;
    }).join('');
}

function _reqRenderCatDrillTable(el) {
    const allStatus = [...new Set(_reqCatDrillIssues.map(i=>i.fields?.status?.name||'').filter(Boolean))].sort();
    el.innerHTML = `
    <!-- Header with back button -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
      <button onclick="reqCatBack()" style="display:inline-flex;align-items:center;gap:5px;background:none;border:1px solid var(--border-soft);border-radius:7px;padding:5px 12px;cursor:pointer;color:var(--text-muted);font-size:11px;transition:all .15s;" onmouseover="this.style.background='var(--hover-row)';this.style.color='var(--text-main)'" onmouseout="this.style.background='none';this.style.color='var(--text-muted)'">
        <i class="bi bi-arrow-left"></i> Categorías
      </button>
      <i class="bi bi-funnel-fill" style="color:#6366f1;font-size:12px;"></i>
      <span style="font-size:13px;font-weight:700;color:var(--text-main);">${reqEsc(_reqCatDrillTitle)}</span>
      <span style="background:rgba(99,102,241,.12);color:#6366f1;border-radius:10px;padding:2px 10px;font-size:11px;font-family:monospace;">${_reqCatDrillIssues.length} REQ</span>
    </div>
    <!-- Filters row -->
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      <div style="flex:1;min-width:200px;position:relative;">
        <i class="bi bi-search" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:12px;pointer-events:none;"></i>
        <input id="req-cat-drill-q" type="text" placeholder="Buscar por clave, resumen, técnico o reporter…" oninput="reqCatDrillFilter()"
          style="width:100%;padding:7px 10px 7px 30px;border:1px solid var(--border-soft);border-radius:8px;font-size:12px;background:var(--bg-card);color:var(--text-main);box-sizing:border-box;outline:none;">
      </div>
      <select id="req-cat-drill-prio" onchange="reqCatDrillFilter()" style="padding:7px 10px;border:1px solid var(--border-soft);border-radius:8px;font-size:12px;background:var(--bg-card);color:var(--text-main);">
        <option value="">Todas las prioridades</option>
        <option>P1 Crítico</option><option>P2 Alto</option><option>P3 Medio</option><option>P4 Bajo</option>
      </select>
      <select id="req-cat-drill-st" onchange="reqCatDrillFilter()" style="padding:7px 10px;border:1px solid var(--border-soft);border-radius:8px;font-size:12px;background:var(--bg-card);color:var(--text-main);">
        <option value="">Todos los estados</option>
        ${allStatus.map(s=>`<option value="${reqEsc(s)}">${reqEsc(s)}</option>`).join('')}
      </select>
      <span id="req-cat-drill-count" style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${_reqCatDrillIssues.length} registros</span>
    </div>
    <!-- Table -->
    <div style="border:1px solid var(--border-soft);border-radius:10px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>
          ${['Clave','Resumen','Prioridad','Estado','Técnico','Creado','SLA'].map(h=>`<th style="padding:8px 10px;text-align:left;font-size:9px;font-family:monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);background:var(--bg-header);border-bottom:1px solid var(--border-soft);white-space:nowrap;">${h}</th>`).join('')}
        </tr></thead>
        <tbody id="req-cat-drill-tbody">${_reqCatDrillRows(_reqCatDrillIssues)}</tbody>
      </table>
    </div>`;
    setTimeout(() => document.getElementById('req-cat-drill-q')?.focus(), 60);
}

// ── POR EQUIPO ────────────────────────────────────────────────────────────────
async function reqLoadPorEquipo(force) {
    const el = document.getElementById('req-panel-equipo-content');
    if (!el) return;
    try {
        const issues = await _reqEnsureMonData(force, el);
        _reqRenderPorEquipo(issues, el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function _reqRenderPorEquipo(issues, el) {
    const byTeam = {};
    issues.forEach(i => {
        const f    = i.fields || {};
        const team = (f.components||[]).map(c=>c.name).join(' / ') || 'Sin equipo asignado';
        if (!byTeam[team]) byTeam[team] = { total:0, active:0, closed:0, members: new Set() };
        byTeam[team].total++;
        if (/(done|cerr|resuelto|resolved|completado)/i.test(f.status?.name||'')) byTeam[team].closed++;
        else byTeam[team].active++;
        const asgn = f.assignee?.displayName || f.assignee?.emailAddress;
        if (asgn) byTeam[team].members.add(asgn);
    });
    const sorted = Object.entries(byTeam).sort((a,b) => b[1].active - a[1].active);
    const maxA   = Math.max(...sorted.map(([,d])=>d.active), 1);
    const colors = ['#6366f1','#0891b2','#059669','#d97706','#8b5cf6','#dc2626','#db2777'];
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
        <div class="stat-card"><div class="stat-val" style="color:#6366f1;">${sorted.length}</div><div class="stat-lbl">Equipos</div></div>
        <div class="stat-card"><div class="stat-val" style="color:#f59e0b;">${sorted.reduce((s,[,d])=>s+d.active,0)}</div><div class="stat-lbl">REQ activos</div></div>
        <div class="stat-card"><div class="stat-val" style="color:#10b981;">${sorted.reduce((s,[,d])=>s+d.closed,0)}</div><div class="stat-lbl">Cerrados (90d)</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${sorted.map(([team,d],i) => {
          const col  = colors[i % colors.length];
          const pct  = Math.round(d.active / maxA * 100);
          const mems = [...d.members].slice(0,3).join(', ') + (d.members.size > 3 ? ` +${d.members.size-3}` : '');
          return `<div style="padding:12px;background:var(--bg-card);border:1px solid var(--border-soft);border-radius:8px;border-left:4px solid ${col};">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <i class="bi bi-people-fill" style="color:${col};font-size:14px;flex-shrink:0;"></i>
              <span style="font-size:13px;font-weight:700;color:var(--text-main);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${reqEsc(team)}">${reqEsc(team)}</span>
              <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${d.members.size} técnico${d.members.size!==1?'s':''}</span>
            </div>
            <div style="display:flex;gap:20px;font-size:11px;margin-bottom:8px;">
              <span><b style="color:#f59e0b;font-size:16px;font-weight:800;">${d.active}</b> activos</span>
              <span><b style="color:#10b981;font-size:16px;font-weight:800;">${d.closed}</b> cerrados</span>
              <span><b style="color:var(--text-muted);font-size:16px;font-weight:800;">${d.total}</b> total</span>
            </div>
            <div style="height:6px;background:var(--bg-header);border-radius:3px;overflow:hidden;margin-bottom:6px;">
              <div style="height:100%;width:${pct}%;background:${col};border-radius:3px;"></div>
            </div>
            ${mems ? `<div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${reqEsc(mems)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
}

function reqForceReload() {
    _reqMonData    = null;
    _reqEnCursoAll = [];
    _reqKanbanAll  = [];
    const active = document.querySelector('#tabGestionReq .nav-item.active');
    if (active) active.click();
    else if (typeof reqLoadRequirements === 'function') reqLoadRequirements();
}

// ── Local panel (Gestión Local) ───────────────────────────────────────────────
let reqAllTickets = [], reqFiltered = [], reqCurrentPage = 1;
const REQ_PAGE_SIZE = 20;
let reqActivePill = 'all';

async function reqLoadRequirements() {
    const tw = document.getElementById('req-tableWrap');
    if (tw) tw.innerHTML = `<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando requerimientos...</div>`;
    try {
        const r = await fetch('/api/jira/requirements', { credentials: 'include' });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        reqAllTickets = j.data || [];
        reqUpdateKPIs();
        reqApplyFilters();
    } catch (err) {
        if (tw) tw.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>No se pudieron cargar.<br><small>${err.message}</small></p><button class="btn-outline-sm mt-3" onclick="reqLoadRequirements()"><i class="bi bi-arrow-clockwise"></i> Reintentar</button></div>`;
    }
}

function reqUpdateKPIs() {
    const now = new Date(), m = now.getMonth(), y = now.getFullYear();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('req-kpiTotal',    reqAllTickets.length);
    set('req-kpiOpen',     reqAllTickets.filter(t => reqIsOpen(t.status)).length);
    set('req-kpiProgress', reqAllTickets.filter(t => reqIsProgress(t.status)).length);
    set('req-kpiClosed',   reqAllTickets.filter(t => reqIsClosed(t.status)).length);
    set('req-kpiCritical', reqAllTickets.filter(t => t.priority === 'P1').length);
    set('req-kpiMonth',    reqAllTickets.filter(t => { const d = new Date(t.created); return d.getMonth() === m && d.getFullYear() === y; }).length);
}

function reqIsOpen(s)     { return ['open','abierto','por hacer','to do'].includes((s||'').toLowerCase()); }
function reqIsProgress(s) { return ['in progress','en curso','en progreso','asignado'].includes((s||'').toLowerCase()); }
function reqIsClosed(s)   { return ['done','closed','cerrado','resolved','resuelto','completado'].includes((s||'').toLowerCase()); }

function reqSetPill(el, val) {
    document.querySelectorAll('#reqPanel-todos .pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    reqActivePill = val;
    reqCurrentPage = 1;
    reqApplyFilters();
}
function reqFilterTickets() { reqCurrentPage = 1; reqApplyFilters(); }

function reqApplyFilters() {
    const q = (document.getElementById('reqSearchInput')?.value || '').toLowerCase().trim();
    reqFiltered = reqAllTickets.filter(t => {
        if (reqActivePill === 'open'       && !reqIsOpen(t.status))     return false;
        if (reqActivePill === 'progress'   && !reqIsProgress(t.status)) return false;
        if (reqActivePill === 'closed'     && !reqIsClosed(t.status))   return false;
        if (reqActivePill === 'p1'         && t.priority !== 'P1')      return false;
        if (reqActivePill === 'unassigned' && t.assigned_to)            return false;
        if (q) { const h = [t.key, t.summary, t.reporter, t.status, t.tipo, t.assigned_to_name].join(' ').toLowerCase(); if (!h.includes(q)) return false; }
        return true;
    });
    reqFiltered.sort((a, b) => {
        const aU = !a.assigned_to, bU = !b.assigned_to;
        if (aU !== bU) return aU ? -1 : 1;
        return new Date(b.created) - new Date(a.created);
    });
    reqRenderTable();
    reqRenderPagination();
}

function reqTicketAge(created) {
    if (!created) return '—';
    const ms = new Date() - new Date(created), h = Math.floor(ms / 3600000);
    if (h < 1)  return Math.floor(ms / 60000) + 'min';
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd ' + Math.floor(h % 24) + 'h';
}
function reqPrioBadge(p) { const l={P1:'🔴 P1',P2:'🟠 P2',P3:'🔵 P3',P4:'⚪ P4'}; return `<span class="prio-badge prio-${p}">${l[p]||p}</span>`; }
function reqIstBadge(s) {
    const labels={abierto:'Abierto',asignado:'Asignado',en_progreso:'En progreso',pendiente_usuario:'Pendiente',resuelto:'Resuelto',cerrado:'Cerrado'};
    const icons ={abierto:'bi-circle',asignado:'bi-person-check',en_progreso:'bi-gear-wide-connected',pendiente_usuario:'bi-hourglass-split',resuelto:'bi-check-circle',cerrado:'bi-lock'};
    return `<span class="ist-badge ist-${s}"><i class="bi ${icons[s]||'bi-circle'}"></i>${labels[s]||s}</span>`;
}
function reqPrioRowStyle(p) { return {P1:'border-left:3px solid #ef4444;background:rgba(239,68,68,.04);',P2:'border-left:3px solid #f59e0b;background:rgba(245,158,11,.03);'}[p]||''; }
function reqSlaLabel(deadline) {
    if (!deadline) return '';
    const diff = new Date(deadline) - new Date(), h = Math.round(diff/3600000);
    if (diff < 0) return `<span class="sla-danger"><i class="bi bi-exclamation-triangle-fill"></i> SLA vencido</span>`;
    if (h <= 2)   return `<span class="sla-danger"><i class="bi bi-clock-fill"></i> ${h}h restantes</span>`;
    if (h <= 6)   return `<span class="sla-warn"><i class="bi bi-clock"></i> ${h}h restantes</span>`;
    return `<span class="sla-ok"><i class="bi bi-clock"></i> ${h}h</span>`;
}

function reqRenderTable() {
    const tw = document.getElementById('req-tableWrap');
    const pw = document.getElementById('req-paginationWrap');
    if (!tw) return;
    if (!reqFiltered.length) {
        tw.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No se encontraron requerimientos.</p></div>`;
        if (pw) pw.style.display = 'none'; return;
    }
    if (pw) pw.style.display = 'flex';
    const start = (reqCurrentPage - 1) * REQ_PAGE_SIZE;
    const rows = reqFiltered.slice(start, start + REQ_PAGE_SIZE).map(t => {
        const ist    = t.internal_status || 'abierto';
        const crDate = t.created ? new Date(t.created).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        const tech   = t.assigned_to_name
            ? `<span style="font-size:11px;color:var(--text-muted);"><i class="bi bi-person-fill"></i> ${t.assigned_to_name}</span>`
            : `<span style="font-size:11px;color:#ef4444;"><i class="bi bi-person-dash"></i> Sin asignar</span>`;
        const tipo   = t.tipo ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;"><i class="bi bi-tag"></i> ${t.tipo}</div>` : '';
        return `<tr style="${reqPrioRowStyle(t.priority||'P3')}">
            <td><span class="ticket-key"><a href="${t.url||'#'}" target="_blank">${t.key}</a></span>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${crDate}</div>
                <div style="font-size:10px;color:var(--text-muted);"><i class="bi bi-hourglass"></i> ${reqTicketAge(t.created)}</div></td>
            <td style="max-width:220px;"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(t.summary||'').replace(/"/g,'&quot;')}">${t.summary}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;"><i class="bi bi-envelope"></i> ${t.reporter||'—'}</div>${tipo}</td>
            <td>${reqPrioBadge(t.priority||'P3')}</td>
            <td>${reqIstBadge(ist)}</td>
            <td>${tech}</td>
            <td>${reqSlaLabel(t.sla_deadline)}</td>
            <td style="white-space:nowrap;"><a href="${t.url||'#'}" target="_blank" class="btn-outline-sm"><i class="bi bi-box-arrow-up-right"></i> Jira</a></td>
        </tr>`;
    }).join('');
    tw.innerHTML = `<div style="overflow-x:auto;"><table class="table-tickets w-100">
        <thead><tr><th>Clave / Hora</th><th>Resumen / Reporter</th><th>Prioridad</th><th>Estado</th><th>Técnico</th><th>SLA</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}

function reqRenderPagination() {
    const pi   = document.getElementById('req-paginationInfo');
    const btns = document.getElementById('req-paginationBtns');
    if (!pi || !btns) return;
    const total = reqFiltered.length, pages = Math.ceil(total / REQ_PAGE_SIZE);
    const s = (reqCurrentPage - 1) * REQ_PAGE_SIZE + 1, e = Math.min(reqCurrentPage * REQ_PAGE_SIZE, total);
    pi.textContent = total ? `Mostrando ${s}–${e} de ${total} requerimientos` : '';
    if (pages <= 1) { btns.innerHTML = ''; return; }
    let html = `<button class="btn-outline-sm" onclick="reqGoPage(${reqCurrentPage-1})" ${reqCurrentPage===1?'disabled':''}><i class="bi bi-chevron-left"></i></button>`;
    for (let i = 1; i <= pages; i++) {
        if (i===1||i===pages||(i>=reqCurrentPage-1&&i<=reqCurrentPage+1))
            html += `<button class="btn-outline-sm" style="${i===reqCurrentPage?'background:#6366f1;color:white;border-color:#6366f1;':''}" onclick="reqGoPage(${i})">${i}</button>`;
        else if (i===reqCurrentPage-2||i===reqCurrentPage+2)
            html += `<span style="padding:4px 6px;font-size:12px;color:var(--text-muted);">…</span>`;
    }
    html += `<button class="btn-outline-sm" onclick="reqGoPage(${reqCurrentPage+1})" ${reqCurrentPage===pages?'disabled':''}><i class="bi bi-chevron-right"></i></button>`;
    btns.innerHTML = html;
}
function reqGoPage(p) { const pages = Math.ceil(reqFiltered.length / REQ_PAGE_SIZE); if (p<1||p>pages) return; reqCurrentPage=p; reqRenderTable(); reqRenderPagination(); }

// ── Cerrar requerimiento ──────────────────────────────────────────────────────
async function reqEjecutarCerrar(key) {
    const comment = document.getElementById('req-cerrar-cmt-' + key)?.value?.trim();
    if (!comment) { showToast('Ingresa el motivo de cierre', 'error'); return; }
    showToast(`Cerrando ${key}...`, 'info');
    try {
        const r = await fetch(`/api/jira/requirement/${key}/close`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment })
        });
        const d = await r.json();
        showToast(d.success ? `✓ ${key} cerrado` : ('Error: ' + (d.message || d.error)), d.success ? 'success' : 'error');
        if (d.success) { _reqCloseAllInlines(key); reqReloadCurrent(); }
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ── Reanudar requerimiento ────────────────────────────────────────────────────
async function reqEjecutarReanudar(key) {
    const comment = document.getElementById('req-reanudar-cmt-' + key)?.value?.trim();
    if (!comment) { showToast('Agrega un comentario', 'error'); return; }
    showToast(`Reanudando ${key}...`, 'info');
    try {
        const r = await fetch(`/api/jira/ticket/${key}/reanudar`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comment })
        });
        const d = await r.json();
        showToast(d.success ? `✓ ${key} reanudado` : ('Error: ' + (d.message || d.error)), d.success ? 'success' : 'error');
        if (d.success) { _reqCloseAllInlines(key); reqReloadCurrent(); }
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ── Nota interna (localStorage) ───────────────────────────────────────────────
var _reqNoteTimers = {};
function reqSaveNota(key, val) {
    clearTimeout(_reqNoteTimers[key]);
    _reqNoteTimers[key] = setTimeout(() => {
        if (val && val.trim()) localStorage.setItem('req_note_' + key, val);
        else localStorage.removeItem('req_note_' + key);
        const btn = document.getElementById('req-noteBtn-' + key);
        if (btn) {
            const has = !!(val && val.trim());
            btn.style.color       = has ? '#8b5cf6' : '';
            btn.style.borderColor = has ? 'rgba(139,92,246,.4)' : '';
            btn.innerHTML = `<i class="bi bi-sticky${has ? '-fill' : ''}"></i> Nota${has ? ' ·' : ''}`;
        }
    }, 400);
}
function reqClearNota(key) {
    localStorage.removeItem('req_note_' + key);
    const ta  = document.getElementById('req-nota-input-' + key);
    const el  = document.getElementById('req-nota-' + key);
    const btn = document.getElementById('req-noteBtn-' + key);
    if (ta)  ta.value = '';
    if (el)  el.style.display = 'none';
    if (btn) { btn.style.color = ''; btn.style.borderColor = ''; btn.innerHTML = '<i class="bi bi-sticky"></i> Nota'; }
}

// ── Derivar requerimiento ─────────────────────────────────────────────────────
var _reqDeriveKey = '';
function reqOpenDerive(key) {
    _reqDeriveKey = key;
    const overlay = document.getElementById('reqDeriveOverlay');
    const kEl = document.getElementById('reqDeriveKey');
    const result = document.getElementById('reqDeriveResult');
    const grp = document.getElementById('reqDeriveGroup');
    const note = document.getElementById('reqDeriveNote');
    if (kEl)  kEl.textContent = key;
    if (result) result.style.display = 'none';
    if (grp)  grp.value = '';
    if (note) { note.value = ''; }
    if (overlay) { overlay.style.display = 'flex'; setTimeout(() => note?.focus(), 50); }
}
function reqCloseDerive() {
    const overlay = document.getElementById('reqDeriveOverlay');
    if (overlay) overlay.style.display = 'none';
    _reqDeriveKey = '';
}
async function reqEjecutarDerive() {
    const key   = _reqDeriveKey;
    const group = document.getElementById('reqDeriveGroup')?.value?.trim();
    const note  = document.getElementById('reqDeriveNote')?.value?.trim();
    const result = document.getElementById('reqDeriveResult');
    if (!group || !note) { showToast('Grupo y motivo son obligatorios', 'error'); return; }
    try {
        const r = await fetch(`/api/jira/ticket/${key}/derive`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_name: group, note, unassign: true })
        });
        const d = await r.json();
        if (result) {
            result.style.display = '';
            result.style.background = d.ok ? '#ecfdf5' : '#fef2f2';
            result.style.color = d.ok ? '#065f46' : '#991b1b';
            result.textContent = d.ok ? `✓ Derivado a ${group}` : (d.message || 'Error al derivar');
        }
        if (d.ok) { showToast(`✓ ${key} derivado a ${group}`, 'success'); setTimeout(reqCloseDerive, 1500); }
        else showToast('Error: ' + (d.message || 'No se pudo derivar'), 'error');
    } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ── Timeline ──────────────────────────────────────────────────────────────────
function reqCloseTimeline() {
    const overlay = document.getElementById('reqTlOverlay');
    const drawer  = document.getElementById('reqTlDrawer');
    if (overlay) overlay.style.display = 'none';
    if (drawer)  drawer.style.display  = 'none';
}
async function reqOpenTimeline(key) {
    const overlay = document.getElementById('reqTlOverlay');
    const drawer  = document.getElementById('reqTlDrawer');
    const content = document.getElementById('reqTlContent');
    const kEl     = document.getElementById('reqTlKey');
    if (!drawer) return;
    if (kEl) kEl.textContent = key;
    if (overlay) overlay.style.display = 'block';
    drawer.style.display = 'flex';
    content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);"><span class="req-spin"></span></div>';
    try {
        const r = await fetch(`/api/jira/ticket/${key}/history`, { credentials:'include' });
        const d = await r.json();
        if (!d.success) throw new Error(d.message || d.error || 'Error cargando timeline');
        const evColors = { creacion:'#0052CC', asignacion:'#7c3aed', cambio_estado:'#f59e0b', cierre:'#10b981', comentario:'#64748b' };
        const evIcons  = { creacion:'bi-plus-circle-fill', asignacion:'bi-person-check-fill', cambio_estado:'bi-arrow-repeat', cierre:'bi-lock-fill', comentario:'bi-chat-fill' };
        const evLabel  = { creacion:'Creación', asignacion:'Asignación', cambio_estado:'Cambio de estado', cierre:'Cierre', comentario:'Comentario' };
        const history  = d.data?.history || [];
        const comments = d.data?.comments || [];
        const ticket   = d.data?.ticket   || {};
        const allEvents = [
            { evento:'creacion', user_name: ticket.reporter||'—', detalle: ticket.summary||'', created_at: ticket.created_at },
            ...history,
            ...comments.map(c => ({ ...c, evento:'comentario', detalle: c.contenido }))
        ].filter(e => e.created_at).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
        if (!allEvents.length) { content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12px;">Sin historial disponible</div>'; return; }
        content.innerHTML = allEvents.map((e,i) => {
            const color = evColors[e.evento] || '#94a3b8';
            const icon  = evIcons[e.evento]  || 'bi-circle';
            const label = evLabel[e.evento]  || e.evento;
            const dt    = new Date(e.created_at).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
            const isLast = i === allEvents.length - 1;
            return `<div style="display:flex;gap:12px;padding-bottom:${isLast?'0':'16px'};">
              <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
                <div style="width:28px;height:28px;border-radius:50%;background:${color}18;border:2px solid ${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  <i class="bi ${icon}" style="font-size:11px;color:${color};"></i>
                </div>
                ${!isLast ? `<div style="width:2px;flex:1;background:var(--border-soft);margin-top:4px;"></div>` : ''}
              </div>
              <div style="flex:1;padding-bottom:${isLast?'0':'4px'};">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                  <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.04em;">${label}</span>
                  <span style="font-size:10px;color:var(--text-muted);">· ${dt}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);">${reqEsc(e.user_name||'')}</div>
                <div style="font-size:12px;color:var(--text-main);margin-top:3px;">${reqEsc(e.detalle||'').slice(0,200)}</div>
              </div>
            </div>`;
        }).join('');
    } catch(e) {
        content.innerHTML = `<div style="color:#ef4444;padding:20px;font-size:12px;">${reqEsc(e.message)}</div>`;
    }
}

// ── Toggle collapsible nav group ─────────────────────────────────────────────
function reqToggleNavGroup(id, el) {
    const grp  = document.getElementById(id);
    const chev = el?.querySelector('.req-nav-chev');
    if (!grp) return;
    const collapsed = grp.classList.toggle('collapsed');
    if (chev) chev.style.transform = collapsed ? 'rotate(-90deg)' : '';
}

// ── ALERTAS ───────────────────────────────────────────────────────────────────
async function reqLoadAlertas(force) {
    const el = document.getElementById('req-panel-alertas-content');
    try {
        const issues = await _reqEnsureMonData(force, el || { innerHTML: '' });
        if (el) _reqRenderAlertas(issues, el);
        // Update nav badge with breach + critical count
        const open   = issues.filter(i => !/(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||''));
        const urgent = open.filter(i => { const l = _reqSlaLevel(i); return l === 'breach' || l === 'critical'; }).length;
        const badge  = document.getElementById('req-alertas-badge');
        if (badge) { badge.textContent = urgent || ''; badge.style.display = urgent ? '' : 'none'; }
    } catch(e) {
        if (el) el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function _reqRenderAlertas(issues, el) {
    const open       = issues.filter(i => !/(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||''));
    const slaBreached = open.filter(i => _reqSlaLevel(i) === 'breach');
    const slaCritical = open.filter(i => _reqSlaLevel(i) === 'critical');
    const sinAsignar  = open.filter(i => {
        const ageH = i.fields?.created ? (Date.now() - new Date(i.fields.created).getTime()) / 3600000 : 0;
        return !i.fields?.assignee && ageH > 2;
    });
    const enEspera = open.filter(i => /pend|wait/i.test(i.fields?.status?.name||''));

    const kpis = [
        { label:'SLA Vencido',       count:slaBreached.length, color:'#ef4444', bg:'rgba(239,68,68,.08)',  icon:'bi-exclamation-triangle-fill' },
        { label:'SLA Crítico',       count:slaCritical.length, color:'#f97316', bg:'rgba(249,115,22,.08)', icon:'bi-exclamation-circle-fill' },
        { label:'Sin asignar (+2h)', count:sinAsignar.length,  color:'#f59e0b', bg:'rgba(245,158,11,.08)', icon:'bi-person-dash-fill' },
        { label:'En Espera',         count:enEspera.length,    color:'#6366f1', bg:'rgba(99,102,241,.08)', icon:'bi-pause-circle-fill' },
    ];

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
        ${kpis.map(k => `
          <div style="background:${k.bg};border:1px solid ${k.color}30;border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
            <i class="bi ${k.icon}" style="font-size:20px;color:${k.color};flex-shrink:0;"></i>
            <div><div style="font-size:22px;font-weight:800;line-height:1;color:${k.color};font-family:monospace;">${k.count}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;font-weight:600;">${k.label}</div></div>
          </div>`).join('')}
      </div>
      ${_reqAlrtSection('SLA Vencidos — Acción inmediata', slaBreached, 'red')}
      ${_reqAlrtSection('SLA Críticos — Atención urgente', slaCritical, 'orange')}
      ${_reqAlrtSection('Sin asignar hace más de 2h', sinAsignar, 'amber')}
      ${_reqAlrtSection('En Espera del Usuario', enEspera, 'slate')}
    `;
}

function _reqAlrtSection(title, items, color) {
    if (!items.length) return '';
    const hdrCls = { red:'req-alrt-hdr-red', orange:'req-alrt-hdr-orange', amber:'req-alrt-hdr-amber', slate:'req-alrt-hdr-slate' }[color] || '';
    const badgeStyle = { red:'background:#ef4444;color:#fff;', orange:'background:#f97316;color:#fff;', amber:'background:#f59e0b;color:#fff;', slate:'background:#64748b;color:#fff;' }[color] || '';
    return `<div class="req-alrt-section">
      <div class="req-alrt-hdr ${hdrCls}" onclick="const b=this.nextElementSibling;b.classList.toggle('collapsed');this.querySelector('.req-alrt-chev').classList.toggle('open');">
        ${title}
        <span style="${badgeStyle};border-radius:10px;padding:1px 7px;font-size:10px;font-family:monospace;margin-left:6px;">${items.length}</span>
        <i class="bi bi-chevron-down req-alrt-chev open" style="margin-left:auto;font-size:10px;transition:transform .2s;"></i>
      </div>
      <div class="req-alrt-body">
        ${items.slice(0,25).map(i => {
            const f    = i.fields || {};
            const asgn = f.assignee?.displayName || 'Sin asignar';
            const ageMs = f.created ? Date.now() - new Date(f.created).getTime() : 0;
            return `<div class="req-alrt-row">
              <span class="req-alrt-key"><a href="https://integratelperu.atlassian.net/browse/${i.key}" target="_blank" style="color:#6366f1;text-decoration:none;">${i.key}</a></span>
              <span class="req-alrt-sum" title="${reqEsc(f.summary||'')}">${reqEsc(f.summary||'')}</span>
              <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${reqEsc(asgn.split(' ')[0])}</span>
              <span style="font-size:10px;font-family:monospace;color:var(--text-muted);flex-shrink:0;">${_reqFmtAge(ageMs)}</span>
            </div>`;
        }).join('')}
        ${items.length > 25 ? `<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);text-align:center;">+${items.length-25} más</div>` : ''}
      </div>
    </div>`;
}

// ── INDICADORES ───────────────────────────────────────────────────────────────
let _reqIndPeriod = 'mes';
let _reqIndData   = null;
let _reqIndCharts = {};

async function reqLoadIndicadores(force) {
    const el = document.getElementById('req-panel-ind-content');
    if (!el) return;
    if (!force && _reqIndData) { _reqRenderIndicadores(_reqIndData.created, _reqIndData.resolved, el, _reqIndData.days); return; }
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px;font-size:12px;color:var(--text-muted);"><span class="req-spin"></span> Calculando indicadores…</div>';
    try {
        const days   = _reqIndPeriod === 'hoy' ? 1 : _reqIndPeriod === 'sem' ? 7 : 30;
        const FIELDS = ['summary','status','assignee','priority','created','resolutiondate','issuetype','components','reporter'];
        const [cr, rs] = await Promise.all([
            jira('POST', '/rest/api/3/search/jql', { jql:`project = REQ AND created >= -${days}d ORDER BY created DESC`,             maxResults:500, fields:FIELDS }),
            jira('POST', '/rest/api/3/search/jql', { jql:`project = REQ AND resolutiondate >= -${days}d AND resolutiondate is not EMPTY ORDER BY resolutiondate DESC`, maxResults:500, fields:FIELDS }),
        ]);
        _reqIndData = { created: cr.issues||[], resolved: rs.issues||[], days };
        _reqRenderIndicadores(_reqIndData.created, _reqIndData.resolved, el, days);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function reqSetIndPeriod(period, btn) {
    _reqIndPeriod = period;
    _reqIndData   = null;
    Object.values(_reqIndCharts).forEach(ch => { try { ch.destroy(); } catch {} });
    _reqIndCharts = {};
    document.querySelectorAll('.req-ind-period-btn').forEach(b => { b.style.color='var(--text-muted)'; b.style.borderColor='var(--border-soft)'; b.style.background='none'; });
    if (btn) { btn.style.color='#6366f1'; btn.style.borderColor='#6366f1'; }
    reqLoadIndicadores(true);
}

function _reqIndMkChart(id, type, labels, datasets, extra) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (_reqIndCharts[id]) { try { _reqIndCharts[id].destroy(); } catch {} }
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gc = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const tc = isDark ? '#94a3b8' : '#64748b';
    const opts = {
        responsive:true, maintainAspectRatio:false,
        plugins: { legend:{ display: type==='doughnut', position: type==='doughnut'?'bottom':'top', labels:{ font:{size:9}, boxWidth:10, color:tc } } },
        ...(type !== 'doughnut' ? { scales:{
            x:{ ticks:{font:{size:9},color:tc}, grid:{color:gc} },
            y:{ ticks:{font:{size:9},color:tc}, grid:{color:gc}, beginAtZero:true },
        }} : {}),
        ...extra,
    };
    _reqIndCharts[id] = new Chart(canvas, { type, data:{ labels, datasets }, options:opts });
}

function _reqRenderIndicadores(created, resolved, el, days) {
    const CLOSED_RE = /(done|cerr|resuelto|resolved|completado)/i;
    const openIss   = created.filter(i => !CLOSED_RE.test(i.fields?.status?.name||''));
    const closedIss = created.filter(i =>  CLOSED_RE.test(i.fields?.status?.name||''));
    const sinAsig   = openIss.filter(i => !i.fields?.assignee);

    // SLA
    let slaOk = 0, slaTot = 0; const slaBreachOpen = [];
    created.forEach(i => {
        const maxH = _REQ_SLA_H[(i.fields?.priority?.name||'').toLowerCase()] || 24;
        if (i.fields?.resolutiondate) {
            slaTot++;
            if ((new Date(i.fields.resolutiondate) - new Date(i.fields?.created)) / 3600000 <= maxH) slaOk++;
        } else {
            const lvl = _reqSlaLevel(i);
            if (lvl === 'breach' || lvl === 'critical') slaBreachOpen.push(i);
        }
    });
    const slaPct = slaTot ? Math.round(slaOk / slaTot * 100) : (created.length ? 100 : 0);

    // MTTR
    const mttrH = (() => {
        const rs = resolved.filter(i => i.fields?.resolutiondate && i.fields?.created);
        if (!rs.length) return null;
        const avg = rs.reduce((s,i) => s + (new Date(i.fields.resolutiondate) - new Date(i.fields.created)), 0) / rs.length / 3600000;
        return avg < 1 ? Math.round(avg*60)+'min' : avg < 24 ? avg.toFixed(1)+'h' : (avg/24).toFixed(1)+'d';
    })();

    // By status + priority
    const byStatus = {}, byPrio = {'P1 Crítico':0,'P2 Alto':0,'P3 Medio':0,'P4 Bajo':0};
    created.forEach(i => {
        const s = i.fields?.status?.name||'Sin estado'; byStatus[s]=(byStatus[s]||0)+1;
        const pr = (i.fields?.priority?.name||'').toLowerCase();
        if (/critico|critical|highest/.test(pr)) byPrio['P1 Crítico']++;
        else if (/high|alta/.test(pr))            byPrio['P2 Alto']++;
        else if (/low|baja/.test(pr))             byPrio['P4 Bajo']++;
        else                                       byPrio['P3 Medio']++;
    });

    // Top reporters
    const byReporter = {};
    created.forEach(i => { const r=i.fields?.reporter?.displayName||i.fields?.reporter?.emailAddress||'Sin reporter'; byReporter[r]=(byReporter[r]||0)+1; });
    const topReporters = Object.entries(byReporter).sort((a,b)=>b[1]-a[1]).slice(0,8);

    // Top técnicos
    const byTech = {};
    created.forEach(i => {
        if (!i.fields?.assignee) return;
        const a = i.fields.assignee.displayName||i.fields.assignee.emailAddress;
        if (!byTech[a]) byTech[a]={total:0,closed:0};
        byTech[a].total++;
        if (CLOSED_RE.test(i.fields?.status?.name||'')) byTech[a].closed++;
    });
    const topTecnicos = Object.entries(byTech).sort((a,b)=>b[1].total-a[1].total).slice(0,8);

    // Top tipos
    const byTipo = {};
    created.forEach(i => { const t=i.fields?.issuetype?.name||(i.fields?.components?.[0]?.name)||'General'; byTipo[t]=(byTipo[t]||0)+1; });
    const topTipos = Object.entries(byTipo).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const maxTipo  = topTipos[0]?.[1]||1;

    // Evolution data
    const evolC={}, evolR={};
    for (let i=days-1; i>=0; i--) {
        const d=new Date(); d.setDate(d.getDate()-i);
        const k=d.toLocaleDateString('es-PE',{day:'2-digit',month:'short'});
        evolC[k]=0; evolR[k]=0;
    }
    created.forEach(i => { const k=new Date(i.fields?.created).toLocaleDateString('es-PE',{day:'2-digit',month:'short'}); if(evolC[k]!==undefined) evolC[k]++; });
    resolved.forEach(i => { if(!i.fields?.resolutiondate) return; const k=new Date(i.fields.resolutiondate).toLocaleDateString('es-PE',{day:'2-digit',month:'short'}); if(evolR[k]!==undefined) evolR[k]++; });
    const evolKeys = Object.keys(evolC);

    // Render colors
    const prioCols = {'P1 Crítico':'#ef4444','P2 Alto':'#f59e0b','P3 Medio':'#6366f1','P4 Bajo':'#10b981'};
    const maxPrio  = Math.max(...Object.values(byPrio),1);
    const stCols   = ['#6366f1','#22c55e','#f59e0b','#ef4444','#0891b2','#7c3aed','#ec4899','#64748b'];
    const stEntries= Object.entries(byStatus).sort((a,b)=>b[1]-a[1]);
    const maxSt    = stEntries[0]?.[1]||1;
    const tipoCols = ['#6366f1','#0891b2','#059669','#d97706','#dc2626','#8b5cf6','#0284c7','#ec4899'];
    const breachList= slaBreachOpen.sort((a,b)=>new Date(a.fields?.created)-new Date(b.fields?.created)).slice(0,15);

    const _bar = (pct, col) => `<div style="height:5px;background:var(--bg-main);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${col};border-radius:3px;"></div></div>`;

    el.innerHTML = `
    <!-- ── KPI Row ── -->
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px;">
      <div class="kpi-stat-card ks-indigo"><div class="kpi-stat-icon"><i class="bi bi-clipboard2-check-fill"></i></div><div class="kpi-stat-body"><div class="kpi-num">${created.length}</div><div class="kpi-lbl">Total REQ</div><div class="kpi-hint">Últimos ${days}d</div></div></div>
      <div class="kpi-stat-card ks-amber"><div class="kpi-stat-icon"><i class="bi bi-hourglass-split"></i></div><div class="kpi-stat-body"><div class="kpi-num">${openIss.length}</div><div class="kpi-lbl">Abiertos</div><div class="kpi-hint">Sin cerrar</div></div></div>
      <div class="kpi-stat-card ks-green"><div class="kpi-stat-icon"><i class="bi bi-check2-circle"></i></div><div class="kpi-stat-body"><div class="kpi-num">${resolved.length}</div><div class="kpi-lbl">Cerrados</div><div class="kpi-hint">En período</div></div></div>
      <div class="kpi-stat-card ks-red"><div class="kpi-stat-icon"><i class="bi bi-person-x-fill"></i></div><div class="kpi-stat-body"><div class="kpi-num">${sinAsig.length}</div><div class="kpi-lbl">Sin asignar</div><div class="kpi-hint">Requieren atención</div></div></div>
      <div class="kpi-stat-card ${slaPct>=90?'ks-green':slaPct>=70?'ks-amber':'ks-red'}"><div class="kpi-stat-icon"><i class="bi bi-speedometer2"></i></div><div class="kpi-stat-body"><div class="kpi-num">${slaPct}%</div><div class="kpi-lbl">% SLA cumplido</div><div class="kpi-hint">${slaBreachOpen.length} en riesgo</div></div></div>
      <div class="kpi-stat-card ks-purple"><div class="kpi-stat-icon"><i class="bi bi-stopwatch-fill"></i></div><div class="kpi-stat-body"><div class="kpi-num">${mttrH||'N/D'}</div><div class="kpi-lbl">MTTR promedio</div><div class="kpi-hint">Tiempo resolución</div></div></div>
    </div>

    <!-- ── Evolución + SLA donut ── -->
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px;">
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
          <i class="bi bi-graph-up-arrow" style="color:#6366f1;"></i> Evolución de REQ —
          <span style="color:#6366f1;font-weight:700;">■ Creados</span>
          <span style="color:#22c55e;font-weight:700;">■ Cerrados</span>
        </div>
        <div style="height:180px;position:relative;"><canvas id="req-ind-canvas-evol"></canvas></div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;display:flex;align-items:center;gap:6px;"><i class="bi bi-pie-chart-fill" style="color:#6366f1;"></i> % SLA cumplido</div>
        <div style="height:130px;position:relative;"><canvas id="req-ind-canvas-sla"></canvas></div>
        <div style="text-align:center;margin-top:4px;font-size:18px;font-weight:800;font-family:monospace;color:${slaPct>=80?'#22c55e':slaPct>=60?'#f59e0b':'#ef4444'};">${slaPct}%</div>
      </div>
    </div>

    <!-- ── Estado + Prioridad ── -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;display:flex;align-items:center;gap:6px;"><i class="bi bi-bar-chart-steps" style="color:#0891b2;"></i> Por Estado</div>
        ${stEntries.slice(0,6).map(([name,count],i) => { const c=stCols[i%stCols.length],pct=Math.round(count/maxSt*100);
          return `<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:11px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:72%;color:var(--text-main);">${reqEsc(name)}</span><span style="font-weight:700;color:${c};font-family:monospace;">${count}</span></div>${_bar(pct,c)}</div>`;
        }).join('')}
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;display:flex;align-items:center;gap:6px;"><i class="bi bi-flag-fill" style="color:#f59e0b;"></i> Por Prioridad</div>
        ${Object.entries(byPrio).map(([name,count]) => { const c=prioCols[name],pct=Math.round(count/maxPrio*100);
          return `<div style="margin-bottom:9px;"><div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:11px;"><span style="display:flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:2px;background:${c};display:inline-block;"></span>${name}</span><span style="font-weight:700;color:${c};font-family:monospace;">${count}</span></div>${_bar(pct,c)}</div>`;
        }).join('')}
      </div>
    </div>

    <!-- ── Top Técnicos / Top Reporters / Top Tipos ── -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
      <!-- Técnicos -->
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
        <div style="padding:9px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;"><i class="bi bi-person-fill-gear" style="color:#6366f1;"></i> Top Técnicos</div>
        <div style="overflow-y:auto;max-height:190px;">
          ${topTecnicos.length ? `<table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr>
              <th style="padding:5px 10px;background:var(--bg-header);font-size:9px;font-family:monospace;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-soft);text-align:left;">Técnico</th>
              <th style="padding:5px 10px;background:var(--bg-header);font-size:9px;font-family:monospace;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-soft);text-align:right;">Tot.</th>
              <th style="padding:5px 10px;background:var(--bg-header);font-size:9px;font-family:monospace;text-transform:uppercase;color:var(--text-muted);border-bottom:1px solid var(--border-soft);text-align:right;">Cerr.</th>
            </tr></thead>
            <tbody>${topTecnicos.map(([nm,d],i)=>`<tr style="${i%2?'background:var(--bg-header)':''}">
              <td style="padding:5px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;color:var(--text-main);" title="${reqEsc(nm)}">${reqEsc(nm.split(' ')[0])} ${reqEsc(nm.split(' ')[1]||'')}</td>
              <td style="padding:5px 10px;text-align:right;font-weight:700;font-family:monospace;color:#6366f1;">${d.total}</td>
              <td style="padding:5px 10px;text-align:right;font-weight:700;font-family:monospace;color:#22c55e;">${d.closed}</td>
            </tr>`).join('')}</tbody>
          </table>` : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Sin datos</div>'}
        </div>
      </div>
      <!-- Reporters -->
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
        <div style="padding:9px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;"><i class="bi bi-people-fill" style="color:#7c3aed;"></i> Top Reporters</div>
        <div style="padding:10px 14px;max-height:190px;overflow-y:auto;">
          ${topReporters.length ? topReporters.map(([nm,ct],i)=>{ const mx=topReporters[0][1]; const pct=Math.round(ct/mx*100); const m=i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
            return `<div style="margin-bottom:7px;display:flex;align-items:center;gap:8px;"><span style="font-size:11px;min-width:18px;">${m}</span><div style="flex:1;min-width:0;"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${reqEsc(nm)}">${reqEsc(nm.length>22?nm.slice(0,20)+'…':nm)}</span><span style="font-weight:700;color:#7c3aed;font-family:monospace;">${ct}</span></div>${_bar(pct,'#7c3aed')}</div></div>`;
          }).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:10px 0;text-align:center;">Sin datos</div>'}
        </div>
      </div>
      <!-- Tipos -->
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
        <div style="padding:9px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;"><i class="bi bi-tags-fill" style="color:#059669;"></i> Por Tipo</div>
        <div style="padding:10px 14px;max-height:190px;overflow-y:auto;">
          ${topTipos.length ? topTipos.map(([nm,ct],i)=>{ const c=tipoCols[i%tipoCols.length],pct=Math.round(ct/maxTipo*100);
            return `<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;margin-bottom:2px;font-size:11px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:72%;color:var(--text-main);" title="${reqEsc(nm)}">${reqEsc(nm)}</span><span style="font-weight:700;color:${c};font-family:monospace;">${ct}</span></div>${_bar(pct,c)}</div>`;
          }).join('') : '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:10px 0;">Sin datos</div>'}
        </div>
      </div>
    </div>

    <!-- ── Breach / Riesgo SLA table ── -->
    ${breachList.length ? `
    <div style="background:var(--bg-card);border:1px solid rgba(239,68,68,.3);border-radius:12px;overflow:hidden;">
      <div style="padding:9px 14px;background:rgba(239,68,68,.05);border-bottom:1px solid rgba(239,68,68,.2);display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:11px;font-weight:700;color:#ef4444;display:flex;align-items:center;gap:6px;"><i class="bi bi-exclamation-triangle-fill"></i> REQ en riesgo / Breach de SLA</div>
        <span style="background:#ef4444;color:#fff;border-radius:10px;padding:2px 8px;font-size:10px;font-family:monospace;">${breachList.length} REQ</span>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead><tr>
            ${['Clave','Resumen','Prior.','Técnico','SLA','Estado','Abierto hace'].map(h=>`<th style="padding:6px 10px;background:var(--bg-header);font-size:9px;font-family:monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);border-bottom:1px solid var(--border-soft);text-align:left;">${h}</th>`).join('')}
          </tr></thead>
          <tbody>${breachList.map((i,idx)=>{ const f=i.fields||{}; const lvl=_reqSlaLevel(i); const slaBadge=lvl==='breach'?'<span style="color:#ef4444;font-weight:700;">Breach</span>':'<span style="color:#f59e0b;font-weight:700;">Crítico</span>'; const pr=f.priority?.name||'—'; const pc=/critico|critical|highest/i.test(pr)?'#ef4444':/high|alta/i.test(pr)?'#f59e0b':/low|baja/i.test(pr)?'#10b981':'#6366f1'; const tech=f.assignee?.displayName||'<i style="color:var(--text-muted);">Sin asignar</i>'; const h=((Date.now()-new Date(f.created))/3600000).toFixed(1);
            return `<tr style="${idx%2?'background:var(--bg-header)':''}">
              <td style="padding:5px 10px;font-family:monospace;font-weight:700;white-space:nowrap;"><span style="color:#6366f1;">${reqEsc(i.key)}</span></td>
              <td style="padding:5px 10px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${reqEsc(f.summary||'')}">${reqEsc((f.summary||'').slice(0,55))}</td>
              <td style="padding:5px 10px;white-space:nowrap;"><span style="color:${pc};font-weight:700;">${reqEsc(pr)}</span></td>
              <td style="padding:5px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;">${tech}</td>
              <td style="padding:5px 10px;white-space:nowrap;">${slaBadge}</td>
              <td style="padding:5px 10px;color:var(--text-muted);white-space:nowrap;">${reqEsc(f.status?.name||'—')}</td>
              <td style="padding:5px 10px;font-family:monospace;color:#ef4444;white-space:nowrap;">${h}h</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
    `;

    // Draw Chart.js charts
    requestAnimationFrame(() => {
        _reqIndMkChart('req-ind-canvas-evol', 'line', evolKeys, [
            { label:'Creados',  data:evolKeys.map(k=>evolC[k]||0), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.08)',  fill:true, tension:.35, pointRadius:3, borderWidth:2 },
            { label:'Cerrados', data:evolKeys.map(k=>evolR[k]||0), borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,.06)',    fill:true, tension:.35, pointRadius:3, borderWidth:2 },
        ], { plugins:{ legend:{ display:true, position:'top', labels:{ font:{size:10}, boxWidth:12 } } } });

        const slaOut = slaTot - slaOk;
        _reqIndMkChart('req-ind-canvas-sla', 'doughnut', ['Dentro SLA','Fuera SLA','En riesgo'], [{
            data:[slaOk, Math.max(0,slaOut-slaBreachOpen.length), slaBreachOpen.length],
            backgroundColor:['rgba(34,197,94,.8)','rgba(245,158,11,.8)','rgba(239,68,68,.8)'],
            borderWidth:1,
        }], { cutout:'68%', plugins:{ legend:{ display:true, position:'bottom', labels:{font:{size:9},boxWidth:10} } } });
    });
}

// ── COMPARATIVA SEMANAL ───────────────────────────────────────────────────────
async function reqLoadComparativa(force) {
    const el = document.getElementById('req-panel-cmp-content');
    if (!el) return;
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px;font-size:12px;color:var(--text-muted);"><span class="req-spin"></span> Calculando comparativa…</div>';
    try {
        const [curr, prev] = await Promise.all([
            jira('POST', '/rest/api/3/search/jql', { jql:'project = REQ AND created >= -7d ORDER BY created DESC', maxResults:200, fields:['summary','status','priority','created','resolutiondate'] }),
            jira('POST', '/rest/api/3/search/jql', { jql:'project = REQ AND created >= -14d AND created < -7d ORDER BY created DESC', maxResults:200, fields:['summary','status','priority','created','resolutiondate'] }),
        ]);
        _reqRenderComparativa(curr.issues || [], prev.issues || [], el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function _reqRenderComparativa(curr, prev, el) {
    const isClosed = issues => issues.filter(i => /(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||''));
    const isPend   = issues => issues.filter(i => /pend|wait/i.test(i.fields?.status?.name||''));

    const metrics = [
        { label:'Nuevos REQ',  curr:curr.length,                 prev:prev.length,                 icon:'bi-plus-circle-fill',    color:'#6366f1', better:'higher' },
        { label:'Cerrados',    curr:isClosed(curr).length,       prev:isClosed(prev).length,       icon:'bi-check2-circle',        color:'#10b981', better:'higher' },
        { label:'Pendientes',  curr:isPend(curr).length,         prev:isPend(prev).length,         icon:'bi-pause-circle-fill',    color:'#f59e0b', better:'lower'  },
        { label:'Abiertos',    curr:curr.length-isClosed(curr).length, prev:prev.length-isClosed(prev).length, icon:'bi-hourglass-split', color:'#f97316', better:'lower' },
    ];

    el.innerHTML = `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px;display:flex;align-items:center;gap:6px;"><i class="bi bi-calendar2-week" style="color:#6366f1;"></i> Esta semana vs semana anterior</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
        ${metrics.map(m => {
            const delta = m.curr - m.prev;
            const pct   = m.prev ? Math.round(Math.abs(delta) / m.prev * 100) : (delta > 0 ? 100 : 0);
            const isGood = (m.better==='higher' && delta>0) || (m.better==='lower' && delta<0);
            const arrow  = delta > 0 ? '↑' : delta < 0 ? '↓' : '=';
            const dClass = delta === 0 ? 'neu' : isGood ? 'up' : 'down';
            return `<div class="req-cmp-card" style="border-left:4px solid ${m.color};">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;"><i class="bi ${m.icon}" style="color:${m.color};font-size:14px;"></i><span style="font-size:11px;font-weight:600;color:var(--text-muted);">${m.label}</span></div>
              <div class="req-cmp-val" style="color:${m.color};">${m.curr}</div>
              <div class="req-cmp-delta ${dClass}">${arrow} ${Math.abs(delta)}${pct?' ('+pct+'%)':''} vs sem. ant.</div>
            </div>`;
        }).join('')}
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;overflow:hidden;">
        <div style="padding:10px 14px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:6px;"><i class="bi bi-list-ul" style="color:#6366f1;"></i> Esta semana (${curr.length} requerimientos)</div>
        <div style="padding:8px 14px;">
          ${curr.length ? curr.slice(0,12).map(i => {
              const f      = i.fields || {};
              const st     = f.status?.name || '—';
              const closed = /(done|cerr|resuelto|resolved|completado)/i.test(st);
              const pr     = f.priority?.name || '—';
              const prioCl = /critico|critical|highest/i.test(pr) ? '#ef4444' : /high|alta/i.test(pr) ? '#f59e0b' : '#6366f1';
              return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-soft);font-size:12px;">
                <span style="font-family:monospace;font-weight:700;color:#6366f1;font-size:11px;flex-shrink:0;"><a href="https://integratelperu.atlassian.net/browse/${i.key}" target="_blank" style="color:#6366f1;text-decoration:none;">${i.key}</a></span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${reqEsc(f.summary||'')}</span>
                <span style="font-size:10px;font-weight:700;color:${prioCl};flex-shrink:0;">${reqEsc(pr)}</span>
                <span style="font-size:10px;font-weight:600;color:${closed?'#10b981':'#f59e0b'};flex-shrink:0;">${reqEsc(st)}</span>
              </div>`;
          }).join('') : '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;">Sin requerimientos esta semana</div>'}
          ${curr.length > 12 ? `<div style="padding:8px 0 2px;font-size:11px;color:var(--text-muted);">+${curr.length-12} más</div>` : ''}
        </div>
      </div>
    `;
}

// ── REPORTES ──────────────────────────────────────────────────────────────────
let _reqRptData = null;
let _reqRptFilter = { prio:'', status:'' };

async function reqLoadReportes(force) {
    const el = document.getElementById('req-panel-rpt-content');
    if (!el) return;
    if (!force && _reqRptData) { _reqRenderReportes(el); return; }
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px;font-size:12px;color:var(--text-muted);"><span class="req-spin"></span> Cargando reportes…</div>';
    try {
        const data = await jira('POST', '/rest/api/3/search/jql', {
            jql: 'project = REQ AND created >= -90d ORDER BY created DESC',
            maxResults: 500,
            fields: ['summary','status','assignee','reporter','priority','created','resolutiondate','issuetype','components']
        });
        _reqRptData = data.issues || [];
        _reqRenderReportes(el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function reqSetRptFilter(key, val) {
    _reqRptFilter[key] = val;
    const el = document.getElementById('req-panel-rpt-content');
    if (el) _reqRenderReportes(el);
}

function _reqRenderReportes(el) {
    if (!_reqRptData) return;
    let data = _reqRptData;
    if (_reqRptFilter.prio)   data = data.filter(i => (i.fields?.priority?.name||'').toLowerCase().includes(_reqRptFilter.prio));
    if (_reqRptFilter.status) {
        data = data.filter(i => {
            const st = (i.fields?.status?.name||'').toLowerCase();
            if (_reqRptFilter.status === 'open')    return !/(done|cerr|resuelto|resolved|completado)/.test(st);
            if (_reqRptFilter.status === 'closed')  return  /(done|cerr|resuelto|resolved|completado)/.test(st);
            if (_reqRptFilter.status === 'pending') return /pend|wait/.test(st);
            return true;
        });
    }
    const total  = data.length;
    const closed = data.filter(i => /(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||'')).length;
    const p1     = data.filter(i => /(critico|critical|highest)/i.test(i.fields?.priority?.name||'')).length;

    el.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
        <select onchange="reqSetRptFilter('prio',this.value)" style="font-size:12px;padding:5px 10px;border:1px solid var(--border-soft);border-radius:6px;background:var(--bg-card);color:var(--text-main);">
          <option value="">Todas las prioridades</option>
          <option value="critico">P1 Crítico</option><option value="high">P2 Alto</option><option value="medium">P3 Medio</option><option value="low">P4 Bajo</option>
        </select>
        <select onchange="reqSetRptFilter('status',this.value)" style="font-size:12px;padding:5px 10px;border:1px solid var(--border-soft);border-radius:6px;background:var(--bg-card);color:var(--text-main);">
          <option value="">Todos los estados</option>
          <option value="open">Abiertos</option><option value="closed">Cerrados</option><option value="pending">Pendientes</option>
        </select>
        <span style="font-size:12px;color:var(--text-muted);margin-left:auto;">${total} REQ · últimos 90 días</span>
        <button class="btn-outline-sm" onclick="reqExportReporteCsv()" style="font-size:11px;"><i class="bi bi-download"></i> CSV</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <div class="stat-card" style="border-top:2px solid #6366f1;"><div class="stat-val" style="color:#6366f1;">${total}</div><div class="stat-lbl">Total</div></div>
        <div class="stat-card" style="border-top:2px solid #10b981;"><div class="stat-val" style="color:#10b981;">${closed}</div><div class="stat-lbl">Cerrados</div></div>
        <div class="stat-card" style="border-top:2px solid #f59e0b;"><div class="stat-val" style="color:#f59e0b;">${total-closed}</div><div class="stat-lbl">Abiertos</div></div>
        <div class="stat-card" style="border-top:2px solid #ef4444;"><div class="stat-val" style="color:#ef4444;">${p1}</div><div class="stat-lbl">P1</div></div>
        <div class="stat-card" style="border-top:2px solid #10b981;"><div class="stat-val" style="color:#10b981;">${total ? Math.round(closed/total*100) : 0}%</div><div class="stat-lbl">Cierre</div></div>
      </div>
      <div style="overflow-x:auto;max-height:420px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:10px;">
        <table class="rpt-table">
          <thead><tr><th>Clave</th><th>Resumen</th><th>Prioridad</th><th>Estado</th><th>Asignado</th><th>Reporter</th><th>Fecha</th></tr></thead>
          <tbody>
            ${data.slice(0,100).map(i => {
                const f      = i.fields || {};
                const st     = f.status?.name || '—';
                const pr     = f.priority?.name || '—';
                const closed = /(done|cerr|resuelto|resolved|completado)/i.test(st);
                const prioCl = /critico|critical|highest/i.test(pr) ? '#ef4444' : /high|alta/i.test(pr) ? '#f59e0b' : '#6366f1';
                const d      = f.created ? new Date(f.created).toLocaleDateString('es-PE',{day:'2-digit',month:'short'}) : '—';
                return `<tr>
                  <td><a href="https://integratelperu.atlassian.net/browse/${i.key}" target="_blank" style="color:#6366f1;font-family:monospace;font-weight:700;text-decoration:none;">${i.key}</a></td>
                  <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${reqEsc(f.summary||'')}">${reqEsc(f.summary||'')}</td>
                  <td><span style="color:${prioCl};font-weight:700;font-size:11px;">${reqEsc(pr)}</span></td>
                  <td><span style="color:${closed?'#10b981':'#f59e0b'};font-weight:700;font-size:11px;">${reqEsc(st)}</span></td>
                  <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${reqEsc(f.assignee?.displayName||'—')}</td>
                  <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${reqEsc(f.reporter?.emailAddress||f.reporter?.displayName||'—')}</td>
                  <td style="white-space:nowrap;font-size:11px;">${d}</td>
                </tr>`;
            }).join('')}
            ${data.length > 100 ? `<tr><td colspan="7" style="padding:8px;text-align:center;color:var(--text-muted);font-size:11px;">+${data.length-100} más — exporta CSV para todos</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
}

function reqExportReporteCsv() {
    if (!_reqRptData?.length) { showToast('Sin datos para exportar', 'error'); return; }
    const rows = [['Clave','Resumen','Prioridad','Estado','Asignado','Reporter','Fecha']];
    _reqRptData.forEach(i => {
        const f = i.fields || {};
        rows.push([ i.key, (f.summary||'').replace(/,/g,';'), f.priority?.name||'', f.status?.name||'', f.assignee?.displayName||'', f.reporter?.emailAddress||f.reporter?.displayName||'', f.created ? new Date(f.created).toLocaleDateString('es-PE') : '' ]);
    });
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const url  = URL.createObjectURL(new Blob(['﻿' + csv], {type:'text/csv;charset=utf-8'}));
    const a    = document.createElement('a');
    a.href = url; a.download = `requerimientos_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('✓ Reporte exportado', 'success');
}

// ── PANELES (dashboards con Chart.js) ────────────────────────────────────────

let _reqPanData   = null;
let _reqPanPeriod = 90;
let _reqPanCharts = {};
const _REQ_PAN_CHIPS = [
    { id:'monthly',  label:'Tendencia mensual',  icon:'bar-chart-fill' },
    { id:'weekly',   label:'Tendencia semanal',  icon:'bar-chart-steps' },
    { id:'status',   label:'Por estado',         icon:'pie-chart-fill' },
    { id:'prio',     label:'Por prioridad',      icon:'exclamation-circle-fill' },
    { id:'tipo',     label:'Por tipo',           icon:'tag-fill' },
    { id:'assignee', label:'Por técnico',        icon:'person-fill' },
    { id:'sla',      label:'SLA por prioridad',  icon:'clock-fill' },
    { id:'reporter', label:'Top reporters',      icon:'people-fill' },
];
let _reqPanActive = new Set(['monthly','status','prio','tipo']);

async function reqLoadPaneles(force) {
    const el = document.getElementById('req-panel-pan-content');
    if (!el) return;
    if (!force && _reqPanData !== null) { _reqRenderPaneles(_reqPanData, el); return; }
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:20px;font-size:12px;color:var(--text-muted);"><span class="req-spin"></span> Cargando paneles…</div>';
    try {
        const d = await jira('POST', '/rest/api/3/search/jql', {
            jql: `project = REQ AND created >= -${_reqPanPeriod}d ORDER BY created DESC`,
            maxResults: 1000,
            fields: ['summary','status','assignee','priority','created','resolutiondate','issuetype','components','reporter']
        });
        _reqPanData = d.issues || [];
        _reqRenderPaneles(_reqPanData, el);
    } catch(e) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;font-size:2rem;"></i><p style="color:#ef4444;">${reqEsc(e.message)}</p></div>`;
    }
}

function reqPanSetPeriod(days, btn) {
    _reqPanPeriod = days;
    document.querySelectorAll('.req-pan-period-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _reqPanData = null;
    Object.values(_reqPanCharts).forEach(ch => { try { ch.destroy(); } catch {} });
    _reqPanCharts = {};
    reqLoadPaneles(true);
}

function reqPanToggleChip(id) {
    if (_reqPanActive.has(id)) _reqPanActive.delete(id);
    else _reqPanActive.add(id);
    document.querySelectorAll('.req-mp-chip').forEach(c => {
        const cid = c.dataset.chip;
        c.classList.toggle('active', _reqPanActive.has(cid));
    });
    const card = document.getElementById('req-pan-card-' + id);
    if (card) {
        card.style.display = _reqPanActive.has(id) ? '' : 'none';
        if (_reqPanActive.has(id) && _reqPanData) _reqDrawPanChart(id, _reqPanData);
    }
}

function _reqRenderPaneles(issues, el) {
    const open    = issues.filter(i => !/(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||''));
    const closed  = issues.filter(i =>  /(done|cerr|resuelto|resolved|completado)/i.test(i.fields?.status?.name||''));
    const sinAsig = open.filter(i => !i.fields?.assignee);
    let slaOk = 0, slaTot = 0;
    issues.forEach(i => {
        const maxH = _REQ_SLA_H[(i.fields?.priority?.name||'').toLowerCase()] || 24;
        if (i.fields?.resolutiondate) {
            slaTot++;
            const h = (new Date(i.fields.resolutiondate) - new Date(i.fields?.created)) / 3600000;
            if (h <= maxH) slaOk++;
        }
    });
    const slaPct  = slaTot ? Math.round(slaOk / slaTot * 100) : '—';
    const tiposCt = new Set(issues.map(i => i.fields?.issuetype?.name || 'Sin tipo')).size;

    el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:10px;color:var(--text-muted);font-family:monospace;letter-spacing:.08em;">PERÍODO</span>
      <button class="req-pan-period-btn${_reqPanPeriod===30?' active':''}"  onclick="reqPanSetPeriod(30,this)">30 días</button>
      <button class="req-pan-period-btn${_reqPanPeriod===90?' active':''}"  onclick="reqPanSetPeriod(90,this)">90 días</button>
      <button class="req-pan-period-btn${_reqPanPeriod===180?' active':''}" onclick="reqPanSetPeriod(180,this)">6 meses</button>
      <button class="req-pan-period-btn${_reqPanPeriod===365?' active':''}" onclick="reqPanSetPeriod(365,this)">1 año</button>
    </div>
    <div class="req-mp-kpi-row">
      <div class="req-mp-kpi"><div class="req-mp-kpi-v">${issues.length}</div><div class="req-mp-kpi-l">Total</div></div>
      <div class="req-mp-kpi"><div class="req-mp-kpi-v" style="color:#f59e0b;">${open.length}</div><div class="req-mp-kpi-l">Abiertos</div></div>
      <div class="req-mp-kpi"><div class="req-mp-kpi-v" style="color:#22c55e;">${closed.length}</div><div class="req-mp-kpi-l">Cerrados</div></div>
      <div class="req-mp-kpi"><div class="req-mp-kpi-v" style="color:#ef4444;">${sinAsig.length}</div><div class="req-mp-kpi-l">Sin asignar</div></div>
      <div class="req-mp-kpi"><div class="req-mp-kpi-v" style="color:#6366f1;">${slaPct}${slaTot?'%':''}</div><div class="req-mp-kpi-l">SLA %</div></div>
      <div class="req-mp-kpi"><div class="req-mp-kpi-v">${tiposCt}</div><div class="req-mp-kpi-l">Tipos</div></div>
    </div>
    <div class="req-mp-chip-bar">
      ${_REQ_PAN_CHIPS.map(c => `
      <button class="req-mp-chip${_reqPanActive.has(c.id)?' active':''}" data-chip="${c.id}" onclick="reqPanToggleChip('${c.id}')">
        <i class="bi bi-${c.icon}"></i> ${c.label}
      </button>`).join('')}
    </div>
    <div class="req-mp-chart-grid">
      ${_REQ_PAN_CHIPS.map(c => `
      <div class="req-mp-chart-card" id="req-pan-card-${c.id}" style="${_reqPanActive.has(c.id)?'':'display:none'}">
        <div class="req-mp-chart-hd">
          <span><i class="bi bi-${c.icon}" style="margin-right:5px;color:#6366f1;"></i>${c.label}</span>
          <button class="req-mp-chart-dl" onclick="reqPanDownloadChart('${c.id}')" title="Descargar PNG"><i class="bi bi-download"></i></button>
        </div>
        <div class="req-mp-chart-body"><canvas id="req-pan-canvas-${c.id}"></canvas></div>
      </div>`).join('')}
    </div>`;

    requestAnimationFrame(() => {
        _REQ_PAN_CHIPS.forEach(c => { if (_reqPanActive.has(c.id)) _reqDrawPanChart(c.id, issues); });
    });
}

function _reqMkChart(id, type, labels, datasets, extra) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (_reqPanCharts[id]) { try { _reqPanCharts[id].destroy(); } catch {} }
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridCol = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const tickCol = isDark ? '#94a3b8' : '#64748b';
    const opts = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: type === 'doughnut',
                position: 'right',
                labels: { font: { size: 10 }, boxWidth: 12, color: tickCol },
            },
        },
        ...(type !== 'doughnut' ? {
            scales: {
                x: { ticks: { font: { size: 10 }, color: tickCol }, grid: { color: gridCol } },
                y: { ticks: { font: { size: 10 }, color: tickCol }, grid: { color: gridCol } },
            }
        } : {}),
        ...extra,
    };
    _reqPanCharts[id] = new Chart(canvas, { type, data: { labels, datasets }, options: opts });
}

function _reqDrawPanChart(id, issues) {
    const IND  = 'rgba(99,102,241,.75)';
    const GRN  = 'rgba(34,197,94,.75)';
    const VIO  = 'rgba(124,58,237,.75)';

    if (id === 'monthly') {
        const nMo = _reqPanPeriod <= 30 ? 1 : _reqPanPeriod <= 90 ? 3 : _reqPanPeriod <= 180 ? 6 : 12;
        const months = {};
        const now = new Date();
        for (let i = nMo - 1; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months[d.toLocaleDateString('es-PE', { month:'short', year:'2-digit' })] = { c:0, r:0 };
        }
        issues.forEach(i => {
            const ck = new Date(i.fields?.created).toLocaleDateString('es-PE', { month:'short', year:'2-digit' });
            if (months[ck]) months[ck].c++;
            if (i.fields?.resolutiondate) {
                const rk = new Date(i.fields.resolutiondate).toLocaleDateString('es-PE', { month:'short', year:'2-digit' });
                if (months[rk]) months[rk].r++;
            }
        });
        const lbls = Object.keys(months);
        _reqMkChart('req-pan-canvas-monthly', 'bar', lbls, [
            { label:'Creados',  data:lbls.map(k=>months[k].c), backgroundColor:IND, borderRadius:4 },
            { label:'Cerrados', data:lbls.map(k=>months[k].r), backgroundColor:GRN, borderRadius:4 },
        ]);

    } else if (id === 'weekly') {
        const weeks = {};
        for (let i = 7; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i * 7);
            weeks[`S${_reqIsoWeek(d)}`] = { c:0, r:0 };
        }
        issues.forEach(i => {
            const ck = `S${_reqIsoWeek(new Date(i.fields?.created))}`;
            if (weeks[ck]) weeks[ck].c++;
            if (i.fields?.resolutiondate) {
                const rk = `S${_reqIsoWeek(new Date(i.fields.resolutiondate))}`;
                if (weeks[rk]) weeks[rk].r++;
            }
        });
        const lbls = Object.keys(weeks);
        _reqMkChart('req-pan-canvas-weekly', 'bar', lbls, [
            { label:'Creados',  data:lbls.map(k=>weeks[k].c), backgroundColor:IND, borderRadius:4 },
            { label:'Cerrados', data:lbls.map(k=>weeks[k].r), backgroundColor:GRN, borderRadius:4 },
        ]);

    } else if (id === 'status') {
        const counts = {};
        issues.forEach(i => { const s = i.fields?.status?.name||'Sin estado'; counts[s]=(counts[s]||0)+1; });
        const palette = ['#6366f1','#22c55e','#f59e0b','#ef4444','#0891b2','#7c3aed','#ec4899','#64748b'];
        const lbls = Object.keys(counts);
        _reqMkChart('req-pan-canvas-status', 'doughnut', lbls, [{
            data: Object.values(counts),
            backgroundColor: lbls.map((_,i) => palette[i%palette.length]),
            borderWidth: 1,
        }]);

    } else if (id === 'prio') {
        const order = ['Highest','Critical','High','Medium','Low','Lowest'];
        const counts = {};
        issues.forEach(i => { const p = i.fields?.priority?.name||'Sin prioridad'; counts[p]=(counts[p]||0)+1; });
        const sorted = [...new Set([...order,...Object.keys(counts)])].filter(k=>counts[k]);
        const clr = {Highest:'rgba(220,38,38,.8)',Critical:'rgba(220,38,38,.8)',High:'rgba(234,88,12,.8)',Medium:'rgba(245,158,11,.8)',Low:'rgba(34,197,94,.8)',Lowest:'rgba(100,116,139,.8)'};
        _reqMkChart('req-pan-canvas-prio', 'bar', sorted, [{
            label:'REQ', data:sorted.map(k=>counts[k]||0),
            backgroundColor:sorted.map(k=>clr[k]||IND), borderRadius:4,
        }], { plugins:{ legend:{display:false} } });

    } else if (id === 'tipo') {
        const counts = {};
        issues.forEach(i => { const t = i.fields?.issuetype?.name||'Sin tipo'; counts[t]=(counts[t]||0)+1; });
        const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
        _reqMkChart('req-pan-canvas-tipo', 'bar', sorted.map(([k])=>k), [{
            label:'REQ', data:sorted.map(([,v])=>v), backgroundColor:IND, borderRadius:4,
        }], { indexAxis:'y', plugins:{ legend:{display:false} } });

    } else if (id === 'assignee') {
        const counts = {};
        issues.forEach(i => { const a = i.fields?.assignee?.displayName||'Sin asignar'; counts[a]=(counts[a]||0)+1; });
        const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
        const lbls   = sorted.map(([k])=>k.length>22?k.slice(0,20)+'…':k);
        _reqMkChart('req-pan-canvas-assignee', 'bar', lbls, [{
            label:'Asignados', data:sorted.map(([,v])=>v), backgroundColor:IND, borderRadius:4,
        }], { indexAxis:'y', plugins:{ legend:{display:false} } });

    } else if (id === 'sla') {
        const order = ['Highest','Critical','High','Medium','Low','Lowest'];
        const byPrio = {};
        issues.forEach(i => {
            const p = i.fields?.priority?.name||'Sin prioridad';
            if (!byPrio[p]) byPrio[p] = {ok:0,tot:0};
            if (i.fields?.resolutiondate) {
                byPrio[p].tot++;
                const maxH = _REQ_SLA_H[p.toLowerCase()]||24;
                const h = (new Date(i.fields.resolutiondate)-new Date(i.fields?.created))/3600000;
                if (h<=maxH) byPrio[p].ok++;
            }
        });
        const lbls = [...new Set([...order,...Object.keys(byPrio)])].filter(k=>byPrio[k]?.tot);
        const data = lbls.map(k=>byPrio[k]?Math.round(byPrio[k].ok/byPrio[k].tot*100):0);
        _reqMkChart('req-pan-canvas-sla', 'bar', lbls, [{
            label:'% SLA', data,
            backgroundColor:data.map(v=>v>=80?'rgba(34,197,94,.75)':v>=60?'rgba(245,158,11,.75)':'rgba(239,68,68,.75)'),
            borderRadius:4,
        }], { plugins:{ legend:{display:false} }, scales:{ y:{ min:0,max:100, ticks:{ callback:v=>v+'%', font:{size:10} } } } });

    } else if (id === 'reporter') {
        const counts = {};
        issues.forEach(i => { const r = i.fields?.reporter?.emailAddress||i.fields?.reporter?.displayName||'Sin reporter'; counts[r]=(counts[r]||0)+1; });
        const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
        const lbls   = sorted.map(([k])=>k.length>26?k.slice(0,24)+'…':k);
        _reqMkChart('req-pan-canvas-reporter', 'bar', lbls, [{
            label:'REQ', data:sorted.map(([,v])=>v), backgroundColor:VIO, borderRadius:4,
        }], { indexAxis:'y', plugins:{ legend:{display:false} } });
    }
}

function _reqIsoWeek(d) {
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay()||7));
    const y1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    return Math.ceil((((dt-y1)/86400000)+1)/7);
}

function reqPanDownloadChart(id) {
    const canvas = document.getElementById('req-pan-canvas-' + id);
    if (!canvas) return;
    const a = document.createElement('a');
    a.href     = canvas.toDataURL('image/png');
    a.download = `req-paneles-${id}-${new Date().toISOString().slice(0,10)}.png`;
    a.click();
}
