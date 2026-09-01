'use strict';

const express             = require('express');
const router              = express.Router();
const { authenticateToken, requireRole } = require('../../middleware/auth');
const requireGraphToken   = require('../../middleware/requireGraphToken');
const { callGraph, callGraphPaged, GraphAuthError, GraphForbiddenError } = require('../../src/services/graphClient');
const { dbQuery }         = require('../jira/helpers');

// Todos los endpoints requieren auth propia + token Graph
const guard = [authenticateToken, requireGraphToken];
const adminGuard = [authenticateToken, requireRole('administrador','superadmin','especialista'), requireGraphToken];

// Manejador de error Graph unificado
function handleGraphErr(err, res) {
    if (err.msReauth || err instanceof GraphAuthError) {
        return res.status(401).json({ success: false, msReauth: true, error: err.message });
    }
    if (err.forbidden || err instanceof GraphForbiddenError) {
        return res.status(403).json({ success: false, forbidden: true, error: err.message });
    }
    console.error('[ms-graph]', err.message);
    return res.status(500).json({ success: false, error: err.message });
}

// ── GET /api/ms/debug-token — diagnóstico directo del refresh token ───────────
router.get('/debug-token', authenticateToken, async (req, res) => {
    try {
        const { _decrypt } = require('../../src/services/msTokenCache');
        const { dbQuery }  = require('../jira/helpers');
        const axios        = require('axios');
        const rows = await dbQuery(
            'SELECT ms_home_account_id, ms_token_cache FROM users WHERE id=? LIMIT 1',
            [req.user.id]
        );
        const row = rows?.[0];
        if (!row?.ms_token_cache) return res.json({ ok: false, step: 'no_cache', user_id: req.user.id });

        let cacheJson;
        try {
            cacheJson = JSON.parse(_decrypt(row.ms_token_cache));
        } catch(e) {
            return res.json({ ok: false, step: 'decrypt_failed', error: e.message });
        }

        const rtValues  = Object.values(cacheJson.RefreshToken || {});
        const row2Rows  = await dbQuery('SELECT ms_home_account_id FROM users WHERE id=? LIMIT 1', [req.user.id]);
        const haid      = row2Rows?.[0]?.ms_home_account_id;
        const rtEntry   = rtValues.find(rt => rt.homeAccountId === haid) || rtValues[0];
        const refreshToken = rtEntry?.secret;
        if (!refreshToken) return res.json({ ok: false, step: 'no_rt', totalRTs: rtValues.length, homeAccountId: haid });

        try {
            const body = new URLSearchParams({
                grant_type:    'refresh_token',
                client_id:     process.env.MS_CLIENT_ID,
                client_secret: process.env.MS_CLIENT_SECRET,
                refresh_token: refreshToken,
                scope:         'https://graph.microsoft.com/.default offline_access',
            }).toString();
            const resp = await axios.post(
                `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
                body,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            return res.json({ ok: true, step: 'token_ok', token_type: resp.data.token_type, expires_in: resp.data.expires_in, has_new_rt: !!resp.data.refresh_token });
        } catch(e) {
            const errData = e.response?.data;
            return res.json({ ok: false, step: 'token_endpoint_failed', error: errData?.error, description: errData?.error_description, status: e.response?.status });
        }
    } catch(e) {
        res.status(500).json({ ok: false, step: 'exception', error: e.message });
    }
});

// ── GET /api/ms/status — verificar si el usuario tiene token Graph ─────────────
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            'SELECT id, email, ms_home_account_id, ms_token_cache FROM users WHERE id=? LIMIT 1',
            [req.user.id]
        );
        const row = rows?.[0];
        // Solo necesita home_account_id + cache para funcionar (scopes_granted es auxiliar)
        const hasToken = !!(row?.ms_home_account_id && row?.ms_token_cache);
        console.log(`[ms/status] user_id=${req.user.id} email=${row?.email} connected=${hasToken} account=${row?.ms_home_account_id || 'null'}`);
        res.json({ success: true, connected: hasToken, debug: { user_id: req.user.id, email: row?.email } });
    } catch(e) {
        console.error('[ms/status] error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ── GET /api/ms/me — perfil Graph del usuario actual ─────────────────────────
router.get('/me', ...guard, async (req, res) => {
    try {
        const me = await callGraph(req.user.id, '/me');
        res.json({ success: true, data: me });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/dashboard — KPIs ejecutivos (Fase 1) ────────────────────────
router.get('/dashboard', ...adminGuard, async (req, res) => {
    try {
        const uid = req.user.id;

        // Intune managedDevices/$count path devuelve 0 en muchos tenants — usar página + @odata.count
        const [orgData, usersCount, groupsCount, devicesData, licensesData] = await Promise.allSettled([
            callGraph(uid, '/organization?$select=displayName,verifiedDomains,assignedPlans'),
            callGraph(uid, '/users/$count?$filter=accountEnabled eq true'),
            callGraph(uid, '/groups/$count'),
            callGraph(uid, '/deviceManagement/managedDevices?$select=id,complianceState&$top=999'),
            callGraph(uid, '/subscribedSkus?$select=skuPartNumber,consumedUnits,prepaidUnits,capabilityStatus'),
        ]);

        const org      = orgData.status      === 'fulfilled' ? orgData.value?.value?.[0]      : null;
        const users    = usersCount.status   === 'fulfilled' ? usersCount.value               : null;
        const groups   = groupsCount.status  === 'fulfilled' ? groupsCount.value              : null;
        const devList  = devicesData.status  === 'fulfilled' ? (devicesData.value?.value || []) : [];
        const devices  = devList.length;
        const licenses = licensesData.status === 'fulfilled' ? licensesData.value?.value || [] : [];

        const totalLicenses    = licenses.reduce((s, l) => s + (l.prepaidUnits?.enabled || 0), 0);
        const usedLicenses     = licenses.reduce((s, l) => s + (l.consumedUnits || 0), 0);
        const availLicenses    = totalLicenses - usedLicenses;

        res.json({
            success: true,
            data: {
                org: org ? { name: org.displayName, domains: org.verifiedDomains?.map(d => d.name) } : null,
                users:   typeof users  === 'number' ? users  : (users  || 0),
                groups:  typeof groups === 'number' ? groups : (groups || 0),
                devices,
                licenses: {
                    total:     totalLicenses,
                    used:      usedLicenses,
                    available: availLicenses,
                    list: licenses.map(l => ({
                        sku:       l.skuPartNumber,
                        total:     l.prepaidUnits?.enabled || 0,
                        used:      l.consumedUnits || 0,
                        available: (l.prepaidUnits?.enabled || 0) - (l.consumedUnits || 0),
                        status:    l.capabilityStatus,
                    })),
                },
            },
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/users — lista de usuarios Entra ───────────────────────────────
router.get('/users', ...adminGuard, async (req, res) => {
    try {
        const uid      = req.user.id;
        const q        = req.query.q || '';
        const top      = Math.min(parseInt(req.query.top) || 50, 200);
        const nextLink = req.query.nextLink || null; // cursor de paginación

        // $skip no está soportado con $count=true — usar cursor @odata.nextLink
        const status = req.query.status || ''; // 'active' | 'disabled' | ''
        let path;
        if (nextLink) {
            path = nextLink;
        } else {
            const fields = 'id,displayName,userPrincipalName,mail,department,jobTitle,accountEnabled,createdDateTime,signInActivity,assignedLicenses,mobilePhone,officeLocation';
            const filters = [];
            if (status === 'active')   filters.push(`accountEnabled eq true`);
            if (status === 'disabled') filters.push(`accountEnabled eq false`);
            if (q) filters.push(`(startswith(displayName,'${encodeURIComponent(q)}') or startswith(userPrincipalName,'${encodeURIComponent(q)}'))`);
            const filterStr = filters.length ? `&$filter=${filters.join(' and ')}` : '';
            const orderStr  = !q && !status ? `&$orderby=displayName` : '';
            path = `/users?$select=${fields}&$top=${top}${filterStr}${orderStr}&$count=true`;
        }

        const data = await callGraph(uid, path);
        res.json({
            success: true,
            data:  data.value || [],
            total: data['@odata.count'] || (data.value?.length || 0),
            next:  data['@odata.nextLink'] || null,
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/users/:id — detalle de un usuario ─────────────────────────────
router.get('/users/:id', ...adminGuard, async (req, res) => {
    try {
        const uid = req.user.id;
        const [profile, memberOf] = await Promise.allSettled([
            callGraph(uid, `/users/${req.params.id}?$select=id,displayName,userPrincipalName,mail,department,jobTitle,accountEnabled,createdDateTime,mobilePhone,officeLocation,usageLocation,city,country,companyName,employeeId,passwordPolicies,lastPasswordChangeDateTime`),
            callGraph(uid, `/users/${req.params.id}/memberOf?$select=displayName,groupTypes`),
        ]);
        res.json({
            success:  true,
            profile:  profile.status  === 'fulfilled' ? profile.value  : null,
            memberOf: memberOf.status === 'fulfilled' ? (memberOf.value?.value || []) : [],
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/licenses — suscripciones y uso ────────────────────────────────
router.get('/licenses', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id,
            '/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits,capabilityStatus,appliesTo,servicePlans'
        );
        const skus = (data.value || []).map(s => ({
            id:          s.skuId,
            sku:         s.skuPartNumber,
            status:      s.capabilityStatus,
            appliesTo:   s.appliesTo,
            total:       s.prepaidUnits?.enabled  || 0,
            suspended:   s.prepaidUnits?.suspended || 0,
            warning:     s.prepaidUnits?.warning   || 0,
            used:        s.consumedUnits || 0,
            available:   (s.prepaidUnits?.enabled || 0) - (s.consumedUnits || 0),
            services:    (s.servicePlans || []).filter(p => p.provisioningStatus === 'Success').map(p => p.servicePlanName),
        }));
        res.json({ success: true, data: skus });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/devices — inventario Intune ───────────────────────────────────
router.get('/devices', ...adminGuard, async (req, res) => {
    try {
        const uid  = req.user.id;
        const top  = Math.min(parseInt(req.query.top) || 50, 200);
        const skip = parseInt(req.query.skip) || 0;
        const q    = req.query.q || '';

        const fields = 'id,deviceName,userDisplayName,userPrincipalName,operatingSystem,osVersion,lastSyncDateTime,complianceState,managedDeviceOwnerType,manufacturer,model,serialNumber,totalStorageSpaceInBytes,freeStorageSpaceInBytes,isEncrypted,isSupervised,enrolledDateTime,azureADRegistered,azureADDeviceId';
        let path = `/deviceManagement/managedDevices?$select=${fields}&$top=${top}&$skip=${skip}&$orderby=deviceName`;
        if (q) path += `&$filter=contains(deviceName,'${q}') or contains(userDisplayName,'${q}')`;

        const data = await callGraph(uid, path);
        const devices = (data.value || []).map(d => ({
            ...d,
            totalGB: d.totalStorageSpaceInBytes ? (d.totalStorageSpaceInBytes / 1073741824).toFixed(0) : null,
            freeGB:  d.freeStorageSpaceInBytes  ? (d.freeStorageSpaceInBytes  / 1073741824).toFixed(0) : null,
        }));
        res.json({ success: true, data: devices, next: data['@odata.nextLink'] || null });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/devices/:id — detalle dispositivo ─────────────────────────────
router.get('/devices/:id', ...adminGuard, async (req, res) => {
    try {
        const uid = req.user.id;
        const [dev, compliance] = await Promise.allSettled([
            callGraph(uid, `/deviceManagement/managedDevices/${req.params.id}`),
            callGraph(uid, `/deviceManagement/managedDevices/${req.params.id}/deviceCompliancePolicyStates`),
        ]);
        res.json({
            success:    true,
            device:     dev.status        === 'fulfilled' ? dev.value        : null,
            compliance: compliance.status === 'fulfilled' ? (compliance.value?.value || []) : [],
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/groups — grupos de Entra ──────────────────────────────────────
router.get('/groups', ...adminGuard, async (req, res) => {
    try {
        const top      = Math.min(parseInt(req.query.top) || 50, 200);
        const q        = req.query.q || '';
        const nextLink = req.query.nextLink || null;

        // $skip no soportado con $count=true — usar cursor
        let path;
        if (nextLink) {
            path = nextLink;
        } else {
            path = `/groups?$select=id,displayName,description,groupTypes,membershipRule,mailEnabled,securityEnabled,createdDateTime&$top=${top}&$count=true`;
            if (q) path += `&$filter=startswith(displayName,'${encodeURIComponent(q)}')`;
        }
        const data = await callGraph(req.user.id, path);
        res.json({ success: true, data: data.value || [], total: data['@odata.count'] || 0, next: data['@odata.nextLink'] || null });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/security/mfa — estado MFA de usuarios ────────────────────────
router.get('/security/mfa', ...adminGuard, async (req, res) => {
    try {
        // defaultMfaMethod solo existe en beta — usar beta para evitar error OData en v1
        const data = await callGraph(req.user.id,
            '/reports/authenticationMethods/userRegistrationDetails?$top=200&$select=userPrincipalName,userDisplayName,isMfaRegistered,isMfaCapable,defaultMfaMethod,methodsRegistered',
            { beta: true }
        );
        const list = data.value || [];
        const mfaOn  = list.filter(u => u.isMfaRegistered).length;
        const mfaOff = list.length - mfaOn;
        res.json({ success: true, data: list, summary: { total: list.length, mfaOn, mfaOff } });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/audit/signins — Registros de inicio de sesión ────────────────
router.get('/audit/signins', ...adminGuard, async (req, res) => {
    try {
        const top = Math.min(parseInt(req.query.top) || 50, 200);
        const data = await callGraph(req.user.id,
            `/auditLogs/signIns?$top=${top}&$orderby=createdDateTime desc&$select=id,userDisplayName,userPrincipalName,appDisplayName,status,createdDateTime,ipAddress,location,clientAppUsed,deviceDetail,riskLevelDuringSignIn`
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/audit/directory — Auditoría de directorio ────────────────────
router.get('/audit/directory', ...adminGuard, async (req, res) => {
    try {
        const top = Math.min(parseInt(req.query.top) || 50, 200);
        const data = await callGraph(req.user.id,
            `/auditLogs/directoryAudits?$top=${top}&$orderby=activityDateTime desc&$select=id,activityDisplayName,activityDateTime,initiatedBy,targetResources,result,category`
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/security/conditional-access — Acceso condicional ──────────────
router.get('/security/conditional-access', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id,
            '/identity/conditionalAccess/policies?$select=id,displayName,state,conditions,grantControls,createdDateTime,modifiedDateTime'
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/security/risky-users — Usuarios en riesgo ────────────────────
router.get('/security/risky-users', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id,
            '/identityProtection/riskyUsers?$top=100&$orderby=riskLastUpdatedDateTime desc&$select=id,userDisplayName,userPrincipalName,riskLevel,riskState,riskDetail,riskLastUpdatedDateTime'
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/devices/autopilot — Dispositivos Autopilot ───────────────────
router.get('/devices/autopilot', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id,
            '/deviceManagement/windowsAutopilotDeviceIdentities?$select=id,serialNumber,model,manufacturer,displayName,enrollmentState,lastContactedDateTime,groupTag,purchaseOrderIdentifier,addressableUserName'
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/devices/:id/apps — Apps instaladas en dispositivo ─────────────
router.get('/devices/:id/apps', ...adminGuard, async (req, res) => {
    try {
        const uid   = req.user.id;
        const devId = req.params.id;

        // Intentar 3 estrategias en paralelo — Intune varía según tenant/versión
        const [v1Nav, betaNav, expanded] = await Promise.allSettled([
            callGraph(uid, `/deviceManagement/managedDevices/${devId}/detectedApps?$top=500`),
            callGraph(uid, `/deviceManagement/managedDevices/${devId}/detectedApps?$top=500`, { beta: true }),
            callGraph(uid, `/deviceManagement/managedDevices/${devId}?$expand=detectedApps`, { beta: true }),
        ]);

        // Extraer apps de cualquier estrategia que devuelva datos
        const extract = r => {
            if (r.status !== 'fulfilled') return [];
            const d = r.value;
            // Puede llegar como array directo, como {value:[...]}, o como objeto con detectedApps:[...]
            if (Array.isArray(d))                       return d;
            if (Array.isArray(d?.value))                return d.value;
            if (Array.isArray(d?.detectedApps))         return d.detectedApps;
            return [];
        };

        const v1Apps      = extract(v1Nav);
        const betaApps    = extract(betaNav);
        const expandApps  = extract(expanded);

        // Usar el resultado con más datos
        const apps = [v1Apps, betaApps, expandApps].reduce((best, cur) => cur.length > best.length ? cur : best, []);

        console.log(`[apps] device=${devId} v1=${v1Apps.length} beta=${betaApps.length} expand=${expandApps.length} → usando ${apps.length}`);

        const hint = apps.length === 0
            ? 'Intune no tiene inventario de apps para este dispositivo. Posibles causas: (1) El dispositivo necesita sincronizar — ve a Portal Intune → Dispositivos → [equipo] → Sincronizar. (2) Las apps detectadas requieren que el dispositivo sea MDM-enrolled y haya completado al menos un ciclo de inventario.'
            : null;

        res.json({ success: true, data: apps, hint });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/devices/:id/apps-debug — diagnóstico de apps ─────────────────
router.get('/devices/:id/apps-debug', authenticateToken, async (req, res) => {
    try {
        const uid   = req.user.id;
        const devId = req.params.id;
        const [v1Nav, betaNav, expanded, devInfo] = await Promise.allSettled([
            callGraph(uid, `/deviceManagement/managedDevices/${devId}/detectedApps?$top=5`),
            callGraph(uid, `/deviceManagement/managedDevices/${devId}/detectedApps?$top=5`, { beta: true }),
            callGraph(uid, `/deviceManagement/managedDevices/${devId}?$expand=detectedApps`, { beta: true }),
            callGraph(uid, `/deviceManagement/managedDevices/${devId}?$select=id,deviceName,operatingSystem,osVersion,managementState,managedDeviceOwnerType,enrolledDateTime,complianceState`),
        ]);
        res.json({
            deviceId: devId,
            deviceInfo: devInfo.status === 'fulfilled' ? devInfo.value : devInfo.reason?.message,
            v1Nav:      { status: v1Nav.status,     data: v1Nav.status      === 'fulfilled' ? v1Nav.value      : v1Nav.reason?.message },
            betaNav:    { status: betaNav.status,   data: betaNav.status    === 'fulfilled' ? betaNav.value    : betaNav.reason?.message },
            expanded:   { status: expanded.status,  data: expanded.status   === 'fulfilled' ? expanded.value   : expanded.reason?.message },
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/ms/devices/:id/bitlocker — Clave BitLocker ──────────────────────
router.get('/devices/:id/bitlocker', ...adminGuard, async (req, res) => {
    try {
        // Buscar por azureADDeviceId del dispositivo
        const dev = await callGraph(req.user.id, `/deviceManagement/managedDevices/${req.params.id}?$select=azureADDeviceId,deviceName`);
        const azureId = dev.azureADDeviceId;
        if (!azureId) return res.json({ success: true, data: [], deviceName: dev.deviceName });
        const keys = await callGraph(req.user.id,
            `/informationProtection/bitlocker/recoveryKeys?$filter=deviceId eq '${azureId}'&$select=id,createdDateTime,deviceId`
        );
        res.json({ success: true, data: keys.value || [], deviceName: dev.deviceName });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/teams — Teams activos ────────────────────────────────────────
router.get('/teams', ...adminGuard, async (req, res) => {
    try {
        const top = Math.min(parseInt(req.query.top) || 50, 200);
        const q   = req.query.q || '';
        let filter = `resourceProvisioningOptions/Any(x:x eq 'Team')`;
        if (q) filter += ` and startswith(displayName,'${encodeURIComponent(q)}')`;
        const data = await callGraph(req.user.id,
            `/groups?$filter=${filter}&$select=id,displayName,description,visibility,createdDateTime,mailNickname,mail&$top=${top}&$count=true`
        );
        res.json({ success: true, data: data.value || [], total: data['@odata.count'] || 0 });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/mailboxes — Buzones Exchange ──────────────────────────────────
router.get('/mailboxes', ...adminGuard, async (req, res) => {
    try {
        const top      = Math.min(parseInt(req.query.top) || 50, 200);
        const q        = req.query.q || '';
        const nextLink = req.query.nextLink || null;

        let path;
        if (nextLink) {
            path = nextLink;
        } else {
            const fields = 'id,displayName,userPrincipalName,mail,accountEnabled,assignedLicenses,mailboxSettings,department';
            path = `/users?$select=${fields}&$top=${top}&$filter=assignedLicenses/$count ne 0&$count=true`;
            if (q) path = `/users?$select=${fields}&$top=${top}&$filter=assignedLicenses/$count ne 0 and startswith(displayName,'${encodeURIComponent(q)}')&$count=true`;
        }
        const data = await callGraph(req.user.id, path);
        res.json({ success: true, data: data.value || [], total: data['@odata.count'] || 0, next: data['@odata.nextLink'] || null });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/reports/usage — Uso de aplicaciones M365 ─────────────────────
router.get('/reports/usage', ...adminGuard, async (req, res) => {
    try {
        // Usuarios activos por app en últimos 30 días
        const data = await callGraph(req.user.id, `/reports/getM365AppUserCounts(period='D30')`);
        res.json({ success: true, data });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/reports/signins-summary — Resumen de actividad ───────────────
router.get('/reports/signins-summary', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id, `/reports/getOffice365ActiveUserCounts(period='D30')`);
        res.json({ success: true, data });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/compliance — resumen de cumplimiento Intune ──────────────────
router.get('/compliance', ...adminGuard, async (req, res) => {
    try {
        const uid   = req.user.id;
        const state = req.query.state || '';
        const top   = Math.min(parseInt(req.query.top) || 50, 200);
        const skip  = parseInt(req.query.skip) || 0;
        const fields = 'id,deviceName,userDisplayName,userPrincipalName,complianceState,operatingSystem,osVersion,lastSyncDateTime,manufacturer,model';
        let path = `/deviceManagement/managedDevices?$select=${fields}&$top=${top}&$skip=${skip}&$orderby=complianceState,deviceName`;
        if (state) path += `&$filter=complianceState eq '${state}'`;

        const states = ['compliant', 'noncompliant', 'unknown', 'notApplicable', 'inGracePeriod', 'error'];
        // managedDevices/$count?$filter no funciona en Intune — usar lista completa y contar localmente
        const [devData, allDevStates] = await Promise.allSettled([
            callGraph(uid, path),
            callGraph(uid, '/deviceManagement/managedDevices?$select=id,complianceState&$top=999'),
        ]);
        const allDevs = allDevStates.status === 'fulfilled' ? (allDevStates.value?.value || []) : [];
        const summary = states.reduce((acc, s) => { acc[s] = 0; return acc; }, {});
        allDevs.forEach(d => { if (summary[d.complianceState] !== undefined) summary[d.complianceState]++; });
        const total   = allDevs.length;
        res.json({
            success: true,
            data:    devData.status === 'fulfilled' ? (devData.value?.value || []) : [],
            summary,
            total,
            next:    devData.status === 'fulfilled' ? (devData.value?.['@odata.nextLink'] || null) : null,
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/policies/compliance — políticas de cumplimiento Intune ────────
router.get('/policies/compliance', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id,
            '/deviceManagement/deviceCompliancePolicies?$select=id,displayName,description,lastModifiedDateTime,scheduledActionsForRule&$top=100'
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/policies/configuration — políticas de configuración Intune ────
router.get('/policies/configuration', ...adminGuard, async (req, res) => {
    try {
        const data = await callGraph(req.user.id,
            '/deviceManagement/deviceConfigurations?$select=id,displayName,description,lastModifiedDateTime,@odata.type&$top=100'
        );
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/apps/managed — aplicaciones administradas Intune ──────────────
router.get('/apps/managed', ...adminGuard, async (req, res) => {
    try {
        const q = req.query.q || '';
        let path = '/deviceAppManagement/mobileApps?$select=id,displayName,publisher,isAssigned,createdDateTime,lastModifiedDateTime,isFeatured,@odata.type&$top=100&$orderby=displayName';
        if (q) path += `&$filter=contains(displayName,'${q}')`;
        const data = await callGraph(req.user.id, path);
        res.json({ success: true, data: data.value || [] });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/windows-update — Update rings y configuraciones ───────────────
router.get('/windows-update', ...adminGuard, async (req, res) => {
    try {
        const uid = req.user.id;
        const [rings, deferral] = await Promise.allSettled([
            callGraph(uid, '/deviceManagement/windowsUpdateForBusinessConfigurations?$select=id,displayName,description,lastModifiedDateTime,businessReadyUpdatesOnly,deliveryOptimizationMode,driversExcluded,qualityUpdatesDeferralPeriodInDays,featureUpdatesDeferralPeriodInDays&$top=50'),
            callGraph(uid, '/deviceManagement/deviceEnrollmentConfigurations?$select=id,displayName,priority,deviceEnrollmentConfigurationType&$top=20'),
        ]);
        res.json({
            success: true,
            rings:   rings.status   === 'fulfilled' ? (rings.value?.value   || []) : [],
            configs: deferral.status === 'fulfilled' ? (deferral.value?.value || []) : [],
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/alerts — alertas agregadas ────────────────────────────────────
router.get('/alerts', ...adminGuard, async (req, res) => {
    try {
        const uid = req.user.id;
        const [ncDev, riskyH, skus] = await Promise.allSettled([
            callGraph(uid, `/deviceManagement/managedDevices?$filter=complianceState eq 'noncompliant'&$select=id,deviceName,userDisplayName,lastSyncDateTime&$top=15`),
            callGraph(uid, `/identityProtection/riskyUsers?$filter=riskLevel eq 'high' or riskLevel eq 'medium'&$select=id,userDisplayName,userPrincipalName,riskLevel,riskLastUpdatedDateTime&$top=15`),
            callGraph(uid, '/subscribedSkus?$select=skuPartNumber,consumedUnits,prepaidUnits,capabilityStatus'),
        ]);
        const ncDevices = ncDev.status  === 'fulfilled' ? (ncDev.value?.value  || []) : [];
        const risky     = riskyH.status === 'fulfilled' ? (riskyH.value?.value || []) : [];
        const skuList   = skus.status   === 'fulfilled' ? (skus.value?.value   || []) : [];

        const critLic = skuList.filter(s => {
            const total = s.prepaidUnits?.enabled || 0;
            return total > 0 && (s.consumedUnits / total) >= 0.85;
        }).map(s => ({ sku: s.skuPartNumber, used: s.consumedUnits, total: s.prepaidUnits?.enabled || 0, pct: Math.round(s.consumedUnits / (s.prepaidUnits?.enabled || 1) * 100) }));

        const alerts = [
            ...ncDevices.map(d => ({ type:'noncompliant', level:'warning', title:`Dispositivo no conforme: ${d.deviceName}`, detail: d.userDisplayName||'Sin usuario', date: d.lastSyncDateTime, panel:'compliance' })),
            ...risky.map(u => ({ type:'risky', level: u.riskLevel==='high'?'critical':'warning', title:`Usuario en riesgo (${u.riskLevel}): ${u.userDisplayName}`, detail: u.userPrincipalName, date: u.riskLastUpdatedDateTime, panel:'riskyusers' })),
            ...critLic.map(l => ({ type:'license', level: l.pct>=95?'critical':'warning', title:`Licencia al ${l.pct}%: ${l.sku}`, detail:`${l.used} de ${l.total} asignadas`, date: null, panel:'licenses' })),
        ].sort((a, b) => (a.level==='critical'?0:1) - (b.level==='critical'?0:1));

        res.json({ success: true, data: alerts, counts: { noncompliant: ncDevices.length, risky: risky.length, licensePressure: critLic.length } });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/users/:id/detail — detalle extendido para drill-down ──────────
router.get('/users/:id/detail', ...adminGuard, async (req, res) => {
    try {
        const uid  = req.user.id;
        const azId = req.params.id;
        const upn  = req.query.upn || azId;
        const [profile, grps, devs, signins, mfa] = await Promise.allSettled([
            callGraph(uid, `/users/${azId}?$select=id,displayName,userPrincipalName,mail,department,jobTitle,accountEnabled,createdDateTime,mobilePhone,officeLocation,usageLocation,city,country,companyName,employeeId,assignedLicenses,lastPasswordChangeDateTime`),
            callGraph(uid, `/users/${azId}/memberOf?$select=displayName,groupTypes&$top=20`),
            callGraph(uid, `/deviceManagement/managedDevices?$filter=userPrincipalName eq '${upn}'&$select=deviceName,complianceState,operatingSystem,lastSyncDateTime&$top=5`),
            callGraph(uid, `/auditLogs/signIns?$filter=userId eq '${azId}'&$top=5&$orderby=createdDateTime desc&$select=appDisplayName,status,createdDateTime,ipAddress,location`),
            callGraph(uid, `/reports/authenticationMethods/userRegistrationDetails?$filter=id eq '${azId}'&$select=isMfaRegistered,defaultMfaMethod,methodsRegistered`, { beta: true }),
        ]);
        res.json({
            success: true,
            profile:  profile.status  === 'fulfilled' ? profile.value                        : null,
            groups:   grps.status     === 'fulfilled' ? (grps.value?.value     || [])        : [],
            devices:  devs.status     === 'fulfilled' ? (devs.value?.value     || [])        : [],
            signins:  signins.status  === 'fulfilled' ? (signins.value?.value  || [])        : [],
            mfa:      mfa.status      === 'fulfilled' ? (mfa.value?.value?.[0] || null)      : null,
        });
    } catch(e) { handleGraphErr(e, res); }
});

// ── GET /api/ms/reports/trends — tendencias 30 días (CSV → JSON) ──────────────
router.get('/reports/trends', ...adminGuard, async (req, res) => {
    function parseCsv(raw) {
        if (!raw || typeof raw !== 'string') return [];
        const lines = raw.trim().split('\n').filter(Boolean);
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        return lines.slice(1).map(l => {
            const vals = l.split(',').map(v => v.trim().replace(/"/g, ''));
            return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
        });
    }
    try {
        const uid = req.user.id;
        const [active, services] = await Promise.allSettled([
            callGraph(uid, `/reports/getOffice365ActiveUserCounts(period='D30')`),
            callGraph(uid, `/reports/getOffice365ServicesUserCounts(period='D30')`),
        ]);
        const activeData   = active.status   === 'fulfilled' ? parseCsv(typeof active.value   === 'string' ? active.value   : JSON.stringify(active.value))   : [];
        const servicesData = services.status === 'fulfilled' ? parseCsv(typeof services.value === 'string' ? services.value : JSON.stringify(services.value)) : [];
        res.json({ success: true, active: activeData, services: servicesData });
    } catch(e) { handleGraphErr(e, res); }
});

// ── PATCH /api/ms/users — also support status filter ─────────────────────────
// (handled inline in existing GET /users route via query param)

module.exports = router;
