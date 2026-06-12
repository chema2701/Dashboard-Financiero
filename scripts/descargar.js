const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();
const db = require('../db');
require('dotenv').config();

const BATCH_SIZE = 500;
const DELAY_MS = 1000;
const MAX_REINTENTOS = 3;

async function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function descargarConReintentos(ticker, opciones, intento = 1) {
    try {
        return await yahooFinance.historical(ticker, opciones);
    } catch (error) {
        if (intento < MAX_REINTENTOS) {
            await esperar(DELAY_MS * intento);
            return descargarConReintentos(ticker, opciones, intento + 1);
        }
        throw error;
    }
}

async function insertarLotes(activoId, registros) {
    if (!registros.length) return 0;

    const lotes = [];

    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
        lotes.push(registros.slice(i, i + BATCH_SIZE));
    }

    let totalInsertados = 0;

    for (const lote of lotes) {
        const placeholders = lote.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');

        const valores = lote.flatMap(r => [
            activoId,
            r.fecha,
            r.apertura,
            r.maximo,
            r.minimo,
            r.cierre,
            r.volumen
        ]);

        const query = `
            INSERT INTO precios_historicos 
            (activo_id, fecha, apertura, maximo, minimo, cierre, volumen)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE
                apertura = VALUES(apertura),
                maximo = VALUES(maximo),
                minimo = VALUES(minimo),
                cierre = VALUES(cierre),
                volumen = VALUES(volumen)
        `;

        const [result] = await db.query(query, valores);
        totalInsertados += result.affectedRows;
    }

    return totalInsertados;
}

async function registrarLog(activoId, fuenteId, registrosInsertados, estado, mensaje = null) {
    const query = `
        INSERT INTO logs_descargas 
        (activo_id, fuente_id, registros_insertados, estado, mensaje) 
        VALUES (?, ?, ?, ?, ?)
    `;

    await db.query(query, [
        activoId,
        fuenteId,
        registrosInsertados,
        estado,
        mensaje
    ]);
}

async function descargarHistorialParaActivo(activoId, tickerYahoo, fuenteId) {
    const FECHA_INICIO = new Date('2005-01-01');
    const FECHA_FIN = new Date();

    try {
        const opciones = {
            period1: FECHA_INICIO,
            period2: FECHA_FIN,
            interval: '1d'
        };

        const resultados = await descargarConReintentos(tickerYahoo, opciones);

        if (!resultados || resultados.length === 0) {
            await registrarLog(activoId, fuenteId, 0, 'error', 'Sin datos');
            return false;
        }

        const registros = [];

        for (const item of resultados) {
            if (!item.date) continue;

            const fechaStr = item.date.toISOString().split('T')[0];

            registros.push({
                fecha: fechaStr,
                apertura: item.open ?? item.close,
                maximo: item.high ?? item.close,
                minimo: item.low ?? item.close,
                cierre: item.close,
                volumen: item.volume ?? 0
            });
        }

        if (registros.length === 0) {
            await registrarLog(activoId, fuenteId, 0, 'error', 'Formato inválido');
            return false;
        }

        await insertarLotes(activoId, registros);
        await registrarLog(activoId, fuenteId, registros.length, 'exito');

        return true;
    } catch (error) {
    console.error(`❌ Error descargando ${tickerYahoo}:`, error.message);
    await registrarLog(activoId, fuenteId, 0, 'error', error.message);
    return false;
    }
}

async function obtenerFuenteId() {
    const [rows] = await db.query(`
        SELECT id 
        FROM fuentes_datos 
        WHERE nombre = 'Yahoo Finance'
    `);

    if (rows.length) return rows[0].id;

    const [insert] = await db.query(
        `
        INSERT INTO fuentes_datos 
        (nombre, descripcion, url_base) 
        VALUES (?, ?, ?)
        `,
        [
            'Yahoo Finance',
            'Datos históricos vía API yahoo-finance2',
            'https://finance.yahoo.com'
        ]
    );

    return insert.insertId;
}

async function actualizarTodosLosActivos() {
    const fuenteId = await obtenerFuenteId();

    const [activos] = await db.query(`
        SELECT id, ticker_yahoo 
        FROM activos 
        WHERE ticker_yahoo IS NOT NULL 
        AND ticker_yahoo != ''
    `);

    const resultados = {
        total: activos.length,
        exitosos: 0,
        fallidos: 0
    };

    for (const activo of activos) {
    console.log(`🔄 Actualizando activo ID ${activo.id} - ${activo.ticker_yahoo}`);

    const exito = await descargarHistorialParaActivo(
        activo.id,
        activo.ticker_yahoo,
        fuenteId
    );

    console.log(
        exito
            ? `✅ Actualizado correctamente: ${activo.ticker_yahoo}`
            : `❌ Falló la actualización: ${activo.ticker_yahoo}`
    );

        if (exito) {
            resultados.exitosos++;
        } else {
            resultados.fallidos++;
        }

        await esperar(DELAY_MS);
    }

    return resultados;
}

async function descargarYGuardarNuevoActivo(activoId, tickerYahoo) {
    const fuenteId = await obtenerFuenteId();
    return await descargarHistorialParaActivo(activoId, tickerYahoo, fuenteId);
}

module.exports = {
    actualizarTodosLosActivos,
    descargarYGuardarNuevoActivo
};