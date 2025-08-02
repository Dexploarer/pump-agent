// Test SQLite client functionality using the bundled application
import { spawn } from 'child_process';

async function testSQLite() {
  console.log('Testing SQLite client through main application...');
  
  try {
    // Start the main application
    const app = spawn('node', ['dist/main.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' }
    });
    
    let output = '';
    let errorOutput = '';
    
    app.stdout.on('data', (data) => {
      output += data.toString();
      console.log('STDOUT:', data.toString());
    });
    
    app.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log('STDERR:', data.toString());
    });
    
    // Wait for application to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if database file was created
    const fs = await import('fs');
    const dbExists = fs.existsSync('./data/pump-agent.db');
    const dbSize = dbExists ? fs.statSync('./data/pump-agent.db').size : 0;
    
    console.log('Database file exists:', dbExists);
    console.log('Database file size:', dbSize, 'bytes');
    
    // Stop the application
    app.kill('SIGTERM');
    
    if (dbSize > 0) {
      console.log('✅ SQLite database initialized successfully');
    } else {
      console.log('❌ SQLite database not initialized');
    }
    
  } catch (error) {
    console.error('❌ SQLite test failed:', error);
  }
}

testSQLite(); 