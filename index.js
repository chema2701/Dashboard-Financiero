const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');
const actuarial = require('./actuarial/riskMetrics');

const {
    actualizarTodosLosActivos,
    descargarYGuardarNuevoActivo
} = require('./scripts/descargar');

const app = express();
const PORT = process.env.PORT || 3001;

// ========== MIDDLEWARES GLOBALES ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta raíz de prueba para verificar el estado de la API
app.get('/', (req, res) => {
    res.json({ mensaje: 'API Finanzas MX funcionando' });
});

// ========== ENDPOINTS PRINCIPALES ==========

// 1. Obtener todos los activos (tickers)
app.get('/api/activos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM activos ORDER BY simbolo');
        res.json({ exito: true, datos: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// 2. Obtener precios históricos por símbolo o ticker_yahoo
app.get('/api/precios', async (req, res) => {
    try {
        const { simbolo, ticker_yahoo, limite = 100 } = req.query;
        
        if (!simbolo && !ticker_yahoo) {
            return res.status(400).json({ 
                exito: false, 
                error: 'Se requiere símbolo o ticker_yahoo' 
            });
        }

        let query = `
            SELECT h.fecha, h.apertura, h.maximo, h.minimo, h.cierre, 
                   h.cierre_ajustado, h.volumen, a.simbolo, a.nombre
            FROM precios_historicos h
            JOIN activos a ON h.activo_id = a.id
        `;
        const params = [];

        if (simbolo) {
            query += ' WHERE a.simbolo = ?';
            params.push(simbolo);
        } else {
            query += ' WHERE a.ticker_yahoo = ?';
            params.push(ticker_yahoo);
        }

        query += ' ORDER BY h.fecha DESC LIMIT ?';
        params.push(parseInt(limite));

        const [rows] = await db.query(query, params);
        res.json({ exito: true, datos: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// 3. Obtener rango de fechas específico
app.get('/api/precios/rango', async (req, res) => {
    try {
        const { simbolo, fecha_inicio, fecha_fin } = req.query;
        
        if (!simbolo || !fecha_inicio || !fecha_fin) {
            return res.status(400).json({ 
                exito: false, 
                error: 'Faltan parámetros: simbolo, fecha_inicio, fecha_fin' 
            });
        }

        const query = `
            SELECT h.fecha, h.apertura, h.maximo, h.minimo, h.cierre, 
                   h.cierre_ajustado, h.volumen, a.simbolo, a.nombre
            FROM precios_historicos h
            JOIN activos a ON h.activo_id = a.id
            WHERE a.simbolo = ? AND h.fecha BETWEEN ? AND ?
            ORDER BY h.fecha ASC
        `;
        const [rows] = await db.query(query, [simbolo, fecha_inicio, fecha_fin]);
        res.json({ exito: true, datos: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// 4. Obtener tipo de cambio USD/MXN
app.get('/api/tipo-cambio', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, limite = 100 } = req.query;
        let query = 'SELECT fecha, usd_mxn FROM tipo_cambio ORDER BY fecha DESC';
        const params = [];

        if (fecha_inicio && fecha_fin) {
            query = 'SELECT fecha, usd_mxn FROM tipo_cambio WHERE fecha BETWEEN ? AND ? ORDER BY fecha ASC';
            params.push(fecha_inicio, fecha_fin);
        } else if (fecha_inicio) {
            query = 'SELECT fecha, usd_mxn FROM tipo_cambio WHERE fecha >= ? ORDER BY fecha ASC';
            params.push(fecha_inicio);
        } else if (fecha_fin) {
            query = 'SELECT fecha, usd_mxn FROM tipo_cambio WHERE fecha <= ? ORDER BY fecha DESC';
            params.push(fecha_fin);
        } else {
            query += ' LIMIT ?';
            params.push(parseInt(limite));
        }

        const [rows] = await db.query(query, params);
        res.json({ exito: true, datos: rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// 5. Estadísticas básicas de un activo
app.get('/api/estadisticas/:simbolo', async (req, res) => {
    try {
        const { simbolo } = req.params;
        
        const query = `
            SELECT 
                a.simbolo,
                a.nombre,
                (SELECT cierre FROM precios_historicos WHERE activo_id = a.id ORDER BY fecha DESC LIMIT 1) AS ultimo_cierre,
                (SELECT fecha FROM precios_historicos WHERE activo_id = a.id ORDER BY fecha DESC LIMIT 1) AS ultima_fecha,
                MIN(h.cierre) AS minimo_historico,
                MAX(h.cierre) AS maximo_historico,
                AVG(h.cierre) AS promedio_cierre,
                COUNT(*) AS total_dias
            FROM activos a
            JOIN precios_historicos h ON a.id = h.activo_id
            WHERE a.simbolo = ?
            GROUP BY a.id
        `;
        
        const [rows] = await db.query(query, [simbolo]);
        
        if (rows.length === 0) {
            return res.status(404).json({ 
                exito: false, 
                error: 'Activo no encontrado o sin datos históricos' 
            });
        }
        
        res.json({ exito: true, datos: rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// ------------------- ENDPOINTS ACTUARIALES -------------------

// 6. Métricas de riesgo actuarial (VaR, ES, Max Drawdown)
app.get('/api/riesgo/:activoId', async (req, res) => {
    const { activoId } = req.params;
    try {
        const [precios] = await db.query(
            `SELECT fecha, cierre FROM precios_historicos 
             WHERE activo_id = ? ORDER BY fecha ASC`,
            [activoId]
        );
        if (!precios || precios.length < 2) {
            return res.status(404).json({ error: 'No hay suficientes datos históricos para este activo' });
        }

        const rendimientos = actuarial.calcularRendimientosLog(precios);
        if (rendimientos.length === 0) {
            return res.status(422).json({ error: 'No se pudieron calcular rendimientos' });
        }

        const volAnual = actuarial.volatilidadAnualizada(rendimientos);
        const var95 = actuarial.varHistorico(rendimientos, 0.95);
        const var99 = actuarial.varHistorico(rendimientos, 0.99);
        const tvar95 = actuarial.expectedShortfall(rendimientos, 0.95);
        const tvar99 = actuarial.expectedShortfall(rendimientos, 0.99);
        const drawdownInfo = actuarial.maxDrawdown(precios);

        res.json({
            activoId,
            volatilidadAnualizada: volAnual,
            valueAtRisk: {
                confidence_95: var95,
                confidence_99: var99
            },
            expectedShortfall: {
                confidence_95: tvar95,
                confidence_99: tvar99
            },
            maxDrawdown: drawdownInfo
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 7. Simulación Estocástica de Montecarlo (Proyección 30 días - Formato Integrado)
app.get('/api/simulacion/:activoId', async (req, res) => {
    const { activoId } = req.params;
    const dias = 30; // Forzamos 30 días para que cuadre con tu front
    const numTrayectorias = 100; // Un buen número para estabilidad y rendimiento

    try {
        // 1. Obtener precios de la base de datos
        const [precios] = await db.query(
            `SELECT fecha, cierre FROM precios_historicos 
             WHERE activo_id = ? ORDER BY fecha ASC`,
            [activoId]
        );
        if (!precios || precios.length < 2) {
            return res.status(404).json({ exito: false, error: 'Datos históricos insuficientes' });
        }

        const ultimoPrecio = precios[precios.length - 1].cierre;
        const rendimientos = actuarial.calcularRendimientosLog(precios);
        const params = actuarial.parametrosMonteCarlo(rendimientos);
        if (!params) {
            return res.status(422).json({ exito: false, error: 'No se pueden estimar drift/volatilidad' });
        }

        const { driftDiario, volatilidadDiaria } = params;

        // 2. Simular trayectorias aleatorias usando tu módulo actuarial
        const trayectorias = actuarial.simulacionMonteCarlo(
            ultimoPrecio, driftDiario, volatilidadDiaria, dias, numTrayectorias
        );

        // 3. Agrupar resultados por percentiles actuariales
        const percentiles = actuarial.percentilesPorDia(trayectorias);

        // 4. Formatear la respuesta EXACTAMENTE como la espera tu app.js en el frontend
        res.json({
            exito: true,
            datos: {
                media: percentiles.p50,        // La mediana/esperado funciona como tu trayectoria media
                percentil95: percentiles.p95,  // Escenario Optimista
                percentil5: percentiles.p5     // Escenario Pesimista
            }
        });

    } catch (error) {
        console.error("Error en la simulación de Montecarlo:", error);
        res.status(500).json({ exito: false, error: error.message });
    }
});

// ========== ENDPOINTS ADMINISTRATIVOS ==========

// Actualizar todos los datos históricos desde Yahoo Finance
app.post('/api/actualizar-datos', async (req, res) => {
    try {
        const resultados = await actualizarTodosLosActivos();

        res.json({
            exito: true,
            mensaje: 'Actualización completada',
            resultados
        });
    } catch (error) {
        console.error('Error actualizando datos:', error);
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// Agregar un nuevo activo y descargar su historial
app.post('/api/activos', async (req, res) => {
    const { simbolo, nombre, ticker_yahoo } = req.body;

    if (!simbolo || !nombre || !ticker_yahoo) {
        return res.status(400).json({
            exito: false,
            error: 'Faltan campos: simbolo, nombre, ticker_yahoo'
        });
    }

    const simboloUpper = simbolo.toUpperCase().trim();
    const nombreTrim = nombre.trim();
    const tickerYahooTrim = ticker_yahoo.trim();

    try {
        const [existe] = await db.query(
            'SELECT id FROM activos WHERE simbolo = ? OR ticker_yahoo = ?',
            [simboloUpper, tickerYahooTrim]
        );

        if (existe.length > 0) {
            return res.status(409).json({
                exito: false,
                error: 'El símbolo o ticker ya existe'
            });
        }

        const [insertResult] = await db.query(
            `
            INSERT INTO activos 
            (simbolo, nombre, ticker_yahoo, tipo, moneda, pais) 
            VALUES (?, ?, ?, ?, ?, ?)
            `,
            [simboloUpper, nombreTrim, tickerYahooTrim, 'accion', 'MXN', 'México']
        );

        const nuevoId = insertResult.insertId;

        const exitoDescarga = await descargarYGuardarNuevoActivo(
            nuevoId,
            tickerYahooTrim
        );

        if (!exitoDescarga) {
            return res.status(207).json({
                exito: true,
                mensaje: 'Activo creado pero la descarga de datos falló',
                activoId: nuevoId
            });
        }

        res.json({
            exito: true,
            mensaje: 'Activo agregado y datos históricos descargados',
            activoId: nuevoId
        });

    } catch (error) {
        console.error('Error agregando activo:', error);
        res.status(500).json({
            exito: false,
            error: error.message
        });
    }
});

// ========== INICIAR SERVIDOR (SIEMPRE AL FINAL) ==========
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});