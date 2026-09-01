'use strict';

// Caché compartida entre el router de MeshCentral y el motor de alertas
const _cache = new Map();

const TTL = {
    system:   30 * 60 * 1000,
    monitors:  4 * 60 * 60 * 1000,
    disk:     15 * 60 * 1000,
    updates:   8 * 60 * 60 * 1000,
    apps:      4 * 60 * 60 * 1000,
    hardware: 24 * 60 * 60 * 1000,
};

function get(nodeId, key) {
    const e = _cache.get(nodeId + ':' + key);
    if (!e || Date.now() > e.exp) { _cache.delete(nodeId + ':' + key); return null; }
    return e;
}

function set(nodeId, key, data) {
    const ttl = TTL[key] || 30 * 60 * 1000;
    _cache.set(nodeId + ':' + key, { data, cachedAt: new Date().toISOString(), exp: Date.now() + ttl });
}

function del(nodeId, key) {
    _cache.delete(nodeId + ':' + key);
}

function clear(nodeId) {
    for (const k of _cache.keys()) {
        if (k.startsWith(nodeId + ':')) _cache.delete(k);
    }
}

module.exports = { get, set, del, clear, _cache, TTL };
