// ── Dashboard Ejecutivo ────────────────────────────────────────────────────────

let _execOffset  = 0;   // 0=current month, 1=prev month, 3=quarter
let _execLoading = false;
const _execCI    = {};  // chart instances

function execSetPeriod(offset, el) {
    document.querySelectorAll('.exec-btn[id^="execPBtn"]').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    _execOffset = offset;
    loadEjecutivo(true);
}

async function loadEjecutivo(force) {
    if (_execLoading) return;

    // ── Compute date ranges ──────────────────────────────────────
    const now = new Date();
    let curFrom, curTo, prevFrom, prevTo, periodLabel, isQuarter = _execOffset === 3;

    if (isQuarter) {
        // Last 3 full months (not counting current partial month)
        const endM   = new Date(now.getFullYear(), now.getMonth(), 0);          // last day of prev month
        const startM = new Date(endM.getFullYear(), endM.getMonth() - 2, 1);    // 3 months window
        curFrom  = startM.toISOString().slice(0,10);
        curTo    = endM.toISOString().slice(0,10);
        const pEnd   = new Date(startM.getFullYear(), startM.getMonth(), 0);
        const pStart = new Date(pEnd.getFullYear(), pEnd.getMonth() - 2, 1);
        prevFrom = pStart.toISOString().slice(0,10);
        prevTo   = pEnd.toISOString().slice(0,10);
        const M  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
        periodLabel = M[startM.getMonth()] + ' – ' + M[endM.getMonth()] + ' ' + endM.getFullYear();
    } else {
        const rawMonth = now.getMonth() - _execOffset;
        const y  = rawMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
        const m  = ((rawMonth % 12) + 12) % 12;
        curFrom  = new Date(y, m, 1).toISOString().slice(0,10);
        curTo    = (_execOffset === 0)
            ? now.toISOString().slice(0,10)
            : new Date(y, m + 1, 0).toISOString().slice(0,10);
        const pm = m === 0 ? 11 : m - 1;
        const py = m === 0 ? y - 1 : y;
        prevFrom = new Date(py, pm, 1).toISOString().slice(0,10);
        prevTo   = new Date(py, pm + 1, 0).toISOString().slice(0,10);
        const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        periodLabel = MESES[m] + ' ' + y;
    }

    const CKEYC = 'exec:' + curFrom  + ':' + curTo;
    const CKEYP = 'exec:' + prevFrom + ':' + prevTo;

    // ── DOM refs ─────────────────────────────────────────────────
    const spinner = document.getElementById('execSpinner');
    const content = document.getElementById('execContent');
    const plabel  = document.getElementById('execPeriodLabel');
    const gdate   = document.getElementById('execGenDate');
    const footer  = document.getElementById('execFooterTs');
    if (plabel) plabel.textContent = periodLabel;
    if (gdate)  gdate.textContent  = 'Generado: ' + now.toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
    if (footer) footer.textContent = 'Generado el ' + now.toLocaleString('es-PE');

    const hasCur  = !force && !!_cacheGet(CKEYC);
    const hasPrev = !force && !!_cacheGet(CKEYP);

    if (!hasCur || !hasPrev) {
        if (spinner) spinner.style.display = 'block';
        if (content) content.style.display = 'none';
    }
    if (hasCur && hasPrev) {
        _execRender(_cacheGet(CKEYC), _cacheGet(CKEYP), isQuarter);
        _execLoadGamif(curFrom, curTo, periodLabel);
        return;
    }

    _execLoading = true;
    try {
        const FIELDS = ['summary','status','priority','assignee','created','resolutiondate'];
        const jqlOf  = (f, t) => `project = INC AND "Tipo de Componente" = Workplace AND created >= "${f}" AND created <= "${t}" ORDER BY created ASC`;
        const [curRaw, prevRaw] = await Promise.all([
            _execFetch(jqlOf(curFrom, curTo),   FIELDS),
            _execFetch(jqlOf(prevFrom, prevTo),  FIELDS)
        ]);
        _cacheSet(CKEYC, curRaw);
        _cacheSet(CKEYP, prevRaw);
        _execRender(curRaw, prevRaw, isQuarter);
        _execLoadGamif(curFrom, curTo, periodLabel);
    } catch(e) {
        showToast('Error: ' + e.message, 'error');
        if (spinner) spinner.style.display = 'none';
    } finally {
        _execLoading = false;
    }
}

async function _execFetch(jql, fields) {
    const issues = []; let npt;
    do {
        const body = { jql, fields, maxResults: 100 };
        if (npt) body.nextPageToken = npt;
        const d = await jira('POST', '/rest/api/3/search/jql', body);
        issues.push(...(d.issues || []));
        npt = (d.isLast === false && d.nextPageToken) ? d.nextPageToken : null;
    } while (npt && issues.length < 2000);
    return issues;
}

