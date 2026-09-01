
let allTickets=[],filteredData=[],currentPage=1;
const PAGE_SIZE=20;
let activePill='all',closeTicketKey=null,closeTicketUrl=null;
let acTimer=null,acIdx=-1;
let _techRoster=[];

document.addEventListener('DOMContentLoaded',()=>{
    // Placeholder dinámico según dominio del tenant
    const _domain=(typeof TENANT_EMAIL_DOMAIN!=='undefined'&&TENANT_EMAIL_DOMAIN)?TENANT_EMAIL_DOMAIN:'empresa.com';
    const _cfR=document.getElementById('cf_reporter');
    if(_cfR) _cfR.placeholder='usuario@'+_domain;
    // Pre-fill solo para usuarios reales (no superadmin ni plataforma.local)
    const _selfEmail=(typeof CURRENT_USER_EMAIL!=='undefined'&&CURRENT_USER_EMAIL&&CURRENT_USER_ROLE!=='superadmin'&&!CURRENT_USER_EMAIL.endsWith('@plataforma.local'))?CURRENT_USER_EMAIL:(localStorage.getItem('portal_user_email')||'');
    if(_selfEmail&&_cfR&&!_cfR.value){_cfR.value=_selfEmail;loadEmployeeInfo(_selfEmail);}
    setupDragDrop();
    fetch('/api/jira/categories',{credentials:'include'}).then(r=>r.json()).then(j=>{
        const flat=j.data||[];
        const byId={};flat.forEach(c=>{byId[c.id]=c;});
        flat.forEach(c=>{if(c.parent_id&&byId[c.parent_id])c.parent_name=byId[c.parent_id].name;});
        allCategories=flat;
    }).catch(()=>{});
    loadTechnicians();
    loadTechRoster();
    document.addEventListener('click',e=>{
        if(!e.target.closest('.autocomplete-wrap')){
            hideAc('acReporterDrop');
            hideAc('acCfReporterDrop');
            hideAc('acCategoryDrop');
            hideAc('acIncSearchDrop');
            const bkDrop=document.getElementById('bkCatDrop');if(bkDrop)bkDrop.style.display='none';
        }
        if(!e.target.closest('.tech-quick-wrap')){
            document.querySelectorAll('.tech-quick-drop.show').forEach(d=>d.classList.remove('show'));
        }
    });
});

// ── Tabs ──────────────────────────────────────────────────
function switchTab(name, btn){
    ['tabCreate','tabGestion','tabCategorias'].forEach(id=>{
        const el=document.getElementById(id);
        if(el) el.style.display='none';
    });
    document.querySelectorAll('.corp-tab').forEach(b=>b.classList.remove('active'));
    const panels={create:'tabCreate',gestion:'tabGestion',categorias:'tabCategorias'};
    const target=document.getElementById(panels[name]);
    if(target) target.style.display='block';
    if(btn) btn.classList.add('active');
    if(name==='categorias') loadCatListInline();
    if(name==='gestion'&&allTickets.length===0) loadTickets();
}

// ── Formulario simple (Tab Registrar) ────────────────────
let cfSelectedCat=null;

function acCfReporter(q){
    clearTimeout(acTimer);
    if(!q||q.length<2){hideAc('acCfReporterDrop');return;}
    acTimer=setTimeout(async()=>{
        try{
            const _tid=(typeof CURRENT_TENANT_ID!=='undefined')?CURRENT_TENANT_ID:1;
            const _acUrl=(_tid&&_tid!=1)?`/api/portal/users/search?q=${encodeURIComponent(q)}`:`/api/employees/search-emails?q=${encodeURIComponent(q)}`;
            const r=await fetch(_acUrl,{credentials:'include'}).then(x=>x.json());
            const d=document.getElementById('acCfReporterDrop');
            const list=(r.data||[]).filter(u=>u.email);
            if(!list.length){d.innerHTML='<div class="ac-empty">Sin resultados</div>';d.classList.add('show');return;}
            d.innerHTML=list.map(u=>`<div class="ac-item" onclick="pickCfReporter('${u.email}')"><span class="ac-email">${u.email}</span><span class="ac-details">${u.full_name||''}${u.position_name?' · '+u.position_name:''}</span></div>`).join('');
            d.classList.add('show');
        }catch(e){}
    },280);
}
function pickCfReporter(email){
    document.getElementById('cf_reporter').value=email;
    hideAc('acCfReporterDrop');
    loadEmployeeInfo(email);
}
function loadEmployeeInfo(email){
    if(!email||email.length<4){document.getElementById('cfEmployeeInfo').style.display='none';hideCmdbAlert();return;}
    fetch(`/api/jira/employee-info?email=${encodeURIComponent(email)}`,{credentials:'include'})
        .then(r=>r.json())
        .then(j=>{
            const info=document.getElementById('cfEmployeeInfo');
            const d=j.data||{};
            document.getElementById('cfEqEquipo').textContent      = d.equipo      || '—';
            document.getElementById('cfEqModelo').textContent      = d.modelo      || '—';
            document.getElementById('cfEqDepartamento').textContent= d.department  || '—';
            document.getElementById('cfEqUbicacion').textContent   = d.ubicacion   || '—';
            info.style.display='block';
            const dc = d.equipo || '';
            const dcEl = document.getElementById('cf_device_code');
            if (dcEl) dcEl.value = dc;
            if (dc) checkDeviceCmdb(dc);
            else hideCmdbAlert();
        })
        .catch(()=>{document.getElementById('cfEmployeeInfo').style.display='none';hideCmdbAlert();});
}

// ── CMDB: chequeo de recurrencia por equipo ────────────────
async function checkDeviceCmdb(code) {
    try {
        const r = await fetch(`/api/jira/cmdb/device/${encodeURIComponent(code)}`, { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        if (!d.success) return;
        showCmdbAlert(d, code);
    } catch(_) {}
}
function showCmdbAlert(d, code) {
    const el = document.getElementById('cfCmdbAlert');
    const titleEl = document.getElementById('cfCmdbAlertTitle');
    const bodyEl  = document.getElementById('cfCmdbAlertBody');
    const linkEl  = document.getElementById('cfCmdbAlertLink');
    if (!el) return;
    const h = d.history || {};
    const n30 = h.last30 || 0;
    const n60 = h.last60 || 0;
    const total = h.total || 0;
    if (n30 === 0 && total === 0) { hideCmdbAlert(); return; }
    const risk = h.risk || 'bajo';
    const colors = { critico: '#dc2626', alto: '#d97706', medio: '#2563eb', bajo: '#059669' };
    const borderColor = colors[risk] || colors.bajo;
    const bgs = { critico: 'rgba(220,38,38,.08)', alto: 'rgba(245,158,11,.08)', medio: 'rgba(37,99,235,.07)', bajo: 'rgba(5,150,105,.06)' };
    el.style.borderLeftColor = borderColor;
    el.style.background = bgs[risk] || bgs.bajo;
    let title = '', body = '';
    if (h.recommendation === 'reemplazo_urgente') {
        title = `⚠ Equipo ${code} — Reemplazo urgente recomendado`;
        body  = `Este equipo registró <b>${n30} incidencias en los últimos 30 días</b> y <b>${n60} en 60 días</b> (total histórico: ${total}). Alta probabilidad de falla próxima.`;
    } else if (h.recommendation === 'considerar_reemplazo') {
        title = `⚠ Equipo ${code} — Considerar reemplazo`;
        body  = `Este equipo tuvo <b>${n30} incidencias en los últimos 30 días</b> (total: ${total}). Se recomienda evaluación de reemplazo o mantenimiento preventivo.`;
    } else if (n30 >= 2) {
        title = `Equipo ${code} — Recurrencia moderada`;
        body  = `${n30} incidencias en 30 días · ${total} en total. Monitorear de cerca.`;
    } else {
        title = `Equipo ${code} — ${total} incidencia${total !== 1 ? 's' : ''} en histórico`;
        body  = `Sin alertas de recurrencia. Registrado para trazabilidad CMDB.`;
    }
    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.innerHTML = body;
    if (linkEl)  linkEl.onclick = (e) => { e.preventDefault(); openCmdbDeviceModal(code, d); };
    el.style.display = 'block';
}
function hideCmdbAlert() {
    const el = document.getElementById('cfCmdbAlert');
    if (el) el.style.display = 'none';
}

function acCategory(q){
    ariaClassify(q);
    const d=document.getElementById('acCategoryDrop');
    if(!q||q.length<2){d.classList.remove('show');d.innerHTML='';return;}
    const ql=q.toLowerCase();
    const matches=allCategories.filter(c=>c.name.toLowerCase().includes(ql));
    if(!matches.length){
        d.innerHTML='<div class="ac-empty">Sin coincidencias</div>';d.classList.add('show');return;
    }
    d.innerHTML=matches.map(c=>`
        <div class="ac-item" onclick="pickCategory(${c.id})">
            <span class="ac-email"><i class="bi ${c.icon||'bi-tag'}" style="margin-right:6px;color:var(--jira-blue);"></i>${c.name}</span>
            <span class="ac-details">${c.parent_name?c.parent_name:([c.component_label,c.app_label].filter(Boolean).join(' · ')||'')}</span>
        </div>`).join('');
    d.classList.add('show');
}
function pickCategory(id){
    cfSelectedCat=allCategories.find(c=>c.id===id)||null;
    hideAc('acCategoryDrop');
    if(!cfSelectedCat) return;
    // Mostrar badge
    const badge=document.getElementById('catSelectedBadge');
    const txt=document.getElementById('catBadgeText');
    txt.innerHTML=`<i class="bi ${cfSelectedCat.icon||'bi-tag'}"></i> ${cfSelectedCat.name}`;
    badge.style.display='flex';
    // Reemplazar el texto del input con el nombre completo de la categoría
    document.getElementById('cf_summary').value=cfSelectedCat.name;
    // Rellenar campos ocultos
    document.getElementById('cf_component').value=cfSelectedCat.component_id||'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277';
    document.getElementById('cf_app').value      =cfSelectedCat.app_id||'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11280';
    document.getElementById('cf_tipologia').value=cfSelectedCat.tipologia_id||'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11379';
    document.getElementById('cf_impact').value   =cfSelectedCat.impact_id||'618437';
    document.getElementById('cf_urgency').value  =cfSelectedCat.urgency_id||'618441';
    // Auto-fill description
    const summary=document.getElementById('cf_summary').value.trim();
    const tpl=cfSelectedCat.description_template||'';
    document.getElementById('cf_description').value=tpl
        ? tpl.replace(/\{summary\}/gi,summary||cfSelectedCat.name)
        : `Problemas con ${summary||cfSelectedCat.name}.`;
    // KB sugerida
    triggerKbSuggest(cfSelectedCat.name);
}
function clearCatSelection(){
    cfSelectedCat=null;
    document.getElementById('catSelectedBadge').style.display='none';
    document.getElementById('cf_summary').value='';
    document.getElementById('cf_description').value='';
    ['cf_component','cf_app','cf_tipologia','cf_impact','cf_urgency'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('kbSuggestWrap').style.display='none';
    document.getElementById('cf_summary').focus();
}

// ── ARIA Auto-clasificación ───────────────────────────────
let _ariaTimer = null;
function ariaClassify(q) {
    clearTimeout(_ariaTimer);
    hideAriaChip();
    if (!q || q.length < 4) return;
    _ariaTimer = setTimeout(async () => {
        try {
            const r = await fetch('/api/ai/classify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ titulo: q, descripcion: '' })
            });
            if (!r.ok) return;
            const d = await r.json();
            if (d && (d.categoria || d.prioridad)) showAriaChip(d);
        } catch (_) {}
    }, 600);
}
function showAriaChip(data) {
    let chip = document.getElementById('ariaChip');
    if (!chip) {
        chip = document.createElement('div');
        chip.id = 'ariaChip';
        chip.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 12px;background:linear-gradient(135deg,rgba(99,102,241,.10),rgba(168,85,247,.10));border:1px solid rgba(99,102,241,.3);border-radius:8px;font-size:12px;animation:ariaSlideIn .25s ease;';
        const summaryField = document.getElementById('cf_summary');
        if (summaryField && summaryField.parentNode) {
            summaryField.parentNode.insertBefore(chip, summaryField.nextSibling);
        }
    }
    const pBadge = { P1:'#ef4444', P2:'#f59e0b', P3:'#3b82f6', P4:'#6b7280' };
    const pColor = pBadge[data.prioridad] || '#6b7280';
    chip.innerHTML = `
        <i class="bi bi-stars" style="color:#818cf8;font-size:14px;"></i>
        <span style="color:var(--text-muted);">ARIA sugiere:</span>
        <span style="font-weight:600;color:var(--text-main);">${data.categoria||'—'}</span>
        ${data.prioridad ? `<span style="padding:1px 7px;border-radius:12px;background:${pColor}22;color:${pColor};font-weight:700;">${data.prioridad}</span>` : ''}
        <button onclick="ariaAccept(${JSON.stringify(data.categoria||'').replace(/"/g,"'")})" style="margin-left:4px;padding:2px 10px;border:none;background:rgba(99,102,241,.18);color:#818cf8;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Usar →</button>
        <button onclick="hideAriaChip()" style="margin-left:2px;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:14px;line-height:1;">×</button>`;
    chip.style.display = 'flex';
}
function hideAriaChip() {
    const chip = document.getElementById('ariaChip');
    if (chip) chip.style.display = 'none';
}
function ariaAccept(catName) {
    if (!catName) return;
    const match = allCategories.find(c => c.name.toLowerCase() === catName.toLowerCase())
        || allCategories.find(c => c.name.toLowerCase().includes(catName.toLowerCase()));
    if (match) pickCategory(match.id);
    hideAriaChip();
}

// ── KB Sugerida ───────────────────────────────────────────
let _kbTimer = null;
function triggerKbSuggest(q) {
    clearTimeout(_kbTimer);
    if (!q || q.length < 3) {
        document.getElementById('kbSuggestWrap').style.display = 'none';
        return;
    }
    _kbTimer = setTimeout(() => fetchKbSuggest(q), 500);
}
async function fetchKbSuggest(q) {
    try {
        const r = await fetch(`/api/jira/kb/suggest?q=${encodeURIComponent(q)}`, {credentials:'include'});
        const j = await r.json();
        const wrap = document.getElementById('kbSuggestWrap');
        const list = document.getElementById('kbSuggestList');
        if (!j.data?.length) { wrap.style.display = 'none'; return; }
        list.innerHTML = j.data.map(art => `
            <a href="/knowledge-base${art.url_slug ? '/'+art.url_slug : '?id='+art.id}" target="_blank"
               style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;text-decoration:none;color:var(--text-main);">
              <i class="bi bi-book" style="color:#f59e0b;flex-shrink:0;"></i>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${art.titulo}</div>
                ${art.resumen ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${art.resumen}</div>` : ''}
              </div>
              <i class="bi bi-box-arrow-up-right" style="color:var(--text-muted);font-size:11px;flex-shrink:0;"></i>
            </a>`).join('');
        wrap.style.display = 'block';
    } catch(e) { /* silencioso */ }
}

function cfHandleFile(input){
    if(input.files&&input.files[0]){
        const f=input.files[0];
        document.getElementById('cfUploadFileName').textContent=f.name+` (${(f.size/1024).toFixed(1)} KB)`;
        document.getElementById('cfUploadPreview').style.display='flex';
        document.getElementById('cfUploadZone').style.borderColor='var(--success)';
    }
}
function cfClearFile(){
    document.getElementById('cf_attachment').value='';
    document.getElementById('cfUploadPreview').style.display='none';
    document.getElementById('cfUploadZone').style.borderColor='var(--border-soft)';
}
function resetCfForm(){
    cfSelectedCat=null;
    ['cf_reporter','cf_summary','cf_description','cf_component','cf_app','cf_tipologia','cf_impact','cf_urgency','cf_device_code'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    document.getElementById('cfEmployeeInfo').style.display='none';
    hideCmdbAlert();
    document.getElementById('cf_phone').value='-';
    document.getElementById('catSelectedBadge').style.display='none';
    document.getElementById('cfResult').style.display='none';
    const urlEl=document.getElementById('cfCreatedUrl');
    if(urlEl) urlEl.style.display='';
    const manageBtn=document.getElementById('cfBtnManage');
    if(manageBtn) manageBtn.style.display='none';
    cfClearFile();
    document.getElementById('cf_reporter').focus();
}
async function submitTicketSimple(){
    if(typeof LOCAL_VIEW!=='undefined'&&LOCAL_VIEW){ await submitLocalTicket(); return; }
    const reporter   =document.getElementById('cf_reporter').value.trim();
    const summary    =document.getElementById('cf_summary').value.trim();
    const description=document.getElementById('cf_description').value.trim();
    const phone      =document.getElementById('cf_phone').value.trim()||'-';
    const component  =document.getElementById('cf_component').value;
    const app        =document.getElementById('cf_app').value;
    const tipologia  =document.getElementById('cf_tipologia').value;
    const impact     =document.getElementById('cf_impact').value||'618437';
    const urgency    =document.getElementById('cf_urgency').value||'618441';
    const fileInput  =document.getElementById('cf_attachment');
    if(!reporter)  {showToast('Tu correo es obligatorio','error');return;}
    if(!summary)   {showToast('Describe el problema','error');return;}
    if(cfSelectedCat && !tipologia){showToast('La categoría seleccionada no tiene tipología Jira configurada','error');return;}
    const btn=document.getElementById('cfBtnSubmit');
    btn.disabled=true;btn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Registrando...';
    try{
        let attachmentId=null;
        if(fileInput.files.length) attachmentId=await uploadJiraAttachment(fileInput.files[0]);
        const finalDesc=description||`Problemas con ${summary}.`;
        const device_code = document.getElementById('cf_device_code')?.value || '';
        const res=await fetch('/api/jira/ticket',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({summary,reporter,phone,description:finalDesc,component,app,tipologia,impact,urgency,attachmentId,device_code})});
        const json=await res.json();
        if(json.code==='JIRA_NOT_CONFIGURED'){
            // Fallback: crear ticket local TK-%
            const localRes=await fetch('/api/jira/local/ticket',{method:'POST',credentials:'include',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({summary,reporter,phone,description:finalDesc,priority:'P3',category_name:cfSelectedCat?.name||''})});
            const localJson=await localRes.json();
            if(!localJson.success) throw new Error(localJson.message||'Error al crear ticket local');
            const localKey=(localJson.data?.key||localJson.key||'TK-?');
            document.getElementById('cfCreatedKey').textContent=localKey;
            const cfUrlEl=document.getElementById('cfCreatedUrl');
            if(cfUrlEl){cfUrlEl.style.display='none';}
            document.getElementById('cfResult').style.display='block';
            showToast(`Ticket ${localKey} registrado localmente`,'success');
            return;
        }
        if(!json.success) throw new Error(json.message||json.details);
        document.getElementById('cfCreatedKey').textContent=json.data.key;
        document.getElementById('cfCreatedUrl').href=json.data.url;
        document.getElementById('cfResult').style.display='block';
        const _isEmbed = new URLSearchParams(window.location.search).has('embed');
        if(_isEmbed){
            try{ window.parent.postMessage({type:'ticket_created',key:json.data.key,url:json.data.url,kind:'incidencia'},'*'); }catch(e){}
        } else {
            const _modalEl=document.getElementById('modalTicketOk');
            if(_modalEl){
                document.getElementById('modalTicketKey').textContent=json.data.key;
                document.getElementById('modalTicketUrl').href=json.data.url;
                new bootstrap.Modal(_modalEl).show();
            }
        }
        loadTickets();
        const _rEmail = document.getElementById('cf_reporter')?.value?.trim() || localStorage.getItem('portal_user_email') || '';
        if(_rEmail) fetch('/api/portal/activity-log',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email:_rEmail,action:'incidencia_creada',page:'incidencias',metadata:{key:json.data?.key||''}})}).catch(()=>{});
    }catch(err){showToast('Error: '+err.message,'error');}
    finally{btn.disabled=false;btn.innerHTML='<i class="bi bi-send-fill"></i> Registrar Incidencia';}
}

async function submitLocalTicket(){
    const reporter   =document.getElementById('cf_reporter').value.trim();
    const summary    =document.getElementById('cf_summary').value.trim();
    const description=document.getElementById('cf_description').value.trim();
    const phone      =document.getElementById('cf_phone').value.trim()||'-';
    const category_name = cfSelectedCat?.name || document.getElementById('cf_summary').value.trim();
    if(!reporter){showToast('Tu correo es obligatorio','error');return;}
    if(!summary) {showToast('Describe el problema','error');return;}
    const btn=document.getElementById('cfBtnSubmit');
    btn.disabled=true;btn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Registrando...';
    try{
        const res=await fetch('/api/jira/local/ticket',{method:'POST',credentials:'include',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({summary,reporter,phone,description:description||`Problemas con ${summary}.`,category_name,priority:'P3'})});
        const json=await res.json();
        if(!json.success) throw new Error(json.message);
        const key=json.data.key;
        // Resultado inline — ocultar "Ver en Jira", mostrar "Gestionar"
        document.getElementById('cfCreatedKey').textContent=key;
        const urlEl=document.getElementById('cfCreatedUrl');
        if(urlEl) urlEl.style.display='none';
        const manageBtn=document.getElementById('cfBtnManage');
        if(manageBtn) manageBtn.style.display='inline-flex';
        document.getElementById('cfResult').style.display='block';
        // Modal de confirmación — si está en iframe, usar overlay del padre
        const _isEmbedLocal = new URLSearchParams(window.location.search).has('embed');
        if(_isEmbedLocal){
            try{ window.parent.postMessage({type:'ticket_created',key,url:'#',kind:'incidencia'},'*'); }catch(e){}
        } else {
            const _modalEl=document.getElementById('modalTicketOk');
            if(_modalEl){
                document.getElementById('modalTicketKey').textContent=key;
                const jiraUrlBtn=document.getElementById('modalTicketUrl');
                if(jiraUrlBtn) jiraUrlBtn.style.display='none';
                const subtitleEl=document.getElementById('modalOkSubtitle');
                if(subtitleEl) subtitleEl.textContent='Incidencia registrada en el sistema local';
                const cfgLink=_modalEl.querySelector('[onclick*="forceConfigJiraEmail"]');
                if(cfgLink) cfgLink.closest('div')?.style.setProperty('display','none');
                new bootstrap.Modal(_modalEl).show();
            }
        }
        // Inyectar en allTickets para que openManage funcione inmediatamente
        const newTicket={key,summary,internal_status:'abierto',priority:'P3',
            reporter:document.getElementById('cf_reporter').value.trim(),
            phone:document.getElementById('cf_phone').value.trim()||'-',
            sla_deadline:null,assigned_to:null,assigned_to_name:null};
        if(Array.isArray(allTickets)) allTickets.unshift(newTicket);
        // Refrescar panel actual
        if(typeof loadLocalSinAsig==='function') loadLocalSinAsig();
    }catch(err){showToast('Error: '+err.message,'error');}
    finally{btn.disabled=false;btn.innerHTML='<i class="bi bi-send-fill"></i> Registrar Incidencia';}
}

// ── Importación masiva desde archivo ──────────────────────
let _bkOpen = false, _bkCatData = null, _bkRows = [];

function bkToggle() {
    _bkOpen = !_bkOpen;
    const body = document.getElementById('bkBody');
    const btn  = document.getElementById('bkToggleBtn');
    const chev = document.getElementById('bkChevron');
    if (body) body.style.display = _bkOpen ? 'flex' : 'none';
    if (btn)  btn.setAttribute('aria-expanded', _bkOpen);
    if (chev) chev.style.transform = _bkOpen ? 'rotate(180deg)' : '';
    if (_bkOpen && !_bkCatsLoaded) bkLoadCats();
}
let _bkCatsLoaded = false, _bkAllCats = [];
async function bkLoadCats() {
    if (_bkCatsLoaded) return;
    // Reuse allCategories if already populated
    if (typeof allCategories !== 'undefined' && allCategories.length) {
        _bkAllCats = allCategories;
        _bkCatsLoaded = true;
        return;
    }
    try {
        const r = await fetch('/api/jira/categories', { credentials: 'include' });
        const j = await r.json();
        _bkAllCats = j.data || j || [];
        _bkCatsLoaded = true;
    } catch (_) {}
}
function acBkCat(q) {
    const drop = document.getElementById('bkCatDrop');
    if (!q.trim()) { drop.style.display = 'none'; return; }
    if (!_bkCatsLoaded && typeof allCategories !== 'undefined' && allCategories.length) {
        _bkAllCats = allCategories; _bkCatsLoaded = true;
    }
    const items = _bkAllCats.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    if (!items.length) { drop.style.display = 'none'; return; }
    drop.innerHTML = items.map(c =>
        `<div class="ac-item" onmousedown="bkSelectCat(${JSON.stringify(c).replace(/"/g, '&quot;')})">${c.name}</div>`
    ).join('');
    drop.style.display = 'block';
}
function bkSelectCat(c) {
    _bkCatData = {
        id: c.id, name: c.name,
        component: c.component_id || 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277',
        app:       c.app_id       || 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11280',
        tipologia: c.tipologia_id || 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11379',
        impact:    c.impact_id    || '618437',
        urgency:   c.urgency_id   || '618441'
    };
    document.getElementById('bkCatInput').value = c.name;
    document.getElementById('bkCatDrop').style.display = 'none';
    document.getElementById('bkCatBadgeText').textContent = c.name;
    document.getElementById('bkCatBadge').style.display = 'flex';
    _bkCheckReady();
}
function bkClearCat() {
    _bkCatData = null;
    document.getElementById('bkCatInput').value = '';
    document.getElementById('bkCatBadge').style.display = 'none';
    document.getElementById('bkPreview').style.display = 'none';
}

function _bkLoadLibs() {
    const needed = [
        !window.Papa ? 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js' : null,
        !window.XLSX ? 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' : null,
    ].filter(Boolean);
    if (!needed.length) return Promise.resolve();
    return Promise.all(needed.map(src => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar ' + src.split('/').pop()));
        document.head.appendChild(s);
    })));
}
async function bkLoadFile(file) {
    if (!file) return;
    document.getElementById('bkFileName').textContent = file.name;
    const chip = document.getElementById('bkFileChip');
    if (chip) { chip.style.cssText = 'display:flex;margin-top:8px;align-items:center;gap:8px;font-size:12px;color:var(--text-main);'; }
    try {
        await _bkLoadLibs();
        const rows = await _bkParseFile(file);
        _bkRows = rows;
        _bkRenderPreview(rows);
    } catch (e) {
        showToast('Error al leer el archivo: ' + e.message, 'error');
    }
}
function bkResetFile() {
    _bkRows = [];
    document.getElementById('bkFileInput').value = '';
    const chip = document.getElementById('bkFileChip');
    if (chip) chip.style.display = 'none';
    document.getElementById('bkPreview').style.display = 'none';
    document.getElementById('bkResults').style.display = 'none';
}

async function _bkParseFile(file) {
    const name = file.name.toLowerCase();
    const COL_REPORTER  = ['correo electrónico del cliente','correo electronico del cliente','customer email','reporter email','email cliente','correo cliente'];
    const COL_ASSIGNEE  = ['correo electrónico de personal','correo electronico de personal','staff email','email personal','correo personal','assignee email'];
    const COL_SUMMARY   = ['servicio','service','asunto','summary','subject'];

    const normalize = s => (s||'').toLowerCase().replace(/[áéíóúàèìòùâêîôûãõäëïöü]/g, c=>'aeiouaeiouaeiouaeiou'['áéíóúàèìòùâêîôûãõäëïöü'.indexOf(c)]||c).trim();

    let rawRows = [];

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        // rawRows is array of objects keyed by header
        return rawRows.map(r => {
            const findVal = (keys) => {
                for (const k of Object.keys(r)) {
                    if (keys.some(kk => normalize(k).includes(normalize(kk)))) return String(r[k] || '').trim();
                }
                return '';
            };
            return { reporter: findVal(COL_REPORTER), assigneeEmail: findVal(COL_ASSIGNEE), summary: findVal(COL_SUMMARY) };
        }).filter(r => r.reporter && r.summary);
    }

    // TSV or CSV
    const text = await file.text();
    const isTsv = name.endsWith('.tsv') || text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length;
    const delimiter = isTsv ? '\t' : ',';
    const parsed = Papa.parse(text, { delimiter, header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
    return (parsed.data || []).map(r => {
        const findVal = (keys) => {
            for (const k of Object.keys(r)) {
                if (keys.some(kk => normalize(k).includes(normalize(kk)))) return String(r[k] || '').trim();
            }
            return '';
        };
        return { reporter: findVal(COL_REPORTER), assigneeEmail: findVal(COL_ASSIGNEE), summary: findVal(COL_SUMMARY) };
    }).filter(r => r.reporter && r.summary);
}

function _bkRenderPreview(rows) {
    const preview = document.getElementById('bkPreview');
    const tbody   = document.getElementById('bkPreviewBody');
    const countEl = document.getElementById('bkPreviewCount');
    const createCountEl = document.getElementById('bkCreateCount');
    if (!preview || !tbody) return;
    countEl.textContent = rows.length;
    createCountEl.textContent = rows.length;
    tbody.innerHTML = rows.map((r, i) => `
        <tr style="border-top:1px solid var(--border-soft);">
          <td style="padding:7px 10px;color:var(--text-muted);">${i+1}</td>
          <td style="padding:7px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.reporter}">${r.reporter}</td>
          <td style="padding:7px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.assigneeEmail||''}">${r.assigneeEmail||'<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="padding:7px 10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.summary}">${r.summary}</td>
        </tr>`).join('');
    preview.style.display = rows.length ? 'block' : 'none';
    const info = document.getElementById('bkPreviewInfo');
    if (info) info.textContent = _bkCatData ? `Categoría: ${_bkCatData.name}` : '⚠️ Selecciona una categoría primero';
}

function _bkCheckReady() {
    if (_bkRows.length && _bkCatData) _bkRenderPreview(_bkRows);
}

async function bkCreate() {
    if (!_bkCatData) { showToast('Selecciona una categoría primero', 'error'); return; }
    if (!_bkRows.length) { showToast('Carga un archivo primero', 'error'); return; }
    const btn = document.getElementById('bkCreateBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner-border spinner-border-sm"></div> Creando...'; }
    try {
        const r = await fetch('/api/jira/ticket/bulk', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rows: _bkRows,
                component: _bkCatData.component,
                app:       _bkCatData.app,
                tipologia: _bkCatData.tipologia,
                impact:    _bkCatData.impact,
                urgency:   _bkCatData.urgency
            })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        _bkRenderResults(j);
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = `<i class="bi bi-lightning-fill"></i> Crear <span id="bkCreateCount">${_bkRows.length}</span> tickets en Jira`; }
    }
}

function _bkRenderResults(data) {
    const el = document.getElementById('bkResults');
    if (!el) return;
    const ok = data.results.filter(r => r.success);
    const fail = data.results.filter(r => !r.success);
    el.style.display = 'block';
    el.innerHTML = `
        <div style="padding:14px 16px;background:${ok.length?'#ecfdf5':'#fef2f2'};border:1.5px solid ${ok.length?'#6ee7b7':'#fca5a5'};border-radius:10px;margin-bottom:10px;">
          <div style="font-size:13px;font-weight:700;color:${ok.length?'#065f46':'#991b1b'};margin-bottom:4px;">
            ${ok.length ? `✅ ${ok.length} ticket(s) creados exitosamente` : ''}
            ${fail.length ? `  ⚠️ ${fail.length} fallo(s)` : ''}
          </div>
          ${ok.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${ok.map(r=>`<span style="background:#fff;border:1px solid #6ee7b7;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;color:#065f46;font-family:monospace;">${r.key}</span>`).join('')}</div>` : ''}
        </div>
        ${fail.length ? `<div style="font-size:12px;color:var(--text-muted);">${fail.map(r=>`<div style="padding:4px 0;border-bottom:1px solid var(--border-soft);">❌ <strong>${r.reporter}</strong>: ${r.error||'Error desconocido'}</div>`).join('')}</div>` : ''}
        <button class="btn-outline-sm" style="margin-top:10px;" onclick="bkResetFile();document.getElementById('bkResults').style.display='none'">
          <i class="bi bi-arrow-repeat"></i> Importar otro archivo
        </button>`;
    document.getElementById('bkPreview').style.display = 'none';
}

// ── Categorías inline (Tab Categorías) ───────────────────
let _catTreeCache = null;  // built client-side from allCategories; cleared after CRUD

function _buildCatTree(flat) {
    const map = {};
    flat.forEach(c => { map[c.id] = { ...c, children: [] }; });
    const roots = [];
    flat.forEach(c => {
        if (c.parent_id && map[c.parent_id]) map[c.parent_id].children.push(map[c.id]);
        else roots.push(map[c.id]);
    });
    return roots;
}

function previewIcon(){
    const v=document.getElementById('cati_icon').value.trim();
    const el=document.getElementById('iconPreview');
    el.className=`bi ${v||'bi-tag'}`;
}
function renderCatCard(c, indent=0){
    const isChild = indent > 0;
    const hasChildren = c.children && c.children.length;
    return `
        <div style="margin-left:${indent*20}px;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1.5px solid var(--border-soft);border-radius:10px;background:var(--bg-card);transition:border-color .15s;${isChild?'border-style:dashed;opacity:.9;':''}" onmouseover="this.style.borderColor='var(--jira-blue)'" onmouseout="this.style.borderColor='var(--border-soft)'">
            <div style="display:flex;align-items:center;gap:10px;">
                ${isChild?'<span style="color:var(--text-muted);font-size:12px;">↳</span>':''}
                <div style="width:32px;height:32px;background:linear-gradient(135deg,${isChild?'#0891b2,#0e7490':'#7c6ff7,#9333ea'});border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="bi ${c.icon||'bi-tag'}" style="color:white;font-size:14px;"></i>
                </div>
                <div>
                    <div style="font-weight:600;font-size:13px;color:var(--text-main);">${c.name}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${[c.component_label,c.app_label,c.tipologia_label].filter(Boolean).join(' · ')||'Sin mapeo Jira'}${hasChildren?` · <span style="color:#7c6ff7;">${c.children.length} subcategoría(s)</span>`:''}</div>
                </div>
            </div>
            <div style="display:flex;gap:6px;">
                <button class="btn-outline-sm" onclick="editCatInline(${c.id})" title="Editar"><i class="bi bi-pencil"></i></button>
                <button class="btn-outline-sm" style="border-color:#fca5a5;color:#dc2626;" onclick="deleteCatInline(${c.id})" title="Eliminar"><i class="bi bi-trash"></i></button>
            </div>
          </div>
          ${hasChildren ? c.children.map(ch=>renderCatCard(ch,indent+1)).join('') : ''}
        </div>`;
}
async function loadCatListInline(){
    const w=document.getElementById('catListInline');
    if(!w) return;
    try{
        // Reuse allCategories already loaded at startup; fetch only if empty
        if(!allCategories.length){
            const r=await fetch('/api/jira/categories',{credentials:'include'});
            const j=await r.json();
            allCategories=j.data||[];
        }
        // Build tree client-side (no extra HTTP request; cache for re-visits)
        if(!_catTreeCache) _catTreeCache=_buildCatTree(allCategories);
        const roots=_catTreeCache;
        // Actualizar select padre
        const parentSel=document.getElementById('cati_parent');
        if(parentSel){
            const curVal=parentSel.value;
            parentSel.innerHTML='<option value="">— Categoría raíz —</option>'+(allCategories.filter(c=>!c.parent_id).map(c=>`<option value="${c.id}">${c.name}</option>`).join(''));
            if(curVal) parentSel.value=curVal;
        }
        if(!roots.length){
            w.innerHTML='<div style="color:var(--text-muted);font-size:13px;padding:12px 0;">Sin categorías. Crea la primera usando el formulario.</div>';
            return;
        }
        w.innerHTML=roots.map(c=>renderCatCard(c,0)).join('');
    }catch(e){w.innerHTML='<div style="color:var(--danger);font-size:12px;">Error cargando categorías</div>';}
}
function editCatInline(id){
    const c=allCategories.find(x=>x.id===id);
    if(!c) return;
    document.getElementById('catEditIdInline').value=c.id;
    document.getElementById('cati_name').value=c.name||'';
    document.getElementById('cati_icon').value=c.icon||'';
    document.getElementById('cati_desc').value=c.description_template||'';
    document.getElementById('cati_parent').value=c.parent_id||'';
    previewIcon();
    const setS=(sid,val)=>{if(!val)return;const el=document.getElementById(sid);for(const o of el.options){if(o.value.startsWith(val)){o.selected=true;break;}}};
    setS('cati_component',c.component_id);setS('cati_app',c.app_id);
    setS('cati_tipologia',c.tipologia_id);setS('cati_urgency',c.urgency_id);
    document.getElementById('catFormTitleInline').innerHTML=`<i class="bi bi-pencil" style="color:#7c6ff7"></i> Editando: ${c.name}`;
    document.getElementById('catSaveLabelInline').textContent='Actualizar';
    document.querySelector('.card-panel[style*="sticky"]')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function deleteCatInline(id){
    if(!confirm('¿Eliminar esta categoría? Las subcategorías también se desactivarán.')) return;
    await fetch(`/api/jira/categories/${id}`,{method:'DELETE',credentials:'include'});
    showToast('Categoría eliminada','success');
    allCategories=[]; _catTreeCache=null;
    loadCatListInline();
}
function resetCatFormInline(){
    document.getElementById('catEditIdInline').value='';
    ['cati_name','cati_icon','cati_desc'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('cati_parent').value='';
    document.getElementById('cati_component').value='';
    document.getElementById('cati_app').value='';
    document.getElementById('cati_tipologia').value='ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11379|Sin acceso al sistema';
    document.getElementById('cati_urgency').value='618441|El error no me impide trabajar';
    document.getElementById('catFormTitleInline').innerHTML='<i class="bi bi-plus-circle" style="color:#7c6ff7"></i> Nueva Categoría';
    document.getElementById('catSaveLabelInline').textContent='Guardar';
    previewIcon();
}
async function saveCatInline(){
    const name=document.getElementById('cati_name').value.trim();
    if(!name){showToast('El nombre es requerido','error');return;}
    const icon=document.getElementById('cati_icon').value.trim();
    const desc=document.getElementById('cati_desc').value.trim();
    const editId=document.getElementById('catEditIdInline').value;
    const parentId=document.getElementById('cati_parent').value||null;
    const parseF=id=>{const v=document.getElementById(id).value;if(!v)return{id:null,label:null};const[fid,...r]=v.split('|');return{id:fid,label:r.join('|')};};
    const comp=parseF('cati_component'),app=parseF('cati_app'),tipo=parseF('cati_tipologia'),urg=parseF('cati_urgency');
    const body={name,icon:icon||'bi-tag',parent_id:parentId,component_id:comp.id,component_label:comp.label,app_id:app.id,app_label:app.label,
        tipologia_id:tipo.id,tipologia_label:tipo.label,urgency_id:urg.id,urgency_label:urg.label,description_template:desc};
    const r=await fetch(editId?`/api/jira/categories/${editId}`:'/api/jira/categories',
        {method:editId?'PUT':'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!j.success){showToast('Error: '+j.message,'error');return;}
    showToast(editId?'Categoría actualizada':'Categoría creada','success');
    resetCatFormInline();
    allCategories=[]; _catTreeCache=null;
    await loadCatListInline();
}

// ── Autocomplete correo ───────────────────────────────────
function acReporter(q){
    clearTimeout(acTimer);
    if(q.length<2){hideAc('acReporterDrop');return;}
    acTimer=setTimeout(async()=>{
        try{
            const r=await fetch(`/api/employees/search-emails?q=${encodeURIComponent(q)}`,{credentials:'include'}).then(x=>x.json());
            const drop=document.getElementById('acReporterDrop');
            if(r.success&&r.data.length){
                acIdx=-1;
                drop.innerHTML=r.data.map(e=>
                    `<div class="ac-item" onclick="pickReporter('${e.email}')">
                        <span class="ac-email">${e.email}</span>
                        <div class="ac-details"><i class="bi bi-person me-1"></i>${e.full_name||''}${e.position_name?' · '+e.position_name:''}</div>
                    </div>`
                ).join('');
            }else{
                drop.innerHTML=`<div class="ac-empty"><i class="bi bi-inbox me-1"></i>Sin resultados</div>`;
            }
            drop.classList.add('show');
        }catch{hideAc('acReporterDrop');}
    },280);
}
function pickReporter(email){document.getElementById('f_reporter').value=email;hideAc('acReporterDrop');}
function acIncSearch(q){
    clearTimeout(acTimer);
    const drop=document.getElementById('acIncSearchDrop');
    if(!drop)return;
    if(!q||q.length<2||q.includes('@')){hideAc('acIncSearchDrop');return;}
    acTimer=setTimeout(async()=>{
        try{
            const r=await fetch(`/api/employees/search-emails?q=${encodeURIComponent(q)}`,{credentials:'include'}).then(x=>x.json());
            if(r.success&&r.data.length){
                acIdx=-1;
                drop.innerHTML=r.data.map(e=>
                    `<div class="ac-item" onclick="pickIncSearch('${e.email}')">
                        <span class="ac-email">${e.email}</span>
                        ${e.full_name?`<span class="ac-name">${e.full_name}</span>`:''}
                    </div>`
                ).join('');
            }else{
                drop.innerHTML=`<div class="ac-empty"><i class="bi bi-inbox me-1"></i>Sin resultados</div>`;
            }
            drop.classList.add('show');
        }catch{hideAc('acIncSearchDrop');}
    },280);
}
function pickIncSearch(email){
    const inp=document.getElementById('incSearchInput');
    if(inp){inp.value=email;}
    hideAc('acIncSearchDrop');
    buscarTicket();
}
function hideAc(id){const d=document.getElementById(id);if(d){d.classList.remove('show');d.innerHTML='';acIdx=-1;}}
function acKeydown(e,dropId){
    const drop=document.getElementById(dropId);
    const items=drop.querySelectorAll('.ac-item');
    if(!items.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();acIdx=Math.min(acIdx+1,items.length-1);items.forEach((it,i)=>it.classList.toggle('active-ac',i===acIdx));items[acIdx]?.scrollIntoView({block:'nearest'});}
    else if(e.key==='ArrowUp'){e.preventDefault();acIdx=Math.max(acIdx-1,0);items.forEach((it,i)=>it.classList.toggle('active-ac',i===acIdx));items[acIdx]?.scrollIntoView({block:'nearest'});}
    else if(e.key==='Enter'&&acIdx>=0&&items[acIdx]){e.preventDefault();items[acIdx].click();}
    else if(e.key==='Escape'){hideAc(dropId);}
}

// ── Sync desde Jira ───────────────────────────────────────
async function syncJira(){
    const btn=document.getElementById('btnSync');
    btn.disabled=true;btn.innerHTML='<span class="spinner-border spinner-border-sm"></span> Sincronizando...';
    try{
        const r=await fetch('/api/jira/sync',{credentials:'include'});
        const j=await r.json();
        if(!j.success)throw new Error(j.message);
        showToast(`✅ ${j.message}${j.ownership==='PARTICIPATED_REQUESTS'?' (modo participante — token sin acceso total)':''}`, 'success');
        await loadTickets();
    }catch(err){
        showToast('Error sync: '+err.message,'error');
    }finally{
        btn.disabled=false;btn.innerHTML='<i class="bi bi-cloud-download"></i> Sincronizar Jira';
    }
}

// ── Crear incidencia local TK-NNN ─────────────────────────
function openCreateTkModal(){
    const el=el=>document.getElementById(el);
    const s=el('tkSummary'),d=el('tkDescription'),p=el('tkPriority');
    if(s) s.value='';
    if(d) d.value='';
    if(p) p.value='P3';
    const m=document.getElementById('createTkModal');
    if(m) new bootstrap.Modal(m).show();
}
async function submitCreateTk(){
    const summary=(document.getElementById('tkSummary')?.value||'').trim();
    const priority=document.getElementById('tkPriority')?.value||'P3';
    const description=(document.getElementById('tkDescription')?.value||'').trim();
    if(!summary){showToast('El resumen es obligatorio','error');return;}
    const btn=document.getElementById('tkSubmitBtn');
    if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner-border spinner-border-sm"></div>';}
    try{
        const r=await fetch('/api/jira/ticket/create-local',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary,priority,description})});
        const j=await r.json();
        if(!j.success)throw new Error(j.message||'Error al crear ticket');
        bootstrap.Modal.getInstance(document.getElementById('createTkModal'))?.hide();
        showToast(`✅ ${j.message}`,'success');
        await loadTickets();
    }catch(err){
        showToast('Error: '+err.message,'error');
    }finally{
        if(btn){btn.disabled=false;btn.innerHTML='<i class="bi bi-plus-circle-fill"></i> Crear Incidencia';}
    }
}

// ── Tickets tabla ─────────────────────────────────────────
async function loadTickets(){
    const tw=document.getElementById('tableWrap');
    if(tw) tw.innerHTML=`<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando tickets...</div>`;
    try{
        const url = LOCAL_VIEW ? '/api/jira/tickets?source=local&all=1' : '/api/jira/tickets';
        const r=await fetch(url,{credentials:'include'});
        const j=await r.json();
        if(!j.success)throw new Error(j.message);
        allTickets=j.data||[];
        // Si BD Jira vacía, sincronizar automáticamente (solo en modo Jira, no en local)
        if(!LOCAL_VIEW && !allTickets.length && !loadTickets._synced) { loadTickets._synced=true; syncAndReload(); return; }
        loadTickets._synced=false;
        updateKPIs();applyFilters();
    }catch(err){
        const tw=document.getElementById('tableWrap');
        if(tw) tw.innerHTML=`<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>No se pudieron cargar los tickets.<br><small>${err.message}</small></p><button class="btn-outline-sm mt-3" onclick="loadTickets()"><i class="bi bi-arrow-clockwise"></i> Reintentar</button></div>`;
    }
}
function updateKPIs(){
    const now=new Date(),m=now.getMonth(),y=now.getFullYear();
    const setEl=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    setEl('kpiTotal',allTickets.length);
    setEl('kpiOpen',allTickets.filter(t=>isOpen(t.status)).length);
    setEl('kpiProgress',allTickets.filter(t=>isProgress(t.status)).length);
    setEl('kpiClosed',allTickets.filter(t=>isClosed(t.status)).length);
    setEl('kpiCritical',allTickets.filter(t=>t.urgency_level===3).length);
    setEl('kpiMonth',allTickets.filter(t=>{const d=new Date(t.created);return d.getMonth()===m&&d.getFullYear()===y;}).length);
    const bdg=document.getElementById('badge-todos');
    if(bdg){const open=allTickets.filter(t=>!isClosed(t.status)).length;bdg.textContent=open||'';bdg.style.display=open?'':'none';}
}
function isOpen(s){return['open','abierto','waiting for support','por hacer','to do'].includes((s||'').toLowerCase());}
function isProgress(s){return['in progress','en curso','en progreso','working'].includes((s||'').toLowerCase());}
function isClosed(s){return['done','closed','cerrado','resolved','resuelto','completado'].includes((s||'').toLowerCase());}
// Usuario actual inyectado desde servidor
const IS_ADMIN       = CURRENT_USER_ROLE === 'administrador';
const IS_ESPECIALISTA= ['especialista','agente','tecnico'].includes(CURRENT_USER_ROLE);
const IS_AGENT       = IS_ADMIN || IS_ESPECIALISTA;

// ── Greetings personalizados (aquí CURRENT_USER_NAME ya está definido) ────────
(function(){
  var firstName = (CURRENT_USER_NAME||'').split(' ')[0] || 'Administrador';
  var g1 = document.getElementById('wspGreetingTitle');
  var g2 = document.getElementById('kbGreetingTitle');
  if(g1) g1.textContent = 'Hola, ' + firstName + ' — ¡bienvenido al panel de WhatsApp Bot!';
  if(g2) g2.textContent = 'Hola, ' + firstName + ' — espero poder ayudarte a construir mejores procedimientos.';
})();

function setPill(el,val){document.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));el.classList.add('active');activePill=val;currentPage=1;applyFilters();}
function filterTickets(){currentPage=1;applyFilters();}
function applyFilters(){
    const si=document.getElementById('searchInput');
    const q=(si?si.value:'').toLowerCase().trim();
    filteredData=allTickets.filter(t=>{
        if(activePill==='open'     && !isOpen(t.status))return false;
        if(activePill==='progress' && t.internal_status!=='en_progreso')return false;
        if(activePill==='closed'   && !isClosed(t.status))return false;
        if(activePill==='p1'       && t.priority!=='P1')return false;
        if(activePill==='unassigned'&& t.assigned_to)return false;
        if(activePill==='mine'     && t.assigned_to!=CURRENT_USER_ID)return false;
        if(q){const h=[t.key,t.summary,t.reporter,t.status,t.tipologia,t.assigned_to_name].join(' ').toLowerCase();if(!h.includes(q))return false;}
        return true;
    });
    // Orden default: sin asignar → mis tickets → resto
    filteredData.sort((a,b)=>{
        const aUnassigned=!a.assigned_to, bUnassigned=!b.assigned_to;
        const aMine=a.assigned_to==CURRENT_USER_ID, bMine=b.assigned_to==CURRENT_USER_ID;
        if(aUnassigned!==bUnassigned) return aUnassigned?-1:1;
        if(aMine!==bMine) return aMine?-1:1;
        return new Date(b.created)-new Date(a.created);
    });
    renderTable();renderPagination();
}

const _TECH_PALETTE = [
    '#7c3aed','#2563eb','#0891b2','#059669','#d97706',
    '#dc2626','#db2777','#9333ea','#0284c7','#16a34a',
    '#b45309','#0f766e','#be185d','#1d4ed8'
];
function _techColor(name) {
    if (!name || name === 'Sin asignar' || name === '—') return '#64748b';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return _TECH_PALETTE[h % _TECH_PALETTE.length];
}
function techAvatar(name, size){
    if(!name) return '';
    const parts = name.trim().split(/\s+/);
    const initials = parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.slice(0,2).toUpperCase();
    const px = size || 28;
    const fs = Math.round(px * 0.36);
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;border-radius:50%;background:${_techColor(name)};color:#fff;font-size:${fs}px;font-weight:700;flex-shrink:0;letter-spacing:.5px;" title="${name}">${initials}</span>`;
}
function ticketAge(created){
    if(!created) return '—';
    const ms=new Date()-new Date(created);
    const h=Math.floor(ms/3600000);
    if(h<1) return Math.floor(ms/60000)+'min';
    if(h<24) return h+'h';
    return Math.floor(h/24)+'d '+Math.floor(h%24)+'h';
}
function prioBadge(p){
    const labels={P1:'🔴 P1',P2:'🟠 P2',P3:'🔵 P3',P4:'⚪ P4'};
    return `<span class="prio-badge prio-${p}">${labels[p]||p}</span>`;
}
function istBadge(s){
    const labels={abierto:'Abierto',asignado:'Asignado',en_progreso:'En progreso',
                  pendiente_usuario:'Pendiente',resuelto:'Resuelto',cerrado:'Cerrado'};
    const icons ={abierto:'bi-circle',asignado:'bi-person-check',en_progreso:'bi-gear-wide-connected',
                  pendiente_usuario:'bi-hourglass-split',resuelto:'bi-check-circle',cerrado:'bi-lock'};
    return `<span class="ist-badge ist-${s}"><i class="bi ${icons[s]||'bi-circle'}"></i>${labels[s]||s}</span>`;
}
function prioRowStyle(p){
    const map={P1:'border-left:3px solid #ef4444;background:rgba(239,68,68,.04);',
               P2:'border-left:3px solid #f59e0b;background:rgba(245,158,11,.03);',
               P3:'',P4:''};
    return map[p]||'';
}
function slaLabel(deadline){
    if(!deadline) return '';
    const diff=new Date(deadline)-new Date();
    if(diff<0) return `<span class="sla-danger"><i class="bi bi-exclamation-triangle-fill"></i> SLA vencido</span>`;
    const totalMin=Math.floor(diff/60000);
    const h=Math.floor(totalMin/60);
    const m=totalMin%60;
    const ts=h>0?`${h}h ${m}min`:`${totalMin}min`;
    if(totalMin<15) return `<span class="sla-danger"><i class="bi bi-clock-fill"></i> ${ts} restantes</span>`;
    if(totalMin<45) return `<span class="sla-warn"><i class="bi bi-clock"></i> ${ts} restantes</span>`;
    return `<span class="sla-ok"><i class="bi bi-clock"></i> ${ts}</span>`;
}

function renderTable(){
    const tw=document.getElementById('tableWrap');
    const pw=document.getElementById('paginationWrap');
    if(!tw) return;
    if(!filteredData.length){
        tw.innerHTML=`<div class="empty-state"><i class="bi bi-inbox"></i><p>No se encontraron tickets.</p></div>`;
        if(pw) pw.style.display='none';return;
    }
    if(pw) pw.style.display='flex';
    const start=(currentPage-1)*PAGE_SIZE;
    const rows=filteredData.slice(start,start+PAGE_SIZE).map(t=>{
        const ist  = t.internal_status||'abierto';
        const crDate = t.created?new Date(t.created).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
        const age  = ticketAge(t.created);
        const tech = t.assigned_to_name
            ? `<span style="display:inline-flex;align-items:center;gap:6px;" title="${t.assigned_to_name}">${techAvatar(t.assigned_to_name)}</span>`
            : `<span style="font-size:11px;color:#ef4444;"><i class="bi bi-person-dash"></i> Sin asignar</span>`;
        const isClosedTicket = isClosed(t.status);
        let actions='';
        if(!isClosedTicket && IS_AGENT){
            if(!t.assigned_to)
                actions+=`<button class="btn-take" onclick="takeTicket('${t.key}')"><i class="bi bi-hand-index"></i> Tomar</button> `;
            actions+=`<button class="btn-manage" onclick="openManage('${t.key}')"><i class="bi bi-sliders"></i> Gestionar</button>`;
        }
        // Reporteros solo pueden ver comentarios
        if(!IS_AGENT)
            actions+=`<button class="btn-outline-sm" onclick="openComments('${t.key}')"><i class="bi bi-chat-dots"></i> Comentar</button> `;
        actions+=` <button class="btn-outline-sm" title="Ver historial" onclick="openHistory('${t.key}')"><i class="bi bi-clock-history"></i></button>`;

        return`<tr style="${prioRowStyle(t.priority||'P3')}">
            <td>
              <span class="ticket-key"><a href="${t.url||'#'}" target="_blank">${t.key}</a></span>
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${crDate}</div>
              <div style="font-size:10px;color:var(--text-muted);"><i class="bi bi-hourglass"></i> ${age}</div>
            </td>
            <td style="max-width:200px;">
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(t.summary||'').replace(/"/g,'&quot;')}">${t.summary}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px;"><i class="bi bi-envelope"></i> ${t.reporter||'—'}</div>
            </td>
            <td>${prioBadge(t.priority||'P3')}</td>
            <td>${istBadge(ist)}</td>
            <td>${tech}</td>
            <td>${slaLabel(t.sla_deadline)}</td>
            <td style="white-space:nowrap;">${actions}</td>
        </tr>`;
    }).join('');
    if(tw) tw.innerHTML=`<div style="overflow-x:auto;"><table class="table-tickets w-100">
        <thead><tr><th>Clave / Hora</th><th>Resumen / Reporter</th><th>Prioridad</th><th>Estado</th><th>Técnico</th><th>SLA</th><th>Acciones</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}
function renderPagination(){
    const pi=document.getElementById('paginationInfo');
    const btns=document.getElementById('paginationBtns');
    if(!pi||!btns) return;
    const total=filteredData.length,pages=Math.ceil(total/PAGE_SIZE);
    const s=(currentPage-1)*PAGE_SIZE+1,e=Math.min(currentPage*PAGE_SIZE,total);
    pi.textContent=total?`Mostrando ${s}–${e} de ${total} tickets`:'';
    if(pages<=1){btns.innerHTML='';return;}
    let html=`<button class="btn-outline-sm" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}><i class="bi bi-chevron-left"></i></button>`;
    for(let i=1;i<=pages;i++){
        if(i===1||i===pages||(i>=currentPage-1&&i<=currentPage+1))html+=`<button class="btn-outline-sm" style="${i===currentPage?'background:var(--jira-blue);color:white;border-color:var(--jira-blue);':''}" onclick="goPage(${i})">${i}</button>`;
        else if(i===currentPage-2||i===currentPage+2)html+=`<span style="padding:4px 6px;font-size:12px;color:var(--text-muted);">…</span>`;
    }
    html+=`<button class="btn-outline-sm" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}><i class="bi bi-chevron-right"></i></button>`;
    if(btns) btns.innerHTML=html;
}
function goPage(p){const pages=Math.ceil(filteredData.length/PAGE_SIZE);if(p<1||p>pages)return;currentPage=p;renderTable();renderPagination();}

// ── Gestión de tickets ────────────────────────────────────
let allTechnicians=[];
let mgCurrentKey='';
let mgCurrentTicket=null;
let _slaTimerInterval=null;

function startSlaTimer(deadline){
    clearInterval(_slaTimerInterval);
    const el=document.getElementById('mgSlaTimer');
    if(!el) return;
    if(!deadline){ el.style.display='none'; return; }
    function _tick(){
        const diff=new Date(deadline)-new Date();
        if(diff<=0){
            el.textContent='⏰ SLA VENCIDO';
            el.style.display='block';
            el.style.background='#fee2e2'; el.style.color='#dc2626';
            clearInterval(_slaTimerInterval);
            return;
        }
        const totalMin=Math.floor(diff/60000);
        const h=Math.floor(totalMin/60);
        const m=totalMin%60;
        const s=Math.floor((diff%60000)/1000);
        const ts=h>0?`${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`:`${m}m ${String(s).padStart(2,'0')}s`;
        el.textContent=`⏱ ${ts} para vencer SLA`;
        el.style.display='block';
        if(totalMin>=45){ el.style.background='#dcfce7'; el.style.color='#16a34a'; }
        else if(totalMin>=15){ el.style.background='#fef9c3'; el.style.color='#ca8a04'; }
        else{ el.style.background='#fee2e2'; el.style.color='#dc2626'; }
    }
    _tick();
    _slaTimerInterval=setInterval(_tick,1000);
}
document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('modalManage')?.addEventListener('hidden.bs.modal',()=>{
        clearInterval(_slaTimerInterval);
        const el=document.getElementById('mgSlaTimer');
        if(el) el.style.display='none';
    });
});

async function loadTechRoster(){
    try{
        const r=await fetch('/api/jira/techs-roster',{credentials:'include'});
        const j=await r.json();
        _techRoster=j.data||[];
    }catch(e){console.warn('No se pudo cargar roster de técnicos',e);}
}

function filterTechQuick(key,q){
    const drop=document.getElementById('tq-'+key);
    if(!drop) return;
    const ql=(q||'').toLowerCase();
    const results=_techRoster.filter(t=>
        !ql||(t.name||'').toLowerCase().includes(ql)||(t.email||'').toLowerCase().includes(ql)
    ).slice(0,8);
    if(!results.length){drop.classList.remove('show');return;}
    drop.innerHTML=results.map(t=>`
        <div class="tech-quick-item"
             data-email="${incEsc(t.email)}"
             data-account-id="${incEsc(t.accountId||'')}"
             onmousedown="event.preventDefault();pickTechQuick('${key}',this.dataset.email,this.dataset.accountId)">
          <div class="tqi-avatar">${(t.name||t.email||'?')[0].toUpperCase()}</div>
          <div><div class="tqi-name">${incEsc(t.name||t.email)}</div><div class="tqi-email">${incEsc(t.email)}</div></div>
        </div>`).join('');
    drop.classList.add('show');
}

function pickTechQuick(key, email, accountId) {
    const inp = document.getElementById('asig-input-'+key);
    if (inp) {
        inp.value = email;
        inp.dataset.accountId = accountId || '';
    }
    document.getElementById('tq-'+key)?.classList.remove('show');
}

function hideTechQuick(key){
    document.getElementById('tq-'+key)?.classList.remove('show');
}

async function loadTechnicians(){
    try{
        const r=await fetch('/api/jira/technicians',{credentials:'include'});
        const j=await r.json();
        allTechnicians=j.data||[];
        const sel=document.getElementById('mgTechSelect');
        if(sel){
            sel.innerHTML='<option value="">Seleccionar técnico...</option>'+
                allTechnicians.map(t=>`<option value="${t.id}">${t.full_name||t.username}</option>`).join('');
        }
    }catch(e){console.warn('No se pudieron cargar técnicos',e);}
}

async function takeTicket(key){
    if(!confirm(`¿Tomar el ticket ${key}?`)) return;
    try{
        const r=await fetch(`/api/jira/ticket/${key}/take`,{method:'PUT',credentials:'include'});
        const j=await r.json();
        if(!j.success) throw new Error(j.message);
        showToast(`✅ ${j.message}`,'success');
        await loadTickets();
    }catch(e){showToast('Error: '+e.message,'error');}
}

function openManage(key){
    mgCurrentKey=key;
    mgCurrentTicket=allTickets.find(t=>t.key===key)||null;
    if(!mgCurrentTicket) return;
    const t=mgCurrentTicket;
    document.getElementById('mgTicketKey').textContent=key;
    document.getElementById('mgSummary').textContent=t.summary;
    document.getElementById('mgPrioBadge').className='prio-badge prio-'+(t.priority||'P3');
    document.getElementById('mgPrioBadge').textContent={P1:'🔴 P1 Crítico',P2:'🟠 P2 Alto',P3:'🔵 P3 Medio',P4:'⚪ P4 Bajo'}[t.priority||'P3'];
    const ist=t.internal_status||'abierto';
    const istEl=document.getElementById('mgIstBadge');
    istEl.className='ist-badge ist-'+ist;
    istEl.innerHTML={abierto:'<i class="bi bi-circle"></i> Abierto',asignado:'<i class="bi bi-person-check"></i> Asignado',
        en_progreso:'<i class="bi bi-gear-wide-connected"></i> En progreso',pendiente_usuario:'<i class="bi bi-hourglass-split"></i> Pendiente',
        resuelto:'<i class="bi bi-check-circle"></i> Resuelto',cerrado:'<i class="bi bi-lock"></i> Cerrado'}[ist]||ist;
    document.getElementById('mgSla').innerHTML=slaLabel(t.sla_deadline);
    startSlaTimer(t.sla_deadline);
    document.getElementById('mgAssigned').innerHTML=t.assigned_to_name
        ? `<span style="display:inline-flex;align-items:center;gap:8px;">${techAvatar(t.assigned_to_name)}<span style="font-size:13px;">Asignado a: <strong>${t.assigned_to_name}</strong></span></span>`
        : '<span style="color:#ef4444;font-size:13px;">⚠️ Sin técnico asignado</span>';
    document.getElementById('mgNoteWrap').style.display='none';
    const isCerrado = ['cerrado','resuelto'].includes(ist);
    const isLocal   = (t.key||t.ticket_key||'').startsWith('TK-');
    // Solo agentes pueden cerrar/reabrir/asignar
    const mgBtnClose=document.getElementById('mgBtnClose');
    if(mgBtnClose){
        mgBtnClose.style.display=(IS_AGENT&&!isCerrado)?'inline-flex':'none';
        mgBtnClose.innerHTML=isLocal
            ? '<i class="bi bi-x-circle"></i> Cerrar ticket'
            : '<i class="bi bi-x-circle"></i> Cerrar en Jira';
        mgBtnClose.title=isLocal?'Cerrar en el sistema local':'Cerrar en Jira y en local';
    }
    document.getElementById('mgBtnReopen').style.display = (IS_AGENT && isCerrado) ? 'inline-flex' : 'none';
    const mgBtnCat=document.getElementById('mgBtnCategorize');
    if(mgBtnCat) mgBtnCat.style.display=(isCerrado&&!isLocal)?'inline-flex':'none';
    // Ocultar sección de asignación a reporteros
    const mgTechRow = document.getElementById('mgTechRow');
    if (mgTechRow) mgTechRow.style.display = IS_AGENT ? '' : 'none';
    // Limpiar campo email de reasignacion
    const emailEl=document.getElementById('mgTechEmail');
    if(emailEl) emailEl.value='';
    new bootstrap.Modal(document.getElementById('modalManage')).show();
}

function techAcSearch(q){
    const drop=document.getElementById('techAcDrop');
    if(!drop) return;
    const term=(q||'').toLowerCase().trim();
    const matches=allTechnicians.filter(t=>
        (t.full_name||'').toLowerCase().includes(term)||
        (t.email||'').toLowerCase().includes(term)||
        (t.username||'').toLowerCase().includes(term)
    ).slice(0,8);
    if(!term||!matches.length){drop.style.display='none';return;}
    drop.style.display='block';
    drop.innerHTML=matches.map(t=>`
        <div onclick="techAcSelect('${t.email}',this)"
             style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:8px;"
             onmouseover="this.style.background='var(--hover-row)'" onmouseout="this.style.background=''">
          <div style="width:28px;height:28px;background:#e0e7ff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#3730a3;flex-shrink:0;">${(t.full_name||t.username||'?')[0].toUpperCase()}</div>
          <div style="min-width:0;">
            <div style="font-size:12px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.full_name||t.username}</div>
            <div style="font-size:10px;color:var(--text-muted);">${t.email||''}</div>
          </div>
        </div>`).join('');
}
function techAcSelect(email){
    const input=document.getElementById('mgTechEmail');
    if(input) input.value=email;
    const drop=document.getElementById('techAcDrop');
    if(drop) drop.style.display='none';
}
document.addEventListener('click',e=>{
    if(!e.target.closest('#mgTechEmail')&&!e.target.closest('#techAcDrop')){
        const d=document.getElementById('techAcDrop');
        if(d) d.style.display='none';
    }
});

async function assignToTech(){
    const email=(document.getElementById('mgTechEmail')?.value||'').trim();
    if(!email||!email.includes('@')){showToast('Ingresa un correo valido','error');return;}
    try{
        const r=await fetch(`/api/jira/ticket/${mgCurrentKey}/assign-tech`,{
            method:'PUT',credentials:'include',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email})
        });
        const j=await r.json();
        if(!j.success) throw new Error(j.message);
        showToast(`Ticket reasignado a ${email}`,'success');
        bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
        await loadTickets();
    }catch(e){showToast('Error: '+e.message,'error');}
}

async function changeStatus(btn){
    const newStatus=btn.dataset.ist;
    if(newStatus==='resuelto'){
        document.getElementById('mgNoteWrap').style.display='block';
        document.getElementById('mgNote').focus();
        // Espera confirmación manual desde el botón Resuelto (doble clic)
        btn.textContent='✓ Confirmar resolución';
        btn.onclick=()=>confirmStatusChange(newStatus);
        return;
    }
    await confirmStatusChange(newStatus);
}
async function confirmStatusChange(newStatus){
    const note=document.getElementById('mgNote').value.trim();
    if(newStatus==='resuelto'&&!note){showToast('Escribe la nota de resolución','error');return;}
    try{
        const r=await fetch(`/api/jira/ticket/${mgCurrentKey}/internal-status`,{
            method:'PUT',credentials:'include',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({status:newStatus,note})
        });
        const j=await r.json();
        if(!j.success) throw new Error(j.message);
        showToast(`✅ Estado actualizado: ${newStatus}`,'success');
        bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
        await loadTickets();
    }catch(e){showToast('Error: '+e.message,'error');}
}

async function reopenTicket(key) {
    const motivo = prompt('Motivo de reapertura (opcional):') ?? 'Reabierto manualmente';
    if (motivo === null) return; // cancelado
    try {
        const r = await fetch(`/api/jira/ticket/${key}/reopen`, {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ motivo })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast(j.message, 'success');
        bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
        loadTickets();
    } catch(e) { showToast('Error: '+e.message, 'error'); }
}

// ── Adjuntos ──────────────────────────────────────────────
let attCurrentKey = '';
async function openAttachments(key) {
    attCurrentKey = key;
    document.getElementById('attTicketKey').textContent = key;
    document.getElementById('attFileInput').value = '';
    document.getElementById('attUploadProgress').style.display = 'none';
    const listEl = document.getElementById('attList');
    listEl.innerHTML = '<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
    new bootstrap.Modal(document.getElementById('modalAttachments')).show();
    await loadAttachments(key, listEl);
}
async function loadAttachments(key, listEl) {
    listEl = listEl || document.getElementById('attList');
    try {
        const r = await fetch(`/api/jira/ticket/${key}/attachments`, {credentials:'include'});
        const j = await r.json();
        if (!j.data?.length) {
            listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px;">Sin adjuntos.</div>';
            return;
        }
        listEl.innerHTML = j.data.map(a => {
            const kb = (a.size/1024).toFixed(1);
            const icon = a.mimetype?.startsWith('image/') ? 'bi-image' :
                         a.mimetype?.includes('pdf') ? 'bi-file-pdf' :
                         a.mimetype?.includes('word') || a.mimetype?.includes('document') ? 'bi-file-word' :
                         a.mimetype?.includes('sheet') || a.mimetype?.includes('excel') ? 'bi-file-excel' :
                         'bi-file-earmark';
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-soft,#e2e8f0);">
                <i class="bi ${icon}" style="font-size:20px;color:#0891b2;flex-shrink:0;"></i>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${a.originalname}">${a.originalname}</div>
                    <div style="font-size:11px;color:var(--text-muted);">${kb} KB · ${a.uploader_name||'—'} · ${new Date(a.created_at).toLocaleDateString('es-PE')}</div>
                </div>
                <a href="/api/jira/ticket/${key}/attachments/${a.id}/download" target="_blank" class="btn-outline-sm" style="padding:4px 10px;font-size:11px;text-decoration:none;" title="Ver / Descargar"><i class="bi bi-eye"></i></a>
                <button onclick="deleteAttachment('${key}',${a.id})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;padding:4px;" title="Eliminar"><i class="bi bi-trash"></i></button>
            </div>`;
        }).join('');
    } catch(e) { listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;">${e.message}</div>`; }
}
async function uploadAttachment() {
    const file = document.getElementById('attFileInput').files[0];
    if (!file) { showToast('Selecciona un archivo','error'); return; }
    const prog = document.getElementById('attUploadProgress');
    const bar  = document.getElementById('attProgressBar');
    prog.style.display = 'block';
    bar.style.width = '30%';
    try {
        const fd = new FormData();
        fd.append('file', file);
        const r = await fetch(`/api/jira/ticket/${attCurrentKey}/attachments`, {
            method:'POST', credentials:'include', body: fd
        });
        bar.style.width = '100%';
        let j;
        try { j = await r.json(); } catch(_) { throw new Error(`HTTP ${r.status} — respuesta no válida`); }
        if (!r.ok || !j.success) throw new Error(j?.message || `HTTP ${r.status}`);
        showToast(`Archivo subido: ${j.originalname}`,'success');
        document.getElementById('attFileInput').value = '';
        setTimeout(() => { prog.style.display = 'none'; bar.style.width = '0%'; }, 600);
        await loadAttachments(attCurrentKey);
    } catch(e) {
        prog.style.display = 'none'; bar.style.width = '0%';
        showToast('Error subiendo archivo: '+e.message,'error');
        console.error('[uploadAttachment]', e);
    }
}
async function deleteAttachment(key, id) {
    if (!confirm('¿Eliminar este adjunto?')) return;
    try {
        const r = await fetch(`/api/jira/ticket/${key}/attachments/${id}`, {method:'DELETE',credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('Adjunto eliminado','success');
        await loadAttachments(key);
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

function openCloseFromManage(){
    bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
    if(mgCurrentTicket){
        const t=mgCurrentTicket;
        const isLocal=(t.key||'').startsWith('TK-');
        // Actualizar subtítulo del modal de cierre según tipo de ticket
        const sub=document.getElementById('closeModalSubtitle');
        if(sub) sub.textContent=isLocal
            ? 'Se marcará como RESUELTO en el sistema local'
            : 'Se marcará como RESUELTO en Jira y en el sistema local';
        openCloseModal(t.key,t.url,(t.summary||'').replace(/'/g,"\\'"),t.reporter||'');
    }
}

// ── Tipo de atención (radio buttons cierre) ───────────────
document.addEventListener('click', e => {
    const radio = e.target.closest('label')?.querySelector('.tipo-radio');
    if (!radio) return;
    document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('tipo-active'));
    radio.checked = true;
    e.target.closest('label').querySelector('.tipo-btn').classList.add('tipo-active');
});

// ── Comentarios ───────────────────────────────────────────
let cmtCurrentKey = '';
async function openComments(key) {
    cmtCurrentKey = key;
    document.getElementById('cmtTicketKey').textContent = key;
    document.getElementById('cmtInput').value = '';
    // Checkbox nota interna: solo visible a agentes
    const toggle = document.getElementById('cmtInternalToggle');
    const chk    = document.getElementById('cmtInternalChk');
    if (toggle) { toggle.style.display = IS_AGENT ? 'flex' : 'none'; if(chk) chk.checked = false; }
    const listEl = document.getElementById('cmtList');
    listEl.innerHTML = '<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    new bootstrap.Modal(document.getElementById('modalComments')).show();
    try {
        const r = await fetch(`/api/jira/ticket/${key}/comments`, {credentials:'include'});
        const j = await r.json();
        if (!j.data?.length) { listEl.innerHTML='<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:20px;">Sin comentarios aún.</div>'; return; }
        listEl.innerHTML = j.data.map(c => {
            const isIntern = c.tipo === 'interno';
            const isSys    = c.tipo === 'sistema' || c.tipo === 'cambio_estado';
            const wrap = isIntern ? 'background:rgba(109,40,217,.08);border-left:3px solid #7c3aed;border-radius:6px;padding:8px 12px;margin-bottom:6px;' : '';
            const lock = isIntern ? '<i class="bi bi-lock-fill" style="color:#7c3aed;font-size:10px;margin-right:4px;"></i>' : '';
            return `<div class="comment-item ${isSys?'comment-sistema':''}" style="${wrap}">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="comment-author">${lock}${c.author_name||c.username||'Sistema'}${isIntern?' <span style="font-size:10px;color:#7c3aed;">(interno)</span>':''}</span>
                    <span class="comment-time">${new Date(c.created_at).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                </div>
                <div class="comment-body">${c.contenido}</div>
            </div>`;
        }).join('');
    } catch(e) { listEl.innerHTML=`<div style="color:#ef4444;font-size:12px;">${e.message}</div>`; }
}
async function submitComment() {
    const txt = document.getElementById('cmtInput').value.trim();
    if (!txt) { showToast('Escribe un comentario','error'); return; }
    const chk = document.getElementById('cmtInternalChk');
    const isInternal = IS_AGENT && chk?.checked;
    try {
        const r = await fetch(`/api/jira/ticket/${cmtCurrentKey}/comment`, {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({comment: txt, tipo: isInternal ? 'interno' : 'comentario'})
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('Comentario agregado','success');
        document.getElementById('cmtInput').value='';
        if(chk) chk.checked = false;
        openComments(cmtCurrentKey);
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ── Administración de usuarios ────────────────────────────
let _adminUsers = [];
const ROLE_LABELS = {
    administrador: { label:'Administrador', color:'#dc2626', icon:'bi-shield-fill' },
    especialista:  { label:'Especialista',  color:'#0052CC', icon:'bi-person-badge-fill' },
    visor:         { label:'Visor',         color:'#10b981', icon:'bi-eye-fill' },
    usuario:       { label:'Usuario',       color:'#6b7280', icon:'bi-person' },
};
async function loadAdminUsers() {
    const wrap = document.getElementById('adminUserTable');
    wrap.innerHTML = '<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    try {
        const r = await fetch('/api/jira/admin/users', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        _adminUsers = j.data || [];
        renderAdminUsers(_adminUsers);
    } catch(e) { wrap.innerHTML = `<div style="color:#ef4444;font-size:12px;">${e.message}</div>`; }
}
function filterAdminUsers(q) {
    const term = q.toLowerCase();
    renderAdminUsers(_adminUsers.filter(u =>
        (u.full_name||'').toLowerCase().includes(term) ||
        (u.email||'').toLowerCase().includes(term) ||
        (u.username||'').toLowerCase().includes(term)
    ));
}
function renderAdminUsers(users) {
    const wrap = document.getElementById('adminUserTable');
    if (!users.length) { wrap.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:13px;">Sin usuarios.</div>'; return; }
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--bg,#f4f5f7);border-bottom:2px solid var(--border-soft);">
        <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Usuario</th>
        <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Email</th>
        <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Perfil actual</th>
        <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Cambiar perfil</th>
        <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Estado</th>
        <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Acciones</th>
      </tr></thead>
      <tbody>${users.map((u,i) => {
        const rl = ROLE_LABELS[u.role] || {label: u.role||'—', color:'#6b7280', icon:'bi-person'};
        const isSelf = Number(u.id) === Number(CURRENT_USER_ID);
        return `<tr style="border-bottom:1px solid var(--border-soft,#e2e8f0);background:${i%2===0?'transparent':'rgba(0,0,0,.015)'};">
          <td style="padding:10px 14px;">
            <div style="font-weight:600;color:var(--text-main);">${u.full_name||u.username||'—'}</div>
            <div style="font-size:11px;color:var(--text-muted);">@${u.username||'—'}</div>
          </td>
          <td style="padding:10px 14px;color:var(--text-muted);font-size:12px;">${u.email||'—'}</td>
          <td style="padding:10px 14px;text-align:center;">
            <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${rl.color}18;color:${rl.color};">
              <i class="bi ${rl.icon}"></i>${rl.label}
            </span>
          </td>
          <td style="padding:10px 14px;text-align:center;">
            ${isSelf ? '<span style="font-size:11px;color:var(--text-muted);">—</span>' : `
            <select onchange="changeUserRole(${u.id}, this.value, this)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border-soft);font-size:12px;color:var(--text-main);background:var(--bg-card);">
              ${Object.entries(ROLE_LABELS).map(([v,r])=>`<option value="${v}"${u.role===v?' selected':''}>${r.label}</option>`).join('')}
            </select>`}
          </td>
          <td style="padding:10px 14px;text-align:center;">
            ${isSelf ? '<span style="font-size:11px;color:var(--text-muted);">—</span>' : `
            <button onclick="toggleUserStatus(${u.id}, this)" style="padding:4px 12px;border-radius:6px;border:none;font-size:11px;font-weight:600;cursor:pointer;background:${u.is_active?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)'};color:${u.is_active?'#059669':'#dc2626'};">
              ${u.is_active ? '✓ Activo' : '✗ Inactivo'}
            </button>`}
          </td>
          <td style="padding:10px 14px;text-align:center;">
            <div style="display:flex;gap:6px;justify-content:center;">
              ${!isSelf ? `<button onclick="resetAdminUserPassword(${u.id}, '${(u.full_name||u.username||'').replace(/'/g,'')}')" title="Resetear contraseña" style="padding:4px 9px;border-radius:6px;border:none;font-size:13px;cursor:pointer;background:rgba(234,179,8,.12);color:#b45309;line-height:1;"><i class="bi bi-key-fill"></i></button>` : ''}
              ${isSelf || u.role === 'administrador' ? '' : `<button onclick="deleteAdminUser(${u.id}, '${(u.full_name||u.username||'').replace(/'/g,'')}')" title="Eliminar usuario" style="padding:4px 9px;border-radius:6px;border:none;font-size:13px;cursor:pointer;background:rgba(239,68,68,.1);color:#dc2626;line-height:1;"><i class="bi bi-trash3-fill"></i></button>`}
            </div>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}
async function changeUserRole(id, role, sel) {
    try {
        const r = await fetch(`/api/jira/admin/users/${id}/role`, {
            method:'PUT', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({role})
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('Perfil actualizado','success');
        // Actualizar en memoria
        const u = _adminUsers.find(x=>x.id===id);
        if (u) u.role = role;
        // Actualizar badge visual de la fila sin recargar toda la tabla
        const td = sel.closest('tr').querySelector('td:nth-child(3)');
        const rl = ROLE_LABELS[role];
        if (td && rl) td.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${rl.color}18;color:${rl.color};"><i class="bi ${rl.icon}"></i>${rl.label}</span>`;
    } catch(e) { showToast('Error: '+e.message,'error'); sel.value = _adminUsers.find(x=>x.id===id)?.role||'usuario'; }
}
async function createAdminUser() {
    const name     = document.getElementById('au_name').value.trim();
    const username = document.getElementById('au_username').value.trim();
    const email    = document.getElementById('au_email').value.trim();
    const role     = document.getElementById('au_role').value;
    const pass        = document.getElementById('au_pass').value;
    const passConfirm = (document.getElementById('au_pass_confirm')?.value) ?? '';
    if (!name || !username || !email || !pass) { showToast('Completa todos los campos','error'); return; }
    if (pass.length < 8) { showToast('La contraseña debe tener al menos 8 caracteres','error'); return; }
    if (passConfirm !== '' && pass !== passConfirm) { showToast('Las contraseñas no coinciden','error'); return; }
    if (passConfirm === '' && document.getElementById('au_pass_confirm')) { showToast('Confirma la contraseña','error'); return; }
    try {
        const r = await fetch('/api/jira/admin/users', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({full_name:name, username, email, password:pass, role})
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('Usuario creado correctamente','success');
        ['au_name','au_username','au_email','au_pass','au_pass_confirm'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        document.getElementById('au_role').value = 'usuario';
        loadAdminUsers();
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

async function toggleUserStatus(id, btn) {
    try {
        const r = await fetch(`/api/jira/admin/users/${id}/status`, {
            method:'PUT', credentials:'include',
            headers:{'Content-Type':'application/json'}
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const active = j.is_active;
        btn.textContent = active ? '✓ Activo' : '✗ Inactivo';
        btn.style.background = active ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)';
        btn.style.color = active ? '#059669' : '#dc2626';
        const u = _adminUsers.find(x=>x.id===id);
        if (u) u.is_active = active;
        showToast(active ? 'Usuario activado' : 'Usuario desactivado', 'success');
    } catch(e) { showToast('Error: '+e.message,'error'); }
}
async function deleteAdminUser(id, name) {
    if (!confirm(`¿Eliminar al usuario "${name}"?\nEsta acción no se puede deshacer.`)) return;
    try {
        const r = await fetch(`/api/jira/admin/users/${id}`, { method:'DELETE', credentials:'include' });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('Usuario eliminado','success');
        _adminUsers = _adminUsers.filter(x => x.id !== id);
        renderAdminUsers(_adminUsers);
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

let _resetPassUserId = null;
function resetAdminUserPassword(id, name) {
    _resetPassUserId = id;
    document.getElementById('resetPassUserName').textContent = `Usuario: ${name}`;
    document.getElementById('resetPassNew').value = '';
    document.getElementById('resetPassConfirm').value = '';
    document.getElementById('resetPassError').style.display = 'none';
    document.getElementById('resetPassBtn').disabled = false;
    new bootstrap.Modal(document.getElementById('modalResetPass')).show();
    setTimeout(() => document.getElementById('resetPassNew').focus(), 300);
}
function validateResetPass() {
    const p1 = document.getElementById('resetPassNew').value;
    const p2 = document.getElementById('resetPassConfirm').value;
    const err = document.getElementById('resetPassError');
    const btn = document.getElementById('resetPassBtn');
    if (p1.length > 0 && p1.length < 8) {
        err.textContent = 'La contraseña debe tener mínimo 8 caracteres.';
        err.style.display = 'block'; btn.disabled = true; return;
    }
    if (p2.length > 0 && p1 !== p2) {
        err.textContent = 'Las contraseñas no coinciden.';
        err.style.display = 'block'; btn.disabled = true; return;
    }
    err.style.display = 'none';
    btn.disabled = !(p1.length >= 8 && p1 === p2);
}
async function confirmResetPass() {
    const pass = document.getElementById('resetPassNew').value;
    const confirm = document.getElementById('resetPassConfirm').value;
    if (pass.length < 8) { showToast('Mínimo 8 caracteres','error'); return; }
    if (pass !== confirm) { showToast('Las contraseñas no coinciden','error'); return; }
    const btn = document.getElementById('resetPassBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Actualizando…';
    try {
        const r = await fetch(`/api/jira/admin/users/${_resetPassUserId}/password`, {
            method:'PUT', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ password: pass })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        bootstrap.Modal.getInstance(document.getElementById('modalResetPass'))?.hide();
        showToast('Contraseña actualizada correctamente', 'success');
    } catch(e) {
        showToast('Error: '+e.message,'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-key-fill"></i> Actualizar contraseña';
    }
}

// ── Recategorizar ─────────────────────────────────────────
let rcatCurrentKey = '';
function openRecategorize(key) {
    rcatCurrentKey = key;
    document.getElementById('rcatKey').textContent = key;
    const t = allTickets.find(t=>t.key===key);
    if (t?.priority) document.getElementById('rcat_priority').value = t.priority;
    bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
    new bootstrap.Modal(document.getElementById('modalRecategorize')).show();
}
async function submitRecategorize() {
    const priority = document.getElementById('rcat_priority').value;
    const compVal  = document.getElementById('rcat_component').value;
    const tipoVal  = document.getElementById('rcat_tipologia').value;
    const [comp_id, comp] = compVal.includes('|') ? compVal.split('|') : [null,null];
    const [tipo_id, tipo] = tipoVal.includes('|') ? tipoVal.split('|') : [null,null];
    try {
        const r = await fetch(`/api/jira/ticket/${rcatCurrentKey}/recategorize`, {
            method:'PUT', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({priority, component:comp, component_id:comp_id, tipologia:tipo, tipologia_id:tipo_id})
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('Ticket recategorizado','success');
        bootstrap.Modal.getInstance(document.getElementById('modalRecategorize'))?.hide();
        await loadTickets();
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ── Enviar correo ─────────────────────────────────────────
let emailCurrentKey = '';
function openSendEmail(key) {
    emailCurrentKey = key;
    document.getElementById('emailTicketKey').textContent = key;
    document.getElementById('emailMsg').value = '';
    bootstrap.Modal.getInstance(document.getElementById('modalManage'))?.hide();
    new bootstrap.Modal(document.getElementById('modalSendEmail')).show();
}
async function submitSendEmail() {
    const msg = document.getElementById('emailMsg').value.trim();
    try {
        const r = await fetch(`/api/jira/ticket/${emailCurrentKey}/send-email`, {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({message: msg})
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast(`✅ ${j.message}`,'success');
        bootstrap.Modal.getInstance(document.getElementById('modalSendEmail'))?.hide();
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ── Historial del Ticket ──────────────────────────────────
async function openHistory(key) {
    document.getElementById('histModalKey').textContent = key;
    document.getElementById('histModalSummary').textContent = '';
    document.getElementById('histMetrics').innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:16px;"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando...</div>';
    document.getElementById('histTimeline').innerHTML = '';
    document.getElementById('histComments').innerHTML = '';
    new bootstrap.Modal(document.getElementById('modalHistory')).show();
    try {
        const r = await fetch(`/api/jira/ticket/${key}/history`, {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const { ticket, metrics, history, comments } = j.data;

        document.getElementById('histModalSummary').textContent = ticket.summary || '';

        // Métricas superiores
        const slaColor = metrics.slaOk === true ? '#10b981' : metrics.slaOk === false ? '#ef4444' : '#94a3b8';
        const slaText  = metrics.slaOk === true ? '✅ Cumplido' : metrics.slaOk === false ? '❌ Vencido' : '⏳ En curso';
        document.getElementById('histMetrics').innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Reporter</div>
                <div style="font-size:12px;font-weight:600;color:var(--text-main);">${ticket.reporter||'—'}</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Tiempo total</div>
                <div style="font-size:18px;font-weight:800;color:var(--primary);">${metrics.timeTotal||'—'}h</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Sin asignar</div>
                <div style="font-size:18px;font-weight:800;color:#f59e0b;">${metrics.timeUnassigned!=null?metrics.timeUnassigned+'h':'—'}</div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">SLA</div>
                <div style="font-size:14px;font-weight:700;color:${slaColor};">${slaText}</div>
            </div>`;

        // Timeline
        const evIcons = {creacion:'bi-plus-circle-fill',asignacion:'bi-person-check-fill',
                         cambio_estado:'bi-arrow-repeat',cierre:'bi-lock-fill',comentario:'bi-chat-fill'};
        const evColors= {creacion:'#0052CC',asignacion:'#7c3aed',cambio_estado:'#f59e0b',
                         cierre:'#10b981',comentario:'#64748b'};
        const evLabel = {creacion:'Creación',asignacion:'Asignación',cambio_estado:'Cambio de estado',
                         cierre:'Cierre',comentario:'Comentario'};

        const allEvents = [
            { evento:'creacion', user_name: ticket.reporter||'—', detalle:`Incidencia creada. Prioridad: ${ticket.priority||'—'}. ${ticket.summary||''}`, created_at: ticket.created_at },
            ...history,
            ...comments.map(c=>({...c, evento:'comentario', detalle: c.contenido}))
        ].filter(e=>e.created_at).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

        document.getElementById('histTimeline').innerHTML = allEvents.length
            ? allEvents.map((e,i)=>{
                const color = evColors[e.evento]||'#94a3b8';
                const icon  = evIcons[e.evento]||'bi-circle';
                const dt    = new Date(e.created_at).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
                return `<div style="display:flex;gap:12px;margin-bottom:${i<allEvents.length-1?'0':'0'};">
                    <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
                        <div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;">
                            <i class="bi ${icon}" style="color:#fff;font-size:14px;"></i>
                        </div>
                        ${i<allEvents.length-1?`<div style="width:2px;flex:1;background:var(--border-soft);margin:4px 0;min-height:20px;"></div>`:''}
                    </div>
                    <div style="flex:1;padding-bottom:16px;">
                        <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.3px;">${evLabel[e.evento]||e.evento}</div>
                        <div style="font-size:12px;color:var(--text-main);margin-top:2px;">${e.detalle||'—'}</div>
                        <div style="font-size:10px;color:var(--text-muted);margin-top:3px;"><i class="bi bi-person"></i> ${e.user_name||'—'} · ${dt}</div>
                    </div>
                </div>`;
            }).join('')
            : '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Sin eventos registrados aún.</div>';

        // Comentarios
        document.getElementById('histComments').innerHTML = comments.length
            ? comments.map(c=>`
                <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:8px;padding:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-size:11px;font-weight:700;color:var(--text-main);"><i class="bi bi-person-fill"></i> ${c.author_name||c.user_id||'—'}</span>
                        <span style="font-size:10px;color:var(--text-muted);">${new Date(c.created_at).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-main);line-height:1.5;">${c.contenido}</div>
                </div>`).join('')
            : '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Sin comentarios.</div>';

    } catch(e) {
        document.getElementById('histMetrics').innerHTML = `<div style="grid-column:1/-1;color:#ef4444;text-align:center;padding:16px;">${e.message}</div>`;
    }
}

// ── Fix comentarios (usa ticket_id como VARCHAR) ──────────
// submitComment duplicado eliminado — usar el de la línea anterior

// ── Automatizaciones ──────────────────────────────────────
function toggleAutoSection(id) {
    const map = { p1:'auto_p1_section', sat:'auto_sat_section', sla:'auto_sla_section' };
    const chk = { p1:'auto_p1_enabled', sat:'auto_sat_enabled', sla:'auto_sla_enabled' };
    const sec = document.getElementById(map[id]);
    const en  = document.getElementById(chk[id])?.checked;
    if (sec) sec.style.display = en ? 'block' : 'none';
}
async function loadAutomations() {
    try {
        const r = await fetch('/api/jira/automations', {credentials:'include'});
        const j = await r.json();
        if (!j.success) return;
        const c = j.data;
        const set = (id, val) => { const el=document.getElementById(id); if(el) el.value=val||''; };
        const chk = (id, val) => { const el=document.getElementById(id); if(el){ el.checked=(val==='1'); } };
        chk('auto_p1_enabled',  c.p1_escalation_enabled);  toggleAutoSection('p1');
        set('auto_p1_email',    c.p1_escalation_email);
        set('auto_p1_minutes',  c.p1_escalation_minutes||'30');
        chk('auto_sat_enabled', c.satisfaction_enabled);    toggleAutoSection('sat');
        chk('auto_sla_enabled', c.sla_alert_enabled);       toggleAutoSection('sla');
        set('auto_sla_email',   c.sla_alert_email);
        set('auto_sla_minutes', c.sla_alert_minutes||'10');
        // Resultados encuestas
        loadSurveyResults();
    } catch(e) { showToast('Error cargando config: '+e.message,'error'); }
}
async function saveAutomations() {
    const g = id => document.getElementById(id)?.value||'';
    const gc = id => document.getElementById(id)?.checked ? '1' : '0';
    const body = {
        p1_escalation_enabled:  gc('auto_p1_enabled'),
        p1_escalation_email:    g('auto_p1_email'),
        p1_escalation_minutes:  g('auto_p1_minutes'),
        satisfaction_enabled:   gc('auto_sat_enabled'),
        sla_alert_enabled:      gc('auto_sla_enabled'),
        sla_alert_email:        g('auto_sla_email'),
        sla_alert_minutes:      g('auto_sla_minutes'),
    };
    try {
        const r = await fetch('/api/jira/automations', {
            method:'PUT', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(body)
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast('✅ Configuración guardada','success');
    } catch(e) { showToast('Error: '+e.message,'error'); }
}
async function loadSurveyResults() {
    const wrap = document.getElementById('surveyResultsWrap');
    if (!wrap) return;
    try {
        const r = await fetch('/api/jira/survey-results', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const { data, stats } = j;
        const emojis = ['','😞','😐','🙂','😊','🤩'];
        const colors = ['','#ef4444','#f59e0b','#3b82f6','#10b981','#0052CC'];
        const prom = Number(stats.promedio);
        wrap.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
          <div style="text-align:center;padding:12px;background:var(--bg-header);border-radius:8px;">
            <div style="font-size:22px;font-weight:700;color:var(--jira-blue);">${stats.total||0}</div>
            <div style="font-size:11px;color:var(--text-muted);">Encuestas enviadas</div>
          </div>
          <div style="text-align:center;padding:12px;background:var(--bg-header);border-radius:8px;">
            <div style="font-size:22px;font-weight:700;color:#10b981;">${stats.respondidas||0}</div>
            <div style="font-size:11px;color:var(--text-muted);">Respondidas</div>
          </div>
          <div style="text-align:center;padding:12px;background:var(--bg-header);border-radius:8px;">
            <div style="font-size:22px;font-weight:700;color:#f59e0b;">${prom ? prom.toFixed(1)+' ⭐' : '—'}</div>
            <div style="font-size:11px;color:var(--text-muted);">Promedio</div>
          </div>
        </div>
        ${!data.length ? `<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px;">Sin encuestas enviadas aún.</div>` :
        `<div style="overflow-x:auto;max-height:300px;">
        <table class="table-tickets w-100">
          <thead><tr><th>Ticket</th><th>Reporter</th><th>Calificación</th><th>Comentario</th><th>Enviada</th><th>Respondida</th></tr></thead>
          <tbody>${data.map(s=>`<tr>
            <td><span class="ticket-key">${s.ticket_key}</span></td>
            <td style="font-size:11px;">${s.reporter_email||'—'}</td>
            <td style="text-align:center;">${s.rating ? `<span style="font-size:18px;">${emojis[s.rating]}</span> <span style="font-size:11px;font-weight:700;color:${colors[s.rating]};">${s.rating}/5</span>` : '<span style="font-size:11px;color:var(--text-muted);">Pendiente</span>'}</td>
            <td style="font-size:11px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.comment||'—'}</td>
            <td style="font-size:11px;">${s.sent_at ? new Date(s.sent_at).toLocaleDateString('es-PE') : '—'}</td>
            <td style="font-size:11px;">${s.responded_at ? new Date(s.responded_at).toLocaleDateString('es-PE') : '<span style="color:var(--text-muted);">Sin respuesta</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}`;
    } catch(e) {
        document.getElementById('surveyResultsWrap').innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:16px;">Error cargando resultados.</div>`;
    }
}

// ── Especialistas ─────────────────────────────────────────
async function loadSpecialists() {
    const wrap = document.getElementById('specialistListWrap');
    if (!wrap) return;
    wrap.innerHTML='<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
    try {
        const r = await fetch('/api/jira/specialists', {credentials:'include'});
        const j = await r.json();
        if (!j.data?.length) { wrap.innerHTML='<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">Sin especialistas registrados.</div>'; return; }
        wrap.innerHTML = `<table class="table-tickets w-100">
            <thead><tr><th>Nombre</th><th>Email</th><th>Especialidad</th><th>Tickets</th><th>Activos</th><th></th></tr></thead>
            <tbody>${j.data.map(u=>`<tr>
                <td><strong>${u.full_name||u.username}</strong>${u.phone?`<br><small style="color:var(--text-muted)">${u.phone}</small>`:''}</td>
                <td style="font-size:12px;">${u.email}</td>
                <td><span style="font-size:11px;background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:20px;">${u.specialty||'—'}</span></td>
                <td style="text-align:center;font-weight:700;">${u.total_tickets||0}</td>
                <td style="text-align:center;"><span style="color:${u.open_tickets>0?'#f59e0b':'#10b981'};font-weight:700;">${u.open_tickets||0}</span></td>
                <td><button class="btn-outline-sm" style="${u.is_active?'color:#dc2626;border-color:#dc2626':'color:#10b981;border-color:#10b981'}" onclick="toggleSpecialist(${u.id})">${u.is_active?'Desactivar':'Activar'}</button></td>
            </tr>`).join('')}</tbody></table>`;
    } catch(e) { wrap.innerHTML=`<div style="color:#ef4444;font-size:12px;">${e.message}</div>`; }
}
async function createSpecialist() {
    const full_name=document.getElementById('sp_name').value.trim();
    const username =document.getElementById('sp_username').value.trim();
    const email    =document.getElementById('sp_email').value.trim();
    const phone    =document.getElementById('sp_phone').value.trim();
    const specialty=document.getElementById('sp_specialty').value;
    const password =document.getElementById('sp_pass').value;
    if (!full_name||!email||!password) { showToast('Nombre, email y contraseña son obligatorios','error'); return; }
    if (password.length < 8) { showToast('La contraseña debe tener al menos 8 caracteres','error'); return; }
    try {
        const r = await fetch('/api/jira/specialists', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({full_name, username, email, phone, specialty, password})
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast(`✅ Especialista ${full_name} registrado`,'success');
        ['sp_name','sp_username','sp_email','sp_phone','sp_pass'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('sp_specialty').value='';
        loadSpecialists();
        loadTechnicians(); // Actualizar dropdown de asignación
    } catch(e) { showToast('Error: '+e.message,'error'); }
}
async function toggleSpecialist(id) {
    try {
        const r = await fetch(`/api/jira/specialists/${id}/toggle`,{method:'PUT',credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        loadSpecialists();
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ── KPIs / Stats ──────────────────────────────────────────
let _chartEvol = null, _chartSla = null, _chartMttrCat = null;
let _evolData  = [];
let _chartPeriod = 'week';

function setStatsPeriod(p, btn) {
    document.querySelectorAll('#statsPeriodBtns button').forEach(b => {
        b.style.borderColor = 'var(--border-soft)'; b.style.color = 'var(--text-muted)';
    });
    if (btn) { btn.style.borderColor = 'var(--jira-blue)'; btn.style.color = 'var(--jira-blue)'; }
    const m = { hoy:'day', sem:'week', mes:'month' };
    _chartPeriod = m[p] || 'week';
    renderEvolChart(_evolData, _chartPeriod);
}

function renderSlaDonut(pct) {
    const canvas = document.getElementById('chartSlaDonut');
    const center = document.getElementById('chartSlaCenter');
    if (!canvas) return;
    if (center) center.textContent = pct + '%';
    const color = pct >= 95 ? '#10b981' : pct >= 80 ? '#f59e0b' : '#ef4444';
    if (_chartSla) _chartSla.destroy();
    _chartSla = new Chart(canvas, {
        type: 'doughnut',
        data: { datasets: [{ data: [pct, 100 - pct], backgroundColor: [color, 'rgba(0,0,0,.06)'], borderWidth: 0, cutout: '78%' }] },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { animateRotate: true, duration: 600 }
        }
    });
    if (center) center.style.color = color;
}

function renderEstadoHtml(porEstado, porPrioridad) {
    const estadoEl = document.getElementById('kpiEstadoWrap');
    const priorEl  = document.getElementById('kpiPriorWrap');
    const estadoMap = { abierto:'Abierto', asignado:'Asignado', en_progreso:'En progreso',
                        pendiente_usuario:'Pendiente', resuelto:'Resuelto' };
    const estadoColors = { abierto:'#f59e0b', asignado:'#3b82f6', en_progreso:'#8b5cf6',
                           pendiente_usuario:'#06b6d4', resuelto:'#10b981' };
    if (estadoEl && Array.isArray(porEstado) && porEstado.length) {
        const maxE = Math.max(...porEstado.map(d => Number(d.total)));
        estadoEl.innerHTML = porEstado.map(d => {
            const pct = maxE > 0 ? Math.round(Number(d.total) / maxE * 100) : 0;
            const col = estadoColors[d.internal_status] || '#94a3b8';
            return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;">
                <span style="width:54px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${estadoMap[d.internal_status]||d.internal_status}</span>
                <div style="flex:1;height:6px;background:var(--border-soft);border-radius:4px;">
                  <div style="height:6px;background:${col};border-radius:4px;width:${pct}%;"></div>
                </div>
                <span style="width:22px;text-align:right;font-weight:700;color:${col};">${d.total}</span>
            </div>`;
        }).join('');
    }
    if (priorEl && Array.isArray(porPrioridad) && porPrioridad.length) {
        const priorColors = { P1:'#ef4444', P2:'#f59e0b', P3:'#3b82f6', P4:'#94a3b8' };
        const maxP = Math.max(...porPrioridad.map(d => Number(d.total)));
        priorEl.innerHTML = porPrioridad.map(d => {
            const hPct = maxP > 0 ? Math.round(Number(d.total) / maxP * 100) : 0;
            const col = priorColors[d.priority] || '#94a3b8';
            return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">
                <span style="font-size:9px;font-weight:700;color:${col};">${d.total}</span>
                <div style="width:100%;background:${col};border-radius:3px 3px 0 0;height:${Math.max(6, Math.round(hPct * 0.34))}px;"></div>
                <span style="font-size:9px;color:var(--text-muted);">${d.priority||'?'}</span>
            </div>`;
        }).join('');
    }
}

function renderBreachTable(data) {
    const wrap  = document.getElementById('kpiBreachTable');
    const badge = document.getElementById('kpiBreachCount');
    if (!wrap) return;
    if (!Array.isArray(data) || !data.length) {
        wrap.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;font-size:12px;"><i class="bi bi-check2-circle" style="color:#10b981;"></i> Sin tickets en riesgo de SLA</div>';
        if (badge) badge.style.display = 'none';
        return;
    }
    if (badge) { badge.textContent = data.length + ' TICKETS'; badge.style.display = ''; }
    const prioColors = { P1:'#ef4444', P2:'#f59e0b', P3:'#3b82f6', P4:'#94a3b8' };
    wrap.innerHTML = `<div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead><tr style="border-bottom:1px solid var(--border-soft);">
            <th style="text-align:left;padding:5px 8px;color:var(--text-muted);font-weight:600;">ID</th>
            <th style="text-align:left;padding:5px 8px;color:var(--text-muted);font-weight:600;">Descripción</th>
            <th style="padding:5px 6px;color:var(--text-muted);font-weight:600;">Prior.</th>
            <th style="text-align:left;padding:5px 8px;color:var(--text-muted);font-weight:600;">Técnico</th>
            <th style="padding:5px 6px;color:var(--text-muted);font-weight:600;">SLA %</th>
            <th style="padding:5px 6px;color:var(--text-muted);font-weight:600;">Estado</th>
            <th style="padding:5px 6px;color:var(--text-muted);font-weight:600;">MTTR</th>
          </tr></thead>
          <tbody>
            ${data.map(t => {
                const sla = Number(t.sla_pct) || 0;
                const slaColor = sla === 0 ? '#ef4444' : sla < 50 ? '#f59e0b' : '#3b82f6';
                const slaLabel = sla === 0 ? 'Breach' : sla + '%';
                const pCol = prioColors[t.priority] || '#94a3b8';
                const mttr = t.mttr_h ? t.mttr_h + 'h' : '—';
                return `<tr style="border-bottom:1px solid var(--border-soft);">
                    <td style="padding:6px 8px;"><span style="font-size:11px;font-weight:700;color:#3b82f6;cursor:pointer;" onclick="buscarTicketExternal('${t.ticket_key}')">#${t.ticket_key}</span></td>
                    <td style="padding:6px 8px;color:var(--text-main);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.summary||'—'}</td>
                    <td style="padding:6px;text-align:center;"><span style="background:${pCol};color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;">${t.priority||'—'}</span></td>
                    <td style="padding:6px 8px;color:var(--text-muted);">${t.tech||'—'}</td>
                    <td style="padding:6px;text-align:center;"><span style="color:${slaColor};font-weight:700;">${slaLabel}</span></td>
                    <td style="padding:6px;text-align:center;"><span style="font-size:10px;color:var(--text-muted);background:var(--bg-main);border-radius:4px;padding:1px 6px;">${t.internal_status||'—'}</span></td>
                    <td style="padding:6px;text-align:center;color:var(--text-muted);">${mttr}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
    </div>`;
}

function renderMttrCat(data) {
    const canvas = document.getElementById('chartMttrCat');
    if (!canvas || !Array.isArray(data) || !data.length) return;
    if (_chartMttrCat) _chartMttrCat.destroy();
    const labels = data.map(d => d.cat || 'General');
    const vals   = data.map(d => Number(d.mttr_h) || 0);
    const colors = ['#ef4444','#f59e0b','#3b82f6','#8b5cf6','#10b981','#06b6d4'];
    _chartMttrCat = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ data: vals, backgroundColor: colors.slice(0, vals.length), borderRadius: 4, borderSkipped: false }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw}h` } } },
            scales: {
                x: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => v+'h' }, grid: { color: 'rgba(0,0,0,.04)' } },
                y: { ticks: { font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
}

function renderMetricBoxes(fcr_pct, csat) {
    const fcrEl  = document.getElementById('mboxFcrVal');
    const csatEl = document.getElementById('mboxCsatVal');
    const fcrMeta = document.getElementById('mboxFcrMeta');
    const csatMeta = document.getElementById('mboxCsatMeta');
    if (fcrEl) {
        fcrEl.textContent = fcr_pct > 0 ? fcr_pct + '%' : '—';
        fcrEl.style.color = fcr_pct >= 70 ? '#10b981' : '#f59e0b';
        if (fcrMeta) fcrMeta.style.color = fcr_pct >= 70 ? '#10b981' : '#f59e0b';
    }
    // Reapertura / MTTA: sin datos de BD directos — mostrar "N/D" de forma limpia
    const reopenEl = document.getElementById('mboxReopenVal');
    const mttaEl   = document.getElementById('mboxMttaVal');
    if (reopenEl && !reopenEl.dataset.loaded) { reopenEl.textContent = 'N/D'; reopenEl.dataset.loaded = '1'; }
    if (mttaEl   && !mttaEl.dataset.loaded)   { mttaEl.textContent   = 'N/D'; mttaEl.dataset.loaded   = '1'; }
    if (csatEl) {
        csatEl.textContent = csat > 0 ? csat.toFixed(1) : '—';
        csatEl.style.color = csat >= 4 ? '#10b981' : csat >= 3 ? '#f59e0b' : '#ef4444';
        if (csatMeta) csatMeta.style.color = csat >= 4 ? '#10b981' : 'var(--text-muted)';
    }
}

function rankList(data, labelKey, countKey, color) {
    if (!data?.length) return '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">Sin datos aún.</div>';
    const max = data[0][countKey] || 1;
    return data.map((r, i) => {
        const pct = Math.round((r[countKey] / max) * 100);
        const medals = ['🥇','🥈','🥉'];
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border-soft);">
            <span style="font-size:14px;width:22px;flex-shrink:0;">${medals[i]||`<span style='font-size:11px;font-weight:700;color:var(--text-muted);'>#${i+1}</span>`}</span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r[labelKey]||'—'}</div>
                <div style="height:4px;background:var(--border-soft);border-radius:4px;margin-top:4px;">
                    <div style="height:4px;background:${color};border-radius:4px;width:${pct}%;transition:width .4s;"></div>
                </div>
            </div>
            <span style="font-size:13px;font-weight:700;color:${color};flex-shrink:0;">${r[countKey]}</span>
        </div>`;
    }).join('');
}

function setChartPeriod(period, btn) {
    _chartPeriod = period;
    document.querySelectorAll('#chartPeriodDay,#chartPeriodWeek,#chartPeriodMonth').forEach(b=>{
        b.style.borderColor=''; b.style.color=''; b.classList.remove('active');
    });
    if (btn) { btn.style.borderColor='var(--jira-blue)'; btn.style.color='var(--jira-blue)'; }
    renderEvolChart(_evolData, period);
}

function renderEvolChart(data, period) {
    if (!data?.length) return;
    const canvas = document.getElementById('chartEvolucion');
    if (!canvas) return;
    // Agrupar según período
    let grouped = {};
    data.forEach(d => {
        let key = d.dia;
        if (period === 'week') {
            const dt = new Date(d.dia);
            const wk = new Date(dt.setDate(dt.getDate() - dt.getDay()));
            key = wk.toISOString().slice(0,10);
        } else if (period === 'month') {
            key = d.dia.slice(0,7);
        }
        if (!grouped[key]) grouped[key] = { total:0, cerrados:0 };
        grouped[key].total   += +d.total;
        grouped[key].cerrados += +d.cerrados;
    });
    const labels = Object.keys(grouped).sort();
    const totals  = labels.map(k => grouped[k].total);
    const cerrados= labels.map(k => grouped[k].cerrados);
    if (_chartEvol) _chartEvol.destroy();
    _chartEvol = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label:'Creados', data:totals,  borderColor:'#0052CC', backgroundColor:'rgba(0,82,204,.08)', tension:.3, fill:true, pointRadius:3 },
                { label:'Cerrados',data:cerrados, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.06)', tension:.3, fill:true, pointRadius:3 }
            ]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom' } }, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } } }
    });
}

// ── Indicadores de técnicos locales ──────────────────────────
async function loadLocalStats(){
    const cards=document.getElementById('ls-techCards');
    const table=document.getElementById('ls-techTable');
    if(cards) cards.innerHTML='<div class="spinner-wrap"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando...</div>';
    try{
        const r=await fetch('/api/jira/local/stats',{credentials:'include'});
        const j=await r.json();
        if(!j.success) throw new Error(j.message);
        const {techStats,summary}=j.data;
        // KPIs
        const setKpi=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
        setKpi('ls-kpiTotal',    summary.total);
        setKpi('ls-kpiActivos',  summary.activos);
        setKpi('ls-kpiSinAsignar',summary.sin_asignar);
        setKpi('ls-kpiCerrados', summary.cerrados);
        setKpi('ls-kpiP1',       summary.p1_activos);
        setKpi('ls-kpiSla',      summary.sla_pct+'%');
        // Actualizar color SLA
        const slaEl=document.getElementById('ls-kpiSla');
        if(slaEl) slaEl.className='kpi-value '+(summary.sla_pct>=80?'success':summary.sla_pct>=60?'warning':'danger');
        // Tech cards
        const roleColors={administrador:'#dc2626',especialista:'#0052cc',agente:'#7c3aed',tecnico:'#0891b2',visor:'#10b981',usuario:'#94a3b8'};
        if(cards){
            if(!techStats.length){
                cards.innerHTML='<div style="color:var(--text-muted);font-size:13px;padding:20px;">Sin técnicos activos. Agrega usuarios con rol Especialista o Administrador en la sección Administración.</div>';
            } else {
                cards.innerHTML=techStats.map(t=>{
                    const tot=Number(t.total)||0,res=Number(t.resolved)||0;
                    const active=(Number(t.open_tickets)||0)+(Number(t.in_progress)||0)+(Number(t.pendiente)||0);
                    const slaOk=Number(t.sla_ok)||0,slaBad=Number(t.sla_bad)||0;
                    const slaT=slaOk+slaBad,slaPct=slaT>0?Math.round(slaOk/slaT*100):100;
                    const avgH=t.avg_min?(t.avg_min<60?Math.round(t.avg_min)+'min':(t.avg_min/60).toFixed(1)+'h'):'—';
                    const color=roleColors[t.role]||'#6366f1';
                    const slaColor=slaPct>=80?'#10b981':slaPct>=60?'#f59e0b':'#ef4444';
                    const init=(t.tech||'?')[0].toUpperCase();
                    return `<div class="kpi-card" style="padding:14px 16px;text-align:left;min-width:0;overflow:hidden;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                            <div style="width:36px;height:36px;background:${color}20;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:${color};flex-shrink:0;">${init}</div>
                            <div style="min-width:0;">
                                <div style="font-size:12px;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${t.tech||''}">${t.tech||'—'}</div>
                                <div style="font-size:10px;color:${color};font-weight:600;text-transform:capitalize;">${t.role||''}</div>
                            </div>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center;margin-bottom:8px;">
                            <div style="background:var(--bg-main);border-radius:6px;padding:6px 4px;">
                                <div style="font-size:18px;font-weight:800;color:#f59e0b;font-family:monospace;">${active}</div>
                                <div style="font-size:9px;color:var(--text-muted);font-weight:600;">Activos</div>
                            </div>
                            <div style="background:var(--bg-main);border-radius:6px;padding:6px 4px;">
                                <div style="font-size:18px;font-weight:800;color:#10b981;font-family:monospace;">${res}</div>
                                <div style="font-size:9px;color:var(--text-muted);font-weight:600;">Resueltos</div>
                            </div>
                            <div style="background:var(--bg-main);border-radius:6px;padding:6px 4px;">
                                <div style="font-size:16px;font-weight:800;color:${slaColor};font-family:monospace;">${slaPct}%</div>
                                <div style="font-size:9px;color:var(--text-muted);font-weight:600;">SLA</div>
                            </div>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);">
                            <span>Total: <strong>${tot}</strong></span>
                            <span>Prom: <strong>${avgH}</strong></span>
                        </div>
                    </div>`;
                }).join('');
            }
        }
        // Detailed table
        if(table){
            if(!techStats.length){
                table.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">Sin datos.</div>';
            } else {
                table.innerHTML=`<table class="table-tickets w-100">
                    <thead><tr><th>Técnico</th><th>Total</th><th>Activos</th><th>En progreso</th><th>Pendiente</th><th>Resueltos</th><th>% SLA</th><th>Tiempo prom.</th></tr></thead>
                    <tbody>${techStats.map(t=>{
                        const slaOk=Number(t.sla_ok)||0,slaBad=Number(t.sla_bad)||0;
                        const slaT=slaOk+slaBad,slaPct=slaT>0?Math.round(slaOk/slaT*100):100;
                        const avgH=t.avg_min?(t.avg_min<60?Math.round(t.avg_min)+'min':(t.avg_min/60).toFixed(1)+'h'):'—';
                        const slaColor=slaPct>=80?'#10b981':slaPct>=60?'#f59e0b':'#ef4444';
                        return `<tr>
                            <td><strong>${t.tech||'—'}</strong><br><span style="font-size:10px;color:var(--text-muted);">${t.email||''}</span></td>
                            <td>${Number(t.total)||0}</td>
                            <td><span style="color:#f59e0b;font-weight:700;">${Number(t.open_tickets)||0}</span></td>
                            <td><span style="color:#6366f1;font-weight:700;">${Number(t.in_progress)||0}</span></td>
                            <td><span style="color:#0891b2;font-weight:700;">${Number(t.pendiente)||0}</span></td>
                            <td><span style="color:#10b981;font-weight:700;">${Number(t.resolved)||0}</span></td>
                            <td><span style="color:${slaColor};font-weight:700;">${slaPct}%</span></td>
                            <td style="font-size:12px;color:var(--text-muted);">${avgH}</td>
                        </tr>`;
                    }).join('')}</tbody></table>`;
            }
        }

        // ── Gráficos del panel indicadores local ──────────────────────────────
        const {byPriority=[],evolucion=[],mttrByCat=[]} = j.data;
        _renderLocalCharts(byPriority, evolucion, mttrByCat, summary);

    }catch(e){
        if(cards) cards.innerHTML=`<div style="color:#ef4444;font-size:12px;">${e.message}</div>`;
        if(table) table.innerHTML='';
    }
}

function _renderLocalCharts(byPriority, evolucion, mttrByCat, summary) {
    // ── Métricas extra debajo de la tabla ─────────────────────────────────────
    let extraEl = document.getElementById('ls-extraMetrics');
    if (!extraEl) {
        extraEl = document.createElement('div');
        extraEl.id = 'ls-extraMetrics';
        const panel = document.getElementById('incPanel-indicadores');
        if (panel) panel.appendChild(extraEl);
    }

    const priColors = {P1:'#ef4444',P2:'#f97316',P3:'#3b82f6',P4:'#94a3b8'};
    const priTotal  = byPriority.reduce((s,r)=>s+Number(r.total),0)||1;

    const priHtml = byPriority.map(r=>`
        <div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
                <span style="font-weight:700;color:${priColors[r.priority]||'#64748b'}">${r.priority||'—'}</span>
                <span style="color:var(--text-muted)">${r.total} tickets (${Math.round(Number(r.total)/priTotal*100)}%)</span>
            </div>
            <div style="height:6px;border-radius:3px;background:var(--border-soft);overflow:hidden;">
                <div style="height:100%;width:${Math.round(Number(r.total)/priTotal*100)}%;background:${priColors[r.priority]||'#64748b'};border-radius:3px;transition:width .5s;"></div>
            </div>
        </div>`).join('');

    const evoLabels = evolucion.map(r=>r.dia?.slice(5)||'');
    const evoTotals = evolucion.map(r=>Number(r.total));
    const evoClosed = evolucion.map(r=>Number(r.cerrados));

    const mttrHtml = mttrByCat.length ? mttrByCat.map(r=>`
        <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-soft);font-size:12px;">
            <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${r.cat}">${r.cat}</span>
            <span style="font-family:monospace;font-weight:700;color:#0891b2;flex-shrink:0;">${r.mttr_h}h</span>
            <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${r.total} tickets</span>
        </div>`).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">Sin datos de resolución aún.</div>';

    extraEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px;">
            <!-- Métricas rápidas -->
            <div class="card-panel">
                <div class="card-panel-title" style="margin-bottom:14px;"><i class="bi bi-speedometer2" style="color:#0891b2"></i> Indicadores clave</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
                    <div style="background:var(--bg-main);border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#0891b2;font-family:monospace;">${summary.mttr||'—'}</div>
                        <div style="font-size:9px;color:var(--text-muted);font-weight:700;text-transform:uppercase;">MTTR</div>
                    </div>
                    <div style="background:var(--bg-main);border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#10b981;font-family:monospace;">${summary.sla_pct}%</div>
                        <div style="font-size:9px;color:var(--text-muted);font-weight:700;text-transform:uppercase;">SLA OK</div>
                    </div>
                    <div style="background:var(--bg-main);border-radius:8px;padding:10px;text-align:center;">
                        <div style="font-size:20px;font-weight:800;color:#7c3aed;font-family:monospace;">${summary.csat>0?summary.csat+'⭐':'—'}</div>
                        <div style="font-size:9px;color:var(--text-muted);font-weight:700;text-transform:uppercase;">CSAT</div>
                    </div>
                </div>
                <!-- Distribución por prioridad -->
                <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">Por prioridad</div>
                ${priHtml||'<div style="color:var(--text-muted);font-size:12px;">Sin datos</div>'}
            </div>
            <!-- MTTR por categoría -->
            <div class="card-panel">
                <div class="card-panel-title" style="margin-bottom:14px;"><i class="bi bi-clock-history" style="color:#7c3aed"></i> MTTR por categoría</div>
                ${mttrHtml}
            </div>
        </div>
        <!-- Evolución diaria -->
        <div class="card-panel" style="margin-top:16px;">
            <div class="card-panel-title" style="margin-bottom:14px;"><i class="bi bi-graph-up-arrow" style="color:#2563eb"></i> Evolución últimos 30 días</div>
            <div style="position:relative;height:200px;">
                <canvas id="lsChartEvolucion"></canvas>
            </div>
        </div>`;

    // Dibujar chart evolución con Chart.js
    if (evolucion.length && typeof Chart !== 'undefined') {
        const ctx = document.getElementById('lsChartEvolucion');
        if (ctx) {
            if (ctx._chartInstance) ctx._chartInstance.destroy();
            ctx._chartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: evoLabels,
                    datasets: [
                        { label:'Creados', data:evoTotals, backgroundColor:'rgba(37,99,235,.6)', borderRadius:4 },
                        { label:'Cerrados', data:evoClosed, backgroundColor:'rgba(16,185,129,.6)', borderRadius:4 }
                    ]
                },
                options: {
                    responsive:true, maintainAspectRatio:false,
                    plugins:{ legend:{ labels:{ font:{size:11} } } },
                    scales:{
                        x:{ ticks:{ font:{size:10}, maxTicksLimit:15 } },
                        y:{ beginAtZero:true, ticks:{ font:{size:10}, stepSize:1 } }
                    }
                }
            });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOCAL VIEW — Paneles autónomos (TK-% only, sin Jira)
// ═══════════════════════════════════════════════════════════════════════════════

function showPanel(name, el) {
    if (typeof LOCAL_VIEW !== 'undefined' && LOCAL_VIEW) { _localShowPanel(name, el); return; }
    // ── Jira mode ─────────────────────────────────────────────────────────────
    const todos = document.getElementById('incPanel-todos');
    if (todos) todos.style.display = 'none';
    const consultas = document.getElementById('incPanel-consultas');
    if (consultas) consultas.style.display = 'none';
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('panel-' + name);
    if (target) target.classList.add('active');
    if (name === 'paneles') {
        setTimeout(function() {
            if (typeof _mpRenderChipBar === 'function') _mpRenderChipBar();
            if (typeof _mpRenderKpis    === 'function') _mpRenderKpis();
            if (typeof _mpRenderCanvas  === 'function') _mpRenderCanvas();
        }, 0);
    }
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    if (name === 'consultas') {
        const cp = document.getElementById('incPanel-consultas');
        if (cp) cp.style.display = 'block';
    }
    const _titles = {misAsig:'Mis asignados',sinAsig:'Sin asignar',enCurso:'En curso',sinCat:'Categorías',alertas:'Alertas',kanban:'Kanban',tecnicos:'Estadísticas por Técnico',sla:'SLA en Tiempo Real',heatmap:'Mapa de Calor',semanal:'Comparativa Semana a Semana',buscar:'Buscar ticket',historico:'Histórico',indicadores:'Indicadores',reportes:'Reportes',analizador:'Analizador',paneles:'Mis Paneles',ejecutivo:'Dashboard Ejecutivo',cmdb:'Por Equipo — Historial de incidencias',consultas:'Consultas Activas'};
    const t = document.getElementById('incTopbarTitle'); if (t) t.textContent = _titles[name] || name;
    const s = document.getElementById('incTopbarSub');   if (s) s.textContent = '';
    const _refreshFn = {
        misAsig:'loadMisAsig()',sinAsig:'loadSinAsig()',enCurso:'loadEnCurso(true)',
        kanban:'loadKanban()',sinCat:'loadSinCategorizar(true)',
        alertas:'loadAlertasPanel(true)',sla:'loadSlaPanel(true)',
        tecnicos:'loadTecStats(true)',heatmap:'loadHeatmap(true)',cmdb:'loadCmdbPanel(true)',
        historico:'autoLoadHistorico()',indicadores:'if(typeof loadStats==="function")loadStats()',
        semanal:'loadWeekComp(true)',reportes:'initReportes()',analizador:'loadAnJiraBoard()',
        paneles:'loadMisPaneles(true)',ejecutivo:'loadEjecutivo(true)',
        consultas:'loadConsultasActivas()'
    };
    const _rb  = document.getElementById('btnSyncTickets');
    const _lbl = document.getElementById('btnSyncLabel');
    if (_rb)  _rb.setAttribute('onclick', _refreshFn[name] || 'syncAndReload()');
    if (_lbl) _lbl.textContent = _refreshFn[name] ? 'Actualizar' : 'Sincronizar';
    const periodBtns = document.getElementById('statsPeriodBtns');
    const divider    = document.getElementById('periodDivider');
    const isInd = name === 'indicadores';
    if (periodBtns) periodBtns.style.display = isInd ? 'flex' : 'none';
    if (divider)    divider.style.display    = isInd ? '' : 'none';
    requestAnimationFrame(function() {
        const sc = document.getElementById('incScrollArea');
        if (sc) sc.scrollTop = 0;
        if (el) {
            const nav = el.closest('nav');
            if (nav) {
                const elTop = el.offsetTop, elBottom = elTop + el.offsetHeight;
                if (elBottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = elBottom - nav.clientHeight + 4;
                else if (elTop < nav.scrollTop) nav.scrollTop = elTop - 4;
            }
        }
    });
}

function _localShowPanel(name, el) {
    // Panels use .panel + .active CSS — NOT inline display
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#incPanel-todos,#incPanel-indicadores,#incPanel-admin').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');

    const TITLES = {
        todos:'Gestión Local', misAsig:'Mis asignados — Local', sinAsig:'Sin asignar — Local',
        enCurso:'En curso — Local', kanban:'Kanban — Local', alertas:'Alertas — Local',
        sla:'SLA en tiempo real', tecnicos:'Por técnico', heatmap:'Mapa de calor',
        sinCat:'Categorías', historico:'Histórico', indicadores:'Indicadores',
        reportes:'Reportes', admin:'Administración',
    };
    const t = document.getElementById('incTopbarTitle');
    if (t) t.textContent = TITLES[name] || name;

    function _show(id) {
        const p = document.getElementById(id);
        if (!p) return;
        if (p.classList.contains('panel')) p.classList.add('active');
        else p.style.display = '';
    }

    const loaders = {
        todos:      () => { _show('incPanel-todos');       loadTickets(); },
        misAsig:    () => { _show('panel-misAsig');        loadLocalMisAsig(); },
        sinAsig:    () => { _show('panel-sinAsig');        loadLocalSinAsig(); },
        enCurso:    () => { _show('panel-enCurso');        loadLocalEnCurso(); },
        kanban:     () => { _show('panel-kanban');         loadLocalKanban(); },
        alertas:    () => { _show('panel-alertas');        loadAlertasPanelLocal(); },
        sla:        () => { _show('panel-sla');            loadLocalSla(); },
        tecnicos:   () => { _show('panel-tecnicos');       loadLocalTecStats(); },
        heatmap:    () => { _show('panel-heatmap');        loadLocalHeatmap(); },
        sinCat:     () => { _show('panel-sinCat');         loadLocalCategorias(); },
        historico:  () => { _show('panel-historico'); },
        indicadores:() => { _show('incPanel-indicadores'); loadLocalStats(); },
        reportes:   () => { _show('panel-reportes');       initLocalReportes(); },
        admin:      () => { _show('incPanel-admin');       loadAdminUsers(); },
    };
    (loaders[name] || (() => {}))();
}

// openTicketDetail — open manage modal; fetches ticket from API if not in allTickets
function openTicketDetail(key) {
    if (allTickets.find(t => t.key === key)) { openManage(key); return; }
    // Ticket not yet in cache — fetch and inject into allTickets first
    fetch(`/api/jira/tickets?source=local&all=1`, {credentials:'include'})
        .then(r => r.json())
        .then(j => { if (j.success && j.data) allTickets = j.data; openManage(key); })
        .catch(() => openManage(key));
}

// ── loadStats: single entry point (Jira version renamed to _loadStatsJira) ────
function loadStats() {
    if (typeof LOCAL_VIEW !== 'undefined' && LOCAL_VIEW) loadLocalStats();
    else _loadStatsJira();
}

// ── Renderizador de ticket local (formato plano MySQL → HTML card) ────────────
function renderLocalTicket(t) {
    const priColors = {P1:'#ef4444',P2:'#f97316',P3:'#3b82f6',P4:'#94a3b8'};
    const stColors  = {abierto:'#f59e0b',asignado:'#3b82f6',en_progreso:'#7c3aed',pendiente_usuario:'#0891b2',resuelto:'#10b981',cerrado:'#64748b'};
    const stLabels  = {abierto:'Abierto',asignado:'Asignado',en_progreso:'En progreso',pendiente_usuario:'Pendiente',resuelto:'Resuelto',cerrado:'Cerrado'};
    const now = Date.now();
    const slaClass = t.sla_status === 'breach' ? 'sla-f-red' : t.sla_status === 'critical' ? 'sla-f-amber' : t.sla_status === 'warning' ? 'sla-f-yellow' : 'sla-f-green';
    const slaText  = t.sla_status === 'breach' ? 'SLA VENCIDO' : t.sla_status === 'critical' ? 'SLA CRÍTICO' : t.sla_status === 'warning' ? 'SLA RIESGO' : '';
    const age = t.created ? ticketAge(t.created) : '—';
    const priColor = priColors[t.priority] || '#64748b';
    const stColor  = stColors[t.internal_status] || '#64748b';
    const stLabel  = stLabels[t.internal_status] || t.internal_status || '—';

    return `<div class="ticket-row" style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:10px;padding:11px 14px;cursor:pointer;transition:box-shadow .15s;" onclick="openTicketDetail('${t.key}')">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-family:monospace;font-weight:800;font-size:12px;color:#2563eb;flex-shrink:0;">${t.key}</span>
            <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${priColor}20;color:${priColor};flex-shrink:0;">${t.priority||'—'}</span>
            <span style="display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;background:${stColor}20;color:${stColor};flex-shrink:0;">${stLabel}</span>
            ${slaText ? `<span class="sla-flag ${slaClass}" style="flex-shrink:0;font-size:9px;"><i class="bi bi-clock-fill"></i> ${slaText}</span>` : ''}
            <span style="flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${t.summary||''}">${t.summary||'—'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:6px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">
            <span><i class="bi bi-person-circle"></i> ${t.reporter||'—'}</span>
            ${t.assigned_to_name ? `<span><i class="bi bi-person-badge-fill" style="color:#2563eb;"></i> ${t.assigned_to_name}</span>` : `<span style="color:#f59e0b;"><i class="bi bi-person-dash"></i> Sin asignar</span>`}
            ${t.component ? `<span><i class="bi bi-tag-fill"></i> ${t.component}</span>` : ''}
            <span style="margin-left:auto;font-family:monospace;font-size:10px;"><i class="bi bi-clock"></i> ${age}</span>
        </div>
    </div>`;
}

// ── Tabla local — mismo formato profesional que renderTable() ─────────────────
function _localTableRow(t) {
    const ist = t.internal_status || t.status || 'abierto';
    const crDate = t.created ? new Date(t.created).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
    const age  = ticketAge(t.created);
    const tech = t.assigned_to_name
        ? `<span style="display:inline-flex;align-items:center;gap:6px;">${techAvatar(t.assigned_to_name)}</span>`
        : `<span style="font-size:11px;color:#f59e0b;"><i class="bi bi-person-dash"></i> Sin asignar</span>`;
    const isClosedTicket = ['cerrado','resuelto'].includes(ist);
    let actions = '';
    if (!isClosedTicket && IS_AGENT) {
        if (!t.assigned_to)
            actions += `<button class="btn-take" onclick="takeTicket('${t.key}')"><i class="bi bi-hand-index"></i> Tomar</button> `;
        actions += `<button class="btn-manage" onclick="openManage('${t.key}')"><i class="bi bi-sliders"></i> Gestionar</button>`;
    }
    if (!IS_AGENT)
        actions += `<button class="btn-outline-sm" onclick="openComments('${t.key}')"><i class="bi bi-chat-dots"></i> Comentar</button> `;
    actions += ` <button class="btn-outline-sm" title="Ver historial" onclick="openHistory('${t.key}')"><i class="bi bi-clock-history"></i></button>`;

    return `<tr style="${prioRowStyle(t.priority||'P3')}">
        <td>
          <span class="ticket-key" style="cursor:pointer;" onclick="openManage('${t.key}')">${t.key}</span>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${crDate}</div>
          <div style="font-size:10px;color:var(--text-muted);"><i class="bi bi-hourglass"></i> ${age}</div>
        </td>
        <td style="max-width:200px;">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(t.summary||'').replace(/"/g,'&quot;')}">${t.summary||'—'}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;"><i class="bi bi-envelope"></i> ${t.reporter||'—'}</div>
        </td>
        <td>${prioBadge(t.priority||'P3')}</td>
        <td>${istBadge(ist)}</td>
        <td>${tech}</td>
        <td>${slaLabel(t.sla_deadline)}</td>
        <td style="white-space:nowrap;">${actions}</td>
    </tr>`;
}

function _localList(containerId, tickets, emptyMsg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!tickets || !tickets.length) {
        el.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;font-size:32px;"></i><p>${emptyMsg||'Sin tickets'}</p></div>`;
        return;
    }
    el.innerHTML = `<div style="overflow-x:auto;"><table class="table-tickets w-100">
        <thead><tr><th>Clave / Hora</th><th>Resumen / Reporter</th><th>Prioridad</th><th>Estado</th><th>Técnico</th><th>SLA</th><th>Acciones</th></tr></thead>
        <tbody>${tickets.map(t => _localTableRow(t)).join('')}</tbody>
    </table></div>`;
}

// ── Mis asignados (local) ─────────────────────────────────────────────────────
let _localMisAsigFilter = 'activos';
function misAsigFilter(f, el) {
    _localMisAsigFilter = f;
    document.querySelectorAll('#panel-misAsig .sa-pill').forEach(p=>p.classList.remove('active'));
    if(el) el.classList.add('active');
    if(LOCAL_VIEW) loadLocalMisAsig(); else loadMisAsig_jira();
}
async function loadLocalMisAsig() {
    const list  = document.getElementById('list-misAsig');
    const stats = document.getElementById('stats-misAsig');
    if (!list) return;
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    try {
        const r = await fetch(`/api/jira/local/mis-asig?filter=${_localMisAsigFilter}`, {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const s = j.stats || {};
        if (stats) stats.innerHTML = `
            <div class="stat-card"><div class="stat-val c-blue">${s.total||0}</div><div class="stat-lbl">Total</div></div>
            <div class="stat-card"><div class="stat-val c-green">${s.resolved||0}</div><div class="stat-lbl">Resueltos</div></div>
            <div class="stat-card"><div class="stat-val c-red">${s.breach||0}</div><div class="stat-lbl">SLA vencido</div></div>
            <div class="stat-card"><div class="stat-val c-amber">${s.critical||0}</div><div class="stat-lbl">SLA crítico</div></div>`;
        const badge = document.getElementById('badge-misAsig');
        if (badge) { const n=j.data.length; badge.textContent=n; badge.style.display=n?'':'none'; }
        _localList('list-misAsig', j.data, 'No tienes tickets asignados en este filtro');
    } catch(e) {
        if(list) list.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${e.message}</p></div>`;
    }
}
function loadMisAsig_jira() { /* stub para no romper en modo Jira — la función original se llama igual */ }

// ── Sin asignar (local) ───────────────────────────────────────────────────────
let _localSinAsigFilter = 'sin_asignar';
function sinAsigFilter(f, el) {
    _localSinAsigFilter = f;
    document.querySelectorAll('#panel-sinAsig .sa-pill').forEach(p=>p.classList.remove('active'));
    if(el) el.classList.add('active');
    if(LOCAL_VIEW) loadLocalSinAsig(); else loadSinAsig_jira();
}
async function loadLocalSinAsig() {
    const list  = document.getElementById('list-sinAsig');
    const stats = document.getElementById('stats-sinAsig');
    if (!list) return;
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    const sort = document.getElementById('sinAsigSort')?.value || 'DESC';
    try {
        const r = await fetch(`/api/jira/local/sin-asig?filter=${_localSinAsigFilter}&sort=${sort}`, {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const s = j.stats || {};
        if (stats) stats.innerHTML = `
            <div class="stat-card"><div class="stat-val c-blue">${s.total||0}</div><div class="stat-lbl">Total</div></div>
            <div class="stat-card"><div class="stat-val c-red">${s.breach||0}</div><div class="stat-lbl">SLA vencido</div></div>
            <div class="stat-card"><div class="stat-val c-amber">${s.critical||0}</div><div class="stat-lbl">SLA crítico</div></div>`;
        const badge = document.getElementById('badge-sinAsig');
        if (badge) { const n=j.data.length; badge.textContent=n; badge.style.display=n?'':'none'; }
        _localList('list-sinAsig', j.data, 'No hay tickets sin asignar');
    } catch(e) {
        if(list) list.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${e.message}</p></div>`;
    }
}
function loadSinAsig_jira() {}

// ── En Curso (local) ──────────────────────────────────────────────────────────
async function loadLocalEnCurso() {
    const list = document.getElementById('list-enCurso');
    if (!list) return;
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    try {
        const r = await fetch('/api/jira/local/en-curso', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        // Toolbar técnicos — IDs: enCursoTecRow, enCursoTecPills
        const tecRow   = document.getElementById('enCursoTecRow');
        const tecPills = document.getElementById('enCursoTecPills');
        if (j.techs?.length && tecRow && tecPills) {
            tecRow.style.display = 'flex';
            tecPills.innerHTML = j.techs.map(t=>`<button class="ec-tec-btn sa-pill" onclick="enCursoSetTecLocal(${t.id},this)">${t.name.split(' ')[0]}</button>`).join('');
        }
        const badge = document.getElementById('badge-enCurso');
        if (badge) { badge.textContent=j.total||0; badge.style.display=j.total?'':'none'; }
        _localList('list-enCurso', j.data, 'No hay tickets en curso');
    } catch(e) {
        if(list) list.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${e.message}</p></div>`;
    }
}
let _localEnCursoTecId = null;
function enCursoSetTecLocal(id, el) {
    _localEnCursoTecId = (_localEnCursoTecId === id) ? null : id;
    document.querySelectorAll('.ec-tec-btn').forEach(b=>b.classList.remove('active'));
    if (_localEnCursoTecId && el) el.classList.add('active');
    loadLocalEnCurso();
}

// ── Kanban (local) — target ID: kbBoard ──────────────────────────────────────
async function loadLocalKanban() {
    const board = document.getElementById('kbBoard');
    if (!board) return;
    board.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:12px;"><i class="bi bi-arrow-clockwise spin"></i> Cargando Kanban...</div>';
    try {
        const r = await fetch('/api/jira/local/kanban', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const COLS = [
            {key:'abierto',          label:'Abierto',     color:'#f59e0b'},
            {key:'asignado',         label:'Asignado',    color:'#3b82f6'},
            {key:'en_progreso',      label:'En Progreso', color:'#7c3aed'},
            {key:'pendiente_usuario',label:'Pendiente',   color:'#0891b2'},
            {key:'resuelto',         label:'Resuelto',    color:'#10b981'},
        ];
        board.innerHTML = COLS.map(col => {
            const tickets = j.data[col.key] || [];
            return `<div class="kb-col">
                <div class="kb-col-hdr" style="color:${col.color};border-bottom:2px solid ${col.color}20;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col.color};flex-shrink:0;"></span>
                    ${col.label} <span class="kb-col-cnt">${tickets.length}</span>
                </div>
                <div class="kb-col-body">
                    ${tickets.length ? tickets.map(t => {
                        const pc = {P1:'#ef4444',P2:'#f97316',P3:'#3b82f6',P4:'#94a3b8'}[t.priority]||'#64748b';
                        return `<div class="kb-card" onclick="openManage('${t.key}')">
                            <div class="kb-card-top"><span class="kb-key">${t.key}</span>
                                <span style="font-size:10px;font-weight:700;color:${pc};margin-left:auto;">${t.priority||'—'}</span></div>
                            <div class="kb-sum">${t.summary||'—'}</div>
                            <div class="kb-meta">
                                ${t.assigned_to_name ? `${techAvatar(t.assigned_to_name,18)}<span>${t.assigned_to_name.split(' ')[0]}</span>` : `<span style="color:#f59e0b;font-size:10px;">Sin asignar</span>`}
                                ${t.sla_status==='breach'?`<span style="margin-left:auto;font-size:9px;color:#ef4444;font-weight:700;">VENCIDO</span>`:''}
                            </div></div>`;
                    }).join('') : `<div class="kb-empty">Sin tickets</div>`}
                </div></div>`;
        }).join('');
    } catch(e) {
        board.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${e.message}</p></div>`;
    }
}

// ── Alertas (local) — targets: alrt-n-sla/p1/sin + alrt-body-sla/p1/sin ──────
async function loadAlertasPanelLocal() {
    try {
        const [alertsR, slaR, sinR, p1R] = await Promise.all([
            fetch('/api/jira/alerts?source=local', {credentials:'include'}).then(r=>r.json()),
            fetch('/api/jira/local/sla-panel', {credentials:'include'}).then(r=>r.json()),
            fetch('/api/jira/local/sin-asig?filter=sin_asignar', {credentials:'include'}).then(r=>r.json()),
            fetch('/api/jira/local/mis-asig?filter=activos', {credentials:'include'}).then(r=>r.json()),
        ]);

        // KPI numbers
        const d = alertsR.success ? alertsR.data : {};
        const _n = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val||0; };
        _n('alrt-n-sla',  d.slaPorVencer);
        _n('alrt-n-p1',   d.criticos);
        _n('alrt-n-sin',  d.sinAsignar);

        // Nav badge
        const total = (d.slaPorVencer||0)+(d.criticos||0)+(d.sinAsignar||0);
        const nb = document.getElementById('alertNavBadge');
        if (nb) { nb.textContent=total; nb.style.display=total?'':'none'; }

        // Update timestamp
        const upd = document.getElementById('alrt-lastupd');
        if (upd) upd.textContent = 'Local · ' + new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});

        // Ticket rows helper
        const _alrtRows = (tickets) => tickets && tickets.length
            ? tickets.slice(0,15).map(t => {
                const rem = t.sla_deadline ? new Date(t.sla_deadline).getTime()-Date.now() : null;
                const age = t.created ? ticketAge(t.created) : '—';
                const remLabel = rem===null?'':rem<0?`<span style="color:#ef4444;font-weight:700;">VENCIDO</span>`
                    :rem<3600000?`<span style="color:#f97316;">${Math.round(rem/60000)}min</span>`
                    :`<span style="color:#f59e0b;">${(rem/3600000).toFixed(1)}h</span>`;
                const pc = {P1:'#ef4444',P2:'#f97316',P3:'#3b82f6',P4:'#94a3b8'}[t.priority]||'#64748b';
                return `<div class="alrt-row" onclick="openManage('${t.key}')" style="cursor:pointer;">
                    <span class="alrt-key" style="color:#2563eb;">${t.key}</span>
                    <span style="font-size:10px;font-weight:700;color:${pc};flex-shrink:0;">${t.priority||'—'}</span>
                    <span style="flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.summary||'—'}</span>
                    <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;">${age}</span>
                    <span style="font-size:10px;flex-shrink:0;">${remLabel}</span>
                </div>`;
            }).join('')
            : `<div class="alrt-empty"><i class="bi bi-check2-circle"></i> Sin tickets en esta categoría</div>`;

        // SLA vencido section — from sla-panel breach tickets
        const slaTickets = slaR.success ? (slaR.data.tickets||[]).filter(t=>t.sla_status==='breach') : [];
        const bodySla = document.getElementById('alrt-body-sla');
        if (bodySla) bodySla.innerHTML = _alrtRows(slaTickets);

        // P1 críticos — filter activos by P1
        const p1Tickets = p1R.success ? (p1R.data||[]).filter(t=>t.priority==='P1') : [];
        const bodyP1 = document.getElementById('alrt-body-p1');
        if (bodyP1) bodyP1.innerHTML = _alrtRows(p1Tickets);

        // Sin asignar
        const sinTickets = sinR.success ? (sinR.data||[]) : [];
        const bodySin = document.getElementById('alrt-body-sin');
        if (bodySin) bodySin.innerHTML = _alrtRows(sinTickets);
    } catch(e) {}
}

// ── SLA Panel (local) — targets: slaKpis, slaTableWrap ────────────────────────
async function loadLocalSla() {
    try {
        const r = await fetch('/api/jira/local/sla-panel', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const {kpis, tickets} = j.data;

        const kEl = document.getElementById('slaKpis');
        if (kEl) kEl.innerHTML = `
            <div class="sla-kpi-card"><span class="sla-kpi-val" style="color:#10b981;">${kpis.pct||0}%</span><span class="sla-kpi-lbl">Cumplimiento SLA</span></div>
            <div class="sla-kpi-card"><span class="sla-kpi-val" style="color:#10b981;">${kpis.dentro_sla||0}</span><span class="sla-kpi-lbl">Dentro del SLA</span></div>
            <div class="sla-kpi-card"><span class="sla-kpi-val" style="color:#ef4444;">${kpis.fuera_sla||0}</span><span class="sla-kpi-lbl">Fuera del SLA</span></div>
            <div class="sla-kpi-card"><span class="sla-kpi-val" style="color:#f97316;">${kpis.breach_abiertos||0}</span><span class="sla-kpi-lbl">Vencidos abiertos</span></div>`;

        const slaBadge = document.getElementById('slaBadge');
        if (slaBadge) { slaBadge.textContent=kpis.breach_abiertos||0; slaBadge.style.display=kpis.breach_abiertos?'':'none'; }

        const wrap = document.getElementById('slaTableWrap');
        if (wrap) wrap.innerHTML = tickets.length ? `
            <table class="table-tickets w-100" style="font-size:12px;">
                <thead><tr><th>Ticket</th><th>Resumen</th><th>Prior.</th><th>Técnico</th><th>SLA</th></tr></thead>
                <tbody>${tickets.map(t => {
                    const rem   = t.sla_deadline ? new Date(t.sla_deadline).getTime()-Date.now() : null;
                    const color = rem===null?'#64748b':rem<0?'#ef4444':rem<1800000?'#f97316':rem<7200000?'#f59e0b':'#10b981';
                    const label = rem===null?'—':rem<0?`VENCIDO ${Math.round(-rem/60000)}min`:rem<3600000?`${Math.round(rem/60000)}min`:rem<86400000?`${(rem/3600000).toFixed(1)}h`:`${Math.round(rem/86400000)}d`;
                    const pc    = {P1:'#ef4444',P2:'#f97316',P3:'#3b82f6',P4:'#94a3b8'}[t.priority]||'#64748b';
                    return `<tr style="${rem!==null&&rem<0?'background:rgba(239,68,68,.04);':''}">
                        <td><span style="font-family:monospace;font-weight:700;color:#2563eb;cursor:pointer;" onclick="openManage('${t.key}')">${t.key}</span></td>
                        <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.summary||'—'}</td>
                        <td><span style="font-size:10px;font-weight:700;color:${pc};">${t.priority||'—'}</span></td>
                        <td style="font-size:11px;">${t.assigned_to_name||'<span style="color:#f59e0b;">Sin asignar</span>'}</td>
                        <td><span style="color:${color};font-weight:700;font-size:11px;">${label}</span></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>` : '<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;"></i><p>Sin tickets con SLA en riesgo</p></div>';
    } catch(e) {}
}

// ── Técnicos (local) — target: tecTableWrap, tecKpis ─────────────────────────
async function loadLocalTecStats() {
    try {
        const r = await fetch('/api/jira/local/stats', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const {techStats=[], summary={}} = j.data;

        // KPI strip
        const kEl = document.getElementById('tecKpis');
        if (kEl) kEl.innerHTML = `
            <div class="tec-kpi-card"><span style="font-size:20px;font-weight:800;color:#2563eb;">${summary.total||0}</span><span style="font-size:10px;color:var(--text-muted);">Total TK</span></div>
            <div class="tec-kpi-card"><span style="font-size:20px;font-weight:800;color:#f59e0b;">${summary.activos||0}</span><span style="font-size:10px;color:var(--text-muted);">Activos</span></div>
            <div class="tec-kpi-card"><span style="font-size:20px;font-weight:800;color:#10b981;">${summary.resueltos||0}</span><span style="font-size:10px;color:var(--text-muted);">Resueltos</span></div>
            <div class="tec-kpi-card"><span style="font-size:20px;font-weight:800;color:#7c3aed;">${summary.mttr||'—'}</span><span style="font-size:10px;color:var(--text-muted);">MTTR</span></div>`;

        // Table
        const wrap = document.getElementById('tecTableWrap');
        if (!wrap) return;
        if (!techStats.length) { wrap.innerHTML='<div class="empty-state"><p>Sin técnicos con actividad</p></div>'; return; }
        const ROW_COLORS = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2','#db2777'];
        wrap.innerHTML = `<table class="table-tickets w-100" style="font-size:12px;">
            <thead><tr><th>Técnico</th><th>Total</th><th>Activos</th><th>En Progreso</th><th>Resueltos</th><th>SLA %</th><th>MTTR</th></tr></thead>
            <tbody>${techStats.map((t,i) => {
                const slaOk=Number(t.sla_ok)||0,slaBad=Number(t.sla_bad)||0;
                const slaT=slaOk+slaBad,slaPct=slaT>0?Math.round(slaOk/slaT*100):100;
                const avgH=t.avg_min?(t.avg_min<60?Math.round(t.avg_min)+'min':(t.avg_min/60).toFixed(1)+'h'):'—';
                const color=ROW_COLORS[i%ROW_COLORS.length];
                const slaColor=slaPct>=80?'#10b981':slaPct>=60?'#f59e0b':'#ef4444';
                return `<tr>
                    <td><div style="display:flex;align-items:center;gap:8px;">
                        ${techAvatar(t.tech||'?',28)}
                        <div><div style="font-weight:600;">${t.tech||'—'}</div>
                        <div style="font-size:10px;color:var(--text-muted);">${t.email||''}</div></div>
                    </div></td>
                    <td style="font-weight:700;">${Number(t.total)||0}</td>
                    <td style="color:#f59e0b;font-weight:700;">${Number(t.open_tickets)||0}</td>
                    <td style="color:#7c3aed;font-weight:700;">${Number(t.in_progress)||0}</td>
                    <td style="color:#10b981;font-weight:700;">${Number(t.resolved)||0}</td>
                    <td><span style="color:${slaColor};font-weight:700;">${slaPct}%</span></td>
                    <td style="color:var(--text-muted);">${avgH}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    } catch(e) {}
}

// ── Heatmap (local) — targets: hmKpis, hmContent ─────────────────────────────
async function loadLocalHeatmap() {
    try {
        const r = await fetch('/api/jira/local/heatmap', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        const {cells=[],kpis={},byDay={}} = j.data;

        const kEl = document.getElementById('hmKpis');
        if (kEl) kEl.innerHTML = `
            <div class="hm-kpi-card"><span style="font-size:18px;font-weight:800;color:#2563eb;">${kpis.total||0}</span><span style="font-size:10px;color:var(--text-muted);">Total</span></div>
            <div class="hm-kpi-card"><span style="font-size:18px;font-weight:800;color:#f59e0b;">${kpis.activos||0}</span><span style="font-size:10px;color:var(--text-muted);">Activos</span></div>
            <div class="hm-kpi-card"><span style="font-size:18px;font-weight:800;color:#7c3aed;">${kpis.mttr_h||'—'}h</span><span style="font-size:10px;color:var(--text-muted);">MTTR</span></div>`;

        const content = document.getElementById('hmContent');
        if (!content) return;
        if (!cells.length) { content.innerHTML='<div class="empty-state"><p>Sin datos para el período</p></div>'; return; }

        const maxVal = Math.max(...cells.map(c=>Number(c.total)),1);
        const matrix = {};
        for (const c of cells) matrix[`${c.dow}-${c.hora}`] = Number(c.total);
        const DAYS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
        let html = `<div style="overflow-x:auto;"><div style="display:grid;grid-template-columns:36px repeat(24,minmax(22px,1fr));gap:2px;font-size:9px;min-width:640px;">`;
        html += `<div></div>` + Array.from({length:24},(_,h)=>`<div style="text-align:center;color:var(--text-muted);padding:1px 0;">${h}h</div>`).join('');
        for (let dow=1;dow<=7;dow++) {
            html += `<div style="display:flex;align-items:center;font-size:9px;color:var(--text-muted);padding-right:4px;justify-content:flex-end;">${DAYS[dow-1]}</div>`;
            for (let h=0;h<24;h++) {
                const v = matrix[`${dow}-${h}`]||0;
                const alpha = v>0 ? 0.12+v/maxVal*0.88 : 0.04;
                html += `<div style="background:rgba(37,99,235,${alpha.toFixed(2)});border-radius:2px;height:20px;display:flex;align-items:center;justify-content:center;font-size:8px;color:${alpha>0.5?'#fff':'var(--text-muted)'};" title="${DAYS[dow-1]} ${h}h: ${v} tickets">${v>0?v:''}</div>`;
            }
        }
        html += '</div></div>';
        content.innerHTML = html;
    } catch(e) {}
}

// ── Categorías (local) — target: list-sinCat, catStatsPills ──────────────────
async function loadLocalCategorias() {
    const list = document.getElementById('list-sinCat');
    const pills = document.getElementById('catStatsPills');
    try {
        const r = await fetch('/api/jira/local/categorias', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);

        if (pills && j.data.length) {
            const total = j.data.reduce((s,d)=>s+Number(d.total),0);
            pills.innerHTML = j.data.map(d => {
                const pct = total>0?Math.round(d.total/total*100):0;
                return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:12px;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.18);font-size:11px;font-weight:600;cursor:default;" title="${d.componente}">
                    ${d.categoria} <span style="font-size:10px;color:var(--text-muted);">${pct}%</span>
                </span>`;
            }).join('');
        }

        if (list) list.innerHTML = j.data.length ? `
            <table class="table-tickets w-100" style="font-size:12px;">
                <thead><tr><th>Categoría / Tipología</th><th>Componente</th><th>Total</th><th>Cerrados</th><th>MTTR</th></tr></thead>
                <tbody>${j.data.map(d=>`<tr>
                    <td><strong>${d.categoria}</strong></td>
                    <td style="color:var(--text-muted);">${d.componente}</td>
                    <td style="font-weight:700;">${d.total}</td>
                    <td style="color:#10b981;font-weight:700;">${d.cerrados||0}</td>
                    <td style="font-family:monospace;">${d.mttr_h||'—'}h</td>
                </tr>`).join('')}</tbody>
            </table>` : '<div class="empty-state"><p>Sin datos de categorías</p></div>';
    } catch(e) { if(list) list.innerHTML='<div class="empty-state"><p style="color:#ef4444;">Error cargando categorías</p></div>'; }
}

// ── Reportes (local) ──────────────────────────────────────────────────────────
function initLocalReportes() {
    if (typeof initReportes === 'function') initReportes();
}

// ── Polling de alertas en LOCAL_VIEW ─────────────────────────────────────────
// Badge IDs: alrt-n-sla (SLA vencido), alrt-n-p1 (P1 críticos), alrt-n-sin (sin asignar)
function startAlertPolling() {
    const _agentRoles = ['administrador','admin','agente','especialista','tecnico','supervisor'];
    if (typeof CURRENT_USER_ROLE !== 'undefined' && !_agentRoles.includes(CURRENT_USER_ROLE)) return;
    if (typeof LOCAL_VIEW !== 'undefined' && LOCAL_VIEW) {
        const poll = async () => {
            try {
                const r = await fetch('/api/jira/alerts?source=local', {credentials:'include'});
                const j = await r.json();
                if (!j.success) return;
                const d = j.data;
                const total = (d.criticos||0)+(d.slaPorVencer||0)+(d.sinAsignar||0);
                const nb = document.getElementById('alertNavBadge');
                if (nb) { nb.textContent=total; nb.style.display=total?'':'none'; }
                const _n = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val||0; };
                _n('alrt-n-sla', d.slaPorVencer);
                _n('alrt-n-p1',  d.criticos);
                _n('alrt-n-sin', d.sinAsignar);
            } catch(_){}
        };
        poll();
        setInterval(poll, 60000);
        return;
    }
    // Modo Jira — lógica original
    _startAlertPollingJira();
}
// (Jira alert polling defined below as _startAlertPollingJira)
const _INC_CACHE = {};
const _CACHE_TTL = 5 * 60 * 1000;
function _cacheGet(k) {
    const e = _INC_CACHE[k];
    if (!e) return null;
    if (Date.now() - e.ts > _CACHE_TTL) { delete _INC_CACHE[k]; return null; }
    return e.data;
}
function _cacheSet(k, d) { _INC_CACHE[k] = { data: d, ts: Date.now() }; }

async function _loadStatsJira() {
    const CKEY = 'stats-live';
    const cached = _cacheGet(CKEY);
    if (cached) {
        _renderStats(cached);
        fetch('/api/jira/stats-live', {credentials:'include'})
            .then(r=>r.json()).then(j=>{ if(j.success) _cacheSet(CKEY, j.data); }).catch(()=>{});
        return;
    }
    try {
        const r = await fetch('/api/jira/stats-live', {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        _cacheSet(CKEY, j.data);
        _renderStats(j.data);
    } catch(e) { showToast('Error cargando stats: '+e.message,'error'); }
}
function _renderStats(data) {
    const { byTech, slaStats, unassigned30, weekly, topReporters, topEquipos, topCategorias, evolucion, porPrioridad, porEstado, mttr, alertas, slaBreachTickets, mttrByCat, csat, fcr_pct } = data;

        // Alertas — desactivadas (info ya visible en KPI cards)

        // SLA cards — usar Number() para evitar concatenación de strings (MySQL devuelve SUM como string)
        const den = Number(slaStats?.dentro_sla) || 0;
        const fue = Number(slaStats?.fuera_sla)  || 0;
        const ven = Number(slaStats?.vencidos_abiertos) || 0;
        const tot = den + fue;
        const pct = tot > 0 ? Math.round(den / tot * 100) : 100;
        document.getElementById('kpiDentroSla').textContent = den;
        document.getElementById('kpiFueraSla').textContent  = fue;
        document.getElementById('kpiVencidosAbiertos').textContent = ven;
        document.getElementById('kpiSinAsignar30').textContent = unassigned30;
        document.getElementById('kpiPctSla').textContent = pct+'%';
        document.getElementById('kpiMttr').textContent = mttr || '—';

        // Gráficos
        _evolData = evolucion || [];
        try { renderEvolChart(_evolData, _chartPeriod); }         catch(ce) { console.warn('Chart evol:', ce.message); }
        try { renderSlaDonut(pct); }                              catch(ce) { console.warn('Chart sla:', ce.message); }
        try { renderEstadoHtml(porEstado, porPrioridad); }        catch(ce) { console.warn('Estado html:', ce.message); }
        try { renderBreachTable(slaBreachTickets); }       catch(ce) { console.warn('Breach table:', ce.message); }
        try { renderMttrCat(mttrByCat); }                  catch(ce) { console.warn('MTTR cat:', ce.message); }
        try { renderMetricBoxes(fcr_pct||0, csat||0); }    catch(ce) { console.warn('Metric boxes:', ce.message); }

        // Tabla por técnico
        try {
            const btwrap = document.getElementById('kpiByTechWrap');
            if (btwrap) btwrap.innerHTML = Array.isArray(byTech) && byTech.length
                ? `<table class="table-tickets w-100"><thead><tr><th>Especialista</th><th>Total</th><th>Resueltos</th><th>Activos</th><th>Tiempo prom.</th></tr></thead><tbody>
                    ${byTech.map(t=>{
                        const avg = t.avg_min ? (t.avg_min<60 ? Math.round(t.avg_min)+'min' : (t.avg_min/60).toFixed(1)+'h') : '—';
                        return`<tr><td><strong>${t.tech||'—'}</strong></td><td>${t.total}</td>
                        <td><span style="color:#10b981;font-weight:700;">${t.resolved||0}</span></td>
                        <td><span style="color:#f59e0b;font-weight:700;">${t.open||0}</span></td>
                        <td style="font-size:12px;color:var(--text-muted);">${avg}</td></tr>`;
                    }).join('')}</tbody></table>`
                : '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">Sin datos de asignación aún.</div>';
        } catch(e2) { console.error('byTech render error:', e2.message); }

        // Tabla semanal/mensual
        try {
            const wwrap = document.getElementById('kpiWeeklyWrap');
            if (wwrap) wwrap.innerHTML = Array.isArray(weekly) && weekly.length
                ? `<table class="table-tickets w-100"><thead><tr><th>Especialista</th><th>Esta semana</th><th>Este mes</th></tr></thead><tbody>
                    ${weekly.map(w=>`<tr><td><strong>${w.tech||'—'}</strong></td>
                    <td><span style="color:#0052CC;font-weight:700;">${w.semana||0}</span></td>
                    <td><span style="color:#7c3aed;font-weight:700;">${w.mes||0}</span></td></tr>`).join('')}
                    </tbody></table>`
                : '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">Sin datos aún.</div>';
        } catch(e2) { console.error('weekly render error:', e2.message); }

        // Rankings
        try {
            const rEl = document.getElementById('kpiTopReportersWrap');
            const eEl = document.getElementById('kpiTopEquiposWrap');
            const cEl = document.getElementById('kpiTopCatWrap');
            if (rEl) rEl.innerHTML = rankList(topReporters||[], 'reporter',    'total', '#ef4444');
            if (eEl) eEl.innerHTML = rankList(topEquipos||[],   'equipo_label','total', '#f59e0b');
            if (cEl) cEl.innerHTML = rankList(topCategorias||[],'summary',     'total', '#7c3aed');
        } catch(e2) { console.error('rankings render error:', e2.message); }
}

// ── Importar assignees desde CSV o texto libre ────────────
async function importAssigneesCsv() {
    const raw = (document.getElementById('csvAssigneeInput')?.value || '').trim();
    if (!raw) return showToast('Ingresa los datos primero', 'error');

    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rows = [];
    const INC_RE = /INC-\d+/i;
    const EMAIL_RE = /[\w.+-]+@[\w.-]+\.\w+/;

    // Detectar si hay encabezados (primera línea sin INC-)
    const startIdx = INC_RE.test(lines[0]) ? 0 : 1;

    if (startIdx === 1) {
        // Modo CSV con encabezados: detectar columnas
        const hdrs = lines[0].toLowerCase().split(/[,;\t]/);
        const colKey = hdrs.findIndex(h => h.includes('key') || h.includes('issue') || h.includes('ticket'));
        const colAss = hdrs.findIndex(h => h.includes('assign') || h.includes('email') || h.includes('tecn'));
        if (colKey >= 0 && colAss >= 0) {
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(/[,;\t]/).map(c => c.replace(/"/g,'').trim());
                const key = cols[colKey];
                const ass = cols[colAss];
                if (INC_RE.test(key) && ass) rows.push({ ticket_key: key.match(INC_RE)[0].toUpperCase(), assignee: ass });
            }
        }
    }

    // Modo texto libre: buscar INC-XXXX + email en cada línea (funciona siempre)
    if (!rows.length) {
        for (const line of lines) {
            const keyM = line.match(INC_RE);
            const emM  = line.match(EMAIL_RE);
            if (keyM && emM) rows.push({ ticket_key: keyM[0].toUpperCase(), assignee: emM[0] });
        }
    }

    if (!rows.length) return showToast('No se encontraron pares INC-XXXX + email válidos', 'error');

    try {
        const r = await fetch('/api/jira/import-assignees', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast(`${j.message}${j.skipped ? ` · ${j.skipped} omitidos` : ''}`, 'success');
        document.getElementById('modalImportAssignees').style.display = 'none';
        document.getElementById('csvAssigneeInput').value = '';
        loadStats();
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ── Sync assignees desde Jira ─────────────────────────────
async function syncJiraAssignees() {
    const btn = document.getElementById('btnSyncAssignees');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Sincronizando...'; }
    try {
        const r = await fetch('/api/jira/sync-assignees', { method:'POST', credentials:'include' });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast(`${j.message}`, 'success');
        if (j.updated > 0) loadStats();
    } catch(e) {
        showToast('Error al sincronizar: '+e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Sincronizar técnicos Jira'; }
    }
}

// ── Alertas polling automático (cada 60s) ────────────────────────────────────
let _alertPoll = null, _alertFails = 0;
let _alertCounts = { slaPorVencer: 0, criticos: 0, sinAsignar: 0 };
let _prevAlertCritical = -1;
let _notifiedBreachKeys = new Set();

function _applyAlertBadges(data) {
    const { slaPorVencer, criticos, sinAsignar, breachKeys = [] } = data;
    _alertCounts = data;

    // Badge rojo en nav Alertas (SLA breach + P1 críticos)
    const critical = slaPorVencer + criticos;
    const badge = document.getElementById('alertNavBadge');
    if (badge) {
        badge.textContent = critical || '';
        badge.style.display = critical ? 'inline' : 'none';
        badge.style.background = slaPorVencer > 0 ? '#ef4444' : '#f97316';
    }
    // Badge azul en Sin asignar
    const bSin = document.getElementById('badge-sinAsig');
    if (bSin && bSin.textContent === '—') {
        bSin.textContent = sinAsignar || '—';
    }
    // Toast solo cuando aumenta el número crítico
    if (critical > _prevAlertCritical && _prevAlertCritical >= 0) {
        const delta = critical - _prevAlertCritical;
        showToast(`🔴 ${delta} alerta${delta>1?'s':''} nueva${delta>1?'s':''} — ${slaPorVencer > 0 ? 'SLA vencido' : 'P1 crítico'}`, 'error');
    }
    _prevAlertCritical = critical;

    // Actualizar KPIs del panel si está visible
    const nSla = document.getElementById('alrt-n-sla');
    const nP1  = document.getElementById('alrt-n-p1');
    const nSin = document.getElementById('alrt-n-sin');
    if (nSla) nSla.textContent = slaPorVencer;
    if (nP1)  nP1.textContent  = criticos;
    if (nSin) nSin.textContent = sinAsignar;

    // Notificaciones de navegador por ticket en breach (una sola vez por ticket)
    if (Notification.permission === 'granted' && breachKeys.length) {
        const nuevos = breachKeys.filter(k => k && !_notifiedBreachKeys.has(k));
        nuevos.forEach(k => {
            _notifiedBreachKeys.add(k);
            try {
                new Notification('⚡ SLA Vencido — ' + k, {
                    body: 'Este ticket ha superado su tiempo de resolución.',
                    icon: '/images/movistar-logo.png',
                    tag: 'breach-' + k,
                    requireInteraction: false
                });
            } catch(_) {}
        });
    }
}

function _startAlertPollingJira() {
    if (_alertPoll) return;
    _alertFails = 0;
    // Solicitar permiso de notificaciones al iniciar (requiere gesto de usuario previo)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
    const tick = async () => {
        try {
            const r = await fetch('/api/jira/alerts', {credentials:'include'});
            const j = await r.json();
            _alertFails = 0;
            if (j.success) _applyAlertBadges(j.data);
        } catch(e) {
            if (++_alertFails >= 5) { clearInterval(_alertPoll); _alertPoll = null; }
        }
    };
    tick(); // fire immediately
    _alertPoll = setInterval(tick, 60000);
}

// ── Panel Alertas — carga tickets desde Jira ──────────────────────────────────
let _alertPanelLoading = false;
async function loadAlertasPanel(force) {
    if (_alertPanelLoading && !force) return;
    _alertPanelLoading = true;

    const upd = document.getElementById('alrt-lastupd');
    if (upd) upd.textContent = 'Actualizando…';

    const _alrtRow = (issue) => {
        const f   = issue.fields || {};
        const key = issue.key;
        const sum = incEsc(f.summary || '—');
        const cre = f.created ? new Date(f.created) : null;
        const age = cre ? _alrtAge(Date.now() - cre.getTime()) : '—';
        const asgn = f.assignee?.displayName || f.assignee?.emailAddress || 'Sin asignar';
        return `<div class="alrt-row">
          <span class="alrt-key" onclick="window.open('https://integratelperu.atlassian.net/browse/${key}','_blank')" style="cursor:pointer;">${key}</span>
          <span class="alrt-sum" title="${sum}">${sum}</span>
          <span class="alrt-age">${incEsc(asgn.split(' ').slice(0,2).join(' '))} · ${age}</span>
        </div>`;
    };

    const _alrtFill = async (bodyId, jql) => {
        const el = document.getElementById(bodyId);
        if (!el) return 0;
        try {
            const d = await jira('POST', '/rest/api/3/search/jql', {
                jql, fields: ['summary','assignee','created','priority'], maxResults: 50
            });
            const issues = d.issues || [];
            el.innerHTML = issues.length
                ? issues.map(_alrtRow).join('')
                : `<div class="alrt-empty"><i class="bi bi-check2-circle"></i> Sin tickets en esta categoría</div>`;
            return issues.length;
        } catch(e) {
            el.innerHTML = `<div class="alrt-loading" style="color:#ef4444;">${incEsc(e.message)}</div>`;
            return 0;
        }
    };

    const _alrtCola = document.getElementById('alrtFilterCola')?.value || 'wp';
    const _alrtComp = _alrtCola === 'wp' ? ' AND "Tipo de Componente" = Workplace' : '';
    const BASE = `project = INC${_alrtComp} AND status not in ("Resuelto","Cerrado","Resolved","Closed","Done","Completado")`;
    const [nSla, nP1, nSin] = await Promise.all([
        _alrtFill('alrt-body-sla', `${BASE} AND created <= "-8h" ORDER BY created ASC`),
        _alrtFill('alrt-body-p1',  `${BASE} AND priority in (Highest,P1,Critical) ORDER BY created ASC`),
        _alrtFill('alrt-body-sin', `${BASE} AND assignee is EMPTY AND created <= "-30m" ORDER BY created ASC`),
    ]);

    // Actualizar KPIs y badge con datos de Jira (más precisos que DB)
    _applyAlertBadges({ slaPorVencer: nSla, criticos: nP1, sinAsignar: nSin });

    if (upd) upd.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit'});
    _alertPanelLoading = false;
}

function _alrtAge(ms) {
    if (ms < 60000) return '<1min';
    if (ms < 3600000) return Math.floor(ms/60000)+'min';
    if (ms < 86400000) return Math.floor(ms/3600000)+'h';
    return Math.floor(ms/86400000)+'d';
}

function toggleAlrtSection(bodyId, hdr) {
    const body = document.getElementById(bodyId);
    const chev = hdr?.querySelector('.alrt-chev');
    if (!body) return;
    const collapsed = body.classList.toggle('collapsed');
    if (chev) chev.classList.toggle('open', !collapsed);
}

// ── Reportes avanzados ────────────────────────────────────
let _reportData = [];
async function exportReport(format) {
    const estado   = document.getElementById('rptEstado').value;
    const prioridad= document.getElementById('rptPrioridad').value;
    const desde    = document.getElementById('rptDesde').value;
    const hasta    = document.getElementById('rptHasta').value;
    const q        = document.getElementById('rptQ').value;
    const params   = new URLSearchParams({ estado, prioridad, desde, hasta, q });
    try {
        showToast('Generando reporte...','success');
        const r = await fetch(`/api/jira/report?${params}`, {credentials:'include'});
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        _reportData = j.data;
        // Mostrar preview
        const wrap = document.getElementById('rptResultWrap');
        wrap.style.display = 'block';
        document.getElementById('rptTable').innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${j.total} registros encontrados</div>
        <div style="overflow-x:auto;max-height:320px;"><table class="table-tickets w-100">
        <thead><tr><th>Clave</th><th>Resumen</th><th>Reporter</th><th>Prioridad</th><th>Estado</th><th>Técnico</th><th>Fecha</th></tr></thead>
        <tbody>${j.data.slice(0,50).map(t=>`<tr>
            <td><span class="ticket-key">${t.ticket_key}</span></td>
            <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.summary}</td>
            <td style="font-size:11px;">${t.reporter||'—'}</td>
            <td>${prioBadge(t.priority||'P3')}</td>
            <td>${istBadge(t.internal_status||'abierto')}</td>
            <td style="font-size:11px;">${t.assigned_to_name||'Sin asignar'}</td>
            <td style="font-size:11px;">${t.created_at?new Date(t.created_at).toLocaleDateString('es-PE'):'—'}</td>
        </tr>`).join('')}${j.total>50?`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);font-size:11px;">...y ${j.total-50} más. Exporta para ver todos.</td></tr>`:''}</tbody></table></div>`;
        if (format === 'excel') {
            if (!_reportData?.length) { showToast('Primero haz una búsqueda','error'); return; }
            exportToExcel(_reportData);
        }
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

function exportToExcel(data) {
    if (!data?.length) { showToast('Sin datos para exportar','error'); return; }
    const cols = ['ticket_key','summary','reporter','priority','internal_status','assigned_to_name','created_at','resolved_at','tipo_atencion','component','tipologia'];
    const header = ['Clave','Resumen','Reporter','Prioridad','Estado','Técnico','Creado','Resuelto','Tipo atención','Componente','Tipología'];
    const esc = v => `"${String(v||'').replace(/"/g,'""')}"`;
    const rows = data.map(r => cols.map(c => esc(r[c])));
    const csv = [header.map(esc), ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reporte_itsm_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    showToast('CSV generado','success');
}

function openSendReport() {
    const desde = document.getElementById('rptDesde').value;
    const hasta  = document.getElementById('rptHasta').value;
    document.getElementById('rptAsunto').value = `Reporte ITSM${desde?' — '+desde:''}${hasta?' al '+hasta:''}`;
    new bootstrap.Modal(document.getElementById('modalSendReport')).show();
}

async function sendReport() {
    const to     = document.getElementById('rptEmail').value.trim();
    const asunto = document.getElementById('rptAsunto').value.trim();
    const desde  = document.getElementById('rptDesde').value;
    const hasta  = document.getElementById('rptHasta').value;
    if (!to) { showToast('Ingresa un destinatario','error'); return; }
    try {
        const r = await fetch('/api/jira/report/send-email', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ to, asunto, desde, hasta })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        showToast(`✅ Reporte enviado a ${to} (${j.total} registros)`,'success');
        bootstrap.Modal.getInstance(document.getElementById('modalSendReport'))?.hide();
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ── Software catalog autocompletado ──────────────────────
let _swTimer = null;
function rcatCheckSoftware(sel) {
    const isSw = sel.value.includes('Software');
    document.getElementById('rcatSoftwareWrap').style.display = isSw ? 'block' : 'none';
    if (!isSw) { document.getElementById('rcat_software_input').value=''; document.getElementById('rcat_software_id').value=''; document.getElementById('rcatSoftwareBadge').style.display='none'; }
}
function acSoftware(q) {
    clearTimeout(_swTimer);
    if (!q || q.length < 1) { hideAc('acSoftwareDrop'); return; }
    _swTimer = setTimeout(async () => {
        try {
            const r = await fetch(`/api/jira/software-catalog?q=${encodeURIComponent(q)}`, {credentials:'include'});
            const j = await r.json();
            const d = document.getElementById('acSoftwareDrop');
            if (!j.data?.length) {
                d.innerHTML=`<div class="ac-item" onclick="addNewSoftware('${q.replace(/'/g,'&#39;')}')"><i class="bi bi-plus-circle" style="color:#0052CC;"></i> <span style="color:#0052CC;font-weight:600;">Agregar "${q}"</span></div>`;
                d.classList.add('show'); return;
            }
            d.innerHTML = j.data.map(s=>`<div class="ac-item" onclick="pickSoftware(${s.id},'${s.nombre.replace(/'/g,"&#39;")}','${(s.version||'').replace(/'/g,"&#39;")}')">
                <span class="ac-email">${s.nombre}</span>
                <span class="ac-details">${[s.fabricante,s.version].filter(Boolean).join(' · ')||'—'}</span>
            </div>`).join('');
            d.innerHTML += `<div class="ac-item" style="border-top:1px solid var(--border-soft);" onclick="addNewSoftware('${q.replace(/'/g,"&#39;")}')"><i class="bi bi-plus-circle" style="color:#0052CC;"></i> <span style="color:#0052CC;font-size:12px;">Agregar "${q}" como nuevo</span></div>`;
            d.classList.add('show');
        } catch(e) {}
    }, 250);
}
function pickSoftware(id, nombre, version) {
    document.getElementById('rcat_software_id').value = id;
    document.getElementById('rcat_software_input').value = nombre;
    document.getElementById('rcatSoftwareBadgeText').textContent = nombre + (version?' v'+version:'');
    document.getElementById('rcatSoftwareBadge').style.display = 'block';
    hideAc('acSoftwareDrop');
}
async function addNewSoftware(nombre) {
    hideAc('acSoftwareDrop');
    try {
        const r = await fetch('/api/jira/software-catalog', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ nombre })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        pickSoftware(j.data.id, j.data.nombre, '');
        showToast(j.nuevo ? `✅ "${nombre}" agregado al catálogo` : `"${nombre}" ya existía`, 'success');
    } catch(e) { showToast('Error: '+e.message,'error'); }
}
function clearSoftwareSel() {
    document.getElementById('rcat_software_id').value='';
    document.getElementById('rcat_software_input').value='';
    document.getElementById('rcatSoftwareBadge').style.display='none';
}

// ── Filtros persistentes (localStorage) ──────────────────
function savePersistentFilters() {
    localStorage.setItem('itsm_pill', activePill);
    localStorage.setItem('itsm_search', document.getElementById('searchInput')?.value||'');
}
function restorePersistentFilters() {
    const pill   = localStorage.getItem('itsm_pill')||'all';
    const search = localStorage.getItem('itsm_search')||'';
    activePill = pill;
    const si = document.getElementById('searchInput');
    if (si) si.value = search;
    document.querySelectorAll('.pill').forEach(p=>{
        const v = p.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        p.classList.toggle('active', v===pill);
    });
}
document.addEventListener('DOMContentLoaded', () => {
    // Apply local-view function patches (LOCAL_VIEW is now defined by inline EJS script)
    if (typeof LOCAL_VIEW !== 'undefined' && LOCAL_VIEW) {
        loadMisAsig        = function(f) { loadLocalMisAsig(f); };
        loadSinAsig        = function(f) { loadLocalSinAsig(f); };
        loadEnCurso        = function()  { loadLocalEnCurso(); };
        loadKanban         = function()  { loadLocalKanban(); };
        loadAlertasPanel   = function()  { loadAlertasPanelLocal(); };
        loadSlaPanel       = function()  { loadLocalSla(); };
        loadTecStats       = function()  { loadLocalTecStats(); };
        loadHeatmap        = function()  { loadLocalHeatmap(); };
        loadSinCategorizar = function()  { loadLocalCategorias(); };
        autoLoadHistorico  = function()  {};
    }
    restorePersistentFilters();
    startAlertPolling();
    // Auto-refresh tickets cada 2 min — solo si el servidor responde
    let _ticketPollFails = 0;
    const _ticketInterval = setInterval(async () => {
        if (!allTickets.length) return;
        try { await loadTickets(); _ticketPollFails = 0; }
        catch(e) { if (++_ticketPollFails >= 3) clearInterval(_ticketInterval); }
    }, 120000);
    // Reiniciar pollers cuando la pestaña vuelve a estar activa
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            startAlertPolling();
            if (allTickets.length) loadTickets();
        }
    });
});

// ── Categorías ────────────────────────────────────────────
let allCategories=[];
let selectedCategory=null;

async function loadCategories(){
    try{
        const r=await fetch('/api/jira/categories',{credentials:'include'});
        const j=await r.json();
        allCategories=j.data||[];
        renderCategoryTiles();
    }catch(e){
        const w=document.getElementById('categoryTiles');
        if(w) w.innerHTML='<span style="font-size:12px;color:var(--text-muted);">Sin categorías — <button class="btn-outline-sm" onclick="openCategoryManager()"><i class="bi bi-plus"></i> Agregar</button></span>';
    }
}
function renderCategoryTiles(){
    const w=document.getElementById('categoryTiles');
    if(!w) return;
    if(!allCategories.length){
        w.innerHTML='<span style="font-size:12px;color:var(--text-muted);">Sin categorías — <button class="btn-outline-sm" onclick="openCategoryManager()"><i class="bi bi-plus"></i> Crear primera</button></span>';
        return;
    }
    w.innerHTML=allCategories.map(c=>`<button class="cat-tile" data-id="${c.id}" onclick="selectCategory(${c.id})"><i class="bi ${c.icon||'bi-tag'}"></i> ${c.name}</button>`).join('');
    // Restore active if any
    if(selectedCategory) document.querySelectorAll('.cat-tile').forEach(t=>t.classList.toggle('active',parseInt(t.dataset.id)===selectedCategory.id));
}
function selectCategory(id){
    selectedCategory=allCategories.find(c=>c.id===id)||null;
    if(!selectedCategory) return;
    document.querySelectorAll('.cat-tile').forEach(t=>t.classList.toggle('active',parseInt(t.dataset.id)===id));
    if(selectedCategory.component_id) document.getElementById('f_component').value=selectedCategory.component_id;
    if(selectedCategory.app_id)       document.getElementById('f_app').value=selectedCategory.app_id;
    if(selectedCategory.tipologia_id) document.getElementById('f_tipologia').value=selectedCategory.tipologia_id;
    if(selectedCategory.impact_id)    document.getElementById('f_impact').value=selectedCategory.impact_id;
    if(selectedCategory.urgency_id)   document.getElementById('f_urgency').value=selectedCategory.urgency_id;
    updateAdvancedPreview();
    autoFillDescription();
}
function autoFillDescription(){
    const summary=document.getElementById('f_summary').value.trim();
    const template=selectedCategory?.description_template||'';
    let desc='';
    if(template)      desc=template.replace(/\{summary\}/gi,summary||selectedCategory.name);
    else if(summary)  desc=`Problemas con ${summary}.`;
    else if(selectedCategory) desc=`Problemas con ${selectedCategory.name}.`;
    document.getElementById('f_description').value=desc;
}
function updateAdvancedPreview(){
    const ids=['f_component','f_app','f_tipologia'];
    const tags=ids.map(id=>{const el=document.getElementById(id);return el.value?el.options[el.selectedIndex].text:null;}).filter(Boolean);
    document.getElementById('advancedPreview').innerHTML=tags.map(t=>`<span style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:4px;padding:1px 7px;font-size:10px;color:var(--text-muted);">${t}</span>`).join('');
}

// ── Category Manager ──────────────────────────────────────
function openCategoryManager(){
    const m=bootstrap.Modal.getInstance(document.getElementById('modalCreate'));
    if(m) m.hide();
    resetCatForm();
    loadCatList();
    new bootstrap.Modal(document.getElementById('modalCategories')).show();
}
async function loadCatList(){
    const w=document.getElementById('catListWrap');
    try{
        const r=await fetch('/api/jira/categories',{credentials:'include'});
        const j=await r.json();
        if(!j.data||!j.data.length){w.innerHTML='<div style="font-size:12px;color:var(--text-muted);padding:8px 0 4px;">No hay categorías. Crea la primera abajo.</div>';return;}
        w.innerHTML=`<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:4px;">${j.data.map(c=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1.5px solid var(--border-soft);border-radius:8px;background:var(--bg-card);">
                <div style="display:flex;align-items:center;gap:10px;">
                    <i class="bi ${c.icon||'bi-tag'}" style="color:#7c6ff7;font-size:17px;width:20px;text-align:center;"></i>
                    <div>
                        <div style="font-weight:600;font-size:13px;">${c.name}</div>
                        <div style="font-size:11px;color:var(--text-muted);">${[c.component_label,c.app_label,c.tipologia_label].filter(Boolean).join(' · ')||'Sin mapeo'}</div>
                    </div>
                </div>
                <div style="display:flex;gap:6px;">
                    <button class="btn-outline-sm" onclick="editCat(${c.id})"><i class="bi bi-pencil"></i></button>
                    <button class="btn-outline-sm" style="border-color:#fca5a5;color:#dc2626;" onclick="deleteCat(${c.id})"><i class="bi bi-trash"></i></button>
                </div>
            </div>`).join('')}</div>`;
        allCategories=j.data;
    }catch(e){w.innerHTML='<div style="color:var(--danger);font-size:12px;">Error cargando categorías</div>';}
}
function editCat(id){
    const c=allCategories.find(x=>x.id===id);
    if(!c) return;
    document.getElementById('catEditId').value=c.id;
    document.getElementById('cat_name').value=c.name||'';
    document.getElementById('cat_icon').value=c.icon||'';
    document.getElementById('cat_desc_template').value=c.description_template||'';
    const setSelect=(selId,val)=>{if(!val)return;const el=document.getElementById(selId);for(const o of el.options){if(o.value.startsWith(val)){o.selected=true;break;}}};
    setSelect('cat_component',c.component_id);
    setSelect('cat_app',c.app_id);
    setSelect('cat_tipologia',c.tipologia_id);
    setSelect('cat_urgency',c.urgency_id);
    document.getElementById('catFormTitle').innerHTML=`<i class="bi bi-pencil"></i> Editando: ${c.name}`;
    document.getElementById('catSaveLabel').textContent='Actualizar';
}
async function deleteCat(id){
    if(!confirm('¿Eliminar esta categoría?')) return;
    await fetch(`/api/jira/categories/${id}`,{method:'DELETE',credentials:'include'});
    await loadCatList();
    renderCategoryTiles();
}
function resetCatForm(){
    document.getElementById('catEditId').value='';
    ['cat_name','cat_icon','cat_desc_template'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('cat_component').value='';
    document.getElementById('cat_app').value='';
    document.getElementById('cat_tipologia').value='ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11379|Sin acceso al sistema';
    document.getElementById('cat_urgency').value='618441|El error no me impide trabajar';
    document.getElementById('catFormTitle').innerHTML='<i class="bi bi-plus-circle"></i> Nueva Categoría';
    document.getElementById('catSaveLabel').textContent='Guardar';
}
async function saveCat(){
    const name=document.getElementById('cat_name').value.trim();
    if(!name){showToast('El nombre es requerido','error');return;}
    const icon=document.getElementById('cat_icon').value.trim();
    const desc=document.getElementById('cat_desc_template').value.trim();
    const editId=document.getElementById('catEditId').value;
    const parseField=id=>{const v=document.getElementById(id).value;if(!v) return{id:null,label:null};const[fid,...rest]=v.split('|');return{id:fid,label:rest.join('|')};};
    const comp=parseField('cat_component'),app=parseField('cat_app'),tipo=parseField('cat_tipologia'),urg=parseField('cat_urgency');
    const body={name,icon:icon||'bi-tag',component_id:comp.id,component_label:comp.label,app_id:app.id,app_label:app.label,tipologia_id:tipo.id,tipologia_label:tipo.label,urgency_id:urg.id,urgency_label:urg.label,description_template:desc};
    const method=editId?'PUT':'POST';
    const url=editId?`/api/jira/categories/${editId}`:'/api/jira/categories';
    const r=await fetch(url,{method,credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();
    if(!j.success){showToast('Error: '+j.message,'error');return;}
    showToast(editId?'Categoría actualizada':'Categoría creada','success');
    resetCatForm();
    await loadCatList();
    renderCategoryTiles();
}

// ── Crear ticket ──────────────────────────────────────────
function openCreateModal(){
    document.getElementById('createResult').style.display='none';
    ['f_summary','f_reporter','f_description'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('f_phone').value='-';
    document.getElementById('f_component').value='ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277';
    document.getElementById('f_app').value='ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11280';
    document.getElementById('f_tipologia').value='ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11379';
    document.getElementById('f_impact').value='618437';
    document.getElementById('f_urgency').value='618441';
    selectedCategory=null;
    document.getElementById('advancedSection').removeAttribute('open');
    updateAdvancedPreview();
    clearFile();
    loadCategories();
    new bootstrap.Modal(document.getElementById('modalCreate')).show();
    setTimeout(()=>document.getElementById('f_reporter').focus(),350);
}
function handleFileSelect(input){if(input.files&&input.files[0]){const f=input.files[0];document.getElementById('uploadFileName').textContent=f.name+` (${(f.size/1024).toFixed(1)} KB)`;document.getElementById('uploadPreview').style.display='flex';document.getElementById('uploadZone').style.borderColor='var(--success)';}}
function clearFile(){document.getElementById('f_attachment').value='';document.getElementById('uploadPreview').style.display='none';document.getElementById('uploadZone').style.borderColor='var(--border-soft)';}
function setupDragDrop(){const z=document.getElementById('uploadZone');if(!z)return;z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('dragover');});z.addEventListener('dragleave',()=>z.classList.remove('dragover'));z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('dragover');if(e.dataTransfer.files.length){document.getElementById('f_attachment').files=e.dataTransfer.files;handleFileSelect(document.getElementById('f_attachment'));}});}
async function submitTicket(){
    const summary=document.getElementById('f_summary').value.trim();
    const reporter=document.getElementById('f_reporter').value.trim();
    const phone=document.getElementById('f_phone').value.trim()||'-';
    const description=document.getElementById('f_description').value.trim();
    const component=document.getElementById('f_component').value;
    const app=document.getElementById('f_app').value;
    const tipologia=document.getElementById('f_tipologia').value;
    const impact=document.getElementById('f_impact').value;
    const urgency=document.getElementById('f_urgency').value;
    const fileInput=document.getElementById('f_attachment');
    if(!summary){showToast('El resumen es obligatorio','error');return;}
    if(!reporter){showToast('El correo del usuario es obligatorio','error');return;}
    if(!component){showToast('Selecciona el componente (opciones avanzadas)','error');return;}
    if(!app){showToast('Selecciona la aplicación (opciones avanzadas)','error');return;}
    if(!tipologia){showToast('Selecciona la tipología (opciones avanzadas)','error');return;}
    const btn=document.getElementById('btnSubmit');
    btn.disabled=true;btn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Creando...';
    try{
        let attachmentId=null;
        if(fileInput.files.length) attachmentId=await uploadJiraAttachment(fileInput.files[0]);
        const finalDesc=description||`Problemas con ${summary}.`;
        const res=await fetch('/api/jira/ticket',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary,reporter,phone,description:finalDesc,component,app,tipologia,impact,urgency,attachmentId})});
        const json=await res.json();
        if(!json.success)throw new Error(json.message||json.details);
        document.getElementById('createdKey').textContent=json.data.key;
        document.getElementById('createdUrl').href=json.data.url;
        document.getElementById('createResult').style.display='block';
        document.getElementById('createResult').classList.add('flash-new');
        showToast(`✅ Ticket ${json.data.key} creado exitosamente`,'success');
        loadTickets();
    }catch(err){showToast('Error: '+err.message,'error');}
    finally{btn.disabled=false;btn.innerHTML='<i class="bi bi-send-fill"></i> Crear Incidencia';}
}
async function uploadJiraAttachment(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/jira/attachment', {
        method: 'POST',
        credentials: 'include',
        body: fd
    });
    const j = await r.json();
    if (!j.success) throw new Error('Error subiendo adjunto: ' + j.message);
    return j.attachmentId;
}

// ── Cerrar ticket ─────────────────────────────────────────
window._wpCatOptions = [];
window._catTransitionId = null;
function _loadWpOptions(key, padreElId, hijoElId) {
    const padreEl=document.getElementById(padreElId);
    const hijoEl=document.getElementById(hijoElId);
    if(!padreEl) return;
    padreEl.innerHTML='<option value="">Cargando…</option>';
    padreEl.disabled=true;
    if(hijoEl){hijoEl.innerHTML='<option value="">—</option>';hijoEl.disabled=true;}
    fetch(`/api/jira/ticket/${key}/wp-categories`,{credentials:'include'})
        .then(r=>r.json())
        .then(data=>{
            window._wpCatOptions=data.options||[];
            window._catTransitionId=data._transId||null;
            padreEl.innerHTML='<option value="">Ninguno</option>'+
                window._wpCatOptions.map(o=>`<option value="${o.value}">${o.value}</option>`).join('');
            padreEl.disabled=false;
            padreEl.onchange=()=>_updateWpHijo(padreElId,hijoElId);
            _updateWpHijo(padreElId,hijoElId);
            document.getElementById('btnCatSubmit').disabled=false;
            document.getElementById('btnCatSubmit').style.opacity='1';
        })
        .catch(()=>{
            padreEl.innerHTML='<option value="">Ninguno</option>';
            padreEl.disabled=false;
        });
}
function _updateWpHijo(padreElId, hijoElId){
    const padreEl=document.getElementById(padreElId);
    const hijoEl=document.getElementById(hijoElId);
    if(!padreEl||!hijoEl) return;
    const opt=(window._wpCatOptions||[]).find(o=>o.value===padreEl.value);
    const children=opt?.children||[];
    if(!children.length){
        hijoEl.innerHTML='<option value="">—</option>';hijoEl.disabled=true;
    } else {
        hijoEl.innerHTML='<option value="">Ninguno</option>'+children.map(c=>`<option value="${c.value}">${c.value}</option>`).join('');
        hijoEl.disabled=false;
    }
}
let _catCurrentKey='';
function openCategorizeModal(key){
    _catCurrentKey=key;
    const lbl=document.getElementById('catKeyLabel');
    if(lbl) lbl.textContent=key;
    const catRes=document.getElementById('catResult');
    if(catRes) catRes.style.display='none';
    const btn=document.getElementById('btnCatSubmit');
    if(btn){btn.disabled=true;btn.style.opacity='.6';btn.style.display='flex';btn.innerHTML='<i class="bi bi-check2-circle"></i> Guardar categoría';}
    document.getElementById('btnCatOmitir').textContent='Omitir';
    new bootstrap.Modal(document.getElementById('modalCategorize')).show();
    _loadWpOptions(key,'catWpPadre','catWpHijo');
}
async function submitCategorize(){
    const padre=document.getElementById('catWpPadre')?.value||'';
    const hijo=document.getElementById('catWpHijo')?.value||'';
    if(!padre) return;
    const btn=document.getElementById('btnCatSubmit');
    btn.disabled=true;btn.style.opacity='.7';
    btn.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Guardando…';
    const catRes=document.getElementById('catResult');
    try{
        const res=await fetch(`/api/jira/ticket/${_catCurrentKey}/wp-category`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({resultado_padre:padre,resultado_hijo:hijo,transitionId:window._catTransitionId})});
        const json=await res.json();
        if(!json.success) throw new Error(json.message);
        catRes.style.cssText='display:block;background:var(--step2-bg);border:1px solid var(--step2-border);color:var(--step2-color);padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;';
        catRes.innerHTML=`<i class="bi bi-check-circle-fill me-2"></i>${json.message}`;
        btn.style.display='none';
        document.getElementById('btnCatOmitir').textContent='Cerrar';
        showToast(`Categoría guardada: ${padre}${hijo?' > '+hijo:''}`, 'success');
        // Actualizar badge en DOM sin recargar
        _updateWpBadgeInDOM(_catCurrentKey, padre, hijo);
        // Quitar de la lista de sin categorizar
        if (Array.isArray(_sinCatAll)) {
            _sinCatAll = _sinCatAll.filter(i => i.key !== _catCurrentKey);
            _sinCatBuildPills();
            _sinCatApply();
        }
    }catch(err){
        catRes.style.cssText='display:block;background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;';
        catRes.innerHTML=`<i class="bi bi-x-circle-fill me-2"></i>${err.message}`;
        btn.disabled=false;btn.style.opacity='1';
        btn.innerHTML='<i class="bi bi-check2-circle"></i> Reintentar';
    }
}
// ── Derivar ticket ─────────────────────────────────────────────────────────
let _deriveCurrentKey = '';
let _deriveSelectedTeam = '';

async function openDeriveModal(key) {
    _deriveCurrentKey = key;
    _deriveSelectedTeam = '';
    const lbl = document.getElementById('deriveKeyLabel');
    if (lbl) lbl.textContent = key;
    const note = document.getElementById('deriveNote');
    if (note) note.value = '';
    const cb = document.getElementById('deriveUnassign');
    if (cb) cb.checked = false;
    const res = document.getElementById('deriveResult');
    if (res) res.style.display = 'none';
    const customIn = document.getElementById('deriveCustomTeam');
    if (customIn) customIn.value = '';
    const btn = document.getElementById('btnDeriveSubmit');
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.display = 'flex'; btn.innerHTML = '<i class="bi bi-arrow-right-circle"></i> Derivar ticket'; }
    new bootstrap.Modal(document.getElementById('modalDeriveTicket')).show();
    await _loadDeriveTeams();
    if (note) note.focus();
}

let _deriveTeamsCache = null;
let _deriveSelectedTeamId = null;

const _DERIVE_COLORS = ['#22c55e','#0ea5e9','#f97316','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#f59e0b'];
const _DERIVE_ICONS  = ['bi-puzzle-fill','bi-hdd-network-fill','bi-layers-fill','bi-gear-fill','bi-shield-fill','bi-display-fill','bi-cpu-fill','bi-wifi'];

async function _loadDeriveTeams() {
    const wrap = document.getElementById('deriveTeamsGrid');
    if (!wrap) return;
    const customIn = document.getElementById('deriveCustomTeam');
    if (customIn) customIn.style.display = 'none';
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;"><span class="spinner-border spinner-border-sm me-2"></span>Cargando grupos desde Jira…</div>';
    try {
        const r = await fetch(`/api/jira/ticket/${_deriveCurrentKey}/derivar-options`, { credentials: 'include' });
        const j = await r.json();
        if (!j.success) throw new Error(j.message || 'Error al cargar grupos');
        const components = j.components || [];
        if (!components.length) {
            wrap.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">No se encontraron grupos en Jira.</div>';
            return;
        }
        const current = j.currentComponent;
        wrap.innerHTML = components.map((c, i) => {
            const isCurrent = current && (c.name === current || c.key === current);
            const color = _DERIVE_COLORS[i % _DERIVE_COLORS.length];
            const icon  = _DERIVE_ICONS[i  % _DERIVE_ICONS.length];
            return `<button type="button" class="derive-team-btn${isCurrent ? ' selected' : ''}"
              data-team="${incEsc(c.name)}" data-id="${incEsc(c.id)}"
              style="display:flex;align-items:center;gap:12px;padding:10px 14px;
                     border:none;border-left:3px solid ${isCurrent ? color : 'transparent'};
                     border-radius:0;background:${isCurrent ? color+'12' : 'transparent'};
                     cursor:pointer;text-align:left;width:100%;transition:background .12s;"
              onmouseenter="if(!this.classList.contains('selected'))this.style.background='var(--bg-hover,#f8fafc)'"
              onmouseleave="if(!this.classList.contains('selected'))this.style.background='transparent'"
              onclick="deriveSelectTeam('${incEsc(c.name)}','${incEsc(c.id)}',this,'${color}')">
              <span style="width:30px;height:30px;border-radius:7px;background:${color}22;
                           display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="bi ${icon}" style="color:${color};font-size:13px;"></i>
              </span>
              <div style="min-width:0;flex:1;">
                <div style="font-size:13px;font-weight:600;color:var(--text-main);line-height:1.2;">${incEsc(c.name)}</div>
                <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-top:1px;">${incEsc(c.key || '')}</div>
              </div>
              ${isCurrent ? `<span style="font-size:10px;font-weight:700;color:${color};background:${color}18;padding:2px 8px;border-radius:10px;flex-shrink:0;white-space:nowrap;">Actual</span>` : ''}
            </button>`;
        }).join('');
    } catch(e) {
        wrap.innerHTML = `<div style="color:#ef4444;font-size:12px;text-align:center;padding:14px;">${incEsc(e.message)}</div>`;
    }
}

function deriveSelectTeam(name, id, el, color) {
    _deriveSelectedTeam = name;
    _deriveSelectedTeamId = id || null;
    document.querySelectorAll('.derive-team-btn').forEach(b => {
        b.style.borderLeftColor = 'transparent';
        b.style.background = 'transparent';
        b.classList.remove('selected');
    });
    if (el) {
        el.style.borderLeftColor = color || '#1e3a5f';
        el.style.background = (color || '#1e3a5f') + '12';
        el.classList.add('selected');
    }
    _deriveValidate();
}

function deriveShowCustom() {
    document.querySelectorAll('.derive-team-btn').forEach(b => {
        b.style.borderColor = 'var(--border-soft)';
        b.style.background = b.dataset.team === 'custom' ? 'rgba(30,58,95,.06)' : 'var(--bg-card)';
    });
    _deriveSelectedTeam = '';
    const customIn = document.getElementById('deriveCustomTeam');
    if (customIn) { customIn.style.display = 'block'; customIn.focus(); }
}

function deriveSelectCustom() {
    const v = (document.getElementById('deriveCustomTeam')?.value || '').trim();
    _deriveSelectedTeam = v;
    _deriveValidate();
}

function _deriveValidate() {
    const team = _deriveSelectedTeam.trim();
    const note = (document.getElementById('deriveNote')?.value || '').trim();
    const btn = document.getElementById('btnDeriveSubmit');
    if (!btn) return;
    const ok = team.length > 0 && note.length > 3;
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '.5';
}

document.addEventListener('input', e => {
    if (e.target.id === 'deriveNote') _deriveValidate();
});

async function submitDerive() {
    const team = _deriveSelectedTeam.trim();
    const teamId = _deriveSelectedTeamId;
    const note = (document.getElementById('deriveNote')?.value || '').trim();
    if (!team || note.length <= 3) return;
    const unassign = !!document.getElementById('deriveUnassign')?.checked;
    const btn = document.getElementById('btnDeriveSubmit');
    const res = document.getElementById('deriveResult');
    if (btn) { btn.disabled = true; btn.style.opacity = '.7'; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Derivando…'; }
    try {
        const r = await fetch(`/api/jira/ticket/${_deriveCurrentKey}/derivar`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ componentId: teamId, componentName: team, comment: note, unassign })
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.message);
        if (res) {
            res.style.cssText = 'display:block;background:#d1fae5;border:1px solid #34d399;color:#065f46;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-top:14px;';
            res.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i>Ticket derivado a <b>${incEsc(team)}</b>${j.jiraOk ? ' en Jira' : ' (local)'}.`;
        }
        if (btn) btn.style.display = 'none';
        showToast(`Ticket ${_deriveCurrentKey} derivado a ${team}`, 'success');
        const badge = document.querySelector(`#card-${_deriveCurrentKey} .tc-actions`);
        if (badge) {
            const deriveBtn = badge.querySelector('button[onclick*="openDeriveModal"]');
            if (deriveBtn) {
                deriveBtn.style.cssText = 'font-size:12px;color:#10b981;border-color:rgba(16,185,129,.4);background:rgba(16,185,129,.06);border-radius:6px;padding:5px 10px;font-weight:700;cursor:default;';
                deriveBtn.innerHTML = '<i class="bi bi-check2"></i> Derivado';
                deriveBtn.onclick = null;
            }
        }
    } catch(e) {
        if (res) {
            res.style.cssText = 'display:block;background:#fee2e2;border:1px solid #fca5a5;color:#dc2626;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-top:14px;';
            res.innerHTML = `<i class="bi bi-x-circle-fill me-2"></i>${incEsc(e.message)}`;
        }
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.innerHTML = '<i class="bi bi-arrow-right-circle"></i> Reintentar'; }
    }
}
async function openDeriveTeamsManager() {
    _deriveTeamsCache = null; // forzar recarga al cerrar
    // Abrir panel flotante de gestión
    let panel = document.getElementById('deriveTeamsMgrPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'deriveTeamsMgrPanel';
        panel.style.cssText = 'position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);';
        panel.innerHTML = `<div style="background:var(--bg-card);border-radius:16px;padding:24px;width:560px;max-width:95vw;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                <i class="bi bi-gear-fill" style="color:#1e3a5f;font-size:18px;"></i>
                <span style="font-size:15px;font-weight:700;color:var(--text-main);">Gestionar grupos de derivación</span>
                <button onclick="closeDeriveTeamsMgr()" style="margin-left:auto;background:none;border:none;cursor:pointer;font-size:20px;color:var(--text-muted);">×</button>
            </div>
            <div id="deriveTeamsMgrList" style="margin-bottom:16px;">Cargando…</div>
            <div style="border-top:1px solid var(--border-soft);padding-top:14px;">
                <div style="font-size:12px;font-weight:700;color:var(--text-main);margin-bottom:10px;">Agregar nuevo grupo</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <input id="dtName" class="form-control-custom" placeholder="Nombre *" style="font-size:12px;padding:7px 10px;">
                    <input id="dtDesc" class="form-control-custom" placeholder="Descripción" style="font-size:12px;padding:7px 10px;">
                    <input id="dtIcon" class="form-control-custom" placeholder="Icono Bootstrap (bi-people)" style="font-size:12px;padding:7px 10px;" value="bi-people">
                    <input id="dtJira" class="form-control-custom" placeholder="ID Jira (p.ej. 11278)" style="font-size:12px;padding:7px 10px;">
                    <input id="dtColor" type="color" value="#6b7280" style="height:36px;border:1px solid var(--border-soft);border-radius:6px;cursor:pointer;">
                    <button onclick="saveDeriveTeam()" style="background:#1e3a5f;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Agregar grupo</button>
                </div>
                <div style="font-size:10px;color:var(--text-muted);">El ID Jira corresponde al valor numérico de customfield_14687 (p.ej. 11278 = Accesos/Conectividad). Si se deja vacío, solo se añade comentario.</div>
            </div>
        </div>`;
        document.body.appendChild(panel);
        panel.addEventListener('click', e => { if (e.target === panel) closeDeriveTeamsMgr(); });
    }
    panel.style.display = 'flex';
    await _renderDeriveTeamsMgr();
}

async function _renderDeriveTeamsMgr() {
    const list = document.getElementById('deriveTeamsMgrList');
    if (!list) return;
    try {
        const r = await fetch('/tickets/derive-teams', { credentials: 'include' });
        const j = await r.json();
        const teams = j.teams || [];
        list.innerHTML = teams.length === 0
            ? '<div style="color:var(--text-muted);font-size:13px;">No hay grupos configurados.</div>'
            : teams.map(t => `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-soft);border-radius:8px;margin-bottom:6px;background:var(--bg-main);">
                <i class="bi ${t.icon}" style="color:${t.color};font-size:16px;flex-shrink:0;"></i>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;color:var(--text-main);">${incEsc(t.name)}</div>
                    <div style="font-size:10px;color:var(--text-muted);">${t.jira_option_id ? `Jira ID: ${t.jira_option_id} ✓` : 'Sin routing Jira'}</div>
                </div>
                <button onclick="deleteDeriveTeam(${t.id})" style="background:none;border:1px solid #fca5a5;border-radius:6px;padding:3px 8px;color:#ef4444;font-size:11px;cursor:pointer;">Eliminar</button>
            </div>`).join('');
    } catch(e) {
        list.innerHTML = '<div style="color:#ef4444;font-size:12px;">Error cargando grupos</div>';
    }
}

async function saveDeriveTeam() {
    const name  = document.getElementById('dtName')?.value.trim();
    const desc  = document.getElementById('dtDesc')?.value.trim();
    const icon  = document.getElementById('dtIcon')?.value.trim() || 'bi-people';
    const color = document.getElementById('dtColor')?.value || '#6b7280';
    const jira  = document.getElementById('dtJira')?.value.trim() || null;
    if (!name) { showToast('El nombre es obligatorio', 'error'); return; }
    const r = await fetch('/tickets/derive-teams', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: desc||null, icon, color, jira_option_id: jira||null })
    });
    const j = await r.json();
    if (j.ok) {
        showToast('Grupo añadido', 'success');
        document.getElementById('dtName').value = '';
        document.getElementById('dtDesc').value = '';
        document.getElementById('dtJira').value = '';
        await _renderDeriveTeamsMgr();
    } else showToast(j.message || 'Error', 'error');
}

async function deleteDeriveTeam(id) {
    if (!confirm('¿Eliminar este grupo de derivación?')) return;
    const r = await fetch(`/tickets/derive-teams/${id}`, { method: 'DELETE', credentials: 'include' });
    const j = await r.json();
    if (j.ok) { showToast('Grupo eliminado', 'success'); await _renderDeriveTeamsMgr(); }
    else showToast(j.message || 'Error', 'error');
}

function closeDeriveTeamsMgr() {
    const panel = document.getElementById('deriveTeamsMgrPanel');
    if (panel) panel.style.display = 'none';
    _deriveTeamsCache = null; // forzar recarga de la lista en el modal
    const grid = document.getElementById('deriveTeamsGrid');
    if (grid) { grid.innerHTML = '<div style="grid-column:span 2;text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Cargando grupos…</div>'; _loadDeriveTeams(); }
}

// ── /Derivar ticket ─────────────────────────────────────────────────────────

function _updateWpBadgeInDOM(key, padre, hijo) {
    const badge = document.getElementById('wpbadge-' + key);
    if (!badge) return;
    const clr = '#7c3aed';
    badge.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;background:${clr}18;border:1px solid ${clr}40;border-radius:8px;margin-bottom:8px;flex-wrap:wrap;`;
    badge.innerHTML = `<i class="bi bi-flag-fill" style="color:${clr};font-size:11px;flex-shrink:0;"></i>
        <span style="font-size:11px;font-weight:700;color:${clr};">${incEsc(padre)}${hijo ? ' › ' + incEsc(hijo) : ''}</span>
        <button onclick="openCategorizeModal('${key}')" style="margin-left:auto;font-size:11px;color:#6b7280;border:1px solid rgba(107,114,128,.3);background:transparent;border-radius:5px;padding:2px 10px;cursor:pointer;font-weight:600;"><i class="bi bi-pencil-fill" style="font-size:9px;"></i> Recategorizar</button>`;
}
function openCloseModal(key,url,summary,reporter){
    closeTicketKey=key;closeTicketUrl=url;
    document.getElementById('closeKeyLabel').textContent=key;
    document.getElementById('closeTicketSummary').textContent=summary||key;
    document.getElementById('closeTicketMeta').textContent=reporter?`Reporter: ${reporter}`:'';
    document.getElementById('closeComment').value='';
    document.getElementById('closeResult').style.display='none';
    const btn=document.getElementById('btnCloseSubmit');
    btn.disabled=true;btn.style.opacity='.6';btn.style.display='flex';
    btn.innerHTML='<i class="bi bi-check2-circle"></i> Resolver ticket';
    document.getElementById('btnCancelClose').textContent='Cancelar';
    new bootstrap.Modal(document.getElementById('modalClose')).show();
    setTimeout(()=>document.getElementById('closeComment').focus(),350);
}
async function submitClose(){
    const comment=document.getElementById('closeComment').value.trim();
    if(!comment)return;
    const tipo_atencion=document.querySelector('.tipo-radio:checked')?.value||'remota';
    const btn=document.getElementById('btnCloseSubmit');
    btn.disabled=true;btn.style.opacity='.7';
    const isLocalKey = (closeTicketKey||'').startsWith('TK-');
    btn.innerHTML=`<span class="spinner-border spinner-border-sm me-2"></span>${isLocalKey?'Cerrando…':'Cerrando en Jira…'}`;
    const resultEl=document.getElementById('closeResult');
    resultEl.style.display='none';
    try{
        const res=await fetch(`/api/jira/ticket/${closeTicketKey}/close`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment,tipo_atencion})});
        const json=await res.json();
        if(!json.success)throw new Error(json.message);
        resultEl.style.display='block';
        resultEl.style.background='var(--step2-bg)';
        resultEl.style.border='1px solid var(--step2-border)';
        resultEl.style.color='var(--step2-color)';
        const msg = json.jiraClosed ? `✅ Ticket ${closeTicketKey} cerrado` : `✅ Ticket cerrado`;
        resultEl.innerHTML=`<i class="bi bi-check-circle-fill me-2"></i>${msg}`;
        btn.style.display='none';
        document.getElementById('btnCancelClose').textContent='Cerrar';
        showToast(msg,'success');
        loadTickets();
        // Categorización WP solo para tickets INC-% (no locales)
        const closedKey=closeTicketKey;
        if(!closedKey.startsWith('TK-')){
            setTimeout(()=>{
                bootstrap.Modal.getInstance(document.getElementById('modalClose'))?.hide();
                openCategorizeModal(closedKey);
            },800);
        } else {
            setTimeout(()=>bootstrap.Modal.getInstance(document.getElementById('modalClose'))?.hide(),1200);
        }
    }catch(err){
        resultEl.style.display='block';
        resultEl.style.background='#fee2e2';resultEl.style.border='1px solid #fca5a5';resultEl.style.color='#dc2626';
        resultEl.innerHTML=`<i class="bi bi-x-circle-fill me-2"></i>${err.message}`;
        btn.disabled=false;btn.style.opacity='1';
        btn.innerHTML='<i class="bi bi-check2-circle"></i> Reintentar';
    }
}

// ── Modal buscar / cola ───────────────────────────────────
function openSearchModal(){
    document.getElementById('searchTicketKey').value='';
    document.getElementById('searchResult').style.display='none';
    document.getElementById('searchEmpty').style.display='none';
    document.getElementById('searchLoading').style.display='none';
    document.getElementById('searchIdle').style.display='block';
    switchTab('tabSearch',document.querySelector('.search-tab-btn'));
    new bootstrap.Modal(document.getElementById('modalSearch')).show();
    setTimeout(()=>document.getElementById('searchTicketKey').focus(),300);
}
function switchTab(tabId,btn){
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.search-tab-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
}

// ── Buscar ticket ─────────────────────────────────────────
async function searchTicket(){
    let key=document.getElementById('searchTicketKey').value.trim().toUpperCase().replace(/\s+/g,'');
    if(/^\d+$/.test(key)) key='INC-'+key;
    if(/^NC-/.test(key))  key='I'+key;
    if(/^IN-/.test(key))  key=key.replace('IN-','INC-');
    document.getElementById('searchTicketKey').value=key;
    if(!key){showToast('Ingresa un número de ticket','error');return;}

    document.getElementById('searchResult').style.display='none';
    document.getElementById('searchEmpty').style.display='none';
    document.getElementById('searchIdle').style.display='none';
    document.getElementById('searchLoading').style.display='flex';
    document.getElementById('btnSearch').disabled=true;

    try{
        // Buscar en MySQL y en Jira (servicedeskapi) en paralelo
        const [localRes,jiraRes]=await Promise.allSettled([
            fetch(`/api/jira/ticket/${key}`).then(r=>r.json()),
            fetch(`/api/jira/ticket/${key}/jira-detail`).then(r=>r.json())
        ]);

        const local=localRes.status==='fulfilled'&&localRes.value.success?localRes.value.data:null;
        const jiraD=jiraRes.status==='fulfilled'&&jiraRes.value.success?jiraRes.value.data:null;

        document.getElementById('searchLoading').style.display='none';

        if(!local&&!jiraD){
            document.getElementById('searchEmpty').style.display='block';
            return;
        }

        const status  = local?.status  || jiraD?.status  || '—';
        const summary = local?.summary || jiraD?.summary || '—';
        const reporter= local?.reporter|| jiraD?.reporter|| '—';
        const jiraUrl = local?.jira_url|| `https://integratelperu.atlassian.net/browse/${key}`;
        const created = local?.created_at
            ? new Date(local.created_at).toLocaleString('es-PE',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
            : jiraD?.created ? new Date(jiraD.created).toLocaleString('es-PE',{day:'2-digit',month:'short',year:'numeric'}) : '—';

        const isClosed_=isClosed(status);
        const statusColor=isClosed_?'var(--success)':isProgress(status)?'var(--warning)':'var(--primary)';
        const statusBg=isClosed_?'rgba(52,211,153,.15)':isProgress(status)?'rgba(251,191,36,.15)':'rgba(96,165,250,.15)';
        const ss=summary.replace(/'/g,"\\'");
        const sr=reporter.replace(/'/g,"\\'");

        const closeBtnHtml=!isClosed_
            ?`<button class="btn-create" style="background:#dc2626;padding:8px 16px;font-size:12px;"
                onclick="bootstrap.Modal.getInstance(document.getElementById('modalSearch')).hide();
                setTimeout(()=>openCloseModal('${key}','${jiraUrl}','${ss}','${sr}'),300);">
                <i class="bi bi-x-octagon-fill"></i> Cerrar ticket
               </button>`
            :`<span style="background:rgba(52,211,153,.15);color:var(--success);font-size:11px;font-weight:600;padding:5px 12px;border-radius:20px;"><i class="bi bi-check-circle me-1"></i>Resuelto</span>`;

        const notLocalBadge=!local
            ?`<span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;margin-left:8px;"><i class="bi bi-exclamation-triangle me-1"></i>Solo en Jira</span>`
            :'';

        document.getElementById('searchResult').innerHTML=`
            <div style="border:1.5px solid var(--border-soft);border-radius:10px;overflow:hidden;">
                <div style="background:var(--bg-header);padding:14px 16px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span class="ticket-key" style="font-size:15px;"><a href="${jiraUrl}" target="_blank">${key}</a></span>
                        <span style="background:${statusBg};color:${statusColor};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;">${status}</span>
                        ${notLocalBadge}
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        ${closeBtnHtml}
                        <a href="${jiraUrl}" target="_blank" class="btn-outline-sm" style="border-color:var(--jira-blue);color:var(--jira-blue);"><i class="bi bi-box-arrow-up-right"></i> Ver en Jira</a>
                    </div>
                </div>
                <div style="padding:14px 16px;border-bottom:1px solid var(--border-soft);">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;">Resumen</div>
                    <div style="font-size:14px;font-weight:600;color:var(--text-main);">${summary}</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
                    ${detailRow('Reporter',reporter,'bi-person')}
                    ${detailRow('Creado',created,'bi-calendar3')}
                    ${local?detailRow('Componente',local.component||'—','bi-cpu'):''}
                    ${local?detailRow('Ítem afectado',local.app_item||'—','bi-laptop'):''}
                    ${local?detailRow('Tipología',local.tipologia||'—','bi-tag'):''}
                    ${local?detailRow('Urgencia',(local.urgency_level===3?'🔴 ':local.urgency_level===2?'🟡 ':'🟢 ')+(local.urgency||'—'),'bi-exclamation-circle'):''}
                    ${local?.closed_at?detailRow('Cerrado',new Date(local.closed_at).toLocaleString('es-PE'),'bi-check2-circle'):''}
                    ${local?.closed_by?detailRow('Cerrado por',local.closed_by,'bi-person-check'):''}
                </div>
                ${local?.description?`<div style="padding:14px 16px;border-top:1px solid var(--border-soft);"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Descripción</div><div style="font-size:13px;line-height:1.6;background:var(--bg-header);padding:10px;border-radius:6px;">${local.description}</div></div>`:''}
                ${local?.close_comment?`<div style="padding:14px 16px;border-top:1px solid var(--border-soft);"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">Comentario de cierre</div><div style="font-size:13px;line-height:1.6;background:var(--step2-bg);padding:10px;border-radius:6px;border-left:3px solid var(--success);">${local.close_comment}</div></div>`:''}
            </div>`;
        document.getElementById('searchResult').style.display='block';

    }catch(err){
        document.getElementById('searchLoading').style.display='none';
        document.getElementById('searchEmpty').style.display='block';
    }finally{
        document.getElementById('btnSearch').disabled=false;
    }
}
function detailRow(label,value,icon){
    return`<div style="padding:10px 16px;border-bottom:1px solid var(--border-soft);border-right:1px solid var(--border-soft);background:var(--bg-card);"><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:3px;"><i class="bi ${icon} me-1"></i>${label}</div><div style="font-size:12px;font-weight:600;color:var(--text-main);">${value||'—'}</div></div>`;
}

// ── Utilidades ────────────────────────────────────────────
function copyTicketKey(){const k=document.getElementById('createdKey').textContent;navigator.clipboard.writeText(k).then(()=>showToast('Copiado: '+k));}
function showToast(msg,type='info'){
    const c=document.getElementById('toastContainer');
    const el=document.createElement('div');
    el.className=`toast-msg ${type}`;
    el.innerHTML=`<i class="bi bi-${type==='success'?'check-circle-fill':type==='error'?'x-circle-fill':'info-circle-fill'}"></i> ${msg}`;
    c.appendChild(el);setTimeout(()=>el.remove(),4000);
}

// ── MARQUESINA (gestión desde incidencias) ───────────────────────────────
const _pmqSevClass = { critical:'background:rgba(239,68,68,.12);color:#b91c1c;border:1px solid #fca5a5;', warning:'background:rgba(245,158,11,.12);color:#92400e;border:1px solid #fcd34d;', info:'background:rgba(59,130,246,.12);color:#1e40af;border:1px solid #93c5fd;', success:'background:rgba(16,185,129,.12);color:#065f46;border:1px solid #6ee7b7;' };
const _pmqSevIcon = { critical:'bi-exclamation-triangle-fill', warning:'bi-exclamation-circle-fill', info:'bi-info-circle-fill', success:'bi-check-circle-fill' };

async function pmqLoadList(){
  const list = document.getElementById('pmqList');
  if(!list) return;
  list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;"><i class="bi bi-hourglass-split"></i> Cargando...</div>';
  try {
    const r = await fetch('/api/portal/banners?all=1', {credentials:'include'});
    const d = await r.json();
    if(!d.data?.length){ list.innerHTML='<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px;">No hay avisos publicados</div>'; return; }
    list.innerHTML = d.data.map(b => {
      const st = _pmqSevClass[b.severity] || _pmqSevClass.info;
      const ic = _pmqSevIcon[b.severity] || 'bi-info-circle-fill';
      const exp = b.expires_at ? ` · Expira: ${new Date(b.expires_at).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}` : ' · Sin expiración';
      const created = new Date(b.created_at).toLocaleString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--border-soft);">
        <span style="flex:1;display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;${st}"><i class="bi ${ic}"></i>${b.message}</span>
        <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${created}${exp}</span>
        <button onclick="pmqDelete(${b.id})" title="Desactivar" style="padding:4px 10px;border-radius:6px;border:1px solid #fca5a5;background:rgba(239,68,68,.08);color:#dc2626;cursor:pointer;font-size:12px;"><i class="bi bi-trash3"></i></button>
      </div>`;
    }).join('');
  } catch(e) { list.innerHTML='<div style="color:#dc2626;padding:12px;font-size:13px;">Error al cargar avisos</div>'; }
}

async function pmqSubmit(){
  const msg = document.getElementById('pmqMsg')?.value.trim();
  const severity = document.getElementById('pmqSeverity')?.value || 'warning';
  const expires = document.getElementById('pmqExpires')?.value || null;
  if(!msg){ showToast('Escribe el texto del aviso','error'); return; }
  try {
    const r = await fetch('/api/portal/banners', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ message: msg, severity, expires_at: expires || null })
    });
    const d = await r.json();
    if(d.success){
      document.getElementById('pmqMsg').value = '';
      document.getElementById('pmqExpires').value = '';
      showToast('✅ Aviso publicado en el portal','success');
      pmqLoadList();
    } else { showToast(d.error || 'Error al publicar','error'); }
  } catch(e) { showToast('Error de conexión','error'); }
}

async function pmqDelete(id){
  if(!confirm('¿Desactivar este aviso del portal?')) return;
  try {
    await fetch(`/api/portal/banners/${id}`, {method:'DELETE', credentials:'include'});
    showToast('Aviso desactivado','success');
    pmqLoadList();
  } catch(e) { showToast('Error','error'); }
}

// ── PORTAL METRICS ────────────────────────────────────────────────────────
var _pmxData = [];
async function loadPortalMetrics(){
  const from  = document.getElementById('pmxFrom')?.value  || '';
  const to    = document.getElementById('pmxTo')?.value    || '';
  const email = document.getElementById('pmxEmail')?.value || '';
  const tbody = document.getElementById('pmxTbody');
  if(tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-muted);"><i class="bi bi-hourglass-split"></i> Cargando...</td></tr>';
  try {
    const qs = new URLSearchParams();
    if(from)  qs.set('from',  from);
    if(to)    qs.set('to',    to);
    if(email) qs.set('email', email);
    const r = await fetch('/api/portal/activity-metrics?' + qs.toString(), { credentials:'include' });
    const d = await r.json();
    if(!d.success){ if(tbody) tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:24px;color:#ef4444;">${d.error||'Error al cargar'}</td></tr>`; return; }
    const t = d.totals || {};
    const sv = (id, v) => { const el=document.getElementById(id); if(el) el.textContent = v ?? 0; };
    sv('pmx-kpi-users',  t.unique_users);
    sv('pmx-kpi-logins', t.total_logins);
    sv('pmx-kpi-inc',    t.total_incidencias);
    sv('pmx-kpi-req',    t.total_requerimientos);
    sv('pmx-kpi-total',  t.total_actions);
    _pmxData = d.summary || [];
    const cnt = document.getElementById('pmxCount');
    if(cnt) cnt.textContent = `${_pmxData.length} usuarios`;
    if(!tbody) return;
    if(!_pmxData.length){ tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">Sin actividad registrada en el período seleccionado</td></tr>'; return; }
    tbody.innerHTML = _pmxData.map(u => {
      const last = u.last_seen ? new Date(u.last_seen).toLocaleString('es-PE',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
      const inc = u.incidencias > 0 ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-weight:700;background:rgba(239,68,68,.1);color:#dc2626;">${u.incidencias}</span>` : '<span style="color:var(--text-muted)">0</span>';
      const req = u.requerimientos > 0 ? `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-weight:700;background:rgba(0,82,204,.1);color:#0052CC;">${u.requerimientos}</span>` : '<span style="color:var(--text-muted)">0</span>';
      return `<tr style="border-top:1px solid var(--border-soft);">
        <td style="padding:10px 16px;font-weight:600;">${u.email}</td>
        <td style="padding:10px 12px;text-align:center;color:var(--text-muted);">${u.identifies??0}</td>
        <td style="padding:10px 12px;text-align:center;">${inc}</td>
        <td style="padding:10px 12px;text-align:center;">${req}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;">${u.total}</td>
        <td style="padding:10px 16px;color:var(--text-muted);font-size:12px;">${last}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    if(tbody) tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px;color:#ef4444;">Error de conexión</td></tr>';
  }
}
function exportPortalCSV(){
  if(!_pmxData.length){ alert('No hay datos para exportar'); return; }
  const rows = [['Correo','Accesos','Incidencias','Requerimientos','Total','Última actividad']];
  _pmxData.forEach(u => rows.push([u.email, u.identifies??0, u.incidencias??0, u.requerimientos??0, u.total, u.last_seen||'']));
  const csv = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
  a.download = `portal-metricas-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// Pre-fill reporter from portal session + back button
(function prefillReporter(){
  const params = new URLSearchParams(window.location.search);
  // Only accept ?reporter= URL param OR emails from the allowed corporate domain
  const ALLOWED_DOMAINS = ['@integratel.com.pe', '@stefanini.com'];
  const fromUrl   = params.get('reporter') || '';
  const fromLocal = localStorage.getItem('portal_user_email') || '';
  const email = fromUrl ||
      (ALLOWED_DOMAINS.some(d => fromLocal.endsWith(d)) ? fromLocal : '') ||
      '';
  if(!email) return;
  const el = document.getElementById('cf_reporter');
  if(el && !el.value){
    el.value = email;
    if(typeof loadEmployeeInfo === 'function') loadEmployeeInfo(email);
  }
  // Show back-to-portal floating button
  const btn = document.createElement('a');
  btn.href = '/autogestion';
 
  
  btn.onmouseenter = () => { btn.style.transform='translateY(-2px)'; btn.style.boxShadow='0 8px 24px rgba(59,130,246,.5)'; };
  btn.onmouseleave = () => { btn.style.transform=''; btn.style.boxShadow='0 4px 18px rgba(59,130,246,.4)'; };
  document.body.appendChild(btn);
})();

// ── INC Manager · Jira directo ────────────────────────────────────────────────

// ── jira() proxy directo ──────────────────────────────────────────────────────
async function jira(method, path, body) {
    const res = await fetch('/api/jira' + path, {
        method,
        credentials: 'include',
        headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
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

function incAdf(text) {
    return { type:'doc', version:1, content:[{ type:'paragraph', content:[{ type:'text', text }] }] };
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function incStatusClass(s) {
    const v = (s||'').toLowerCase();
    if (v.includes('n1'))     return 's-n1';
    if (v.includes('n2'))     return 's-n2';
    if (v.includes('n3'))     return 's-n3';
    if (v.includes('pend'))   return 's-pend';
    if (v.includes('suelto')) return 's-res';
    if (v.includes('cerr'))   return 's-cerr';
    return 's-pend';
}
function incPrioClass(p) {
    const v = (p||'').toLowerCase();
    if (v==='alta'||v==='high'||v==='highest'||v==='critical') return 'prio-alta';
    if (v==='baja'||v==='low'||v==='lowest')                   return 'prio-baja';
    return 'prio-media';
}
function incPrioBadge(p) {
    const v = (p||'').toLowerCase();
    if (v==='alta'||v==='high'||v==='highest'||v==='critical')
        return `<span class="prio-badge pb-alta"><i class="bi bi-arrow-up-circle-fill"></i>${incEsc(p||'Alta')}</span>`;
    if (v==='baja'||v==='low'||v==='lowest')
        return `<span class="prio-badge pb-baja"><i class="bi bi-arrow-down-circle-fill"></i>${incEsc(p||'Baja')}</span>`;
    return `<span class="prio-badge pb-media"><i class="bi bi-dash-circle-fill"></i>${incEsc(p||'Media')}</span>`;
}
function incAvatar(name) {
    if (!name || name==='—' || name==='Sin asignar') return '';
    const parts = (name||'').trim().split(/\s+/);
    const ini = ((parts[0]||'')[0]||'') + ((parts[1]||'')[0]||'');
    return `<span class="tc-avatar" style="background:${_techColor(name)};" title="${incEsc(name)}">${ini.toUpperCase()||'?'}</span>`;
}
function incFmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
}
function incEsc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

function incExtractText(body) {
    if (!body) return '—';
    if (typeof body === 'string') return incEsc(body).slice(0,300);
    try {
        const texts = [];
        const walk = n => { if(n.type==='text') texts.push(n.text||''); (n.content||[]).forEach(walk); };
        walk(body);
        return incEsc(texts.join(' ').slice(0,300));
    } catch { return '—'; }
}

// ── Panel navigation ──────────────────────────────────────────────────────────
let _incCurrentPanel = 'todos';
function incShowPanel(name, el) {
    const scroll = document.getElementById('incScrollArea');
    if (scroll) scroll.scrollTop = 0;
    ['todos','misAsig','sinAsig','buscar','historico'].forEach(p => {
        const panel = document.getElementById('incPanel-'+p);
        if (panel) panel.style.display = p===name ? '' : 'none';
    });
    document.querySelectorAll('.jira-nav-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    _incCurrentPanel = name;
    const titles = { todos:'Todos los tickets', misAsig:'Mis asignados', sinAsig:'Sin asignar', buscar:'Buscar ticket', historico:'Histórico de tickets' };
    const t = document.getElementById('incTopbarTitle'); if(t) t.textContent = titles[name]||name;
    const s = document.getElementById('incTopbarSub');   if(s) s.textContent = '';
    if (name==='todos' && !allTickets.length) loadTickets();
    if (name==='misAsig') loadMisAsig();
    if (name==='sinAsig') loadSinAsig();
    if (name==='historico') autoLoadHistorico();
}
function incReloadCurrent() {
    if (_incCurrentPanel==='todos')    loadTickets();
    if (_incCurrentPanel==='misAsig')  loadMisAsig();
    if (_incCurrentPanel==='sinAsig')  loadSinAsig();
    if (_incCurrentPanel==='buscar')   { buscarTicket(); loadAlertas(); }
    if (_incCurrentPanel==='historico') buscarHistorico();
}
async function syncAndReload() {
    const btn = document.getElementById('btnSyncTickets');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Sincronizando...'; }
    try {
        // Atlassian deprecó GET /rest/api/3/search — usar POST /rest/api/3/search/jql
        const jiraData = await jira('POST', '/rest/api/3/search/jql', {
            jql: 'assignee = currentUser() ORDER BY created DESC',
            maxResults: 200,
            fields: ['summary', 'status', 'assignee', 'reporter', 'priority', 'created']
        });
        const issues = jiraData.issues || [];
        if (issues.length) {
            const r = await fetch('/api/jira/sync-tickets', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ issues })
            });
            const j = await r.json();
            if (j.success) showToast(`✓ ${j.upserted} ticket(s) sincronizados`, 'success');
        } else {
            showToast('Sin tickets asignados en Jira', 'info');
        }
    } catch(e) {
        console.warn('[syncAndReload]', e.message);
        showToast('Jira no disponible — mostrando tickets locales', 'info');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Actualizar'; }
    }
    loadTickets();
}

// ── renderTicket (from standalone) ───────────────────────────────────────────
function renderTicket(issue, opts) {
    const f    = issue.fields || {};
    const key  = issue.key;
    const sum  = f.summary || '(sin resumen)';
    const st   = f.status?.name || '—';
    const pr   = f.priority?.name || '—';
    const asgn        = f.assignee?.emailAddress || f.assignee?.displayName || 'Sin asignar';
    const rep         = f.reporter?.emailAddress || f.creator?.emailAddress || '—';
    const displayName = f.reporter?.displayName  || f.creator?.displayName  || '';
    const phone       = f.customfield_11795 || '';
    const crea = incFmtDate(f.created);
    const upd  = incFmtDate(f.updated);
    const stL_       = st.toLowerCase();
    const isClosed_  = /cerr|resuelto|resolved|done|completado|finalizado/.test(stL_);
    const isPend_    = !isClosed_ && stL_.includes('pendiente');
    const isActive_  = !isClosed_ && !isPend_;
    const comments  = f.comment?.comments || [];
    const lastCmt   = comments[comments.length-1];
    const cmtHtml   = lastCmt ? `<div class="tc-comment"><div class="cm-author">${incEsc(lastCmt.author?.displayName||'—')} · ${incFmtDate(lastCmt.created)}</div>${incExtractText(lastCmt.body)}</div>` : '';

    // Categorización Workplace (customfield_15147)
    const _wpCat    = f.customfield_15147;
    const _wpPadre  = _wpCat?.value || null;
    const _wpHijo   = _wpCat?.child?.value || null;
    const _WP_COLORS = {'Aplicativo de Negocio':'#3b82f6','Citrix':'#06b6d4','Computador de Escritorio':'#f59e0b','Computador Portátil':'#8b5cf6','Conectividad':'#10b981','Gestión de Proxy de Seguridad':'#6366f1','Impresora':'#ec4899','Incidencias ECO':'#14b8a6','Microsoft Office 365':'#f97316','Panda':'#ef4444','Problemas de Acceso':'#dc2626','Software Comercial':'#84cc16','Windows':'#a78bfa'};
    const _wpColor  = (_wpPadre && _WP_COLORS[_wpPadre]) || '#7c3aed';
    const _descText = incExtractText(f.description) || '';
    const _resName  = f.resolution?.name || '';
    const _resDate  = incFmtDate(f.resolutiondate);

    // SLA urgency
    const _prioMap = { highest:1, critical:1, p1:1, high:4, p2:4, medium:8, p3:8, low:24, p4:24, lowest:24 };
    const _prK = (pr||'').toLowerCase().replace(/\s+/g,'');
    const _slaHrs = _prioMap[_prK] || (_prK.includes('high') ? 4 : _prK.includes('low') ? 24 : 8);
    const _nowMs  = Date.now();
    const _creMs  = f.created ? new Date(f.created).getTime() : 0;
    const _elapsed = _creMs ? _nowMs - _creMs : 0;
    const _slaMs  = _slaHrs * 3600000;
    const _remain = _creMs ? (_creMs + _slaMs) - _nowMs : Infinity;
    const _pctE   = _creMs ? Math.min(100, Math.round(_elapsed / _slaMs * 100)) : 0;
    const _urgLvl = isClosed_ || !_creMs ? 'closed' : _remain <= 0 ? 'breach' : _pctE >= 80 ? 'critical' : _pctE >= 50 ? 'warning' : 'ok';
    const _prioBdrMap = {alta:'#ef4444',high:'#ef4444',highest:'#ef4444',critical:'#ef4444',media:'#f59e0b',medium:'#f59e0b',baja:'#10b981',low:'#10b981',lowest:'#10b981'};
    const _prioBdr = _prioBdrMap[(pr||'').toLowerCase()] || '#6366f1';
    const _bdrClr = { breach:'#ef4444', critical:'#f97316', warning:'#eab308', ok:'#10b981' }[_urgLvl] || _prioBdr;
    const _bgClr  = { breach:'rgba(239,68,68,.03)', critical:'rgba(249,115,22,.03)', warning:'rgba(234,179,8,.03)', ok:'', closed:'' }[_urgLvl] || '';

    const _fmt = ms => ms < 3600000 ? Math.ceil(ms/60000)+'min' : ms < 86400000 ? (Math.floor(ms/3600000)+'h'+(Math.floor((ms%3600000)/60000)?Math.floor((ms%3600000)/60000)+'m':'')) : Math.floor(ms/86400000)+'d';
    const _ageStr = _creMs ? _fmt(_elapsed) : '';
    const _remStr = _creMs && _remain > 0 ? _fmt(_remain) : '';

    // Bandera SLA: siempre visible en tickets abiertos, colores semáforo
    const _slaFlag = !_creMs || _urgLvl === 'closed' ? '' :
        _urgLvl === 'breach'   ? `<span class="sla-flag sla-f-red"><i class="bi bi-flag-fill"></i> BREACH +${_ageStr}</span>` :
        _urgLvl === 'critical' ? `<span class="sla-flag sla-f-amber"><i class="bi bi-flag-fill"></i> ${_remStr}</span>` :
        _urgLvl === 'warning'  ? `<span class="sla-flag sla-f-yellow"><i class="bi bi-flag-fill"></i> ${_remStr}</span>` :
                                  `<span class="sla-flag sla-f-green"><i class="bi bi-flag-fill"></i> ${_remStr||_ageStr}</span>`;
    // Hora de creación
    const _creTime = f.created ? new Date(f.created).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '';
    const _slaChip = _slaFlag; // backward-compat alias
    const _hasNote = typeof localStorage !== 'undefined' && !!localStorage.getItem('itsmNote_'+key);

    return `<div class="ticket-card" id="card-${key}" style="border-left:4px solid ${_bdrClr};${_bgClr ? 'background:'+_bgClr+';' : ''}">
      <div class="tc-top">
        <span class="tc-key">${key}</span>
        ${incPrioBadge(pr)}
        <span class="tc-summary">${incEsc(sum)}</span>
        ${_slaChip}
        <span class="status-badge ${incStatusClass(st)}" onclick="toggleTransitionsInc('${key}',this)" style="cursor:pointer;" title="Ver transiciones">${st}</span>
        ${incAvatar(asgn)}
      </div>
      <div class="tc-meta">
        <span><span class="meta-lbl">Asignado</span><b>${incEsc(asgn)}</b></span>
        <span><span class="meta-lbl">Reporter</span><b>${incEsc(rep)}</b></span>
        ${phone
          ? `<span><span class="meta-lbl">Teléfono</span><b>${incEsc(phone)}</b></span>`
          : displayName
            ? `<span class="tc-ph-lkp" data-rn="${incEsc(displayName)}"><span class="meta-lbl">Teléfono</span><b></b></span>`
            : ''}
        <span><span class="meta-lbl">Prioridad</span><b>${incEsc(pr)}</b></span>
        <span><span class="meta-lbl">Creado</span><b>${crea}${_creTime ? `<span class="meta-time">${_creTime}</span>` : ''}</b></span>
        <span><span class="meta-lbl">Actualizado</span><b>${upd}</b></span>
        ${_resDate && _resDate !== '—' ? `<span><span class="meta-lbl">Cerrado</span><b style="color:var(--text-main);">${_resDate}${f.resolutiondate?`<span class="meta-time">${new Date(f.resolutiondate).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}</span>`:''}</b></span>` : ''}
      </div>
      ${cmtHtml}
      ${isClosed_ && !key.startsWith('TK-') ? (_wpPadre
        ? `<div id="wpbadge-${key}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:${_wpColor}18;border:1px solid ${_wpColor}40;border-radius:8px;margin-bottom:8px;flex-wrap:wrap;">
            <i class="bi bi-flag-fill" style="color:${_wpColor};font-size:11px;flex-shrink:0;"></i>
            <span style="font-size:11px;font-weight:700;color:${_wpColor};">${incEsc(_wpPadre)}${_wpHijo?' › '+incEsc(_wpHijo):''}</span>
            <button onclick="toggleDetailInc('${key}')" style="margin-left:auto;font-size:11px;color:${_wpColor};border:1px solid ${_wpColor}50;background:transparent;border-radius:5px;padding:2px 10px;cursor:pointer;font-weight:600;">Ver detalles</button>
            <button onclick="openCategorizeModal('${key}')" style="font-size:11px;color:#6b7280;border:1px solid rgba(107,114,128,.3);background:transparent;border-radius:5px;padding:2px 10px;cursor:pointer;font-weight:600;"><i class="bi bi-pencil-fill" style="font-size:9px;"></i> Recategorizar</button>
           </div>`
        : `<div id="wpbadge-${key}" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;margin-bottom:8px;">
            <i class="bi bi-flag" style="color:#d97706;font-size:11px;flex-shrink:0;"></i>
            <span style="font-size:11px;font-weight:600;color:#d97706;">Sin categorizar</span>
            <button onclick="openCategorizeModal('${key}')" style="margin-left:auto;font-size:11px;color:#d97706;border:1px solid rgba(217,119,6,.4);background:transparent;border-radius:5px;padding:2px 10px;cursor:pointer;font-weight:600;"><i class="bi bi-tag-fill" style="font-size:9px;"></i> Categorizar</button>
           </div>`)
      : ''}
      <div class="tc-actions">
        <button class="btn-outline-sm" style="font-size:12px;color:var(--jira-blue);border-color:rgba(0,82,204,0.3);" onclick="asignarDirecto('${key}')"><i class="bi bi-person-check-fill"></i> Asignarme</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleAsigInc('${key}',this)"><i class="bi bi-people"></i> Reasignar</button>
        <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleComentarInc('${key}',this)"><i class="bi bi-chat-dots"></i> Comentar</button>
        ${isPend_ ? `<button class="btn-outline-sm" style="font-size:12px;color:#6366f1;border-color:rgba(99,102,241,.4);" onclick="toggleReanudarInc('${key}',this)"><i class="bi bi-arrow-counterclockwise"></i> Reanudar</button>` : ''}
        ${isActive_ ? `<button class="btn-outline-sm" style="font-size:12px;color:#b45309;border-color:rgba(234,179,8,.4);" onclick="togglePendienteInc('${key}',this)"><i class="bi bi-pause-circle"></i> Poner en Pendiente</button>` : ''}
        ${!isClosed_ ? `<button class="btn-outline-sm" style="border-color:#ef4444;color:#ef4444;font-size:12px;" onclick="toggleCerrarInc('${key}',this)"><i class="bi bi-check2-circle"></i> Cerrar incidencia</button>` : (key.startsWith('TK-') ? '<span style="font-size:11px;color:var(--text-muted);font-family:monospace;">✓ cerrado</span>' : '')}
        ${!isClosed_ && !key.startsWith('TK-') ? `<button class="btn-outline-sm" style="font-size:12px;color:#0f172a;border-color:rgba(15,23,42,.35);" onclick="openDeriveModal('${key}')"><i class="bi bi-arrow-right-circle"></i> Derivar</button>` : ''}
        <button class="btn-outline-sm" style="font-size:12px;color:#6366f1;border-color:rgba(99,102,241,.3);" onclick="openTimeline('${key}')"><i class="bi bi-clock-history"></i> Timeline</button>
        <button class="btn-outline-sm" id="noteBtn-${key}" style="font-size:12px;${_hasNote ? 'color:#8b5cf6;border-color:rgba(139,92,246,.4);' : ''}" onclick="toggleNoteInc('${key}',this)"><i class="bi bi-sticky${_hasNote ? '-fill' : ''}"></i> Nota${_hasNote ? ' ·' : ''}</button>
        <a href="https://integratelperu.atlassian.net/browse/${key}" target="_blank" class="btn-outline-sm" style="font-size:12px;text-decoration:none;margin-left:auto;"><i class="bi bi-box-arrow-up-right"></i> Jira</a>
      </div>

      <!-- COMENTAR INLINE -->
      <div class="asig-inline" id="comentar-${key}" style="display:none; padding:12px; border:1px solid var(--border-soft); border-radius:8px; margin-top:8px; background:var(--bg-card);">
        <div style="font-size:11px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;text-transform:uppercase;">Agregar Comentario</div>
        <textarea id="comentar-input-${key}" class="form-control-custom" rows="2" placeholder="Escribe un comentario..." style="resize:vertical;margin-bottom:8px;"></textarea>
        <div style="display:flex;gap:8px;">
          <button class="btn-create" style="padding:7px 14px;font-size:12px;" onclick="ejecutarComentar('${key}')">Enviar comentario</button>
          <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleComentarInc('${key}')">Cancelar</button>
        </div>
      </div>

      <!-- REASIGNAR INLINE -->
      <div class="asig-inline" id="asig-${key}" style="display:none; padding:12px; border:1px solid var(--border-soft); border-radius:8px; margin-top:8px; background:var(--bg-card);">
        <div style="font-size:11px;color:var(--text-muted);font-family:monospace;margin-bottom:8px;text-transform:uppercase;">Asignar técnico</div>
        <div class="tech-quick-wrap" style="position:relative;">
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="asig-input-${key}" type="text" class="form-control-custom" placeholder="Buscar técnico por nombre o correo..." style="flex:1;padding:8px 12px;font-size:12px;"
              oninput="filterTechQuick('${key}',this.value)"
              onfocus="filterTechQuick('${key}',this.value)"
              onkeydown="if(event.key==='Escape')hideTechQuick('${key}')">
            <button class="btn-outline-sm" style="font-size:12px;white-space:nowrap;" onclick="asignarmeAMi('${key}')"><i class="bi bi-person-fill"></i> Asignarme</button>
            <button class="btn-create" style="padding:7px 14px;font-size:12px;" onclick="ejecutarAsignar('${key}')">Asignar</button>
            <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleAsigInc('${key}')">✕</button>
          </div>
          <div id="tq-${key}" class="tech-quick-drop"></div>
        </div>
      </div>

      <!-- CERRAR INLINE -->
      <div class="cerrar-inline" id="cerrar-${key}" style="display:none; padding:12px; border:1px solid rgba(239,68,68,.3); border-radius:8px; margin-top:8px; background:var(--bg-card);">
        <div style="font-size:11px;color:#ef4444;font-family:monospace;margin-bottom:10px;text-transform:uppercase;">Cerrar incidencia · ${key}</div>
        <select id="cerrar-res-${key}"              style="display:none;"><option value="Resuelto" selected>Resuelto</option></select>
        <select id="cerrar-proc-${key}"             style="display:none;"><option value="WORKPLACE" selected>WORKPLACE</option></select>
        <select id="cerrar-masiva-${key}"           style="display:none;"><option value="NO" selected>NO</option></select>
        <select id="cerrar-resultado-padre-${key}"  style="display:none;"><option value="Workplace" selected>Workplace</option></select>
        <select id="cerrar-resultado-hijo-${key}"   style="display:none;"><option value="Workplace" selected>Workplace</option></select>
        <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:5px;text-transform:uppercase;">Comentario de cierre *</div>
        <textarea id="cerrar-com-${key}" class="form-control-custom" rows="3" placeholder="Describe cómo se resolvió el problema..." style="resize:vertical;margin-bottom:8px;border-color:rgba(239,68,68,.4);"></textarea>
        <div style="margin-bottom:10px;">
          <button class="btn-outline-sm" style="font-size:11px;" onclick="toggleAvanzado('${key}')"><i class="bi bi-chevron-down"></i> Opciones avanzadas — Resolución: <b id="lbl-res-${key}">Resuelto · Workplace · Workplace</b></button>
          <div id="avanzado-${key}" style="display:none;margin-top:10px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
              <div>
                <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:4px;text-transform:uppercase;">Tipo de resolución</div>
                <select id="cerrar-res-adv-${key}" onchange="actualizarLabel('${key}')" class="form-select-custom" style="font-size:12px;padding:7px 10px;">
                  <option>Resuelto</option><option>Reinicio de servicio</option><option>Aplicación de workaround</option>
                  <option>Orientación al usuario</option><option>Sin acción correctiva</option>
                  <option>Ticket duplicado</option><option>Cese de alarma</option>
                  <option>Resueltos por tren</option><option>Desarrollo de Hotfix</option><option>Cierre masivo</option>
                </select>
              </div>
              <div>
                <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:4px;text-transform:uppercase;">Proceso impactado</div>
                <select id="cerrar-proc-adv-${key}" onchange="actualizarLabel('${key}')" class="form-select-custom" style="font-size:12px;padding:7px 10px;">
                  <option>WORKPLACE</option><option>PLATAFORMAS</option><option>LOGIN APP MIMOVISTAR</option>
                  <option>ECOMMERCE</option><option>VENTAS MOVIL</option><option>VENTAS FIJA</option>
                  <option>AVERÍAS</option><option>RECLAMOS</option><option>ALERTA P1</option>
                  <option>PORT IN</option><option>PORT OUT</option><option>JIRA</option>
                  <option>SISTEMAS</option><option>INFRAESTRUCTURA</option>
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
              <div>
                <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:4px;text-transform:uppercase;">Resultado (padre)</div>
                <select id="cerrar-rpadre-adv-${key}" onchange="updateResultadoHijoAdv('${key}');actualizarLabel('${key}')" class="form-select-custom" style="font-size:12px;padding:7px 10px;">
                  <option>Workplace</option><option>Amdocs</option><option>Infraestructura</option>
                  <option>Automatismo</option><option>Otros</option><option>Asociado a PaP</option>
                  <option>Deuda técnica</option><option>Resuelto en N3</option>
                  <option>Seguridad</option><option>Servicios Externos</option>
                </select>
              </div>
              <div>
                <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:4px;text-transform:uppercase;">Resultado (hijo)</div>
                <select id="cerrar-rhijo-adv-${key}" onchange="actualizarLabel('${key}')" class="form-select-custom" style="font-size:12px;padding:7px 10px;">
                  <option>Workplace</option><option>Sin acción - Orden completada</option><option>Sin acción - Orden cancelada</option>
                </select>
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:4px;text-transform:uppercase;">¿Es incidencia masiva?</div>
              <select id="cerrar-masiva-adv-${key}" class="form-select-custom" style="width:160px;font-size:12px;padding:7px 10px;">
                <option value="NO">NO</option><option value="SI">SI</option>
              </select>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline-sm" style="border-color:#ef4444;color:#ef4444;font-size:12px;" id="btnCerrar-${key}" onclick="ejecutarCierre('${key}')"><i class="bi bi-check2-circle"></i> Confirmar cierre</button>
          <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleCerrarInc('${key}')">Cancelar</button>
        </div>
      </div>

      <!-- PONER EN PENDIENTE INLINE -->
      <div class="cerrar-inline" id="pendiente-${key}" style="display:none; padding:12px; border:1px solid rgba(234,179,8,.35); border-radius:8px; margin-top:8px; background:var(--bg-card);">
        <div style="font-size:11px;color:#b45309;font-family:monospace;margin-bottom:10px;text-transform:uppercase;">Poner en Pendiente · ${key}</div>
        <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:5px;text-transform:uppercase;">Comentario *</div>
        <textarea id="pendiente-com-${key}" class="form-control-custom" rows="3" placeholder="Motivo o detalle del estado pendiente..." style="resize:vertical;margin-bottom:8px;border-color:rgba(234,179,8,.4);"></textarea>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline-sm" style="border-color:#b45309;color:#b45309;font-size:12px;" onclick="ejecutarPendienteInc('${key}')"><i class="bi bi-pause-circle"></i> Confirmar</button>
          <button class="btn-outline-sm" style="font-size:12px;" onclick="togglePendienteInc('${key}')">Cancelar</button>
        </div>
      </div>

      <!-- REANUDAR INLINE -->
      <div class="cerrar-inline" id="reanudar-${key}" style="display:none; padding:12px; border:1px solid rgba(99,102,241,.35); border-radius:8px; margin-top:8px; background:var(--bg-card);">
        <div style="font-size:11px;color:#6366f1;font-family:monospace;margin-bottom:10px;text-transform:uppercase;">Reanudar Ticket · ${key}</div>
        <div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-bottom:5px;text-transform:uppercase;">Comentario *</div>
        <textarea id="reanudar-com-${key}" class="form-control-custom" rows="3" placeholder="Motivo por el que se reactiva el ticket..." style="resize:vertical;margin-bottom:8px;border-color:rgba(99,102,241,.4);"></textarea>
        <div style="display:flex;gap:8px;">
          <button class="btn-outline-sm" style="border-color:#6366f1;color:#6366f1;font-size:12px;" onclick="ejecutarReanudarInc('${key}')"><i class="bi bi-arrow-counterclockwise"></i> Confirmar</button>
          <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleReanudarInc('${key}')">Cancelar</button>
        </div>
      </div>

      <!-- TRANSICIONES INLINE -->
      <div class="cerrar-inline" id="trans-${key}" style="display:none; padding:12px; border:1px solid rgba(99,102,241,.3); border-radius:8px; margin-top:8px; background:var(--bg-card);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:11px;color:#6366f1;font-family:monospace;text-transform:uppercase;">Transiciones disponibles · ${key}</span>
          <button class="btn-outline-sm" style="font-size:11px;padding:2px 8px;" onclick="toggleTransitionsInc('${key}')">✕</button>
        </div>
        <div id="trans-list-${key}"><span style="font-size:12px;color:var(--text-muted);">Cargando...</span></div>
      </div>

      <!-- DETALLE INLINE -->
      <div id="detail-${key}" style="display:none;padding:14px;border:1px solid var(--border-soft);border-radius:8px;margin-top:8px;background:var(--bg-card);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Detalles · ${key}</span>
          <button onclick="toggleDetailInc('${key}')" style="font-size:12px;color:var(--text-muted);border:none;background:none;cursor:pointer;line-height:1;">✕</button>
        </div>
        ${_descText ? `<div style="margin-bottom:12px;">
          <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px;">Descripción del reporte</div>
          <div style="font-size:12px;color:var(--text-main);line-height:1.55;max-height:120px;overflow-y:auto;background:var(--bg-main);border-radius:6px;padding:8px 10px;border:1px solid var(--border-soft);">${incEsc(_descText)}</div>
        </div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:${_wpPadre?'12px':'0'};">
          <div><div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;margin-bottom:2px;">Resolución</div><div style="font-size:12px;color:var(--text-main);font-weight:600;">${_resName||'—'}</div></div>
          <div><div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;margin-bottom:2px;">Fecha resolución</div><div style="font-size:12px;color:var(--text-main);">${_resDate||'—'}</div></div>
          <div><div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;margin-bottom:2px;">Asignado</div><div style="font-size:12px;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${incEsc(asgn)}</div></div>
        </div>
        ${_wpPadre ? `<div style="padding:8px 10px;background:${_wpColor}12;border:1px solid ${_wpColor}30;border-radius:6px;display:flex;align-items:center;gap:10px;">
          <i class="bi bi-flag-fill" style="color:${_wpColor};font-size:13px;flex-shrink:0;"></i>
          <div style="min-width:0;">
            <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;margin-bottom:1px;">Categoría Workplace</div>
            <div style="font-size:13px;font-weight:700;color:${_wpColor};">${incEsc(_wpPadre)}${_wpHijo?` <span style="opacity:.5;">›</span> ${incEsc(_wpHijo)}`:''}  </div>
          </div>
          <button onclick="openCategorizeModal('${key}')" style="margin-left:auto;flex-shrink:0;font-size:11px;color:#6b7280;border:1px solid rgba(107,114,128,.3);background:transparent;border-radius:5px;padding:3px 10px;cursor:pointer;font-weight:600;"><i class="bi bi-pencil-fill" style="font-size:9px;"></i> Recategorizar</button>
        </div>` : ''}
      </div>

      <!-- NOTA INTERNA -->
      <div class="asig-inline" id="note-${key}" style="display:none;padding:12px;border:1px solid rgba(139,92,246,.3);border-radius:8px;margin-top:8px;background:rgba(139,92,246,.04);">
        <div style="font-size:10px;color:#8b5cf6;font-family:monospace;margin-bottom:8px;display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.04em;"><i class="bi bi-sticky-fill"></i> Nota interna — solo en este navegador</div>
        <textarea id="note-input-${key}" rows="3" placeholder="Escribe una nota privada sobre este ticket..." style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid rgba(139,92,246,.3);border-radius:8px;background:var(--bg-main);color:var(--text-main);resize:vertical;margin-bottom:8px;outline:none;font-family:inherit;" oninput="saveNoteInc('${key}',this.value)"></textarea>
        <button class="btn-outline-sm" style="font-size:11px;color:#ef4444;border-color:rgba(239,68,68,.3);" onclick="clearNoteInc('${key}',this)"><i class="bi bi-trash3"></i> Borrar nota</button>
      </div>

    </div>`;
}

function toggleDetailInc(key) {
    const el = document.getElementById('detail-' + key);
    if (el) el.style.display = (el.style.display === 'none' || !el.style.display) ? '' : 'none';
}

// Helper: busca un elemento por ID dentro del card del botón pulsado,
// evitando conflictos cuando el mismo ticket existe en varios paneles.
function _cardEl(btn, id) {
    const card = btn ? btn.closest('.ticket-card') : null;
    return (card ? card.querySelector('#'+id) : null) || document.getElementById(id);
}

function toggleAsigInc(key, btn) {
    const el = _cardEl(btn, 'asig-'+key);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
        const card = el.closest('.ticket-card');
        if (card) {
            card.querySelector('#cerrar-'+key)?.style.setProperty('display','none');
            card.querySelector('#comentar-'+key)?.style.setProperty('display','none');
        }
        const inp = card?.querySelector('#asig-input-'+key);
        if (inp) { inp.focus(); inp.scrollIntoView({ behavior:'smooth', block:'nearest' }); }
    }
}
function toggleCerrarInc(key, btn) {
    const el = _cardEl(btn, 'cerrar-'+key);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
        const card = el.closest('.ticket-card');
        if (card) {
            card.querySelector('#asig-'+key)?.style.setProperty('display','none');
            card.querySelector('#comentar-'+key)?.style.setProperty('display','none');
        }
    }
}
function toggleComentarInc(key, btn) {
    const el = _cardEl(btn, 'comentar-'+key);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    if (el.style.display === 'block') {
        const card = el.closest('.ticket-card');
        if (card) {
            card.querySelector('#cerrar-'+key)?.style.setProperty('display','none');
            card.querySelector('#asig-'+key)?.style.setProperty('display','none');
        }
        card?.querySelector('#comentar-input-'+key)?.focus();
    }
}
function _closeAllInc(key, card) {
    ['asig','cerrar','comentar','pendiente','reanudar','trans'].forEach(p => {
        const el = (card ? card.querySelector('#'+p+'-'+key) : null) || document.getElementById(`${p}-${key}`);
        if (el) el.style.display = 'none';
    });
}
function togglePendienteInc(key, btn) {
    const el = _cardEl(btn, 'pendiente-'+key);
    if (!el) return;
    const card = el.closest('.ticket-card');
    const wasOpen = el.style.display !== 'none';
    _closeAllInc(key, card);
    if (!wasOpen) { el.style.display = 'block'; card?.querySelector('#pendiente-com-'+key)?.focus(); }
}
function toggleReanudarInc(key, btn) {
    const el = _cardEl(btn, 'reanudar-'+key);
    if (!el) return;
    const card = el.closest('.ticket-card');
    const wasOpen = el.style.display !== 'none';
    _closeAllInc(key, card);
    if (!wasOpen) { el.style.display = 'block'; card?.querySelector('#reanudar-com-'+key)?.focus(); }
}
async function toggleTransitionsInc(key, btn) {
    const el = _cardEl(btn, 'trans-'+key);
    if (!el) return;
    const card = el.closest('.ticket-card');
    const wasOpen = el.style.display !== 'none';
    _closeAllInc(key, card);
    if (wasOpen) return;
    el.style.display = 'block';
    const listEl = (card ? card.querySelector('#trans-list-'+key) : null) || document.getElementById('trans-list-'+key);
    if (listEl) listEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Cargando...</span>';
    try {
        const res = await fetch(`/api/jira/ticket/${key}/transitions`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        if (!data.transitions.length) {
            listEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">No hay transiciones disponibles</span>';
            return;
        }
        listEl.innerHTML = data.transitions.map(t => `
            <button class="btn-outline-sm" style="display:block;width:100%;text-align:left;margin-bottom:4px;font-size:13px;"
                onclick="ejecutarTransicionInc('${key}','${t.id}',${JSON.stringify(t.name)})">
                ${incEsc(t.name)}<span style="font-size:10px;color:var(--text-muted);margin-left:6px;">→ ${incEsc(t.to)}</span>
            </button>
        `).join('');
    } catch (e) {
        if (listEl) listEl.innerHTML = `<span style="font-size:12px;color:#ef4444;">Error: ${incEsc(e.message)}</span>`;
    }
}
async function ejecutarPendienteInc(key) {
    const comment = _inCard(key, 'pendiente-com-'+key)?.value.trim();
    if (!comment) { showToast('Agrega un comentario', 'error'); return; }
    showToast(`Actualizando ${key}...`, 'info');
    try {
        const res = await fetch(`/api/jira/ticket/${key}/pending`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include', body: JSON.stringify({ comment }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        showToast(data.jiraOk ? `✓ ${key} → Pendiente` : `⚠️ ${data.message}`, data.jiraOk ? 'success' : 'info');
        _closeAllInc(key);
        reloadCard(key);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}
async function ejecutarReanudarInc(key) {
    const comment = _inCard(key, 'reanudar-com-'+key)?.value.trim();
    if (!comment) { showToast('Agrega un comentario', 'error'); return; }
    showToast(`Reanudando ${key}...`, 'info');
    try {
        const res = await fetch(`/api/jira/ticket/${key}/reanudar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include', body: JSON.stringify({ comment }),
        });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error(`Error del servidor (HTTP ${res.status})`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        showToast(data.jiraOk ? `✓ ${key} → Reanudado` : `⚠️ ${data.message}`, data.jiraOk ? 'success' : 'info');
        _closeAllInc(key);
        reloadCard(key);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}
async function ejecutarTransicionInc(key, transitionId, transitionName) {
    showToast(`Aplicando "${transitionName}"...`, 'info');
    try {
        const res = await fetch(`/api/jira/ticket/${key}/transition`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include', body: JSON.stringify({ transitionId, transitionName }),
        });
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error(`Error del servidor (HTTP ${res.status})`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
        showToast(`✓ ${key}: ${transitionName}`, 'success');
        _closeAllInc(key);
        reloadCard(key);
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
}
function asignarDirecto(key) {
    const email = getJiraEmail();
    if (!email) return;
    ejecutarAsignar(key, email).then(() => {
        const btn = document.getElementById('nav-misAsig');
        if (btn) btn.click();
    });
}
function getJiraEmail() {
    let email = localStorage.getItem('jira_email') || CURRENT_USER_EMAIL;
    if (!email || !email.includes('@')) {
        email = prompt("⚠️ Ingresa tu correo asociado a Jira para ver tus tickets asignados:", "");
        if (email && email.includes('@')) {
            localStorage.setItem('jira_email', email.trim());
        } else {
            return '';
        }
    }
    return email;
}

function forceConfigJiraEmail() {
    var modal = document.getElementById('jiraEmailModal');
    var input = document.getElementById('jiraEmailInput');
    if (modal && input) {
        input.value = localStorage.getItem('jira_email') || CURRENT_USER_EMAIL || '';
        modal.style.display = 'flex';
        setTimeout(function() { input.focus(); input.select(); }, 60);
    }
}

function asignarmeAMi(key) {
    const el = _inCard(key, 'asig-input-'+key);
    if (el) el.value = getJiraEmail() || CURRENT_USER_EMAIL;
}

// ── Weekly bar chart helper (shared by Mis Asignados + Sin Asignar) ──────────
const _chartInstances = {};

function _renderWeeklyChart(canvasId, issues, instKey, createdLabel) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    // Build last-7-days buckets
    const days = [], createdByDay = {}, resolvedByDay = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const k = d.toISOString().slice(0, 10);
        days.push(k); createdByDay[k] = 0; resolvedByDay[k] = 0;
    }
    for (const issue of issues) {
        const f = issue.fields || {};
        const cd = f.created?.slice(0, 10);
        const rd = f.resolutiondate?.slice(0, 10);
        if (cd && createdByDay.hasOwnProperty(cd))  createdByDay[cd]++;
        if (rd && resolvedByDay.hasOwnProperty(rd)) resolvedByDay[rd]++;
    }
    const labels = days.map(d => { const [,m,day] = d.split('-'); return `${day}/${m}`; });
    if (_chartInstances[instKey]) { try { _chartInstances[instKey].destroy(); } catch(_){} }
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
    const tickColor = isDark ? '#6b7280' : '#9ca3af';
    _chartInstances[instKey] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: createdLabel, data: days.map(d => createdByDay[d]),  backgroundColor: 'rgba(59,130,246,.65)',  borderRadius: 4, borderSkipped: false },
                { label: 'Resueltos',  data: days.map(d => resolvedByDay[d]), backgroundColor: 'rgba(16,185,129,.65)', borderRadius: 4, borderSkipped: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', align: 'start', labels: { font: { size: 10 }, padding: 10, boxWidth: 10, boxHeight: 10, color: tickColor } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10 }, color: tickColor }, border: { display: false } },
                y: { grid: { color: gridColor }, ticks: { font: { size: 10 }, color: tickColor, stepSize: 1, maxTicksLimit: 5 }, beginAtZero: true, border: { display: false } }
            },
            animation: { duration: 300 }
        }
    });
}

// ── Mis asignados ─────────────────────────────────────────────────────────────
let _misAsigFilter = 'activos';

function misAsigFilter(f, el) {
    _misAsigFilter = f;
    document.querySelectorAll('#panel-misAsig .sa-pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
    loadMisAsig();
}

async function loadMisAsig() {
    const email = getJiraEmail();
    if (!email) {
        const list = document.getElementById('list-misAsig');
        if (list) list.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>Correo Jira no configurado</p><button class="btn-outline-sm mt-2" onclick="localStorage.removeItem('jira_email');getJiraEmail();loadMisAsig()">Configurar correo</button></div>`;
        return;
    }
    const list = document.getElementById('list-misAsig');
    if (!list) return;
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';

    const JQL_MAP = {
        activos:   `project = INC AND assignee = "${email}" AND status NOT IN (Resuelto,Resolved,Cerrado,Done,Closed) ORDER BY created ASC`,
        pendiente: `project = INC AND assignee = "${email}" AND status = Pendiente ORDER BY created DESC`,
        resuelto:  `project = INC AND assignee = "${email}" AND status IN (Resuelto,Resolved) ORDER BY updated DESC`,
        cerrado:   `project = INC AND assignee = "${email}" AND status IN (Cerrado,Done,Closed) ORDER BY updated DESC`,
        todos:     `project = INC AND assignee = "${email}" ORDER BY updated DESC`,
    };
    const jql = JQL_MAP[_misAsigFilter] || JQL_MAP.activos;
    const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate','customfield_11795'];
    const chartJql = `project = INC AND assignee = "${email}" AND created >= -7d ORDER BY created ASC`;

    try {
        const [data, chartData] = await Promise.all([
            jira('POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 100 }),
            jira('POST', '/rest/api/3/search/jql', { jql: chartJql, fields: ['created','status','resolutiondate'], maxResults: 300 })
        ]);

        const issues = data.issues || [];
        const total  = data.total ?? issues.length;

        const badge = document.getElementById('badge-misAsig');
        if (badge && _misAsigFilter === 'activos') { badge.textContent = total; badge.style.display = total ? '' : 'none'; }

        // Mini stats
        const nowMs = Date.now();
        const _pm = { highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24 };
        let cntBreach = 0, cntCritical = 0, cntResuelto = 0;
        for (const i of issues) {
            const fi = i.fields || {};
            const stL = (fi.status?.name||'').toLowerCase();
            if (/resuelto|resolved/.test(stL)) { cntResuelto++; continue; }
            const pk  = (fi.priority?.name||'').toLowerCase().replace(/\s+/g,'');
            const hrs = _pm[pk] || (pk.includes('high') ? 4 : pk.includes('low') ? 24 : 8);
            const cm  = fi.created ? new Date(fi.created).getTime() : 0;
            if (cm) {
                const rem = cm + hrs*3600000 - nowMs;
                const pct = Math.min(100, Math.round((nowMs-cm)/(hrs*3600000)*100));
                if (rem <= 0) cntBreach++;
                else if (pct >= 80) cntCritical++;
            }
        }
        const statsEl = document.getElementById('stats-misAsig');
        if (statsEl) statsEl.innerHTML = `
            <div class="stat-card"><div class="stat-val c-blue">${total}</div><div class="stat-lbl">Total</div></div>
            <div class="stat-card"><div class="stat-val c-green">${cntResuelto}</div><div class="stat-lbl">Resueltos</div></div>
            <div class="stat-card"><div class="stat-val c-red">${cntBreach}</div><div class="stat-lbl">SLA vencido</div></div>
            <div class="stat-card"><div class="stat-val c-amber">${cntCritical}</div><div class="stat-lbl">SLA crítico</div></div>
        `;

        // K — SLA urgency badge on sidebar nav
        const _slaBadgeNav = document.getElementById('sla-badge-misAsig');
        if (_slaBadgeNav && _misAsigFilter === 'activos') {
            const _urgent = cntBreach + cntCritical;
            _slaBadgeNav.textContent = _urgent;
            _slaBadgeNav.style.display = _urgent > 0 ? '' : 'none';
            _slaBadgeNav.style.background = cntBreach > 0 ? '#ef4444' : '#f59e0b';
        }

        _renderWeeklyChart('chartMisAsigWeekly', chartData.issues || [], '_misAsigChartInst', 'Mis tickets creados');

        const sub = document.getElementById('incTopbarSub'); if(sub) sub.textContent = `${total} tickets`;
        if (!issues.length) { list.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No hay tickets para este filtro</p></div>`; return; }
        list.innerHTML = issues.map(i => renderTicket(i)).join('');
    } catch(e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message,'error');
    }
}

// ── Sin asignar ───────────────────────────────────────────────────────────────
let _sinAsigFilter = 'sin_asignar';

function sinAsigFilter(f, el) {
    _sinAsigFilter = f;
    document.querySelectorAll('#panel-sinAsig .sa-pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
    loadSinAsig();
}

async function loadSinAsig() {
    const list = document.getElementById('list-sinAsig');
    if (!list) return;
    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';

    const BASE = 'project = INC AND "Tipo de Componente" = Workplace';
    const sort = document.getElementById('sinAsigSort')?.value || 'DESC';
    const JQL_MAP = {
        sin_asignar: `${BASE} AND assignee is EMPTY AND status IN ("Asignado N2",Pendiente) ORDER BY created ${sort}`,
        pendiente:   `${BASE} AND status = Pendiente ORDER BY created ${sort}`,
        asignado_n2: `${BASE} AND status = "Asignado N2" ORDER BY created ${sort}`,
        todos:       `${BASE} AND status IN ("Asignado N2",Pendiente) ORDER BY created ${sort}`,
    };
    const jql = JQL_MAP[_sinAsigFilter] || JQL_MAP.sin_asignar;
    const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate','customfield_11795'];
    const BASE_CHT = 'project = INC AND "Tipo de Componente" = Workplace';
    const chartJql = `${BASE_CHT} AND assignee is EMPTY AND created >= -7d ORDER BY created ASC`;

    try {
        const [data, chartData] = await Promise.all([
            jira('POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 100 }),
            jira('POST', '/rest/api/3/search/jql', { jql: chartJql, fields: ['created','status','resolutiondate'], maxResults: 300 })
        ]);
        const items = data.issues || [];
        const total = data.total ?? items.length;

        const badge = document.getElementById('badge-sinAsig');
        if (badge && _sinAsigFilter === 'sin_asignar') { badge.textContent = total; badge.style.display = total ? '' : 'none'; }

        const nowMs = Date.now();
        const _pm = { highest:1, critical:1, p1:1, high:4, p2:4, medium:8, p3:8, low:24, p4:24, lowest:24 };
        let cntBreach = 0, cntCritical = 0, cntUnassg = 0;
        for (const i of items) {
            const fi = i.fields || {};
            if (!fi.assignee) cntUnassg++;
            const pk = (fi.priority?.name||'').toLowerCase().replace(/\s+/g,'');
            const hrs = _pm[pk] || (pk.includes('high') ? 4 : pk.includes('low') ? 24 : 8);
            const cm = fi.created ? new Date(fi.created).getTime() : 0;
            if (cm) {
                const rem = cm + hrs*3600000 - nowMs;
                const pct = Math.min(100, Math.round((nowMs-cm)/(hrs*3600000)*100));
                if (rem <= 0) cntBreach++;
                else if (pct >= 80) cntCritical++;
            }
        }
        const statsEl = document.getElementById('stats-sinAsig');
        if (statsEl) statsEl.innerHTML = `
            <div class="stat-card"><div class="stat-val c-blue">${total}</div><div class="stat-lbl">Total</div></div>
            ${_sinAsigFilter !== 'sin_asignar' ? `<div class="stat-card"><div class="stat-val" style="color:#7c3aed;">${cntUnassg}</div><div class="stat-lbl">Sin asignar</div></div>` : ''}
            <div class="stat-card"><div class="stat-val c-red">${cntBreach}</div><div class="stat-lbl">SLA vencido</div></div>
            <div class="stat-card"><div class="stat-val c-amber">${cntCritical}</div><div class="stat-lbl">SLA crítico</div></div>
        `;

        _renderWeeklyChart('chartSinAsigWeekly', chartData.issues || [], '_sinAsigChart', 'Sin asignar nuevos');

        if (!items.length) {
            list.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;"></i><p>No hay tickets para este filtro</p></div>`;
            return;
        }
        list.innerHTML = items.map(i => renderTicket(i)).join('');
    } catch(e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message,'error');
    }
}

// ── En Curso ──────────────────────────────────────────────────────────────────
let _enCursoFilter = 'activos';
let _enCursoTec    = '';
let _enCursoAll    = [];
let _enCursoSort   = 'sla';

function enCursoSetSort(mode, el) {
    _enCursoSort = mode;
    document.querySelectorAll('.ec-sort-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    _enCursoApply();
}

const _EC_PRIO_MAP = {highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24};
function _ecSlaScore(iss) {
    const f  = iss.fields||{};
    const pk = (f.priority?.name||'').toLowerCase().replace(/\s+/g,'');
    const slaHrs = _EC_PRIO_MAP[pk]||(pk.includes('high')?4:pk.includes('low')?24:8);
    const creMs  = f.created ? new Date(f.created).getTime() : 0;
    return creMs ? Math.round((Date.now()-creMs)/(slaHrs*3600000)*100) : 0;
}
let _enCursoChInst = null;

function enCursoFilter(f, el) {
    _enCursoFilter = f;
    document.querySelectorAll('#panel-enCurso .sa-pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
    if (_enCursoAll.length) { _enCursoApply(); return; }
    loadEnCurso();
}

function enCursoSetTec(email, el) {
    _enCursoTec = (_enCursoTec === email) ? '' : email;
    document.querySelectorAll('.ec-tec-btn').forEach(b => b.classList.remove('active'));
    if (_enCursoTec && el) el.classList.add('active');
    _enCursoApply();
}

async function loadEnCurso(force) {
    const list = document.getElementById('list-enCurso');
    if (!list) return;
    if (!force && _enCursoAll.length) { _enCursoApply(); return; }

    list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    const jql      = `project = INC AND "Tipo de Componente" = Workplace AND assignee is not EMPTY AND status NOT IN (Cerrado,Closed,Done,Resuelto,Resolved) ORDER BY created ASC`;
    const chartJql = `project = INC AND "Tipo de Componente" = Workplace AND assignee is not EMPTY AND created >= -7d ORDER BY created ASC`;
    const FIELDS   = ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate','customfield_11795'];
    try {
        const [data, chartData] = await Promise.all([
            jira('POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 200 }),
            jira('POST', '/rest/api/3/search/jql', { jql: chartJql, fields: ['created','status','resolutiondate'], maxResults: 300 })
        ]);
        _enCursoAll = data.issues || [];
        _enCursoTec = '';
        _enCursoRenderTecPills();
        _renderWeeklyChart('chartEnCursoWeekly', chartData.issues || [], '_enCursoChInst', 'En curso');
        _enCursoApply();
    } catch(e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

function _enCursoRenderTecPills() {
    const row   = document.getElementById('enCursoTecRow');
    const pills = document.getElementById('enCursoTecPills');
    if (!row || !pills) return;
    const tecMap = {};
    _enCursoAll.forEach(iss => {
        const a = iss.fields?.assignee; if (!a) return;
        const email = a.emailAddress||''; const name = a.displayName||email;
        if (email && !tecMap[email]) tecMap[email] = name;
    });
    const tecs = Object.entries(tecMap).sort((a,b) => a[1].localeCompare(b[1]));
    if (!tecs.length) { row.style.display='none'; return; }
    row.style.display = 'flex';
    pills.innerHTML = tecs.map(([email, name]) => {
        const ini = name.split(/\s+/).map(p=>p[0]||'').join('').slice(0,2).toUpperCase();
        const col = _techColor(name);
        const isAct = _enCursoTec === email;
        return `<button class="ec-tec-btn${isAct?' active':''}" onclick="enCursoSetTec('${incEsc(email)}',this)" title="${incEsc(name)}"
          style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 4px;border-radius:20px;border:1px solid ${isAct?col:'var(--border-soft)'};background:${isAct?col:'var(--bg-card)'};color:${isAct?'#fff':'var(--text-muted)'};cursor:pointer;font-size:11px;font-weight:600;transition:all .15s;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;background:${isAct?'rgba(255,255,255,.25)':col};color:#fff;font-size:9px;font-weight:700;">${ini||'?'}</span>
          ${incEsc(name.split(/\s+/).slice(0,2).join(' '))}
        </button>`;
    }).join('');
}

function _enCursoApply() {
    const list = document.getElementById('list-enCurso');
    if (!list) return;
    const ST = {
        activos:     s => !/cerr|done|closed|resuelto|resolved/.test(s.toLowerCase()),
        pendiente:   s => /pend/.test(s.toLowerCase()),
        en_progreso: s => /asignado n2|en progreso|in progress|n1\b|n2\b|n3\b/.test(s.toLowerCase()),
        todos:       () => true
    };
    const stFn = ST[_enCursoFilter] || ST.activos;
    const filtered = _enCursoAll.filter(iss =>
        stFn(iss.fields?.status?.name||'') &&
        (!_enCursoTec || iss.fields?.assignee?.emailAddress === _enCursoTec)
    );
    const total = filtered.length;
    const badge = document.getElementById('badge-enCurso');
    if (badge) { badge.textContent = total; badge.style.display = total ? '' : 'none'; }

    const nowMs = Date.now();
    const _pm   = {highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24};
    let cntB=0, cntC=0;
    filtered.forEach(iss => {
        const fi  = iss.fields||{};
        const pk  = (fi.priority?.name||'').toLowerCase().replace(/\s+/g,'');
        const hrs = _pm[pk]||(pk.includes('high')?4:pk.includes('low')?24:8);
        const cm  = fi.created ? new Date(fi.created).getTime() : 0;
        if (cm) { if(nowMs-cm>hrs*3600000) cntB++; else if(Math.round((nowMs-cm)/(hrs*3600000)*100)>=80) cntC++; }
    });
    const uniqTecs = new Set(filtered.map(i=>i.fields?.assignee?.emailAddress).filter(Boolean)).size;
    const statsEl  = document.getElementById('stats-enCurso');
    if (statsEl) statsEl.innerHTML = `
        <div class="stat-card"><div class="stat-val c-blue">${total}</div><div class="stat-lbl">Total</div></div>
        <div class="stat-card"><div class="stat-val c-red">${cntB}</div><div class="stat-lbl">SLA vencido</div></div>
        <div class="stat-card"><div class="stat-val c-amber">${cntC}</div><div class="stat-lbl">SLA crítico</div></div>
        <div class="stat-card"><div class="stat-val" style="color:#7c3aed;">${uniqTecs}</div><div class="stat-lbl">Técnicos</div></div>`;

    const sub = document.getElementById('incTopbarSub');
    if (sub) sub.textContent = (_enCursoTec ? '1 técnico · ' : '') + total + ' tickets en curso';

    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;"></i><p>No hay tickets para este filtro</p></div>`;
        return;
    }

    const sorted = [...filtered].sort((a, b) => {
        if (_enCursoSort === 'fecha_asc')  return new Date(a.fields?.created||0) - new Date(b.fields?.created||0);
        if (_enCursoSort === 'fecha_desc') return new Date(b.fields?.created||0) - new Date(a.fields?.created||0);
        return _ecSlaScore(b) - _ecSlaScore(a); // 'sla': más urgente primero
    });
    list.innerHTML = sorted.map(i => renderTicket(i)).join('');
}

// ── Categorías (ex Sin Categorizar) ───────────────────────────────────────────
let _sinCatAll     = [];
let _sinCatTec     = '';
let _sinCatSearch  = '';
let _sinCatLoading = false;  // guard: evita dos cargas simultáneas

function _sinCatPeriod() {
    const el = document.getElementById('sinCatPeriod');
    return el ? parseInt(el.value) : 30;
}

// Paginación secuencial con nextPageToken (único modo soportado por /rest/api/3/search/jql)
async function _sinCatFetchAll(jql, fields, progEl) {
    const all = [];
    let npt;
    do {
        const body = { jql, fields, maxResults: 100 };
        if (npt) body.nextPageToken = npt;
        const d = await jira('POST', '/rest/api/3/search/jql', body);
        all.push(...(d.issues || []));
        if (progEl) progEl.textContent = `${all.length} tickets…`;
        npt = (d.isLast === false && d.nextPageToken) ? d.nextPageToken : null;
    } while (npt);
    return all;
}

async function loadSinCategorizar(force) {
    const list = document.getElementById('list-sinCat');
    if (!list) return;
    if (_sinCatLoading && !force) return;  // ya cargando en background

    const period = _sinCatPeriod();
    const CKEY   = `sincategorizar:v3:${period}`;

    const cached = !force && _cacheGet(CKEY);
    if (cached) { _sinCatAll = cached; _sinCatTec = ''; _sinCatSearch = ''; _sinCatBuildPills(); _sinCatApply(); loadCategoryStats(); return; }
    if (!force && _sinCatAll.length) { _sinCatBuildPills(); _sinCatApply(); return; }

    _sinCatLoading = true;
    loadCategoryStats();

    // Mostrar skeleton solo si el panel está visible
    const panelVisible = document.getElementById('panel-sinCat')?.classList.contains('active');
    if (panelVisible) list.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';

    const progEl = document.getElementById('sinCatProgress');
    if (progEl) progEl.textContent = 'Cargando…';

    const dateFilter = period > 0 ? ` AND updated >= -${period}d` : '';
    const jql    = `project = INC AND "Tipo de Componente" = Workplace AND status IN (Cerrado,Closed,Done,Resuelto,Resolved)${dateFilter} ORDER BY updated DESC`;
    const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','resolutiondate','customfield_15147'];

    try {
        const all = await _sinCatFetchAll(jql, FIELDS, progEl);

        const _sinJira = all.filter(i => !i.fields?.customfield_15147);
        let _localCats = {};
        try {
            const lcR = await fetch('/tickets/local-wp-cats', { credentials: 'include' });
            if (lcR.ok) { const lcJ = await lcR.json(); _localCats = lcJ.cats || {}; }
        } catch(_) {}

        _sinCatAll = _sinJira.filter(i => !_localCats[i.key]);
        _cacheSet(CKEY, _sinCatAll);
        if (progEl) progEl.textContent = '';
        _sinCatTec = '';
        _sinCatSearch = '';
        _sinCatBuildPills();
        _sinCatApply();
    } catch(e) {
        if (progEl) progEl.textContent = '';
        if (panelVisible) list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    } finally {
        _sinCatLoading = false;
    }
}

function sinCatSetTec(name, el) {
    _sinCatTec = (_sinCatTec === name) ? '' : name;
    document.querySelectorAll('.sc-tec-btn').forEach(b => b.classList.remove('active'));
    if (_sinCatTec && el) el.classList.add('active');
    _sinCatApply();
}

function _sinCatBuildPills() {
    const row   = document.getElementById('sinCatTecRow');
    const pills = document.getElementById('sinCatTecPills');
    if (!row || !pills) return;

    // Agrupar por técnico y contar
    const byTec = {};
    _sinCatAll.forEach(iss => {
        const name = iss.fields?.assignee?.displayName || iss.fields?.assignee?.emailAddress || 'Sin asignar';
        byTec[name] = (byTec[name] || 0) + 1;
    });
    const sorted = Object.entries(byTec).sort((a,b) => b[1]-a[1]);
    if (!sorted.length) { row.style.display = 'none'; return; }

    row.style.display = 'flex';
    pills.innerHTML = sorted.map(([name, cnt]) => {
        const ini = name.split(/\s+/).map(p=>p[0]||'').join('').slice(0,2).toUpperCase();
        const col = _techColor(name);
        const isAct = _sinCatTec === name;
        return `<button class="sc-tec-btn${isAct?' active':''}" onclick="sinCatSetTec('${incEsc(name)}',this)" title="${incEsc(name)}"
          style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 4px;border-radius:20px;border:1px solid ${isAct?col:'var(--border-soft)'};background:${isAct?col:'var(--bg-card)'};color:${isAct?'#fff':'var(--text-muted)'};cursor:pointer;font-size:11px;font-weight:600;transition:all .15s;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;background:${isAct?'rgba(255,255,255,.25)':col};color:#fff;font-size:9px;font-weight:700;">${ini||'?'}</span>
          ${incEsc(name.split(/\s+/).slice(0,2).join(' '))}
          <span style="font-size:9px;opacity:.7;">${cnt}</span>
        </button>`;
    }).join('');
}

function _sinCatApply() {
    const list  = document.getElementById('list-sinCat');
    const badge = document.getElementById('badge-sinCat');
    const stats = document.getElementById('stats-sinCat');
    const sub   = document.getElementById('incTopbarSub');
    if (!list) return;

    let filtered = _sinCatAll;
    if (_sinCatTec) {
        filtered = filtered.filter(i => {
            const name = i.fields?.assignee?.displayName || i.fields?.assignee?.emailAddress || 'Sin asignar';
            return name === _sinCatTec;
        });
    }
    if (_sinCatSearch) {
        const sq = _sinCatSearch.toLowerCase();
        filtered = filtered.filter(i =>
            (i.key||'').toLowerCase().includes(sq) ||
            (i.fields?.reporter?.emailAddress||'').toLowerCase().includes(sq) ||
            (i.fields?.reporter?.displayName||'').toLowerCase().includes(sq) ||
            (i.fields?.summary||'').toLowerCase().includes(sq)
        );
    }

    const total = _sinCatAll.length;
    const shown = filtered.length;

    if (badge) { badge.textContent = total; badge.style.display = total ? '' : 'none'; }
    if (sub) sub.textContent = (_sinCatTec ? `${_sinCatTec} · ` : '') + shown + ' sin categorizar (de ' + total + ' total)';

    // Stats: total + top técnicos por cantidad
    const byTec = {};
    _sinCatAll.forEach(iss => {
        const n = iss.fields?.assignee?.displayName || iss.fields?.assignee?.emailAddress || 'Sin asignar';
        byTec[n] = (byTec[n]||0) + 1;
    });
    const top4 = Object.entries(byTec).sort((a,b)=>b[1]-a[1]).slice(0,4);
    if (stats) stats.innerHTML = `
        <div class="stat-card"><div class="stat-val c-red">${total}</div><div class="stat-lbl">Sin categorizar</div></div>
        ${top4.map(([n,c],i)=>{
            const colors=['#ef4444','#f59e0b','#8b5cf6','#3b82f6'];
            return `<div class="stat-card" style="cursor:pointer;" onclick="sinCatSetTec('${incEsc(n)}',null)">
                <div class="stat-val" style="color:${colors[i]||'#64748b'};">${c}</div>
                <div class="stat-lbl" title="${incEsc(n)}">${incEsc(n.split(/\s+/).slice(0,2).join(' '))}</div>
            </div>`;
        }).join('')}`;

    if (!shown) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;font-size:2rem;"></i><p style="color:#10b981;font-weight:600;">Sin resultados para este técnico</p></div>`;
        return;
    }
    list.innerHTML = filtered.map(i => {
        const f   = i.fields||{};
        const key = i.key;
        const sum = incEsc(f.summary||'(sin resumen)');
        const st  = f.status?.name||'—';
        const pr  = f.priority?.name||'—';
        const asgn= f.assignee?.displayName || f.assignee?.emailAddress || 'Sin asignar';
        const rep = f.reporter?.emailAddress || f.reporter?.displayName || '—';
        const upd = incFmtDate(f.updated);
        const res = incFmtDate(f.resolutiondate);
        return `<div class="ticket-card" style="border-left:4px solid #f59e0b;">
          <div class="tc-top">
            <span class="tc-key">${key}</span>
            ${incPrioBadge(pr)}
            <span class="tc-summary">${sum}</span>
            <span style="margin-left:auto;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);color:#b45309;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;flex-shrink:0;"><i class="bi bi-flag"></i> Sin categorizar</span>
            <span class="status-badge ${incStatusClass(st)}">${st}</span>
            ${incAvatar(asgn)}
          </div>
          <div class="tc-meta">
            <span><span class="meta-lbl">Técnico</span><b>${incEsc(asgn)}</b></span>
            <span><span class="meta-lbl">Reporter</span><b>${incEsc(rep)}</b></span>
            <span><span class="meta-lbl">Prioridad</span><b>${incEsc(pr)}</b></span>
            <span><span class="meta-lbl">Resuelto</span><b>${res||'—'}</b></span>
            <span><span class="meta-lbl">Actualizado</span><b>${upd}</b></span>
          </div>
          <div class="tc-actions">
            <button class="btn-outline-sm" style="font-size:12px;color:#d97706;border-color:rgba(217,119,6,.4);font-weight:700;" onclick="openCategorizeModal('${key}')"><i class="bi bi-tag-fill"></i> Categorizar</button>
            <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleComentarInc('${key}',this)"><i class="bi bi-chat-dots"></i> Comentar</button>
            <button class="btn-outline-sm" style="font-size:12px;color:#6366f1;border-color:rgba(99,102,241,.3);" onclick="openTimeline('${key}')"><i class="bi bi-clock-history"></i> Timeline</button>
            <a href="https://integratelperu.atlassian.net/browse/${key}" target="_blank" class="btn-outline-sm" style="font-size:12px;text-decoration:none;margin-left:auto;"><i class="bi bi-box-arrow-up-right"></i> Jira</a>
          </div>
          <div class="asig-inline" id="comentar-${key}" style="display:none;padding:12px;border:1px solid var(--border-soft);border-radius:8px;margin-top:8px;background:var(--bg-card);">
            <textarea id="comentar-input-${key}" class="form-control-custom" rows="2" placeholder="Escribe un comentario..." style="resize:vertical;margin-bottom:8px;"></textarea>
            <div style="display:flex;gap:8px;">
              <button class="btn-create" style="padding:7px 14px;font-size:12px;" onclick="ejecutarComentar('${key}')">Enviar</button>
              <button class="btn-outline-sm" style="font-size:12px;" onclick="toggleComentarInc('${key}')">Cancelar</button>
            </div>
          </div>
        </div>`;
    }).join('');
}

// ── Buscar ticket ─────────────────────────────────────────────────────────────
// ── Alertas (panel Buscar) ─────────────────────────────────────────────────────
let _alertaFilter = 'sla_vencido';

function alertaFilter(f, el) {
    _alertaFilter = f;
    document.querySelectorAll('#section-alertas .sa-pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');
    loadAlertas();
}

async function loadAlertas() {
    const list  = document.getElementById('list-alertas');
    const stats = document.getElementById('stats-alertas');
    if (!list) return;
    list.innerHTML  = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
    if (stats) stats.innerHTML = '';

    const sort  = document.getElementById('incSearchSort')?.value || 'DESC';
    const BASE = 'project = INC AND "Tipo de Componente" = Workplace';
    const OPEN = 'status NOT IN (Cerrado,Resuelto,Done,Closed,Cancelled,Cancelado)';
    const JQL_MAP = {
        sla_vencido: `${BASE} AND ${OPEN} AND created <= "-1d" ORDER BY priority ASC, created ${sort}`,
        pendiente:   `${BASE} AND status = Pendiente ORDER BY updated ${sort}`,
        cancelado:   `${BASE} AND status IN (Cancelado,Cancelled) AND updated >= -30d ORDER BY updated ${sort}`,
        observado:   `${BASE} AND status NOT IN ("Asignado N2","Asignado N1","En N2","En N1",Pendiente,Cerrado,Resuelto,Done,Closed,Cancelled,Cancelado) ORDER BY updated ${sort}`,
        todos_prob:  `${BASE} AND (status IN (Pendiente,Cancelado,Cancelled) OR (${OPEN} AND created <= "-1d")) ORDER BY priority ASC, created ${sort}`,
    };
    const jql = JQL_MAP[_alertaFilter] || JQL_MAP.sla_vencido;
    const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate','customfield_11795'];

    try {
        const data  = await jira('POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 100 });
        let items   = data.issues || [];

        // For sla_vencido: filter client-side to actual SLA breaches by priority
        if (_alertaFilter === 'sla_vencido' || _alertaFilter === 'todos_prob') {
            const now = Date.now();
            const SLA = { highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24 };
            if (_alertaFilter === 'sla_vencido') {
                items = items.filter(i => {
                    const f  = i.fields || {};
                    const pk = (f.priority?.name||'').toLowerCase().replace(/\s+/g,'');
                    const h  = SLA[pk] || (pk.includes('high') ? 4 : pk.includes('low') ? 24 : 8);
                    const cm = f.created ? new Date(f.created).getTime() : 0;
                    return cm && (now - cm) > h * 3600000;
                });
            }
        }

        // Stats from loaded items
        const nowMs = Date.now();
        const SLA_M = { highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24 };
        let cntBreach = 0, cntCritical = 0, cntUnassg = 0;
        for (const i of items) {
            const fi = i.fields || {};
            if (!fi.assignee) cntUnassg++;
            const pk  = (fi.priority?.name||'').toLowerCase().replace(/\s+/g,'');
            const hrs = SLA_M[pk] || (pk.includes('high') ? 4 : pk.includes('low') ? 24 : 8);
            const cm  = fi.created ? new Date(fi.created).getTime() : 0;
            if (cm) {
                const rem = cm + hrs*3600000 - nowMs;
                const pct = Math.min(100, Math.round((nowMs-cm)/(hrs*3600000)*100));
                if (rem <= 0) cntBreach++;
                else if (pct >= 80) cntCritical++;
            }
        }

        if (stats) stats.innerHTML = `
            <div class="stat-card"><div class="stat-val c-blue">${items.length}</div><div class="stat-lbl">Total</div></div>
            <div class="stat-card"><div class="stat-val" style="color:#7c3aed;">${cntUnassg}</div><div class="stat-lbl">Sin asignar</div></div>
            <div class="stat-card"><div class="stat-val c-red">${cntBreach}</div><div class="stat-lbl">SLA vencido</div></div>
            <div class="stat-card"><div class="stat-val c-amber">${cntCritical}</div><div class="stat-lbl">SLA crítico</div></div>
        `;

        if (!items.length) {
            const msgs = {
                sla_vencido:'No hay tickets con SLA vencido',
                pendiente:  'No hay tickets en Pendiente',
                cancelado:  'No hay cancelados recientes',
                observado:  'No hay tickets en estados inusuales',
                todos_prob: 'No hay tickets con problemas',
            };
            list.innerHTML = `<div class="empty-state"><i class="bi bi-check2-circle" style="color:#10b981;"></i><p>${msgs[_alertaFilter]||'Sin resultados'}</p></div>`;
            return;
        }
        // Dedup DOM IDs
        items.forEach(i => {
            ['card','asig','cerrar','comentar','pendiente','reanudar','trans','tq'].forEach(pfx => {
                const el = document.getElementById(`${pfx}-${i.key}`);
                if (el && !el.closest('#list-alertas')) el.remove();
            });
        });
        list.innerHTML = items.map(i => renderTicket(i)).join('');
    } catch(e) {
        list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle" style="color:#ef4444;"></i><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

// ── Reportes ──────────────────────────────────────────────────────────────────
let _rptIssues = [];
let _rptInit   = false;

function initReportes() {
    if (_rptInit) return;
    _rptInit = true;
    rptSetDays(30);
    const today   = new Date().toISOString().slice(0, 10);
    const from30  = new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);
    const _defJql = `project = INC AND "Tipo de Componente" = Workplace AND created >= "${from30}" AND created <= "${today}" ORDER BY created DESC`;
    const _hasCache = !!_cacheGet('rpt:' + _defJql + ':500');
    setTimeout(function() { if (typeof runReporte === 'function') runReporte(); }, _hasCache ? 0 : 120);
}

async function preloadReportes() {
    const today  = new Date().toISOString().slice(0, 10);
    const from30 = new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);
    const jql    = `project = INC AND "Tipo de Componente" = Workplace AND created >= "${from30}" AND created <= "${today}" ORDER BY created DESC`;
    const CKEY   = 'rpt:' + jql + ':500';
    if (_cacheGet(CKEY)) return;
    try {
        const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','resolutiondate','comment'];
        const issues = []; let nextPageToken;
        while (issues.length < 500) {
            const body = { jql, fields: FIELDS, maxResults: Math.min(100, 500 - issues.length) };
            if (nextPageToken) body.nextPageToken = nextPageToken;
            const data = await jira('POST', '/rest/api/3/search/jql', body);
            const batch = data.issues || [];
            issues.push(...batch);
            if (!batch.length || data.isLast !== false || !data.nextPageToken) break;
            nextPageToken = data.nextPageToken;
        }
        _cacheSet(CKEY, issues);
    } catch(e) { /* silent background preload */ }
}

function rptRadioClick(el) {
    const grp = el.dataset.grp;
    document.querySelectorAll(`.rpt-radio[data-grp="${grp}"]`).forEach(r => r.classList.remove('active'));
    el.classList.add('active');
}

function rptSetDays(n) {
    const today = new Date().toISOString().slice(0, 10);
    const el_h = document.getElementById('rpt-hasta');
    const el_d = document.getElementById('rpt-desde');
    if (el_h) el_h.value = today;
    if (el_d) el_d.value = n > 0 ? new Date(Date.now() - n*86400000).toISOString().slice(0, 10) : '';
}

function _rptGetActiveVals(grp) {
    return [...document.querySelectorAll(`.rpt-pill[data-grp="${grp}"].active`)].map(p => p.dataset.val);
}
function _rptGetRadioVal(grp) {
    return document.querySelector(`.rpt-radio[data-grp="${grp}"].active`)?.dataset?.val ?? '';
}

async function runReporte() {
    const desde    = document.getElementById('rpt-desde')?.value || '';
    const hasta    = document.getElementById('rpt-hasta')?.value || '';
    const assignee = (document.getElementById('rpt-assignee')?.value || '').trim();
    const reporter = (document.getElementById('rpt-reporter')?.value || '').trim();
    const estados  = _rptGetActiveVals('estado');
    const prios    = _rptGetActiveVals('prio');
    const slaFilt  = _rptGetRadioVal('sla');
    const maxRes   = parseInt(_rptGetRadioVal('maxres')) || 500;

    const fmtHrs  = h => h < 1 ? Math.round(h*60)+'min' : h < 24 ? h.toFixed(1)+'h' : Math.round(h/24)+'d';
    const fmtDate = d => d ? new Date(d).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';

    const clauses = ['project = INC AND "Tipo de Componente" = Workplace'];
    if (desde)           clauses.push(`created >= "${desde}"`);
    if (hasta)           clauses.push(`created <= "${hasta}"`);
    if (estados.length)  clauses.push(`status IN (${estados.map(s=>`"${s}"`).join(',')})`);
    if (prios.length)    clauses.push(`priority IN (${prios.map(p=>`"${p}"`).join(',')})`);
    if (assignee)        clauses.push(`assignee = "${assignee}"`);
    if (reporter)        clauses.push(`reporter = "${reporter}"`);
    const jql = clauses.join(' AND ') + ' ORDER BY created DESC';
    const _RPT_CKEY = 'rpt:' + jql + ':' + maxRes;
    const _rptCached = _cacheGet(_RPT_CKEY);

    const preview = document.getElementById('rpt-preview');
    const summary = document.getElementById('rpt-summary');
    const btnCsv  = document.getElementById('btn-export-csv');
    const btnXlsx = document.getElementById('btn-export-xlsx');
    function _rptBtnsEnabled(on) {
        [btnCsv, btnXlsx].forEach(b => { if (!b) return; b.disabled = !on; b.style.opacity = on ? '1' : '.4'; b.style.cursor = on ? '' : 'not-allowed'; b.title = on ? '' : 'Genera el reporte primero'; });
    }
    if (!_rptCached) {
        if (preview) preview.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';
        if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }
        _rptBtnsEnabled(false);
    }

    try {
        let rawIssues;
        if (_rptCached) {
            rawIssues = _rptCached;
        } else {
            const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','resolutiondate','comment'];
            rawIssues = []; let nextPageToken;
            while (rawIssues.length < maxRes) {
                const body = { jql, fields: FIELDS, maxResults: Math.min(100, maxRes - rawIssues.length) };
                if (nextPageToken) body.nextPageToken = nextPageToken;
                const data = await jira('POST', '/rest/api/3/search/jql', body);
                const batch = data.issues || [];
                rawIssues.push(...batch);
                if (!batch.length || data.isLast !== false || !data.nextPageToken) break;
                nextPageToken = data.nextPageToken;
            }
            _cacheSet(_RPT_CKEY, rawIssues);
        }
        let issues = rawIssues.slice();

        // Enrich with SLA data (always fresh timestamps)
        const now = Date.now();
        const SLA_H = { highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24 };
        issues = issues.map(issue => {
            const f    = issue.fields || {};
            const pk   = (f.priority?.name||'').toLowerCase().replace(/\s+/g,'');
            const slaH = SLA_H[pk] || (pk.includes('high')?4:pk.includes('low')?24:8);
            const creMs = f.created ? new Date(f.created).getTime() : 0;
            const resMs = f.resolutiondate ? new Date(f.resolutiondate).getTime() : 0;
            const stL   = (f.status?.name||'').toLowerCase();
            const isDone = /cerr|done|closed|resuelto|resolved/.test(stL);
            const ageMs = isDone && resMs ? resMs - creMs : creMs ? now - creMs : 0;
            const ageH  = ageMs / 3600000;
            const dlMs  = creMs + slaH*3600000;
            const remH  = isDone && resMs ? (dlMs - resMs)/3600000 : creMs ? (dlMs - now)/3600000 : null;
            let slaStatus = '—';
            if (creMs) {
                if (isDone && resMs)  slaStatus = ageH <= slaH ? 'Cumplido' : 'Vencido';
                else if (!isDone)     slaStatus = (now-creMs) > slaH*3600000 ? 'Vencido' : (now-creMs) > slaH*3600000*0.8 ? 'En riesgo' : 'En curso';
            }
            issue._sla = { slaH, ageH, slaStatus, remH };
            return issue;
        });

        // Client-side SLA filter
        if (slaFilt === 'ok')     issues = issues.filter(i => i._sla.slaStatus === 'Cumplido');
        if (slaFilt === 'breach') issues = issues.filter(i => i._sla.slaStatus === 'Vencido');
        if (slaFilt === 'risk')   issues = issues.filter(i => i._sla.slaStatus === 'En riesgo');

        _rptIssues = issues;
        const total    = issues.length;
        const cntClose = issues.filter(i => /cerr|done|closed|resuelto|resolved/.test((i.fields?.status?.name||'').toLowerCase())).length;
        const cntOpen  = total - cntClose;
        const cntSlaOk = issues.filter(i => i._sla.slaStatus === 'Cumplido').length;
        const cntSlaBd = issues.filter(i => i._sla.slaStatus === 'Vencido').length;
        const cntUnassg = issues.filter(i => !i.fields?.assignee).length;
        const doneIssues = issues.filter(i => i._sla.ageH > 0 && /cerr|done|closed|resuelto|resolved/.test((i.fields?.status?.name||'').toLowerCase()));
        const avgMttr  = doneIssues.length ? doneIssues.reduce((s,i)=>s+i._sla.ageH,0)/doneIssues.length : 0;
        const slaPct   = (cntSlaOk+cntSlaBd) ? Math.round(cntSlaOk/(cntSlaOk+cntSlaBd)*100) : null;

        if (summary) {
            summary.style.display = '';
            summary.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;">
                <div class="stat-card"><div class="stat-val c-blue">${total}</div><div class="stat-lbl">Total</div></div>
                <div class="stat-card"><div class="stat-val c-amber">${cntOpen}</div><div class="stat-lbl">Abiertos</div></div>
                <div class="stat-card"><div class="stat-val c-green">${cntClose}</div><div class="stat-lbl">Cerrados</div></div>
                <div class="stat-card"><div class="stat-val" style="color:#7c3aed;">${cntUnassg}</div><div class="stat-lbl">Sin asignar</div></div>
                <div class="stat-card"><div class="stat-val c-green">${cntSlaOk}</div><div class="stat-lbl">SLA OK</div></div>
                <div class="stat-card"><div class="stat-val c-red">${cntSlaBd}</div><div class="stat-lbl">SLA vencido</div></div>
                <div class="stat-card"><div class="stat-val ${slaPct!=null?(slaPct>=80?'c-green':'c-red'):''}">${slaPct!=null?slaPct+'%':'—'}</div><div class="stat-lbl">SLA %</div></div>
                <div class="stat-card"><div class="stat-val" style="color:#7c3aed;">${avgMttr?fmtHrs(avgMttr):'—'}</div><div class="stat-lbl">MTTR prom.</div></div>
            </div>`;
        }

        const COLS = ['Key','Summary','Estado','Prioridad','Asignado','Reporter','Creado','Actualizado','Resuelto','Edad','SLA Meta','SLA Restante','Estado SLA','Comentarios'];
        const previewRows = issues.slice(0, 20);

        if (preview) {
            const rows = previewRows.map((issue, idx) => {
                const f   = issue.fields || {};
                const sla = issue._sla;
                const slaClr = {Cumplido:'#10b981',Vencido:'#ef4444','En riesgo':'#f59e0b','En curso':'#3b82f6'}[sla.slaStatus] || 'var(--text-muted)';
                return `<tr>
                    <td><a href="https://integratelperu.atlassian.net/browse/${issue.key}" target="_blank" style="color:var(--jira-blue);font-weight:700;font-family:monospace;">${issue.key}</a></td>
                    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;" title="${incEsc(f.summary||'')}">${incEsc((f.summary||'').slice(0,55))}${(f.summary||'').length>55?'…':''}</td>
                    <td><span class="status-badge ${incStatusClass(f.status?.name||'')}" style="font-size:10px;">${f.status?.name||'—'}</span></td>
                    <td><span class="inc-prio ${incPrioClass(f.priority?.name||'')}"></span> ${incEsc(f.priority?.name||'—')}</td>
                    <td style="font-size:10px;color:var(--text-muted);">${incEsc((f.assignee?.displayName||f.assignee?.emailAddress||'Sin asignar'))}</td>
                    <td style="font-size:10px;color:var(--text-muted);">${incEsc((f.reporter?.displayName||f.reporter?.emailAddress||'—'))}</td>
                    <td style="font-family:monospace;font-size:10px;">${f.created?new Date(f.created).toLocaleDateString('es-PE'):'—'}</td>
                    <td style="font-family:monospace;font-size:10px;">${f.updated?new Date(f.updated).toLocaleDateString('es-PE'):'—'}</td>
                    <td style="font-family:monospace;font-size:10px;">${f.resolutiondate?new Date(f.resolutiondate).toLocaleDateString('es-PE'):'—'}</td>
                    <td style="font-family:monospace;font-size:10px;color:var(--text-muted);">${sla.ageH?fmtHrs(sla.ageH):'—'}</td>
                    <td style="font-family:monospace;font-size:10px;color:var(--text-muted);">${sla.slaH}h</td>
                    <td style="font-family:monospace;font-size:10px;color:${sla.remH!=null&&sla.remH<0?'#ef4444':'var(--text-muted)'};">${sla.remH!=null?fmtHrs(Math.abs(sla.remH))+(sla.remH<0?' vencido':''):'—'}</td>
                    <td style="font-weight:700;font-size:11px;color:${slaClr};">${sla.slaStatus}</td>
                    <td style="font-family:monospace;font-size:10px;color:var(--text-muted);text-align:center;">${f.comment?.comments?.length||0}</td>
                </tr>`;
            }).join('');

            preview.innerHTML = `
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;">
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border-soft);">
                    <span style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;">
                        Vista previa — ${total} filas en total${total>20?' · mostrando primeras 20':''}
                    </span>
                    <span style="font-size:10px;color:var(--text-muted);">JQL: <code style="font-size:9px;background:var(--bg-header);padding:1px 5px;border-radius:3px;">${incEsc(jql.slice(0,100))}${jql.length>100?'…':''}</code></span>
                </div>
                <div style="overflow-x:auto;">
                    <table class="rpt-table" style="width:100%;border-collapse:collapse;">
                        <thead><tr>${COLS.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
        }

        _rptBtnsEnabled(true);
        showToast(`${total} tickets cargados${_rptCached ? ' ⚡' : ''}`, 'success');

    } catch(e) {
        if (preview) preview.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message, 'error');
    }
}

function exportarReporte(format) {
    if (!_rptIssues.length) { showToast('Primero genera el reporte', 'error'); return; }
    const fmtDate = d => d ? new Date(d).toLocaleString('es-PE') : '';
    const today   = new Date().toISOString().slice(0, 10);

    const headers = ['Key','Summary','Estado','Prioridad','Asignado (email)','Asignado (nombre)','Reporter (email)','Reporter (nombre)','Creado','Actualizado','Fecha Resolución','Edad (h)','SLA Meta (h)','SLA Restante (h)','Estado SLA','# Comentarios'];
    const rows = _rptIssues.map(issue => {
        const f   = issue.fields || {};
        const sla = issue._sla;
        return [
            issue.key,
            f.summary || '',
            f.status?.name || '',
            f.priority?.name || '',
            f.assignee?.emailAddress || '',
            f.assignee?.displayName  || '',
            f.reporter?.emailAddress || '',
            f.reporter?.displayName  || '',
            fmtDate(f.created),
            fmtDate(f.updated),
            fmtDate(f.resolutiondate),
            sla.ageH  ? +sla.ageH.toFixed(2)  : '',
            sla.slaH  || '',
            sla.remH  != null ? +sla.remH.toFixed(2) : '',
            sla.slaStatus || '',
            f.comment?.comments?.length || 0,
        ];
    });

    if (format === 'csv') {
        const BOM  = '﻿';
        const esc  = v => `"${String(v).replace(/"/g,'""')}"`;
        const csv  = BOM + [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
        _rptDownload(new Blob([csv],{type:'text/csv;charset=utf-8;'}), `reporte_INC_${today}.csv`);
    } else {
        _loadSheetJS().then(XLSX => {
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            ws['!cols'] = [12,45,16,12,32,22,32,22,18,18,18,10,10,12,12,8].map(w=>({wch:w}));
            // Bold header row
            const range = XLSX.utils.decode_range(ws['!ref']);
            for (let c = range.s.c; c <= range.e.c; c++) {
                const cell = ws[XLSX.utils.encode_cell({r:0,c})];
                if (cell) cell.s = { font:{bold:true}, fill:{fgColor:{rgb:'0052CC'}}, font:{color:{rgb:'FFFFFF'},bold:true} };
            }
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Reporte INC');
            XLSX.writeFile(wb, `reporte_INC_${today}.xlsx`);
        }).catch(() => showToast('Error cargando librería Excel — usa CSV', 'error'));
    }
}

function _rptDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function _loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((resolve, reject) => {
        const s  = document.createElement('script');
        s.src    = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => resolve(window.XLSX);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ── Analizador ────────────────────────────────────────────────────────────────
let _anInited  = false;
let _anLibsOk  = false;
let _anDbDays  = 90;
let _anDbCharts = {};   // keyed Chart instances for the Jira dashboard
const _AN_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444'];
let _an = _anNewState();
let _anSqlData = { rows:[], cols:[] };
let _anReports = [];
let _anBoardCharts = {};

function _anNewState() {
    return { files:[], allRows:[], allCols:[], types:{}, filtered:[], search:'', filters:{}, sortCol:null, sortDir:'asc', page:1, pageSize:25, charts:[], _searchTimer:null };
}

function initAnalizador() {
    if (_anInited) return;
    _anInited = true;
    _anLoadLibs();
    anSwitchTab(0);
    anLoadSchema();
    anLoadHistory();
    requestAnimationFrame(() => {
        const s = document.getElementById('incScrollArea');
        if (s) s.scrollTop = 0;
    });
}

function anDbPeriod(days, el) {
    _anDbDays = days;
    document.querySelectorAll('.jdb-period-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    loadAnJiraBoard();
}

async function _fetchAnJiraIssues() {
    const dateClause = _anDbDays > 0 ? ` AND created >= -${_anDbDays}d` : '';
    const BASE_JQL = `project = INC AND "Tipo de Componente" = Workplace${dateClause}`;
    const FIELDS = ['summary','status','priority','assignee','reporter','created','resolutiondate'];
    let issues = [], token;
    while (true) {
        const body = { jql: BASE_JQL + ' ORDER BY created DESC', fields: FIELDS, maxResults: 100 };
        if (token) body.nextPageToken = token;
        const d = await jira('POST', '/rest/api/3/search/jql', body);
        issues.push(...(d.issues || []));
        if (!d.issues?.length || d.isLast !== false || !d.nextPageToken || issues.length >= 2000) break;
        token = d.nextPageToken;
    }
    return issues;
}

async function loadAnJiraBoard() {
    const CKEY = `jira-board-${_anDbDays}`;
    const kpisEl = document.getElementById('anDbKpis');
    const errEl  = document.getElementById('anDbError');
    if (errEl) errEl.style.display = 'none';

    const cached = _cacheGet(CKEY);
    if (cached) {
        _renderAnJiraBoard(cached);
        _fetchAnJiraIssues().then(issues => _cacheSet(CKEY, issues)).catch(()=>{});
        return;
    }

    if (kpisEl) kpisEl.innerHTML = [1,2,3,4,5].map(() =>
        '<div class="jdb-skeleton" style="height:60px;border-radius:10px;flex:1;min-width:90px;"></div>').join('');

    try {
        const issues = await _fetchAnJiraIssues();
        _cacheSet(CKEY, issues);
        _renderAnJiraBoard(issues);
    } catch(e) {
        if (kpisEl) kpisEl.innerHTML = '';
        if (errEl) { errEl.style.display=''; errEl.innerHTML=`<i class="bi bi-exclamation-circle" style="color:#ef4444;"></i> ${incEsc(e.message)}`; }
    }
}

function _renderAnJiraBoard(issues) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tc   = isDark ? '#94a3b8' : '#64748b';
    const grid = isDark ? 'rgba(148,163,184,.1)' : 'rgba(0,0,0,.06)';
    const kpisEl = document.getElementById('anDbKpis');
    const errEl  = document.getElementById('anDbError');

    if (!issues.length) {
        if (kpisEl) kpisEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px;">Sin datos para el período seleccionado.</div>';
        return;
    }

    const now = Date.now();
    const SLA_H = { highest:1,p1:1,critical:1, high:4,p2:4, medium:8,p3:8, low:24,p4:24, lowest:24 };
    // Compute SLA per issue (idempotent)
    issues.forEach(issue => {
            const f = issue.fields || {};
            const pk = (f.priority?.name||'').toLowerCase().replace(/\s+/g,'');
            const slaH = SLA_H[pk] || 8;
            const creMs = f.created ? new Date(f.created).getTime() : 0;
            const resMs = f.resolutiondate ? new Date(f.resolutiondate).getTime() : 0;
            const stL = (f.status?.name||'').toLowerCase();
            const isDone = /cerr|done|closed|resuelto|resolved/.test(stL);
            const ageH = isDone && resMs ? (resMs-creMs)/3600000 : creMs ? (now-creMs)/3600000 : 0;
            issue._slaOk = creMs ? (isDone && resMs ? ageH <= slaH : (now-creMs)/3600000 <= slaH) : null;
            issue._done = isDone;
            issue._cre = creMs;
        });

        // ── KPIs ──
        const total  = issues.length;
        const closed = issues.filter(i => i._done).length;
        const open   = total - closed;
        const slaOk  = issues.filter(i => i._slaOk === true).length;
        const slaTot = issues.filter(i => i._slaOk !== null).length;
        const slaPct = slaTot ? Math.round(slaOk/slaTot*100) : null;
        const unassg = issues.filter(i => !i.fields?.assignee).length;

        if (kpisEl) kpisEl.innerHTML = `
          <div class="jdb-kpi"><div class="jdb-kpi-v c-blue">${total.toLocaleString()}</div><div class="jdb-kpi-l">Total</div></div>
          <div class="jdb-kpi"><div class="jdb-kpi-v c-amber">${open.toLocaleString()}</div><div class="jdb-kpi-l">Abiertos</div></div>
          <div class="jdb-kpi"><div class="jdb-kpi-v c-green">${closed.toLocaleString()}</div><div class="jdb-kpi-l">Cerrados</div></div>
          <div class="jdb-kpi"><div class="jdb-kpi-v" style="color:#7c3aed;">${unassg.toLocaleString()}</div><div class="jdb-kpi-l">Sin asignar</div></div>
          <div class="jdb-kpi"><div class="jdb-kpi-v ${slaPct!=null?(slaPct>=80?'c-green':'c-red'):''}">${slaPct!=null?slaPct+'%':'—'}</div><div class="jdb-kpi-l">SLA %</div></div>`;

        const _ch = (id, type, labels, datasets, opts) => {
            if (_anDbCharts[id]) { _anDbCharts[id].destroy(); delete _anDbCharts[id]; }
            const canvas = document.getElementById(id);
            if (!canvas) return;
            const defaults = {
                responsive:true, maintainAspectRatio:false,
                plugins:{ legend:{ labels:{ color:tc, font:{size:10}, boxWidth:10 } } },
            };
            _anDbCharts[id] = new Chart(canvas.getContext('2d'), {
                type, data:{labels, datasets},
                options: Object.assign({}, defaults, opts||{})
            });
        };
        const scaleXY = { x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}}, y:{ticks:{color:tc,font:{size:9}},grid:{color:grid}} };
        const scaleHBar = { x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}}, y:{ticks:{color:tc,font:{size:9},maxRotation:0},grid:{color:grid}} };

        // ── Monthly trend ──
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
            months.push(d.toLocaleString('es-PE',{month:'short',year:'numeric'}));
        }
        const monthCount = new Array(12).fill(0);
        const monthClosed = new Array(12).fill(0);
        issues.forEach(issue => {
            if (!issue._cre) return;
            const d = new Date(issue._cre);
            const key = d.toLocaleString('es-PE',{month:'short',year:'numeric'});
            const idx = months.indexOf(key);
            if (idx >= 0) { monthCount[idx]++; if (issue._done) monthClosed[idx]++; }
        });
        _ch('anDbChartMonthly','bar', months,
            [{ label:'Creados', data:monthCount, backgroundColor:'rgba(37,99,235,.7)', borderColor:'#2563eb', borderWidth:1 },
             { label:'Cerrados', data:monthClosed, backgroundColor:'rgba(16,185,129,.7)', borderColor:'#10b981', borderWidth:1 }],
            { plugins:{ legend:{labels:{color:tc,font:{size:10}}} }, scales:scaleXY });

        // ── Status distribution ──
        const statusMap = {};
        issues.forEach(i => { const s = i.fields?.status?.name||'Sin estado'; statusMap[s] = (statusMap[s]||0)+1; });
        const statusEntries = Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
        const statusPalette = statusEntries.map((_,i) => `hsl(${Math.round(i*360/Math.max(statusEntries.length,1))},60%,55%)`);
        _ch('anDbChartStatus','doughnut', statusEntries.map(([k])=>k), [{
            data:statusEntries.map(([,v])=>v), backgroundColor:statusPalette, borderWidth:2,
            borderColor: isDark ? '#1e293b' : '#ffffff'
        }], { plugins:{ legend:{position:'right',labels:{color:tc,font:{size:10},boxWidth:10}} }, cutout:'58%' });

        // ── Priority ──
        const prioOrder = ['Highest','High','Medium','Low','Lowest','P1','P2','P3','P4'];
        const prioMap = {};
        issues.forEach(i => { const p = i.fields?.priority?.name||'Sin prioridad'; prioMap[p]=(prioMap[p]||0)+1; });
        const prioEntries = Object.entries(prioMap).sort((a,b)=>{
            const ai=prioOrder.indexOf(a[0]), bi=prioOrder.indexOf(b[0]);
            return (ai<0?99:ai)-(bi<0?99:bi);
        });
        const prioPalette = {'Highest':'#dc2626','P1':'#dc2626','High':'#f59e0b','P2':'#f59e0b','Medium':'#3b82f6','P3':'#3b82f6','Low':'#10b981','P4':'#10b981','Lowest':'#94a3b8'};
        _ch('anDbChartPrio','bar', prioEntries.map(([k])=>k),
            [{ label:'Tickets', data:prioEntries.map(([,v])=>v),
               backgroundColor:prioEntries.map(([k])=>prioPalette[k]||'#6366f1'), borderRadius:4 }],
            { indexAxis:'y', plugins:{legend:{display:false}}, scales:scaleHBar });

        // ── Top Assignees ──
        const assMap = {};
        issues.forEach(i => {
            const a = i.fields?.assignee?.displayName || i.fields?.assignee?.emailAddress || 'Sin asignar';
            assMap[a] = (assMap[a]||0)+1;
        });
        const assTop = Object.entries(assMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
        _ch('anDbChartAssignee','bar', assTop.map(([k])=>k.split(' ').slice(0,2).join(' ')),
            [{ label:'Tickets', data:assTop.map(([,v])=>v), backgroundColor:'rgba(16,185,129,.75)', borderRadius:4 }],
            { indexAxis:'y', plugins:{legend:{display:false}}, scales:scaleHBar });

        // ── Top Reporters ──
        const repMap = {};
        issues.forEach(i => {
            const r = i.fields?.reporter?.displayName || i.fields?.reporter?.emailAddress || '—';
            repMap[r] = (repMap[r]||0)+1;
        });
        const repTop = Object.entries(repMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
        _ch('anDbChartReporter','bar', repTop.map(([k])=>k.split(' ').slice(0,2).join(' ')),
            [{ label:'Tickets', data:repTop.map(([,v])=>v), backgroundColor:'rgba(239,68,68,.7)', borderRadius:4 }],
            { indexAxis:'y', plugins:{legend:{display:false}}, scales:scaleHBar });

        // ── SLA by priority ──
        const slaPrioOk = {}, slaPrioTotal = {};
        issues.forEach(issue => {
            if (issue._slaOk === null) return;
            const p = issue.fields?.priority?.name||'Sin prioridad';
            slaPrioOk[p] = (slaPrioOk[p]||0) + (issue._slaOk ? 1 : 0);
            slaPrioTotal[p] = (slaPrioTotal[p]||0)+1;
        });
        const slaEntries = Object.entries(slaPrioTotal).sort((a,b)=>{
            const ai=prioOrder.indexOf(a[0]),bi=prioOrder.indexOf(b[0]);
            return (ai<0?99:ai)-(bi<0?99:bi);
        });
        const slaPcts = slaEntries.map(([k,tot]) => tot ? Math.round((slaPrioOk[k]||0)/tot*100) : 0);
        _ch('anDbChartSla','bar', slaEntries.map(([k])=>k),
            [{ label:'SLA cumplido %', data:slaPcts,
               backgroundColor:slaPcts.map(v=>v>=80?'rgba(16,185,129,.75)':v>=60?'rgba(245,158,11,.75)':'rgba(239,68,68,.75)'),
               borderRadius:4 }],
            { plugins:{legend:{display:false}},
              scales:{ x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}},
                       y:{min:0,max:100,ticks:{color:tc,font:{size:9},callback:v=>v+'%'},grid:{color:grid}} } });

        // ── Open vs Closed weekly (last 8 weeks) ──
        const weeks = [];
        const wkOpen = new Array(8).fill(0), wkClosed = new Array(8).fill(0);
        for (let i=7;i>=0;i--) {
            const d = new Date(); d.setDate(d.getDate()-i*7);
            weeks.push('S'+(8-i));
        }
        issues.forEach(issue => {
            if (!issue._cre) return;
            const weeksAgo = Math.floor((now - issue._cre) / (7*86400000));
            if (weeksAgo < 8) {
                const idx = 7 - weeksAgo;
                if (issue._done) wkClosed[idx]++; else wkOpen[idx]++;
            }
        });
        _ch('anDbChartWeek','bar', weeks,
            [{ label:'Abiertos', data:wkOpen, backgroundColor:'rgba(245,158,11,.75)', borderRadius:3 },
             { label:'Cerrados', data:wkClosed, backgroundColor:'rgba(16,185,129,.75)', borderRadius:3 }],
            { plugins:{legend:{labels:{color:tc,font:{size:10}}}}, scales:scaleXY });
}

function _anLoadLibs() {
    if (_anLibsOk) return;
    const libs = [
        window.Papa ? null : 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
        window.XLSX ? null : 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    ].filter(Boolean);
    if (!libs.length) { _anLibsOk = true; return; }
    let loaded = 0;
    libs.forEach(src => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => { if (++loaded === libs.length) _anLibsOk = true; };
        s.onerror = () => showToast('Error cargando librería: ' + src.split('/').pop(), 'error');
        document.head.appendChild(s);
    });
}

function anSwitchTab(idx) {
    [0,1].forEach(function(i) {
        var t = document.getElementById('anTab'+i);
        var b = document.getElementById('anStab'+i);
        if (t) t.style.display = i === idx ? 'block' : 'none';
        if (b) b.classList.toggle('active', i === idx);
    });
    if (idx === 1) { anLoadSchema(); anLoadHistory(); }
}

function anDragOver(e)  { e.preventDefault(); document.getElementById('anDzData').classList.add('drag-over'); }
function anDragLeave()   { document.getElementById('anDzData').classList.remove('drag-over'); }
function anDropData(e)  {
    e.preventDefault();
    document.getElementById('anDzData').classList.remove('drag-over');
    if (e.dataTransfer.files.length) anLoadFiles(e.dataTransfer.files);
}

function anLoadFiles(fileList) {
    if (!_anLibsOk) { showToast('Librerías cargando, espera un momento…', 'error'); return; }
    const remaining = 3 - _an.files.length;
    if (remaining <= 0) { showToast('Máximo 3 archivos.', 'error'); return; }
    const toLoad = Array.from(fileList).slice(0, remaining);
    let pending = toLoad.length;
    if (!pending) return;
    toLoad.forEach((file, idx) => {
        if (file.size > 10*1024*1024) { showToast(file.name+': supera 10MB', 'error'); if (!--pending) anFinalize(); return; }
        const ext = file.name.split('.').pop().toLowerCase();
        const color = _AN_COLORS[(_an.files.length+idx) % _AN_COLORS.length];
        if (ext === 'csv') {
            Papa.parse(file, { header:true, skipEmptyLines:true, dynamicTyping:true,
                complete: r => { anAddFile(file.name, r.data, r.meta.fields||[], color); if (!--pending) anFinalize(); } });
        } else if (ext === 'xlsx' || ext === 'xls') {
            const reader = new FileReader();
            reader.onload = ev => {
                const wb = XLSX.read(ev.target.result, {type:'binary'});
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
                anAddFile(file.name, rows, rows.length ? Object.keys(rows[0]) : [], color);
                if (!--pending) anFinalize();
            };
            reader.readAsBinaryString(file);
        } else {
            showToast(file.name+': formato no soportado.', 'error');
            if (!--pending) anFinalize();
        }
    });
}

function anAddFile(name, rows, cols, color) {
    rows.forEach(r => { r.__src__ = name; });
    _an.files.push({name, rows, cols, color});
    cols.forEach(c => { if (!_an.allCols.includes(c)) _an.allCols.push(c); });
    _an.allRows = _an.allRows.concat(rows);
}

function anFinalize() {
    if (!_an.allRows.length) { showToast('Los archivos están vacíos.', 'error'); return; }
    _an.allCols.forEach(col => { _an.types[col] = anDetectType(col, _an.allRows); });
    _an.filters = {}; _an.search = ''; _an.page = 1;
    document.getElementById('anDataUpload').style.display = 'none';
    var guide = document.getElementById('anQuickGuide'); if (guide) guide.style.display = 'none';
    document.getElementById('anDashboard').style.display = 'block';
    anUpdateFileChips();
    anBuildFilters();
    anApplyFilters();
    if (!_an.charts.length) anAutoCharts();
    anRenderAutoStats();
}

function anUpdateFileChips() {
    const fn = document.getElementById('anFileName');
    if (fn) fn.textContent = _an.files.map(f => f.name.replace(/\.[^.]+$/,'')).join(', ');
    const el = document.getElementById('anFileChips');
    if (!el) return;
    if (!_an.files.length) { el.style.display='none'; return; }
    el.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;';
    el.innerHTML = _an.files.map((f,i) => `<div style="display:flex;align-items:center;gap:5px;background:var(--bg-header);padding:3px 10px;border-radius:20px;font-size:11px;border:1px solid var(--border-soft);">
        <span style="width:7px;height:7px;border-radius:50%;background:${f.color};flex-shrink:0;"></span>
        <strong>${incEsc(f.name)}</strong><span style="color:var(--text-muted);">(${f.rows.length.toLocaleString()} filas)</span>
        <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:0 2px;font-size:13px;line-height:1;" onclick="anRemoveFile(${i})">×</button>
    </div>`).join('');
}

function anRemoveFile(idx) {
    _an.files.splice(idx, 1);
    _an.allRows = []; _an.allCols = []; _an.types = {};
    _an.files.forEach(f => {
        f.cols.forEach(c => { if (!_an.allCols.includes(c)) _an.allCols.push(c); });
        _an.allRows = _an.allRows.concat(f.rows);
    });
    if (!_an.files.length) { anReset(); return; }
    _an.allCols.forEach(col => { _an.types[col] = anDetectType(col, _an.allRows); });
    anUpdateFileChips(); anBuildFilters(); anApplyFilters();
}

function anDetectType(col, rows) {
    const sample = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '').slice(0, 200);
    if (!sample.length) return 'text';
    if (sample.every(v => !isNaN(+v))) return 'number';
    const dateRe = /^\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}$|^\d{4}-\d{2}-\d{2}T/;
    if (sample.filter(v => dateRe.test(String(v))).length / sample.length > 0.7) return 'date';
    if (new Set(sample.map(v => String(v))).size <= 80) return 'categorical';
    return 'text';
}

function anBuildFilters() {
    const bar = document.getElementById('anFilterBar');
    if (!bar) return;
    bar.innerHTML = '';
    _an.allCols.slice(0, 7).forEach(col => {
        const type = _an.types[col];
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
        const lbl = `<label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">${incEsc(col)}</label>`;
        if (type === 'number') {
            const vals = _an.allRows.map(r => +r[col]).filter(v => !isNaN(v));
            const mn = Math.min(...vals), mx = Math.max(...vals);
            wrap.innerHTML = lbl + `<div style="display:flex;align-items:center;gap:4px;">
              <input type="number" class="an-input" style="width:72px;" value="${mn}" data-role="min" data-col="${incEsc(col)}" onchange="anApplyFilters()">
              <span style="font-size:10px;color:var(--text-muted);">–</span>
              <input type="number" class="an-input" style="width:72px;" value="${mx}" data-role="max" data-col="${incEsc(col)}" onchange="anApplyFilters()">
            </div>`;
        } else if (type === 'date') {
            wrap.innerHTML = lbl + `<div style="display:flex;align-items:center;gap:4px;">
              <input type="date" class="an-input" style="width:118px;" data-role="from" data-col="${incEsc(col)}" onchange="anApplyFilters()">
              <span style="font-size:10px;color:var(--text-muted);">→</span>
              <input type="date" class="an-input" style="width:118px;" data-role="to" data-col="${incEsc(col)}" onchange="anApplyFilters()">
            </div>`;
        } else if (type === 'categorical') {
            const unique = [...new Set(_an.allRows.map(r => String(r[col]??'')).filter(v=>v!==''))].sort().slice(0, 100);
            wrap.innerHTML = lbl + `<select class="an-input" style="width:128px;padding:4px 7px;" data-col="${incEsc(col)}" onchange="anApplyFilters()">
              <option value="">Todos</option>${unique.map(v=>`<option value="${incEsc(v)}">${incEsc(v)}</option>`).join('')}
            </select>`;
        } else {
            wrap.innerHTML = lbl + `<input type="text" class="an-input" style="width:118px;" placeholder="Contiene…" data-col="${incEsc(col)}" oninput="anApplyFilters()">`;
        }
        bar.appendChild(wrap);
    });
    const actWrap = document.createElement('div');
    actWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;justify-content:flex-end;';
    actWrap.innerHTML = (_an.files.length > 1 ? `<label style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;">Fuente</label>
      <select class="an-input" style="width:128px;padding:4px 7px;" id="anSourceFilter" onchange="anApplyFilters()">
        <option value="">Todas</option>${_an.files.map(f=>`<option value="${incEsc(f.name)}">${incEsc(f.name)}</option>`).join('')}
      </select>` : '') +
      `<button class="an-btn" style="font-size:10px;margin-top:4px;" onclick="anClearFilters()"><i class="bi bi-x-circle"></i> Limpiar</button>`;
    bar.appendChild(actWrap);
}

function anApplyFilters() {
    let data = [..._an.allRows];
    const srcEl = document.getElementById('anSourceFilter');
    if (srcEl && srcEl.value) data = data.filter(r => r.__src__ === srcEl.value);
    document.querySelectorAll('#anFilterBar [data-col]').forEach(el => {
        const col = el.dataset.col;
        if (!col) return;
        const type = _an.types[col];
        if (el.tagName === 'SELECT') {
            if (el.value) data = data.filter(r => String(r[col]??'') === el.value);
        } else if (el.tagName === 'INPUT') {
            if (type === 'number') {
                const val = parseFloat(el.value);
                if (!isNaN(val)) {
                    if (el.dataset.role === 'min') data = data.filter(r => +r[col] >= val);
                    if (el.dataset.role === 'max') data = data.filter(r => +r[col] <= val);
                }
            } else if (type === 'date') {
                if (el.value) {
                    const t = new Date(el.value).getTime();
                    if (el.dataset.role === 'from') data = data.filter(r => new Date(r[col]).getTime() >= t);
                    if (el.dataset.role === 'to')   data = data.filter(r => new Date(r[col]).getTime() <= t);
                }
            } else if (el.value) {
                const term = el.value.toLowerCase();
                data = data.filter(r => String(r[col]??'').toLowerCase().includes(term));
            }
        }
    });
    if (_an.search) {
        const term = _an.search.toLowerCase();
        data = data.filter(r => _an.allCols.some(c => String(r[c]??'').toLowerCase().includes(term)));
    }
    _an.filtered = data; _an.page = 1;
    const rc = document.getElementById('anRowCount');
    if (rc) rc.textContent = data.length.toLocaleString() + ' filas';
    anRenderStats(); anRenderAllCharts(); anRenderTable();
}

function anClearFilters() {
    document.querySelectorAll('#anFilterBar input, #anFilterBar select').forEach(el => { el.value=''; });
    const gs = document.getElementById('anGlobalSearch');
    if (gs) gs.value = '';
    _an.search = '';
    anApplyFilters();
}

function anOnSearch(val) {
    clearTimeout(_an._searchTimer);
    _an._searchTimer = setTimeout(() => { _an.search = val; anApplyFilters(); }, 280);
}

function anRenderStats() {
    const el = document.getElementById('anStats');
    if (!el) return;
    const data = _an.filtered;
    let html = `<div class="an-stat"><div class="an-stat-lbl">Total filas</div><div class="an-stat-val c-blue">${data.length.toLocaleString()}</div></div>`;
    html += `<div class="an-stat"><div class="an-stat-lbl">Columnas</div><div class="an-stat-val">${_an.allCols.length}</div></div>`;
    if (_an.files.length > 1) html += `<div class="an-stat"><div class="an-stat-lbl">Archivos</div><div class="an-stat-val c-green">${_an.files.length}</div></div>`;
    _an.allCols.filter(c => _an.types[c] === 'number').slice(0, 3).forEach(col => {
        const sum = data.map(r => +r[col]).filter(v => !isNaN(v)).reduce((a,b) => a+b, 0);
        html += `<div class="an-stat"><div class="an-stat-lbl">Σ ${incEsc(col)}</div><div class="an-stat-val">${sum.toLocaleString(undefined,{maximumFractionDigits:2})}</div></div>`;
    });
    el.innerHTML = html;
}

function anAutoCharts() {
    const RANKED_PATTERNS = [
        /^estado$|^status$|estado|status/i,
        /^prioridad$|^priority$|prioridad|priority|severidad/i,
        /nombre|asignado|tecnico|assignee/i,
        /tipo|type|categor/i,
        /resolucion|resolution|resultado/i,
        /empresa|equipo|grupo|team/i,
        /cola|queue|servicio|service/i
    ];
    const rows = _an.allRows;
    const catRanked = _an.allCols
        .filter(c => _an.types[c] === 'categorical')
        .map(c => {
            const unique = new Set(rows.map(r => String(r[c]??''))).size;
            const pi = RANKED_PATTERNS.findIndex(p => p.test(c));
            return { col:c, unique, score: pi >= 0 ? pi : 99 };
        })
        .filter(x => x.unique >= 2 && x.unique <= 30)
        .sort((a,b) => a.score - b.score || a.unique - b.unique);

    // Fallback: if not enough low-cardinality cols, include any categorical sorted by cardinality
    if (catRanked.length < 3) {
        _an.allCols.filter(c => _an.types[c] === 'categorical' && !catRanked.find(y => y.col === c))
            .map(c => ({ col:c, unique: new Set(rows.map(r => String(r[c]??''))).size, score:99 }))
            .sort((a,b) => a.unique - b.unique)
            .forEach(x => catRanked.push(x));
    }

    const num  = _an.allCols.filter(c => _an.types[c] === 'number');
    const date = _an.allCols.filter(c => _an.types[c] === 'date');
    const defs = [];

    if (catRanked[0]) defs.push({type:'doughnut', xCol:catRanked[0].col, yCol:null, agg:'count'});
    if (catRanked[1]) defs.push({type:'bar',      xCol:catRanked[1].col, yCol:null, agg:'count'});
    else if (catRanked[0] && num[0]) defs.push({type:'bar', xCol:catRanked[0].col, yCol:num[0], agg:'avg'});

    if (date[0] && num[0])    defs.push({type:'line', xCol:date[0],        yCol:num[0], agg:'sum'});
    else if (catRanked[2])    defs.push({type:'bar',  xCol:catRanked[2].col, yCol:null, agg:'count'});
    else if (catRanked[0] && num[0]) defs.push({type:'bar', xCol:catRanked[0].col, yCol:num[0], agg:'avg'});

    defs.slice(0, 3).forEach(cfg => anAddChart(cfg));
}

function anAddChart(cfg) {
    const id = 'anc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const cat = _an.allCols.filter(c => _an.types[c] !== 'number');
    const num = _an.allCols.filter(c => _an.types[c] === 'number');
    const ch = { id, type:(cfg&&cfg.type)||'bar', xCol:(cfg&&cfg.xCol)||cat[0]||_an.allCols[0],
                 yCol:(cfg&&cfg.yCol)||num[0]||null, agg:(cfg&&cfg.agg)||'count', instance:null };
    _an.charts.push(ch);
    anRenderChartCard(ch);
    anRenderSingleChart(ch);
}

function anRemoveChart(id) {
    const idx = _an.charts.findIndex(c => c.id===id);
    if (idx<0) return;
    if (_an.charts[idx].instance) _an.charts[idx].instance.destroy();
    _an.charts.splice(idx, 1);
    const el = document.getElementById('ancard_'+id); if (el) el.remove();
}

function anChartCfg(id, key, val) {
    const ch = _an.charts.find(c => c.id===id); if (!ch) return;
    ch[key] = val; anRenderSingleChart(ch);
}

function anRenderChartCard(ch) {
    const num = _an.allCols.filter(c => _an.types[c]==='number');
    const card = document.createElement('div');
    card.id = 'ancard_'+ch.id;
    card.className = 'an-card';
    card.style.cssText = 'min-width:0;';
    card.innerHTML = `
      <div class="an-card-head" style="padding:8px 12px;">
        <span class="an-card-title" style="font-size:11px;"><i class="bi bi-graph-up"></i> ${ch.xCol ? incEsc(ch.xCol) : 'Gráfico'}</span>
        <button style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;line-height:1;" onclick="anRemoveChart('${ch.id}')">×</button>
      </div>
      <div style="padding:6px 12px;display:flex;gap:5px;flex-wrap:wrap;border-bottom:1px solid var(--border-soft);align-items:center;">
        <select class="an-input" style="width:84px;padding:3px 4px;font-size:10px;" onchange="anChartCfg('${ch.id}','type',this.value)">
          <option value="bar" ${ch.type==='bar'?'selected':''}>Barras</option>
          <option value="line" ${ch.type==='line'?'selected':''}>Líneas</option>
          <option value="pie" ${ch.type==='pie'?'selected':''}>Pastel</option>
          <option value="doughnut" ${ch.type==='doughnut'?'selected':''}>Donut</option>
        </select>
        <select class="an-input" style="width:116px;padding:3px 4px;font-size:10px;" onchange="anChartCfg('${ch.id}','xCol',this.value)">
          ${_an.allCols.map(c=>`<option value="${incEsc(c)}" ${ch.xCol===c?'selected':''}>${incEsc(c)}</option>`).join('')}
        </select>
        <select class="an-input" style="width:82px;padding:3px 4px;font-size:10px;" onchange="anChartCfg('${ch.id}','agg',this.value)">
          <option value="count" ${ch.agg==='count'?'selected':''}>Contar</option>
          <option value="sum"   ${ch.agg==='sum'?'selected':''}>Suma</option>
          <option value="avg"   ${ch.agg==='avg'?'selected':''}>Promedio</option>
        </select>
        ${num.length ? `<select class="an-input" style="width:116px;padding:3px 4px;font-size:10px;" onchange="anChartCfg('${ch.id}','yCol',this.value)">
          <option value="">— col Y —</option>${num.map(c=>`<option value="${incEsc(c)}" ${ch.yCol===c?'selected':''}>${incEsc(c)}</option>`).join('')}
        </select>` : ''}
      </div>
      <div style="padding:10px;position:relative;height:210px;"><canvas id="ancv_${ch.id}"></canvas></div>`;
    document.getElementById('anChartArea').appendChild(card);
}

function anAggData(ch) {
    const grouped = new Map();
    _an.filtered.forEach(r => {
        const key = String(r[ch.xCol]??'');
        if (!grouped.has(key)) grouped.set(key, {count:0,sum:0,vals:[]});
        const g = grouped.get(key); g.count++;
        if (ch.yCol) { const v = parseFloat(r[ch.yCol]); if (!isNaN(v)) { g.sum += v; g.vals.push(v); } }
    });
    const getVal = ([,g]) => ch.agg==='sum' ? g.sum : ch.agg==='avg' ? (g.vals.length ? g.sum/g.vals.length : 0) : g.count;
    const top = [...grouped.entries()].sort((a,b) => getVal(b)-getVal(a)).slice(0, 40);
    return { labels: top.map(([k]) => k||'(vacío)'), values: top.map(getVal) };
}

function anRenderSingleChart(ch) {
    if (ch.instance) { ch.instance.destroy(); ch.instance = null; }
    const canvas = document.getElementById('ancv_'+ch.id);
    if (!canvas || !ch.xCol) return;
    const {labels, values} = anAggData(ch);
    if (!labels.length) return;
    const isPie = ch.type==='pie' || ch.type==='doughnut';
    const palette = labels.map((_,i) => `hsl(${Math.round(i*360/Math.max(labels.length,1))},60%,55%)`);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tickColor = isDark ? '#94a3b8' : '#64748b';
    ch.instance = new Chart(canvas.getContext('2d'), {
        type: ch.type,
        data: { labels, datasets: [{ label: ch.agg==='count'?'Conteo':(ch.yCol||'Valor'), data: values,
          backgroundColor: isPie ? palette : 'rgba(37,99,235,.72)',
          borderColor: isPie ? palette : '#2563eb', borderWidth:1, fill:false, tension:.35 }] },
        options: { responsive:true, maintainAspectRatio:false,
          plugins: { legend: { labels: { color:tickColor, font:{size:10} } } },
          scales: isPie ? {} : {
            x: { ticks:{color:tickColor,font:{size:9},maxRotation:40} },
            y: { ticks:{color:tickColor,font:{size:9}} }
          }
        },
    });
}

function anRenderAllCharts() { _an.charts.forEach(anRenderSingleChart); }

function anRenderTable() {
    const wrap = document.getElementById('anTableWrap');
    const pg   = document.getElementById('anPagination');
    if (!wrap) return;
    const total = _an.filtered.length;
    const pages = Math.ceil(total/_an.pageSize)||1;
    if (_an.page > pages) _an.page = pages;
    const start = (_an.page-1)*_an.pageSize;
    const slice = _an.filtered.slice(start, start+_an.pageSize);
    const cols  = _an.allCols;
    const TC = {number:'#3b82f6',date:'#8b5cf6',categorical:'#10b981',text:'#94a3b8'};
    if (!slice.length) { wrap.innerHTML='<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:12px;">Sin datos</div>'; if(pg) pg.innerHTML=''; return; }
    const arr = col => col===_an.sortCol ? (_an.sortDir==='asc'?' ▲':' ▼') : '';
    wrap.innerHTML = `<table class="an-table"><thead><tr>
      ${cols.map(c=>`<th style="cursor:pointer;" onclick="anSortBy(${JSON.stringify(c)})">
        <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${TC[_an.types[c]]||'#94a3b8'};margin-right:3px;vertical-align:middle;"></span>${incEsc(c)}${arr(c)}
      </th>`).join('')}
      ${_an.files.length>1?'<th>Fuente</th>':''}
    </tr></thead><tbody>
      ${slice.map(r=>`<tr>${cols.map(c=>`<td title="${incEsc(String(r[c]??''))}">${incEsc(String(r[c]??''))}</td>`).join('')}
      ${_an.files.length>1?`<td><span style="font-size:9px;background:var(--bg-header);padding:1px 5px;border-radius:10px;">${incEsc(String(r.__src__||''))}</span></td>`:''}</tr>`).join('')}
    </tbody></table>`;
    const bs = active => `style="padding:3px 9px;border-radius:6px;border:1px solid var(--border-soft);background:${active?'var(--jira-blue)':'var(--bg-card)'};color:${active?'#fff':'var(--text-main)'};cursor:pointer;font-size:11px;"`;
    let pgH = `<span style="font-size:11px;color:var(--text-muted);margin-right:6px;">${start+1}–${Math.min(start+_an.pageSize,total)} de ${total.toLocaleString()}</span>`;
    pgH += `<button ${bs(false)} onclick="anGoPage(1)" ${_an.page===1?'disabled':''}>«</button>`;
    pgH += `<button ${bs(false)} onclick="anGoPage(${_an.page-1})" ${_an.page<=1?'disabled':''}>‹</button>`;
    for (let p=Math.max(1,_an.page-2); p<=Math.min(pages,_an.page+2); p++) pgH+=`<button ${bs(p===_an.page)} onclick="anGoPage(${p})">${p}</button>`;
    pgH += `<button ${bs(false)} onclick="anGoPage(${_an.page+1})" ${_an.page>=pages?'disabled':''}>›</button>`;
    pgH += `<button ${bs(false)} onclick="anGoPage(${pages})" ${_an.page===pages?'disabled':''}>»</button>`;
    if (pg) pg.innerHTML = pgH;
}

function anSortBy(col) {
    _an.sortDir = _an.sortCol===col && _an.sortDir==='asc' ? 'desc' : 'asc';
    _an.sortCol = col;
    const dir = _an.sortDir==='asc' ? 1 : -1;
    _an.filtered.sort((a,b) => _an.types[col]==='number' ? dir*(+a[col]-+b[col]) : dir*String(a[col]??'').localeCompare(String(b[col]??'')));
    _an.page = 1; anRenderTable();
}

function anGoPage(p) {
    _an.page = Math.max(1, Math.min(Math.ceil(_an.filtered.length/_an.pageSize)||1, p));
    anRenderTable();
}

function anExportCSV() {
    if (!_an.filtered.length) { showToast('Sin datos para exportar.', 'error'); return; }
    const cols = _an.allCols;
    const escV = v => { const s=String(v??''); return (s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:`${s}`; };
    const csv = [cols.join(','), ..._an.filtered.map(r => cols.map(c => escV(r[c])).join(','))].join('\r\n');
    _rptDownload(new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'}), 'datos_filtrados_'+new Date().toISOString().slice(0,10)+'.csv');
    showToast('CSV descargado.', 'success');
}

function anReset() {
    _an.charts.forEach(ch => { if (ch.instance) ch.instance.destroy(); });
    _an = _anNewState();
    const ad = document.getElementById('anDataUpload'); if (ad) ad.style.display = 'block';
    const db = document.getElementById('anDashboard');  if (db) db.style.display = 'none';
    const fi = document.getElementById('anFileInput');  if (fi) fi.value = '';
    const fc = document.getElementById('anFileChips');  if (fc) { fc.innerHTML=''; fc.style.display='none'; }
    const ca = document.getElementById('anChartArea');  if (ca) ca.innerHTML = '';
    const qg = document.getElementById('anQuickGuide'); if (qg) qg.style.display = '';
    const as = document.getElementById('anAutoStats');  if (as) { as.innerHTML=''; as.style.display='none'; }
    _anInited = false;
    _anLoadLibs();
}

function anDashTab(idx) {
    const viz = document.getElementById('anTabViz');
    const dat = document.getElementById('anTabData');
    const b0  = document.getElementById('anDashBtn0');
    const b1  = document.getElementById('anDashBtn1');
    if (viz) viz.style.display = idx === 0 ? '' : 'none';
    if (dat) dat.style.display = idx === 1 ? '' : 'none';
    if (b0)  b0.classList.toggle('active', idx === 0);
    if (b1)  b1.classList.toggle('active', idx === 1);
    if (idx === 0) setTimeout(anRenderAllCharts, 50);
}

// ── Analizador SQL Playground ─────────────────────────────────────────────────
function anSqlQuick(q) { const el = document.getElementById('anSqlEditor'); if (el) el.value = q; }

function anSqlFormat() {
    const el = document.getElementById('anSqlEditor');
    if (!el || !el.value.trim()) return;
    var kw = ['SELECT','FROM','WHERE','JOIN','LEFT JOIN','INNER JOIN','GROUP BY','ORDER BY','HAVING','LIMIT','AND','OR','ON','AS','CASE','WHEN','THEN','ELSE','END'];
    var sql = el.value.trim();
    kw.forEach(function(k) {
        sql = sql.replace(new RegExp('\\b' + k + '\\b', 'gi'), '\n' + k);
    });
    el.value = sql.replace(/\n{2,}/g, '\n').trim();
}

var _anSchemaLoaded = false;
async function anLoadSchema(force) {
    if (_anSchemaLoaded && !force) return;
    var tree = document.getElementById('anSchemaTree');
    if (!tree) return;
    try {
        var r = await fetch('/herramientas/sql-query', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({sql:'SHOW TABLES'}) });
        var d = await r.json();
        if (!d.success || !d.rows.length) { tree.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:12px 8px;">Sin tablas disponibles</div>'; return; }
        var tables = d.rows.map(function(row) { return Object.values(row)[0]; });
        _anSchemaLoaded = true;
        tree.innerHTML = tables.map(function(t) {
            return '<div class="an-schema-table" onclick="anSchemaToggle(\'' + incEsc(t) + '\',this)">'
                + '<i class="bi bi-table" style="color:var(--jira-blue);font-size:11px;"></i>'
                + '<span>' + incEsc(t) + '</span>'
                + '<i class="bi bi-chevron-right" style="margin-left:auto;font-size:9px;opacity:.5;"></i>'
                + '</div><div class="an-schema-cols" id="ancols-' + incEsc(t) + '" style="display:none;"></div>';
        }).join('');
    } catch(e) {
        if (tree) tree.innerHTML = '<div style="font-size:11px;color:#ef4444;padding:12px 8px;">Error cargando esquema</div>';
    }
}

async function anSchemaToggle(table, el) {
    var colsEl = document.getElementById('ancols-' + table);
    if (!colsEl) return;
    var icon = el.querySelector('.bi-chevron-right, .bi-chevron-down');
    if (colsEl.style.display !== 'none') {
        colsEl.style.display = 'none';
        if (icon) { icon.className = icon.className.replace('down','right'); }
        return;
    }
    if (icon) { icon.className = icon.className.replace('right','down'); }
    if (colsEl.innerHTML) { colsEl.style.display = 'block'; return; }
    colsEl.innerHTML = '<div style="padding:4px 8px;font-size:10px;color:var(--text-muted);">Cargando…</div>';
    colsEl.style.display = 'block';
    try {
        var r = await fetch('/herramientas/sql-query', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({sql:'DESCRIBE `' + table + '`'}) });
        var d = await r.json();
        if (!d.success) { colsEl.innerHTML = '<div style="padding:4px 8px;font-size:10px;color:#ef4444;">Error</div>'; return; }
        colsEl.innerHTML = d.rows.map(function(row) {
            var name = row.Field || row.field || Object.values(row)[0];
            var type = row.Type || row.type || Object.values(row)[1] || '';
            type = String(type).split('(')[0].toUpperCase();
            return '<div class="an-schema-col" onclick="anSqlAppendCol(\'' + incEsc(String(name)) + '\')">'
                + '<span style="color:var(--text-main);">' + incEsc(String(name)) + '</span>'
                + '<span style="color:var(--text-muted);font-size:9px;">' + incEsc(type) + '</span>'
                + '</div>';
        }).join('');
    } catch(e) {
        colsEl.innerHTML = '<div style="padding:4px 8px;font-size:10px;color:#ef4444;">Error</div>';
    }
}

function anSqlAppendCol(col) {
    var el = document.getElementById('anSqlEditor');
    if (!el) return;
    var cur = el.value;
    el.value = cur ? (cur.trimEnd() + ', `' + col + '`') : ('SELECT `' + col + '` FROM ');
    el.focus();
}

var _anQueryHistory = [];
function anLoadHistory() {
    try { _anQueryHistory = JSON.parse(localStorage.getItem('anQueryHistory') || '[]'); } catch(e) { _anQueryHistory = []; }
    anRenderHistory();
}

function anSaveHistory(sql) {
    _anQueryHistory = _anQueryHistory.filter(function(q) { return q.sql !== sql; });
    _anQueryHistory.unshift({ sql: sql, ts: Date.now() });
    if (_anQueryHistory.length > 8) _anQueryHistory = _anQueryHistory.slice(0, 8);
    try { localStorage.setItem('anQueryHistory', JSON.stringify(_anQueryHistory)); } catch(e) {}
    anRenderHistory();
}

function anRenderHistory() {
    var row = document.getElementById('anSqlHistoryRow');
    var list = document.getElementById('anSqlHistoryList');
    if (!list) return;
    if (!_anQueryHistory.length) { if (row) row.style.display = 'none'; return; }
    if (row) row.style.display = 'block';
    list.innerHTML = _anQueryHistory.slice(0, 5).map(function(q, i) {
        var preview = q.sql.replace(/\s+/g,' ').trim().slice(0, 80);
        var ago = Math.round((Date.now() - q.ts) / 60000);
        var agoStr = ago < 60 ? ago + ' min' : Math.round(ago/60) + 'h';
        return '<div class="an-history-item" onclick="anSqlQuick(' + JSON.stringify(q.sql) + ')">'
            + '<span style="flex:1;font-family:monospace;font-size:10px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + incEsc(preview) + '</span>'
            + '<span style="font-size:9px;color:var(--text-muted);white-space:nowrap;margin-left:8px;">' + agoStr + '</span>'
            + '<button class="an-btn" style="padding:1px 6px;font-size:10px;flex-shrink:0;" onclick="event.stopPropagation();anDeleteHistory(' + i + ')"><i class="bi bi-x"></i></button>'
            + '</div>';
    }).join('');
}

function anDeleteHistory(idx) {
    _anQueryHistory.splice(idx, 1);
    try { localStorage.setItem('anQueryHistory', JSON.stringify(_anQueryHistory)); } catch(e) {}
    anRenderHistory();
}

function anApplyTemplate(type) {
    if (!_an.allRows.length) { showToast('Primero carga un archivo Excel o CSV', 'info'); return; }
    const templates = {
        sla: ['Time to resolve','Priority','Status'],
        tecnicos: ['Assignee','Status','Priority'],
        tendencia: ['Created','Status'],
        prioridad: ['Priority','Status','Assignee']
    };
    var cols = templates[type] || [];
    var matched = cols.filter(function(c) { return _an.allCols.some(function(a) { return a.toLowerCase().includes(c.toLowerCase()); }); });
    if (!matched.length) { showToast('No se encontraron columnas compatibles con esta plantilla', 'info'); return; }
    matched.forEach(function(c) {
        var realCol = _an.allCols.find(function(a) { return a.toLowerCase().includes(c.toLowerCase()); });
        if (realCol) { anAddChartForCol(realCol); }
    });
    showToast('Plantilla "' + type + '" aplicada con ' + matched.length + ' gráficos', 'success');
}

function anAddChartForCol(col) {
    var type = _an.types[col];
    var chartType = (type === 'number') ? 'bar' : 'pie';
    var groups = {};
    _an.filtered.forEach(function(row) { var v = row[col]; if (v != null) groups[v] = (groups[v] || 0) + 1; });
    var entries = Object.entries(groups).sort(function(a,b){return b[1]-a[1];}).slice(0, 12);
    if (!entries.length) return;
    var chartId = 'an-tpl-' + Date.now();
    var wrap = document.getElementById('anChartArea');
    if (!wrap) return;
    var div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;overflow:hidden;flex:1;min-width:260px;max-width:480px;';
    div.innerHTML = '<div style="padding:8px 12px;background:var(--bg-header);border-bottom:1px solid var(--border-soft);font-size:12px;font-weight:700;color:var(--text-main);">' + incEsc(col) + '</div>'
        + '<div style="padding:10px;height:200px;position:relative;"><canvas id="' + chartId + '"></canvas></div>';
    wrap.appendChild(div);
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc = isDark ? '#94a3b8' : '#64748b';
    var pal = entries.map(function(_,i){ return 'hsl('+Math.round(i*360/Math.max(entries.length,1))+',55%,55%)'; });
    new Chart(document.getElementById(chartId).getContext('2d'), {
        type: chartType,
        data: { labels: entries.map(function(e){return String(e[0]);}), datasets: [{ label: col, data: entries.map(function(e){return e[1];}), backgroundColor: pal, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: chartType === 'pie', labels: { color: tc, font: { size: 10 }, boxWidth: 10 } } },
            scales: chartType === 'bar' ? { x:{ticks:{color:tc,font:{size:9}}}, y:{ticks:{color:tc,font:{size:9}}} } : undefined }
    });
    if (wrap.style.display === 'none') wrap.style.display = 'flex';
}

function anRenderAutoStats() {
    var el = document.getElementById('anAutoStats');
    if (!el || !_an.allRows.length) return;
    var numCols = _an.allCols.filter(function(c){ return _an.types[c] === 'number'; });
    var catCols = _an.allCols.filter(function(c){ return _an.types[c] !== 'number'; }).slice(0, 6);
    var bodyHtml = '<div id="anAutoStatsBody" style="display:none;padding:12px;display:none;flex-wrap:wrap;gap:10px;" class="an-stat-flex">';
    numCols.slice(0, 4).forEach(function(c) {
        var vals = _an.allRows.map(function(r){ return parseFloat(r[c]); }).filter(function(v){ return !isNaN(v); });
        if (!vals.length) return;
        var sum = vals.reduce(function(a,b){return a+b;},0);
        var avg = (sum/vals.length).toFixed(1);
        var mn  = Math.min.apply(null, vals);
        var mx  = Math.max.apply(null, vals);
        bodyHtml += '<div class="an-stat"><div class="an-stat-lbl">' + incEsc(c) + '</div>'
            + '<div class="an-stat-val" style="font-size:15px;">' + avg + '</div>'
            + '<div style="font-size:10px;color:var(--text-muted);">prom · min ' + mn + ' · max ' + mx + '</div></div>';
    });
    catCols.forEach(function(c) {
        var vals = _an.allRows.map(function(r){ return r[c]; }).filter(function(v){ return v != null && v !== ''; });
        var uniq = new Set(vals).size;
        var nulls = _an.allRows.length - vals.length;
        var top = {};
        vals.forEach(function(v){ top[v]=(top[v]||0)+1; });
        var topVal = Object.entries(top).sort(function(a,b){return b[1]-a[1];})[0];
        bodyHtml += '<div class="an-stat"><div class="an-stat-lbl">' + incEsc(c) + '</div>'
            + '<div class="an-stat-val" style="font-size:14px;">' + uniq + ' únicos</div>'
            + '<div style="font-size:10px;color:var(--text-muted);">' + (nulls ? nulls + ' nulos · ' : '') + (topVal ? 'top: ' + incEsc(String(topVal[0])) : '') + '</div></div>';
    });
    bodyHtml += '</div>';
    var html = '<div class="an-card" style="margin-bottom:0;">'
        + '<div class="an-card-head" style="cursor:pointer;" onclick="anToggleAutoStats()">'
        + '<span class="an-card-title"><i class="bi bi-clipboard2-data-fill" style="color:#3b82f6;"></i> Resumen automático del dataset</span>'
        + '<div style="display:flex;align-items:center;gap:10px;">'
        + '<span style="font-size:11px;color:var(--text-muted);">' + _an.allRows.length.toLocaleString() + ' filas · ' + _an.allCols.length + ' columnas</span>'
        + '<i id="anAutoStatsChevron" class="bi bi-chevron-down" style="color:var(--text-muted);transition:transform .2s;font-size:13px;"></i>'
        + '</div></div>'
        + bodyHtml
        + '</div>';
    el.innerHTML = html;
    el.style.display = 'block';
}

function anToggleAutoStats() {
    var body    = document.getElementById('anAutoStatsBody');
    var chevron = document.getElementById('anAutoStatsChevron');
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display    = open ? 'none' : 'flex';
    if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
}

async function anRunSQL() {
    const sql = document.getElementById('anSqlEditor')?.value?.trim();
    if (!sql) return;
    const btn = document.querySelector('#anTab1 .an-btn-primary');
    const t0 = Date.now();
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="bi bi-hourglass-split"></i> Ejecutando…'; }
    try {
        const r = await fetch('/herramientas/sql-query', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({sql}) });
        const d = await r.json();
        if (!d.success) { showToast(d.error||'Error en la consulta.', 'error'); return; }
        _anSqlData = {rows:d.rows, cols:d.cols};
        const ms = Date.now() - t0;
        const timeEl = document.getElementById('anSqlTime');
        if (timeEl) timeEl.textContent = ms + ' ms';
        anRenderSqlResults();
        anAddReport(sql, d.rows, d.cols);
        anSaveHistory(sql);
        showToast(`${d.count} fila${d.count!==1?'s':''} · ${ms}ms`, 'success');
    } catch(e) {
        showToast('Error de conexión.', 'error');
    } finally {
        if (btn) { btn.disabled=false; btn.innerHTML='<i class="bi bi-play-fill"></i> Ejecutar'; }
    }
}

function anRenderSqlResults() {
    const {rows, cols} = _anSqlData;
    const rc = document.getElementById('anSqlRowCount');
    if (rc) rc.textContent = rows.length + ' fila'+(rows.length!==1?'s':'');
    const wrap = document.getElementById('anSqlTableWrap');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML='<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px;">Sin resultados</div>'; return; }
    wrap.innerHTML = `<table class="an-table">
      <thead><tr>${cols.map(c=>`<th>${incEsc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0,500).map(r=>`<tr>${cols.map(c=>`<td title="${incEsc(String(r[c]??''))}">${incEsc(String(r[c]??''))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function anAddReport(sql, rows, cols) {
    const id = Date.now();
    if (_anReports.length >= 3) {
        const oldest = _anReports.shift();
        if (_anBoardCharts[oldest.id]) { _anBoardCharts[oldest.id].destroy(); delete _anBoardCharts[oldest.id]; }
    }
    _anReports.push({id, sql, rows, cols, chartType:'bar'});
    anRenderBoard();
}

function anRemoveReport(id) {
    if (_anBoardCharts[id]) { _anBoardCharts[id].destroy(); delete _anBoardCharts[id]; }
    _anReports = _anReports.filter(r => r.id!==id);
    anRenderBoard();
}

function anRenderBoard() {
    const board = document.getElementById('anSqlBoard');
    const inner = document.getElementById('anBoardInner');
    if (!board || !inner) return;
    if (!_anReports.length) { board.style.display='none'; return; }
    board.style.display = 'block';
    const cnt = document.getElementById('anBoardCount');
    if (cnt) cnt.textContent = _anReports.length+'/3';
    inner.style.gridTemplateColumns = _anReports.length===1 ? '1fr' : _anReports.length===2 ? '1fr 1fr' : '1fr 1fr 1fr';
    Object.keys(_anBoardCharts).forEach(k => { _anBoardCharts[k].destroy(); delete _anBoardCharts[k]; });
    inner.innerHTML = _anReports.map((r,i) => anReportHTML(r,i)).join('');
    _anReports.forEach(r => anRenderReportChart(r));
}

function anReportHTML(r, idx) {
    const COLORS = ['#3b82f6','#8b5cf6','#10b981'];
    const color = COLORS[idx] || '#3b82f6';
    const numCols = r.cols.filter(c => r.rows.some(row => !isNaN(parseFloat(row[c]))));
    const label = r.sql.replace(/[\r\n\s]+/g,' ').trim();
    let kpis = `<div class="stat-card"><div class="stat-lbl">Filas</div><div class="stat-val c-blue">${r.rows.length.toLocaleString()}</div></div>`;
    kpis += `<div class="stat-card"><div class="stat-lbl">Cols</div><div class="stat-val">${r.cols.length}</div></div>`;
    numCols.slice(0,2).forEach(col => {
        const vals = r.rows.map(row => parseFloat(row[col])).filter(v => !isNaN(v));
        if (!vals.length) return;
        const sum = vals.reduce((a,b) => a+b, 0);
        kpis += `<div class="stat-card"><div class="stat-lbl">Σ ${incEsc(col)}</div><div class="stat-val">${sum.toLocaleString(undefined,{maximumFractionDigits:1})}</div></div>`;
    });
    const typeOpts = ['bar','line','pie','doughnut'].map(t =>
        `<option value="${t}"${r.chartType===t?' selected':''}>${{bar:'Barras',line:'Líneas',pie:'Pastel',doughnut:'Donut'}[t]}</option>`
    ).join('');
    return `<div class="an-card" id="anrpt-${r.id}">
      <div class="an-card-head" style="padding:8px 12px;">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
          <div style="width:19px;height:19px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;flex-shrink:0;">${idx+1}</div>
          <span style="font-size:10px;color:var(--text-muted);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${incEsc(label)}">${incEsc(label.slice(0,50))}${label.length>50?'…':''}</span>
        </div>
        <select class="an-input" style="width:78px;padding:2px 4px;font-size:10px;" onchange="anChangeRptChart(${r.id},this.value)">${typeOpts}</select>
        <button onclick="anRemoveReport(${r.id})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:1px 5px;font-size:12px;line-height:1;"><i class="bi bi-x-lg"></i></button>
      </div>
      <div style="display:flex;gap:6px;padding:7px 12px;border-bottom:1px solid var(--border-soft);flex-wrap:wrap;">${kpis}</div>
      <div style="padding:10px;height:200px;"><canvas id="anrptcv-${r.id}"></canvas></div>
    </div>`;
}

function anRenderReportChart(r) {
    const canvas = document.getElementById('anrptcv-'+r.id);
    if (!canvas || !r.rows.length) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const tickColor = isDark ? '#94a3b8' : '#64748b';
    const xCol = r.cols[0];
    const numCols = r.cols.filter(c => r.rows.some(row => !isNaN(parseFloat(row[c]))));
    const yCol = numCols[0] || r.cols[1] || r.cols[0];
    const data = r.rows.slice(0, 40);
    const labels = data.map(row => String(row[xCol]??''));
    const values = data.map(row => parseFloat(row[yCol])||0);
    const isPie = r.chartType==='pie' || r.chartType==='doughnut';
    const palette = data.map((_,i) => `hsl(${Math.round(i*360/Math.max(data.length,1))},60%,55%)`);
    if (_anBoardCharts[r.id]) _anBoardCharts[r.id].destroy();
    _anBoardCharts[r.id] = new Chart(canvas.getContext('2d'), {
        type: r.chartType,
        data: { labels, datasets: [{ label:yCol, data:values,
          backgroundColor: isPie ? palette : 'rgba(37,99,235,.72)',
          borderColor: isPie ? palette : '#2563eb', borderWidth:1, tension:.35 }] },
        options: { responsive:true, maintainAspectRatio:false,
          plugins: { legend: { display:isPie, labels:{color:tickColor,boxWidth:9,font:{size:9}} } },
          scales: isPie ? {} : {
            x: { ticks:{color:tickColor,maxRotation:30,font:{size:9}} },
            y: { ticks:{color:tickColor,font:{size:9}} }
          }
        },
    });
}

function anChangeRptChart(id, type) {
    const r = _anReports.find(r => r.id===id);
    if (r) { r.chartType=type; anRenderReportChart(r); }
}

function anDownloadSqlCSV() {
    const {rows, cols} = _anSqlData;
    if (!rows.length) { showToast('Sin datos para descargar.', 'error'); return; }
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c]??'')).join(','))].join('\r\n');
    _rptDownload(new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'}), 'consulta-resultado.csv');
}

async function buscarTicket() {
    const val = (document.getElementById('incSearchInput')?.value||'').trim();
    if (!val) return;
    const res = document.getElementById('result-buscar');
    if (!res) return;
    res.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div>';

    const isEmail = val.includes('@');
    const sort = document.getElementById('incSearchSort')?.value || 'DESC';

    try {
        if (isEmail) {
            // Buscar por correo de reporter
            const data = await jira('POST', '/rest/api/3/search/jql', {
                jql: `project = INC AND reporter = "${val}" ORDER BY created ${sort}`,
                fields: ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate','customfield_11795'],
                maxResults: 50
            });
            const issues = data.issues || [];
            if (!issues.length) {
                res.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><p>Sin tickets con reporter <b>${incEsc(val)}</b></p></div>`;
                return;
            }
            res.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;padding:4px 2px;border-bottom:1px solid var(--border-soft);display:flex;align-items:center;gap:6px;">
                <i class="bi bi-person-fill" style="color:var(--jira-blue);"></i>
                <b>${issues.length}</b> ticket(s) de <b>${incEsc(val)}</b>
                ${data.total > issues.length ? `<span style="margin-left:auto;font-size:10px;color:var(--text-muted);">(mostrando ${issues.length} de ${data.total})</span>` : ''}
            </div>` + issues.map(i => renderTicket(i)).join('');
        } else {
            // Buscar por número de ticket
            const key = val.toUpperCase().startsWith('INC-') ? val.toUpperCase() : 'INC-'+val;
            document.getElementById('incSearchInput').value = key;
            // Limpiar IDs duplicados de otros paneles
            ['card','asig','cerrar','comentar','pendiente','reanudar','trans','tq','note','detail'].forEach(pfx => {
                const el = document.getElementById(`${pfx}-${key}`);
                if (el && !el.closest('#result-buscar')) el.remove();
            });
            const issue = await jira('GET', `/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter,priority,created,updated,comment,resolutiondate`);
            res.innerHTML = renderTicket(issue);
        }
    } catch(e) {
        res.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><p>${incEsc(e.message)}</p></div>`;
    }
}

// ── Histórico ─────────────────────────────────────────────────────────────────
function autoLoadHistorico() {
    const input = document.getElementById('histEmail');
    if (!input) return;
    if (!input.value) {
        const saved = localStorage.getItem('jira_email') || (typeof CURRENT_USER_EMAIL !== 'undefined' ? CURRENT_USER_EMAIL : '') || '';
        if (saved) input.value = saved;
    }
    if (input.value) buscarHistorico();
}

async function buscarHistorico() {
    const email = (document.getElementById('histEmail')?.value||'').trim();
    const days  = document.getElementById('histDays')?.value||'30';
    const role  = document.getElementById('histRole')?.value||'assignee';
    if (!email) { showToast('Ingresa un correo','error'); return; }

    const dayClause = (days && days!=='0') ? ` AND created >= -${days}d` : '';
    const jql = `project = INC AND ${role} = "${email}"${dayClause} ORDER BY created DESC`;

    const res = document.getElementById('result-historico');
    if (!res) return;
    res.innerHTML = '<div class="inc-skeleton"></div><div class="inc-skeleton"></div><div class="inc-skeleton"></div>';

    try {
        const FIELDS = ['summary','status','assignee','reporter','priority','created','updated','comment','resolutiondate','customfield_15147','customfield_11795','description','resolution'];
        const data = await jira('POST', '/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 200 });
        const issues = data.issues || [];
        const total  = data.total ?? issues.length;

        const sub = document.getElementById('incTopbarSub'); if(sub) sub.textContent = `${total} tickets`;

        if (!issues.length) {
            res.innerHTML = `<div class="empty-state"><i class="bi bi-search"></i><p>Sin tickets para <b>${incEsc(email)}</b></p></div>`;
            return;
        }

        // ── Métricas ─────────────────────────────────────────────────────────
        const now = Date.now();
        const SLA_HRS = { highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24 };
        const fmtHrs  = h => h < 1 ? Math.round(h*60)+'min' : h < 24 ? h.toFixed(1)+'h' : Math.round(h/24)+'d';

        let cntOpen = 0, cntClosed = 0, mttrTotal = 0, mttrCount = 0;
        let slaOk = 0, slaBreach = 0;
        const byPrio = {}, resolvedTimes = [];

        for (const issue of issues) {
            const f = issue.fields || {};
            const stL = (f.status?.name||'').toLowerCase();
            const isDone = /cerr|done|closed|resuelto|resolved/.test(stL);
            if (isDone) cntClosed++; else cntOpen++;

            const prioName = f.priority?.name || 'Sin prioridad';
            byPrio[prioName] = (byPrio[prioName] || 0) + 1;

            const pk  = prioName.toLowerCase().replace(/\s+/g,'');
            const sHrs = SLA_HRS[pk] || (pk.includes('high') ? 4 : pk.includes('low') ? 24 : 8);
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
        const chartDays = Math.min(parseInt(days)||30, 30);
        const dayBuckets = [], creByDay = {}, resByDay = {};
        for (let i = chartDays-1; i >= 0; i--) {
            const k = new Date(now - i*86400000).toISOString().slice(0,10);
            dayBuckets.push(k); creByDay[k] = 0; resByDay[k] = 0;
        }
        for (const issue of issues) {
            const f = issue.fields||{};
            const cd = f.created?.slice(0,10);
            const rd = f.resolutiondate?.slice(0,10);
            if (cd && creByDay.hasOwnProperty(cd)) creByDay[cd]++;
            if (rd && resByDay.hasOwnProperty(rd)) resByDay[rd]++;
        }
        const chartLabels = dayBuckets.map(d => { const [,m,dy] = d.split('-'); return `${dy}/${m}`; });

        // ── Insights ─────────────────────────────────────────────────────────
        const insights = [];
        if (slaPct !== null && slaPct < 80)  insights.push({ icon:'bi-exclamation-triangle-fill', c:'#ef4444', msg:`Solo el <b>${slaPct}%</b> de tus tickets cumplen SLA — objetivo ≥80%` });
        if (slaBreach > 0)                    insights.push({ icon:'bi-lightning-charge-fill',     c:'#ef4444', msg:`<b>${slaBreach}</b> ticket${slaBreach>1?'s':''} con SLA vencido` });
        if (avgMttr > 24)                     insights.push({ icon:'bi-clock-history',             c:'#f59e0b', msg:`Tu MTTR promedio es <b>${fmtHrs(avgMttr)}</b> — intenta resolver más rápido` });
        if (cntOpen > 5)                      insights.push({ icon:'bi-inbox-fill',                c:'#3b82f6', msg:`Tienes <b>${cntOpen}</b> tickets aún abiertos` });
        if (slaPct !== null && slaPct >= 90)  insights.push({ icon:'bi-trophy-fill',               c:'#10b981', msg:`¡Excelente! <b>${slaPct}%</b> de SLA cumplido` });
        if (avgMttr > 0 && avgMttr <= 8)     insights.push({ icon:'bi-lightning-fill',             c:'#10b981', msg:`Buen ritmo: MTTR promedio <b>${fmtHrs(avgMttr)}</b>` });
        if (cntClosed === total && total > 0) insights.push({ icon:'bi-check-circle-fill',         c:'#10b981', msg:`Todos tus tickets están cerrados — sin pendientes` });

        // ── Priority bars ─────────────────────────────────────────────────────
        const PRIO_COLORS = { highest:'#ef4444',critical:'#ef4444',high:'#f59e0b',medium:'#3b82f6',low:'#10b981',lowest:'#6b7280' };
        const prioEntries = Object.entries(byPrio).sort((a,b)=>b[1]-a[1]);
        const maxPrioCount = Math.max(...prioEntries.map(e=>e[1]), 1);

        // ── Dedup DOM IDs from other panels ──────────────────────────────────
        issues.forEach(i => {
            ['card','asig','cerrar','comentar','pendiente','reanudar','trans','tq'].forEach(pfx => {
                const el = document.getElementById(`${pfx}-${i.key}`);
                if (el && !el.closest('#result-historico')) el.remove();
            });
        });

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
                <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Tickets — últimos ${chartDays} días</div>
                <div style="height:110px;"><canvas id="chartHistorico"></canvas></div>
            </div>
            <div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px;">
                <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Por prioridad</div>
                ${prioEntries.map(([prio,cnt])=>{
                    const pk2 = prio.toLowerCase().replace(/\s+/g,'');
                    const clr = Object.entries(PRIO_COLORS).find(([k])=>pk2.includes(k))?.[1]||'#94a3b8';
                    return `<div style="margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
                            <span style="color:var(--text-muted);">${incEsc(prio)}</span>
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
            <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;"><i class="bi bi-bar-chart-fill" style="margin-right:4px;"></i>Insights · qué mejorar</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${insights.map(ins=>`<div style="display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.5;">
                    <i class="bi ${ins.icon}" style="color:${ins.c};flex-shrink:0;margin-top:2px;"></i>
                    <span style="color:var(--text-main);">${ins.msg}</span>
                </div>`).join('')}
            </div>
        </div>` : ''}

        <div style="font-size:9px;font-family:monospace;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">${issues.length} tickets</div>
        <div>${issues.map(i=>renderTicket(i)).join('')}</div>`;

        // Draw chart after DOM flush
        requestAnimationFrame(() => {
            const canvas = document.getElementById('chartHistorico');
            if (!canvas) return;
            if (_chartInstances['_histChart']) { try { _chartInstances['_histChart'].destroy(); } catch(_){} }
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const gClr = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
            const tClr = isDark ? '#6b7280' : '#9ca3af';
            _chartInstances['_histChart'] = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: chartLabels,
                    datasets: [
                        { label:'Creados',  data: dayBuckets.map(d=>creByDay[d]), backgroundColor:'rgba(59,130,246,.65)',  borderRadius:3, borderSkipped:false },
                        { label:'Resueltos',data: dayBuckets.map(d=>resByDay[d]), backgroundColor:'rgba(16,185,129,.65)', borderRadius:3, borderSkipped:false }
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

    } catch(e) {
        res.innerHTML = `<div class="empty-state"><p style="color:#ef4444;">${incEsc(e.message)}</p></div>`;
        showToast(e.message,'error');
    }
}

// ── Helpers de búsqueda scoped al card ─────────────────────────────────────────
// Recibe un elemento dentro del card (botón, input, etc.) y busca por ID dentro de él
function _inCard(elOrKey, id) {
    const card = typeof elOrKey === 'string'
        ? document.getElementById('card-'+elOrKey)
        : (elOrKey ? elOrKey.closest('.ticket-card') : null);
    return (card ? card.querySelector('#'+id) : null) || document.getElementById(id);
}

// ── Reasignar / Comentar ─────────────────────────────────────────────────────────
async function ejecutarAsignar(key, overrideEmail) {
    const inp = _inCard(key, 'asig-input-'+key);
    const email = overrideEmail || (inp?.value||'').trim();
    if (!email) { showToast('Ingresa un correo','error'); return; }
    try {
        // Usar assignable/search para obtener solo usuarios que pueden ser asignados a este issue
        let users = await jira('GET', `/rest/api/3/user/assignable/search?issueKey=${encodeURIComponent(key)}&query=${encodeURIComponent(email)}`);
        // Fallback: búsqueda general filtrando cuentas tipo 'atlassian' (no customers)
        if (!users.length) {
            const all = await jira('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}`);
            users = all.filter(u => u.accountType === 'atlassian' || !u.accountType?.startsWith('customer'));
        }
        if (!users.length) throw new Error(`"${email}" no es un agente Jira asignable. Verifica que tenga licencia activa de Jira Software.`);
        const { accountId, displayName } = users[0];
        await jira('PUT', `/rest/api/3/issue/${key}/assignee`, { accountId });
        // Actualizar BD local también
        fetch(`/api/jira/ticket/${key}/assign-tech`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ email, accountId })
        }).catch(() => {});
        showToast(`✓ ${key} asignado a ${displayName}`, 'success');
        _inCard(key, 'asig-'+key)?.style.setProperty('display','none');
        reloadCard(key);
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
}

async function ejecutarComentar(key) {
    const text = _inCard(key, 'comentar-input-'+key)?.value.trim();
    if (!text) { showToast('Ingresa un comentario','error'); return; }
    try {
        await jira('POST', `/rest/api/3/issue/${key}/comment`, { body: incAdf(text) });
        showToast(`✓ Comentario agregado a ${key}`, 'success');
        _inCard(key, 'comentar-'+key)?.style.setProperty('display','none');
        reloadCard(key);
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
}

// ── Cascada Resultado (definido en ticket-card.js — no redeclarar) ────────────
function updateResultadoHijoAdv(key) {
    const padre = document.getElementById(`cerrar-rpadre-adv-${key}`)?.value||'';
    const sel   = document.getElementById(`cerrar-rhijo-adv-${key}`);
    if (!sel) return;
    sel.innerHTML = (RESULTADO_HIJOS[padre]||[]).map(h=>`<option>${h}</option>`).join('');
}
function toggleAvanzado(key) {
    const el = document.getElementById(`avanzado-${key}`);
    if (el) el.style.display = el.style.display==='none'||!el.style.display ? 'block' : 'none';
}
function actualizarLabel(key) {
    const res   = document.getElementById(`cerrar-res-adv-${key}`)?.value||'Resuelto';
    const padre = document.getElementById(`cerrar-rpadre-adv-${key}`)?.value||'Workplace';
    const hijo  = document.getElementById(`cerrar-rhijo-adv-${key}`)?.value||'Workplace';
    const lbl   = document.getElementById(`lbl-res-${key}`);
    if (lbl) lbl.textContent = `${res} · ${padre} · ${hijo}`;
}

// ── Cerrar ticket ─────────────────────────────────────────────────────────────
async function ejecutarCierre(key) {
    const advEl      = document.getElementById(`avanzado-${key}`);
    const advVisible = advEl && advEl.style.display !== 'none';
    const resolucion = (advVisible ? document.getElementById(`cerrar-res-adv-${key}`)?.value   : null) || 'Resuelto';
    const proceso    = (advVisible ? document.getElementById(`cerrar-proc-adv-${key}`)?.value  : null) || 'WORKPLACE';
    const resPadre   = (advVisible ? document.getElementById(`cerrar-rpadre-adv-${key}`)?.value: null) || 'Workplace';
    const resHijo    = (advVisible ? document.getElementById(`cerrar-rhijo-adv-${key}`)?.value : null) || 'Workplace';
    const masiva     = (advVisible ? document.getElementById(`cerrar-masiva-adv-${key}`)?.value: null) || 'NO';
    const baseComment = document.getElementById(`cerrar-com-${key}`)?.value.trim();
    if (!baseComment) { showToast('Agrega un comentario de cierre','error'); return; }

    const btn = document.getElementById(`btnCerrar-${key}`);
    if (btn) { btn.disabled=true; btn.innerHTML='<i class="bi bi-hourglass-split"></i> Cerrando...'; }

    try {
        const res = await fetch(`/api/jira/ticket/${key}/close`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                comment: baseComment,
                tipo_atencion: 'remota',
                resolucion,
                proceso,
                resultado_padre: resPadre,
                resultado_hijo:  resHijo,
                masiva,
            })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'Error al cerrar');

        showToast(`✅ Ticket ${key} cerrado`, 'success');
        document.getElementById(`cerrar-${key}`)?.classList.remove('open');
        reloadCard(key);
    } catch(e) {
        showToast('Error al cerrar: '+e.message,'error');
        if (btn) { btn.disabled=false; btn.innerHTML='<i class="bi bi-check2-circle"></i> Confirmar cierre'; }
    }
}

// ── Reload card individual ────────────────────────────────────────────────────
async function reloadCard(key) {
    try {
        const issue = await jira('GET', `/rest/api/3/issue/${key}?fields=summary,status,assignee,reporter,priority,created,updated,comment`);
        const card  = document.getElementById('card-'+key);
        if (card) {
            const tmp = document.createElement('div');
            tmp.innerHTML = renderTicket(issue);
            card.replaceWith(tmp.firstElementChild);
        }
    } catch(e) { console.warn('reloadCard:', e.message); }
}

// ── Ver transiciones ──────────────────────────────────────────────────────────
async function verTransiciones(key) {
    try {
        const data  = await jira('GET', `/rest/api/3/issue/${key}/transitions`);
        const lines = (data.transitions||[]).map(t=>`• ${t.name} (id: ${t.id})`).join('\n');
        alert(`Transiciones para ${key}:\n\n${lines||'(ninguna)'}`);
    } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ── Feedback encuesta portal ──────────────────────────────────────────────────
async function confirmSurveyEmail(){
  const selOpts = Array.from(document.getElementById('sfQuestions').selectedOptions).map(function(o){ return o.value; });
  const sendBtn = document.getElementById('sfSendBtn');
  sendBtn.disabled = true; sendBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...';
  try {
    const r = await fetch('/api/portal/survey-general/'+_surveyEmailId+'/send-email', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ questions: selOpts })
    });
    const j = await r.json();
    if(!j.success) throw new Error(j.error);
    bootstrap.Modal.getInstance(document.getElementById('sfModal')).hide();
    if(_surveyEmailBtn){
      _surveyEmailBtn.innerHTML = '<i class="bi bi-check2"></i> Enviado';
      _surveyEmailBtn.style.background = '#10b981';
      setTimeout(function(){
        if(_surveyEmailBtn){ _surveyEmailBtn.disabled=false; _surveyEmailBtn.innerHTML='<i class="bi bi-envelope-fill"></i> Enviar correo'; _surveyEmailBtn.style.background='#2563eb'; }
      }, 4000);
    }
  } catch(e) {
    showToast('Error al enviar: '+e.message,'error');
  } finally {
    sendBtn.disabled=false; sendBtn.innerHTML='<i class="bi bi-send-fill"></i> Enviar correo';
  }
}

// ── Mis Paneles ────────────────────────────────────────────────────────────────
var _mpDays    = 30;
var _mpIssues  = [];
var _mpLoading = false;
var _mpCharts  = {};
var _mpCat     = 0;
var _mpSel     = new Set(['monthly','status','prio','assignee']);

var _MP_CAT = {
    inc: [
        { id:'monthly',    label:'Mensual',       icon:'bi-graph-up-arrow',    color:'#3b82f6' },
        { id:'status',     label:'Estados',        icon:'bi-pie-chart-fill',    color:'#8b5cf6' },
        { id:'prio',       label:'Prioridades',    icon:'bi-flag-fill',         color:'#f59e0b' },
        { id:'assignee',   label:'Top Técnicos',   icon:'bi-person-lines-fill', color:'#10b981' },
        { id:'reporter',   label:'Top Reporteros', icon:'bi-people',            color:'#ef4444' },
        { id:'sla',        label:'SLA',            icon:'bi-shield-check',      color:'#6366f1' },
        { id:'weekly',     label:'Semanal',        icon:'bi-bar-chart-steps',   color:'#0ea5e9' }
    ],
    wp: [
        { id:'wpload',     label:'Carga Técnico',  icon:'bi-person-workspace',  color:'#3b82f6' },
        { id:'wpresolved', label:'Resueltos Hoy',  icon:'bi-check2-circle',     color:'#10b981' },
        { id:'wpsla',      label:'SLA/Técnico',    icon:'bi-shield-half',       color:'#f59e0b' },
        { id:'wpmttr',     label:'MTTR',           icon:'bi-stopwatch-fill',    color:'#8b5cf6' },
        { id:'wpcat',      label:'Categorías',     icon:'bi-tags-fill',         color:'#ec4899' }
    ]
};

function mpPeriod(days, el) {
    _mpDays = days;
    document.querySelectorAll('.mp-period-btn').forEach(function(b) { b.classList.remove('active'); });
    if (el) el.classList.add('active');
    loadMisPaneles(true);
}

function mpSwitchCat(idx) {
    _mpCat = idx;
    document.querySelectorAll('.mp-tab').forEach(function(t, i) { t.classList.toggle('active', i === idx); });
    _mpRenderChipBar();
    _mpRenderCanvas();
}

function mpToggleChart(id) {
    if (_mpSel.has(id)) _mpSel.delete(id); else _mpSel.add(id);
    _mpRenderChipBar();
    _mpRenderCanvas();
}

function _mpCurrentCatalog() {
    if (_mpCat === 0) return _MP_CAT.inc;
    if (_mpCat === 1) return _MP_CAT.wp;
    return _MP_CAT.inc.concat(_MP_CAT.wp);
}

function _mpRenderChipBar() {
    var el = document.getElementById('mpChipBar');
    if (!el) return;
    el.innerHTML = _mpCurrentCatalog().map(function(c) {
        return '<button class="mp-chip' + (_mpSel.has(c.id) ? ' active' : '') + '" onclick="mpToggleChart(\'' + c.id + '\')">'
             + '<i class="bi ' + c.icon + '" style="color:' + c.color + ';"></i> ' + c.label + '</button>';
    }).join('');
}

function _mpUpdateBranding() {
    var sub = document.getElementById('mpBrandSub');
    var dt  = document.getElementById('mpBrandDate');
    if (sub) sub.textContent = 'Últimos ' + _mpDays + ' días · ' + _mpIssues.length + ' tickets';
    if (dt)  dt.textContent  = 'Generado ' + new Date().toLocaleString('es-PE', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function _mpPanelVisible() {
    var p = document.getElementById('panel-paneles');
    return !!(p && p.classList.contains('active'));
}

async function loadMisPaneles(force) {
    if (_mpLoading && !force) return;

    // Try shared Analizador cache first
    var CKEY = 'jira-board-' + _mpDays;
    var cached = typeof _cacheGet === 'function' ? _cacheGet(CKEY) : null;
    if (cached && !force) {
        _mpIssues = cached;
        _mpUpdateBranding();
        _mpRenderChipBar();
        _mpRenderKpis();
        if (_mpPanelVisible()) _mpRenderCanvas();
        return;
    }

    _mpLoading = true;
    var spinner = document.getElementById('mpSpinner');
    if (spinner) spinner.style.display = '';

    try {
        var dateClause = _mpDays > 0 ? ' AND created >= -' + _mpDays + 'd' : '';
        var JQL = 'project = INC AND "Tipo de Componente" = Workplace' + dateClause + ' ORDER BY created DESC';
        var FIELDS = ['summary','status','priority','assignee','reporter','created','resolutiondate','customfield_15147'];
        var all = [], token;
        while (true) {
            var body = { jql: JQL, fields: FIELDS, maxResults: 100 };
            if (token) body.nextPageToken = token;
            var d = await jira('POST', '/rest/api/3/search/jql', body);
            all.push.apply(all, d.issues || []);
            if (!d.issues || !d.issues.length || d.isLast !== false || !d.nextPageToken || all.length >= 2000) break;
            token = d.nextPageToken;
        }
        _mpIssues = all;
        if (typeof _cacheSet === 'function') _cacheSet(CKEY, all);
        _mpUpdateBranding();
        _mpRenderChipBar();
        _mpRenderKpis();
        if (_mpPanelVisible()) _mpRenderCanvas();
    } catch(e) {
        var cv = document.getElementById('mpCanvas');
        if (cv) cv.innerHTML = '<div style="grid-column:1/-1;color:#ef4444;padding:20px;font-size:12px;">' + incEsc(e.message) + '</div>';
    } finally {
        _mpLoading = false;
        if (spinner) spinner.style.display = 'none';
    }
}

function _mpTagIssues(issues) {
    var now  = Date.now();
    var SLA  = {highest:1,p1:1,critical:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24};
    issues.forEach(function(iss) {
        var f   = iss.fields || {};
        var pk  = (f.priority && f.priority.name || '').toLowerCase().replace(/\s+/g,'');
        var slaH = SLA[pk] || 8;
        var creMs = f.created ? new Date(f.created).getTime() : 0;
        var resMs = f.resolutiondate ? new Date(f.resolutiondate).getTime() : 0;
        var stL   = (f.status && f.status.name || '').toLowerCase();
        var done  = /cerr|done|closed|resuelto|resolved/.test(stL);
        iss._cre    = creMs;
        iss._res    = resMs;
        iss._done   = done;
        iss._slaOk  = creMs ? (done && resMs ? (resMs-creMs)/3600000 <= slaH : (now-creMs)/3600000 <= slaH) : null;
    });
    return issues;
}

function _mpRenderKpis() {
    var el = document.getElementById('mpKpiRow');
    if (!el) return;
    var issues = _mpTagIssues(_mpIssues.slice());
    var total   = issues.length;
    var closed  = issues.filter(function(i){return i._done;}).length;
    var open    = total - closed;
    var unassg  = issues.filter(function(i){return !(i.fields && i.fields.assignee);}).length;
    var slaOk   = issues.filter(function(i){return i._slaOk===true;}).length;
    var slaTot  = issues.filter(function(i){return i._slaOk!==null;}).length;
    var slaPct  = slaTot ? Math.round(slaOk/slaTot*100) : null;
    var resWt   = issues.filter(function(i){return i._done&&i._res&&i._cre;});
    var avgMttrH = resWt.length ? Math.round(resWt.reduce(function(s,i){return s+(i._res-i._cre);},0)/resWt.length/3600000) : null;
    el.innerHTML =
        '<div class="mp-kpi"><div class="mp-kpi-v" style="color:#3b82f6">' + total + '</div><div class="mp-kpi-l">Total</div></div>' +
        '<div class="mp-kpi"><div class="mp-kpi-v" style="color:#f59e0b">' + open + '</div><div class="mp-kpi-l">Abiertos</div></div>' +
        '<div class="mp-kpi"><div class="mp-kpi-v" style="color:#10b981">' + closed + '</div><div class="mp-kpi-l">Cerrados</div></div>' +
        '<div class="mp-kpi"><div class="mp-kpi-v" style="color:#7c3aed">' + unassg + '</div><div class="mp-kpi-l">Sin asignar</div></div>' +
        '<div class="mp-kpi"><div class="mp-kpi-v" style="color:' + (slaPct!=null?(slaPct>=80?'#10b981':'#ef4444'):'var(--text-muted)') + '">' + (slaPct!=null?slaPct+'%':'—') + '</div><div class="mp-kpi-l">SLA</div></div>' +
        '<div class="mp-kpi"><div class="mp-kpi-v" style="color:#8b5cf6">' + (avgMttrH!=null?avgMttrH+'h':'—') + '</div><div class="mp-kpi-l">MTTR prom.</div></div>';
}

function _mpRenderCanvas() {
    var el = document.getElementById('mpCanvas');
    if (!el) return;
    Object.keys(_mpCharts).forEach(function(k) { if (_mpCharts[k]) _mpCharts[k].destroy(); });
    _mpCharts = {};

    var cats = _mpCurrentCatalog().filter(function(c){return _mpSel.has(c.id);});
    if (!cats.length) {
        el.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted);">'
            + '<i class="bi bi-bar-chart-line" style="font-size:32px;display:block;margin-bottom:8px;opacity:.4;"></i>'
            + 'Selecciona gráficos con los botones de arriba</div>';
        return;
    }

    el.innerHTML = cats.map(function(c) {
        return '<div class="mp-chart-card">'
            + '<div class="mp-chart-hd">'
            + '<span><i class="bi ' + c.icon + '" style="color:' + c.color + ';margin-right:6px;"></i>' + c.label + '</span>'
            + '<button class="mp-chart-dl mp-hide-export" onclick="mpDownloadSingle(\'mp-c-' + c.id + '\')" title="Descargar"><i class="bi bi-download"></i></button>'
            + '</div><div class="mp-chart-body"><canvas id="mp-c-' + c.id + '"></canvas></div></div>';
    }).join('');

    setTimeout(function() {
        var issues = _mpTagIssues(_mpIssues.slice());
        cats.forEach(function(c) { _mpDrawChart(c.id, issues); });
        // Resize charts in case canvas was previously 0-width
        setTimeout(function() {
            Object.keys(_mpCharts).forEach(function(k) { if (_mpCharts[k] && typeof _mpCharts[k].resize === 'function') _mpCharts[k].resize(); });
        }, 80);
    }, 0);
}

function _mpMkChart(canvasId, type, labels, datasets, opts) {
    if (_mpCharts[canvasId]) { _mpCharts[canvasId].destroy(); }
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc     = isDark ? '#94a3b8' : '#64748b';
    _mpCharts[canvasId] = new Chart(canvas.getContext('2d'), {
        type: type, data: { labels: labels, datasets: datasets },
        options: Object.assign({ responsive:true, maintainAspectRatio:false, animation:{duration:350},
            plugins:{ legend:{ labels:{ color:tc, font:{size:10}, boxWidth:10 } } }
        }, opts || {})
    });
}

function _mpDrawChart(id, issues) {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc   = isDark ? '#94a3b8' : '#64748b';
    var grid = isDark ? 'rgba(148,163,184,.1)' : 'rgba(0,0,0,.06)';
    var now  = Date.now();
    var cid  = 'mp-c-' + id;
    var scXY = { x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}}, y:{ticks:{color:tc,font:{size:9}},grid:{color:grid}} };
    var scHBar = { x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}}, y:{ticks:{color:tc,font:{size:9},maxRotation:0},grid:{color:grid}} };

    if (id === 'monthly') {
        var months = [];
        for (var i=11;i>=0;i--) { var dm=new Date();dm.setDate(1);dm.setMonth(dm.getMonth()-i); months.push(dm.toLocaleString('es-PE',{month:'short',year:'numeric'})); }
        var cnt=new Array(12).fill(0), cls=new Array(12).fill(0);
        issues.forEach(function(iss){ if(!iss._cre)return; var k=new Date(iss._cre).toLocaleString('es-PE',{month:'short',year:'numeric'}); var ix=months.indexOf(k); if(ix>=0){cnt[ix]++;if(iss._done)cls[ix]++;} });
        _mpMkChart(cid,'bar',months,[
            {label:'Creados',data:cnt,backgroundColor:'rgba(37,99,235,.7)',borderColor:'#2563eb',borderWidth:1},
            {label:'Cerrados',data:cls,backgroundColor:'rgba(16,185,129,.7)',borderColor:'#10b981',borderWidth:1}
        ],{scales:scXY});
    } else if (id === 'status') {
        var sm={};
        issues.forEach(function(iss){ var s=(iss.fields&&iss.fields.status&&iss.fields.status.name)||'Sin estado'; sm[s]=(sm[s]||0)+1; });
        var ent=Object.entries(sm).sort(function(a,b){return b[1]-a[1];}).slice(0,8);
        var pal=ent.map(function(_,i){return 'hsl('+Math.round(i*360/Math.max(ent.length,1))+',60%,55%)';});
        _mpMkChart(cid,'doughnut',ent.map(function(e){return e[0];}),
            [{data:ent.map(function(e){return e[1];}),backgroundColor:pal,borderWidth:2,borderColor:isDark?'#1e293b':'#fff'}],
            {plugins:{legend:{position:'right',labels:{color:tc,font:{size:10},boxWidth:8}}},cutout:'58%'});
    } else if (id === 'prio') {
        var po=['Highest','High','Medium','Low','Lowest','P1','P2','P3','P4'];
        var pm={};
        issues.forEach(function(iss){ var p=(iss.fields&&iss.fields.priority&&iss.fields.priority.name)||'Sin prioridad'; pm[p]=(pm[p]||0)+1; });
        var pc={'Highest':'#dc2626','P1':'#dc2626','High':'#f59e0b','P2':'#f59e0b','Medium':'#3b82f6','P3':'#3b82f6','Low':'#10b981','P4':'#10b981','Lowest':'#94a3b8'};
        var pe=Object.entries(pm).sort(function(a,b){ return (po.indexOf(a[0])<0?99:po.indexOf(a[0]))-(po.indexOf(b[0])<0?99:po.indexOf(b[0])); });
        _mpMkChart(cid,'bar',pe.map(function(e){return e[0];}),
            [{label:'Tickets',data:pe.map(function(e){return e[1];}),backgroundColor:pe.map(function(e){return pc[e[0]]||'#6366f1';}),borderRadius:4}],
            {indexAxis:'y',plugins:{legend:{display:false}},scales:scHBar});
    } else if (id === 'assignee') {
        var am={};
        issues.forEach(function(iss){ var a=(iss.fields&&iss.fields.assignee); var n=a?(a.displayName||a.emailAddress||'Sin asignar'):'Sin asignar'; am[n]=(am[n]||0)+1; });
        var at=Object.entries(am).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
        _mpMkChart(cid,'bar',at.map(function(e){return e[0].split(' ').slice(0,2).join(' ');}),
            [{label:'Tickets',data:at.map(function(e){return e[1];}),backgroundColor:'rgba(16,185,129,.75)',borderRadius:4}],
            {indexAxis:'y',plugins:{legend:{display:false}},scales:scHBar});
    } else if (id === 'reporter') {
        var rm={};
        issues.forEach(function(iss){ var r=(iss.fields&&iss.fields.reporter); var n=r?(r.displayName||r.emailAddress||'—'):'—'; rm[n]=(rm[n]||0)+1; });
        var rt=Object.entries(rm).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
        _mpMkChart(cid,'bar',rt.map(function(e){return e[0].split(' ').slice(0,2).join(' ');}),
            [{label:'Tickets',data:rt.map(function(e){return e[1];}),backgroundColor:'rgba(239,68,68,.7)',borderRadius:4}],
            {indexAxis:'y',plugins:{legend:{display:false}},scales:scHBar});
    } else if (id === 'sla') {
        var po2=['Highest','High','Medium','Low','Lowest'];
        var okM={},totM={};
        issues.forEach(function(iss){ if(iss._slaOk===null)return; var p=(iss.fields&&iss.fields.priority&&iss.fields.priority.name)||'Sin prioridad'; okM[p]=(okM[p]||0)+(iss._slaOk?1:0); totM[p]=(totM[p]||0)+1; });
        var se=Object.entries(totM).sort(function(a,b){return (po2.indexOf(a[0])<0?99:po2.indexOf(a[0]))-(po2.indexOf(b[0])<0?99:po2.indexOf(b[0]));});
        var pcts=se.map(function(e){return e[1]?Math.round((okM[e[0]]||0)/e[1]*100):0;});
        _mpMkChart(cid,'bar',se.map(function(e){return e[0];}),
            [{label:'SLA %',data:pcts,backgroundColor:pcts.map(function(v){return v>=80?'rgba(16,185,129,.75)':v>=60?'rgba(245,158,11,.75)':'rgba(239,68,68,.75)';}),borderRadius:4}],
            {plugins:{legend:{display:false}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}},y:{min:0,max:100,ticks:{color:tc,font:{size:9},callback:function(v){return v+'%';}},grid:{color:grid}}}});
    } else if (id === 'weekly') {
        var wk=['S-7','S-6','S-5','S-4','S-3','S-2','S-1','Esta sem.'];
        var wo=new Array(8).fill(0), wc=new Array(8).fill(0);
        issues.forEach(function(iss){ if(!iss._cre)return; var wa=Math.floor((now-iss._cre)/(7*86400000)); if(wa<8){var ix=7-wa; if(iss._done)wc[ix]++;else wo[ix]++;} });
        _mpMkChart(cid,'bar',wk,[
            {label:'Abiertos',data:wo,backgroundColor:'rgba(245,158,11,.75)',borderRadius:3},
            {label:'Cerrados',data:wc,backgroundColor:'rgba(16,185,129,.75)',borderRadius:3}
        ],{scales:scXY});
    } else if (id==='wpload'||id==='wpresolved'||id==='wpsla'||id==='wpmttr'||id==='wpcat') {
        _mpDrawWpChart(id, cid);
    }
}

function _mpDrawWpChart(id, cid) {
    if (_tecLoading) {
        setTimeout(function() { _mpDrawWpChart(id, cid); }, 700);
        return;
    }
    if (!_tecIssues.length) {
        loadTecStats().then(function(){ _mpDrawWpChart(id, cid); }).catch(function(){});
        return;
    }
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var tc   = isDark ? '#94a3b8' : '#64748b';
    var grid = isDark ? 'rgba(148,163,184,.1)' : 'rgba(0,0,0,.06)';
    var stats = _tecProcess(_tecIssues);
    var scHBar = { x:{ticks:{color:tc,font:{size:9}},grid:{color:grid}}, y:{ticks:{color:tc,font:{size:9},maxRotation:0},grid:{color:grid}} };
    var top10 = stats.slice(0,10);
    var names = function(arr){ return arr.map(function(t){return t.displayName.split(' ').slice(0,2).join(' ');}); };

    if (id === 'wpload') {
        _mpMkChart(cid,'bar',names(top10),[
            {label:'Activos',data:top10.map(function(t){return t.activos;}),backgroundColor:'rgba(59,130,246,.75)',borderRadius:4},
            {label:'Vencidos',data:top10.map(function(t){return t.vencidos;}),backgroundColor:'rgba(239,68,68,.75)',borderRadius:4}
        ],{indexAxis:'y',scales:scHBar});
    } else if (id === 'wpresolved') {
        var wr=stats.filter(function(t){return t.resueltosHoy>0;}).sort(function(a,b){return b.resueltosHoy-a.resueltosHoy;}).slice(0,10);
        _mpMkChart(cid,'bar',names(wr),[{label:'Resueltos hoy',data:wr.map(function(t){return t.resueltosHoy;}),backgroundColor:'rgba(16,185,129,.75)',borderRadius:4}],
            {indexAxis:'y',plugins:{legend:{display:false}},scales:scHBar});
    } else if (id === 'wpsla') {
        var ws=stats.filter(function(t){return t.activos>0;}).slice(0,10);
        var sp=ws.map(function(t){return t.activos?Math.round((t.activos-t.vencidos)/t.activos*100):0;});
        _mpMkChart(cid,'bar',names(ws),[{label:'SLA OK %',data:sp,backgroundColor:sp.map(function(v){return v>=80?'rgba(16,185,129,.75)':v>=60?'rgba(245,158,11,.75)':'rgba(239,68,68,.75)';}),borderRadius:4}],
            {indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{min:0,max:100,ticks:{color:tc,font:{size:9},callback:function(v){return v+'%';}},grid:{color:grid}},y:{ticks:{color:tc,font:{size:9},maxRotation:0},grid:{color:grid}}}});
    } else if (id === 'wpmttr') {
        var wm=stats.filter(function(t){return t.mttrHoy!=null;}).sort(function(a,b){return a.mttrHoy-b.mttrHoy;}).slice(0,10);
        _mpMkChart(cid,'bar',names(wm),[{label:'MTTR (h)',data:wm.map(function(t){return Math.round(t.mttrHoy/360000)/10;}),backgroundColor:'rgba(99,102,241,.75)',borderRadius:4}],
            {indexAxis:'y',plugins:{legend:{display:false}},scales:scHBar});
    } else if (id === 'wpcat') {
        var catM={};
        _tecIssues.forEach(function(iss){ var c=iss.fields&&iss.fields.customfield_15147&&iss.fields.customfield_15147.value; if(c&&c!=='null'&&c!=='undefined') catM[c]=(catM[c]||0)+1; });
        var ce=Object.entries(catM).sort(function(a,b){return b[1]-a[1];}).slice(0,8);
        var pal=ce.map(function(_,i){return 'hsl('+Math.round(i*360/Math.max(ce.length,1))+',60%,55%)';});
        _mpMkChart(cid,'doughnut',ce.map(function(e){return e[0];}),
            [{data:ce.map(function(e){return e[1];}),backgroundColor:pal,borderWidth:2,borderColor:isDark?'#1e293b':'#fff'}],
            {plugins:{legend:{position:'right',labels:{color:tc,font:{size:10},boxWidth:8}}},cutout:'52%'});
    }
}

function mpDownloadSingle(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var link = document.createElement('a');
    link.download = canvasId.replace('mp-c-','') + '-chart.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

async function mpDownload() {
    if (!window.html2canvas) {
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = function() { mpDownload(); };
        document.head.appendChild(s);
        showToast('Preparando descarga…', 'info');
        return;
    }
    var zone = document.getElementById('mpCaptureZone');
    if (!zone) return;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    try {
        showToast('Generando imagen…', 'info');
        var cvs = await window.html2canvas(zone, {
            backgroundColor: isDark ? '#0f172a' : '#f8fafc',
            scale: 2,
            useCORS: true,
            logging: false,
            onclone: function(doc) {
                doc.querySelectorAll('.mp-hide-export,.mp-chart-dl').forEach(function(e){ e.style.display='none'; });
            }
        });
        var link = document.createElement('a');
        link.download = 'reporte-incidencias-' + _mpDays + 'd-' + new Date().toISOString().slice(0,10) + '.png';
        link.href = cvs.toDataURL('image/png');
        link.click();
        showToast('Imagen descargada', 'success');
    } catch(e) {
        showToast('Error al generar imagen: ' + e.message, 'error');
    }
}

// ── Prefetch silencioso: calienta el cache de Indicadores y Analizador ────────
(function _warmupCache() {
    const GO = function() {
        // Esperar a que el JS de la página esté listo y la sesión activa
        setTimeout(function() {
            // Indicadores — llama al backend stats-live
            fetch('/api/jira/stats-live', { credentials: 'include' })
                .then(function(r) { return r.json(); })
                .then(function(j) { if (j.success && typeof _cacheSet === 'function') _cacheSet('stats-live', j.data); })
                .catch(function() {});
            // Analizador — pagina Jira (usa el período por defecto 90 días)
            if (typeof _fetchAnJiraIssues === 'function') {
                _fetchAnJiraIssues()
                    .then(function(issues) { _cacheSet('jira-board-' + _anDbDays, issues); })
                    .catch(function() {});
            }
        }, 2000);
    };
    if (document.readyState === 'complete') GO();
    else window.addEventListener('load', GO);
})();

// ── Feature B: Kanban ──────────────────────────────────────────────────────────

const KB_COLS_DEF = [
    { id:'sinAsig',  label:'Sin asignar', color:'#ef4444', icon:'person-x-fill'     },
    { id:'asignado', label:'Asignado',    color:'#3b82f6', icon:'person-check-fill'  },
    { id:'espera',   label:'En espera',   color:'#f59e0b', icon:'pause-circle-fill'  },
    { id:'resuelto', label:'Resuelto',    color:'#10b981', icon:'check-circle-fill'  },
];

function _kbClassify(issue) {
    const f  = issue.fields || {};
    const st = (f.status?.name || '').toLowerCase();
    if (/resuel|resolv|^done$|complet|cerr|clos/.test(st)) return 'resuelto';
    if (/espera|pend|wait|hold/.test(st))                  return 'espera';
    if (!f.assignee)                                        return 'sinAsig';
    return 'asignado';
}

function _kbPriColor(p) {
    const m = { critical:'#ef4444', highest:'#ef4444', high:'#f59e0b', medium:'#3b82f6', low:'#6b7280', lowest:'#6b7280' };
    return m[(p||'').toLowerCase()] || '#6b7280';
}

function _kbCardHtml(issue) {
    const f         = issue.fields || {};
    const key       = issue.key;
    const sum       = incEsc(f.summary || '—');
    const pri       = f.priority?.name || '';
    const pc        = _kbPriColor(pri);
    const asgn      = f.assignee?.displayName || f.assignee?.emailAddress || '';
    const asgnEmail = (f.assignee?.emailAddress || '').toLowerCase();
    const initials  = asgn ? asgn.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() : '?';
    const tc        = _techColor(asgn);
    const isMine    = asgnEmail && CURRENT_USER_EMAIL && asgnEmail === CURRENT_USER_EMAIL.toLowerCase();
    const cre       = f.created ? new Date(f.created) : null;
    const age       = cre ? _alrtAge(Date.now() - cre.getTime()) : '—';
    return `<div class="kb-card${isMine?' kb-mine':''}" draggable="true" data-key="${incEsc(key)}"
      style="border-left:3px solid ${tc};"
      ondragstart="kbDragStart(event)" ondragend="kbDragEnd(event)">
      <div class="kb-card-top">
        <span class="kb-key" onclick="event.stopPropagation();window.open('https://integratelperu.atlassian.net/browse/${key}','_blank')">${key}</span>
        <span style="width:7px;height:7px;border-radius:50%;background:${pc};flex-shrink:0;" title="${incEsc(pri)}"></span>
        <span style="font-size:10px;color:var(--text-muted);margin-left:auto;">${age}</span>
      </div>
      <div class="kb-sum" title="${sum}">${sum}</div>
      <div class="kb-meta">
        <span class="kb-avatar" style="background:${tc};" title="${incEsc(asgn||'Sin asignar')}">${initials}</span>
        <span style="color:${tc};font-weight:600;">${incEsc(asgn ? asgn.split(' ')[0] : 'Sin asignar')}</span>
        <span style="margin-left:auto;font-size:9px;">${incEsc(f.status?.name||'')}</span>
      </div>
    </div>`;
}

function _renderKanbanCol(issues, colDef) {
    const bodyId = `kb-body-${colDef.id}`;
    const priFilter = (document.getElementById('kbFilterPriority')?.value || '').toLowerCase();
    const filtered  = priFilter ? issues.filter(i => (i.fields?.priority?.name||'').toLowerCase() === priFilter) : issues;
    return `<div class="kb-col">
      <div class="kb-col-hdr" style="border-left:3px solid ${colDef.color};">
        <i class="bi bi-${colDef.icon}" style="color:${colDef.color};"></i>
        ${colDef.label}
        <span class="kb-col-cnt">${filtered.length}</span>
      </div>
      <div class="kb-col-body" id="${bodyId}"
        ondragover="kbDragOver(event)"
        ondragleave="kbDragLeave(event)"
        ondrop="kbDrop(event,'${colDef.id}')">
        ${filtered.length ? filtered.map(_kbCardHtml).join('') : '<div class="kb-empty"><i class="bi bi-inbox"></i><br>Sin tickets</div>'}
      </div>
    </div>`;
}

let _kbIssues  = [];
let _kbLoading = false;

async function loadKanban(force) {
    if (_kbLoading && !force) return;
    _kbLoading = true;
    const board   = document.getElementById('kbBoard');
    const spinner = document.getElementById('kbLoadingSpinner');
    if (spinner) spinner.style.display = '';
    if (board && !_kbIssues.length) {
        board.innerHTML = KB_COLS_DEF.map(c =>
            `<div class="kb-col">
              <div class="kb-col-hdr" style="border-left:3px solid ${c.color};"><i class="bi bi-${c.icon}" style="color:${c.color};"></i> ${c.label}</div>
              <div class="kb-col-body" style="justify-content:center;align-items:center;"><span class="kb-spin" style="display:block;margin:auto;"></span></div>
            </div>`
        ).join('');
    }
    try {
        const _kbCola = document.getElementById('kbFilterCola')?.value || 'wp';
        const _kbComp = _kbCola === 'wp' ? ' AND "Tipo de Componente" = Workplace' : '';
        const JQL    = `project = INC${_kbComp} AND status not in ("Cerrado","Closed","Cancelado","Cancelled") ORDER BY updated DESC`;
        const FIELDS = ['summary','status','priority','assignee','reporter','created','customfield_15147'];
        let all = [], token;
        while (true) {
            const body = { jql: JQL, fields: FIELDS, maxResults: 100 };
            if (token) body.nextPageToken = token;
            const d = await jira('POST', '/rest/api/3/search/jql', body);
            all.push(...(d.issues || []));
            if (!d.issues?.length || d.isLast !== false || !d.nextPageToken || all.length >= 500) break;
            token = d.nextPageToken;
        }
        _kbIssues = all;
        _kbRenderBoard();
    } catch(e) {
        if (board) board.innerHTML = `<div style="color:#ef4444;padding:20px;font-size:12px;">${incEsc(e.message)}</div>`;
    } finally {
        _kbLoading = false;
        if (spinner) spinner.style.display = 'none';
    }
}

function _kbRenderBoard() {
    const board = document.getElementById('kbBoard');
    if (!board) return;
    const buckets = { sinAsig:[], asignado:[], espera:[], resuelto:[] };
    for (const issue of _kbIssues) buckets[_kbClassify(issue)].push(issue);
    board.innerHTML = KB_COLS_DEF.map(c => _renderKanbanCol(buckets[c.id] || [], c)).join('');
}

// ── Drag & Drop ────────────────────────────────────────────────────────────────

let _kbDragKey = null;

function kbDragStart(e) {
    _kbDragKey = e.currentTarget.dataset.key;
    e.currentTarget.classList.add('kb-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _kbDragKey);
}
function kbDragEnd(e) {
    e.currentTarget.classList.remove('kb-dragging');
}
function kbDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('kb-over');
}
function kbDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('kb-over');
}
function kbDrop(e, targetCol) {
    e.preventDefault();
    e.currentTarget.classList.remove('kb-over');
    const key = _kbDragKey || e.dataTransfer.getData('text/plain');
    if (!key) return;
    _kbDragKey = null;
    kbHandleDrop(key, targetCol);
}

async function kbHandleDrop(key, targetCol) {
    const issue = _kbIssues.find(i => i.key === key);
    if (!issue) return;
    const currentCol = _kbClassify(issue);
    if (currentCol === targetCol) return;

    const COL_ACTIONS = {
        sinAsig:  { type:'unassign' },
        asignado: { type:'pick'     },
        espera:   { type:'transition', kw:['espera','pend','wait','hold','Pendiente','En espera','Waiting','On Hold'] },
        resuelto: { type:'transition', kw:['resuel','resolv','done','Resuelto','Resolved','Done'] },
    };
    const act = COL_ACTIONS[targetCol];
    if (!act) return;

    try {
        if (act.type === 'unassign') {
            await jira('PUT', `/rest/api/3/issue/${key}`, { fields: { assignee: null } });
            issue.fields.assignee = null;
            showToast(`${key} desasignado`, 'success');
            _kbRenderBoard();
        } else if (act.type === 'pick') {
            _kbShowAssignPicker(key);
            return;
        } else {
            const tData = await jira('GET', `/rest/api/3/issue/${key}/transitions`);
            const match = (tData.transitions || []).find(t =>
                act.kw.some(k => (t.to?.name||t.name||'').toLowerCase().includes(k.toLowerCase()))
            );
            if (!match) {
                showToast(`Sin transición disponible hacia "${KB_COLS_DEF.find(c=>c.id===targetCol)?.label}"`, 'warning');
                return;
            }
            await jira('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: match.id } });
            issue.fields.status = { name: match.to?.name || match.name };
            showToast(`${key} → ${match.to?.name || match.name}`, 'success');
        }
        _kbRenderBoard();
    } catch(e) {
        showToast(`Error al mover ${key}: ${e.message}`, 'error');
    }
}
// ── Assign Picker ──────────────────────────────────────────────────────────────

var _kbPickerKey    = null;
var _kbSearchTimer  = null;

function _kbExtractAgentsFromBoard() {
    var seen = {}, agents = [];
    (_kbIssues || []).forEach(function(i) {
        var a = (i.fields || {}).assignee;
        if (!a) return;
        // acepta tanto accountId (v3) como name (v2)
        var uid = a.accountId || a.name || a.emailAddress;
        if (uid && !seen[uid]) {
            seen[uid] = true;
            agents.push(a);
        }
    });
    agents.sort(function(a, b) {
        return (a.displayName || '').localeCompare(b.displayName || '');
    });
    return agents;
}

function _kbShowAssignPicker(key) {
    _kbPickerKey = key;
    var overlay = document.getElementById('kbAssignOverlay');
    var picker  = document.getElementById('kbAssignPicker');
    var keyLbl  = document.getElementById('kbAssignKey');
    var searchEl = document.getElementById('kbAssignSearch');
    var list    = document.getElementById('kbAssignList');
    if (!picker) return;

    if (keyLbl)  keyLbl.textContent = key;
    if (searchEl) searchEl.value = '';
    if (overlay) overlay.style.display = '';
    picker.style.display = '';
    setTimeout(function() { if (searchEl) searchEl.focus(); }, 60);

    // 1. Mostrar técnicos del tablero inmediatamente
    var boardAgents = _kbExtractAgentsFromBoard();
    if (boardAgents.length) {
        _kbRenderAgentRows(boardAgents, list);
    } else {
        // 2. Si no hay en el tablero (ej. todos sin asignar) → cargar desde Jira
        if (list) list.innerHTML = '<div style="text-align:center;padding:14px;"><span class="kb-spin" style="display:inline-block;"></span></div>';
        _kbSearchJira('', list);
    }
}

function _kbRenderAgentRows(agents, listEl) {
    var el = listEl || document.getElementById('kbAssignList');
    if (!el) return;
    if (!agents.length) {
        el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted);text-align:center;">Sin resultados</div>';
        return;
    }
    el.innerHTML = agents.map(function(a) {
        var uid      = incEsc(a.accountId || a.name || a.emailAddress || '');
        var name     = incEsc(a.displayName || a.emailAddress || a.name || uid);
        var email    = incEsc(a.emailAddress || '');
        var initials = (a.displayName || '?').split(' ').slice(0, 2).map(function(w) { return w[0] || ''; }).join('').toUpperCase();
        var avatar   = a.avatarUrls && (a.avatarUrls['24x24'] || a.avatarUrls['32x32'] || a.avatarUrls['16x16']);
        var ava = avatar
            ? '<img src="' + avatar + '" style="width:30px;height:30px;border-radius:50%;flex-shrink:0;" onerror="this.replaceWith(document.createTextNode(\'\'))">'
            : '<span class="kb-avatar" style="width:30px;height:30px;font-size:10px;flex-shrink:0;">' + initials + '</span>';
        return '<div onclick="kbPickAgent(this)"'
            + ' data-uid="' + uid + '" data-aname="' + incEsc((a.displayName || a.emailAddress || '').replace(/"/g, '&quot;')) + '"'
            + ' style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;"'
            + ' onmouseenter="this.style.background=\'var(--bg-main)\'" onmouseleave="this.style.background=\'\'">'
            + ava
            + '<div style="min-width:0;flex:1;">'
            + '<div style="font-size:12px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</div>'
            + (email ? '<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + email + '</div>' : '')
            + '</div></div>';
    }).join('');
}

async function _kbSearchJira(query, listEl) {
    var el = listEl || document.getElementById('kbAssignList');
    try {
        var url = '/rest/api/3/user/assignable/search?project=INC&maxResults=50';
        if (query) url += '&query=' + encodeURIComponent(query);
        var data = await jira('GET', url);
        var users = Array.isArray(data) ? data : (data.values || []);
        // filtrar solo usuarios activos (no bots)
        users = users.filter(function(u) { return u.active !== false && (u.displayName || u.emailAddress); });
        users.sort(function(a, b) { return (a.displayName || '').localeCompare(b.displayName || ''); });
        _kbRenderAgentRows(users, el);
    } catch(e) {
        if (el) el.innerHTML = '<div style="color:#ef4444;padding:12px;font-size:11px;">' + incEsc(e.message) + '</div>';
    }
}

function kbFilterAgents() {
    var searchEl = document.getElementById('kbAssignSearch');
    var list     = document.getElementById('kbAssignList');
    var q        = searchEl ? searchEl.value.trim() : '';
    clearTimeout(_kbSearchTimer);

    // Filtrar inmediatamente sobre los del tablero
    var boardAgents = _kbExtractAgentsFromBoard();
    if (boardAgents.length) {
        var ql = q.toLowerCase();
        var filtered = q ? boardAgents.filter(function(a) {
            return (a.displayName || a.emailAddress || '').toLowerCase().indexOf(ql) >= 0;
        }) : boardAgents;
        _kbRenderAgentRows(filtered, list);
    }

    // Siempre buscar en Jira con debounce para complementar
    if (q.length >= 1) {
        if (list && !boardAgents.length) list.innerHTML = '<div style="text-align:center;padding:14px;"><span class="kb-spin" style="display:inline-block;"></span></div>';
        _kbSearchTimer = setTimeout(function() { _kbSearchJira(q, list); }, 350);
    } else if (!boardAgents.length) {
        _kbSearchTimer = setTimeout(function() { _kbSearchJira('', list); }, 350);
    }
}

function kbPickAgent(el) {
    kbDoAssign(el.dataset.uid, el.dataset.aname);
}

async function kbDoAssign(accountId, displayName) {
    var key = _kbPickerKey;
    kbCloseAssignPicker();
    if (!key) return;
    try {
        await jira('PUT', '/rest/api/3/issue/' + key, { fields: { assignee: { accountId: accountId } } });
        var issue = (_kbIssues || []).find(function(i) { return i.key === key; });
        if (issue && issue.fields) issue.fields.assignee = { accountId: accountId, displayName: displayName };
        showToast(key + ' asignado a ' + displayName, 'success');
        _kbRenderBoard();
    } catch(e) {
        showToast('Error al asignar ' + key + ': ' + e.message, 'error');
    }
}

function kbCloseAssignPicker() {
    clearTimeout(_kbSearchTimer);
    var overlay = document.getElementById('kbAssignOverlay');
    var picker  = document.getElementById('kbAssignPicker');
    if (overlay) overlay.style.display = 'none';
    if (picker)  picker.style.display  = 'none';
    _kbPickerKey = null;
}

// â”€â”€ Feature C: EstadÃ­sticas por TÃ©cnico â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

var _TEC_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1','#a78bfa','#14b8a6'];
var _tecIssues  = [];
var _tecLoading = false;
var _tecChart   = null;
var _tecExpanded = null;

async function loadTecStats(force) {
    if (_tecLoading && !force) return;
    var days  = parseInt((document.getElementById('tecFilterDays') || {}).value || '14');
    var cola  = (document.getElementById('tecFilterCola') || {}).value || 'wp';
    if (_tecIssues.length && !force) {
        _tecRenderPage(days);
        return;
    }
    _tecLoading = true;
    var spinner = document.getElementById('tecSpinner');
    var upd     = document.getElementById('tecLastUpd');
    var kpis    = document.getElementById('tecKpis');
    var wrap    = document.getElementById('tecTableWrap');
    if (spinner) spinner.style.display = '';
    if (kpis)    kpis.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;"><span class="kb-spin" style="display:inline-block;"></span></div>';
    if (wrap)    wrap.innerHTML = '';
    try {
        var comp  = cola === 'wp' ? ' AND "Tipo de Componente" = Workplace' : '';
        var JQL   = 'project = INC' + comp + ' AND (status not in ("Cerrado","Closed","Cancelado","Cancelled") OR resolutiondate >= -' + days + 'd) ORDER BY updated DESC';
        var FIELDS = ['summary','status','priority','assignee','created','resolutiondate','customfield_15147'];
        var all = [], token;
        while (true) {
            var body = { jql: JQL, fields: FIELDS, maxResults: 100 };
            if (token) body.nextPageToken = token;
            var d = await jira('POST', '/rest/api/3/search/jql', body);
            all.push.apply(all, d.issues || []);
            if (!d.issues || !d.issues.length || d.isLast !== false || !d.nextPageToken || all.length >= 2000) break;
            token = d.nextPageToken;
        }
        _tecIssues = all;
        _tecExpanded = null;
        _tecRenderPage(days);
        if (upd) upd.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-PE', {hour:'2-digit',minute:'2-digit'});
    } catch(e) {
        if (wrap) wrap.innerHTML = '<div style="color:#ef4444;padding:20px;font-size:12px;">' + incEsc(e.message) + '</div>';
    } finally {
        _tecLoading = false;
        if (spinner) spinner.style.display = 'none';
    }
}

function _tecProcess(issues) {
    var now      = Date.now();
    var todayStr = new Date().toISOString().slice(0, 10);
    var map = {};
    issues.forEach(function(issue) {
        var f   = issue.fields || {};
        var a   = f.assignee;
        var uid = a ? (a.accountId || a.name || a.emailAddress || 'sin-asignar') : 'sin-asignar';
        if (!map[uid]) {
            map[uid] = {
                accountId:   uid,
                displayName: a ? (a.displayName || a.emailAddress || uid) : 'Sin asignar',
                email:       a ? (a.emailAddress || '') : '',
                avatarUrls:  a ? (a.avatarUrls || {}) : {},
                activos: 0, vencidos: 0, resueltosHoy: 0,
                mttrMs: [], catCount: {}, tickets: []
            };
        }
        var s  = map[uid];
        var st = ((f.status || {}).name || '').toLowerCase();
        var isActive = !/resuel|resolv|^done$|complet|cerr|clos|cancel/.test(st);
        var resDate  = f.resolutiondate ? new Date(f.resolutiondate) : null;
        var creDate  = f.created        ? new Date(f.created)        : null;
        s.tickets.push(issue);
        if (isActive) {
            s.activos++;
            if (creDate && (now - creDate.getTime()) > 8 * 3600000) s.vencidos++;
        }
        if (resDate && resDate.toISOString().slice(0,10) === todayStr) {
            s.resueltosHoy++;
            if (creDate) s.mttrMs.push(resDate.getTime() - creDate.getTime());
        }
        var cat = f.customfield_15147 && f.customfield_15147.value;
        if (cat) s.catCount[cat] = (s.catCount[cat] || 0) + 1;
    });
    var arr = Object.values(map);
    arr.forEach(function(s) {
        s.mttrHoy = s.mttrMs.length ? Math.round(s.mttrMs.reduce(function(a,b){return a+b;},0) / s.mttrMs.length) : null;
        var cats = Object.entries(s.catCount).sort(function(a,b){return b[1]-a[1];});
        s.topCat = cats.length ? cats[0][0] : 'â€”';
    });
    arr.sort(function(a,b){ return b.activos - a.activos || b.vencidos - a.vencidos; });
    return arr;
}

function _tecRenderPage(days) {
    var statsArr = _tecProcess(_tecIssues);
    var kpis = document.getElementById('tecKpis');
    if (kpis) {
        var totActivos  = statsArr.reduce(function(s,t){return s+t.activos;},0);
        var totVencidos = statsArr.reduce(function(s,t){return s+t.vencidos;},0);
        var totResHoy   = statsArr.reduce(function(s,t){return s+t.resueltosHoy;},0);
        var mttrAll     = statsArr.filter(function(t){return t.mttrHoy;}).map(function(t){return t.mttrHoy;});
        var avgMttr     = mttrAll.length ? Math.round(mttrAll.reduce(function(a,b){return a+b;},0)/mttrAll.length) : null;
        kpis.innerHTML = [
            ['Tickets Activos',   totActivos,                          '#3b82f6'],
            ['Vencidos (+8h)',    totVencidos,                         totVencidos > 0 ? '#ef4444' : '#10b981'],
            ['Resueltos Hoy',    totResHoy,                           '#10b981'],
            ['MTTR Promedio Hoy', avgMttr ? _tecFmtDur(avgMttr) : '-', '#8b5cf6'],
        ].map(function(r) {
            return '<div class="tec-kpi"><span class="tec-kpi-val" style="color:'+r[2]+';">'+r[1]+'</span><span class="tec-kpi-lbl">'+r[0]+'</span></div>';
        }).join('');
    }
    _renderTecTable(statsArr);
    _renderTecChart(statsArr, days);
}

function _renderTecTable(statsArr) {
    var wrap = document.getElementById('tecTableWrap');
    if (!wrap) return;
    var maxActivos = Math.max.apply(null, [1].concat(statsArr.map(function(s){return s.activos;})));
    var rows = statsArr.map(function(s, idx) {
        var color    = _TEC_COLORS[idx % _TEC_COLORS.length];
        var initials = s.displayName.split(' ').slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();
        var av       = s.avatarUrls['24x24'] || s.avatarUrls['32x32'] || '';
        var avaHtml  = av
            ? '<img src="'+av+'" style="width:30px;height:30px;border-radius:50%;flex-shrink:0;" onerror="this.style.display=\'none\'">'
            : '<span class="tec-avatar" style="background:'+color+';">'+initials+'</span>';
        var barPct  = Math.round((s.activos / maxActivos) * 100);
        var vStyle  = s.vencidos > 0 ? 'color:#ef4444;font-weight:700;' : 'color:var(--text-muted);';
        var uid     = incEsc(s.accountId);
        return '<tr class="tec-row" id="tec-row-'+uid+'" onclick="toggleTecRow(\''+uid+'\')">'
            +'<td><div style="display:flex;align-items:center;gap:9px;">'+avaHtml
            +'<div><div style="font-weight:600;color:var(--text-main);">'+incEsc(s.displayName)+'</div>'
            +'<div style="font-size:10px;color:var(--text-muted);">'+incEsc(s.email)+'</div></div></div></td>'
            +'<td><span style="font-weight:700;font-size:15px;color:'+color+';">'+s.activos+'</span>'
            +'<div class="tec-bar-wrap"><div class="tec-bar-fill" style="width:'+barPct+'%;background:'+color+';"></div></div></td>'
            +'<td><span style="'+vStyle+'">'+s.vencidos+'</span></td>'
            +'<td><span style="font-weight:600;color:#10b981;">'+s.resueltosHoy+'</span></td>'
            +'<td>'+(s.mttrHoy ? _tecFmtDur(s.mttrHoy) : '-')+'</td>'
            +'<td style="font-size:11px;color:var(--text-muted);">'+incEsc(s.topCat)+'</td>'
            +'<td style="text-align:center;"><i class="bi bi-chevron-down" id="tec-chev-'+uid+'" style="color:var(--text-muted);transition:transform .2s;"></i></td>'
            +'</tr>'
            +'<tr class="tec-detail" id="tec-detail-'+uid+'" style="display:none;">'
            +'<td colspan="7" style="padding:0;">'+_renderTecDetailHtml(s.tickets)+'</td>'
            +'</tr>';
    }).join('');
    wrap.innerHTML = '<table class="tec-table"><thead><tr>'
        +'<th>Tecnico</th><th>Activos</th><th>Vencidos</th><th>Res. Hoy</th><th>MTTR Hoy</th><th>Top Categoria</th><th></th>'
        +'</tr></thead><tbody>'+rows+'</tbody></table>';
}

function toggleTecRow(accountId) {
    var detail = document.getElementById('tec-detail-'+accountId);
    var chev   = document.getElementById('tec-chev-'+accountId);
    var row    = document.getElementById('tec-row-'+accountId);
    if (_tecExpanded && _tecExpanded !== accountId) {
        var pd = document.getElementById('tec-detail-'+_tecExpanded);
        var pc = document.getElementById('tec-chev-'+_tecExpanded);
        var pr = document.getElementById('tec-row-'+_tecExpanded);
        if (pd) pd.style.display = 'none';
        if (pc) pc.style.transform = '';
        if (pr) pr.classList.remove('tec-selected');
    }
    var isOpen = detail && detail.style.display !== 'none';
    if (detail) detail.style.display = isOpen ? 'none' : '';
    if (chev)   chev.style.transform = isOpen ? '' : 'rotate(180deg)';
    if (row)    row.classList[isOpen ? 'remove' : 'add']('tec-selected');
    _tecExpanded = isOpen ? null : accountId;
}

function _renderTecDetailHtml(tickets) {
    if (!tickets.length) return '<div style="padding:12px;font-size:11px;color:var(--text-muted);">Sin tickets en este periodo</div>';
    var sorted = tickets.slice().sort(function(a,b){
        var sa = ((a.fields||{}).status||{}).name||'';
        var sb = ((b.fields||{}).status||{}).name||'';
        return sa.localeCompare(sb);
    });
    var rows = sorted.slice(0,150).map(function(issue) {
        var f   = issue.fields || {};
        var key = issue.key;
        var sum = incEsc((f.summary||'-').slice(0,65));
        var st  = (f.status&&f.status.name)||'-';
        var stL = st.toLowerCase();
        var stC = /resuel|resolv|done/.test(stL) ? '#10b981' : /cerr|clos|cancel/.test(stL) ? '#6b7280' : /espera|pend|wait/.test(stL) ? '#f59e0b' : '#3b82f6';
        var cat = f.customfield_15147;
        var catStr = cat ? (cat.value+(cat.child?' > '+cat.child.value:'')) : '-';
        var cre = f.created ? new Date(f.created) : null;
        var res = f.resolutiondate ? new Date(f.resolutiondate) : null;
        var creS = cre ? cre.toLocaleDateString('es-PE',{day:'2-digit',month:'short'}) : '-';
        var resS = res ? res.toLocaleDateString('es-PE',{day:'2-digit',month:'short'}) : '-';
        var mttr = (cre&&res) ? _tecFmtDur(res.getTime()-cre.getTime()) : '-';
        return '<tr>'
            +'<td><span style="font-family:monospace;font-weight:700;font-size:10px;color:var(--jira-blue);cursor:pointer;" onclick="window.open(\'https://integratelperu.atlassian.net/browse/'+key+'\',\'_blank\')">'+key+'</span></td>'
            +'<td title="'+incEsc(f.summary||'')+'">'+sum+'</td>'
            +'<td><span class="tec-badge" style="background:'+stC+'20;color:'+stC+';">'+incEsc(st)+'</span></td>'
            +'<td style="font-size:10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+incEsc(catStr)+'</td>'
            +'<td style="font-size:10px;color:var(--text-muted);">'+creS+'</td>'
            +'<td style="font-size:10px;color:var(--text-muted);">'+resS+'</td>'
            +'<td style="font-size:10px;color:var(--text-muted);">'+mttr+'</td>'
            +'</tr>';
    }).join('');
    return '<div style="padding:8px 12px 14px;">'
        +'<table class="tec-dtable"><thead><tr>'
        +'<th>Ticket</th><th>Resumen</th><th>Estado</th><th>Categoria</th><th>Creado</th><th>Resuelto</th><th>Duracion</th>'
        +'</tr></thead><tbody>'+rows+'</tbody></table>'
        +(sorted.length>150?'<div style="font-size:10px;color:var(--text-muted);padding:6px 0;">Mostrando 150 de '+sorted.length+'</div>':'')
        +'</div>';
}

function _renderTecChart(statsArr, days) {
    var wrap   = document.getElementById('tecChartWrap');
    var canvas = document.getElementById('tecChart');
    var title  = document.getElementById('tecChartTitle');
    if (!wrap || !canvas || typeof Chart === 'undefined') return;

    var dayMs = 86400000;
    var today = new Date(); today.setHours(0,0,0,0);
    var labels = [];
    for (var i = days-1; i >= 0; i--) {
        var dd = new Date(today.getTime() - i * dayMs);
        labels.push(dd.toLocaleDateString('es-PE',{day:'2-digit',month:'short'}));
    }

    var datasets = [];
    statsArr.forEach(function(s, idx) {
        if (s.accountId === 'sin-asignar') return;
        var dayMap = {};
        labels.forEach(function(l){ dayMap[l] = 0; });
        s.tickets.forEach(function(issue) {
            var res = (issue.fields||{}).resolutiondate;
            if (!res) return;
            var rd = new Date(res); rd.setHours(0,0,0,0);
            var lbl = rd.toLocaleDateString('es-PE',{day:'2-digit',month:'short'});
            if (dayMap.hasOwnProperty(lbl)) dayMap[lbl]++;
        });
        var data = labels.map(function(l){ return dayMap[l]; });
        if (!data.some(function(v){return v>0;})) return;
        var color = _TEC_COLORS[idx % _TEC_COLORS.length];
        datasets.push({
            label:           s.displayName,
            data:            data,
            borderColor:     color,
            backgroundColor: color + '22',
            tension:         0.35,
            pointRadius:     4,
            pointHoverRadius:7,
            fill:            false,
            _accountId:      s.accountId,
        });
    });

    if (!datasets.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    if (title) title.textContent = '- ultimos ' + days + ' dias';
    if (_tecChart) { _tecChart.destroy(); _tecChart = null; }

    _tecChart = new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10, padding: 12 } },
                tooltip: { bodyFont: { size: 11 }, titleFont: { size: 11 } },
            },
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 30 } },
                y: { beginAtZero: true, ticks: { font: { size: 10 }, stepSize: 1 }, grace: 1 },
            },
            onClick: function(evt, elements) {
                if (!elements || !elements.length) return;
                var ds = _tecChart.data.datasets[elements[0].datasetIndex];
                if (ds && ds._accountId) {
                    toggleTecRow(ds._accountId);
                    var tw = document.getElementById('tecTableWrap');
                    if (tw) tw.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            },
        },
    });
}

function _tecFmtDur(ms) {
    if (!ms || ms < 0) return '-';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    if (h >= 48) return Math.floor(h/24) + 'd ' + (h%24) + 'h';
    if (h > 0)   return h + 'h ' + m + 'min';
    return m + 'min';
}

// â”€â”€ Feature D: SLA en Tiempo Real â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

var _slaHrs = { Critical:4, Highest:4, High:8, Medium:24, Low:72, Lowest:72 };
var _slaProcessed  = [];
var _slaLoading    = false;
var _slaRefreshInt = null;
var _slaTickInt    = null;
var _slaSortCol    = 'remaining';
var _slaSortAsc    = true;

function _slaReadConfig() {
    var c = parseInt((document.getElementById('slaHrCritical')||{}).value);
    var h = parseInt((document.getElementById('slaHrHigh')||{}).value);
    var m = parseInt((document.getElementById('slaHrMedium')||{}).value);
    var l = parseInt((document.getElementById('slaHrLow')||{}).value);
    if (c>0) { _slaHrs.Critical = c; _slaHrs.Highest = c; }
    if (h>0)   _slaHrs.High    = h;
    if (m>0)   _slaHrs.Medium  = m;
    if (l>0) { _slaHrs.Low     = l; _slaHrs.Lowest  = l; }
}

function _slaUpdateConfigLabel() {
    var el = document.getElementById('slaConfigLabel');
    if (el) el.textContent = 'Critica '+_slaHrs.Critical+'h  |  Alta '+_slaHrs.High+'h  |  Media '+_slaHrs.Medium+'h  |  Baja '+_slaHrs.Low+'h';
}

function toggleSlaConfig() {
    var p = document.getElementById('slaConfigPanel');
    if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
}

function _slaApplyConfig() {
    _slaReadConfig();
    _slaUpdateConfigLabel();
    toggleSlaConfig();
    if (_slaProcessed.length) _slaRender();
}

async function loadSlaPanel(force) {
    if (_slaLoading && !force) return;
    _slaLoading = true;

    var spinner = document.getElementById('slaSpinner');
    var upd     = document.getElementById('slaLastUpd');
    var kpis    = document.getElementById('slaKpis');
    var wrap    = document.getElementById('slaTableWrap');

    if (spinner) spinner.style.display = '';
    if (kpis)    kpis.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:14px;"><span class="kb-spin" style="display:inline-block;"></span></div>';

    _slaReadConfig();
    _slaUpdateConfigLabel();

    try {
        var cola  = (document.getElementById('slaFilterCola')||{}).value || 'wp';
        var comp  = cola === 'wp' ? ' AND "Tipo de Componente" = Workplace' : '';
        var JQL   = 'project = INC' + comp + ' AND status not in ("Cerrado","Closed","Cancelado","Cancelled","Resuelto","Resolved","Done","Completado") ORDER BY created ASC';
        var FIELDS = ['summary','status','priority','assignee','created','customfield_15147'];

        var all = [], token;
        while (true) {
            var body = { jql: JQL, fields: FIELDS, maxResults: 100 };
            if (token) body.nextPageToken = token;
            var d = await jira('POST', '/rest/api/3/search/jql', body);
            all.push.apply(all, d.issues || []);
            if (!d.issues || !d.issues.length || d.isLast !== false || !d.nextPageToken || all.length >= 1000) break;
            token = d.nextPageToken;
        }

        _slaProcessed = _slaProcess(all);
        _slaRender();
        _slaUpdateBadge();
        _slaStartTimers(force);

        if (upd) upd.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
    } catch(e) {
        if (wrap) wrap.innerHTML = '<div style="color:#ef4444;padding:20px;font-size:12px;">' + incEsc(e.message) + '</div>';
    } finally {
        _slaLoading = false;
        if (spinner) spinner.style.display = 'none';
    }
}

function _slaProcess(issues) {
    var now = Date.now();
    return issues.map(function(issue) {
        var f       = issue.fields || {};
        var priName = (f.priority && f.priority.name) || 'Medium';
        var hrsKey  = Object.keys(_slaHrs).find(function(k){ return k.toLowerCase() === priName.toLowerCase(); }) || 'Medium';
        var hrs     = _slaHrs[hrsKey] || 24;
        var creMs   = f.created ? new Date(f.created).getTime() : now;
        var dueMs   = creMs + hrs * 3600000;
        var totalMs = hrs * 3600000;
        var rem     = dueMs - now;
        var pctUsed = Math.min(100, Math.max(0, ((now - creMs) / totalMs) * 100));
        return {
            issue:    issue,
            key:      issue.key,
            summary:  (f.summary || '-').slice(0, 70),
            priName:  priName,
            assignee: f.assignee ? (f.assignee.displayName || f.assignee.emailAddress || 'Sin asignar') : 'Sin asignar',
            avatarUrl:(f.assignee && f.assignee.avatarUrls && (f.assignee.avatarUrls['24x24']||f.assignee.avatarUrls['16x16'])) || '',
            cat:      f.customfield_15147 ? f.customfield_15147.value : '-',
            creMs:    creMs,
            dueMs:    dueMs,
            totalMs:  totalMs,
            rem:      rem,        // snapshot â€” updated on tick
            pctUsed:  pctUsed,
        };
    });
}

function _slaRender() {
    if (!_slaProcessed.length) {
        var wrap = document.getElementById('slaTableWrap');
        if (wrap) wrap.innerHTML = '<div style="padding:30px;text-align:center;font-size:12px;color:var(--text-muted);"><i class="bi bi-check2-circle" style="font-size:24px;display:block;margin-bottom:8px;color:#10b981;"></i>Sin tickets activos en esta cola</div>';
        var kpis = document.getElementById('slaKpis');
        if (kpis) kpis.innerHTML = ['Vencidos','En riesgo (<1h)','En tiempo','Total activos'].map(function(l,i){
            return '<div class="sla-kpi"><span class="sla-kpi-val" style="color:var(--text-muted);">0</span><span class="sla-kpi-lbl">'+l+'</span></div>';
        }).join('');
        return;
    }

    var now         = Date.now();
    var priFilter   = (document.getElementById('slaFilterPri')||{}).value || '';
    var onlyBreach  = document.getElementById('slaOnlyBreach') && document.getElementById('slaOnlyBreach').checked;

    // refresh rem/pctUsed
    _slaProcessed.forEach(function(p) {
        p.rem     = p.dueMs - now;
        p.pctUsed = Math.min(100, Math.max(0, ((now - p.creMs) / p.totalMs) * 100));
    });

    var filtered = _slaProcessed.slice();
    if (priFilter)   filtered = filtered.filter(function(p){ return p.priName.toLowerCase() === priFilter.toLowerCase(); });
    if (onlyBreach)  filtered = filtered.filter(function(p){ return p.rem <= 0; });

    // sort
    filtered.sort(function(a, b) {
        var v = 0;
        if (_slaSortCol === 'remaining') v = a.rem - b.rem;
        else if (_slaSortCol === 'priority') v = a.totalMs - b.totalMs;
        else if (_slaSortCol === 'assignee') v = a.assignee.localeCompare(b.assignee);
        else if (_slaSortCol === 'created')  v = a.creMs - b.creMs;
        return _slaSortAsc ? v : -v;
    });

    // KPIs
    var nBreach = _slaProcessed.filter(function(p){ return p.rem <= 0; }).length;
    var nRisk   = _slaProcessed.filter(function(p){ return p.rem > 0 && p.rem < 3600000; }).length;
    var nOk     = _slaProcessed.filter(function(p){ return p.rem >= 3600000; }).length;
    var minRem  = _slaProcessed.reduce(function(mn,p){ return p.rem < mn ? p.rem : mn; }, Infinity);
    var nextKey = _slaProcessed.find(function(p){ return p.rem === minRem; });

    var kpis = document.getElementById('slaKpis');
    if (kpis) kpis.innerHTML = [
        ['Vencidos',      nBreach,  nBreach > 0 ? '#ef4444' : '#10b981'],
        ['En riesgo (<1h)', nRisk,  nRisk   > 0 ? '#f59e0b' : '#10b981'],
        ['En tiempo',     nOk,      '#10b981'],
        ['Proximo a vencer', nextKey && minRem > 0 ? (nextKey.key + ' ' + _slaFmt(minRem)) : (nextKey ? nextKey.key + ' VENCIDO' : '-'), minRem <= 0 ? '#ef4444' : minRem < 3600000 ? '#f59e0b' : '#3b82f6'],
    ].map(function(r){
        return '<div class="sla-kpi"><span class="sla-kpi-val" style="color:'+r[2]+';">'+r[1]+'</span><span class="sla-kpi-lbl">'+r[0]+'</span></div>';
    }).join('');

    // Table
    var colHead = function(col, label) {
        var arrow = _slaSortCol === col ? (_slaSortAsc ? ' â–²' : ' â–¼') : '';
        return '<th onclick="_slaSortBy(\''+col+'\')" title="Ordenar por '+label+'">'+label+arrow+'</th>';
    };

    var rows = filtered.map(function(p) {
        var isBreach = p.rem <= 0;
        var isRisk   = p.rem > 0 && p.rem < 3600000;
        var rowCls   = isBreach ? ' class="sla-row-breach"' : '';
        var av       = p.avatarUrl
            ? '<img src="'+p.avatarUrl+'" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:5px;" onerror="this.style.display=\'none\'">'
            : '';
        var initials = p.assignee.split(' ').slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();
        var avatarHtml = p.avatarUrl ? av : '<span class="tec-avatar" style="width:22px;height:22px;font-size:9px;background:#6366f1;display:inline-flex;vertical-align:middle;margin-right:5px;">'+initials+'</span>';

        return '<tr'+rowCls+'>'
            +'<td><span style="font-family:monospace;font-weight:700;font-size:11px;color:var(--jira-blue);cursor:pointer;" onclick="window.open(\'https://integratelperu.atlassian.net/browse/'+p.key+'\',\'_blank\')">'+p.key+'</span></td>'
            +'<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+incEsc(p.issue.fields&&p.issue.fields.summary||'')+'">'+incEsc(p.summary)+'</td>'
            +'<td>'+_slaPriHtml(p.priName)+'</td>'
            +'<td style="white-space:nowrap;">'+avatarHtml+incEsc(p.assignee.split(' ').slice(0,2).join(' '))+'</td>'
            +'<td style="font-size:10px;color:var(--text-muted);white-space:nowrap;">'+incEsc(p.cat)+'</td>'
            +'<td style="font-size:10px;color:var(--text-muted);white-space:nowrap;">'+(p.creMs ? new Date(p.creMs).toLocaleDateString('es-PE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '-')+'</td>'
            +'<td id="sla-cd-'+p.key+'">'+_slaCdHtml(p.rem, p.pctUsed, isBreach, isRisk)+'</td>'
            +'</tr>';
    }).join('');

    var wrap = document.getElementById('slaTableWrap');
    if (wrap) wrap.innerHTML = '<table class="sla-table"><thead><tr>'
        +'<th>Ticket</th><th>Resumen</th>'
        +colHead('priority','Prioridad')+colHead('assignee','Tecnico')
        +'<th>Categoria</th>'+colHead('created','Creado')+colHead('remaining','Tiempo Restante')
        +'</tr></thead><tbody>'+rows+'</tbody></table>'
        +(filtered.length === 0 ? '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-muted);">Sin resultados con los filtros actuales</div>' : '');
}

function _slaCdHtml(rem, pctUsed, isBreach, isRisk) {
    var barColor = isBreach ? '#ef4444' : isRisk ? '#f59e0b' : '#10b981';
    var cls      = isBreach ? 'sla-cd sla-breach' + (isBreach ? ' sla-pulse' : '') : isRisk ? 'sla-cd sla-risk' : 'sla-cd sla-ok';
    var txt      = isBreach ? 'VENCIDO ' + _slaFmt(-rem) : _slaFmt(rem);
    var prefix   = isBreach ? '' : '';
    return '<div style="display:flex;align-items:center;gap:6px;">'
        +'<span class="'+cls+'">'+prefix+txt+'</span>'
        +'<span class="sla-bar-track"><span class="sla-bar-fill" style="width:'+Math.round(pctUsed)+'%;background:'+barColor+';"></span></span>'
        +'</div>';
}

function _slaFmt(ms) {
    if (ms < 0) ms = -ms;
    var h  = Math.floor(ms / 3600000);
    var m  = Math.floor((ms % 3600000) / 60000);
    var s  = Math.floor((ms % 60000) / 1000);
    if (h >= 24) return Math.floor(h/24)+'d '+( h%24)+'h';
    if (h > 0)   return h+'h '+m+'min';
    if (m > 0)   return m+'min '+s+'s';
    return s+'s';
}

function _slaPriHtml(priName) {
    var colors = { critical:'#ef4444', highest:'#ef4444', high:'#f59e0b', medium:'#3b82f6', low:'#6b7280', lowest:'#6b7280' };
    var c = colors[priName.toLowerCase()] || '#6b7280';
    return '<span class="sla-pri" style="background:'+c+'22;color:'+c+';">'+incEsc(priName)+'</span>';
}

function _slaSortBy(col) {
    if (_slaSortCol === col) _slaSortAsc = !_slaSortAsc;
    else { _slaSortCol = col; _slaSortAsc = col === 'remaining'; }
    _slaRender();
}

function _slaUpdateCountdowns() {
    var panel = document.getElementById('panel-sla');
    if (!panel || !panel.classList.contains('active')) return;
    var now = Date.now();
    _slaProcessed.forEach(function(p) {
        var el = document.getElementById('sla-cd-'+p.key);
        if (!el) return;
        p.rem     = p.dueMs - now;
        p.pctUsed = Math.min(100, Math.max(0, ((now - p.creMs) / p.totalMs) * 100));
        var isBreach = p.rem <= 0;
        var isRisk   = p.rem > 0 && p.rem < 3600000;
        el.innerHTML = _slaCdHtml(p.rem, p.pctUsed, isBreach, isRisk);
    });
    _slaUpdateBadge();
}

function _slaUpdateBadge() {
    var badge  = document.getElementById('slaBadge');
    if (!badge) return;
    var nBreach = _slaProcessed.filter(function(p){ return p.rem <= 0; }).length;
    var nRisk   = _slaProcessed.filter(function(p){ return p.rem > 0 && p.rem < 3600000; }).length;
    var total   = nBreach + nRisk;
    badge.style.display = total > 0 ? '' : 'none';
    badge.textContent   = total;
    badge.style.background = nBreach > 0 ? '#ef4444' : '#f59e0b';
}

function _slaStartTimers(resetRefresh) {
    // Tick each 10s to update countdowns
    if (_slaTickInt) clearInterval(_slaTickInt);
    _slaTickInt = setInterval(_slaUpdateCountdowns, 10000);

    // Re-fetch from Jira each 60s
    if (resetRefresh || !_slaRefreshInt) {
        if (_slaRefreshInt) clearInterval(_slaRefreshInt);
        _slaRefreshInt = setInterval(function() {
            var panel = document.getElementById('panel-sla');
            if (panel && panel.classList.contains('active')) loadSlaPanel(true);
        }, 60000);
    }
}

// â”€â”€ Feature E: Mapa de Calor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

var _hmIssues    = [];
var _hmLoading   = false;
var _hmMatrix    = null;
var _hmDayChart  = null;
var _hmHourChart = null;

var _HM_DAYS      = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
var _HM_DAYS_FULL = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
var _HM_SCALE     = ['var(--bg-main)','#f5f3ff','#ede9fe','#c4b5fd','#8b5cf6','#6d28d9'];

function _hmFlat(matrix) {
    var arr = [];
    for (var i = 0; i < matrix.length; i++)
        for (var j = 0; j < matrix[i].length; j++)
            arr.push(matrix[i][j]);
    return arr;
}

function _hmRange(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(i);
    return a;
}

async function loadHeatmap(force) {
    if (_hmLoading && !force) return;

    var days   = parseInt((document.getElementById('hmFilterDays')   || {}).value || '90');
    var cola   = (document.getElementById('hmFilterCola')   || {}).value || 'wp';
    var metric = (document.getElementById('hmFilterMetric') || {}).value || 'created';

    // Serve from cache immediately (no spinner flash)
    if (_hmIssues.length && !force) {
        _hmProcess(metric);
        _hmRender(days);
        return;
    }

    _hmLoading = true;

    var spinner = document.getElementById('hmSpinner');
    var content = document.getElementById('hmContent');
    var kpis    = document.getElementById('hmKpis');

    if (spinner) spinner.style.display = '';
    if (content) content.innerHTML = '<div style="text-align:center;padding:40px 0;"><span class="kb-spin" style="display:inline-block;"></span></div>';
    if (kpis)    kpis.innerHTML    = '<div style="grid-column:1/-1;text-align:center;padding:14px;"><span class="kb-spin" style="display:inline-block;"></span></div>';

    try {
        var comp   = cola === 'wp' ? ' AND "Tipo de Componente" = Workplace' : '';

        var JQL;
        if (metric === 'resolved') {
            JQL = 'project = INC' + comp + ' AND resolutiondate >= -' + days + 'd ORDER BY resolutiondate DESC';
        } else {
            JQL = 'project = INC' + comp + ' AND created >= -' + days + 'd ORDER BY created DESC';
        }

        var FIELDS = ['created', 'resolutiondate', 'priority', 'assignee'];
        var all = [], token;
        while (true) {
            var body = { jql: JQL, fields: FIELDS, maxResults: 100 };
            if (token) body.nextPageToken = token;
            var d = await jira('POST', '/rest/api/3/search/jql', body);
            all.push.apply(all, d.issues || []);
            if (!d.issues || !d.issues.length || d.isLast !== false || !d.nextPageToken || all.length >= 5000) break;
            token = d.nextPageToken;
        }

        _hmIssues = all;
        _hmProcess(metric);
        _hmRender(days);

        var upd = document.getElementById('hmLastUpd');
        if (upd) upd.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    } catch(e) {
        if (content) content.innerHTML = '<div style="color:#ef4444;padding:20px;font-size:12px;">' + incEsc(e.message) + '</div>';
    } finally {
        _hmLoading = false;
        if (spinner) spinner.style.display = 'none';
    }
}

function _hmProcess(metric) {
    var grid      = [];
    var dayTotals = _hmRange(7).map(function(){ return 0; });
    var hrTotals  = _hmRange(24).map(function(){ return 0; });
    for (var i = 0; i < 7; i++) {
        grid.push(_hmRange(24).map(function(){ return 0; }));
    }

    _hmIssues.forEach(function(issue) {
        var f       = issue.fields || {};
        var dateStr = metric === 'resolved' ? f.resolutiondate : f.created;
        if (!dateStr) return;
        var dt  = new Date(dateStr);
        var day = dt.getDay();    // 0=Dom, browser local TZ
        var hr  = dt.getHours(); // 0-23, browser local TZ
        grid[day][hr]++;
        dayTotals[day]++;
        hrTotals[hr]++;
    });

    _hmMatrix = { grid: grid, dayTotals: dayTotals, hrTotals: hrTotals, total: _hmIssues.length };
}

function _hmCellColor(count, maxCount) {
    if (count === 0 || maxCount === 0) return _HM_SCALE[0];
    var pct = count / maxCount;
    if (pct < 0.12) return _HM_SCALE[1];
    if (pct < 0.30) return _HM_SCALE[2];
    if (pct < 0.55) return _HM_SCALE[3];
    if (pct < 0.80) return _HM_SCALE[4];
    return _HM_SCALE[5];
}

function _hmRender(days) {
    if (!_hmMatrix) return;
    var m    = _hmMatrix;
    var flat = _hmFlat(m.grid);
    var maxC = Math.max.apply(null, [1].concat(flat));

    var peakDayIdx = 0;
    m.dayTotals.forEach(function(v, i){ if (v > m.dayTotals[peakDayIdx]) peakDayIdx = i; });
    var peakHour = 0;
    m.hrTotals.forEach(function(v, i){ if (v > m.hrTotals[peakHour]) peakHour = i; });
    var avgPerDay = days > 0 ? (m.total / days).toFixed(1) : 0;

    // KPIs
    var kpis = document.getElementById('hmKpis');
    if (kpis) kpis.innerHTML = [
        ['Total tickets',     m.total,                        '#3b82f6'],
        ['Dia mas activo',    _HM_DAYS_FULL[peakDayIdx],      '#8b5cf6'],
        ['Hora pico',         peakHour + 'h - ' + (peakHour + 1) + 'h', '#f59e0b'],
        ['Promedio diario',   avgPerDay + ' tickets',          '#10b981'],
    ].map(function(r) {
        return '<div class="hm-kpi"><span class="hm-kpi-val" style="color:' + r[2] + ';">' + r[1] + '</span><span class="hm-kpi-lbl">' + r[0] + '</span></div>';
    }).join('');

    // Build heatmap grid HTML
    var CELL_H = 30;
    var HOURS  = _hmRange(24);

    var html = '<div style="overflow-x:auto;">';
    html += '<div style="display:grid;grid-template-columns:52px repeat(24,minmax(17px,1fr));gap:3px;min-width:560px;">';

    // Header: hour labels
    html += '<div></div>';
    HOURS.forEach(function(h) {
        html += '<div class="hm-hrlbl" style="height:16px;">' + (h % 3 === 0 ? h : '') + '</div>';
    });

    // Day rows (Mon first: 1,2,3,4,5,6,0)
    for (var di = 0; di < 7; di++) {
        var day = (di + 1) % 7;
        html += '<div class="hm-daycol" style="height:' + CELL_H + 'px;">' + _HM_DAYS[day] + '</div>';
        HOURS.forEach(function(h) {
            var cnt  = m.grid[day][h];
            var bg   = _hmCellColor(cnt, maxC);
            var txtC = (cnt / maxC) >= 0.55 ? '#fff' : 'transparent';
            var tip  = _HM_DAYS_FULL[day] + ' ' + h + 'h: ' + cnt + ' ticket' + (cnt !== 1 ? 's' : '');
            html += '<div class="hm-cell" style="height:' + CELL_H + 'px;background:' + bg + ';font-size:9px;color:' + txtC + ';font-weight:700;"'
                + ' onmouseenter="_hmShowTip(event,' + JSON.stringify(tip) + ')" onmouseleave="_hmHideTip()">'
                + (cnt > 0 && maxC <= 40 ? cnt : '')
                + '</div>';
        });
    }
    html += '</div></div>';

    // Legend
    html += '<div class="hm-legend"><span>Menos</span>';
    _HM_SCALE.forEach(function(c) {
        html += '<span class="hm-lc" style="background:' + c + ';border:1px solid var(--border-soft);"></span>';
    });
    html += '<span>Mas</span></div>';

    // Charts
    html += '<div class="hm-charts">'
        + '<div style="position:relative;height:170px;"><canvas id="hmDayChart"></canvas></div>'
        + '<div style="position:relative;height:170px;"><canvas id="hmHourChart"></canvas></div>'
        + '</div>';

    // Recommendations
    html += _hmRecoHtml(m, days, peakDayIdx, peakHour, maxC);

    var content = document.getElementById('hmContent');
    if (content) content.innerHTML = html;

    setTimeout(function() { _hmRenderCharts(m, peakDayIdx, peakHour); }, 60);
}

function _hmShowTip(evt, text) {
    var tip = document.getElementById('hmTip');
    if (!tip) return;
    tip.textContent = text;
    tip.style.display = '';
    tip.style.left = (evt.clientX + 14) + 'px';
    tip.style.top  = (evt.clientY - 36) + 'px';
}

function _hmHideTip() {
    var tip = document.getElementById('hmTip');
    if (tip) tip.style.display = 'none';
}

function _hmRenderCharts(m, peakDayIdx, peakHour) {
    var dayCanvas = document.getElementById('hmDayChart');
    if (dayCanvas && typeof Chart !== 'undefined') {
        if (_hmDayChart) { _hmDayChart.destroy(); _hmDayChart = null; }
        var dayLabels = [], dayData = [];
        for (var i = 0; i < 7; i++) {
            var d = (i + 1) % 7;
            dayLabels.push(_HM_DAYS[d]);
            dayData.push(m.dayTotals[d]);
        }
        var dayColors = dayData.map(function(_, i) {
            var d = (i + 1) % 7;
            return d === peakDayIdx ? '#7c3aed' : '#a78bfa55';
        });
        _hmDayChart = new Chart(dayCanvas, {
            type: 'bar',
            data: { labels: dayLabels, datasets: [{ data: dayData, backgroundColor: dayColors, borderRadius: 4 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, title: { display: true, text: 'Tickets por dia de semana', font: { size: 11 }, color: 'var(--text-muted)' } },
                scales: { x: { ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { font: { size: 10 } } } },
            }
        });
    }

    var hrCanvas = document.getElementById('hmHourChart');
    if (hrCanvas && typeof Chart !== 'undefined') {
        if (_hmHourChart) { _hmHourChart.destroy(); _hmHourChart = null; }
        var hrLabels = _hmRange(24).map(function(h) { return h + 'h'; });
        var hrColors = m.hrTotals.map(function(_, i) { return i === peakHour ? '#f59e0b' : '#fde68a55'; });
        _hmHourChart = new Chart(hrCanvas, {
            type: 'bar',
            data: { labels: hrLabels, datasets: [{ data: m.hrTotals.slice(), backgroundColor: hrColors, borderRadius: 3 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, title: { display: true, text: 'Tickets por hora del dia', font: { size: 11 }, color: 'var(--text-muted)' } },
                scales: { x: { ticks: { font: { size: 8 }, maxRotation: 0 } }, y: { beginAtZero: true, ticks: { font: { size: 9 } } } },
            }
        });
    }
}

function _hmRecoHtml(m, days, peakDayIdx, peakHour, maxC) {
    // Top 3 busiest hour slots across all days
    var slots = [];
    for (var d = 0; d < 7; d++) {
        for (var h = 0; h < 24; h++) {
            if (m.grid[d][h] > 0) slots.push({ d: d, h: h, c: m.grid[d][h] });
        }
    }
    slots.sort(function(a, b) { return b.c - a.c; });

    // Find quietest 3h window (business hours 7-18)
    var minSlot = 7, minSum = Infinity;
    for (var h = 7; h <= 15; h++) {
        var sum = m.hrTotals[h] + m.hrTotals[h+1] + m.hrTotals[h+2];
        if (sum < minSum) { minSum = sum; minSlot = h; }
    }

    // Find busiest 3h window
    var maxSlot = 0, maxSum = -1;
    for (var h = 0; h < 22; h++) {
        var sum = m.hrTotals[h] + m.hrTotals[h+1] + m.hrTotals[h+2];
        if (sum > maxSum) { maxSum = sum; maxSlot = h; }
    }

    var wkndPct = ((m.dayTotals[0] + m.dayTotals[6]) / Math.max(1, m.total) * 100).toFixed(0);
    var earlyPct = (_hmRange(7).reduce(function(s,h){ return s + m.hrTotals[h]; }, 0) / Math.max(1,m.total) * 100).toFixed(0);

    var recos = [
        {
            icon: 'bi-graph-up-arrow', color: '#7c3aed',
            text: '<strong>Pico de carga:</strong> ' + _HM_DAYS_FULL[peakDayIdx] + ' entre ' + maxSlot + 'h y ' + (maxSlot+3) + 'h concentra la mayor actividad (' + maxSum + ' tickets en el periodo). Asegurar cobertura completa en ese bloque.'
        },
        {
            icon: 'bi-moon-stars-fill', color: '#10b981',
            text: '<strong>Ventana tranquila:</strong> ' + minSlot + 'h - ' + (minSlot+3) + 'h es el bloque mas calmo en horario laboral. Ideal para mantenimientos, actualizaciones de software y tareas de backlog.'
        },
        {
            icon: 'bi-calendar2-week', color: '#3b82f6',
            text: '<strong>Fin de semana:</strong> representa el ' + wkndPct + '% de incidencias. ' + (parseInt(wkndPct) < 8 ? 'Se puede operar con guardia reducida (1 tecnico on-call).' : 'Volumen relevante â€” mantener cobertura parcial.')
        },
    ];

    if (parseInt(earlyPct) > 15) {
        recos.push({
            icon: 'bi-sunrise', color: '#f59e0b',
            text: '<strong>Madrugada/alba (' + earlyPct + '%):</strong> hay tickets registrados entre 0h-7h. Considerar guardia nocturna o SLA extendido para ese bloque.'
        });
    }

    if (slots.length > 0) {
        var t = slots[0];
        recos.push({
            icon: 'bi-bullseye', color: '#ef4444',
            text: '<strong>Slot critico:</strong> ' + _HM_DAYS_FULL[t.d] + ' a las ' + t.h + 'h registro ' + t.c + ' tickets en el periodo â€” el maximo registrado en un solo bloque hora+dia.'
        });
    }

    var html = '<div class="hm-reco"><div style="font-size:12px;font-weight:700;color:var(--text-main);margin-bottom:8px;">'
        + '<i class="bi bi-lightbulb-fill" style="color:#f59e0b;margin-right:6px;"></i>Recomendaciones de staffing</div>';
    html += recos.map(function(r) {
        return '<div class="hm-reco-item">'
            + '<i class="bi ' + r.icon + '" style="color:' + r.color + ';flex-shrink:0;font-size:14px;margin-top:2px;"></i>'
            + '<span>' + r.text + '</span></div>';
    }).join('');
    html += '</div>';
    return html;
}

// ── Registrar Incidencia: assign buttons ────────────────────────────────────
var _crtPickerKey   = null;
var _crtSearchTimer = null;
var _crtWPAgents    = null; // cached WP-Soporte Presencial agents

async function crtSelfAssign() {
    var key = (document.getElementById('modalTicketKey') || {}).textContent;
    key = key ? key.trim() : '';
    if (!key) return;
    var email = getJiraEmail();
    if (!email) return;
    try {
        var users = await jira('GET', '/rest/api/3/user/assignable/search?issueKey=' + encodeURIComponent(key) + '&query=' + encodeURIComponent(email));
        if (!users || !users.length) {
            var all = await jira('GET', '/rest/api/3/user/search?query=' + encodeURIComponent(email));
            users = (all || []).filter(function(u) { return u.accountType === 'atlassian' || !u.accountType || !(u.accountType || '').startsWith('customer'); });
        }
        if (!users || !users.length) throw new Error('"' + email + '" no es un agente Jira asignable. Verifica el correo en Configurar correo Jira.');
        var u = users[0];
        await jira('PUT', '/rest/api/3/issue/' + key + '/assignee', { accountId: u.accountId });
        showToast('✓ ' + key + ' asignado a ' + (u.displayName || email), 'success');
        try { bootstrap.Modal.getInstance(document.getElementById('modalTicketOk')).hide(); } catch(e2) {}
        setTimeout(function() { window.location.href = '/itsm/incidencias/gestion?panel=misAsig'; }, 700);
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function crtShowAssignPicker() {
    var keyEl = document.getElementById('modalTicketKey');
    _crtPickerKey = keyEl ? keyEl.textContent.trim() : '';
    if (!_crtPickerKey) return;
    var overlay  = document.getElementById('crtAssignOverlay');
    var picker   = document.getElementById('crtAssignPicker');
    var keyLbl   = document.getElementById('crtAssignKey');
    var searchEl = document.getElementById('crtAssignSearch');
    var list     = document.getElementById('crtAssignList');
    if (!picker) return;
    if (keyLbl)   keyLbl.textContent = _crtPickerKey;
    if (searchEl) searchEl.value = '';
    if (overlay)  overlay.style.display = '';
    picker.style.display = '';
    setTimeout(function() { if (searchEl) searchEl.focus(); }, 60);
    if (list) list.innerHTML = '<div style="text-align:center;padding:14px;"><span class="kb-spin" style="display:inline-block;"></span></div>';
    _crtLoadWPAgents(list);
}

async function _crtLoadWPAgents(listEl) {
    var el = listEl || document.getElementById('crtAssignList');
    // 1. Use cached WP agents if available
    if (_crtWPAgents && _crtWPAgents.length) { _crtRenderAgentRows(_crtWPAgents, el); return; }
    // 2. Try kanban board agents if loaded (same page session)
    if (typeof _kbExtractAgentsFromBoard === 'function') {
        var board = _kbExtractAgentsFromBoard();
        if (board && board.length) { _crtWPAgents = board; _crtRenderAgentRows(board, el); return; }
    }
    // 3. Fetch via JQL: WP-Soporte Presencial issues → extract assignees
    try {
        var data = await jira('POST', '/rest/api/3/search/jql', {
            jql: 'project = INC AND "Tipo de Componente" = Workplace AND assignee is not EMPTY ORDER BY updated DESC',
            fields: ['assignee'],
            maxResults: 100
        });
        var seen = {}, agents = [];
        (data.issues || []).forEach(function(i) {
            var a = (i.fields || {}).assignee;
            if (!a) return;
            var uid = a.accountId || a.name || a.emailAddress;
            if (uid && !seen[uid]) { seen[uid] = true; agents.push(a); }
        });
        agents.sort(function(a, b) { return (a.displayName || '').localeCompare(b.displayName || ''); });
        if (agents.length) { _crtWPAgents = agents; _crtRenderAgentRows(agents, el); return; }
    } catch(e) { /* fallback below */ }
    // 4. Last resort: general assignable search
    _crtSearchJira('', el);
}

async function _crtSearchJira(query, listEl) {
    var el = listEl || document.getElementById('crtAssignList');
    try {
        var url = '/rest/api/3/user/assignable/search?project=INC&maxResults=50';
        if (query) url += '&query=' + encodeURIComponent(query);
        var data = await jira('GET', url);
        var users = Array.isArray(data) ? data : (data.values || []);
        users = users.filter(function(u) { return u.active !== false && (u.displayName || u.emailAddress); });
        users.sort(function(a, b) { return (a.displayName || '').localeCompare(b.displayName || ''); });
        _crtRenderAgentRows(users, el);
    } catch(e) {
        if (el) el.innerHTML = '<div style="color:#ef4444;padding:12px;font-size:11px;">' + incEsc(e.message) + '</div>';
    }
}

function _crtRenderAgentRows(agents, listEl) {
    var el = listEl || document.getElementById('crtAssignList');
    if (!el) return;
    if (!agents || !agents.length) {
        el.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted);text-align:center;">Sin resultados</div>';
        return;
    }
    el.innerHTML = agents.map(function(a) {
        var uid      = incEsc(a.accountId || a.name || a.emailAddress || '');
        var name     = incEsc(a.displayName || a.emailAddress || a.name || uid);
        var email    = incEsc(a.emailAddress || '');
        var initials = (a.displayName || '?').split(' ').slice(0, 2).map(function(w) { return w[0] || ''; }).join('').toUpperCase();
        var avatar   = a.avatarUrls && (a.avatarUrls['24x24'] || a.avatarUrls['32x32'] || a.avatarUrls['16x16']);
        var ava = avatar
            ? '<img src="' + avatar + '" style="width:30px;height:30px;border-radius:50%;flex-shrink:0;" onerror="this.style.display=\'none\'">'
            : '<span class="kb-avatar" style="width:30px;height:30px;font-size:10px;flex-shrink:0;">' + initials + '</span>';
        return '<div onclick="crtPickAgent(this)"'
            + ' data-uid="' + uid + '" data-aname="' + incEsc((a.displayName || a.emailAddress || '').replace(/"/g, '&quot;')) + '"'
            + ' style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;"'
            + ' onmouseenter="this.style.background=\'var(--bg-main)\'" onmouseleave="this.style.background=\'\'">'
            + ava
            + '<div style="min-width:0;flex:1;">'
            + '<div style="font-size:12px;font-weight:600;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</div>'
            + (email ? '<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + email + '</div>' : '')
            + '</div></div>';
    }).join('');
}

function crtFilterAgents() {
    var searchEl = document.getElementById('crtAssignSearch');
    var list     = document.getElementById('crtAssignList');
    var q        = searchEl ? searchEl.value.trim() : '';
    clearTimeout(_crtSearchTimer);
    if (q.length >= 1) {
        // Filter cached WP agents first (instant), then search Jira for complement
        if (_crtWPAgents && _crtWPAgents.length) {
            var ql = q.toLowerCase();
            var filtered = _crtWPAgents.filter(function(a) {
                return (a.displayName || a.emailAddress || '').toLowerCase().indexOf(ql) >= 0;
            });
            _crtRenderAgentRows(filtered, list);
        } else {
            if (list) list.innerHTML = '<div style="text-align:center;padding:14px;"><span class="kb-spin" style="display:inline-block;"></span></div>';
        }
        _crtSearchTimer = setTimeout(function() { _crtSearchJira(q, list); }, 350);
    } else {
        _crtLoadWPAgents(list);
    }
}

function crtPickAgent(el) {
    crtDoAssign(el.dataset.uid, el.dataset.aname);
}

async function crtDoAssign(accountId, displayName) {
    var key = _crtPickerKey;
    crtCloseAssignPicker();
    if (!key) return;
    try {
        await jira('PUT', '/rest/api/3/issue/' + key + '/assignee', { accountId: accountId });
        showToast('✓ ' + key + ' asignado a ' + displayName, 'success');
        try { bootstrap.Modal.getInstance(document.getElementById('modalTicketOk')).hide(); } catch(e2) {}
        setTimeout(function() { window.location.href = '/itsm/incidencias/gestion?buscar=' + encodeURIComponent(key); }, 700);
    } catch(e) {
        showToast('Error al asignar: ' + e.message, 'error');
    }
}

function crtCloseAssignPicker() {
    clearTimeout(_crtSearchTimer);
    var overlay = document.getElementById('crtAssignOverlay');
    var picker  = document.getElementById('crtAssignPicker');
    if (overlay) overlay.style.display = 'none';
    if (picker)  picker.style.display  = 'none';
    _crtPickerKey = null;
}

// ── Feature I: Timeline de ticket ────────────────────────────────────────────
async function openTimeline(key) {
    var overlay = document.getElementById('tlOverlay');
    var drawer  = document.getElementById('tlDrawer');
    if (!drawer) return;
    if (overlay) overlay.style.display = '';
    drawer.style.display = 'flex';
    document.getElementById('tlTitle').textContent = key;
    document.getElementById('tlSub').textContent   = 'Cargando cronología...';
    var body = document.getElementById('tlBody');
    body.innerHTML = '<div style="text-align:center;padding:40px;"><span class="kb-spin" style="display:inline-block;"></span></div>';

    try {
        var data = await jira('GET', '/rest/api/3/issue/' + key
            + '?expand=changelog&fields=created,summary,status,assignee,reporter,resolutiondate,priority,comment');
        var f  = data.fields || {};
        document.getElementById('tlSub').textContent = f.summary || '';

        var events = [];

        // Creación
        events.push({ date: f.created, type: 'created', text: 'Ticket creado', by: (f.reporter && (f.reporter.displayName || f.reporter.emailAddress)) || '' });

        // Changelog
        var histories = (data.changelog && data.changelog.histories) || [];
        histories.forEach(function(h) {
            (h.items || []).forEach(function(it) {
                if (it.field === 'status') {
                    events.push({ date: h.created, type: 'status', text: (it.fromString || '?') + ' → ' + (it.toString || '?'), by: (h.author && h.author.displayName) || '' });
                } else if (it.field === 'assignee') {
                    events.push({ date: h.created, type: 'assign', text: 'Asignado a ' + (it.toString || 'Sin asignar'), by: (h.author && h.author.displayName) || '' });
                }
            });
        });

        // Comentarios
        var cmts = (f.comment && f.comment.comments) || [];
        cmts.forEach(function(c) {
            var txt = '';
            try {
                (c.body && c.body.content || []).forEach(function(p) {
                    (p.content || []).forEach(function(n) { txt += (n.text || ''); });
                    txt += ' ';
                });
            } catch(e2) {}
            txt = txt.trim().slice(0, 180) + (txt.trim().length > 180 ? '…' : '');
            events.push({ date: c.created, type: 'comment', text: txt || '(comentario)', by: (c.author && c.author.displayName) || '' });
        });

        // Resolución
        if (f.resolutiondate) {
            events.push({ date: f.resolutiondate, type: 'resolved', text: 'Ticket resuelto · ' + (f.status && f.status.name || ''), by: '' });
        }

        events.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

        var ICONS  = { created:'bi-plus-circle-fill', status:'bi-arrow-left-right', assign:'bi-person-fill', comment:'bi-chat-fill', resolved:'bi-check-circle-fill' };
        var COLORS = { created:'#3b82f6', status:'#6366f1', assign:'#f59e0b', comment:'#10b981', resolved:'#059669' };
        var LABELS = { created:'Creación', status:'Estado', assign:'Asignación', comment:'Comentario', resolved:'Resolución' };

        body.innerHTML = events.map(function(ev, idx) {
            var dt  = ev.date ? new Date(ev.date) : null;
            var dts = dt ? dt.toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'numeric' })
                        + ' · ' + dt.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' }) : '';
            var col = COLORS[ev.type] || '#6b7280';
            var ico = ICONS[ev.type]  || 'bi-dot';
            var lbl = LABELS[ev.type] || ev.type;
            var isLast = idx === events.length - 1;
            return '<div class="tl-event">'
                + '<div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:30px;">'
                + '<div class="tl-icon" style="background:' + col + '18;border:2px solid ' + col + ';"><i class="bi ' + ico + '" style="font-size:10px;color:' + col + ';"></i></div>'
                + (isLast ? '' : '<div class="tl-line"></div>')
                + '</div>'
                + '<div style="padding-bottom:6px;min-width:0;flex:1;">'
                + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">'
                + '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:' + col + ';background:' + col + '18;padding:1px 6px;border-radius:20px;">' + lbl + '</span>'
                + '</div>'
                + '<div style="font-size:12px;font-weight:600;color:var(--text-main);line-height:1.4;word-break:break-word;">' + incEsc(ev.text) + '</div>'
                + (ev.by ? '<div style="font-size:10px;color:var(--text-muted);margin-top:1px;">' + incEsc(ev.by) + '</div>' : '')
                + '<div style="font-size:10px;color:var(--text-muted);font-family:monospace;margin-top:2px;">' + dts + '</div>'
                + '</div></div>';
        }).join('');

        if (!events.length) body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px;">Sin eventos registrados</div>';
    } catch(e) {
        body.innerHTML = '<div style="color:#ef4444;padding:20px;font-size:12px;">' + incEsc(e.message) + '</div>';
    }
}

function tlClose() {
    var overlay = document.getElementById('tlOverlay');
    var drawer  = document.getElementById('tlDrawer');
    if (overlay) overlay.style.display = 'none';
    if (drawer)  drawer.style.display  = 'none';
}

// ── Feature J: Comparativa semana a semana ───────────────────────────────────
var _swLoaded = false;

async function loadWeekComp(force) {
    if (_swLoaded && !force) return;
    var el = document.getElementById('swPanel');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:40px;"><span class="kb-spin" style="display:inline-block;"></span><div style="font-size:11px;color:var(--text-muted);margin-top:10px;">Calculando comparativa semanal...</div></div>';

    try {
        // Compute Monday boundaries
        var now  = new Date();
        var dow  = now.getDay(); // 0=Sun
        var thisMon = new Date(now);
        thisMon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
        thisMon.setHours(0, 0, 0, 0);
        var lastMon = new Date(thisMon.getTime() - 7 * 86400000);
        var nextMon = new Date(thisMon.getTime() + 7 * 86400000);

        var fmt = function(d) {
            return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        };
        var fmtLabel = function(d) {
            return d.toLocaleDateString('es-PE', { day:'2-digit', month:'short' });
        };

        var dateRange = document.getElementById('swDateRange');
        if (dateRange) dateRange.textContent = 'Esta semana: ' + fmtLabel(thisMon) + ' – ' + fmtLabel(now) + ' · Sem. pasada: ' + fmtLabel(lastMon) + ' – ' + fmtLabel(thisMon);

        var BASE = 'project = INC AND "Tipo de Componente" = Workplace';
        var FIELDS = ['summary', 'status', 'assignee', 'priority', 'created', 'resolutiondate'];

        var results = await Promise.all([
            jira('POST', '/rest/api/3/search/jql', {
                jql: BASE + ' AND created >= "' + fmt(thisMon) + '" ORDER BY created DESC',
                fields: FIELDS, maxResults: 250
            }),
            jira('POST', '/rest/api/3/search/jql', {
                jql: BASE + ' AND created >= "' + fmt(lastMon) + '" AND created < "' + fmt(thisMon) + '" ORDER BY created DESC',
                fields: FIELDS, maxResults: 250
            })
        ]);

        var calcStats = function(issues) {
            var techs = {}, totalRes = 0, totalMttrMs = 0, mttrN = 0;
            (issues || []).forEach(function(i) {
                var f   = i.fields || {};
                var asgn = (f.assignee && (f.assignee.displayName || f.assignee.emailAddress)) || 'Sin asignar';
                if (!techs[asgn]) techs[asgn] = { created:0, resolved:0, mttrMs:0, mttrN:0 };
                techs[asgn].created++;
                var stL = (f.status && f.status.name || '').toLowerCase();
                if (/resuelto|resolved|done|cerrado|closed/.test(stL) && f.resolutiondate && f.created) {
                    var ms = new Date(f.resolutiondate) - new Date(f.created);
                    if (ms > 0) { techs[asgn].mttrMs += ms; techs[asgn].mttrN++; totalMttrMs += ms; mttrN++; }
                    techs[asgn].resolved++;
                    totalRes++;
                }
            });
            return { total: (issues || []).length, resolved: totalRes, avgMttr: mttrN > 0 ? totalMttrMs / mttrN : 0, techs: techs };
        };

        var cs = calcStats(results[0].issues);
        var ps = calcStats(results[1].issues);

        var fmtMttr = function(ms) {
            if (!ms) return '—';
            var h = ms / 3600000;
            return h < 1 ? Math.round(ms / 60000) + 'min' : h.toFixed(1) + 'h';
        };

        var kpiCard = function(label, curr, prev, lowerBetter) {
            var delta = '', dColor = 'var(--text-muted)';
            if (typeof curr === 'number' && prev > 0) {
                var pct = Math.round((curr - prev) / prev * 100);
                var better = lowerBetter ? pct < 0 : pct > 0;
                dColor = better ? '#10b981' : pct === 0 ? 'var(--text-muted)' : '#ef4444';
                delta = '<div style="font-size:11px;font-weight:700;color:' + dColor + ';margin-top:3px;">' + (pct > 0 ? '↑ +' : pct < 0 ? '↓ ' : '→ ') + Math.abs(pct) + '% vs sem. pasada</div>';
            }
            return '<div style="background:var(--bg-main);border-radius:10px;padding:14px 16px;border:1px solid var(--border-soft);">'
                + '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">' + label + '</div>'
                + '<div style="display:flex;align-items:baseline;gap:8px;">'
                + '<span style="font-size:24px;font-weight:800;color:var(--text-main);">' + curr + '</span>'
                + (prev !== undefined ? '<span style="font-size:11px;color:var(--text-muted);">vs ' + prev + '</span>' : '')
                + '</div>'
                + delta + '</div>';
        };

        // Union of all techs
        var allTechs = {};
        Object.keys(cs.techs).forEach(function(t) { allTechs[t] = true; });
        Object.keys(ps.techs).forEach(function(t) { allTechs[t] = true; });

        var techRows = Object.keys(allTechs).filter(function(t) { return t !== 'Sin asignar'; }).sort().concat(
            allTechs['Sin asignar'] ? ['Sin asignar'] : []
        ).map(function(t) {
            var c  = cs.techs[t] || { created:0, resolved:0, mttrMs:0, mttrN:0 };
            var p  = ps.techs[t] || { created:0, resolved:0, mttrMs:0, mttrN:0 };
            var cm = c.mttrN > 0 ? c.mttrMs / c.mttrN : 0;
            var pm = p.mttrN > 0 ? p.mttrMs / p.mttrN : 0;
            var dC = c.created - p.created;
            var dR = c.resolved - p.resolved;
            var dCColor = dC < 0 ? '#10b981' : dC > 0 ? '#f59e0b' : 'var(--text-muted)';
            var dRColor = dR > 0 ? '#10b981' : dR < 0 ? '#ef4444' : 'var(--text-muted)';
            var dCStr = dC === 0 ? '<span style="color:var(--text-muted);">—</span>'
                : '<span style="font-weight:700;color:' + dCColor + ';">' + (dC > 0 ? '▲ +' : '▼ ') + dC + '</span>';
            var dRStr = dR === 0 ? '<span style="color:var(--text-muted);">—</span>'
                : '<span style="font-weight:700;color:' + dRColor + ';">' + (dR > 0 ? '▲ +' : '▼ ') + dR + '</span>';
            var dMStr = '';
            if (cm && pm) {
                var dMs = cm - pm;
                var dMPct = Math.round(Math.abs(dMs) / pm * 100);
                var dMColor = dMs < 0 ? '#10b981' : '#ef4444';
                dMStr = '<span style="font-size:10px;font-weight:700;color:' + dMColor + ';">' + (dMs < 0 ? '▼ ' : '▲ +') + dMPct + '%</span>';
            }
            var cellBl = 'border-left:1px solid var(--border-soft);';
            return '<tr style="border-bottom:1px solid var(--border-soft);">'
                + '<td style="padding:8px 10px;font-size:12px;font-weight:600;color:var(--text-main);">' + incEsc(t) + '</td>'
                + '<td style="padding:8px;text-align:center;font-size:13px;font-weight:800;color:var(--text-main);' + cellBl + '">' + c.created + '</td>'
                + '<td style="padding:8px;text-align:center;font-size:12px;color:var(--text-muted);">' + p.created + '</td>'
                + '<td style="padding:8px;text-align:center;">' + dCStr + '</td>'
                + '<td style="padding:8px;text-align:center;font-size:13px;font-weight:800;color:var(--text-main);' + cellBl + '">' + c.resolved + '</td>'
                + '<td style="padding:8px;text-align:center;font-size:12px;color:var(--text-muted);">' + p.resolved + '</td>'
                + '<td style="padding:8px;text-align:center;">' + dRStr + '</td>'
                + '<td style="padding:8px;text-align:center;font-size:12px;font-weight:600;color:var(--text-main);' + cellBl + '">' + fmtMttr(cm) + '</td>'
                + '<td style="padding:8px;text-align:center;font-size:11px;">' + (pm ? '<span style="color:var(--text-muted);">' + fmtMttr(pm) + '</span>' + (dMStr ? '<br>' + dMStr : '') : '—') + '</td>'
                + '</tr>';
        }).join('');

        var legend = '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;background:var(--bg-header);border:1px solid var(--border-soft);border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:11px;">'
            + '<span style="font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;flex-shrink:0;">Cómo leer la tabla:</span>'
            + '<span style="display:inline-flex;align-items:center;gap:6px;color:var(--text-main);">'
            +   '<span style="font-size:13px;font-weight:800;">12</span>'
            +   '<span style="color:var(--text-muted);">Esta semana</span>'
            + '</span>'
            + '<span style="color:var(--border-soft);">|</span>'
            + '<span style="display:inline-flex;align-items:center;gap:6px;">'
            +   '<span style="font-size:11px;background:var(--bg-main);border:1px solid var(--border-soft);border-radius:4px;padding:1px 6px;color:var(--text-muted);">ant: 10</span>'
            +   '<span style="color:var(--text-muted);">Semana anterior</span>'
            + '</span>'
            + '<span style="color:var(--border-soft);">|</span>'
            + '<span style="display:inline-flex;align-items:center;gap:8px;">'
            +   '<span style="color:#10b981;font-weight:700;">▲ +2</span><span style="color:var(--text-muted);">= subió</span>'
            +   '<span style="color:#ef4444;font-weight:700;">▼ -2</span><span style="color:var(--text-muted);">= bajó</span>'
            + '</span>'
            + '<span style="color:var(--border-soft);">|</span>'
            + '<span style="color:var(--text-muted);">MTTR = tiempo promedio de resolución</span>'
            + '</div>';

        el.innerHTML =
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;flex-shrink:0;">'
            + kpiCard('Tickets creados', cs.total, ps.total, false)
            + kpiCard('Resueltos', cs.resolved, ps.resolved, false)
            + kpiCard('MTTR promedio', fmtMttr(cs.avgMttr), fmtMttr(ps.avgMttr), true)
            + '</div>'
            + legend
            + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Desglose por técnico</div>'
            + '<div style="overflow-x:auto;flex:1;">'
            + '<table style="width:100%;border-collapse:collapse;">'
            + '<thead>'
            + '<tr style="border-bottom:1px solid var(--border-soft);background:var(--bg-header);">'
            + '<th style="text-align:left;padding:8px 10px;font-size:11px;color:var(--text-muted);font-weight:700;" rowspan="2">Técnico</th>'
            + '<th style="padding:6px 8px;font-size:11px;color:var(--text-muted);font-weight:700;text-align:center;border-left:1px solid var(--border-soft);" colspan="3">Tickets creados</th>'
            + '<th style="padding:6px 8px;font-size:11px;color:var(--text-muted);font-weight:700;text-align:center;border-left:1px solid var(--border-soft);" colspan="3">Resueltos</th>'
            + '<th style="padding:6px 8px;font-size:11px;color:var(--text-muted);font-weight:700;text-align:center;border-left:1px solid var(--border-soft);" colspan="2">MTTR</th>'
            + '</tr>'
            + '<tr style="border-bottom:2px solid var(--border-soft);background:var(--bg-header);">'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;border-left:1px solid var(--border-soft);">Esta sem.</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;">Ant.</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;">Cambio</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;border-left:1px solid var(--border-soft);">Esta sem.</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;">Ant.</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;">Cambio</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;border-left:1px solid var(--border-soft);">Esta sem.</th>'
            + '<th style="padding:4px 8px;font-size:10px;color:var(--text-muted);font-weight:600;text-align:center;">Ant.</th>'
            + '</tr>'
            + '</thead>'
            + '<tbody>' + (techRows || '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px;">Sin datos para este periodo</td></tr>') + '</tbody>'
            + '</table></div>';

        _swLoaded = true;
    } catch(e) {
        el.innerHTML = '<div style="color:#ef4444;padding:20px;font-size:12px;">' + incEsc(e.message) + '</div>';
    }
}

// ── Feature L: Notas internas ────────────────────────────────────────────────
var _noteTimers = {};

function toggleNoteInc(key, btn) {
    var card = btn ? btn.closest('.ticket-card') : null;
    var div  = (card ? card.querySelector('#note-' + key) : null) || document.getElementById('note-' + key);
    if (!div) return;
    var showing = div.style.display === 'block';
    div.style.display = showing ? 'none' : 'block';
    if (!showing) {
        var ta = (card ? card.querySelector('#note-input-' + key) : null) || document.getElementById('note-input-' + key);
        if (ta) {
            ta.value = localStorage.getItem('itsmNote_' + key) || '';
            setTimeout(function() { ta.focus(); }, 60);
        }
    }
}

function saveNoteInc(key, val) {
    clearTimeout(_noteTimers[key]);
    _noteTimers[key] = setTimeout(function() {
        if (val && val.trim()) {
            localStorage.setItem('itsmNote_' + key, val);
        } else {
            localStorage.removeItem('itsmNote_' + key);
        }
        var btn = document.getElementById('noteBtn-' + key);
        if (btn) {
            var has = !!(val && val.trim());
            btn.style.color       = has ? '#8b5cf6' : '';
            btn.style.borderColor = has ? 'rgba(139,92,246,.4)' : '';
            btn.innerHTML = '<i class="bi bi-sticky' + (has ? '-fill' : '') + '"></i> Nota' + (has ? ' ·' : '');
        }
    }, 400);
}

function clearNoteInc(key, el) {
    localStorage.removeItem('itsmNote_' + key);
    var card = el ? el.closest('.ticket-card') : null;
    var ta   = (card ? card.querySelector('#note-input-' + key) : null) || document.getElementById('note-input-' + key);
    var div  = (card ? card.querySelector('#note-' + key) : null) || document.getElementById('note-' + key);
    var btn  = (card ? card.querySelector('#noteBtn-' + key) : null) || document.getElementById('noteBtn-' + key);
    if (ta)  ta.value = '';
    if (div) div.style.display = 'none';
    if (btn) {
        btn.style.color = '';
        btn.style.borderColor = '';
        btn.innerHTML = '<i class="bi bi-sticky"></i> Nota';
    }
}

function sinCatSearch(q) {
    _sinCatSearch = (q || '').trim();
    _sinCatApply();
}

async function loadCategoryStats() {
    try {
        const r = await fetch('/api/jira/sincategorizar/stats', { credentials: 'include' });
        const d = await r.json();
        if (!d.success) return;
        renderCategoryStats(d.data || []);
    } catch(_) {}
}

function renderCategoryStats(rows) {
    const wrap = document.getElementById('catStatsPills');
    const sub  = document.getElementById('catStatsSub');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">Sin datos</span>'; return; }
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    if (sub) sub.textContent = `· ${total} tickets totales`;
    const palette = ['#ef4444','#f59e0b','#3b82f6','#10b981','#8b5cf6','#ec4899','#6366f1','#0ea5e9','#14b8a6','#64748b'];
    wrap.innerHTML = rows.map((r, i) => {
        const isSinCat = r.categoria === 'Sin categorizar';
        const color = isSinCat ? '#f59e0b' : palette[i % palette.length];
        const cnt = Number(r.total);
        const pct = Math.round((cnt / total) * 100);
        return `<span title="${incEsc(r.categoria)} — ${cnt} tickets (${pct}%)"
          style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;
                 border:1px solid ${color}33;background:${color}14;color:${color};
                 font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;"
          onclick="sinCatFilterByCat('${incEsc(r.categoria)}')">
          ${isSinCat ? '<i class="bi bi-flag-fill"></i>' : ''}
          ${incEsc(r.categoria.length > 20 ? r.categoria.slice(0,20)+'…' : r.categoria)}
          <span style="background:${color}25;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;">${cnt}</span>
        </span>`;
    }).join('');
}

function sinCatFilterByCat(catName) {
    const inp = document.getElementById('sinCatSearchInput');
    if (catName === 'Sin categorizar') {
        if (inp) { inp.value = ''; }
        _sinCatSearch = '';
        _sinCatApply();
    } else {
        // Buscar tickets de esa categoría en el buscador global (panel Buscar)
        const buscarBtn = document.getElementById('nav-buscar');
        if (buscarBtn) buscarBtn.click();
        setTimeout(() => {
            const bi = document.getElementById('incSearchInput');
            if (bi) { bi.value = catName; }
            if (typeof buscarTicket === 'function') buscarTicket();
        }, 150);
    }
}

// ══════════════════════════════════════════════════════════
// CMDB VISUAL
// ══════════════════════════════════════════════════════════
let _cmdbLoaded = false;

// ── CMDB recent searches (localStorage) ─────────────────────────────────
const _CMDB_RECENT_KEY = 'cmdb_recent_v1';
const _CMDB_RECENT_MAX = 5;

function _cmdbSaveRecent(code, label) {
    try {
        let list = JSON.parse(localStorage.getItem(_CMDB_RECENT_KEY) || '[]');
        list = list.filter(function(x) { return x.code !== code; });
        list.unshift({ code, label: label || code });
        if (list.length > _CMDB_RECENT_MAX) list = list.slice(0, _CMDB_RECENT_MAX);
        localStorage.setItem(_CMDB_RECENT_KEY, JSON.stringify(list));
        _cmdbRenderRecent();
    } catch(_) {}
}

function _cmdbRenderRecent() {
    try {
        const list = JSON.parse(localStorage.getItem(_CMDB_RECENT_KEY) || '[]');
        const wrap  = document.getElementById('cmdbRecentWrap');
        const chips = document.getElementById('cmdbRecentChips');
        if (!wrap || !chips || !list.length) { if (wrap) wrap.style.display = 'none'; return; }
        chips.innerHTML = list.map(function(x) {
            return `<span class="cmdb-ex-chip" onclick="document.getElementById('cmdbSearchInput').value='${incEsc(x.code)}';cmdbSearch();" title="${incEsc(x.label)}"><i class="bi bi-pc-display-horizontal"></i> ${incEsc(x.code)}</span>`;
        }).join('');
        wrap.style.display = 'block';
    } catch(_) {}
}

let _topIncRetries = 0;
async function _cmdbLoadTopInc() {
    const container = document.getElementById('cmdbTopIncCards');
    const tsEl      = document.getElementById('cmdbTopIncTs');
    if (!container) return;
    try {
        const r = await fetch('/api/jira/cmdb/top-incidentes', { credentials: 'include' });
        const d = await r.json();
        if (d.loading && _topIncRetries < 4) {
            _topIncRetries++;
            setTimeout(_cmdbLoadTopInc, 2000);
            return;
        }
        _topIncRetries = 0;
        if (!d.data || !d.data.length) {
            container.innerHTML = '<div style="text-align:center;padding:14px;font-size:11px;color:var(--text-muted);">Sin datos en los últimos 30 días.</div>';
            return;
        }
        const riskFor  = function(n) { return n>=6?'critico':n>=4?'alto':n>=2?'medio':'bajo'; };
        const riskCol  = { critico:'#dc2626', alto:'#d97706', medio:'#2563eb', bajo:'#059669' };
        const riskLbl  = { critico:'Crítico',  alto:'Alto',   medio:'Medio',   bajo:'Bajo'   };
        container.innerHTML = d.data.map(function(row) {
            const n     = Number(row.inc_30d) || 0;
            const risk  = riskFor(n);
            const col   = riskCol[risk];
            const lbl   = riskLbl[risk];
            const brand = ((row.brand||'')+' '+(row.model||'')).trim();
            const name  = row.full_name || '';
            const code  = row.device_code || '';
            const email = row.email || '';
            const label = code || email.split('@')[0];
            const sub   = [name, brand].filter(Boolean).join(' · ') || email || '—';
            return `<div class="cmdb-top-card" data-code="${incEsc(code)}" data-email="${incEsc(email)}" onclick="cmdbTopIncClick(this)" style="border-left:3px solid ${col};">
              <div class="ctc-icon" style="background:${col}1a;color:${col};">
                <i class="bi bi-${code ? 'pc-display-horizontal' : 'person-fill'}"></i>
              </div>
              <div class="ctc-body">
                <div class="ctc-code">${incEsc(label)}</div>
                <div class="ctc-sub">${incEsc(sub)}</div>
              </div>
              <div class="ctc-count">
                <div class="ctc-num" style="color:${col};">${n}</div>
                <div class="ctc-lbl">inc/30d</div>
              </div>
              <span class="ctc-badge" style="background:${col}1a;color:${col};border:1px solid ${col}33;">${lbl}</span>
            </div>`;
        }).join('');
        if (tsEl && d.ts) {
            const mins = Math.round((Date.now() - d.ts) / 60000);
            tsEl.textContent = mins <= 1 ? 'Actualizado ahora' : `Actualizado hace ${mins} min`;
            tsEl.style.display = 'block';
        }
    } catch(_) {
        if (container) container.innerHTML = '<div style="text-align:center;padding:14px;font-size:11px;color:var(--text-muted);">No disponible.</div>';
    }
}

async function _cmdbLoadQuickStats() {
    try {
        const r = await fetch('/api/jira/cmdb/quick-stats', { credentials: 'include' });
        const d = await r.json();
        const twoStats = [
            { id:'qstat-inc-equip', type:'with_equip', icon:'bi-pc-display-horizontal', color:'#2563eb',
              label:'Con equipo asignado', val: d.inc_by_device },
            { id:'qstat-inc-email', type:'identified',  icon:'bi-envelope-at-fill',       color:'#7c3aed',
              label:'Identificadas',  val: d.inc_by_email  },
        ];
        twoStats.forEach(function(s) {
            const el = document.getElementById(s.id);
            if (!el) return;
            el.className = '';
            el.style.cssText = 'height:80px;border-radius:12px;border:1px solid var(--border-soft);background:var(--bg-card);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:12px 10px;cursor:pointer;transition:all .15s;';
            el.innerHTML = '<i class="bi ' + s.icon + '" style="color:' + s.color + ';font-size:16px;"></i>'
                + '<div style="font-size:24px;font-weight:800;font-family:monospace;color:' + s.color + ';line-height:1.1;">' + Number(s.val||0).toLocaleString() + '</div>'
                + '<div style="font-size:9px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:center;">' + s.label + '</div>';
            el.onmouseenter = function() { this.style.borderColor = s.color; this.style.transform = 'translateY(-2px)'; };
            el.onmouseleave = function() { this.style.borderColor = ''; this.style.transform = ''; };
            el.onclick = function() { cmdbShowStatDetail(s.type); };
        });
    } catch(_) {}
}

function cmdbGoBack() {
    var ht = document.getElementById('cmdbHotTable');
    var dd = document.getElementById('cmdbDeviceDetail');
    var sd = document.getElementById('cmdbStatDetail');
    var es = document.getElementById('cmdbEmptyState');
    if (ht) ht.style.display = 'none';
    if (dd) dd.style.display = 'none';
    if (sd) sd.style.display = 'none';
    if (es) es.style.display = '';
    var inp = document.getElementById('cmdbSearchInput');
    if (inp) inp.value = '';
}

async function cmdbShowStatDetail(type) {
    var sd = document.getElementById('cmdbStatDetail');
    var es = document.getElementById('cmdbEmptyState');
    var ht = document.getElementById('cmdbHotTable');
    var dd = document.getElementById('cmdbDeviceDetail');
    if (!sd) return;
    if (ht) ht.style.display = 'none';
    if (dd) dd.style.display = 'none';
    if (es) es.style.display = 'none';

    var isEquip  = type === 'with_equip';
    var col      = isEquip ? '#2563eb' : '#7c3aed';
    var icon     = isEquip ? 'bi-pc-display-horizontal' : 'bi-envelope-at-fill';
    var titleTxt = isEquip ? 'Incidencias con equipo asignado · últimos 30 días'
                           : 'Reporteros identificados · últimos 30 días';

    sd.style.display = 'block';
    sd.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">'
        + '<button onclick="cmdbGoBack()" style="display:flex;align-items:center;gap:4px;background:none;border:1px solid var(--border-soft);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;color:var(--text-muted);" onmouseover="this.style.borderColor=\'#7c3aed\';this.style.color=\'#7c3aed\';" onmouseout="this.style.borderColor=\'\';this.style.color=\'\';">'
        + '<i class="bi bi-arrow-left"></i> Volver</button>'
        + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);display:flex;align-items:center;gap:5px;">'
        + '<i class="bi ' + icon + '" style="color:' + col + ';"></i> ' + titleTxt + '</div>'
        + '</div>'
        + '<div id="_sdList" style="display:flex;flex-direction:column;gap:7px;">'
        + '<div class="cmdb-skel"></div><div class="cmdb-skel"></div><div class="cmdb-skel"></div></div>';

    try {
        const r = await fetch('/api/jira/cmdb/stat-detail?type=' + type, { credentials: 'include' });
        const d = await r.json();
        var list = document.getElementById('_sdList');
        if (!list) return;
        if (!d.data || !d.data.length) {
            list.innerHTML = '<div style="text-align:center;padding:18px;font-size:11px;color:var(--text-muted);">Sin datos en los últimos 30 días.</div>';
            return;
        }
        var rFor = function(n) { return n>=6?'critico':n>=4?'alto':n>=2?'medio':'bajo'; };
        var rCol = { critico:'#dc2626', alto:'#d97706', medio:'#2563eb', bajo:'#059669' };
        var rLbl = { critico:'Crítico', alto:'Alto', medio:'Medio', bajo:'Bajo' };
        list.innerHTML = d.data.map(function(row) {
            var n   = Number(row.inc_30d) || 0;
            var rc  = rFor(n); var c = rCol[rc]; var l = rLbl[rc];
            var brd = ((row.brand||'')+' '+(row.model||'')).trim();
            if (isEquip) {
                var code = row.device_code || '';
                var sub  = [row.full_name, brd].filter(Boolean).join(' · ') || '—';
                return '<div class="cmdb-top-card" data-code="' + incEsc(code) + '" onclick="cmdbOpenDevice(this.getAttribute(\'data-code\'))" style="border-left:3px solid ' + c + ';">'
                    + '<div class="ctc-icon" style="background:' + c + '1a;color:' + c + ';"><i class="bi bi-pc-display-horizontal"></i></div>'
                    + '<div class="ctc-body"><div class="ctc-code">' + incEsc(code) + '</div><div class="ctc-sub">' + incEsc(sub) + '</div></div>'
                    + '<div class="ctc-count"><div class="ctc-num" style="color:' + c + ';">' + n + '</div><div class="ctc-lbl">inc/30d</div></div>'
                    + '<span class="ctc-badge" style="background:' + c + '1a;color:' + c + ';border:1px solid ' + c + '33;">' + l + '</span></div>';
            } else {
                var email = row.email || '';
                var label = row.full_name || email.split('@')[0];
                var sub2  = [email, brd].filter(Boolean).join(' · ') || '—';
                return '<div class="cmdb-top-card" data-code="' + incEsc(row.device_code||'') + '" data-email="' + incEsc(email) + '" onclick="cmdbTopIncClick(this)" style="border-left:3px solid ' + c + ';">'
                    + '<div class="ctc-icon" style="background:' + c + '1a;color:' + c + ';"><i class="bi bi-person-fill"></i></div>'
                    + '<div class="ctc-body"><div class="ctc-code">' + incEsc(label) + '</div><div class="ctc-sub">' + incEsc(sub2) + '</div></div>'
                    + '<div class="ctc-count"><div class="ctc-num" style="color:' + c + ';">' + n + '</div><div class="ctc-lbl">inc/30d</div></div>'
                    + '<span class="ctc-badge" style="background:' + c + '1a;color:' + c + ';border:1px solid ' + c + '33;">' + l + '</span></div>';
            }
        }).join('');
    } catch(_) {
        var list2 = document.getElementById('_sdList');
        if (list2) list2.innerHTML = '<div style="text-align:center;padding:18px;font-size:11px;color:var(--text-muted);">Error al cargar.</div>';
    }
}

function cmdbTopIncClick(el) {
    var code  = el.getAttribute('data-code');
    var email = el.getAttribute('data-email');
    if (code) {
        cmdbOpenDevice(code);
    } else if (email) {
        cmdbOpenByEmail(email);
    }
}

async function cmdbOpenByEmail(email) {
    if (!email) return;
    try {
        const r = await fetch('/api/jira/employee-info?email=' + encodeURIComponent(email), { credentials: 'include' });
        const d = await r.json();
        if (d.success && d.data && d.data.equipo) {
            cmdbOpenDevice(d.data.equipo);
        } else {
            cmdbOpenByReporter(email);
        }
    } catch(_) {
        cmdbOpenByReporter(email);
    }
}

async function loadCmdbPanel(force) {
    if (_cmdbLoaded && !force) return;
    const loading = document.getElementById('cmdbLoading');
    const hotTable = document.getElementById('cmdbHotTable');
    if (loading) loading.style.display = 'block';
    if (hotTable) hotTable.style.display = 'none';
    _cmdbRenderRecent();
    _topIncRetries = 0;
    _cmdbLoadTopInc();
    _cmdbLoadQuickStats();
    try {
        const r = await fetch('/api/jira/cmdb/hot-devices', { credentials: 'include' });
        const d = await r.json();
        if (!d.success) throw new Error('API error');
        const s = d.stats || {};
        const kpiR = document.getElementById('cmdbKpiRisk');
        const kpiRep = document.getElementById('cmdbKpiReplace');
        const kpiTot = document.getElementById('cmdbKpiTotal');
        if (kpiR)   kpiR.textContent   = s.at_risk || 0;
        if (kpiRep) kpiRep.textContent = s.suggest_replace || 0;
        if (kpiTot) kpiTot.textContent = s.total_with_incidents || 0;
        // Badge en nav si hay equipos en riesgo
        const badge = document.getElementById('badge-cmdb-risk');
        if (badge) {
            if (s.at_risk > 0) { badge.textContent = s.at_risk; badge.style.display = 'inline-block'; }
            else badge.style.display = 'none';
        }
        renderCmdbHotTable(d.devices || []);
        _cmdbLoaded = true;
    } catch(e) {
        if (loading) loading.style.display = 'none';
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderCmdbHotTable(devices) {
    const tbody = document.getElementById('cmdbHotBody');
    const table = document.getElementById('cmdbHotTable');
    if (!tbody) return;
    if (!devices.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;">No hay equipos con incidencias vinculadas aún.<br><span style="font-size:11px;opacity:.7;">Las nuevas incidencias se vinculan automáticamente al crear tickets.</span></td></tr>';
        if (table) table.style.display = 'block';
        return;
    }
    const riskColor = { critico: '#dc2626', alto: '#d97706', medio: '#2563eb', bajo: '#059669' };
    const riskLabel = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };
    tbody.innerHTML = devices.map(d => {
        const n30 = Number(d.last30) || 0;
        const n60 = Number(d.last60) || 0;
        const risk = n30 >= 6 ? 'critico' : n30 >= 4 ? 'alto' : n30 >= 2 ? 'medio' : 'bajo';
        const rColor = riskColor[risk];
        const eqStatus = d.eq_status || '—';
        const statusBg = eqStatus === 'Asignado' ? 'rgba(5,150,105,.1)' : eqStatus === 'Mantenimiento' ? 'rgba(245,158,11,.1)' : eqStatus === 'Obsoleto' ? 'rgba(220,38,38,.1)' : 'rgba(99,102,241,.08)';
        const statusColor = eqStatus === 'Asignado' ? '#059669' : eqStatus === 'Mantenimiento' ? '#d97706' : eqStatus === 'Obsoleto' ? '#dc2626' : '#6366f1';
        const recoIcon = n60 >= 8 ? ' <i class="bi bi-exclamation-triangle-fill" style="color:#dc2626;font-size:10px;" title="Reemplazo urgente"></i>' : n30 >= 4 ? ' <i class="bi bi-wrench-adjustable" style="color:#d97706;font-size:10px;" title="Considerar reemplazo"></i>' : '';
        return `<tr style="border-bottom:1px solid var(--border-soft);cursor:pointer;" onclick="cmdbOpenDevice('${incEsc(d.device_code)}')">
          <td style="padding:8px 12px;font-family:monospace;font-weight:700;color:var(--jira-blue);">${incEsc(d.device_code)}${recoIcon}</td>
          <td style="padding:8px 12px;font-size:11px;color:var(--text-main);">${incEsc((d.brand||'')+' '+(d.model||'')).trim()||'—'}</td>
          <td style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-muted);">${incEsc(d.equipment_type||'—')}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;color:${n30>=4?'#dc2626':n30>=2?'#d97706':'var(--text-main)'};">${n30}</td>
          <td style="padding:8px 12px;text-align:center;color:var(--text-muted);">${Number(d.total)||0}</td>
          <td style="padding:8px 12px;text-align:center;"><span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;background:${statusBg};color:${statusColor};">${incEsc(eqStatus)}</span></td>
          <td style="padding:8px 12px;text-align:center;"><span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:${rColor}1a;color:${rColor};border:1px solid ${rColor}33;">${riskLabel[risk]}</span></td>
          <td style="padding:8px 12px;text-align:center;"><button class="btn-outline-sm" style="padding:3px 10px;font-size:11px;" onclick="event.stopPropagation();cmdbOpenDevice('${incEsc(d.device_code)}')"><i class="bi bi-eye"></i></button></td>
        </tr>`;
    }).join('');
    if (table) table.style.display = 'block';
}

async function cmdbOpenDevice(code) {
    _cmdbSaveRecent(code, code);
    const detail = document.getElementById('cmdbDeviceDetail');
    if (detail) { detail.style.display = 'block'; detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    document.getElementById('cmdbDetailTitle').textContent = 'Cargando ' + code + '...';
    document.getElementById('cmdbDetailSubtitle').textContent = '';
    document.getElementById('cmdbDetailSpecs').innerHTML = '';
    const th = document.getElementById('cmdbTicketHistory');
    if (th) th.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Cargando...</td></tr>';
    try {
        const r = await fetch(`/api/jira/cmdb/device/${encodeURIComponent(code)}`, { credentials: 'include' });
        const d = await r.json();
        renderCmdbDetail(d, code);
    } catch(e) {
        document.getElementById('cmdbDetailTitle').textContent = code + ' — Error al cargar';
    }
}

async function cmdbOpenByReporter(email) {
    const detail = document.getElementById('cmdbDeviceDetail');
    if (detail) { detail.style.display = 'block'; detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    document.getElementById('cmdbDetailTitle').textContent = 'Cargando...';
    document.getElementById('cmdbDetailSubtitle').textContent = email;
    document.getElementById('cmdbDetailSpecs').innerHTML = '';
    const th = document.getElementById('cmdbTicketHistory');
    if (th) th.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px;">Cargando...</td></tr>';
    try {
        const r = await fetch(`/api/jira/cmdb/by-reporter?email=${encodeURIComponent(email)}`, { credentials: 'include' });
        const d = await r.json();
        if (!d.success) throw new Error('Error');
        // Si el device no tiene code, usar el email como identificador visual
        if (!d.device) d.device = {};
        if (!d.device.device_code) d.device.device_code = email.split('@')[0];
        renderCmdbDetail(d, d.device.device_code);
        // Personalizar subtítulo con nombre + equipo
        const sub = document.getElementById('cmdbDetailSubtitle');
        const parts = [d.full_name || email, d.device?.model || d.device?.device_code].filter(Boolean);
        if (sub) sub.textContent = parts.join(' · ');
    } catch(e) {
        document.getElementById('cmdbDetailTitle').textContent = 'Error al cargar — ' + email;
    }
}

function renderCmdbDetail(d, code) {
    const dev = d.device || {};
    const h   = d.history || {};
    const risk = h.risk || 'bajo';
    const riskColor = { critico: '#dc2626', alto: '#d97706', medio: '#2563eb', bajo: '#059669' };
    const riskLabel = { critico: 'Riesgo crítico', alto: 'Riesgo alto', medio: 'Riesgo medio', bajo: 'Riesgo bajo' };
    const rColor = riskColor[risk];
    // Header
    document.getElementById('cmdbDetailHeader').style.background = `linear-gradient(135deg,${rColor}14,${rColor}07)`;
    document.getElementById('cmdbDetailTitle').textContent = dev.device_code || code;
    document.getElementById('cmdbDetailSubtitle').textContent = [dev.brand, dev.model, dev.equipment_type].filter(Boolean).join(' · ') || 'Equipo no registrado en inventario';
    const rBadge = document.getElementById('cmdbDetailRiskBadge');
    rBadge.textContent = riskLabel[risk];
    rBadge.style.background = `${rColor}18`;
    rBadge.style.color = rColor;
    rBadge.style.border = `1px solid ${rColor}33`;
    const recoBadge = document.getElementById('cmdbDetailRecoBadge');
    if (h.recommendation === 'reemplazo_urgente') {
        recoBadge.textContent = '🔴 Reemplazo urgente';
        recoBadge.style.background = 'rgba(220,38,38,.15)';
        recoBadge.style.color = '#dc2626';
        recoBadge.style.border = '1px solid rgba(220,38,38,.3)';
        recoBadge.style.display = 'inline-block';
    } else if (h.recommendation === 'considerar_reemplazo') {
        recoBadge.textContent = '⚙ Considerar reemplazo';
        recoBadge.style.display = 'inline-block';
    } else {
        recoBadge.style.display = 'none';
    }
    // Specs
    const specs = [
        ['Serial', dev.serial_number], ['Tipo', dev.equipment_type], ['Brand', dev.brand],
        ['Modelo', dev.model], ['OS', dev.operating_system], ['RAM', dev.ram_memory],
        ['Disco', dev.disk_capacity], ['Estado', dev.status]
    ].filter(([,v]) => v);
    document.getElementById('cmdbDetailSpecs').innerHTML = specs.map(([k,v]) =>
        `<div style="background:var(--bg-card);border-radius:8px;padding:8px 10px;border:1px solid var(--border-soft);">
          <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">${k}</div>
          <div style="font-size:12px;font-weight:700;color:var(--text-main);">${incEsc(String(v))}</div>
        </div>`
    ).join('');
    // Stats
    document.getElementById('cmdbStat30').textContent   = h.last30  || 0;
    document.getElementById('cmdbStat60').textContent   = h.last60  || 0;
    document.getElementById('cmdbStat90').textContent   = h.last90  || 0;
    document.getElementById('cmdbStatTotal').textContent = h.total   || 0;
    // Ticket history
    const pBadge = { P1:'#ef4444', P2:'#f59e0b', P3:'#3b82f6', P4:'#6b7280' };
    const tickets = h.tickets || [];
    document.getElementById('cmdbTicketHistory').innerHTML = tickets.length
        ? tickets.map(t => {
            const pColor = pBadge[t.priority] || '#6b7280';
            const fecha = t.created_at ? new Date(t.created_at).toLocaleDateString('es-PE', { day:'2-digit', month:'short', year:'2-digit' }) : '—';
            return `<tr style="border-bottom:1px solid var(--border-soft);">
              <td style="padding:7px 10px;font-family:monospace;font-weight:700;color:var(--jira-blue);white-space:nowrap;">${incEsc(t.ticket_key||'')}</td>
              <td style="padding:7px 10px;font-size:11px;color:var(--text-main);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${incEsc(t.summary||'')}">${incEsc((t.summary||'').slice(0,50))}</td>
              <td style="padding:7px 10px;text-align:center;"><span style="padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700;background:${pColor}22;color:${pColor};">${t.priority||'—'}</span></td>
              <td style="padding:7px 10px;text-align:center;font-size:10px;color:var(--text-muted);">${incEsc(t.internal_status||t.status||'—')}</td>
              <td style="padding:7px 10px;font-size:10px;color:var(--text-muted);white-space:nowrap;">${incEsc(t.assigned_to_name||'—')}</td>
              <td style="padding:7px 10px;font-size:10px;color:var(--text-muted);white-space:nowrap;">${fecha}</td>
            </tr>`;
          }).join('')
        : '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">Sin incidencias registradas para este equipo</td></tr>';
}

async function cmdbSearch() {
    const q = (document.getElementById('cmdbSearchInput')?.value || '').trim();
    if (!q) return;
    hideAc('cmdbAcDrop');
    if (q.includes('@')) {
        await cmdbOpenByEmail(q);
    } else {
        await cmdbOpenDevice(q);
    }
}

let _cmdbAcTimer = null;
let _cmdbAcResults = [];

async function cmdbAc(q) {
    const drop = document.getElementById('cmdbAcDrop');
    if (!drop) return;
    clearTimeout(_cmdbAcTimer);
    if (!q || q.length < 2) { drop.classList.remove('show'); drop.innerHTML = ''; return; }
    _cmdbAcTimer = setTimeout(async () => {
        try {
            const r = await fetch(`/api/jira/cmdb/autocomplete?q=${encodeURIComponent(q)}`, { credentials: 'include' });
            const d = await r.json();
            const list = d.data || [];
            if (!list.length) { drop.innerHTML = '<div class="ac-empty">Sin resultados</div>'; drop.classList.add('show'); return; }
            _cmdbAcResults = list;
            drop.innerHTML = list.map((item, idx) => `
                <div class="ac-item" data-idx="${idx}" style="cursor:pointer;">
                  <span class="ac-email">
                    ${item.type === 'device'
                        ? '<i class="bi bi-pc-display-horizontal" style="color:#7c3aed;margin-right:5px;"></i>'
                        : '<i class="bi bi-person-circle" style="color:#3b82f6;margin-right:5px;"></i>'}
                    ${incEsc(item.label)}
                  </span>
                  <span class="ac-details">${incEsc(item.sub || '')}</span>
                </div>`).join('');
            drop.querySelectorAll('[data-idx]').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const item = _cmdbAcResults[parseInt(el.getAttribute('data-idx'))];
                    if (!item) return;
                    const inp = document.getElementById('cmdbSearchInput');
                    if (inp) inp.value = item.label;
                    drop.classList.remove('show');
                    drop.innerHTML = '';
                    if (item.type === 'reporter') {
                        // Buscar por email del reporter directamente (más confiable)
                        cmdbOpenByReporter(item.label);
                    } else {
                        if (item.value) cmdbOpenDevice(item.value);
                        else showToast('Sin equipo asignado', 'info');
                    }
                });
            });
            drop.classList.add('show');
        } catch(_) {}
    }, 300);
}

// ── Enriquecimiento de teléfono desde directorio local (fallback) ─────────────
async function enrichCardsWithPhone(root) {
    const spans = (root || document).querySelectorAll('.tc-ph-lkp[data-rn]:not([data-rn-ok])');
    if (!spans.length) return;
    spans.forEach(s => s.dataset.rnOk = '1');
    const names = [...new Set([...spans].map(s => s.dataset.rn))];
    try {
        const r = await fetch('/api/jira/staff-phones', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ names })
        });
        const { results } = await r.json();
        spans.forEach(s => {
            const p = results[s.dataset.rn];
            if (p) s.querySelector('b').textContent = p;
            else   s.style.display = 'none';
        });
    } catch (_) {
        spans.forEach(s => s.style.display = 'none');
    }
}

// Observer: dispara enriquecimiento cada vez que se renderizan nuevas cards
let _phTimer;
new MutationObserver(() => {
    if (!document.querySelector('.tc-ph-lkp:not([data-rn-ok])')) return;
    clearTimeout(_phTimer);
    _phTimer = setTimeout(() => enrichCardsWithPhone(document), 600);
}).observe(document.documentElement, { childList: true, subtree: true });

function openCmdbDeviceModal(code, prefetchedData) {
    const btn = document.getElementById('nav-cmdb');
    if (btn) btn.click();
    setTimeout(() => {
        if (prefetchedData) {
            const detail = document.getElementById('cmdbDeviceDetail');
            if (detail) { detail.style.display = 'block'; detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
            renderCmdbDetail(prefetchedData, code);
        } else if (code && code.includes('@')) {
            cmdbOpenByReporter(code);
        } else {
            cmdbOpenDevice(code);
        }
    }, 200);
}

// ── Consultas Activas ──────────────────────────────────────────────────────────
let _consultasData = [];

async function loadConsultasActivas() {
    const icon = document.getElementById('consultRefreshIcon');
    if (icon) { icon.style.animation = 'spin 1s linear infinite'; }
    try {
        const r = await fetch('/api/chatbot/consults/active', { credentials: 'include' });
        const d = await r.json();
        if (!d.success) return;
        const waiting = d.waiting || [];
        const active  = d.active ? [d.active] : [];
        const all = [
            ...waiting.map(c => ({ ...c, _status: 'waiting' })),
            ...active.map(c => ({ ...c, _status: 'active' }))
        ];
        _consultasData = all;
        _renderConsultasTable(all);
        // KPIs
        const kw = document.getElementById('consultKpiWaiting');
        const ka = document.getElementById('consultKpiActive');
        if (kw) kw.textContent = waiting.length;
        if (ka) ka.textContent = active.length;
        // Tiempo promedio de espera
        if (waiting.length > 0) {
            const now = Date.now();
            const avgMs = waiting.reduce((s, c) => s + (now - new Date(c.created_at).getTime()), 0) / waiting.length;
            const mins = Math.round(avgMs / 60000);
            const kavg = document.getElementById('consultKpiAvg');
            if (kavg) kavg.textContent = mins < 1 ? '<1 min' : mins + ' min';
        } else {
            const kavg = document.getElementById('consultKpiAvg');
            if (kavg) kavg.textContent = '—';
        }
        // Actualizar sidebar
        if (typeof window._cciRefreshSidebar === 'function') window._cciRefreshSidebar(waiting);
    } catch(e) {
        const wrap = document.getElementById('consultTableWrap');
        if (wrap) wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;font-size:13px;"><i class="bi bi-exclamation-triangle"></i> Error al cargar: ${e.message}</div>`;
    } finally {
        if (icon) icon.style.animation = '';
    }
}

function _renderConsultasTable(list) {
    const wrap = document.getElementById('consultTableWrap');
    if (!wrap) return;
    if (!list.length) {
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 20px;gap:12px;">
            <div style="width:56px;height:56px;background:rgba(8,145,178,.08);border-radius:50%;display:flex;align-items:center;justify-content:center;">
              <i class="bi bi-chat-dots" style="font-size:24px;color:#0891b2;opacity:.5;"></i>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--text-muted);">Sin consultas activas en este momento</div>
            <div style="font-size:11px;color:var(--text-muted);opacity:.7;">Las nuevas consultas aparecerán aquí automáticamente</div>
          </div>`;
        return;
    }
    const rows = list.map(c => {
        const isWaiting = c._status === 'waiting';
        const since = _timeAgo(c.created_at);
        const statusBadge = isWaiting
            ? `<span style="background:rgba(8,145,178,.12);color:#0891b2;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap;"><i class="bi bi-hourglass-split"></i> En espera</span>`
            : `<span style="background:rgba(5,150,105,.12);color:#059669;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;white-space:nowrap;"><i class="bi bi-headset"></i> En atención</span>`;
        const topicSafe = (c.topic || 'Sin tema').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const nameSafe  = (c.user_name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const emailSafe = (c.user_email || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const initial   = (nameSafe || emailSafe || '?')[0].toUpperCase();
        const respBtn = isWaiting
            ? `<button onclick="cciTake(${c.id})" style="display:flex;align-items:center;gap:5px;padding:6px 14px;background:linear-gradient(135deg,#0f766e,#0891b2);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;"><i class="bi bi-headset"></i> Atender</button>`
            : `<button onclick="cciReopen?cciReopen():null" style="display:flex;align-items:center;gap:5px;padding:6px 14px;background:rgba(5,150,105,.1);color:#059669;border:1px solid rgba(5,150,105,.25);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;"><i class="bi bi-chat-fill"></i> Ver chat</button>`;
        return `
          <tr style="border-bottom:1px solid var(--border-soft);">
            <td style="padding:12px 14px;vertical-align:middle;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#0891b2,#0f766e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0;">${initial}</div>
                <div>
                  <div style="font-size:12.5px;font-weight:700;color:var(--text-main);">${nameSafe || emailSafe}</div>
                  ${nameSafe ? `<div style="font-size:11px;color:var(--text-muted);">${emailSafe}</div>` : ''}
                </div>
              </div>
            </td>
            <td style="padding:12px 14px;vertical-align:middle;max-width:260px;">
              <div style="font-size:12px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${topicSafe}">${topicSafe}</div>
            </td>
            <td style="padding:12px 14px;vertical-align:middle;">${statusBadge}</td>
            <td style="padding:12px 14px;vertical-align:middle;font-size:11.5px;color:var(--text-muted);white-space:nowrap;"><i class="bi bi-clock"></i> ${since}</td>
            <td style="padding:12px 14px;vertical-align:middle;text-align:right;">${respBtn}</td>
          </tr>`;
    }).join('');
    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-soft);background:var(--bg-main);">
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Usuario</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Tema</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Estado</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Tiempo</th>
            <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:right;">Acción</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
}

function filterConsultas(q) {
    if (!q) { _renderConsultasTable(_consultasData); return; }
    const lq = q.toLowerCase();
    _renderConsultasTable(_consultasData.filter(c =>
        (c.user_name||'').toLowerCase().includes(lq) ||
        (c.user_email||'').toLowerCase().includes(lq) ||
        (c.topic||'').toLowerCase().includes(lq)
    ));
}

function _timeAgo(ts) {
    if (!ts) return '—';
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return 'Ahora';
    if (diff < 3600) return Math.floor(diff/60) + ' min';
    if (diff < 86400) return Math.floor(diff/3600) + ' h';
    return new Date(ts).toLocaleDateString('es-PE', {day:'2-digit',month:'short'});
}

// ── Tabs del panel de consultas ────────────────────────────────────────────────
function cqSwitchTab(tab) {
    ['live','hist'].forEach(t => {
        const btn  = document.getElementById('cqTab-' + t);
        const pane = document.getElementById('cqPane-' + t);
        const active = t === tab;
        if (btn)  { btn.style.color = active ? '#0891b2' : 'var(--text-muted)'; btn.style.borderBottomColor = active ? '#0891b2' : 'transparent'; btn.style.fontWeight = active ? '700' : '600'; }
        if (pane) pane.style.display = active ? '' : 'none';
    });
    if (tab === 'hist') loadAdminConsultHist(1);
}

// ── Historial de consultas (admin) ────────────────────────────────────────────
let _cqHistPage = 1;
let _cqHistTimer = null;

function cqHistDebounce() {
    clearTimeout(_cqHistTimer);
    _cqHistTimer = setTimeout(() => loadAdminConsultHist(1), 350);
}

async function loadAdminConsultHist(page) {
    page = page || 1;
    _cqHistPage = page;
    const icon   = document.getElementById('cqHistRefreshIcon');
    const wrap   = document.getElementById('cqHistTableWrap');
    const q      = (document.getElementById('cqHistSearch')?.value || '').trim();
    const status = document.getElementById('cqHistStatus')?.value || '';
    if (icon) icon.style.animation = 'spin 1s linear infinite';
    if (wrap) wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:36px;gap:8px;color:var(--text-muted);font-size:13px;"><div class="spinner-border spinner-border-sm text-primary"></div> Cargando…</div>`;
    try {
        let url = `/api/chatbot/consults/admin-history?page=${page}&limit=8`;
        if (q)      url += `&q=${encodeURIComponent(q)}`;
        if (status) url += `&status=${status}`;
        const r = await fetch(url, { credentials: 'include' });
        const d = await r.json();
        if (!d.success) throw new Error('Error al cargar');
        _renderCqHistTable(d.data || [], d.meta || {});
    } catch(e) {
        if (wrap) wrap.innerHTML = `<div style="padding:36px;text-align:center;color:#ef4444;font-size:13px;"><i class="bi bi-exclamation-triangle"></i> ${e.message}</div>`;
    } finally {
        if (icon) icon.style.animation = '';
    }
}

const _cqStatusMap = {
    waiting:   { label:'En espera',    color:'#0891b2', bg:'rgba(8,145,178,.1)' },
    active:    { label:'En atención',  color:'#059669', bg:'rgba(5,150,105,.1)' },
    resolved:  { label:'Resuelta',     color:'#64748b', bg:'rgba(100,116,139,.1)' },
    converted: { label:'Ticket creado',color:'#7c3aed', bg:'rgba(124,58,237,.1)' },
};

function _renderCqHistTable(list, meta) {
    const wrap  = document.getElementById('cqHistTableWrap');
    const pager = document.getElementById('cqHistPager');
    if (!wrap) return;
    if (!list.length) {
        wrap.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:48px 20px;gap:10px;color:var(--text-muted);">
          <i class="bi bi-chat-dots" style="font-size:32px;opacity:.3;"></i>
          <div style="font-size:13px;font-weight:600;">Sin consultas para los filtros seleccionados</div>
        </div>`;
        if (pager) pager.innerHTML = '';
        return;
    }
    const rows = list.map(c => {
        const st = _cqStatusMap[c.status] || _cqStatusMap.resolved;
        const topicSafe = (c.topic || 'Sin tema').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const nameSafe  = (c.user_name || c.user_email || '—').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const emailSafe = (c.user_email || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const ticket    = c.ticket_key ? `<span style="font-family:monospace;font-size:10px;background:rgba(124,58,237,.1);color:#7c3aed;border-radius:5px;padding:1px 6px;">${c.ticket_key}</span>` : '';
        const stars     = c.satisfaction_rating ? '⭐'.repeat(c.satisfaction_rating) : '<span style="opacity:.4;">Sin calificar</span>';
        return `<tr style="border-bottom:1px solid var(--border-soft);" onmouseenter="this.style.background='var(--hover-row)'" onmouseleave="this.style.background=''">
          <td style="padding:10px 14px;vertical-align:middle;">
            <div style="font-size:12.5px;font-weight:700;color:var(--text-main);">${nameSafe}</div>
            <div style="font-size:10.5px;color:var(--text-muted);">${emailSafe}</div>
          </td>
          <td style="padding:10px 14px;vertical-align:middle;max-width:220px;">
            <div style="font-size:12px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${topicSafe}">${topicSafe}</div>
          </td>
          <td style="padding:10px 14px;vertical-align:middle;font-size:11.5px;color:var(--text-muted);">${c.specialist_name || '<span style="opacity:.4;">—</span>'}</td>
          <td style="padding:10px 14px;vertical-align:middle;"><span style="background:${st.bg};color:${st.color};border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700;white-space:nowrap;">${st.label}</span></td>
          <td style="padding:10px 14px;vertical-align:middle;font-size:11.5px;">${stars}</td>
          <td style="padding:10px 14px;vertical-align:middle;font-size:11px;color:var(--text-muted);white-space:nowrap;">${_timeAgo(c.created_at)}</td>
          <td style="padding:10px 14px;vertical-align:middle;text-align:right;">
            <div style="display:flex;gap:6px;justify-content:flex-end;">
              ${ticket}
              <button onclick="loadCqHistDetail(${c.id})" style="padding:5px 12px;background:rgba(8,145,178,.1);color:#0891b2;border:1px solid rgba(8,145,178,.25);border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;">
                <i class="bi bi-chat-text"></i> Ver
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:2px solid var(--border-soft);background:var(--bg-main);">
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Usuario</th>
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Tema</th>
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Especialista</th>
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Estado</th>
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Calif.</th>
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:left;">Fecha</th>
        <th style="padding:9px 14px;font-size:10.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;text-align:right;">Acción</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    if (pager) {
        const pages = meta.pages || 1;
        pager.innerHTML = pages <= 1 ? '' : Array.from({length:pages},(_,i)=>i+1).map(p =>
            `<button onclick="loadAdminConsultHist(${p})" style="width:30px;height:30px;border-radius:7px;border:1.5px solid ${p===_cqHistPage?'#0891b2':'var(--border-soft)'};background:${p===_cqHistPage?'#0891b2':'var(--bg-card)'};color:${p===_cqHistPage?'#fff':'var(--text-muted)'};font-size:12px;cursor:pointer;font-weight:${p===_cqHistPage?'700':'400'};">${p}</button>`
        ).join('');
    }
}

async function loadCqHistDetail(id) {
    const detail  = document.getElementById('cqHistDetail');
    const msgs    = document.getElementById('cqHistMessages');
    const titleEl = document.getElementById('cqHistDetailTitle');
    const subEl   = document.getElementById('cqHistDetailSub');
    if (!detail || !msgs) return;
    if (detail.dataset.openId === String(id) && detail.style.display !== 'none') {
        detail.style.display = 'none'; detail.dataset.openId = ''; return;
    }
    detail.dataset.openId = String(id);
    detail.style.display = 'block';
    msgs.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px;display:flex;align-items:center;gap:6px;justify-content:center;"><span class="spinner-border spinner-border-sm"></span> Cargando mensajes…</div>`;
    setTimeout(() => detail.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);
    try {
        const r = await fetch(`/api/chatbot/consult/${id}/messages?since=0`, { credentials:'include' });
        const d = await r.json();
        if (!d.success) throw new Error('Sin acceso');
        const sess = d.session || {};
        if (titleEl) titleEl.textContent = `${sess.user_name || sess.user_email || 'Usuario'} — ${sess.specialist_name || 'Sin especialista'}`;
        if (subEl) {
            const st = _cqStatusMap[sess.status] || _cqStatusMap.resolved;
            subEl.innerHTML = `<span style="background:rgba(255,255,255,.2);border-radius:20px;padding:1px 8px;font-size:10px;">${st.label}</span>${sess.ticket_key ? ' · <span style="font-family:monospace;">' + sess.ticket_key + '</span>' : ''}`;
        }
        const messages = d.messages || [];
        if (!messages.length) { msgs.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:var(--text-muted);">Sin mensajes registrados</div>'; return; }
        msgs.innerHTML = messages.map(m => {
            const safe = (m.message||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const ts   = m.created_at ? new Date(m.created_at).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '';
            if (m.sender_role === 'system') return `<div style="align-self:center;font-size:10.5px;color:var(--text-muted);background:rgba(0,0,0,.06);border-radius:20px;padding:3px 12px;font-style:italic;">${safe}</div>`;
            const isSpec = m.sender_role === 'specialist';
            return `<div style="display:flex;flex-direction:column;align-items:${isSpec?'flex-end':'flex-start'};gap:2px;">
              <div style="font-size:10px;color:var(--text-muted);padding:0 4px;">${isSpec?(m.sender_name||'Especialista'):(sess.user_name||sess.user_email||'Usuario')} · ${ts}</div>
              <div style="max-width:82%;padding:8px 12px;border-radius:${isSpec?'12px 12px 2px 12px':'12px 12px 12px 2px'};font-size:12px;line-height:1.5;${isSpec?'background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;':'background:var(--bg-card);border:1.5px solid var(--border-soft);color:var(--text-main);'}">${safe}</div>
            </div>`;
        }).join('');
        msgs.scrollTop = msgs.scrollHeight;
    } catch(e) {
        msgs.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;"><i class="bi bi-exclamation-triangle"></i> ${e.message}</div>`;
    }
}

