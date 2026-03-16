# Extensive Testing - Phase 4: Debugging & Reporting

**Goal:** Resolve the blank HTML report issue and fix the persistent E2E locator timeouts by visually verifying the application state using Chrome DevTools.

## 1. Reporting Fix (Blank Page)
*   **Issue**: Playwright's `npx playwright show-report` defaults to `localhost`, which is unreachable from outside the container unless bound to `0.0.0.0`.
*   **Fix**: 
    *   Update `docker-compose.yml` to map port `9323:9323` for the `e2e` service.
    *   Pass `PW_SERVER_HOST=0.0.0.0` and `PW_SERVER_PORT=9323` to the reporter.

## 2. E2E Fix (Locator Timeouts)
*   **Hypothesis**: The `AgentView` is not transitioning to `ChatWindow` because the `ticket:created:self` event is not populating the `activeTicketId` correctly, or the `BusinessHoursGuard` is interfering.
*   **Debugging Step**:
    1.  Use `chrome-devtools` to manually login as `e2e-agent-a` at `http://localhost:5173`.
    2.  Fill the form and click "Connect".
    3.  Inspect the DOM and console logs via DevTools to see why `ChatWindow` doesn't appear.
    4.  Verify the `BusinessHoursGuard` state in the accessibility tree.

## 3. Implementation Plan

- [ ] **Task 3.1**: Modify `docker-compose.yml` to expose port `9323`.
- [ ] **Task 3.2**: Update `e2e/package.json` to serve the report on all interfaces:
    `"report:serve": "playwright show-report --host 0.0.0.0 --port 9323"`
- [ ] **Task 3.3**: Perform manual visual inspection via `chrome-devtools`.
- [ ] **Task 3.4**: Adjust locators or state management logic based on findings.

## 4. Verification
*   Run `docker compose run --rm e2e` and ensure at least one test pass confirms the report can be generated.
*   Verify the report is viewable at `http://localhost:9323`.