function _execKpi(issues) {
    const SLA_H = {highest:1,critical:1,p1:1,high:4,p2:4,medium:8,p3:8,low:24,p4:24,lowest:24};
    const now = Date.now();
    let slaOk=0, slaBd=0, mttrSum=0, mttrCnt=0, open=0, closed=0, noAsig=0;
    issues.forEach(iss => {
        const f    = iss.fields || {};
        const pk   = (f.priority?.name||'').toLowerCase().replace(/\s+/g,'');
        const slaH = SLA_H[pk] || (pk.includes('high')?4:pk.includes('low')?24:8);
        const creMs = f.created        ? new Date(f.created).getTime()        : 0;
        const resMs = f.resolutiondate ? new Date(f.resolutiondate).getTime() : 0;
        const isDone = /cerr|done|closed|resuelto|resolved/.test((f.status?.name||'').toLowerCase());
        if (!f.assignee) noAsig++;
        if (isDone) {
            closed++;
            if (creMs && resMs) {
                const ageH = (resMs - creMs) / 3600000;
                mttrSum += ageH; mttrCnt++;
                if (ageH <= slaH) slaOk++; else slaBd++;
            }
        } else {
            open++;
            if (creMs) { if ((now-creMs)/3600000 > slaH) slaBd++; else slaOk++; }
        }
    });
    return { total:issues.length, open, closed, noAsig, slaOk, slaBd,
        slaPct: (slaOk+slaBd) ? Math.round(slaOk/(slaOk+slaBd)*100) : null,
        mttr: mttrCnt ? mttrSum/mttrCnt : 0 };
}

