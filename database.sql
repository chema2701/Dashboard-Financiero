-- 1. Crear la base de datos (si no existe)
CREATE DATABASE IF NOT EXISTS finanzas_mx;
USE finanzas_mx;

-- 2. Tabla de activos (instrumentos financieros)
CREATE TABLE IF NOT EXISTS activos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    simbolo VARCHAR(20) NOT NULL UNIQUE COMMENT 'Símbolo local (ej. AMX)',
    nombre VARCHAR(200) NOT NULL,
    tipo ENUM('accion', 'indice', 'etf', 'fx') DEFAULT 'accion',
    moneda CHAR(3) DEFAULT 'MXN',
    pais VARCHAR(50) DEFAULT 'México',
    ticker_yahoo VARCHAR(20) COMMENT 'Símbolo en Yahoo Finance (ej. AMX.MX)',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de precios históricos (diarios)
CREATE TABLE IF NOT EXISTS precios_historicos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activo_id INT NOT NULL,
    fecha DATE NOT NULL,
    apertura DECIMAL(12,4),
    maximo DECIMAL(12,4),
    minimo DECIMAL(12,4),
    cierre DECIMAL(12,4),
    cierre_ajustado DECIMAL(12,4),
    volumen BIGINT,
    UNIQUE KEY uk_activo_fecha (activo_id, fecha),
    FOREIGN KEY (activo_id) REFERENCES activos(id) ON DELETE CASCADE
);

-- 4. Tabla de tipo de cambio (útil para convertir precios en USD a MXN)
CREATE TABLE IF NOT EXISTS tipo_cambio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL UNIQUE,
    usd_mxn DECIMAL(10,4) NOT NULL COMMENT 'Tipo de cambio USD/MXN (cierre)',
    fuente VARCHAR(100) DEFAULT 'Banxico'
);

-- 5. Tabla de fuentes de datos (para auditoría)
CREATE TABLE IF NOT EXISTS fuentes_datos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    url_base VARCHAR(255)
);

-- 6. Tabla de logs de descargas (registro de cada carga)
CREATE TABLE IF NOT EXISTS logs_descargas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha_ejecucion DATETIME DEFAULT CURRENT_TIMESTAMP,
    activo_id INT,
    fuente_id INT,
    registros_insertados INT,
    estado ENUM('exito', 'error') DEFAULT 'exito',
    mensaje TEXT,
    FOREIGN KEY (activo_id) REFERENCES activos(id),
    FOREIGN KEY (fuente_id) REFERENCES fuentes_datos(id)
);

-- 7. Insertar las 20 activos mexicanos (con sus tickers de Yahoo Finance)
INSERT INTO activos (simbolo, nombre, tipo, moneda, ticker_yahoo) VALUES
('MXN=X', 'Tipo de Cambio USD/MXN', 'fx', 'MXN', 'MXN=X'),
('^MXX', 'Índice de Precios y Cotizaciones (IPC)', 'indice', 'MXN', '^MXX'),
('WALMEX', 'Wal-Mart de México', 'accion', 'MXN', 'WALMEX.MX'),
('AMX', 'América Móvil', 'accion', 'MXN', 'AMX.MX'),
('GFNORTEO', 'Grupo Financiero Banorte', 'accion', 'MXN', 'GFNORTEO.MX'),
('FEMSAUBD', 'Fomento Económico Mexicano (FEMSA)', 'accion', 'MXN', 'FEMSAUBD.MX'),
('CEMEXCPO', 'Cemex', 'accion', 'MXN', 'CEMEXCPO.MX'),
('GMEXICOB', 'Grupo México', 'accion', 'MXN', 'GMEXICOB.MX'),
('BIMBOA', 'Grupo Bimbo', 'accion', 'MXN', 'BIMBOA.MX'),
('KIMBERA', 'Kimberly-Clark de México', 'accion', 'MXN', 'KIMBERA.MX'),
('ALFAA', 'Alfa', 'accion', 'MXN', 'ALFAA.MX'),
('GCARSOA1', 'Grupo Carso', 'accion', 'MXN', 'GCARSOA1.MX'),
('PE&OLES', 'Industrias Peñoles', 'accion', 'MXN', 'PE&OLES.MX'),
('TLEVISACPO', 'Grupo Televisa', 'accion', 'MXN', 'TLEVISACPO.MX'),
('ELEKTRA', 'Grupo Elektra', 'accion', 'MXN', 'ELEKTRA.MX'),
('BBAJIOO', 'Banco del Bajío', 'accion', 'MXN', 'BBAJIOO.MX'),
('LABB', 'Genomma Lab Internacional', 'accion', 'MXN', 'LABB.MX'),
('FIBRAUNO', 'Fibra Uno', 'accion', 'MXN', 'FIBRAUNO.MX'),
('QX', 'Qualitas Controladora', 'accion', 'MXN', 'QX.MX'),
('BOLSAA', 'Bolsa Mexicana de Valores', 'accion', 'MXN', 'BOLSAA.MX');

-- 8. Insertar una fuente de datos (por ejemplo, Yahoo Finance)
INSERT INTO fuentes_datos (nombre, descripcion, url_base) VALUES
('Yahoo Finance', 'Datos históricos descargados manualmente desde finance.yahoo.com', 'https://finance.yahoo.com');

-- 9. Crear índices para mejorar el rendimiento (opcional pero recomendado)
CREATE INDEX idx_precios_fecha ON precios_historicos(fecha);
CREATE INDEX idx_precios_activo ON precios_historicos(activo_id);


-- REQUERIMIENTO: Insertar el histórico de WALMEX usando el id de la tabla activos
-- Ejecuta este bloque después de haber corrido los inserts de activos de DeepSeek

INSERT INTO precios_historicos (activo_id, fecha, apertura, maximo, minimo, cierre, volumen)
SELECT id, '2005-01-03', 11.2000, 11.3500, 11.1500, 11.2800, 8500000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2006-01-03', 15.4000, 15.6500, 15.3000, 15.5200, 9200000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2007-01-03', 22.1000, 22.4000, 21.9000, 22.2500, 10500000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2008-01-03', 19.8000, 20.1500, 19.5000, 19.7500, 12100000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2009-01-02', 17.1500, 17.5000, 17.0000, 17.4000, 7800000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2010-01-04', 28.3000, 28.9000, 28.1500, 28.7500, 14300000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2011-01-03', 35.1000, 35.6000, 34.9000, 35.3500, 11200000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2012-01-02', 36.4500, 37.1000, 36.3000, 36.9000, 9800000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2013-01-02', 42.1500, 42.8000, 41.9500, 42.5000, 13400000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2014-01-02', 34.2000, 34.7000, 33.9000, 34.1500, 15600000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2015-01-02', 31.1000, 31.6500, 30.9000, 31.3200, 11900000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2015-10-31', 58.4000, 59.2000, 58.0000, 58.6500, 16300000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2015-12-31', 61.2000, 61.8000, 60.9000, 61.4000, 10200000 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2026-05-18', 54.4700, 56.7200, 54.4700, 55.9600, 23129821 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2026-05-19', 55.4500, 56.8400, 55.3400, 55.5000, 27306707 FROM activos WHERE ticker_yahoo = 'WALMEX.MX' UNION ALL
SELECT id, '2026-05-20', 55.3500, 56.1900, 55.1000, 55.6500, 27459617 FROM activos WHERE ticker_yahoo = 'WALMEX.MX';