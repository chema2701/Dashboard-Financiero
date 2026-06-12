// scripts/descargar_datos.js
const YahooFinanceClass = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceClass();
const db = require('../db');  
require('dotenv').config();

// Configuración
const DIAS_MINIMOS = 365 * 10;        // Mínimo 10 años de datos (opcional para validar)
const BATCH_SIZE = 500;               // Insertar en lotes de 500 registros
const DELAY_MS = 1000;                // Esperar 1 segundo entre cada símbolo (evita bloqueos)
const MAX_REINTENTOS = 3;             // Reintentar hasta 3 veces si falla una descarga

// Fechas: desde 2005-01-01 hasta hoy
const FECHA_INICIO = new Date('2005-01-01');
const FECHA_FIN = new Date();

async function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function descargarConReintentos(ticker, opciones, intento = 1) {
    try {
        return await yahooFinance.historical(ticker, opciones);
    } catch (error) {
        if (intento < MAX_REINTENTOS) {
            console.log(`⚠️ Reintento ${intento} para ${ticker}...`);
            await esperar(DELAY_MS * intento);
            return descargarConReintentos(ticker, opciones, intento + 1);
        }
        throw error;
    }
}

async function insertarLotes(activoId, registros) {
    if (!registros.length) return 0;

    // Dividir en lotes de BATCH_SIZE
    const lotes = [];
    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
        lotes.push(registros.slice(i, i + BATCH_SIZE));
    }

    let totalInsertados = 0;
    for (const lote of lotes) {
        // Construir consulta de inserción múltiple
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
    await db.query(query, [activoId, fuenteId, registrosInsertados, estado, mensaje]);
}

async function main() {
    const connection = await db.getConnection(); // si usas pool, puedes obtener conexión

    try {
        // 1. Obtener fuente "Yahoo Finance" (suponiendo que ya existe id=1)
        const [fuenteRows] = await db.query(`SELECT id FROM fuentes_datos WHERE nombre = 'Yahoo Finance'`);
        let fuenteId = fuenteRows.length ? fuenteRows[0].id : null;
        if (!fuenteId) {
            // Insertar la fuente si no existe
            const [insertFuente] = await db.query(
                `INSERT INTO fuentes_datos (nombre, descripcion, url_base) VALUES (?, ?, ?)`,
                ['Yahoo Finance', 'Datos históricos vía API yahoo-finance2', 'https://finance.yahoo.com']
            );
            fuenteId = insertFuente.insertId;
        }

        // 2. Obtener todos los activos que tengan ticker_yahoo válido
        const [activos] = await db.query(`
            SELECT id, simbolo, ticker_yahoo 
            FROM activos 
            WHERE ticker_yahoo IS NOT NULL AND ticker_yahoo != ''
        `);
        console.log(`📊 Se encontraron ${activos.length} activos con ticker Yahoo.`);

        // 3. Recorrer cada activo
        for (const activo of activos) {
            console.log(`\n🔄 Procesando ${activo.simbolo} (${activo.ticker_yahoo})...`);

            try {
                const opciones = {
                    period1: FECHA_INICIO,
                    period2: FECHA_FIN,
                    interval: '1d'
                };

                const resultados = await descargarConReintentos(activo.ticker_yahoo, opciones);
                
                if (!resultados || resultados.length === 0) {
                    console.log(`⚠️ No se obtuvieron datos para ${activo.simbolo}`);
                    await registrarLog(activo.id, fuenteId, 0, 'error', 'Sin datos en la respuesta');
                    continue;
                }

                // Transformar datos al formato de nuestra tabla
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
                    console.log(`⚠️ No se pudieron formatear registros para ${activo.simbolo}`);
                    await registrarLog(activo.id, fuenteId, 0, 'error', 'Formato de datos inválido');
                    continue;
                }

                // Insertar en lotes
                const insertados = await insertarLotes(activo.id, registros);
                console.log(`✅ Insertados/actualizados ${insertados} registros para ${activo.simbolo} (total descargados: ${registros.length})`);

                // Registrar éxito
                await registrarLog(activo.id, fuenteId, registros.length, 'exito');

                // Esperar para no saturar la API
                await esperar(DELAY_MS);

            } catch (error) {
                console.error(`❌ Error con ${activo.simbolo}:`, error.message);
                await registrarLog(activo.id, fuenteId, 0, 'error', error.message);
            }
        }

        console.log('\n🎉 Proceso completado. Todos los datos históricos han sido descargados.');
    } catch (errorGeneral) {
        console.error('💥 Error fatal:', errorGeneral);
    } finally {
        if (connection) connection.release();
        process.exit(0);
    }
}

// Ejecutar el script
main();