function _execRender(curIssues, prevIssues, isQuarter) {
    const spinner = document.getElementById('execSpinner');
    const content = document.getElementById('execContent');
    if (spinner) spinner.style.display = 'none';
    if (content) content.style.display = '';

    const cur  = _execKpi(curIssues);
    const prev = _execKpi(prevIssues);

    const fmtH = h => h < 1 ? Math.round(h*60)+'min' : h < 24 ? h.toFixed(1)+'h' : Math.round(h/24)+'d';

    const numDelta = (c, p, higherIsBetter=true) => {
        if (!p && p !== 0) return { txt:'—', cls:'neu' };
        const diff = c - p;
        if (diff === 0) return { txt:'→ igual vs anterior', cls:'neu' };
        const pct = Math.round(Math.abs(diff)/Math.max(Math.abs(p),1)*100);
        const up  = diff > 0;
        return { txt:(up?'↑':'↓')+' '+pct+'% vs anterior', cls: up===higherIsBetter?'up':'down' };
    };
    const slaDelta = () => {
        if (cur.slaPct===null || prev.slaPct===null) return {txt:'—',cls:'neu'};
        const d = cur.slaPct - prev.slaPct;
        if (d===0) return {txt:'→ igual vs anterior',cls:'neu'};
        return {txt:(d>0?'↑':'↓')+' '+Math.abs(d)+'pp vs anterior', cls:d>0?'up':'down'};
    };
    const mttrDelta = () => {
        if (!cur.mttr||!prev.mttr) return {txt:'—',cls:'neu'};
        const d = cur.mttr - prev.mttr;
        if (Math.abs(d)<0.05) return {txt:'→ igual vs anterior',cls:'neu'};
        return {txt:(d>0?'↑':'↓')+' '+fmtH(Math.abs(d))+' vs anterior', cls:d<0?'up':'down'};
    };

    const kpis = [
        { lbl:'TOTAL TICKETS',    val:cur.total,                            delta:numDelta(cur.total,   prev.total,   true),  accent:'#3b82f6' },
        { lbl:'SLA CUMPLIMIENTO', val:cur.slaPct!=null?cur.slaPct+'%':'—',  delta:slaDelta(),                                 accent:'#10b981' },
        { lbl:'MTTR PROMEDIO',    val:cur.mttr?fmtH(cur.mttr):'—',          delta:mttrDelta(),                                accent:'#f59e0b' },
        { lbl:'CERRADOS',         val:cur.closed,                            delta:numDelta(cur.closed,  prev.closed,  true),  accent:'#8b5cf6' },
        { lbl:'SIN ASIGNAR',      val:cur.noAsig,                            delta:numDelta(cur.noAsig,  prev.noAsig,  false), accent:cur.noAsig>0?'#ef4444':'#10b981' },
    ];
    const kpiRow = document.getElementById('execKpiRow');
    if (kpiRow) kpiRow.innerHTML = kpis.map(k=>`
        <div class="exec-kpi-card" style="--exec-accent:${k.accent};">
          <div class="exec-kpi-lbl">${k.lbl}</div>
          <div class="exec-kpi-val" style="color:${k.accent};">${k.val}</div>
          <div class="exec-kpi-delta ${k.delta.cls}">${k.delta.txt}</div>
        </div>`).join('');

    // Destroy previous charts
    Object.values(_execCI).forEach(c => { try{c.destroy();}catch(e){} });
    const isDark  = document.documentElement.getAttribute('data-theme')==='dark';
    const tickClr = isDark ? '#94a3b8' : '#64748b';
    const gridClr = isDark ? 'rgba(148,163,184,.1)' : 'rgba(0,0,0,.05)';
    const mkChart = (id,type,labels,datasets,opts={}) => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        return new Chart(canvas.getContext('2d'),{type,data:{labels,datasets},options:{
            responsive:true,maintainAspectRatio:false,
            plugins:{legend:{labels:{color:tickClr,font:{size:9},boxWidth:10},...(opts.noLegend?{display:false}:{})}},
            scales: (type==='doughnut'||type==='pie') ? {} : {
                x:{ticks:{color:tickClr,font:{size:9},maxTicksLimit:isQuarter?6:10},grid:{color:gridClr}},
                y:{ticks:{color:tickClr,font:{size:9}},grid:{color:gridClr},beginAtZero:true}
            },...opts}});
    };

    // Chart 1 — Tendencia diaria / semanal
    {
        const byKey = {};
        curIssues.forEach(iss => {
            const raw = (iss.fields?.created||'').slice(0,10);
            if (!raw) return;
            const key = isQuarter
                ? 'Sem ' + _execWeekNum(new Date(raw))
                : new Date(raw+'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'short'});
            byKey[key] = (byKey[key]||0)+1;
        });
        const labels = Object.keys(byKey);
        _execCI.c1 = mkChart('execChart1','line',labels,[{
            label:'Tickets',data:labels.map(l=>byKey[l]),
            borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,.12)',fill:true,tension:.35,pointRadius:2,pointHoverRadius:4
        }],{noLegend:true});
    }

    // Chart 2 — Prioridad (donut)
    {
        const pm={};
        curIssues.forEach(iss=>{const p=iss.fields?.priority?.name||'Sin prioridad';pm[p]=(pm[p]||0)+1;});
        const PCLR={Alta:'#ef4444',High:'#ef4444',Highest:'#ef4444',Critical:'#ef4444',Media:'#f59e0b',Medium:'#f59e0b',Baja:'#10b981',Low:'#10b981',Lowest:'#10b981'};
        const labels=Object.keys(pm);
        _execCI.c2 = mkChart('execChart2','doughnut',labels,[{
            data:labels.map(l=>pm[l]),backgroundColor:labels.map(l=>PCLR[l]||'#8b5cf6'),
            borderWidth:2,borderColor:isDark?'#1e293b':'#fff'
        }],{cutout:'62%'});
    }

    // Chart 3 — Top técnicos (bar horizontal)
    {
        const tm={};
        curIssues.forEach(iss=>{
            const f=iss.fields||{};
            if(!/cerr|done|closed|resuelto|resolved/.test((f.status?.name||'').toLowerCase()))return;
            const n=f.assignee?.displayName||f.assignee?.emailAddress||'Sin asignar';
            tm[n]=(tm[n]||0)+1;
        });
        const top=Object.entries(tm).sort((a,b)=>b[1]-a[1]).slice(0,6);
        _execCI.c3 = mkChart('execChart3','bar',
            top.map(([n])=>n.split(' ').slice(0,2).join(' ')),
            [{label:'Cerrados',data:top.map(([,v])=>v),backgroundColor:'rgba(16,185,129,.75)',borderRadius:4,borderSkipped:false}],
            {indexAxis:'y',noLegend:true});
    }

    // Chart 4 — Estado (donut: abiertos vs cerrados)
    {
        _execCI.c4 = mkChart('execChart4','doughnut',
            ['Abiertos','Cerrados'],
            [{data:[cur.open,cur.closed],backgroundColor:['#f59e0b','#10b981'],borderWidth:2,borderColor:isDark?'#1e293b':'#fff'}],
            {cutout:'62%'});
    }
}

