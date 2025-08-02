import { spawn } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const http = require('http');

async function testUI() {
  console.log('Testing UI server database access...');
  
  try {
    // Test the API endpoints
    const testEndpoint = async (endpoint) => {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: 3001,
          path: endpoint,
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const jsonData = JSON.parse(data);
              resolve({ status: res.statusCode, data: jsonData });
            } catch (e) {
              resolve({ status: res.statusCode, data: data });
            }
          });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        
        req.end();
      });
    };
    
    // Test status endpoint
    console.log('Testing /api/status...');
    const status = await testEndpoint('/api/status');
    console.log('Status response:', status);
    
    // Test tokens endpoint
    console.log('Testing /api/tokens...');
    const tokens = await testEndpoint('/api/tokens');
    console.log('Tokens response:', tokens);
    
    // Test stats endpoint
    console.log('Testing /api/stats...');
    const stats = await testEndpoint('/api/stats');
    console.log('Stats response:', stats);
    
    console.log('✅ UI server test completed');
    
  } catch (error) {
    console.error('❌ UI server test failed:', error);
  }
}

testUI(); 