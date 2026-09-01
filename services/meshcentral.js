// MeshCentral WebSocket client
// Mantiene una conexión persistente para obtener la lista de dispositivos,
// generar URLs de sesión remota y ejecutar scripts PowerShell en dispositivos
// remotos — todo via WebSocket, sin spawn de procesos externos ni paths locales.
const WebSocket = require('ws');
const logger    = require('../utils/logger');

class MeshCentralService {
    constructor() {
        this._url       = process.env.MESHCENTRAL_URL        || '';
        this._publicUrl = process.env.MESHCENTRAL_PUBLIC_URL || this._url;
        this._user      = process.env.MESHCENTRAL_USER       || '';
        this._pass      = process.env.MESHCENTRAL_PASS       || '';

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

        if (this._url && this._user && this._pass) {
            setTimeout(() => this._connect(), 3000);
        }
    }

    reloadConfig({ url, publicUrl, user, pass }) {
        this._url       = url       || this._url;
        this._publicUrl = publicUrl || url || this._publicUrl;
        this._user      = user      || this._user;
        this._pass      = pass      || this._pass;
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
        };
    }

    _wsUrl() {
        return (this._url || '')
            .replace(/^https/, 'wss')
            .replace(/^http/,  'ws')
            .replace(/\/$/, '') + '/control.ashx';
    }

    _connect() {
        if (this._reconnecting) return;
        try {
            this.ws = new WebSocket(this._wsUrl(), {
                rejectUnauthorized: false,
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
            if (this._reconnecting) return;
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
            rejectUnauthorized: false,
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

    async sessionUrl(nodeId, viewmode = 12) {
        const base = (this._publicUrl || '').replace(/\/$/, '');
        if (!this.connected) throw new Error('MeshCentral no disponible');
        const result = await new Promise((resolve, reject) => {
            this._addPending('createLoginToken', resolve, reject);
            this._send({ action: 'createLoginToken', name: 'platform-session', expire: 60 });
        });
        const nodeHash = nodeId.split('/').filter(s => s.length > 0).pop();
        return `${base}/?logintoken=${encodeURIComponent(result.token)}&node=${nodeHash}&viewmode=${viewmode}&hide=16`;
    }
}

module.exports = new MeshCentralService();
