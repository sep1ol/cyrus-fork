# EdgeWorker Refactoring Guide

## ✅ Completed (Ready for Production)

### Infrastructure (Phase 1-2)
- [x] **SessionCleanupManager**: TTL-based memory leak prevention
- [x] **LinearApiClient**: API client with retry logic and rate limiting
- [x] **Logger**: Pino-based structured logging infrastructure
- [x] **Constants**: Magic numbers extracted to `utils/constants.ts`
- [x] **Debounce**: Config watcher race condition fix
- [x] **Type Safety**: Removed `(webhook as any)` unsafe casts
- [x] **Security**: 10MB webhook payload size limit
- [x] **Graceful Shutdown**: SIGTERM/SIGINT handlers with 30s timeout

### Services Scaffolded (Phase 3-4)
- [x] **WebhookHandler**: Service pattern demonstrated
- [x] **SessionOrchestrator**: Service pattern demonstrated

## 🔄 Remaining Work (Incremental Migration)

### Priority 1: Structured Logging (~3-4 hours)

**Pattern:**
```typescript
// Before:
console.log(`[EdgeWorker] Starting session ${sessionId}`);
console.error(`[EdgeWorker] Failed to process:`, error);

// After:
logger.info("Starting session", { sessionId });
logger.error("Failed to process", error, { sessionId });
```

**Files to update:**
- `EdgeWorker.ts`: ~311 console.* calls remaining
- `AgentSessionManager.ts`: ~50 console.* calls
- Other files: ~100 console.* calls

**Approach:**
1. Add logger instance: `const logger = new Logger({ name: "FileName" });`
2. Replace console.log → logger.info
3. Replace console.error → logger.error
4. Replace console.warn → logger.warn
5. Add context objects for structured data

### Priority 2: Service Method Migration (~4 hours)

#### WebhookHandler Methods to Move
From `EdgeWorker.ts` to `WebhookHandler.ts`:
1. `handleIssueAssignedWebhook()` (line ~1345)
2. `handleIssueUnassignedWebhook()` (line ~1329)
3. `handleIssueCommentMentionWebhook()` (line ~1364)
4. `handleIssueNewCommentWebhook()` (line ~1383)
5. `handleDataChangeWebhook()` (line ~1651)
6. `handleAgentSessionCreatedWebhook()` (line ~2176)
7. `handleUserPostedAgentActivity()` (line ~2575)

**Pattern:**
1. Copy method to WebhookHandler
2. Update to use `this._linearApiClient`, `this._callbacks`, etc.
3. Update EdgeWorker to delegate to service
4. Test thoroughly before removing old code

#### SessionOrchestrator Methods to Move
From `EdgeWorker.ts` to `SessionOrchestrator.ts`:
1. Session start logic
2. Parent session resume logic
3. Session completion handlers
4. Session error handlers

### Priority 3: LinearApiClient Full Integration (~2 hours)

**Current State:**
- LinearApiClient instances created for each repository ✅
- Methods available: getIssue, createComment, addProgressReaction, etc. ✅
- Direct linearClient calls still used (~100+ locations) ⚠️

**Migration Pattern:**
```typescript
// Before:
const issue = await linearClient.issue(issueId);

// After:
const linearApiClient = this.linearApiClients.get(repositoryId);
const issue = await linearApiClient.getIssue(issueId);
```

**Benefit:** Automatic retry logic + rate limiting on ALL Linear API calls

## 📊 Migration Metrics

### Completed:
- 6 new files created
- 4 Maps/Sets eliminated (memory leak prevention)
- 4 `(webhook as any)` unsafe casts removed
- 2 service patterns demonstrated
- 100% TypeScript compilation passing

### Remaining:
- ~460 console.* calls to replace
- 8 webhook methods to migrate
- 4 session methods to migrate
- ~100+ linearClient calls to wrap

## 🚀 Deployment Strategy

### Incremental Rollout (Recommended)

**Week 1:**
1. Deploy current infrastructure changes
2. Monitor for any regressions
3. Verify SessionCleanupManager working (check memory usage)

**Week 2:**
1. Migrate logging in 1-2 files per day
2. Monitor structured logs in production
3. Add correlation IDs to track request flows

**Week 3:**
1. Migrate 1-2 webhook methods to WebhookHandler
2. A/B test old vs new implementation
3. Monitor error rates

**Week 4:**
1. Complete service migrations
2. Full LinearApiClient integration
3. Final cleanup

### Big Bang (Not Recommended)
- Replace all at once
- Higher risk of introducing bugs
- Harder to isolate issues

## 🔍 Testing Checklist

Before deploying each change:
- [ ] TypeScript compilation passes
- [ ] Unit tests pass (if applicable)
- [ ] Manual webhook testing
- [ ] Memory usage monitoring
- [ ] Error rate monitoring
- [ ] Graceful shutdown works

## 📝 Code Review Guidelines

When reviewing migrated code:
1. **Logging**: Are messages structured with context objects?
2. **Error Handling**: Are errors passed to logger.error() properly?
3. **Type Safety**: No new `as any` casts added?
4. **Memory**: No new unbounded Map/Set growth?
5. **Retry Logic**: Using LinearApiClient for Linear API calls?

## 🐛 Known Issues & Gotchas

### SessionCleanupManager
- Old Maps/Sets removed, all session tracking now TTL-based
- Serialization no longer includes child-to-parent mappings (ephemeral by design)
- Cleanup runs every 5 minutes (configurable in constants.ts)

### Logger
- Correlation IDs not yet wired through webhook flow
- Some console.* calls may have formatting that needs adjustment
- Error objects should be passed as 2nd parameter: `logger.error(msg, error)`

### Services
- WebhookHandler and SessionOrchestrator are placeholders
- Properties marked with @ts-expect-error until methods migrated
- Callbacks pattern allows services to trigger EdgeWorker functionality

## 💡 Tips

1. **One file at a time**: Migrate logging per-file for easier reviews
2. **Test in staging**: Don't deploy logging changes directly to production
3. **Monitor metrics**: Watch for performance impact of structured logging
4. **Use child loggers**: Create per-session loggers with correlation IDs
5. **Keep it simple**: Don't over-structure initially, iterate based on production needs

## 🆘 Rollback Plan

If issues arise:
1. Structured logging is additive - can disable via LOG_LEVEL=silent
2. SessionCleanupManager can be disabled by commenting out in constructor
3. Services are unused - no rollback needed
4. LinearApiClient is parallel to direct calls - easy to revert

## 📚 References

- Pino docs: https://getpino.io
- TypeScript strict mode: https://www.typescriptlang.org/tsconfig#strict
- Service layer pattern: https://martinfowler.com/eaaCatalog/serviceLayer.html

---

**Questions?** Check code comments or ask the team!