async function _execLoadGamif(from, to, label) {
    const GKEY = 'gamif:' + from + ':' + to;
    const cached = _cacheGet(GKEY);
    if (cached) { _execRenderGamification(cached, label); return; }
    try {
        const r = await fetch(`/tickets/gamification?from=${from}&to=${to}`);
        if (!r.ok) return;
        const j = await r.json();
        if (j.ok && j.data) {
            _cacheSet(GKEY, j.data);
            _execRenderGamification(j.data, label);
        }
    } catch(e) { /* silent — gamification is non-blocking */ }
}

function _execRenderGamification(data, label) {
    const section = document.getElementById('execGamifSection');
    const cards   = document.getElementById('execGamifCards');
    const lbl     = document.getElementById('execGamifPeriodLbl');
    if (!section || !cards) return;
    if (lbl) lbl.textContent = label ? '· ' + label : '';
    if (!data || !data.length) { section.style.display = 'none'; return; }

    const MEDALS   = ['🥇','🥈','🥉'];
    const RANK_CLR = ['#f59e0b','#9ca3af','#b87333'];
    const RANK_BG  = ['rgba(245,158,11,.08)','rgba(156,163,175,.08)','rgba(184,115,51,.08)'];

    cards.innerHTML = data.map((t, i) => {
        const medal    = i < 3 ? MEDALS[i] : '#' + (i + 1);
        const clr      = i < 3 ? RANK_CLR[i] : 'var(--text-muted)';
        const bg       = i < 3 ? RANK_BG[i]  : 'transparent';
        const name     = t.tec_name || '?';
        const initials = name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
        const badgeHtml = (t.badges || []).map(b =>
            `<span title="${b.label}" style="font-size:14px;line-height:1;">${b.icon}</span>`
        ).join('');
        const avgH     = t.avg_res_min ? (t.avg_res_min / 60).toFixed(1) + 'h' : '—';
        const scoreBar = Math.min(100, t.score || 0);
        const shadow   = i < 3 ? 'box-shadow:0 2px 12px rgba(0,0,0,.07);' : '';
        return `<div style="background:var(--bg-card);border:1px solid var(--border-soft);border-radius:12px;padding:14px;position:relative;overflow:hidden;${shadow}">
  <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${clr};opacity:.7;"></div>
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
    <div style="width:38px;height:38px;border-radius:50%;background:${bg};border:2px solid ${clr};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:${clr};flex-shrink:0;">${initials}</div>
    <div style="min-width:0;flex:1;">
      <div style="font-size:11px;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${name.replace(/"/g,'&quot;')}">${name}</div>
      <div style="font-size:10px;color:var(--text-muted);">Score: <b style="color:${clr};">${t.score}</b></div>
    </div>
    <div style="font-size:20px;flex-shrink:0;line-height:1;">${medal}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center;margin-bottom:10px;">
    <div><div style="font-size:17px;font-weight:800;color:#10b981;">${t.resolved}</div><div style="font-size:9px;color:var(--text-muted);">Resueltos</div></div>
    <div><div style="font-size:17px;font-weight:800;color:#3b82f6;">${t.slaPct}%</div><div style="font-size:9px;color:var(--text-muted);">SLA</div></div>
    <div><div style="font-size:17px;font-weight:800;color:#8b5cf6;">${avgH}</div><div style="font-size:9px;color:var(--text-muted);">Prom.</div></div>
  </div>
  <div style="height:4px;background:var(--bg-main);border-radius:4px;overflow:hidden;margin-bottom:${badgeHtml ? '8' : '0'}px;">
    <div style="height:100%;width:${scoreBar}%;background:linear-gradient(90deg,${clr},${clr}88);border-radius:4px;"></div>
  </div>
  ${badgeHtml ? `<div style="display:flex;gap:5px;flex-wrap:wrap;">${badgeHtml}</div>` : ''}
</div>`;
    }).join('');
    section.style.display = 'block';
}

function _execWeekNum(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    return Math.ceil((((d - start) / 86400000) + 1) / 7) + ' (' + year + ')';
}

async function execDownload() {
    if (!window.html2canvas) {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        document.head.appendChild(s);
        await new Promise(r => { s.onload = r; });
    }
    const zone = document.getElementById('execCaptureZone');
    if (!zone) return;
    showToast('Generando imagen…', 'info');
    try {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const canvas = await html2canvas(zone, {
            scale: 2, useCORS: true,
            backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
            onclone(doc) {
                doc.querySelectorAll('.exec-hide-export').forEach(el => el.style.display='none');
            }
        });
        const link = document.createElement('a');
        link.download = 'ejecutivo_' + new Date().toISOString().slice(0,10) + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('PNG descargado — listo para PPT', 'success');
    } catch(e) {
        showToast('Error al exportar: ' + e.message, 'error');
    }
}
