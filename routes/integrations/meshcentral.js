const express  = require('express');
const router   = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const { executeQuery, equipmentPool } = require('../../config/database');
const meshSvc  = require('../../services/meshcentral');
const logger   = require('../../utils/logger');

router.use(authenticateToken);

// ── Caché compartida con el motor de alertas ──────────────────────────────────
const rmmCache = require('../../services/rmmCache');
function _cacheGet(nodeId, key)       { return rmmCache.get(nodeId, key); }
function _cacheSet(nodeId, key, data) { return rmmCache.set(nodeId, key, data); }
const _devCache = rmmCache._cache; // compatibilidad con clear por nodeId

// Deduplicación: si ya hay un runScript en vuelo para nodeId+key, el siguiente
// comparte la misma Promise en lugar de lanzar un segundo proceso PS paralelo.
// Previene que el segundo PS encuentre el COM objeto bloqueado por el primero.
const _inflight = new Map();
function _runDedup(nodeId, key, fn) {
    const k = nodeId + ':' + key;
    if (_inflight.has(k)) return _inflight.get(k);
    const p = fn().finally(() => _inflight.delete(k));
    _inflight.set(k, p);
    return p;
}

// ── Helper: verificar acceso a nodeId ────────────────────────────────────────
// Middleware factory — inyecta verificación en rutas con nodeId en body o query
function requireNodeAccess(getNodeId) {
    return async (req, res, next) => {
        const nodeId = getNodeId(req);
        if (!nodeId) return next();
        const allowed = await _assertNodeAllowed(nodeId, req.user?.tenant_id).catch(() => true);
        if (!allowed) return res.status(403).json({ ok: false, error: 'Acceso denegado a este dispositivo' });
        next();
    };
}

// ── Multi-tenant: filtrado por MeshGroup ──────────────────────────────────────
// Si el tenant tiene grupos configurados, solo ve los dispositivos de esos grupos.
// Sin grupos configurados → sin filtro (backward-compatible).

const _meshIdCache = new Map(); // tenantId → { ids: Set, ts }
const MESH_CACHE_TTL = 60000;

async function _getMeshIdsForTenant(tenantId) {
    if (!tenantId) return null;
    const cached = _meshIdCache.get(tenantId);
    if (cached && Date.now() - cached.ts < MESH_CACHE_TTL) return cached.ids;
    const rows = await dbQuery('SELECT mesh_id FROM rmm_tenant_groups WHERE tenant_id=?', [tenantId]);
    const ids = rows.length ? new Set(rows.map(r => r.mesh_id)) : null;
    _meshIdCache.set(tenantId, { ids, ts: Date.now() });
    return ids;
}

function _invalidateMeshCache(tenantId) {
    if (tenantId) _meshIdCache.delete(tenantId);
    else _meshIdCache.clear();
}

function _filterDevices(devices, allowedMeshIds) {
    if (!allowedMeshIds) return devices;
    return devices.filter(d => allowedMeshIds.has(d.meshId));
}

async function _getAllowedNodeIds(tenantId) {
    const meshIds = await _getMeshIdsForTenant(tenantId);
    if (!meshIds) return null; // sin restricción
    const result = await meshSvc.getDevices(false);
    const devices = result.ok ? result.devices : [];
    return new Set(devices.filter(d => meshIds.has(d.meshId)).map(d => d.nodeId));
}

async function _assertNodeAllowed(nodeId, tenantId) {
    const allowed = await _getAllowedNodeIds(tenantId);
    if (!allowed) return true; // sin restricción
    return allowed.has(nodeId);
}

// ── Estado y dispositivos ──────────────────────────────────────────────────────

router.get('/status', (req, res) => {
    res.json({
        ok:         true,
        connected:  meshSvc.isConnected(),
        configured: !!(process.env.MESHCENTRAL_URL && process.env.MESHCENTRAL_USER),
        url:        process.env.MESHCENTRAL_PUBLIC_URL || process.env.MESHCENTRAL_URL || '',
        user:       process.env.MESHCENTRAL_USER || '',
    });
});

