'use strict';
const { equipmentPool, executeQuery } = require('../config/database');
const rmmCache = require('./rmmCache');

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
async function fireAlert(io, { ruleId, ruleName, nodeId, nodeName, metric, severity, value, message }) {
    const existing = await dbQ(
        "SELECT id FROM rmm_alerts WHERE node_id=? AND metric=? AND status='open' LIMIT 1",
        [nodeId, metric]
    );
    if (existing.length) return;

    await dbQ(
        'INSERT INTO rmm_alerts (rule_id, rule_name, node_id, node_name, metric, severity, value, message) VALUES (?,?,?,?,?,?,?,?)',
        [ruleId || null, ruleName, nodeId, nodeName || nodeId, metric, severity, String(value ?? ''), message]
    );

    if (io) {
        io.to('jira:agents').emit('rmm:alert', { nodeId, nodeName, metric, severity, message, firedAt: new Date().toISOString() });
    }
}

// Resuelve alertas open de un nodo+métrica cuando la condición ya no se cumple
async function resolveAlert(nodeId, metric) {
    await dbQ(
        "UPDATE rmm_alerts SET status='resolved', resolved_at=NOW() WHERE node_id=? AND metric=? AND status='open'",
        [nodeId, metric]
    );
}

async function evaluateAll(io, meshSvc) {
    let rules = [];
    let devices = [];
    try {
        rules   = await dbQ("SELECT * FROM rmm_alert_rules WHERE enabled=1");
        devices = meshSvc.getDevices ? meshSvc.getDevices() : [];
    } catch { return; }

    if (!rules.length || !devices.length) return;

    const devCache = { get: (k) => { const p = k.split(':'); return rmmCache.get(p[0], p.slice(1).join(':')); } };

    for (const device of devices) {
        const nodeId   = device.id   || device.nodeid || '';
        const nodeName = device.name || nodeId;
        const online   = device.conn === 1 || device.conn === true;

        for (const rule of rules) {
            try {
                await _evalRule(io, rule, { nodeId, nodeName, online, devCache });
            } catch {}
        }
    }
}

async function _evalRule(io, rule, { nodeId, nodeName, online, devCache }) {
    const { id: ruleId, name: ruleName, metric, operator, threshold, severity } = rule;
    const thr = parseFloat(threshold);

    switch (metric) {

        case 'offline': {
            // threshold = minutos offline
            if (!online) {
                await fireAlert(io, { ruleId, ruleName, nodeId, nodeName, metric, severity,
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
                await fireAlert(io, { ruleId, ruleName, nodeId, nodeName, metric, severity,
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
                    await fireAlert(io, { ruleId, ruleName, nodeId, nodeName, metric: metricKey, severity,
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
                await fireAlert(io, { ruleId, ruleName, nodeId, nodeName, metric, severity,
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
// allowedNodeIds: Set o null (null = sin filtro)
async function getAlertStats(allowedNodeIds) {
    let rows;
    if (allowedNodeIds instanceof Set) {
        if (!allowedNodeIds.size) return { total: 0, critical: 0, warning: 0, info: 0 };
        const ph = [...allowedNodeIds].map(() => '?').join(',');
        rows = await dbQ(`SELECT severity, COUNT(*) AS cnt FROM rmm_alerts WHERE status='open' AND node_id IN (${ph}) GROUP BY severity`, [...allowedNodeIds]);
    } else {
        rows = await dbQ("SELECT severity, COUNT(*) AS cnt FROM rmm_alerts WHERE status='open' GROUP BY severity");
    }
    const stats = { total: 0, critical: 0, warning: 0, info: 0 };
    for (const r of rows) { stats[r.severity] = parseInt(r.cnt); stats.total += parseInt(r.cnt); }
    return stats;
}

module.exports = { evaluateAll, fireAlert, resolveAlert, getAlertStats };
