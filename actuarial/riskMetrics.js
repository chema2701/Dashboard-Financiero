// actuarial/riskMetrics.js
const ss = require('simple-statistics');

/**
 * Calcula rendimientos logarítmicos diarios a partir de precios de cierre
 * @param {Array} precios - Array de objetos con propiedad 'cierre' (orden cronológico ascendente)
 * @returns {Array} rendimientos logarítmicos (diarios)
 */
function calcularRendimientosLog(precios) {
    const rendimientos = [];
    for (let i = 1; i < precios.length; i++) {
        const precioAnterior = precios[i-1].cierre;
        const precioActual = precios[i].cierre;
        if (precioAnterior > 0 && precioActual > 0) {
            const rendLog = Math.log(precioActual / precioAnterior);
            rendimientos.push(rendLog);
        }
    }
    return rendimientos;
}

/**
 * Volatilidad histórica anualizada (desviación estándar * sqrt(252))
 */
function volatilidadAnualizada(rendimientosDiarios) {
    if (rendimientosDiarios.length < 2) return null;
    const stdDiaria = ss.standardDeviation(rendimientosDiarios);
    return stdDiaria * Math.sqrt(252);
}

/**
 * VaR Histórico
 * @param {Array} rendimientos - rendimientos diarios
 * @param {number} nivelConfianza - 0.95 o 0.99
 * @returns {number} VaR en términos absolutos (pérdida, negativo)
 */
function varHistorico(rendimientos, nivelConfianza) {
    if (!rendimientos.length) return null;
    // Ordenar de menor a mayor (peores pérdidas primero)
    const sorted = [...rendimientos].sort((a,b) => a - b);
    const index = Math.floor((1 - nivelConfianza) * sorted.length);
    const varDiario = sorted[index]; // valor negativo si hay pérdidas
    return varDiario;
}

/**
 * Expected Shortfall (TVaR) - promedio de los rendimientos que superan el VaR
 */
function expectedShortfall(rendimientos, nivelConfianza) {
    if (!rendimientos.length) return null;
    const sorted = [...rendimientos].sort((a,b) => a - b);
    const varIdx = Math.floor((1 - nivelConfianza) * sorted.length);
    // Para TVaR al 95%: promedio de los peores 5% de rendimientos
    const peores = sorted.slice(0, varIdx + 1);
    if (peores.length === 0) return null;
    const promedio = ss.mean(peores);
    return promedio;
}

/**
 *  * Máximo Drawdown
 *  * Retorna { drawdownMaximo, fechaPico, fechaValle }
 *  */
function maxDrawdown(precios) {
    if (precios.length < 2) return null;
    let pico = precios[0].cierre;
    let fechaPico = precios[0].fecha;
    let drawdownMax = 0;
    let valle = precios[0].cierre;
    let fechaValle = precios[0].fecha;
    
    let currentPico = pico;
    let currentFechaPico = fechaPico;
    
    for (let i = 1; i < precios.length; i++) {
        const precio = precios[i].cierre;
        if (precio > currentPico) {
            currentPico = precio;
            currentFechaPico = precios[i].fecha;
        }
        const drawdown = (currentPico - precio) / currentPico;
        if (drawdown > drawdownMax) {
            drawdownMax = drawdown;
            pico = currentPico;
            fechaPico = currentFechaPico;
            valle = precio;
            fechaValle = precios[i].fecha;
        }
    }
    return {
        drawdownMaximo: drawdownMax,
        pico,
        fechaPico,
        valle,
        fechaValle
    };
}

/**
 * Parámetros para Monte Carlo: drift (media de rendimientos) y volatilidad
 */
function parametrosMonteCarlo(rendimientos) {
    if (rendimientos.length < 2) return null;
    const media = ss.mean(rendimientos);
    const vol = ss.standardDeviation(rendimientos);
    return { driftDiario: media, volatilidadDiaria: vol };
}

/**
 * Simulación Monte Carlo (Geometric Brownian Motion)
 */
function simulacionMonteCarlo(precioInicial, driftDiario, volatilidadDiaria, dias, numTrayectorias = 50) {
    const trayectorias = [];
    // Generador de normales usando Box-Muller (nativo)
    const generarNormal = () => {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };
    
    for (let i = 0; i < numTrayectorias; i++) {
        const precios = [precioInicial];
        for (let t = 1; t <= dias; t++) {
            const epsilon = generarNormal();
            const precioAnterior = precios[t-1];
            const driftAjustado = driftDiario - (volatilidadDiaria * volatilidadDiaria) / 2;
            const incremento = driftAjustado + volatilidadDiaria * epsilon;
            const precioNuevo = precioAnterior * Math.exp(incremento);
            precios.push(precioNuevo);
        }
        trayectorias.push(precios);
    }
    return trayectorias;
}

/**
 * Calcular percentiles por día para las trayectorias
 */
function percentilesPorDia(trayectorias) {
    const dias = trayectorias[0].length;
    const numTray = trayectorias.length;
    const p5 = new Array(dias);
    const p50 = new Array(dias);
    const p95 = new Array(dias);
    
    for (let d = 0; d < dias; d++) {
        const preciosDia = trayectorias.map(t => t[d]);
        preciosDia.sort((a,b) => a - b);
        const idx5 = Math.floor(0.05 * numTray);
        const idx50 = Math.floor(0.50 * numTray);
        const idx95 = Math.floor(0.95 * numTray);
        p5[d] = preciosDia[idx5];
        p50[d] = preciosDia[idx50];
        p95[d] = preciosDia[idx95];
    }
    return { p5, p50, p95 };
}

module.exports = {
    calcularRendimientosLog,
    volatilidadAnualizada,
    varHistorico,
    expectedShortfall,
    maxDrawdown,
    parametrosMonteCarlo,
    simulacionMonteCarlo,
    percentilesPorDia
};