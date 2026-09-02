const mysql = require('mysql2/promise');

async function createDB() {
    try {
        const connection = await mysql.createConnection({ host: 'localhost', user: 'root', password: '' });
        await connection.query('CREATE DATABASE IF NOT EXISTS load_africa;');
        console.log('Database load_africa created successfully or already exists.');
        await connection.end();
    } catch (e) {
        console.error('Error creating DB:', e);
    }
}

createDB();
