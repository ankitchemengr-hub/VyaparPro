require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

client.connect()
  .then(() => {
    console.log('✅ SUCCESS! Connected to PostgreSQL locally!');
    client.end();
  })
  .catch(err => {
    console.error('❌ FAILED:', err.message);
  });