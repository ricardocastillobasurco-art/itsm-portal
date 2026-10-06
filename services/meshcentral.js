// MeshCentral WebSocket client
// Mantiene una conexión persistente para obtener la lista de dispositivos,
// generar URLs de sesión remota y ejecutar scripts PowerShell en dispositivos
// remotos — todo via WebSocket, sin spawn de procesos externos ni paths locales.
const WebSocket = require('ws');
const logger    = require('../utils/logger');

// El certificado del servidor se verifica siempre (un tercero en el medio podría
// robar la contraseña de la cuenta de servicio). Se acepta un certificado propio
// (autofirmado) solo si MeshCentral está en la red interna o en este equipo, o si
// se fuerza con MESHCENTRAL_ALLOW_SELF_SIGNED=true.
function isPrivateHost(hostname) {
    const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (h === 'localhost' || h === '::1') return true;
    if (require('net').isIPv4(h)) {
        const [a, b] = h.split('.').map(Number);
        return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    }
    return !h.includes('.') && !require('net').isIP(h);   // nombre interno (p. ej. contenedor "meshcentral")
}
function allowSelfSigned(url) {
    if (String(process.env.MESHCENTRAL_ALLOW_SELF_SIGNED || '').toLowerCase() === 'true') return true;
    try { return isPrivateHost(new URL(url).hostname); } catch (_) { return false; }
}
// Vigencia (minutos) del acceso de un solo uso que abre la sesión remota
const SESSION_TOKEN_MINUTES = 5;

class MeshCentralService {
    /**
     * Sin opciones: servidor COMPARTIDO de la plataforma (.env / panel del superadmin).
     * Con opciones: servidor PROPIO de una empresa ({ url, publicUrl, user, pass, loginKey, label }).
     */
    constructor(opts = null) {
        this._label     = opts?.label || 'compartido';
        this._url       = opts ? (opts.url || '') : (process.env.MESHCENTRAL_URL || '');
        this._publicUrl = opts ? (opts.publicUrl || opts.url || '') : (process.env.MESHCENTRAL_PUBLIC_URL || this._url);
        this._user      = opts ? (opts.user || '') : (process.env.MESHCENTRAL_USER || '');
        this._pass      = opts ? (opts.pass || '') : (process.env.MESHCENTRAL_PASS || '');
        // Llave de inicio de sesión (settings.loginCookieEncryptionKey de MeshCentral, 160 hex):
        // permite abrir la sesión remota sin pedir usuario/contraseña.
        this._loginKey  = opts ? (opts.loginKey || '') : (process.env.MESHCENTRAL_LOGIN_KEY || '');
        this._destroyed = false;
        this._responses = new Map();   // responseid → { resolve, timer }

        this.ws            = null;
        this.connected     = false;
        this.meshes        = [];
        this.devices       = [];
        this.devicesExpiry = 0;
        this._pending      = [];
        this._reqSeq       = 0;
        this._reconnecting = false;
        this._chatStore    = new Map();  // nodeId → [{from,msg,ts}]
        this._pendingRec   = null;

        if (opts) {
            if (this._url && this._user && this._pass) setTimeout(() => this._connect(), 200);
            return;
        }
        // Al iniciar: configuración de la BD; si no hay, la del .env
        setTimeout(async () => {
            if (await this.loadFromDb()) return;
            if (this._url && this._user && this._pass) this._connect();
        }, 3000);
    }

    // Cierra la conexión para siempre (servidor propio que se quitó o cambió)
    destroy() {
        this._destroyed = true;
        this._disconnect();
    }

    // Configuración guardada desde el panel (rmm_settings) — tiene prioridad sobre .env.
    // Antes solo se aplicaba al guardar: tras cada reinicio el RMM quedaba desconectado.
    async loadFromDb() {
        try {
            const { executeQuery, equipmentPool } = require('../config/database');
            const { decrypt } = require('../src/utils/secretBox');
            const rows = await executeQuery(equipmentPool,
                'SELECT `key`, value FROM rmm_settings /* tenant_id: configuración global de la plataforma */');
            const m = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
            if (!m.mesh_url) return false;
            let pass = '';
            try { pass = decrypt(m.mesh_pass) || ''; } catch (e) { logger.warn('[MeshCentral] No se pudo leer la contraseña guardada:', e.message); }
            let loginKey = '';
            try { loginKey = decrypt(m.mesh_login_key) || ''; } catch (_) {}
            this.reloadConfig({ url: m.mesh_url, publicUrl: m.mesh_public_url, user: m.mesh_user, pass: pass || undefined, loginKey: loginKey || undefined });
            logger.info('[MeshCentral] Configuración cargada desde la base de datos');
            return true;
        } catch (e) {
            logger.warn('[MeshCentral] Sin configuración en BD:', e.message);
            return false;
        }
    }

