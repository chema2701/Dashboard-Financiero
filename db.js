const mysql = require('mysql2');
require('dotenv').config();

// Crear pool de conexiones (más eficiente que conexiones individuales)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Versión con promesas para usar async/await
const promisePool = pool.promise();

module.exports = promisePool;