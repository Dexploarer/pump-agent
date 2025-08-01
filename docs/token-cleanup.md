# Token Cleanup Feature

## Overview
The Pump Agent includes an automatic token cleanup feature that removes inactive or rugged tokens from tracking to optimize resource usage and focus on active, legitimate tokens.

## How It Works

### Detection Criteria

#### 1. Rugged Token Detection
A token is considered "rugged" if it meets any of these criteria:
- **Price Drop**: Price has dropped 95% or more from its peak
- **Low Liquidity**: Liquidity falls below $100 USD
- **Volume Drop**: Volume has dropped 99% or more from its peak

#### 2. Inactive Token Detection
A token is considered "inactive" if:
- **No Trades**: No trading activity for 1 hour (configurable)
- **Low Volume**: 24-hour volume below 10 SOL for 3 consecutive periods
- **No Price Updates**: No price changes detected

### Safety Mechanisms

1. **Grace Period**: New tokens have a 30-minute grace period before cleanup eligibility
2. **Whitelist**: Important tokens can be whitelisted to prevent removal
3. **Cleanup Limit**: Maximum 10% of tracked tokens removed per cleanup cycle
4. **Minimum Threshold**: Always maintains at least 100 tracked tokens
5. **Platform Tracking**: Tracks cleanup statistics by platform (pump.fun vs letsbonk.fun)

## Configuration

All cleanup settings are defined in `src/utils/constants.ts`:

```typescript
export const TOKEN_CLEANUP_CONFIG = {
  // Inactivity thresholds
  INACTIVITY_THRESHOLD_MS: 3600000, // 1 hour
  MIN_VOLUME_24H_SOL: 10,
  CONSECUTIVE_ZERO_VOLUME_PERIODS: 3,
  
  // Rug detection thresholds
  RUG_DETECTION_PRICE_DROP: 0.95, // 95%
  RUG_DETECTION_LIQUIDITY_THRESHOLD_USD: 100,
  RUG_DETECTION_VOLUME_DROP: 0.99, // 99%
  
  // Cleanup process settings
  CLEANUP_INTERVAL_MS: 300000, // 5 minutes
  MAX_CLEANUP_PERCENTAGE: 0.1, // 10%
  MIN_TOKENS_TO_KEEP: 100,
  NEW_TOKEN_GRACE_PERIOD_MS: 1800000, // 30 minutes
  
  // Safety settings
  WHITELIST_TOKENS: [], // Add token mints here
  CLEANUP_ENABLED: true, // Master switch
};
```

## Monitoring

### System Stats
The cleanup statistics are included in the periodic system stats log:
- `tokensCleanedUp`: Total tokens removed since startup
- `lastCleanupTime`: Timestamp of last cleanup run
- `cleanupEnabled`: Whether cleanup is active

### Events
The system emits a `tokenCleanedUp` event when a token is removed, including:
- Token mint address
- Symbol and platform
- Cleanup reason (rugged/inactive/low_volume)
- Detailed explanation

### Logs
Look for these log entries:
- `🧹 Token cleanup process started` - Cleanup initialized
- `🧹 Token cleanup completed` - Cleanup cycle finished
- `🚮 Token untracked` - Individual token removed

## Testing

Run the test script to verify cleanup functionality:
```bash
npm run script scripts/test-token-cleanup.ts
```

## Performance Benefits

1. **Memory Optimization**: Reduces memory usage by removing dead tokens
2. **WebSocket Efficiency**: Fewer subscriptions to maintain
3. **Database Savings**: Less data written to InfluxDB
4. **Analysis Speed**: Faster trend analysis with fewer tokens
5. **Network Bandwidth**: Reduced WebSocket traffic

## Disabling Cleanup

To disable token cleanup:
1. Set `CLEANUP_ENABLED: false` in constants.ts
2. Or add tokens to `WHITELIST_TOKENS` array
3. Or increase thresholds to be less aggressive

## Future Enhancements

- Re-tracking tokens if activity resumes
- Machine learning for better rug detection
- User-configurable cleanup rules via MCP
- Export cleanup history for analysis
- Alert system for major cleanup events