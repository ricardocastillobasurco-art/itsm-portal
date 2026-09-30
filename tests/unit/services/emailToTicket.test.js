'use strict';

jest.mock('../../../config/database', () => ({ equipmentPool: {}, executeQuery: jest.fn() }));

const { stripQuoted, ignoreReason, allowedDomains, KEY_RE } = require('../../../src/services/emailToTicket/EmailToTicketService');

const tenant = { id: 7, domain: 'cliente.com' };
const msg = (over = {}) => ({ from: { email: 'ana@cliente.com' }, subject: 'Falla', text: 'x', autoSubmitted: false, ...over });

describe('correo a ticket — reglas', () => {
  it('acepta correos del dominio de la empresa', () => {
    expect(ignoreReason(msg(), {}, tenant)).toBeNull();
  });

  it('rechaza otros dominios salvo que se permitan', () => {
    expect(ignoreReason(msg({ from: { email: 'x@gmail.com' } }), {}, tenant)).toBe('dominio no autorizado');
    expect(ignoreReason(msg({ from: { email: 'x@gmail.com' } }), { allowed_domains: 'gmail.com, cliente.com' }, tenant)).toBeNull();
    expect(ignoreReason(msg({ from: { email: 'x@otro.pe' } }), { allowed_domains: '*' }, tenant)).toBeNull();
  });

  it('ignora respuestas automáticas y remitentes de sistema (evita bucles)', () => {
    expect(ignoreReason(msg({ autoSubmitted: true }), {}, tenant)).toBe('respuesta automática');
    expect(ignoreReason(msg({ subject: 'Automatic reply: vacaciones' }), {}, tenant)).toBe('respuesta automática');
    expect(ignoreReason(msg({ from: { email: 'no-reply@cliente.com' } }), {}, tenant)).toBe('remitente automático');
    expect(ignoreReason(msg({ from: { email: 'soporte@cliente.com' } }), { mailbox: 'Soporte@cliente.com' }, tenant)).toBe('enviado por el propio buzón');
  });

  it('allowedDomains normaliza la lista', () => {
    expect(allowedDomains({ allowed_domains: '@A.com; b.pe' }, tenant)).toEqual(['a.com', 'b.pe']);
    expect(allowedDomains({}, tenant)).toEqual(['cliente.com']);
    expect(allowedDomains({ allowed_domains: '*' }, tenant)).toBeNull();
  });

  it('recorta el texto citado de una respuesta', () => {
    expect(stripQuoted('Sigue fallando\n\nEl lun, 30 sep escribió:\n> anterior')).toBe('Sigue fallando');
    expect(stripQuoted('Ok\n-----Original Message-----\nFrom: x')).toBe('Ok');
    expect(stripQuoted('Solo texto')).toBe('Solo texto');
  });

  it('detecta la clave del ticket en el asunto', () => {
    expect('RE: [TK-0061] Recibimos tu solicitud'.match(KEY_RE)[1]).toBe('TK-0061');
    expect('Fwd: inc-1234 pendiente'.match(KEY_RE)[1].toUpperCase()).toBe('INC-1234');
    expect('Sin clave aquí'.match(KEY_RE)).toBeNull();
    // Numeración por empresa
    expect('RE: [TK-ACME-0042] Recibimos tu incidencia'.match(KEY_RE)[1]).toBe('TK-ACME-0042');
    expect('Re: RQ-P77-0001 aprobado'.match(KEY_RE)[1]).toBe('RQ-P77-0001');
  });
});
