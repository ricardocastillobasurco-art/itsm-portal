'use strict';
const { equipmentPool, executeQuery } = require('../config/database');
const rmmCache = require('./rmmCache');
const { agentsRoom } = require('../src/utils/tenantTickets');

const OWNER_TENANT_ID = 1;

function dbQ(sql, params = []) {
    return executeQuery(equipmentPool, sql, params);
}

function compare(value, operator, threshold) {
    switch (operator) {
        case 'gt':  return value > threshold;
        case 'lt':  return value < threshold;
        case 'gte': return value >= threshold;
        case 'lte': return value <= threshold;
        case 'eq':  return value == threshold;
        default:    return false;
    }
}

// Dispara una alerta si no existe ya una open para el mismo nodo+métrica
async function fireAlert(io, { tenantId = OWNER_TENANT_ID, ruleId, ruleName, nodeId, nodeName, metric, severity, value, message }) {
    const existing = await dbQ(
        "SELECT id FROM rmm_alerts /* tenant_id: node_id pertenece a un solo tenant */ WHERE node_id=? AND metric=? AND status='open' LIMIT 1",
        [nodeId, metric]
    );
    if (existing.length) return;

    await dbQ(
        'INSERT INTO rmm_alerts (tenant_id, rule_id, rule_name, node_id, node_name, metric, severity, value, message) VALUES (?,?,?,?,?,?,?,?,?)',
        [tenantId, ruleId || null, ruleName, nodeId, nodeName || nodeId, metric, severity, String(value ?? ''), message]
    );

    if (io) {
        io.to(agentsRoom(tenantId)).emit('rmm:alert', { nodeId, nodeName, metric, severity, message, firedAt: new Date().toISOString() });
    }
}

// Resuelve alertas open de un nodo+métrica cuando la condición ya no se cumple
async function resolveAlert(nodeId, metric) {
    await dbQ(
        "UPDATE rmm_alerts /* tenant_id: node_id pertenece a un solo tenant */ SET status='resolved', resolved_at=NOW() WHERE node_id=? AND metric=? AND status='open'",
        [nodeId, metric]
    );
}

async function evaluateAll(io, meshSvc) {
    let rules = [];
    // Origen de los equipos: servidor compartido (empresa según el grupo asignado) y
    // servidores propios de cada empresa (todos sus equipos son de esa empresa).
    const sources = [];
    try {
        rules = await dbQ("SELECT *, COALESCE(tenant_id, 1) AS tid FROM rmm_alert_rules /* tenant_id: se agrupan por tenant abajo */ WHERE enabled=1");
        if (!rules.length) return;
        const r = await meshSvc.getDevices(false);
        const meshTenant = new Map((await dbQ('SELECT mesh_id, tenant_id FROM rmm_tenant_groups')).map(g => [g.mesh_id, Number(g.tenant_id)]));
        // Un equipo sin grupo asignado no es de ninguna empresa (antes se atribuía a la empresa 1)
        sources.push({ devices: r && r.ok ? r.devices : [], tenantOf: (d) => meshTenant.get(d.meshId) ?? null });
        for (const { tenantId, svc } of await require('./meshPool').dedicatedTenants()) {
            const rd = await svc.getDevices(false).catch(() => null);
            sources.push({ devices: rd && rd.ok ? rd.devices : [], tenantOf: () => tenantId });
        }
    } catch { return; }

    const devCache = { get: (k) => { const p = k.split(':'); return rmmCache.get(p[0], p.slice(1).join(':')); } };

    for (const { devices, tenantOf } of sources)
    for (const device of devices) {
        const nodeId   = device.nodeId || device.id || device.nodeid || '';
        const nodeName = device.name || nodeId;
        const online   = device.online ?? (device.conn === 1 || device.conn === true);
        const tenantId = tenantOf(device);
        if (tenantId == null) continue;

        for (const rule of rules) {
            if (Number(rule.tid) !== tenantId) continue;
            try {
                await _evalRule(io, rule, { tenantId, nodeId, nodeName, online, devCache });
            } catch {}
        }
    }
}

