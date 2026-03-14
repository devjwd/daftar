# Move Contract Test CI Integration Guide

## Overview

This guide documents how to integrate Move contract tests into your CI/CD pipeline. The swap_router contract includes 17 comprehensive unit tests covering initialization, fee management, admin transfer, and swap execution.

---

## Prerequisites

### CI Environment Setup

Your CI pipeline (GitHub Actions, GitLab CI, etc.) must have:

1. **Movement CLI** installed  
   ```bash
   # Installation varies by CI provider; typically:
   curl -fsSL https://raw.githubusercontent.com/movementlabsxyz/movement/main/scripts/install.sh | bash
   # OR
   cargo install --git https://github.com/movementlabsxyz/movement.git movement-cli
   ```

2. **Rust toolchain** (for Move compilation)  
   ```bash
   rustup toolchain install stable
   ```

3. **aptos-cli** (sometimes required as dependency)

---

## Step 1: Add CI Test Job

### GitHub Actions Example

Create `.github/workflows/move-tests.yml`:

```yaml
name: Move Contract Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'contracts/swap_router/**'
  pull_request:
    branches: [main, develop]
    paths:
      - 'contracts/swap_router/**'

jobs:
  move-tests:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      
      - name: Install Movement CLI
        run: |
          curl -fsSL https://raw.githubusercontent.com/movementlabsxyz/movement/main/scripts/install.sh | bash
          export PATH="$HOME/.movement/bin:$PATH"
      
      - name: Run Move Tests
        run: |
          cd contracts/swap_router
          movement move test
      
      - name: Generate Test Report
        if: always()
        run: |
          cd contracts/swap_router
          movement move test --coverage > test-report.txt 2>&1 || true
      
      - name: Upload Test Report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: move-test-report
          path: contracts/swap_router/test-report.txt
```

### GitLab CI Example

Create `.gitlab-ci.yml` (or update existing):

```yaml
move-contract-tests:
  stage: test
  image: rust:latest
  script:
    - curl -fsSL https://raw.githubusercontent.com/movementlabsxyz/movement/main/scripts/install.sh | bash
    - export PATH="$HOME/.movement/bin:$PATH"
    - cd contracts/swap_router
    - movement move test
  artifacts:
    reports:
      junit: contracts/swap_router/test-results.xml
    paths:
      - contracts/swap_router/test-report.txt
  only:
    changes:
      - contracts/swap_router/**
```

---

## Step 2: Test Execution

### Manual Local Execution (for developers)

If Movement CLI is available locally:

```bash
cd contracts/swap_router
movement move test          # Run all tests
movement move test -k test_initialize_requires_module_address  # Run specific test
movement move test --coverage  # With coverage report
```

### Expected Output

```
BUILDING move package at /path/to/contracts/swap_router
RUNNING Move unit tests
test 0x1::router::test_initialize_requires_module_address ... ok
test 0x1::router::test_initialize_fees_stored ... ok
test 0x1::router::test_initialize_fee_too_high ... ok
test 0x1::router::test_initialize_invalid_treasury ... ok
test 0x1::router::test_double_initialize ... ok
test 0x1::router::test_update_fee ... ok
test 0x1::router::test_update_fee_not_initialized ... ok
test 0x1::router::test_update_fee_too_high ... ok
test 0x1::router::test_pause_unpause ... ok
test 0x1::router::test_admin_transfer ... ok
test 0x1::router::test_cancel_admin_transfer ... ok
test 0x1::router::test_calculate_fee ... ok
test 0x1::router::test_collect_fee ... ok
test 0x1::router::test_collect_fee_when_paused ... ok
test 0x1::router::test_collect_fee_zero_amount ... ok
test 0x1::router::test_collect_fee_invalid_router_source ... ok
test 0x1::router::test_get_config_not_initialized ... ok

Test passed. ✓
```

---

## Step 3: Coverage Analysis (Optional)

To generate coverage reports:

```bash
cd contracts/swap_router
movement move test --coverage
# Generates coverage report in target/move/coverage/
```

**Coverage Expectations**:
- Initialization module: 100% (all paths tested)
- Fee logic: 100% (calculation and collection tested)
- Admin transfer: 100% (2-step process verified)
- Not-initialized guards: 100% (all entry + view functions guarded)

