#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting Pump Agent with data collection...');
console.log('📊 This will collect real token data from PumpPortal');
console.log('⏹️  Press Ctrl+C to stop\n');

// Build the application
console.log('🔨 Building application...');
const buildProcess = spawn('bun', ['build', 'src/main.ts', '--outdir', 'dist', '--target', 'node'], {
  stdio: 'inherit',
  cwd: join(__dirname)
});

buildProcess.on('close', (code) => {
  if (code === 0) {
    console.log('✅ Build successful!');
    console.log('🚀 Starting application with Node.js...\n');
    
    // Run the application with Node.js
    const appProcess = spawn('node', ['dist/main.js'], {
      stdio: 'inherit',
      cwd: join(__dirname)
    });
    
    appProcess.on('close', (appCode) => {
      console.log(`\n📊 Application exited with code ${appCode}`);
    });
    
    appProcess.on('error', (error) => {
      console.error('❌ Failed to start application:', error.message);
    });
    
  } else {
    console.error('❌ Build failed with code:', code);
  }
});

buildProcess.on('error', (error) => {
  console.error('❌ Failed to run build:', error.message);
}); 