async function _evalRule(io, rule, { tenantId, nodeId, nodeName, online, devCache }) {
    const { id: ruleId, name: ruleName, metric, operator, threshold, severity } = rule;
    const fire = (o) => fireAlert(io, { tenantId, ...o });
    const thr = parseFloat(threshold);

    switch (metric) {

        case 'offline': {
            // threshold = minutos offline
            if (!online) {
                await fire({ ruleId, ruleName, nodeId, nodeName, metric, severity,
                    value: 'offline', message: `${nodeName}: dispositivo offline` });
            } else {
                await resolveAlert(nodeId, metric);
            }
            break;
        }

        case 'cpu':
        case 'ram': {
            const cached = rmmCache.get(nodeId, 'system');
            if (!cached || !cached.data) break;
            const val = metric === 'cpu'
                ? (cached.data.cpuLoad ?? cached.data.cpuUsage ?? null)
                : (cached.data.ramUsedPct ?? cached.data.memUsedPct ?? null);
            if (val === null) break;
            if (compare(val, operator, thr)) {
                await fire({ ruleId, ruleName, nodeId, nodeName, metric, severity,
                    value: val + '%', message: `${nodeName}: ${metric.toUpperCase()} ${val}% (umbral ${operator} ${thr}%)` });
            } else {
                await resolveAlert(nodeId, metric);
            }
            break;
        }

        case 'disk': {
            const cached = rmmCache.get(nodeId, 'disk');
            if (!cached || !cached.data) break;
            const disks = Array.isArray(cached.data) ? cached.data : [];
            for (const dk of disks) {
                const freePct = dk.f && dk.t ? Math.round((dk.f / dk.t) * 100) : null;
                if (freePct === null) continue;
                const metricKey = metric + ':' + dk.d;
                if (compare(freePct, operator, thr)) {
                    await fire({ ruleId, ruleName, nodeId, nodeName, metric: metricKey, severity,
                        value: freePct + '% libre', message: `${nodeName}: disco ${dk.d} solo ${freePct}% libre (${dk.f} GB)` });
                } else {
                    await resolveAlert(nodeId, metricKey);
                }
            }
            break;
        }

        case 'updates_age': {
            const cached = rmmCache.get(nodeId, 'updates');
            if (!cached || !cached.data || !cached.data.length) break;
            const lastDate = cached.data[0]?.date;
            if (!lastDate) break;
            const daysDiff = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
            if (compare(daysDiff, operator, thr)) {
                await fire({ ruleId, ruleName, nodeId, nodeName, metric, severity,
                    value: daysDiff + ' días', message: `${nodeName}: último parche hace ${daysDiff} días (umbral ${thr} días)` });
            } else {
                await resolveAlert(nodeId, metric);
            }
            break;
        }

        default: break;
    }
}

// Estadísticas para el badge del dashboard
// allowedNodeIds: Set o null (null = todos los del tenant)
async function getAlertStats(allowedNodeIds, tenantId = OWNER_TENANT_ID) {
    let rows;
    if (allowedNodeIds instanceof Set) {
        if (!allowedNodeIds.size) return { total: 0, critical: 0, warning: 0, info: 0 };
        const ph = [...allowedNodeIds].map(() => '?').join(',');
        rows = await dbQ(`SELECT severity, COUNT(*) AS cnt FROM rmm_alerts WHERE COALESCE(tenant_id, 1) = ? AND status='open' AND node_id IN (${ph}) GROUP BY severity`, [tenantId, ...allowedNodeIds]);
    } else {
        rows = await dbQ("SELECT severity, COUNT(*) AS cnt FROM rmm_alerts WHERE COALESCE(tenant_id, 1) = ? AND status='open' GROUP BY severity", [tenantId]);
    }
    const stats = { total: 0, critical: 0, warning: 0, info: 0 };
    for (const r of rows) { stats[r.severity] = parseInt(r.cnt); stats.total += parseInt(r.cnt); }
    return stats;
}

module.exports = { evaluateAll, fireAlert, resolveAlert, getAlertStats };
