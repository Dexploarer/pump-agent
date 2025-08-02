#!/usr/bin/env node

/**
 * Deployment Readiness Check Script
 * Verifies all components are properly configured for 24/7 deployment
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = join(__dirname, '..');

console.log('🔍 Pump Agent Deployment Readiness Check');
console.log('========================================\n');

let allChecksPassed = true;

// Check 1: Package.json exists and has required scripts
console.log('1. Checking package.json...');
try {
  const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'));
  
  const requiredScripts = ['build', 'start', 'test', 'lint'];
  const missingScripts = requiredScripts.filter(script => !packageJson.scripts[script]);
  
  if (missingScripts.length > 0) {
    console.log('❌ Missing required scripts:', missingScripts);
    allChecksPassed = false;
  } else {
    console.log('✅ Package.json scripts are properly configured');
  }
} catch (error) {
  console.log('❌ Failed to read package.json:', error.message);
  allChecksPassed = false;
}

// Check 2: TypeScript configuration
console.log('\n2. Checking TypeScript configuration...');
if (existsSync(join(ROOT_DIR, 'tsconfig.json'))) {
  console.log('✅ TypeScript configuration exists');
} else {
  console.log('❌ Missing tsconfig.json');
  allChecksPassed = false;
}

// Check 3: Docker configuration
console.log('\n3. Checking Docker configuration...');
if (existsSync(join(ROOT_DIR, 'Dockerfile'))) {
  console.log('✅ Dockerfile exists');
} else {
  console.log('❌ Missing Dockerfile');
  allChecksPassed = false;
}

if (existsSync(join(ROOT_DIR, 'docker-compose.yml'))) {
  console.log('✅ Docker Compose configuration exists');
} else {
  console.log('❌ Missing docker-compose.yml');
  allChecksPassed = false;
}

// Check 4: Environment configuration
console.log('\n4. Checking environment configuration...');
if (existsSync(join(ROOT_DIR, 'config/env.example'))) {
  console.log('✅ Environment example file exists');
} else {
  console.log('❌ Missing environment example file');
  allChecksPassed = false;
}

// Check 5: Source code structure
console.log('\n5. Checking source code structure...');
const requiredDirs = ['src', 'src/database', 'src/data-collector', 'src/utils', 'src/mcp-agent'];
const missingDirs = requiredDirs.filter(dir => !existsSync(join(ROOT_DIR, dir)));

if (missingDirs.length > 0) {
  console.log('❌ Missing required directories:', missingDirs);
  allChecksPassed = false;
} else {
  console.log('✅ Source code structure is complete');
}

// Check 6: Build process
console.log('\n6. Testing build process...');
try {
  const { execSync } = await import('child_process');
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'pipe' });
  console.log('✅ Build process works correctly');
} catch (error) {
  console.log('❌ Build process failed:', error.message);
  allChecksPassed = false;
}

// Check 7: Linting
console.log('\n7. Testing linting...');
try {
  const { execSync } = await import('child_process');
  execSync('npm run lint', { cwd: ROOT_DIR, stdio: 'pipe' });
  console.log('✅ Linting passes');
} catch (error) {
  console.log('❌ Linting failed:', error.message);
  allChecksPassed = false;
}

// Check 8: Type checking
console.log('\n8. Testing type checking...');
try {
  const { execSync } = await import('child_process');
  execSync('npx tsc --noEmit', { cwd: ROOT_DIR, stdio: 'pipe' });
  console.log('✅ Type checking passes');
} catch (error) {
  console.log('❌ Type checking failed:', error.message);
  allChecksPassed = false;
}

// Final result
console.log('\n========================================');
if (allChecksPassed) {
  console.log('🎉 All checks passed! The application is ready for deployment.');
  console.log('\n📋 Next steps for deployment:');
  console.log('1. Set up your InfluxDB instance');
  console.log('2. Configure environment variables');
  console.log('3. Run: docker-compose up --build');
  console.log('4. Monitor logs: docker-compose logs -f pump-agent');
} else {
  console.log('❌ Some checks failed. Please fix the issues above before deploying.');
  process.exit(1);
} 