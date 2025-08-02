import { SQLiteClient } from './src/database/sqlite-client.js';

async function testDatabase() {
  console.log('Testing SQLite database connection...');
  
  try {
    const client = new SQLiteClient({
      databasePath: './data/pump-agent.db',
      enableWAL: true,
      maxRetries: 3,
      retryDelay: 1000,
    });
    
    console.log('✅ Database client created successfully');
    console.log('Database health:', client.isHealthy);
    
    // Test writing a sample token
    const sampleToken = {
      mint: 'test-mint-123',
      symbol: 'TEST',
      name: 'Test Token',
      platform: 'pump.fun',
      platformConfidence: 1.0,
      price: 0.001,
      volume24h: 1000,
      marketCap: 10000,
      liquidity: 5000,
      priceChange24h: 5.2,
      volumeChange24h: 10.5,
      holders: 100,
      uri: 'https://example.com',
      timestamp: new Date()
    };
    
    await client.writeTokenData(sampleToken);
    console.log('✅ Sample token written successfully');
    
    // Test reading tokens
    const tokens = await client.getRecentTokens(10);
    console.log('✅ Retrieved tokens:', tokens.length);
    
    // Test getting stats
    const stats = await client.getTokenStats();
    console.log('✅ Token stats:', stats);
    
    await client.close();
    console.log('✅ Database test completed successfully');
    
  } catch (error) {
    console.error('❌ Database test failed:', error);
  }
}

testDatabase(); 