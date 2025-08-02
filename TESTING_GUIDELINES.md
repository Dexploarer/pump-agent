# Testing Guidelines

## Core Principles

### 🧹 **ONE TEST FILE PER PURPOSE**
- **One function/feature = One test file**
- **If a test fails or needs changes = Create NEW file, DELETE old one**
- **No technical debt accumulation**
- **Clean, focused, maintainable tests**

### 📁 **Test File Naming Convention**
```
tests/
├── unit/
│   ├── websocket-client.test.ts
│   ├── data-processor.test.ts
│   └── influx-client.test.ts
├── integration/
│   ├── data-collection.test.ts
│   └── database-storage.test.ts
└── e2e/
    └── pump-agent.test.ts
```

### 🎯 **Test Categories**

#### **Unit Tests** (`tests/unit/`)
- Test individual functions/methods
- Mock all dependencies
- Fast execution (< 100ms per test)
- Example: `websocket-client.test.ts`

#### **Integration Tests** (`tests/integration/`)
- Test component interactions
- Mock external services (InfluxDB, WebSocket)
- Medium execution time (< 1s per test)
- Example: `data-collection.test.ts`

#### **End-to-End Tests** (`tests/e2e/`)
- Test full application flow
- Real external services (when available)
- Slow execution (< 10s per test)
- Example: `pump-agent.test.ts`

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

## Test File Structure

```typescript
// tests/unit/websocket-client.test.ts
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SimplePumpPortalClient } from '../../src/data-collector/simple-websocket-client.js';

describe('SimplePumpPortalClient', () => {
  let client: SimplePumpPortalClient;
  
  beforeEach(() => {
    client = new SimplePumpPortalClient();
  });
  
  afterEach(() => {
    client.disconnect();
  });
  
  describe('connection', () => {
    it('should connect to PumpPortal successfully', async () => {
      // Test implementation
    });
  });
});
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/websocket-client.test.ts

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch
```

## Test Data Management

### **Mock Data**
- Use consistent mock data across tests
- Store mock data in `tests/fixtures/`
- Keep mock data realistic but minimal

### **Test Environment**
- Use separate test configuration
- Mock all external services
- Use in-memory databases for testing

## Quality Gates

### **Before Creating New Test**
1. ✅ Identify specific functionality to test
2. ✅ Check if test already exists
3. ✅ Delete old test file if replacing
4. ✅ Create focused, single-purpose test

### **Test Validation Checklist**
- [ ] Test has clear, descriptive name
- [ ] Test validates specific behavior
- [ ] Test runs quickly (< 1s for unit, < 10s for e2e)
- [ ] Test mocks external dependencies
- [ ] Test is isolated from other tests
- [ ] Test has proper cleanup

## Examples

### ✅ **Good Test File**
```typescript
// tests/unit/websocket-connection.test.ts
describe('WebSocket Connection', () => {
  it('should connect to PumpPortal and receive data', async () => {
    // Single purpose: test connection and data reception
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

## Maintenance

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

---

**Remember: One test file, one purpose, one responsibility. Keep it clean, keep it focused, keep it maintainable.** 