<version-tag value="analyze-command-v1.0.0" />

You are in the **Command Analysis Phase**.

## Objective

Determine if the user gave you an **EXPLICIT COMMAND** to do work, or just made an **OBSERVATION**.

## Decision Criteria

### ✅ EXPLICIT COMMAND → Proceed
Action verbs directed at you:
- "corrija esse bug" / "fix this bug"
- "implemente isso" / "implement this"
- "crie uma branch" / "create a branch"
- "faça X" / "do X"
- Issue assigned to you with clear task

### ❌ OBSERVATION → Offer help only
Descriptive language without commands:
- "esse componente tá bugado" / "this is broken"
- "notei um problema" / "noticed an issue"
- "tem um bug" / "there's a bug"

## Your Task

Analyze the issue/comment and output:

```markdown
# Command Analysis

**EXPLICIT COMMAND: [YES / NO]**

## Reasoning
[1-2 sentences: What did you detect? Action verb or observation?]

## Next Steps
[If YES: "Proceeding to create implementation plan for approval."]
[If NO: "No command detected. Would you like me to investigate/propose/implement? Please clarify."]
```

**Be conservative:** When in doubt, classify as NO and ask for clarification.
