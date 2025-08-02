import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testSQLiteSimple() {
  console.log('Testing SQLite client directly...');
  
  try {
    const dbPath = join(__dirname, 'data', 'test-sqlite.db');
    console.log('Database path:', dbPath);
    
    const db = new Database(dbPath);
    console.log('✅ SQLite database created successfully');
    
    // Test creating a table
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table created successfully');
    
    // Test inserting data
    const stmt = db.prepare('INSERT INTO test_table (name, value) VALUES (?, ?)');
    stmt.run('test', 123.45);
    console.log('✅ Data inserted successfully');
    
    // Test querying data
    const rows = db.prepare('SELECT * FROM test_table').all();
    console.log('✅ Data queried successfully:', rows.length, 'rows');
    
    db.close();
    console.log('✅ SQLite test completed successfully');
    
  } catch (error) {
    console.error('❌ SQLite test failed:', error);
  }
}

testSQLiteSimple(); 