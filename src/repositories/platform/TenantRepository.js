'use strict';

const { equipmentPool, executeQuery } = require('../../../config/database');

const DEFAULT_TENANT = {
  id:   1,
  slug: process.env.DEFAULT_TENANT_SLUG || 'default',
  name: process.env.DEFAULT_TENANT_NAME || 'Default',
  plan: 'enterprise',
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — aligns with prompt-cache TTL

// Simple in-memory cache keyed by id and slug.
// Tenants change rarely; this eliminates 2 DB round-trips per request.
const _cache = new Map();

function _cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return undefined; }
  return entry.value;
}

function _cacheInvalidate(id, slug) {
  if (id)   _cache.delete(`id:${id}`);
  if (slug) _cache.delete(`slug:${slug}`);
}

async function q(sql, params = []) {
  return executeQuery(equipmentPool, sql, params);
}

function parseSettings(row) {
  if (!row) return null;
  if (row.settings && typeof row.settings === 'string') {
    try { row.settings = JSON.parse(row.settings); } catch { row.settings = {}; }
  }
  return row;
}

class TenantRepository {
  async findById(id) {
    const cacheKey = `id:${id}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const [row] = await q(
      'SELECT id, slug, name, plan, settings, is_active FROM tenants WHERE id = ? AND is_active = 1 LIMIT 1',
      [id]
    );
    const result = parseSettings(row || null);
    _cacheSet(cacheKey, result);
    if (result?.slug) _cacheSet(`slug:${result.slug}`, result);
    return result;
  }

  async findBySlug(slug) {
    const cacheKey = `slug:${slug}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const [row] = await q(
      'SELECT id, slug, name, plan, settings, is_active FROM tenants WHERE slug = ? AND is_active = 1 LIMIT 1',
      [slug]
    );
    const result = parseSettings(row || null);
    _cacheSet(cacheKey, result);
    if (result?.id) _cacheSet(`id:${result.id}`, result);
    return result;
  }

  async findAll() {
    return q('SELECT id, slug, name, plan, is_active, created_at FROM tenants ORDER BY id ASC');
  }

  async create({ slug, name, plan = 'enterprise', settings = null }) {
    const result = await q(
      'INSERT INTO tenants (slug, name, plan, settings) VALUES (?, ?, ?, ?)',
      [slug, name, plan, settings ? JSON.stringify(settings) : null]
    );
    return result.insertId;
  }

  async updateSettings(id, settings) {
    await q(
      'UPDATE tenants SET settings = ? WHERE id = ?',
      [JSON.stringify(settings), id]
    );
    // Invalidate so next request reads fresh data (including new Graph config)
    const cached = _cacheGet(`id:${id}`);
    _cacheInvalidate(id, cached?.slug);
  }

  default() {
    return { ...DEFAULT_TENANT };
  }

  /** Only call from test suites — clears in-memory cache state. */
  _resetCacheForTest() {
    _cache.clear();
  }
}

module.exports = new TenantRepository();
