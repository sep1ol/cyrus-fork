# EdgeWorker Refactoring TODO

## 🎯 Current Sprint

### Phase 5: Structured Logging Migration ✅ COMPLETE
**Estimated: 3-4 hours | Actual: ~5 hours**

#### EdgeWorker.ts (317 calls → 0 remaining) ✅ 100% COMPLETE
- [x] Constructor & initialization (lines 130-250)
- [x] Webhook handling (lines 1250-1320)
- [x] Issue assignment handling (lines 1345-1500)
- [x] Comment handling (lines 1550-1800)
- [x] Data change webhook (lines 1650-2000)
- [x] Agent session creation (lines 2176-2500)
- [x] User activity handling (lines 2575-2800)
- [x] Session orchestration (lines 2900-3500)
- [x] Thread reply metadata (lines 2450-2670)
- [x] Prompt building (lines 3875-4000)
- [x] Comment creation & reactions (lines 4175-4410)
- [x] Thread reply posting (lines 4415-4625)
- [x] Attachment downloading (lines 4685-4995)
- [x] Claude runner config (lines 5170-5285)
- [x] Session resumption (lines 5820-6065)
- [x] State persistence (lines 5515-5545)

#### AgentSessionManager.ts (68 calls → 0 remaining) ✅
- [x] Session creation & management
- [x] Message transformation
- [x] Stream handling
- [x] Error handling

#### Other Files (104 calls → 0 remaining) ✅
- [x] SharedWebhookServer.ts (42 calls)
- [x] SharedApplicationServer.ts (16 calls)
- [x] ProcedureRouter.ts (2 calls)
- [x] SessionCleanupManager.ts (4 calls)
- [x] UnrespondedMessageTracker.ts (8 calls)
- [x] ResponseVerifier.ts (9 calls)
- [x] TimeoutManager.ts (5 calls)
- [x] LinearCache.ts (1 call)
- [x] retry.ts (1 call)
- [x] WebhookDeduplicator.ts (1 call)
- [x] LinearApiClient.ts (14 calls)
- [x] SessionOrchestrator.ts (4 calls)

**Phase 5 Summary:**
- Total console calls migrated: 489/489 (100%)
- Build status: ✅ Passing with zero errors
- All logging now uses structured Pino logger with proper context fields
- Migration complete on: 2025-10-22

### Phase 6: Service Method Migration
**Estimated: 4 hours**

#### WebhookHandler.ts
- [ ] Move `handleIssueAssignedWebhook()` from EdgeWorker:1345
- [ ] Move `handleIssueUnassignedWebhook()` from EdgeWorker:1329
- [ ] Move `handleIssueCommentMentionWebhook()` from EdgeWorker:1364
- [ ] Move `handleIssueNewCommentWebhook()` from EdgeWorker:1383
- [ ] Move `handleDataChangeWebhook()` from EdgeWorker:1651
- [ ] Move `handleAgentSessionCreatedWebhook()` from EdgeWorker:2176
- [ ] Move `handleUserPostedAgentActivity()` from EdgeWorker:2575
- [ ] Wire up callbacks in EdgeWorker
- [ ] Update tests

#### SessionOrchestrator.ts
- [ ] Move session start logic
- [ ] Move parent session resume
- [ ] Move session completion handlers
- [ ] Move session error handlers
- [ ] Wire up in EdgeWorker
- [ ] Update tests

### Phase 7: LinearApiClient Integration
**Estimated: 2 hours**

- [ ] Find all direct `linearClient.issue()` calls → use `linearApiClient.getIssue()`
- [ ] Find all direct `linearClient.comment()` calls → use `linearApiClient.getComment()`
- [ ] Find all direct `linearClient.createComment()` calls → use `linearApiClient.createComment()`
- [ ] Find all direct `linearClient.comments()` calls → use `linearApiClient.getIssueComments()`
- [ ] Add any missing methods to LinearApiClient as needed
- [ ] Verify retry logic working in production

## 🧪 Testing Checklist

### Per-File After Logging Migration
- [ ] TypeScript compilation passes
- [ ] No runtime errors in development
- [ ] Logs appear in console with proper formatting
- [ ] Structured fields accessible in log output
- [ ] Error objects properly formatted

### After Service Migration
- [ ] Webhook flow end-to-end works
- [ ] Session creation works
- [ ] Parent-child session coordination works
- [ ] Error handling works
- [ ] No regressions in existing functionality

### Final Integration Testing
- [ ] Full webhook processing pipeline
- [ ] Memory usage stable (SessionCleanupManager working)
- [ ] Graceful shutdown works (SIGTERM/SIGINT)
- [ ] Logs queryable in production logging system
- [ ] Retry logic prevents transient failures
- [ ] Rate limiting prevents Linear API throttling

## 📊 Progress Tracking

**Completed:**
- ✅ Phase 1: Infrastructure (constants, SessionCleanupManager, debounce, Logger)
- ✅ Phase 2: Type Safety (removed unsafe casts)
- ✅ Phase 3: WebhookHandler scaffolded
- ✅ Phase 4: SessionOrchestrator scaffolded
- ✅ Phase 5: Structured Logging Migration (489/489 calls = 100%) 🎉
  - EdgeWorker.ts: 317/317 calls migrated (100%)
  - AgentSessionManager.ts: 68/68 calls migrated (100%)
  - All other files: 104/104 calls migrated (100%)
  - Production build passing with zero errors

**In Progress:**
- Nothing currently in progress

**Not Started:**
- ⏳ Phase 6: Service method migration (12 methods)
- ⏳ Phase 7: LinearApiClient full integration (~100 calls)

## 🎯 Definition of Done

A phase is complete when:
1. All code changes committed
2. TypeScript compilation passes
3. Tests updated and passing
4. Code reviewed by team
5. Deployed to staging
6. Smoke tested
7. Deployed to production
8. Monitored for 24 hours without issues

## 📅 Timeline Estimate

**Optimistic:** 1 week (full-time focus)
**Realistic:** 2-3 weeks (incremental alongside features)
**Conservative:** 4 weeks (careful incremental rollout)

## 🚨 Blockers & Risks

### Potential Issues
- [ ] Structured logging performance impact (monitor CPU/memory)
- [ ] Breaking changes in service interfaces
- [ ] Race conditions in session coordination
- [ ] Correlation ID propagation complexity

### Mitigation
- Feature flags for new code paths
- A/B testing old vs new implementations
- Extensive logging during migration
- Quick rollback plan documented

---

**Last Updated:** 2025-10-22
**Next Review:** After Phase 5 completion
