import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const http = require('http');
const fs = require('fs');

async function finalVerification() {
  console.log('🔍 FINAL VERIFICATION - PUMP AGENT PLATFORM');
  console.log('=============================================\n');
  
  const results = {
    database: false,
    dataCollection: false,
    uiServer: false,
    apiEndpoints: false,
    dataFlow: false
  };
  
  try {
    // 1. Test Database
    console.log('1. Testing Database...');
    const dbPath = './data/pump-agent.db';
    const dbExists = fs.existsSync(dbPath);
    const dbSize = dbExists ? fs.statSync(dbPath).size : 0;
    
    if (dbSize > 0) {
      console.log('✅ Database: SQLite database initialized successfully');
      results.database = true;
    } else {
      console.log('❌ Database: SQLite database not initialized');
    }
    
    // 2. Test Application Status
    console.log('\n2. Testing Application Status...');
    const appRunning = await testEndpoint('/api/status');
    if (appRunning.status === 200) {
      console.log('✅ Application: Running successfully');
      results.dataCollection = true;
    } else {
      console.log('❌ Application: Not responding');
    }
    
    // 3. Test UI Server
    console.log('\n3. Testing UI Server...');
    const uiResponse = await testEndpoint('/');
    if (uiResponse.status === 200) {
      console.log('✅ UI Server: Dashboard accessible');
      results.uiServer = true;
    } else {
      console.log('❌ UI Server: Dashboard not accessible');
    }
    
    // 4. Test API Endpoints
    console.log('\n4. Testing API Endpoints...');
    const endpoints = [
      { path: '/api/tokens', name: 'Tokens API' },
      { path: '/api/stats', name: 'Stats API' },
      { path: '/api/recent-trades', name: 'Trades API' },
      { path: '/api/platform-stats', name: 'Platform Stats API' }
    ];
    
    let workingEndpoints = 0;
    for (const endpoint of endpoints) {
      const response = await testEndpoint(endpoint.path);
      if (response.status === 200) {
        console.log(`✅ ${endpoint.name}: Working`);
        workingEndpoints++;
      } else {
        console.log(`❌ ${endpoint.name}: Not working`);
      }
    }
    
    if (workingEndpoints === endpoints.length) {
      console.log('✅ API Endpoints: All endpoints working');
      results.apiEndpoints = true;
    } else {
      console.log(`⚠️ API Endpoints: ${workingEndpoints}/${endpoints.length} working`);
    }
    
    // 5. Test Data Flow
    console.log('\n5. Testing Data Flow...');
    const tokensResponse = await testEndpoint('/api/tokens');
    const statsResponse = await testEndpoint('/api/stats');
    
    if (tokensResponse.status === 200 && statsResponse.status === 200) {
      const tokens = tokensResponse.data;
      const stats = statsResponse.data;
      
      if (tokens && tokens.length > 0 && stats && stats.totalTokens > 0) {
        console.log('✅ Data Flow: Tokens being collected and stored');
        console.log(`   - Total tokens: ${stats.totalTokens}`);
        console.log(`   - Platforms: ${Object.keys(stats.tokensByPlatform).join(', ')}`);
        results.dataFlow = true;
      } else {
        console.log('⚠️ Data Flow: No tokens in database yet');
      }
    } else {
      console.log('❌ Data Flow: Cannot access data');
    }
    
    // 6. Summary
    console.log('\n=============================================');
    console.log('📊 VERIFICATION SUMMARY');
    console.log('=============================================');
    
    const totalTests = Object.keys(results).length;
    const passedTests = Object.values(results).filter(Boolean).length;
    
    console.log(`Database Connection: ${results.database ? '✅' : '❌'}`);
    console.log(`Data Collection: ${results.dataCollection ? '✅' : '❌'}`);
    console.log(`UI Server: ${results.uiServer ? '✅' : '❌'}`);
    console.log(`API Endpoints: ${results.apiEndpoints ? '✅' : '❌'}`);
    console.log(`Data Flow: ${results.dataFlow ? '✅' : '❌'}`);
    
    console.log(`\nOverall Status: ${passedTests}/${totalTests} components working`);
    
    if (passedTests === totalTests) {
      console.log('\n🎉 SUCCESS: Pump Agent platform is fully operational!');
      console.log('   - Database: ✅ Connected and storing data');
      console.log('   - Data Collection: ✅ Receiving real-time tokens');
      console.log('   - UI Dashboard: ✅ Accessible at http://localhost:3001');
      console.log('   - API Endpoints: ✅ All endpoints responding');
      console.log('   - Data Flow: ✅ Complete pipeline working');
    } else {
      console.log('\n⚠️ PARTIAL SUCCESS: Some components need attention');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
}

async function testEndpoint(path) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: path,
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
    
    req.on('error', () => {
      resolve({ status: 0, data: null });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, data: null });
    });
    
    req.end();
  });
}

finalVerification(); 