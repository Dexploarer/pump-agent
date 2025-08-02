# Testing Cleanup Memory

## Date: 2025-08-02

## Cleanup Summary

### 🗑️ **Deleted Test Files**
- `test-app-exact.js` - Outdated WebSocket test
- `test-app-simple.js` - Redundant simple test
- `test-data-collection.js` - Replaced by main application
- `test-app-connection.js` - Outdated connection test
- `test-connection-details.js` - Redundant connection details
- `test-app-mimic.js` - Outdated mimic test
- `debug-websocket.js` - Debug file, not needed
- `test-correct-subscription.js` - Outdated subscription test
- `test-subscription-formats.js` - Redundant subscription formats
- `test-websocket.js` - Generic WebSocket test
- `stress-test-simple.ts` - Stress test, not needed
- `production-test.ts` - Production test, not needed
- `scripts/test-local.js` - Local test script
- `scripts/test-token-cleanup.ts` - Outdated cleanup test
- `scripts/verify-token-tracking.ts` - Outdated tracking test
- `src/data-collector/__tests__/cleanup-integration.test.ts` - Outdated integration test

### 📁 **Reorganized Files**
- Moved `run-data-collection.js` to `scripts/run-data-collection.js`
- Removed empty `src/data-collector/__tests__/` directory

### 🏗️ **New Testing Structure**
```
tests/
├── unit/                    # Individual function tests
│   └── websocket-client.test.ts
├── integration/             # Component interaction tests
├── e2e/                    # Full application tests
└── fixtures/               # Test data and mocks
```

## Testing Rules Established

### 🧹 **ONE TEST FILE PER PURPOSE**
- **One function/feature = One test file**
- **If test fails or needs changes = Create NEW file, DELETE old one**
- **No technical debt accumulation**
- **Clean, focused, maintainable tests**

### 📋 **Quality Gates**
1. ✅ Identify specific functionality to test
2. ✅ Check if test already exists
3. ✅ Delete old test file if replacing
4. ✅ Create focused, single-purpose test

### 🚫 **Prohibited Practices**
- ❌ Multiple test files for same functionality
- ❌ Keeping old test files after refactoring
- ❌ Test files without clear purpose
- ❌ Tests that don't actually test anything
- ❌ Tests that are too slow (> 10s)

### ✅ **Required Practices**
- ✅ One test file per specific functionality
- ✅ Delete old test files immediately when creating new ones
- ✅ Clear test descriptions
- ✅ Fast execution times
- ✅ Proper mocking of external dependencies
- ✅ Tests that actually validate behavior

## Example Test Structure

### ✅ **Good Test File**
```typescript
// tests/unit/websocket-client.test.ts
describe('SimplePumpPortalClient', () => {
  it('should connect to PumpPortal successfully', async () => {
    // Single purpose: test connection
  });
});
```

### ❌ **Bad Test File**
```typescript
// tests/websocket-and-database-and-ui.test.ts
describe('Everything', () => {
  it('should do everything', async () => {
    // Multiple purposes: connection, storage, UI updates
  });
});
```

## Maintenance Schedule

### **Weekly Cleanup**
- Review all test files
- Remove outdated tests
- Consolidate similar tests
- Update test documentation

### **Before Releases**
- Run full test suite
- Verify all tests pass
- Update test coverage report
- Document any test changes

## Current Test Files

### **Essential Files Kept**
- `scripts/run-data-collection.js` - Development testing script
- `jest.config.js` - Jest configuration
- `TESTING_GUIDELINES.md` - Testing documentation

### **New Test Files Created**
- `tests/unit/websocket-client.test.ts` - Example unit test

## Next Steps

1. **Create focused unit tests** for each component
2. **Create integration tests** for component interactions
3. **Create e2e tests** for full application flow
4. **Maintain clean test structure** following guidelines
5. **Regular cleanup** to prevent technical debt

---

**Memory: Always follow the one-test-file-per-purpose rule. Delete old tests immediately when creating new ones. Keep the test suite clean and focused.** 