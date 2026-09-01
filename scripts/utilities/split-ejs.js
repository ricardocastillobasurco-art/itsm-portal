const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'views', 'incidencias.ejs');
const lines = fs.readFileSync(file, 'utf8').split('\n');

const panels = [
    { name: 'create', start: 'id="tabCreate"' },
    { name: 'gestion', start: 'id="tabGestion"' },
    { name: 'categorias', start: 'id="tabCategorias"' },
    { name: 'kpis', start: 'id="tabKpis"' },
    { name: 'automaciones', start: 'id="tabAutomaciones"' },
    { name: 'especialistas', start: 'id="tabEspecialistas"' },
    { name: 'admin', start: 'id="tabAdmin"' },
    { name: 'portal', start: 'id="tabPortal"' },
    { name: 'preguntas', start: 'id="tabPreguntas"' },
    { name: 'encuesta', start: 'id="tabEncuesta"' },
    { name: 'whatsapp', start: 'id="tabWhatsapp"' },
    { name: 'kbreqs', start: 'id="tabKbReqs"' },
    { name: 'devoluciones', start: 'id="tabDevoluciones"' },
    { name: 'garantias', start: 'id="tabGarantias"' }
];

for (let p of panels) {
    p.startLine = lines.findIndex(l => l.includes(p.start));
}
panels.sort((a,b) => a.startLine - b.startLine);

const partialsDir = path.join(__dirname, 'views', 'partials', 'incidencias', 'tabs');
fs.mkdirSync(partialsDir, { recursive: true });
const jsDir = path.join(__dirname, 'public', 'js', 'incidencias');
fs.mkdirSync(jsDir, { recursive: true });

const modalsStartLine = lines.findIndex((l, i) => i > panels[panels.length-1].startLine && l.includes('<!-- ══ MODAL'));

for (let i = 0; i < panels.length; i++) {
    const start = panels[i].startLine;
    const end = (i < panels.length - 1) ? panels[i+1].startLine : modalsStartLine;
    const content = lines.slice(start, end).join('\n');
    fs.writeFileSync(path.join(partialsDir, `${panels[i].name}.ejs`), content);
}

const navStartLine = lines.findIndex(l => l.includes('<nav class="corp-tabnav"'));
const navEndLine = panels[0].startLine;
const navContent = lines.slice(navStartLine, navEndLine).join('\n');
fs.writeFileSync(path.join(__dirname, 'views', 'partials', 'incidencias', 'nav-tabs.ejs'), navContent);

// Scripts and Modals
const scriptTagStartLine = lines.findIndex((l, i) => i > modalsStartLine && l.includes('<script>'));

// From modalsStartLine up to where the next non-modal stuff is. 
// Let's say modals content is from modalsStartLine up to line 2367 (where </div> is).
// We'll just look for toast-container-custom
const toastContainerLine = lines.findIndex((l, i) => i > modalsStartLine && l.includes('class="toast-container-custom"'));

// Sometimes there's a </div> before toast container that closes dashboard-content.
let modalsEnd = toastContainerLine > -1 ? toastContainerLine - 1 : scriptTagStartLine;
if (lines[modalsEnd].trim() === '</div>') {
    // </div> belongs to the dashboard-content wrapper. So modals end before it.
    modalsEnd = modalsEnd - 1;
}

const modalsContent = lines.slice(modalsStartLine, modalsEnd + 1).join('\n');
fs.writeFileSync(path.join(__dirname, 'views', 'partials', 'incidencias', 'modals.ejs'), modalsContent);

const scriptEndLine = lines.findIndex((l, i) => i > scriptTagStartLine && l.includes('</script>'));

let appJsLines = [];
let ejsVarsLines = [];

for (let i = scriptTagStartLine + 1; i < scriptEndLine; i++) {
    const line = lines[i];
    if (line.includes('<%-') || line.includes('<%=')) {
        ejsVarsLines.push(line);
    } else {
        appJsLines.push(line);
    }
}

fs.writeFileSync(path.join(jsDir, 'app.js'), appJsLines.join('\n'));

// Reconstruct incidencias.ejs
const topContent = lines.slice(0, navStartLine).join('\n');
// middleContent contains the closing </div> of dashboard-content and the toast container, script tag of bootstrap
const middleContent = lines.slice(modalsEnd + 1, scriptTagStartLine).join('\n');
const bottomContent = lines.slice(scriptEndLine + 1).join('\n');

const newEjs = `${topContent}
<%- include('../partials/incidencias/nav-tabs') %>
<%- include('../partials/incidencias/tabs/create') %>
<% if (_isAdmin || _isEspecialista) { %>
<%- include('../partials/incidencias/tabs/gestion') %>
<% } %>
<% if (_isAdmin || _isEspecialista || _isVisor) { %>
<%- include('../partials/incidencias/tabs/kpis') %>
<% } %>
<% if (_isAdmin || _isEspecialista) { %>
<%- include('../partials/incidencias/tabs/categorias') %>
<% } %>
<% if (_isAdmin) { %>
<%- include('../partials/incidencias/tabs/especialistas') %>
<%- include('../partials/incidencias/tabs/automaciones') %>
<%- include('../partials/incidencias/tabs/admin') %>
<% } %>
<% if (_isAdmin || _isEspecialista) { %>
<%- include('../partials/incidencias/tabs/portal') %>
<%- include('../partials/incidencias/tabs/preguntas') %>
<%- include('../partials/incidencias/tabs/encuesta') %>
<%- include('../partials/incidencias/tabs/whatsapp') %>
<%- include('../partials/incidencias/tabs/kbreqs') %>
<%- include('../partials/incidencias/tabs/devoluciones') %>
<%- include('../partials/incidencias/tabs/garantias') %>
<% } %>

<%- include('../partials/incidencias/modals') %>
${middleContent}
<script>
${ejsVarsLines.join('\n')}
</script>
<script src="/js/incidencias/app.js"></script>
${bottomContent}`;

fs.writeFileSync(file, newEjs);
console.log("File split successfully.");