router.get('/devices', async (req, res) => {
    try {
        const force  = req.query.refresh === '1';
        const result = await meshSvc.getDevices(force);
        if (!result.ok) return res.status(503).json({ ok: false, error: result.error });
        const meshIds = await _getMeshIdsForTenant(req.user?.tenant_id);
        const q = (req.query.q || '').toLowerCase().trim();
        let devices = _filterDevices(result.devices, meshIds);
        if (q) devices = devices.filter(d =>
            (d.name||'').toLowerCase().includes(q) ||
            (d.host||'').toLowerCase().includes(q) ||
            (d.ip  ||'').toLowerCase().includes(q));
        res.json({ ok: true, total: devices.length, devices });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/session', requireNodeAccess(r => r.body.nodeId), async (req, res) => {
    const { nodeId, viewmode } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const url = await meshSvc.sessionUrl(nodeId, viewmode || 12);
        res.json({ ok: true, url });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

// ── Scripts PowerShell para inventario ────────────────────────────────────────

// Sin WMI: registry + PerformanceCounter + Get-NetIPAddress — no se cuelga aunque el servicio WMI esté lento
const PS_SYSTEM = `try{$up=[System.TimeSpan]::FromMilliseconds([System.Environment]::TickCount64);$bt=(Get-Date)-$up;$r=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' -EA Stop;$cpuName='';try{$cpuName=((Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0' -EA Stop).ProcessorNameString -replace '\\s+',' ').Trim()}catch{};$lj='[]';try{$ls=@(Get-NetIPAddress -AddressFamily IPv4 -EA Stop|Where-Object{$_.IPAddress -notmatch '^(127\\.|169\\.254\\.)'}|Select-Object @{N='ip';E={$_.IPAddress}},@{N='if';E={$_.InterfaceAlias}});if($ls.Count -gt 0){$lj=ConvertTo-Json -InputObject @($ls) -Compress -Depth 2}}catch{};$freeMB=0;try{$pc=New-Object System.Diagnostics.PerformanceCounter('Memory','Available MBytes');[void]$pc.NextValue();$freeMB=[int]$pc.NextValue();$pc.Close()}catch{};$totalMB=0;try{$totalMB=[Math]::Round((Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 15).TotalPhysicalMemory/1MB,0)}catch{};$lastPatch='';try{$lpr=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\Results\\Install' -EA Stop;if($lpr.LastSuccessTime){$lastPatch=([DateTime]::Parse($lpr.LastSuccessTime.ToString())).ToString('yyyy-MM-dd')}}catch{};[PSCustomObject]@{lastBoot=$bt.ToString('yyyy-MM-dd HH:mm:ss');uptime=('{0}d {1}h {2}m' -f [int]$up.TotalDays,$up.Hours,$up.Minutes);osName=$r.ProductName;osVersion=($r.DisplayVersion -or $r.ReleaseId);osBuild=$r.CurrentBuildNumber;totalMemMB=$totalMB;freeMemMB=$freeMB;computerName=$env:COMPUTERNAME;cpuName=$cpuName;cpuCores=0;cpuThreads=[System.Environment]::ProcessorCount;cpuSpeedMHz=0;lanIPs=$lj;lastPatch=$lastPatch}|ConvertTo-Json -Compress}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

// Disco: llamada separada, solo discos locales fijos — sin double-quotes para evitar
// problemas de escaping en Windows spawn args
// Get-PSDrive no usa WMI — funciona inmediatamente después del boot
const PS_DISK = `try{$dk=@(Get-PSDrive -PSProvider FileSystem -EA SilentlyContinue|Where-Object{$_.Name -match '^[A-Z]$' -and $_.Used -ne $null -and ($_.Used+$_.Free) -gt 0}|ForEach-Object{$t=[Math]::Round(($_.Used+$_.Free)/1GB,1);$u=[Math]::Round($_.Used/1GB,1);$f=[Math]::Round($_.Free/1GB,1);$p=if($t -gt 0){[Math]::Round($u/$t*100)}else{0};[PSCustomObject]@{d=$_.Name+':';t=$t;u=$u;f=$f;p=$p}});if($dk.Count){$dk|ConvertTo-Json -Compress -Depth 2}else{'[]'}}catch{'[]'}`;

// COM Microsoft.Update.Session — mucho más rápido que Get-HotFix (WMI), no requiere admin
const PS_UPDATES = `try{$s=New-Object -ComObject Microsoft.Update.Session;$q=$s.CreateUpdateSearcher();$cnt=$q.GetTotalHistoryCount();$h=@($q.QueryHistory(0,[Math]::Min($cnt,300))|Where-Object{$_.Title -and $_.Operation -eq 1 -and $_.ResultCode -eq 2}|ForEach-Object{$kb=([regex]::Match($_.Title,'KB\\d+')).Value;if($_.Title -match 'Security|Seguridad|Malicious'){$cat='Seguridad'}elseif($_.Title -match 'Cumulative|Acumulati'){$cat='Acumulativa'}elseif($_.Title -match 'Defender|Malware|Definition|Antivirus'){$cat='Definiciones'}elseif($_.Title -match 'Driver|Controlador'){$cat='Controlador'}elseif($_.Title -match 'Feature|Caracteristica'){$cat='Feature Update'}else{$cat='Actualizacion'};[PSCustomObject]@{id=$kb;desc=$_.Title;date=if($_.Date){$_.Date.ToString('yyyy-MM-dd')}else{''};cat=$cat}});if($h.Count){$h|ConvertTo-Json -Compress -Depth 2}else{'[]'}}catch{'[]'}`;

const PS_HARDWARE = `try{$cpu=Get-WmiObject Win32_Processor|Select-Object -First 1;$mb=Get-WmiObject Win32_BaseBoard;$ram=@(Get-WmiObject Win32_PhysicalMemory|Select-Object @{N='slot';E={$_.BankLabel}},@{N='mfr';E={($_.Manufacturer -replace '\s+','').Trim()}},@{N='part';E={$_.PartNumber.Trim()}},@{N='serial';E={$_.SerialNumber.Trim()}},@{N='gb';E={[Math]::Round($_.Capacity/1GB,1)}},@{N='speed';E={$_.Speed}});$disks=@(Get-WmiObject Win32_DiskDrive|Select-Object @{N='model';E={$_.Model.Trim()}},@{N='serial';E={$_.SerialNumber.Trim()}},@{N='gb';E={[Math]::Round($_.Size/1GB,1)}},@{N='iface';E={$_.InterfaceType}});$mons=@();try{$cm=@{};try{$ct=@{'0'='VGA';'4'='DVI';'10'='HDMI';'11'='Interno';'15'='DisplayPort';'16'='Interno'};Get-WmiObject WmiMonitorConnectionParams -Namespace root\\wmi -EA Stop|ForEach-Object{$cm[($_.InstanceName -split '_')[0]]=if($ct.ContainsKey([string][int]$_.VideoOutputTechnology)){$ct[[string][int]$_.VideoOutputTechnology]}else{''}}}catch{};$mons=@(Get-WmiObject WmiMonitorID -Namespace root\\wmi -EA Stop|ForEach-Object{$mfr=($_.ManufacturerName|Where-Object{$_ -ne 0}|ForEach-Object{[char]$_})-join '';$nm=($_.UserFriendlyName|Where-Object{$_ -ne 0}|ForEach-Object{[char]$_})-join '';$prd=($_.ProductCodeID|Where-Object{$_ -ne 0}|ForEach-Object{[char]$_})-join '';$ser=($_.SerialNumberID|Where-Object{$_ -ne 0}|ForEach-Object{[char]$_})-join '';$k=($_.InstanceName -split '_')[0];$conn=if($cm.ContainsKey($k)){$cm[$k]}else{'';};[PSCustomObject]@{mfr=$mfr;name=$nm;model=$prd;serial=$ser;conn=$conn}})}catch{};[PSCustomObject]@{cpuId=$cpu.ProcessorId.Trim();cpuName=($cpu.Name -replace '\s+',' ').Trim();mbMfr=$mb.Manufacturer.Trim();mbModel=$mb.Product.Trim();mbSerial=$mb.SerialNumber.Trim();ram=$ram;disks=$disks;monitors=$mons}|ConvertTo-Json -Compress -Depth 3}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

// Monitores — exactamente el enfoque ASCII.GetString del usuario, sin cast [byte[]]
const PS_MONITORS = `try{$r=@(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -EA Stop|ForEach-Object{$mfr=([System.Text.Encoding]::ASCII.GetString($_.ManufacturerName)).Trim([char]0);$ser=([System.Text.Encoding]::ASCII.GetString($_.SerialNumberID)).Trim([char]0);$nm=([System.Text.Encoding]::ASCII.GetString($_.UserFriendlyName)).Trim([char]0);[PSCustomObject]@{mfr=$mfr;serial=$ser;name=$nm;conn=''}});if($r.Count){ConvertTo-Json -InputObject @($r) -Compress}else{'[]'}}catch{'[]'}`;

// Pipeline directo — sin $a+=, evita O(n²) de array rebuilding; tipicamente <2s
const PS_APPS = `try{$r=@(@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')|Get-ItemProperty -EA SilentlyContinue|Where-Object{$_.DisplayName}|Select-Object @{N='name';E={$_.DisplayName}},@{N='version';E={($_.DisplayVersion -replace '[^\\x20-\\x7E]','')}},@{N='publisher';E={$_.Publisher}},@{N='date';E={$_.InstallDate}});if($r.Count){$r|Sort-Object name|ConvertTo-Json -Compress -Depth 2}else{'[]'}}catch{'[]'}`;

const PS_PROCESSES = `try{$p=@(Get-Process|Select-Object @{N='name';E={$_.ProcessName}},@{N='pid';E={$_.Id}},@{N='cpu';E={if($_.CPU){[Math]::Round([double]$_.CPU,1)}else{0}}},@{N='mem';E={[Math]::Round($_.WorkingSet64/1MB,1)}});if($p.Count){$p|Sort-Object cpu -Desc|ConvertTo-Json -Compress -Depth 2}else{'[]'}}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

const PS_SERVICES = `try{$s=@(Get-Service|ForEach-Object{$st='';try{$st=$_.StartType.ToString()}catch{};[PSCustomObject]@{name=$_.Name;display=$_.DisplayName;status=$_.Status.ToString();start=$st}});$s|Sort-Object display|ConvertTo-Json -Compress -Depth 2}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

const PS_METRICS = `try{$cpu=0;try{$cpu=[int]((Get-CimInstance Win32_Processor -OperationTimeoutSec 5|Measure-Object LoadPercentage -Average).Average)}catch{};$os=Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 5;$tMB=[Math]::Round($os.TotalVisibleMemorySize/1024,0);$fMB=[Math]::Round($os.FreePhysicalMemory/1024,0);$uMB=$tMB-$fMB;$uPct=if($tMB -gt 0){[int]($uMB/$tMB*100)}else{0};$dk=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -OperationTimeoutSec 5|Select-Object @{N='d';E={$_.DeviceID}},@{N='t';E={[Math]::Round($_.Size/1GB,1)}},@{N='f';E={[Math]::Round($_.FreeSpace/1GB,1)}},@{N='p';E={if($_.Size -gt 0){[int](($_.Size-$_.FreeSpace)/$_.Size*100)}else{0}}});[PSCustomObject]@{cpu=$cpu;totalMB=$tMB;freeMB=$fMB;usedMB=$uMB;usedPct=$uPct;disks=$dk;ts=(Get-Date).ToString('HH:mm:ss')}|ConvertTo-Json -Compress -Depth 3}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

const PS_EVENTLOG = `try{$evts=@(Get-WinEvent -FilterHashtable @{LogName='System','Application';Level=1,2,3} -MaxEvents 300 -EA Stop|Select-Object @{N='t';E={$_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')}},@{N='lvl';E={$_.LevelDisplayName}},@{N='src';E={$_.ProviderName}},@{N='msg';E={$s=($_.Message -split '\n')[0];$s.Substring(0,[Math]::Min($s.Length,280))}});if($evts.Count){$evts|ConvertTo-Json -Compress -Depth 2}else{'[]'}}catch{if($_.Exception.Message -match 'No events'){Write-Output '[]'}else{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}}`;

const PS_TASKS = `try{$t=@(Get-ScheduledTask|Where-Object{$_.TaskPath -notmatch '^\\\\Microsoft\\\\'}|Select-Object @{N='name';E={$_.TaskName}},@{N='path';E={($_.TaskPath).TrimEnd('\\')}},@{N='state';E={$_.State.ToString()}},@{N='lastRun';E={try{if($_.LastRunTime -gt [DateTime]'1900-01-01'){$_.LastRunTime.ToString('yyyy-MM-dd HH:mm')}else{''}}catch{''}}},@{N='nextRun';E={try{if($_.NextRunTime -gt [DateTime]'1900-01-01'){$_.NextRunTime.ToString('yyyy-MM-dd HH:mm')}else{''}}catch{''}}});if($t.Count){$t|Sort-Object name|ConvertTo-Json -Compress -Depth 2}else{'[]'}}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

const PS_LOCALUSERS = `try{$u=@(Get-LocalUser|Select-Object @{N='name';E={$_.Name}},@{N='full';E={$_.FullName}},@{N='enabled';E={[bool]$_.Enabled}},@{N='lastLogon';E={if($_.LastLogon -and $_.LastLogon -gt [DateTime]'1900-01-01'){$_.LastLogon.ToString('yyyy-MM-dd HH:mm')}else{''}}},@{N='desc';E={$_.Description}});$u|Sort-Object name|ConvertTo-Json -Compress -Depth 2}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

const PS_NETWORK = `try{$ad=@(Get-NetAdapter|Where-Object{$_.Status -eq 'Up'}|Select-Object @{N='name';E={$_.Name}},@{N='mac';E={$_.MacAddress}},@{N='speed';E={if($_.LinkSpeed -gt 0){"$([Math]::Round($_.LinkSpeed/1e6,0)) Mbps"}else{''}}});$ip=@(Get-NetIPAddress -AddressFamily IPv4 -EA SilentlyContinue|Where-Object{$_.IPAddress -notmatch '^(127\\.|169\\.254\\.)'}|Select-Object @{N='iface';E={$_.InterfaceAlias}},@{N='ip';E={$_.IPAddress}},@{N='prefix';E={$_.PrefixLength}});$gw=@(Get-NetRoute -AddressFamily IPv4 -EA SilentlyContinue|Where-Object{$_.DestinationPrefix -eq '0.0.0.0/0'}|Select-Object @{N='iface';E={$_.InterfaceAlias}},@{N='gw';E={$_.NextHop}});$dns=@(Get-DnsClientServerAddress -AddressFamily IPv4 -EA SilentlyContinue|Where-Object{$_.ServerAddresses.Count -gt 0}|Select-Object @{N='iface';E={$_.InterfaceAlias}},@{N='servers';E={$_.ServerAddresses -join ', '}});[PSCustomObject]@{adapters=$ad;ips=$ip;gateways=$gw;dns=$dns}|ConvertTo-Json -Compress -Depth 3}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

const PS_HARDWARE_SERIAL = `try{$cs=Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 6;$bios=Get-CimInstance Win32_BIOS -OperationTimeoutSec 6;$mb=Get-CimInstance Win32_BaseBoard -OperationTimeoutSec 6;$sys=[PSCustomObject]@{Manufacturer=$cs.Manufacturer.Trim();'Product Name'=$cs.Model.Trim();Serial=$bios.SerialNumber.Trim()};$moth=[PSCustomObject]@{Name=$mb.Product.Trim();Vendor=$mb.Manufacturer.Trim();Serial=$mb.SerialNumber.Trim()};[PSCustomObject]@{System=$sys;Motherboard=$moth}|ConvertTo-Json -Compress -Depth 3}catch{[PSCustomObject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress}`;

function parseScriptOutput(raw) {
    const text = (raw || '').trim();
    const a = text.indexOf('['), b = text.indexOf('{');
    const start = (a === -1 && b === -1) ? -1
        : (a === -1 ? b : b === -1 ? a : Math.min(a, b));
    if (start === -1) return null;
    return JSON.parse(text.slice(start));
}

router.post('/device/disk', async (req, res) => {
    const { nodeId, refresh } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    logger.info(`[RMM] /device/disk → ${nodeId} refresh=${!!refresh}`);
    if (!refresh) {
        const cached = _cacheGet(nodeId, 'disk');
        if (cached) { logger.info(`[RMM] /device/disk cache hit`); return res.json({ ok: true, ...cached.data, cached: true, cachedAt: cached.cachedAt }); }
    }
    try {
        const diskR = await _runDedup(nodeId, 'disk', () => meshSvc.runScript(nodeId, PS_DISK, 45000));
        logger.info(`[RMM] /device/disk output: ${(diskR?.output||'').slice(0,120)}`);
        let disks = [];
        if (diskR?.output) {
            const p = parseScriptOutput(diskR.output);
            if (Array.isArray(p)) disks = p;
        }
        const validDisks = disks.filter(d => d.t > 0);
        if (validDisks.length) {
            _cacheSet(nodeId, 'disk', { disks: validDisks, physical: [] });
            return res.json({ ok: true, disks: validDisks, physical: [], cached: false });
        }
        logger.info(`[RMM] /device/disk empty result — validDisks=0`);
        const stale = _cacheGet(nodeId, 'disk');
        if (stale) return res.json({ ok: true, ...stale.data, cached: true, cachedAt: stale.cachedAt, warn: 'Datos en caché (script retornó vacío)' });
        res.json({ ok: true, disks: [], physical: [], cached: false });
    } catch (e) {
        logger.warn(`[RMM] /device/disk error: ${e.message}`);
        const cached = _cacheGet(nodeId, 'disk');
        if (cached) return res.json({ ok: true, ...cached.data, cached: true, cachedAt: cached.cachedAt });
        res.json({ ok: true, disks: [], physical: [], scriptUnavailable: true, warn: e.message });
    }
});

router.post('/device/system', async (req, res) => {
    const { nodeId, refresh } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const node = meshSvc.getDevice(nodeId) || {};

        const osRaw    = node.os || '';
        const osParts  = osRaw.split(' - ');
        const osName   = osParts[0] || osRaw;
        const osVer    = osParts[1] || '';
        const osBuild  = (osVer.match(/(\d+)$/) || [])[1] || '';
        const lanIPs   = node.ip ? [{ ip: node.ip, if: 'LAN' }] : [];

        let lastBoot = '', uptime = '';
        if (node.last) {
            const agctDate = new Date(node.last);
            lastBoot = agctDate.toISOString().slice(0, 19).replace('T', ' ');
            const secs = Math.floor((Date.now() - agctDate.getTime()) / 1000);
            uptime = Math.floor(secs/86400) + 'd ' + Math.floor((secs%86400)/3600) + 'h ' + Math.floor((secs%3600)/60) + 'm';
        }

        // Datos de node.* disponibles instantáneamente (sin script)
        let cpuName = node.cpu || '', totalMemMB = node.ram || 0, freeMemMB = 0, cpuThreads = 0, lastPatch = '';

        // Caché de script (CPU detallada, RAM precisa, IPs, último parche)
        const cached = _cacheGet(nodeId, 'system');
        if (cached) {
            cpuName    = cached.data.cpuName    || cpuName;
            totalMemMB = cached.data.totalMemMB || totalMemMB;
            freeMemMB  = cached.data.freeMemMB  || 0;
            cpuThreads = cached.data.cpuThreads || 0;
            lastPatch  = cached.data.lastPatch  || '';
        }

        // Responder inmediatamente con lo que tenemos
        res.json({ ok: true, data: {
            osName, osVersion: osVer, osBuild,
            totalMemMB, freeMemMB,
            computerName: node.name || '',
            cpuName, cpuCores: 0, cpuThreads, cpuSpeedMHz: 0,
            lanIPs: JSON.stringify(lanIPs),
            lastBoot, uptime, lastPatch,
        }, cached: !!cached, cachedAt: cached?.cachedAt });

        // Sin caché o refresh manual: correr PS_SYSTEM en background con 2s de delay
        // para que el script de disco (PS_DISK) se encole primero y no quede bloqueado
        if (!cached || refresh) {
            setTimeout(() => {
                _runDedup(nodeId, 'system', () => meshSvc.runScript(nodeId, PS_SYSTEM, 60000))
                    .then(r => {
                        const d = parseScriptOutput(r.output);
                        if (d && !d.error) {
                            _cacheSet(nodeId, 'system', {
                                cpuName:    d.cpuName    || cpuName,
                                totalMemMB: d.totalMemMB || totalMemMB,
                                freeMemMB:  d.freeMemMB  || 0,
                                cpuThreads: d.cpuThreads || 0,
                                lastPatch:  d.lastPatch  || '',
                            });
                        }
                    })
                    .catch(() => {});
            }, refresh ? 0 : 2000);
        }
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/updates', async (req, res) => {
    const { nodeId, refresh } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    if (!refresh) {
        const cached = _cacheGet(nodeId, 'updates');
        if (cached) return res.json({ ok: true, total: cached.data.length, updates: cached.data, cached: true, cachedAt: cached.cachedAt });
    }
    try {
        const result  = await _runDedup(nodeId, 'updates', () => meshSvc.runScript(nodeId, PS_UPDATES, 60000));
        const parsed  = parseScriptOutput(result.output);
        if (parsed?.error) { const stale2 = _cacheGet(nodeId, 'updates'); return stale2 ? res.json({ ok: true, total: stale2.data.length, updates: stale2.data, cached: true, cachedAt: stale2.cachedAt }) : res.json({ ok: true, total: 0, updates: [], scriptUnavailable: true, warn: parsed.error }); }
        const updates = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        if (updates.length) {
            _cacheSet(nodeId, 'updates', updates);
            return res.json({ ok: true, total: updates.length, updates, cached: false });
        }
        // Script corrió pero devolvió vacío (PS bloqueado o COM no disponible) → usar caché si existe
        const stale = _cacheGet(nodeId, 'updates');
        if (stale) return res.json({ ok: true, total: stale.data.length, updates: stale.data, cached: true, cachedAt: stale.cachedAt, warn: 'Datos en caché (script retornó vacío)' });
        res.json({ ok: true, total: 0, updates: [], cached: false });
    } catch (e) {
        const cached = _cacheGet(nodeId, 'updates');
        if (cached) return res.json({ ok: true, total: cached.data.length, updates: cached.data, cached: true, cachedAt: cached.cachedAt });
        res.json({ ok: true, total: 0, updates: [], scriptUnavailable: true, warn: e.message });
    }
});

router.post('/device/hardware', async (req, res) => {
    const { nodeId, refresh } = req.body;
    if (!nodeId) return res.json({ ok: true, data: {} });
    if (!refresh) {
        const cached = _cacheGet(nodeId, 'hardware');
        if (cached) return res.json({ ok: true, data: cached.data, cached: true, cachedAt: cached.cachedAt });
    }
    try {
        const r = await _runDedup(nodeId, 'hardware', () => meshSvc.runScript(nodeId, PS_HARDWARE_SERIAL, 45000));
        const d = parseScriptOutput(r.output);
        if (d && !d.error) {
            _cacheSet(nodeId, 'hardware', d);
            return res.json({ ok: true, data: d, cached: false });
        }
    } catch {}
    const stale = _cacheGet(nodeId, 'hardware');
    if (stale) return res.json({ ok: true, data: stale.data, cached: true, cachedAt: stale.cachedAt });
    res.json({ ok: true, data: {} });
});

router.post('/device/monitors', async (req, res) => {
    const { nodeId, refresh } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    if (!refresh) {
        const cached = _cacheGet(nodeId, 'monitors');
        if (cached) return res.json({ ok: true, monitors: cached.data, cached: true, cachedAt: cached.cachedAt });
    }
    try {
        const result = await _runDedup(nodeId, 'monitors', () => meshSvc.runScript(nodeId, PS_MONITORS, 45000));
        const parsed = parseScriptOutput(result.output);
        const monitors = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        if (monitors.length) {
            _cacheSet(nodeId, 'monitors', monitors);
            return res.json({ ok: true, monitors, cached: false });
        }
        const stale = _cacheGet(nodeId, 'monitors');
        if (stale) return res.json({ ok: true, monitors: stale.data, cached: true, cachedAt: stale.cachedAt, warn: 'Datos en caché (script retornó vacío)' });
        res.json({ ok: true, monitors: [], cached: false });
    } catch (e) {
        const cached = _cacheGet(nodeId, 'monitors');
        if (cached) return res.json({ ok: true, monitors: cached.data, cached: true, cachedAt: cached.cachedAt, warn: 'Usando datos en caché: ' + e.message });
        res.json({ ok: true, monitors: [], warn: e.message });
    }
});

router.post('/device/apps', async (req, res) => {
    const { nodeId, refresh } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    if (!refresh) {
        const cached = _cacheGet(nodeId, 'apps');
        if (cached) return res.json({ ok: true, total: cached.data.length, apps: cached.data, cached: true, cachedAt: cached.cachedAt });
    }
    try {
        const result = await _runDedup(nodeId, 'apps', () => meshSvc.runScript(nodeId, PS_APPS, 60000));
        const parsed = parseScriptOutput(result.output);
        if (parsed?.error) { const stale2 = _cacheGet(nodeId, 'apps'); return stale2 ? res.json({ ok: true, total: stale2.data.length, apps: stale2.data, cached: true, cachedAt: stale2.cachedAt }) : res.json({ ok: true, total: 0, apps: [], scriptUnavailable: true, warn: parsed.error }); }
        const apps = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        if (apps.length) {
            _cacheSet(nodeId, 'apps', apps);
            return res.json({ ok: true, total: apps.length, apps, cached: false });
        }
        const stale = _cacheGet(nodeId, 'apps');
        if (stale) return res.json({ ok: true, total: stale.data.length, apps: stale.data, cached: true, cachedAt: stale.cachedAt, warn: 'Datos en caché (script retornó vacío)' });
        res.json({ ok: true, total: 0, apps: [], cached: false });
    } catch (e) {
        const cached = _cacheGet(nodeId, 'apps');
        if (cached) return res.json({ ok: true, total: cached.data.length, apps: cached.data, cached: true, cachedAt: cached.cachedAt });
        res.json({ ok: true, total: 0, apps: [], scriptUnavailable: true, warn: e.message });
    }
});

// Limpia caché de un dispositivo (para forzar re-fetch desde el cliente)
router.post('/device/cache/clear', (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    ['monitors', 'disk', 'updates', 'apps'].forEach(k => _devCache.delete(nodeId + ':' + k));
    res.json({ ok: true });
});

// ── Colecciones de scripts ────────────────────────────────────────────────────

// Nota: executeQuery() devuelve directamente el array de rows (no [rows, meta])
// Para INSERT/UPDATE/DELETE, Sequelize con QueryTypes.RAW devuelve el OkPacket
// accesible en results[0] cuando se usa sequelize.query directamente.
// Usamos equipmentPool.query() que sí devuelve [results, metadata].

async function dbQuery(sql, params = []) {
    const [results] = await equipmentPool.query(sql, params);
    return results;
}

router.get('/scripts/collections', async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT c.*, COUNT(s.id) AS script_count
             FROM rmm_script_collections c
             LEFT JOIN rmm_scripts s ON s.collection_id = c.id
             GROUP BY c.id ORDER BY c.sort_order, c.name`
        );
        res.json({ ok: true, collections: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/scripts/collections', async (req, res) => {
    const { name, description, icon, sort_order } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name requerido' });
    try {
        const result = await dbQuery(
            'INSERT INTO rmm_script_collections (name,description,icon,sort_order) VALUES (?,?,?,?)',
            [name, description||null, icon||'bi-collection', sort_order||0]
        );
        res.json({ ok: true, id: result.insertId });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.put('/scripts/collections/:id', async (req, res) => {
    const { name, description, icon, sort_order } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'name requerido' });
    try {
        await dbQuery(
            'UPDATE rmm_script_collections SET name=?,description=?,icon=?,sort_order=? WHERE id=?',
            [name, description||null, icon||'bi-collection', sort_order||0, req.params.id]
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.delete('/scripts/collections/:id', async (req, res) => {
    try {
        await dbQuery('DELETE FROM rmm_script_collections WHERE id=?', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── Scripts individuales ──────────────────────────────────────────────────────

router.get('/scripts', async (req, res) => {
    try {
        const where  = req.query.collection_id ? 'WHERE s.collection_id=?' : '';
        const params = req.query.collection_id ? [req.query.collection_id] : [];
        const rows = await dbQuery(
            `SELECT s.id, s.collection_id, s.name, s.description, s.code,
                    c.name AS collection_name, c.icon AS collection_icon
             FROM rmm_scripts s
             JOIN rmm_script_collections c ON c.id = s.collection_id
             ${where}
             ORDER BY c.sort_order, c.name, s.name`,
            params
        );
        res.json({ ok: true, scripts: rows });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/scripts', async (req, res) => {
    const { collection_id, name, description, code } = req.body;
    if (!collection_id || !name || !code)
        return res.status(400).json({ ok: false, error: 'collection_id, name y code son requeridos' });
    try {
        const result = await dbQuery(
            'INSERT INTO rmm_scripts (collection_id,name,description,code) VALUES (?,?,?,?)',
            [collection_id, name, description||null, code]
        );
        res.json({ ok: true, id: result.insertId });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.put('/scripts/:id', async (req, res) => {
    const { collection_id, name, description, code } = req.body;
    if (!collection_id || !name || !code)
        return res.status(400).json({ ok: false, error: 'collection_id, name y code son requeridos' });
    try {
        await dbQuery(
            'UPDATE rmm_scripts SET collection_id=?,name=?,description=?,code=? WHERE id=?',
            [collection_id, name, description||null, code, req.params.id]
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.delete('/scripts/:id', async (req, res) => {
    try {
        await dbQuery('DELETE FROM rmm_scripts WHERE id=?', [req.params.id]);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── Ejecutar script por ID en un dispositivo ──────────────────────────────────

router.post('/device/run', async (req, res) => {
    const { nodeId, scriptId, customCode } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    if (!scriptId && !customCode)
        return res.status(400).json({ ok: false, error: 'scriptId o customCode requerido' });
    try {
        let code, scriptName;
        if (customCode) {
            code       = customCode;
            scriptName = 'Comando personalizado';
        } else {
            const rows = await dbQuery('SELECT * FROM rmm_scripts WHERE id=?', [scriptId]);
            if (!rows.length) return res.status(404).json({ ok: false, error: 'Script no encontrado' });
            code       = rows[0].code;
            scriptName = rows[0].name;
        }
        const result = await meshSvc.runScript(nodeId, code, 120000);
        res.json({ ok: true, output: result.output, scriptName });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/processes', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_PROCESSES, 30000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        const processes = Array.isArray(d) ? d : (d ? [d] : []);
        res.json({ ok: true, total: processes.length, processes });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/process/kill', async (req, res) => {
    const { nodeId, pid } = req.body;
    const pidNum = parseInt(pid, 10);
    if (!nodeId || !Number.isInteger(pidNum) || pidNum <= 0)
        return res.status(400).json({ ok: false, error: 'nodeId y pid (entero) requeridos' });
    try {
        const r = await meshSvc.runScript(nodeId, `try{Stop-Process -Id ${pidNum} -Force -ErrorAction Stop;'ok'}catch{$_.Exception.Message}`, 15000);
        res.json({ ok: true, output: (r.output||'').trim() });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/services', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_SERVICES, 30000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        const services = Array.isArray(d) ? d : (d ? [d] : []);
        res.json({ ok: true, total: services.length, services });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/service/action', async (req, res) => {
    const { nodeId, name, action } = req.body;
    if (!nodeId || !name || !['start','stop','restart'].includes(action))
        return res.status(400).json({ ok: false, error: 'nodeId, name y action (start/stop/restart) requeridos' });
    if (!/^[\w\-. ]+$/.test(name))
        return res.status(400).json({ ok: false, error: 'Nombre de servicio no válido' });
    const cmdMap = { start: 'Start-Service', stop: 'Stop-Service', restart: 'Restart-Service' };
    try {
        const r = await meshSvc.runScript(nodeId, `try{${cmdMap[action]} -Name '${name}' -ErrorAction Stop;'ok'}catch{$_.Exception.Message}`, 30000);
        res.json({ ok: true, output: (r.output||'').trim() });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/metrics', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_METRICS, 25000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        res.json({ ok: true, metrics: d });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/eventlog', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_EVENTLOG, 45000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        const events = Array.isArray(d) ? d : [];
        res.json({ ok: true, total: events.length, events });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/power', async (req, res) => {
    const { nodeId, action } = req.body;
    if (!nodeId || !['sleep', 'reset', 'off'].includes(action))
        return res.status(400).json({ ok: false, error: 'nodeId y action (sleep/reset/off) requeridos' });
    try {
        await meshSvc.power(nodeId, action);
        res.json({ ok: true });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/toast', async (req, res) => {
    const { nodeId, title, message } = req.body;
    if (!nodeId || !message)
        return res.status(400).json({ ok: false, error: 'nodeId y message requeridos' });
    try {
        await meshSvc.sendToast(nodeId, title, message);
        res.json({ ok: true });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/tasks', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_TASKS, 30000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        const tasks = Array.isArray(d) ? d : (d ? [d] : []);
        res.json({ ok: true, total: tasks.length, tasks });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/task/run', async (req, res) => {
    const { nodeId, name } = req.body;
    if (!nodeId || !name)
        return res.status(400).json({ ok: false, error: 'nodeId y name requeridos' });
    if (!/^[\w\-. ]+$/.test(name))
        return res.status(400).json({ ok: false, error: 'Nombre de tarea no válido' });
    try {
        const r = await meshSvc.runScript(nodeId, `try{Start-ScheduledTask -TaskName '${name}' -EA Stop;'ok'}catch{$_.Exception.Message}`, 15000);
        res.json({ ok: true, output: (r.output || '').trim() });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/users', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_LOCALUSERS, 20000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        const users = Array.isArray(d) ? d : (d ? [d] : []);
        res.json({ ok: true, total: users.length, users });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/user/action', async (req, res) => {
    const { nodeId, name, action } = req.body;
    if (!nodeId || !name || !['enable', 'disable'].includes(action))
        return res.status(400).json({ ok: false, error: 'nodeId, name y action (enable/disable) requeridos' });
    if (!/^[\w\-. ]+$/.test(name))
        return res.status(400).json({ ok: false, error: 'Nombre de usuario no válido' });
    const cmd = action === 'enable'
        ? `Enable-LocalUser -Name '${name}' -EA Stop;'ok'`
        : `Disable-LocalUser -Name '${name}' -EA Stop;'ok'`;
    try {
        const r = await meshSvc.runScript(nodeId, `try{${cmd}}catch{$_.Exception.Message}`, 15000);
        res.json({ ok: true, output: (r.output || '').trim() });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

router.post('/device/network', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, PS_NETWORK, 20000);
        const d = parseScriptOutput(r.output);
        if (d?.error) return res.status(500).json({ ok: false, error: d.error });
        res.json({ ok: true, network: d });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

// ── Explorador de archivos remoto ─────────────────────────────────────────────

function psFilesList(path) {
    const p = path.replace(/'/g, "''");
    return [
        `$p='${p}'`,
        `try{`,
        `$items=Get-ChildItem -Path $p -Force -EA Stop|Sort-Object {-not $_.PSIsContainer},$_.Name`,
        `$parent=if($p.TrimEnd('\\\\').Length -le 2){$null}else{Split-Path $p.TrimEnd('\\\\') -Parent 2>$null}`,
        `$r=@{ok=1;path=$p;parent=$parent;items=@($items|%{@{n=$_.Name;d=[int]$_.PSIsContainer;s=if($_.PSIsContainer){-1}else{$_.Length};m=$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')}})}`,
        `$r|ConvertTo-Json -Compress -Depth 4`,
        `}catch{@{ok=0;error=$_.Exception.Message}|ConvertTo-Json -Compress}`,
    ].join(';');
}

function psFilesRead(path) {
    const p = path.replace(/'/g, "''");
    return [
        `$p='${p}'`,
        `try{`,
        `$bytes=[System.IO.File]::ReadAllBytes($p)`,
        `if($bytes.Length -gt 5242880){@{ok=0;error='Archivo mayor a 5 MB'}|ConvertTo-Json -Compress;return}`,
        `$b64=[Convert]::ToBase64String($bytes)`,
        `$nm=[System.IO.Path]::GetFileName($p)`,
        `@{ok=1;name=$nm;content=$b64;size=$bytes.Length}|ConvertTo-Json -Compress`,
        `}catch{@{ok=0;error=$_.Exception.Message}|ConvertTo-Json -Compress}`,
    ].join(';');
}

function psFilesDelete(path) {
    const p = path.replace(/'/g, "''");
    return `try{Remove-Item -Path '${p}' -Recurse -Force -EA Stop;@{ok=1}|ConvertTo-Json -Compress}catch{@{ok=0;error=$_.Exception.Message}|ConvertTo-Json -Compress}`;
}

function psFilesMkdir(path) {
    const p = path.replace(/'/g, "''");
    return `try{New-Item -ItemType Directory -Path '${p}' -Force -EA Stop|Out-Null;@{ok=1}|ConvertTo-Json -Compress}catch{@{ok=0;error=$_.Exception.Message}|ConvertTo-Json -Compress}`;
}

function psFilesWrite(path, b64) {
    const p = path.replace(/'/g, "''");
    return [
        `$p='${p}'`,
        `$b64='${b64}'`,
        `try{`,
        `$bytes=[Convert]::FromBase64String($b64)`,
        `[System.IO.File]::WriteAllBytes($p,$bytes)`,
        `@{ok=1;size=$bytes.Length}|ConvertTo-Json -Compress`,
        `}catch{@{ok=0;error=$_.Exception.Message}|ConvertTo-Json -Compress}`,
    ].join(';');
}

router.post('/device/files', async (req, res) => {
    const { nodeId, path = 'C:\\' } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const r = await meshSvc.runScript(nodeId, psFilesList(path), 20000);
        const d = parseScriptOutput(r.output);
        if (!d || d.error) return res.status(500).json({ ok: false, error: d?.error || 'Sin respuesta' });
        res.json({ ok: true, path: d.path, parent: d.parent, items: d.items || [] });
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

router.post('/device/files/read', async (req, res) => {
    const { nodeId, path } = req.body;
    if (!nodeId || !path) return res.status(400).json({ ok: false, error: 'nodeId y path requeridos' });
    try {
        const r = await meshSvc.runScript(nodeId, psFilesRead(path), 30000);
        const d = parseScriptOutput(r.output);
        if (!d || !d.ok) return res.status(500).json({ ok: false, error: d?.error || 'No se pudo leer el archivo' });
        res.json({ ok: true, name: d.name, content: d.content, size: d.size });
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

router.post('/device/files/delete', async (req, res) => {
    const { nodeId, path } = req.body;
    if (!nodeId || !path) return res.status(400).json({ ok: false, error: 'nodeId y path requeridos' });
    try {
        const r = await meshSvc.runScript(nodeId, psFilesDelete(path), 15000);
        const d = parseScriptOutput(r.output);
        if (!d || !d.ok) return res.status(500).json({ ok: false, error: d?.error || 'Error al eliminar' });
        res.json({ ok: true });
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

router.post('/device/files/mkdir', async (req, res) => {
    const { nodeId, path } = req.body;
    if (!nodeId || !path) return res.status(400).json({ ok: false, error: 'nodeId y path requeridos' });
    try {
        const r = await meshSvc.runScript(nodeId, psFilesMkdir(path), 10000);
        const d = parseScriptOutput(r.output);
        if (!d || !d.ok) return res.status(500).json({ ok: false, error: d?.error || 'Error al crear carpeta' });
        res.json({ ok: true });
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

router.post('/device/files/write', async (req, res) => {
    const { nodeId, path, content } = req.body;
    if (!nodeId || !path || !content) return res.status(400).json({ ok: false, error: 'nodeId, path y content requeridos' });
    if (content.length > 3500000) return res.status(413).json({ ok: false, error: 'Archivo demasiado grande (máx 2.5 MB)' });
    try {
        const r = await meshSvc.runScript(nodeId, psFilesWrite(path, content), 20000);
        const d = parseScriptOutput(r.output);
        if (!d || !d.ok) return res.status(500).json({ ok: false, error: d?.error || 'Error al escribir archivo' });
        res.json({ ok: true, size: d.size });
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

// ── Chat bidireccional ────────────────────────────────────────────────────────

router.post('/device/chat/send', (req, res) => {
    const { nodeId, msg } = req.body;
    if (!nodeId || !msg) return res.status(400).json({ ok: false, error: 'nodeId y msg requeridos' });
    try {
        meshSvc.sendChat(nodeId, msg);
        res.json({ ok: true });
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

router.get('/device/chat/messages', (req, res) => {
    const { nodeId, since } = req.query;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    const msgs = meshSvc.getChatMessages(nodeId, parseInt(since || '0', 10));
    res.json({ ok: true, messages: msgs });
});

router.delete('/device/chat', (req, res) => {
    const { nodeId } = req.body;
    if (nodeId) meshSvc.clearChat(nodeId);
    res.json({ ok: true });
});

// ── Grabaciones de sesiones ───────────────────────────────────────────────────

router.post('/device/recordings', async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });
    try {
        const result = await meshSvc.getRecordings(nodeId);
        if (!result.recordings?.length) {
            const cfg = meshSvc.getConfig();
            const base = (cfg.publicUrl || cfg.url || '').replace(/\/$/, '');
            result.meshUrl = base ? `${base}/` : null;
        }
        res.json(result);
    } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

// ── Configuración RMM ─────────────────────────────────────────────────────────

router.get('/config', async (req, res) => {
    try {
        const rows = await dbQuery('SELECT `key`, value, label, is_secret FROM rmm_settings ORDER BY `key`');
        const settings = {};
        for (const r of rows) {
            settings[r.key] = {
                value:     r.is_secret && r.value ? '••••••••' : (r.value || ''),
                label:     r.label,
                is_secret: !!r.is_secret,
                hasValue:  !!r.value,
            };
        }
        const current = meshSvc.getConfig();
        res.json({ ok: true, settings, connected: meshSvc.isConnected(), current });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.put('/config', async (req, res) => {
    const { mesh_url, mesh_public_url, mesh_user, mesh_pass } = req.body;
    try {
        const updates = [
            ['mesh_url',        mesh_url        ?? null],
            ['mesh_public_url', mesh_public_url ?? null],
            ['mesh_user',       mesh_user       ?? null],
        ];
        for (const [k, v] of updates) {
            await dbQuery(
                'INSERT INTO rmm_settings (`key`, value, updated_at) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=NOW()',
                [k, v || null]
            );
        }
        if (mesh_pass !== undefined && mesh_pass !== '••••••••') {
            await dbQuery(
                'INSERT INTO rmm_settings (`key`, value, updated_at) VALUES (?,?,NOW()) ON DUPLICATE KEY UPDATE value=VALUES(value), updated_at=NOW()',
                ['mesh_pass', mesh_pass || null]
            );
        }
        const cfg = await dbQuery('SELECT `key`, value FROM rmm_settings');
        const m = {};
        for (const r of cfg) m[r.key] = r.value || '';
        meshSvc.reloadConfig({
            url:       m.mesh_url,
            publicUrl: m.mesh_public_url,
            user:      m.mesh_user,
            pass:      mesh_pass !== undefined && mesh_pass !== '••••••••' ? mesh_pass : undefined,
        });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── Alertas RMM ──────────────────────────────────────────────────────────────
const { getAlertStats } = require('../../services/alertEngine');

router.get('/alerts', async (req, res) => {
    const { status = 'open', limit = 50, nodeId } = req.query;
    try {
        const lim = Math.min(parseInt(limit) || 50, 200);
        const allowedIds = await _getAllowedNodeIds(req.user?.tenant_id);
        let rows;
        if (nodeId) {
            if (allowedIds && !allowedIds.has(nodeId)) return res.json({ ok: true, alerts: [], stats: {} });
            rows = await dbQuery('SELECT * FROM rmm_alerts WHERE node_id=? AND status=? ORDER BY fired_at DESC LIMIT ?', [nodeId, status, lim]);
        } else if (allowedIds) {
            if (!allowedIds.size) return res.json({ ok: true, alerts: [], stats: {} });
            const ph = [...allowedIds].map(() => '?').join(',');
            rows = await dbQuery(`SELECT * FROM rmm_alerts WHERE node_id IN (${ph}) AND status=? ORDER BY fired_at DESC LIMIT ?`, [...allowedIds, status, lim]);
        } else {
            rows = await dbQuery('SELECT * FROM rmm_alerts WHERE status=? ORDER BY fired_at DESC LIMIT ?', [status, lim]);
        }
        const stats = await getAlertStats(allowedIds);
        res.json({ ok: true, alerts: rows, stats });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/alerts/stats', async (req, res) => {
    try {
        const allowedIds = await _getAllowedNodeIds(req.user?.tenant_id);
        res.json({ ok: true, ...(await getAlertStats(allowedIds)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/alerts/:id/ack', async (req, res) => {
    try {
        await dbQuery("UPDATE rmm_alerts SET status='acknowledged', ack_by=? WHERE id=?",
            [req.user?.email || 'admin', req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/alerts/:id/resolve', async (req, res) => {
    try {
        await dbQuery("UPDATE rmm_alerts SET status='resolved', resolved_at=NOW() WHERE id=?", [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/alert-rules', async (req, res) => {
    try { res.json({ ok: true, rules: await dbQuery('SELECT * FROM rmm_alert_rules ORDER BY severity DESC, name') }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/alert-rules', async (req, res) => {
    const { name, metric, operator, threshold, param, severity, auto_ticket } = req.body;
    if (!name || !metric) return res.status(400).json({ ok: false, error: 'name y metric requeridos' });
    try {
        const [r] = await dbQuery(
            'INSERT INTO rmm_alert_rules (name, metric, operator, threshold, param, severity, auto_ticket) VALUES (?,?,?,?,?,?,?)',
            [name, metric, operator||'gt', threshold||null, param||null, severity||'warning', auto_ticket?1:0]
        );
        res.json({ ok: true, id: r.insertId });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/alert-rules/:id', async (req, res) => {
    const { name, metric, operator, threshold, param, severity, auto_ticket, enabled } = req.body;
    try {
        await dbQuery(
            'UPDATE rmm_alert_rules SET name=?,metric=?,operator=?,threshold=?,param=?,severity=?,auto_ticket=?,enabled=? WHERE id=?',
            [name, metric, operator||'gt', threshold||null, param||null, severity||'warning', auto_ticket?1:0, enabled===false?0:1, req.params.id]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/alert-rules/:id', async (req, res) => {
    try {
        await dbQuery('DELETE FROM rmm_alert_rules WHERE id=?', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Catálogo de software ──────────────────────────────────────────────────────

router.get('/software/catalog', async (req, res) => {
    try {
        const rows = await dbQuery('SELECT * FROM rmm_software_catalog ORDER BY category, name');
        res.json({ ok: true, apps: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/software/catalog', async (req, res) => {
    const { name, version, description, url, sha256, type, silent_args, category } = req.body;
    if (!name || !url) return res.status(400).json({ ok: false, error: 'name y url requeridos' });
    try {
        const [r] = await dbQuery(
            'INSERT INTO rmm_software_catalog (name, version, description, url, sha256, type, silent_args, category) VALUES (?,?,?,?,?,?,?,?)',
            [name, version||null, description||null, url, sha256||null, type||'exe', silent_args||null, category||'General']
        );
        res.json({ ok: true, id: r.insertId });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/software/catalog/:id', async (req, res) => {
    const { name, version, description, url, sha256, type, silent_args, category } = req.body;
    if (!name || !url) return res.status(400).json({ ok: false, error: 'name y url requeridos' });
    try {
        await dbQuery(
            'UPDATE rmm_software_catalog SET name=?,version=?,description=?,url=?,sha256=?,type=?,silent_args=?,category=?,updated_at=NOW() WHERE id=?',
            [name, version||null, description||null, url, sha256||null, type||'exe', silent_args||null, category||'General', req.params.id]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/software/catalog/:id', async (req, res) => {
    try {
        await dbQuery('DELETE FROM rmm_software_catalog WHERE id=?', [req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Deploy ────────────────────────────────────────────────────────────────────

router.post('/device/deploy', async (req, res) => {
    const { nodeId, nodeName, catalogId, customUrl, customName, customArgs, customSha256, customType } = req.body;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'nodeId requerido' });

    let app;
    if (catalogId) {
        const rows = await dbQuery('SELECT * FROM rmm_software_catalog WHERE id=?', [catalogId]);
        if (!rows.length) return res.status(404).json({ ok: false, error: 'App no encontrada en catálogo' });
        app = rows[0];
    } else if (customUrl && customName) {
        app = { name: customName, url: customUrl, sha256: customSha256||null, silent_args: customArgs||'', type: customType||'exe' };
    } else {
        return res.status(400).json({ ok: false, error: 'catalogId o customUrl+customName requeridos' });
    }

    // Registrar job
    const [jr] = await dbQuery(
        'INSERT INTO rmm_deploy_jobs (catalog_id, node_id, node_name, app_name, status, started_by) VALUES (?,?,?,?,\'running\',?)',
        [catalogId||null, nodeId, nodeName||nodeId, app.name, req.user?.email||'admin']
    );
    const jobId = jr.insertId;

    const ext    = app.type === 'msi' ? '.msi' : app.type === 'ps1' ? '.ps1' : '.exe';
    const tmpVar = '$env:TEMP\\itsm_' + jobId + ext;
    const hashCheck = app.sha256
        ? `$h=(Get-FileHash '${tmpVar}' -Algorithm SHA256).Hash;if($h -ne '${app.sha256.toUpperCase()}'){Remove-Item '${tmpVar}' -Force;Write-Error 'SHA256 mismatch';exit 2};`
        : '';
    const runCmd = app.type === 'msi'
        ? `Start-Process msiexec -ArgumentList '/i ${tmpVar} /qn ${app.silent_args||''}' -Wait -PassThru`
        : app.type === 'ps1'
        ? `$p=Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File ${tmpVar}' -Wait -PassThru`
        : `$p=Start-Process '${tmpVar}' -ArgumentList '${(app.silent_args||'').replace(/'/g,"''")}' -Wait -PassThru`;

    const ps = `try{
Invoke-WebRequest -Uri '${app.url}' -OutFile '${tmpVar}' -UseBasicParsing -TimeoutSec 300;
${hashCheck}
${runCmd};
Remove-Item '${tmpVar}' -Force -EA SilentlyContinue;
[PSCustomObject]@{ok=$true;exitCode=$p.ExitCode;job=${jobId}}|ConvertTo-Json -Compress
}catch{
Remove-Item '${tmpVar}' -Force -EA SilentlyContinue;
[PSCustomObject]@{ok=$false;error=$_.Exception.Message;job=${jobId}}|ConvertTo-Json -Compress
}`;

    // Ejecutar de forma asíncrona — responder inmediatamente con jobId
    res.json({ ok: true, jobId, status: 'running', app: app.name });

    meshSvc.runScript(nodeId, ps, 360000)
        .then(result => {
            let parsed = {};
            try { parsed = JSON.parse((result.output||'').trim()); } catch {}
            const ok = parsed.ok === true || parsed.exitCode === 0;
            dbQuery('UPDATE rmm_deploy_jobs SET status=?,exit_code=?,error_msg=?,finished_at=NOW() WHERE id=?',
                [ok?'ok':'error', parsed.exitCode??null, ok?null:(parsed.error||'Error desconocido'), jobId]);
        })
        .catch(err => {
            dbQuery('UPDATE rmm_deploy_jobs SET status=\'error\',error_msg=?,finished_at=NOW() WHERE id=?',
                [err.message, jobId]);
        });
});

router.get('/device/deploy/jobs', async (req, res) => {
    const { nodeId, limit } = req.query;
    try {
        const lim = Math.min(parseInt(limit)||20, 100);
        const allowedIds = await _getAllowedNodeIds(req.user?.tenant_id);
        let rows;
        if (nodeId) {
            if (allowedIds && !allowedIds.has(nodeId)) return res.json({ ok: true, jobs: [] });
            rows = await dbQuery('SELECT * FROM rmm_deploy_jobs WHERE node_id=? ORDER BY started_at DESC LIMIT ?', [nodeId, lim]);
        } else if (allowedIds) {
            if (!allowedIds.size) return res.json({ ok: true, jobs: [] });
            const ph = [...allowedIds].map(() => '?').join(',');
            rows = await dbQuery(`SELECT * FROM rmm_deploy_jobs WHERE node_id IN (${ph}) ORDER BY started_at DESC LIMIT ?`, [...allowedIds, lim]);
        } else {
            rows = await dbQuery('SELECT * FROM rmm_deploy_jobs ORDER BY started_at DESC LIMIT ?', [lim]);
        }
        res.json({ ok: true, jobs: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Admin: gestión de grupos por tenant ───────────────────────────────────────

// Lista todos los meshes disponibles en MeshCentral (para el selector)
router.get('/meshes', async (req, res) => {
    try {
        const result = await meshSvc.getDevices(false);
        const meshMap = {};
        if (result.ok) {
            for (const d of result.devices) {
                if (d.meshId && !meshMap[d.meshId]) {
                    meshMap[d.meshId] = { meshId: d.meshId, deviceCount: 0 };
                }
                if (d.meshId) meshMap[d.meshId].deviceCount++;
            }
        }
        res.json({ ok: true, meshes: Object.values(meshMap) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Lista grupos asignados (opcionalmente filtrado por tenant)
router.get('/tenant-groups', async (req, res) => {
    try {
        const tenantId = req.query.tenant_id ? parseInt(req.query.tenant_id) : null;
        const rows = tenantId
            ? await dbQuery('SELECT tg.*, t.name AS tenant_name FROM rmm_tenant_groups tg LEFT JOIN tenants t ON t.id=tg.tenant_id WHERE tg.tenant_id=? ORDER BY tg.id', [tenantId])
            : await dbQuery('SELECT tg.*, t.name AS tenant_name FROM rmm_tenant_groups tg LEFT JOIN tenants t ON t.id=tg.tenant_id ORDER BY tg.tenant_id, tg.id');
        res.json({ ok: true, groups: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Asignar un grupo de mesh a un tenant
router.post('/tenant-groups', async (req, res) => {
    const { tenant_id, mesh_id, mesh_name } = req.body;
    if (!tenant_id || !mesh_id) return res.status(400).json({ ok: false, error: 'tenant_id y mesh_id requeridos' });
    try {
        await dbQuery(
            'INSERT INTO rmm_tenant_groups (tenant_id, mesh_id, mesh_name) VALUES (?,?,?) ON DUPLICATE KEY UPDATE mesh_name=VALUES(mesh_name)',
            [tenant_id, mesh_id, mesh_name || null]
        );
        _invalidateMeshCache(parseInt(tenant_id));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Eliminar asignación
router.delete('/tenant-groups/:id', async (req, res) => {
    try {
        const rows = await dbQuery('SELECT tenant_id FROM rmm_tenant_groups WHERE id=?', [req.params.id]);
        await dbQuery('DELETE FROM rmm_tenant_groups WHERE id=?', [req.params.id]);
        if (rows.length) _invalidateMeshCache(rows[0].tenant_id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Compliance + Reportes ─────────────────────────────────────────────────────

let ExcelJS, PDFDocument;
try { ExcelJS     = require('exceljs'); } catch {}
try { PDFDocument = require('pdfkit');  } catch {}

function _pdfToBuffer(doc) {
    return new Promise((resolve, reject) => {
        const c = [];
        doc.on('data', d => c.push(d));
        doc.on('end',  () => resolve(Buffer.concat(c)));
        doc.on('error', reject);
        doc.end();
    });
}

function _complianceScore(dev) {
    // Calcula score 0-100 y lista de issues para un dispositivo
    const issues = [];
    let demerits = 0;

    if (!dev.online) {
        issues.push({ type: 'offline', severity: 'critical', label: 'Offline' });
        demerits += 50;
    }

    const sys = rmmCache.get(dev.nodeId, 'system');
    if (sys?.data?.lastPatch) {
        const days = Math.floor((Date.now() - new Date(sys.data.lastPatch).getTime()) / 86400000);
        if (days > 60) { issues.push({ type: 'patches', severity: 'critical', label: `Sin parches ${days}d` }); demerits += 35; }
        else if (days > 30) { issues.push({ type: 'patches', severity: 'warning', label: `Parches hace ${days}d` }); demerits += 15; }
    } else if (!dev.online) {
        // sin datos, no penalizar doble
    } else {
        issues.push({ type: 'patches', severity: 'warning', label: 'Parches desconocidos' });
        demerits += 10;
    }

    const disks = rmmCache.get(dev.nodeId, 'disk');
    if (disks?.data?.length) {
        for (const dk of disks.data) {
            const freePct = dk.t > 0 ? Math.round((dk.f / dk.t) * 100) : null;
            if (freePct !== null) {
                if (freePct < 5)  { issues.push({ type: 'disk', severity: 'critical', label: `${dk.d} ${freePct}% libre` }); demerits += 30; }
                else if (freePct < 15) { issues.push({ type: 'disk', severity: 'warning', label: `${dk.d} ${freePct}% libre` }); demerits += 12; }
            }
        }
    }

    const score = Math.max(0, 100 - demerits);
    const status = demerits >= 40 ? 'critical' : demerits >= 15 ? 'warning' : 'ok';
    return { score, status, issues };
}

async function _buildComplianceData(tenantId) {
    const devResult = await meshSvc.getDevices(false);
    const meshIds   = await _getMeshIdsForTenant(tenantId);
    const devices   = _filterDevices(devResult.ok ? devResult.devices : [], meshIds);

    // Alertas abiertas por nodo
    let alertMap = {};
    try {
        const rows = await dbQuery("SELECT node_id, COUNT(*) AS cnt, MAX(severity) AS top_sev FROM rmm_alerts WHERE status='open' GROUP BY node_id");
        for (const r of rows) alertMap[r.node_id] = { count: parseInt(r.cnt), severity: r.top_sev };
    } catch {}

    const result = devices.map(d => {
        const nodeId = d.id || d.nodeid || '';
        const sys    = rmmCache.get(nodeId, 'system');
        const disks  = rmmCache.get(nodeId, 'disk');

        const dev = {
            nodeId,
            name:    d.name || nodeId,
            online:  d.conn === 1 || d.conn === true,
            ip:      d.ip || '',
            os:      sys?.data?.osName || '',
            lastPatch: sys?.data?.lastPatch || null,
            disks:   disks?.data || [],
            alerts:  alertMap[nodeId] || { count: 0, severity: null },
        };

        const { score, status, issues } = _complianceScore(dev);
        return { ...dev, score, status, issues };
    });

    // KPIs
    const total    = result.length;
    const critical = result.filter(d => d.status === 'critical').length;
    const warning  = result.filter(d => d.status === 'warning').length;
    const ok       = result.filter(d => d.status === 'ok').length;
    const offline  = result.filter(d => !d.online).length;
    const noPatch  = result.filter(d => d.issues.some(i => i.type === 'patches')).length;
    const diskIssue= result.filter(d => d.issues.some(i => i.type === 'disk')).length;
    const avgScore = total ? Math.round(result.reduce((s, d) => s + d.score, 0) / total) : 100;

    return {
        devices: result.sort((a, b) => a.score - b.score),
        kpis: { total, critical, warning, ok, offline, noPatch, diskIssue, avgScore },
        generatedAt: new Date().toISOString(),
    };
}

router.get('/compliance/summary', async (req, res) => {
    try {
        const data = await _buildComplianceData(req.user?.tenant_id);
        res.json({ ok: true, ...data });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/compliance/export/excel', async (req, res) => {
    if (!ExcelJS) return res.status(500).json({ ok: false, error: 'exceljs no disponible' });
    try {
        const { devices, kpis, generatedAt } = await _buildComplianceData(req.user?.tenant_id);

        const wb = new ExcelJS.Workbook();
        wb.creator = 'ITSM Compliance';

        // Hoja 1: Resumen ejecutivo
        const wsSum = wb.addWorksheet('Resumen');
        wsSum.columns = [{ width: 30 }, { width: 20 }];
        wsSum.addRow(['Reporte de Compliance RMM']);
        wsSum.addRow([`Generado: ${new Date(generatedAt).toLocaleString('es-PE')}`]);
        wsSum.addRow([]);
        const kpiRows = [
            ['Total dispositivos', kpis.total],
            ['Score promedio', kpis.avgScore + '%'],
            ['Críticos', kpis.critical],
            ['Advertencias', kpis.warning],
            ['Correctos', kpis.ok],
            ['Offline', kpis.offline],
            ['Sin parches al día', kpis.noPatch],
            ['Con problema de disco', kpis.diskIssue],
        ];
        for (const [label, val] of kpiRows) {
            wsSum.addRow([label, val]);
        }
        wsSum.getRow(1).font = { bold: true, size: 14 };

        // Hoja 2: Dispositivos
        const wsDev = wb.addWorksheet('Dispositivos', { views: [{ state: 'frozen', ySplit: 1 }] });
        wsDev.columns = [
            { header: 'Dispositivo', key: 'name',     width: 28 },
            { header: 'Estado',      key: 'status',   width: 12 },
            { header: 'Score',       key: 'score',    width: 10 },
            { header: 'Online',      key: 'online',   width: 10 },
            { header: 'IP',          key: 'ip',       width: 16 },
            { header: 'OS',          key: 'os',       width: 30 },
            { header: 'Último parche',key:'lastPatch', width: 15 },
            { header: 'Alertas',     key: 'alertCnt', width: 10 },
            { header: 'Issues',      key: 'issues',   width: 50 },
        ];
        wsDev.getRow(1).eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        wsDev.getRow(1).height = 22;

        const statusColors = { critical: 'FFFEE2E2', warning: 'FFFFF7ED', ok: 'FFF0FDF4' };
        for (const d of devices) {
            const row = wsDev.addRow({
                name:      d.name,
                status:    d.status === 'critical' ? 'Crítico' : d.status === 'warning' ? 'Advertencia' : 'Correcto',
                score:     d.score,
                online:    d.online ? 'Sí' : 'No',
                ip:        d.ip,
                os:        d.os,
                lastPatch: d.lastPatch || 'Desconocido',
                alertCnt:  d.alerts.count,
                issues:    d.issues.map(i => i.label).join(', ') || 'Ninguno',
            });
            const bg = statusColors[d.status] || 'FFFFFFFF';
            row.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            });
        }

        const buffer = await wb.xlsx.writeBuffer();
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="compliance_${date}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/compliance/export/pdf', async (req, res) => {
    if (!PDFDocument) return res.status(500).json({ ok: false, error: 'pdfkit no disponible' });
    try {
        const { devices, kpis, generatedAt } = await _buildComplianceData(req.user?.tenant_id);
        const doc = new PDFDocument({ margin: 40, size: 'A4', compress: true });

        // Cabecera
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#1e293b')
           .text('Reporte de Compliance RMM', { align: 'center' });
        doc.fontSize(9).font('Helvetica').fillColor('#64748b')
           .text(`Generado: ${new Date(generatedAt).toLocaleString('es-PE')}`, { align: 'center' });
        doc.moveDown(1);

        // KPIs
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e293b').text('Resumen Ejecutivo');
        doc.moveDown(0.3);
        const kpiLines = [
            [`Total: ${kpis.total}`, `Score promedio: ${kpis.avgScore}%`],
            [`Críticos: ${kpis.critical}`, `Advertencias: ${kpis.warning}`, `Correctos: ${kpis.ok}`],
            [`Offline: ${kpis.offline}`, `Sin parches: ${kpis.noPatch}`, `Disco: ${kpis.diskIssue}`],
        ];
        for (const line of kpiLines) {
            doc.fontSize(10).font('Helvetica').fillColor('#374151').text(line.join('   ·   '));
        }
        doc.moveDown(1);

        // Tabla de dispositivos
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e293b').text('Dispositivos');
        doc.moveDown(0.5);

        const colW = [140, 65, 45, 55, 70, 90];
        const headers = ['Dispositivo', 'Estado', 'Score', 'Online', 'Último parche', 'Issues'];
        const startX = doc.page.margins.left;
        let y = doc.y;

        // Cabecera tabla
        doc.rect(startX, y, 465, 18).fill('#1e3a5f');
        let x = startX + 4;
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
        for (let i = 0; i < headers.length; i++) {
            doc.text(headers[i], x, y + 4, { width: colW[i], lineBreak: false });
            x += colW[i];
        }
        y += 20;

        // Filas
        const statusLabel = { critical: 'Crítico', warning: 'Advertencia', ok: 'Correcto' };
        const statusColor = { critical: '#fca5a5', warning: '#fde68a', ok: '#bbf7d0' };
        for (let i = 0; i < devices.length; i++) {
            const d = devices[i];
            if (y > doc.page.height - 60) { doc.addPage(); y = doc.page.margins.top; }
            const rowH = 16;
            const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
            doc.rect(startX, y, 465, rowH).fill(bg);
            x = startX + 4;
            const cells = [
                d.name.slice(0, 20),
                statusLabel[d.status] || d.status,
                d.score + '%',
                d.online ? 'Sí' : 'No',
                d.lastPatch || '—',
                d.issues.slice(0, 2).map(i => i.label).join(', ').slice(0, 30) || '—',
            ];
            doc.fontSize(7.5).font('Helvetica').fillColor('#1e293b');
            for (let j = 0; j < cells.length; j++) {
                doc.text(cells[j], x, y + 3, { width: colW[j] - 4, lineBreak: false });
                x += colW[j];
            }
            y += rowH;
        }

        doc.fontSize(8).fillColor('#94a3b8').moveDown(1)
           .text(`Total: ${devices.length} dispositivos`, { align: 'right' });

        const buffer = await _pdfToBuffer(doc);
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="compliance_${date}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(buffer);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
