'use strict';

const { EventEmitter2 } = require('eventemitter2');
const logger = require('../../utils/logger');

class EventBus extends EventEmitter2 {
  constructor() {
    super({
      wildcard:    true,
      delimiter:   '.',
      maxListeners: 20,
    });
  }

  /**
   * Registra un listener que nunca bloquea a otros.
   * Todos los listeners de un evento corren en paralelo con Promise.allSettled.
   */
  on(event, listener) {
    const safe = async (payload) => {
      try {
        await listener(payload);
      } catch (err) {
        logger.error(`[EventBus] listener error on "${event}":`, err.message);
      }
    };
    return super.on(event, safe);
  }

  /**
   * Emite el evento y espera a que todos los listeners terminen.
   * Usa Promise.allSettled — un listener fallido no bloquea los demás.
   */
  async emit(event, payload) {
    const listeners = this.listeners(event);
    await Promise.allSettled(listeners.map(fn => fn(payload)));
  }
}

module.exports = new EventBus();