    reloadConfig({ url, publicUrl, user, pass, loginKey }) {
        this._url       = url       || this._url;
        this._publicUrl = publicUrl || url || this._publicUrl;
        this._user      = user      || this._user;
        this._pass      = pass      || this._pass;
        this._loginKey  = loginKey  || this._loginKey;
        this._disconnect();
        this.devices = [];
        this.meshes  = [];
        if (this._url && this._user && this._pass) {
            setTimeout(() => this._connect(), 500);
        }
    }

    _disconnect() {
        this._reconnecting = true;
        this.connected = false;
        if (this.ws) {
            try { this.ws.terminate(); } catch {}
            this.ws = null;
        }
        this._reconnecting = false;
    }

    getConfig() {
        return {
            url:       this._url,
            publicUrl: this._publicUrl,
            user:      this._user,
            hasPass:   !!this._pass,
            hasLoginKey: /^[0-9a-f]{160}$/i.test(this._loginKey || ''),
            label:     this._label,
        };
    }

    _wsUrl() {
        return (this._url || '')
            .replace(/^https/, 'wss')
            .replace(/^http/,  'ws')
            .replace(/\/$/, '') + '/control.ashx';
    }

    _connect() {
        if (this._reconnecting || this._destroyed) return;
        try {
            this.ws = new WebSocket(this._wsUrl(), {
                rejectUnauthorized: !allowSelfSigned(this._url),
                handshakeTimeout:   10000,
                headers: {
                    'x-meshauth': Buffer.from(this._user).toString('base64') + ',' + Buffer.from(this._pass).toString('base64'),
                },
            });
        } catch (e) {
            logger.warn('[MeshCentral] Error creando WS:', e.message);
            setTimeout(() => this._connect(), 15000);
            return;
        }

        this.ws.on('open', () => {
            logger.info('[MeshCentral] Conectado');
        });

        this.ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }
            this._handle(msg);
        });

        this.ws.on('close', () => {
            this.connected = false;
            if (this._reconnecting || this._destroyed) return;
            logger.warn('[MeshCentral] Desconectado — reconectando en 10s');
            setTimeout(() => this._connect(), 10000);
        });

        this.ws.on('error', (e) => {
            logger.warn('[MeshCentral] Error WS:', e.message);
        });
    }

    _send(obj) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
            return true;
        }
        return false;
    }

    _handle(msg) {
        // Respuesta a una petición hecha con request()
        if (msg.responseid && this._responses.has(msg.responseid)) {
            const w = this._responses.get(msg.responseid);
            this._responses.delete(msg.responseid);
            clearTimeout(w.timer);
            w.resolve(msg);
        }

        // ── Autenticación via x-meshauth header ────────────────────────────────
        // serverinfo = conexión aceptada, auth ya fue validada en el HTTP upgrade
        if (msg.action === 'serverinfo') {
            this.connected = true;
            logger.info('[MeshCentral] Autenticado');
            this._send({ action: 'meshes' });
        }

        // ── Lista de grupos/meshes ─────────────────────────────────────────────
        if (msg.action === 'meshes') {
            this.meshes = msg.meshes || [];
            logger.info(`[MeshCentral] ${this.meshes.length} mesh(es) cargados`);
            this._fetchAllNodes();
        }

        // ── Nodos (dispositivos) ───────────────────────────────────────────────
        // msg.nodes = { "mesh//...": [nodeObj, ...], ... }
        if (msg.action === 'nodes') {
            const incoming = [];
            for (const [meshKey, nodeArr] of Object.entries(msg.nodes || {})) {
                const arr = Array.isArray(nodeArr) ? nodeArr : [nodeArr];
                for (const n of arr) {
                    incoming.push({
                        nodeId:    n._id,
                        name:      n.name || n.rname || n.host || n._id,
                        host:      n.host || '',
                        os:        n.osdesc || '',
                        ostype:    n.ostype || 0,
                        online:    !!(n.conn & 1),
                        ip:        n.ip   || n.host || '',
                        exip:      n.exip || '',
                        cpu:       n.cpu  || '',
                        ram:       n.ram  || 0,
                        icon:      n.icon || 1,
                        last:      n.agct ? new Date(n.agct).toISOString() : null,
                        meshId:    meshKey,
                    });
                }
            }
            // Merge: reemplaza dispositivos del mismo mesh
            const firstMeshId = incoming[0]?.meshId;
            if (firstMeshId) {
                this.devices = [
                    ...this.devices.filter(d => d.meshId !== firstMeshId),
                    ...incoming,
                ];
            } else {
                this.devices = [...this.devices, ...incoming];
            }
            this.devicesExpiry = Date.now() + 30000;
        }

        // ── Evento de nodo online/offline ──────────────────────────────────────
        if (msg.action === 'nodeconnect') {
            const dev = this.devices.find(d => d.nodeId === msg.nodeid);
            if (dev) dev.online = !!(msg.conn & 1);
        }

        // ── Login token creado ─────────────────────────────────────────────────
        if (msg.action === 'createLoginToken') {
            this._resolvePending('createLoginToken', msg.tokenPass
                ? { ok: true, token: msg.tokenPass }
                : { ok: false, error: 'No token en respuesta' });
        }

        // ── Chat entrante desde dispositivo ────────────────────────────────────
        if ((msg.action === 'msg' || msg.action === 'chat') && msg.type === 'chat') {
            const nid  = msg.nodeid || msg.id || '';
            const text = msg.value  || msg.msg || '';
            if (nid && text) {
                const arr = this._chatStore.get(nid) || [];
                arr.push({ from: 'device', msg: text, ts: Date.now() });
                if (arr.length > 300) arr.shift();
                this._chatStore.set(nid, arr);
            }
        }

        // ── Grabaciones ────────────────────────────────────────────────────────
        if (msg.action === 'recordings') {
            if (this._pendingRec) {
                this._pendingRec({ ok: true, recordings: msg.recordings || [] });
                this._pendingRec = null;
            }
        }

    }

    _fetchAllNodes() {
        this.devices = [];
        for (const mesh of this.meshes) {
            this._send({ action: 'nodes', meshid: mesh._id });
        }
    }

    _addPending(action, resolve, reject) {
        const id = ++this._reqSeq;
        const timer = setTimeout(() => {
            this._pending = this._pending.filter(p => p.id !== id);
            reject(new Error(`MeshCentral timeout (${action})`));
        }, 8000);
        this._pending.push({ id, action, resolve, reject, timer });
        return id;
    }

    _resolvePending(action, result) {
        const idx = this._pending.findIndex(p => p.action === action);
        if (idx === -1) return;
        const [p] = this._pending.splice(idx, 1);
        clearTimeout(p.timer);
        if (result.ok) p.resolve(result);
        else p.reject(new Error(result.error));
    }

    // ── API pública ────────────────────────────────────────────────────────────

    isConnected() { return this.connected; }

    getDevice(nodeId) {
        return this.devices.find(d => d.nodeId === nodeId) || null;
    }

    sendChat(nodeId, msg) {
        this._send({ action: 'msg', nodeid: nodeId, type: 'chat', value: msg });
        const arr = this._chatStore.get(nodeId) || [];
        arr.push({ from: 'tech', msg, ts: Date.now() });
        if (arr.length > 300) arr.shift();
        this._chatStore.set(nodeId, arr);
    }

    getChatMessages(nodeId, since = 0) {
        return (this._chatStore.get(nodeId) || []).filter(m => m.ts > since);
    }

    clearChat(nodeId) {
        this._chatStore.delete(nodeId);
    }

    async getRecordings(nodeId) {
        if (!this.connected) return { ok: true, recordings: [] };
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this._pendingRec = null;
                resolve({ ok: true, recordings: [] });
            }, 5000);
            this._pendingRec = (result) => { clearTimeout(timer); resolve(result); };
            this._send({ action: 'recordings', nodeid: nodeId });
        });
    }

    // Abre una conexión WS dedicada para ejecutar un script PS en el dispositivo.
    // Idéntico a lo que hace meshctrl.js internamente: nueva sesión autenticada
    // → espera serverinfo → envía runcommands type:2 → acumula output → done.
    _openWs() {
        return new WebSocket(this._wsUrl(), {
            rejectUnauthorized: !allowSelfSigned(this._url),
            handshakeTimeout:   12000,
            headers: {
                'x-meshauth': Buffer.from(this._user).toString('base64')
                    + ',' + Buffer.from(this._pass).toString('base64'),
            },
        });
    }

    async runScript(nodeId, psScript, timeoutMs = 90000) {
        // Serializar por dispositivo: solo un PS a la vez.
        // AMSI/AppLocker en C-STFNN-0015 tarda 15-20s por proceso; ejecuciones
        // concurrentes bloquean el agente y devuelven resultados vacíos.
        if (!this._queue) this._queue = new Map();
        const rawId = nodeId.replace(/^node\/\//, '');
        const prev  = this._queue.get(rawId) || Promise.resolve();
        const p     = prev.then(() => this._execScript(rawId, psScript, timeoutMs));
        this._queue.set(rawId, p.catch(() => {}));
        return p;
    }

    _execScript(rawId, psScript, timeoutMs) {
        return new Promise((resolve, reject) => {
            let ws, settled = false, timer;
            // responseid único por ejecución — igual que pylibmeshctrl: 'meshctrl_run_command_N'
            const responseid  = 'meshctrl_' + Date.now();
            const consoleBuf  = [];   // buffer para formato legacy (console streaming)

            const finish = (err, val) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws.terminate(); } catch {}
                err ? reject(err) : resolve(val);
            };

            timer = setTimeout(
                () => finish(new Error(`Timeout: dispositivo no respondió en ${Math.round(timeoutMs / 1000)}s`)),
                timeoutMs
            );

            try { ws = this._openWs(); } catch (e) { return finish(e); }

            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                // Autenticado → enviar comando
                if (msg.action === 'serverinfo') {
                    ws.send(JSON.stringify({
                        action:     'runcommands',
                        nodeids:    ['node//' + rawId],
                        type:       2,          // 2 = PowerShell
                        cmds:       psScript,
                        runAsUser:  0,
                        reply:      true,
                        responseid: responseid,
                    }));
                    return;
                }

                // ── Formato moderno (MeshCentral ≥ 1.0.22) ────────────────────────
                // {action:'msg', type:'runcommands', responseid:'meshctrl_...', result:'...'}
                if (msg.action === 'msg' && msg.type === 'runcommands') {
                    // Si viene con responseid verificar que sea el nuestro
                    if (msg.responseid && msg.responseid !== responseid) return;
                    finish(null, { ok: true, output: (msg.result || '').trim() });
                    return;
                }

                // ── Formato legacy (MeshCentral < 1.0.22) ─────────────────────────
                // Streaming línea a línea via console events, termina con:
                // {action:'msg', type:'console', value:'Run commands completed.'}
                if (msg.action === 'msg' && msg.type === 'console') {
                    // Filtrar por nodo si viene el campo nodeid
                    if (msg.nodeid && !msg.nodeid.includes(rawId)) return;
                    const val = (msg.value || '').trim();
                    if (val.startsWith('Run commands completed')) {
                        finish(null, { ok: true, output: consoleBuf.join('\n') });
                    } else if (val && !val.startsWith('Run commands')) {
                        consoleBuf.push(val);
                    }
                }
            });

            ws.on('error', (e) => finish(e));
            ws.on('close', () => {
                // Si había output parcial en buffer, resolverlo en lugar de rechazar
                if (consoleBuf.length > 0) {
                    finish(null, { ok: true, output: consoleBuf.join('\n') });
                } else {
                    finish(new Error('WebSocket cerrado sin respuesta'));
                }
            });
        });
    }

    // WS dedicado para info de hardware almacenada por el agente.
    async deviceInfo(nodeId) {
        return new Promise((resolve, reject) => {
            let ws, settled = false, timer;

            const finish = (err, val) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { ws.terminate(); } catch {}
                err ? reject(err) : resolve(val);
            };

            timer = setTimeout(() => finish(new Error('Timeout deviceInfo')), 15000);

            try { ws = this._openWs(); } catch (e) { return finish(e); }

            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                if (msg.action === 'serverinfo') {
                    ws.send(JSON.stringify({ action: 'getDeviceDetails', nodeid: nodeId }));
                }

                if (msg.action === 'getDeviceDetails' || msg.action === 'devdetails') {
                    finish(null, { ok: true, data: msg.result || msg });
                }
            });

            ws.on('error', (e) => finish(e));
            ws.on('close', () => finish(new Error('deviceInfo: WS cerrado sin respuesta')));
        });
    }

    async getDevices(force = false) {
        if (!this.connected) {
            return { ok: false, error: 'MeshCentral no disponible' };
        }
        if (!force && Date.now() < this.devicesExpiry) {
            return { ok: true, devices: this.devices };
        }
        // Refrescar
        this._fetchAllNodes();
        await new Promise(r => setTimeout(r, 1800));
        return { ok: true, devices: this.devices };
    }

    // Genera URL de sesión remota para un nodo.
    // Usa MESHCENTRAL_TOKEN (token estático) si está configurado;
    // si no, crea uno dinámico vía WebSocket.
    power(nodeId, action) {
        if (!this.connected) return Promise.reject(new Error('MeshCentral no disponible'));
        const MAP = { sleep: 2, reset: 5, off: 6 };
        const p = MAP[action];
        if (p === undefined) return Promise.reject(new Error('Acción no válida: ' + action));
        const sent = this._send({ action: 'nodepower', nodeids: [nodeId], power: p });
        return sent
            ? Promise.resolve({ ok: true })
            : Promise.reject(new Error('WebSocket no disponible'));
    }

    sendToast(nodeId, title, message) {
        if (!this.connected) return Promise.reject(new Error('MeshCentral no disponible'));
        const sent = this._send({
            action: 'msg',
            type: 'toast',
            nodeids: [nodeId],
            title: title || 'Aviso del administrador',
            msg: message,
        });
        return sent
            ? Promise.resolve({ ok: true })
            : Promise.reject(new Error('WebSocket no disponible'));
    }

    // Petición al servidor con respuesta (MeshCentral devuelve el mismo responseid)
    request(obj, timeoutMs = 10000) {
        if (!this.connected) return Promise.reject(new Error('MeshCentral no disponible'));
        const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this._responses.delete(id); reject(new Error('MeshCentral no respondió')); }, timeoutMs);
            this._responses.set(id, { resolve, timer });
            if (!this._send({ ...obj, responseid: id })) {
                clearTimeout(timer); this._responses.delete(id);
                reject(new Error('MeshCentral no disponible'));
            }
        });
    }

    // Cuenta de MeshCentral de una empresa (solo ve sus grupos). Se crea si no existe.
    // La contraseña es aleatoria y no se guarda: la sesión se abre con la llave de inicio de sesión.
    async ensureUser(username) {
        const pass = require('crypto').randomBytes(24).toString('base64url') + 'aA1!';
        const r = await this.request({ action: 'adduser', username, pass, email: username + '@cuentas.portal', emailVerified: true });
        if (r.result !== 'ok' && !/exist/i.test(r.result || r.msg || '')) throw new Error('No se pudo crear la cuenta ' + username + ': ' + (r.result || r.msg));
        return username;
    }

    // Todos los permisos sobre un grupo de dispositivos (solo ese grupo)
    async grantGroup(username, meshId) {
        const r = await this.request({ action: 'addmeshuser', meshid: meshId, usernames: [username], meshadmin: 0xFFFFFFFF });
        if (!r.success) throw new Error(r.result || 'No se pudo asignar el grupo');
    }

    async revokeGroup(username, meshId) {
        await this.request({ action: 'removemeshuser', meshid: meshId, userid: 'user//' + username }).catch(() => {});
    }

    // Enlace de inicio de sesión de un solo uso, válido pocos minutos (cookie de MeshCentral)
    _loginCookie(username) {
        const crypto = require('crypto');
        const key = Buffer.from(this._loginKey, 'hex');
        const o = { u: 'user//' + String(username).toLowerCase(), a: 3, expire: SESSION_TOKEN_MINUTES,
                    once: crypto.randomBytes(12).toString('base64url'), time: Math.floor(Date.now() / 1000) };
        const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key.subarray(0, 32), iv);
        const enc = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64').replace(/\+/g, '@').replace(/\//g, '$');
    }

    /**
     * URL de la sesión remota. Con llave de inicio de sesión entra directo con la cuenta
     * indicada (la de la empresa: solo ve sus equipos). Sin llave, MeshCentral pide usuario.
     */
    async sessionUrl(nodeId, viewmode = 12, asUser = null) {
        const base = (this._publicUrl || '').replace(/\/$/, '');
        if (/^[0-9a-f]{160}$/i.test(this._loginKey || '')) {
            const nodeHash = nodeId.split('/').filter(x => x.length > 0).pop();
            return base + '/?login=' + encodeURIComponent(this._loginCookie(asUser || this._user)) + '&node=' + nodeHash + '&viewmode=' + viewmode + '&hide=16';
        }
        return this._legacySessionUrl(nodeId, viewmode);
    }

    async _legacySessionUrl(nodeId, viewmode = 12) {
        const base = (this._publicUrl || '').replace(/\/$/, '');
        if (!this.connected) throw new Error('MeshCentral no disponible');
        const result = await new Promise((resolve, reject) => {
            this._addPending('createLoginToken', resolve, reject);
            this._send({ action: 'createLoginToken', name: 'platform-session', expire: SESSION_TOKEN_MINUTES });
        });
        const nodeHash = nodeId.split('/').filter(s => s.length > 0).pop();
        return `${base}/?logintoken=${encodeURIComponent(result.token)}&node=${nodeHash}&viewmode=${viewmode}&hide=16`;
    }
}

module.exports = new MeshCentralService();
module.exports.MeshCentralService = MeshCentralService;