---

## Step 4: Integration with Deployment Pipeline

### Block Deployment on Test Failure

Ensure CI pipeline halts deployment if Move tests fail:

```yaml
# GitHub Actions example
- name: Run Move Tests (blocking)
  run: |
    cd contracts/swap_router
    movement move test || exit 1
    # Exit code 1 prevents further steps (deployment) from running

- name: Deploy (only runs if tests pass)
  if: success()
  run: ./scripts/deploy.sh
```

---

## Test Suite Reference

| Test | Purpose | Key Assertion |
|------|---------|---------------|
| `test_initialize_requires_module_address` | Reject non-module signer | Only @swap_router can initialize |
| `test_initialize_fees_stored` | Happy path initialization | Config stored correctly |
| `test_initialize_fee_too_high` | Reject fee > 5% | Fee capped at 500 bps |
| `test_initialize_invalid_treasury` | Reject @0x0 treasury | Treasury must be valid |
| `test_double_initialize` | Prevent re-initialization | Already-initialized guard works |
| `test_update_fee` | Change fee rate | New fee persists |
| `test_update_fee_not_initialized` | Require init before update | Not-initialized guard on entry |
| `test_update_fee_too_high` | Enforce fee cap on updates | 500 bps limit enforced |
| `test_pause_unpause` | Toggle pause state | Pause state toggles correctly |
| `test_admin_transfer` | 2-step admin nomination | New admin confirmed via accept |
| `test_cancel_admin_transfer` | Revoke pending nomination | Pending admin cleared |
| `test_calculate_fee` | Math correctness | fee = amount * bps / 10000 |
| `test_collect_fee` | Fee collection path | Stats updated, fees routed |
| `test_collect_fee_when_paused` | Pause guard on collection | Cannot collect when paused |
| `test_collect_fee_zero_amount` | Reject zero swaps | E_ZERO_AMOUNT thrown |
| `test_collect_fee_invalid_router_source` | Validate router source | Only ROUTER_MOSAIC accepted |
| `test_get_config_not_initialized` | View function guard | Cannot query before init |

---

## Debugging Failed Tests

### Test Fails with "Module not found"

**Symptom**: `Error: Module 0x... not found`  
**Fix**: Ensure correct address in `Move.toml` dev-addresses:
```toml
[dev-addresses]
swap_router = "0x1"
```

### Test Fails with "Address mismatch"

**Symptom**: `assertion failed: admin_addr == @swap_router`  
**Fix**: Check test harness is using correct admin address in test function signature:
```move
#[test(admin = @swap_router, framework = @0x1)]
```

### Timeout or Hang

**Symptom**: Test runs >30s without output  
**Fix**: Increase CI timeout, check for infinite loops in test setup

### Coverage Report Not Generated

**Symptom**: No coverage data output  
**Fix**: Verify Movement CLI version supports `--coverage` flag:
```bash
movement move test --coverage
```

---

## Performance Notes

- **Test Suite Runtime**: Typically 15-30 seconds (depending on hardware)
- **CI Cost**: Minimal (uses standard Rust build environment)
- **Parallelization**: Movement CLI runs tests sequentially; output shows progress

---

## Post-Test Gates

### Before Merge to Main

Require:
1. ✅ All Move tests pass
2. ✅ All frontend tests pass (`npm test`)
3. ✅ Frontend build succeeds (`npm run build`)
4. ✅ No lint violations (`npm run lint`)

### Before Production Deployment

In addition to above:
1. ✅ Contract deployed to testnet (address logged)
2. ✅ Staging swap UX test passed (manual QA)
3. ✅ Contract address matches frontend config
4. ✅ Fee configuration verified on-chain

---

## Resources

- [Movement Network CLI Docs](https://docs.movementlabs.xyz/movement-cli.html)
- [Move Language Documentation](https://move-language.github.io/)
- [Aptos Framework Reference](https://github.com/aptos-labs/aptos-core/tree/main/aptos-move/framework)

---

## Support

If Move tests fail in CI but pass locally:
1. Check Move CLI version matches between local and CI (`movement --version`)
2. Verify Rust toolchain version consistency
3. Clear Move cache: `rm -rf contracts/swap_router/.movement`
4. Run with verbose logging: `movement move test --verbose`

