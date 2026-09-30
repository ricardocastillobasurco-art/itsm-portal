'use strict';

const box = require('../../../src/utils/secretBox');

describe('secretBox — cifrado de credenciales de integraciones', () => {
  const env = process.env.CONFIG_ENCRYPTION_KEY;
  afterEach(() => { if (env === undefined) delete process.env.CONFIG_ENCRYPTION_KEY; else process.env.CONFIG_ENCRYPTION_KEY = env; });

  it('cifra solo los campos sensibles y los recupera', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'clave-de-prueba';
    const sealed = box.sealConfig({ base_url: 'https://x.atlassian.net', api_token: 't0k3n', clientSecret: 's3cr3t' });
    expect(sealed.base_url).toBe('https://x.atlassian.net');
    expect(sealed.api_token.startsWith(box.PREFIX)).toBe(true);
    expect(sealed.clientSecret).not.toContain('s3cr3t');
    expect(box.openConfig(sealed)).toEqual({ base_url: 'https://x.atlassian.net', api_token: 't0k3n', clientSecret: 's3cr3t' });
  });

  it('cada cifrado es distinto (IV aleatorio) y no se re-cifra', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'clave-de-prueba';
    const a = box.encrypt('mismo'), b = box.encrypt('mismo');
    expect(a).not.toBe(b);
    expect(box.encrypt(a)).toBe(a);
  });

  it('lee valores antiguos en claro', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'clave-de-prueba';
    expect(box.openConfig({ api_token: 'plano' })).toEqual({ api_token: 'plano' });
  });

  it('sin clave guarda en claro (compatibilidad) ', () => {
    delete process.env.CONFIG_ENCRYPTION_KEY;
    expect(box.sealConfig({ api_token: 'plano' })).toEqual({ api_token: 'plano' });
  });

  it('con otra clave no revela el secreto', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'clave-A';
    const sealed = box.sealConfig({ api_token: 'secreto' });
    process.env.CONFIG_ENCRYPTION_KEY = 'clave-B';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(box.openConfig(sealed).api_token).toBe('');
  });
});
