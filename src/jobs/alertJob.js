'use strict';
const { evaluateAll } = require('../../services/alertEngine');
const meshSvc         = require('../../services/meshcentral');

let _io = null;
let _timer = null;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

async function runEvaluation() {
    try {
        await evaluateAll(_io, meshSvc);
    } catch (e) {
        // silencioso — el job no debe tumbar el servidor
    }
}

function startAlertJob(io) {
    _io = io;
    if (_timer) return;
    // Primera evaluación con delay de 2min para dar tiempo al servidor de arrancar
    setTimeout(() => {
        runEvaluation();
        _timer = setInterval(runEvaluation, INTERVAL_MS);
    }, 2 * 60 * 1000);
}

function stopAlertJob() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startAlertJob, stopAlertJob };
