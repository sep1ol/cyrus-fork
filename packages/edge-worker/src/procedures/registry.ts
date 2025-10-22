/**
 * Registry of predefined procedures and routing rules
 */

import type { ProcedureDefinition, RequestClassification } from "./types.js";

/**
 * Predefined subroutine definitions
 */
export const SUBROUTINES = {
	analyzeCommand: {
		name: "analyze-command",
		promptPath: "subroutines/analyze-command.md",
		description:
			"Analyze if user gave explicit command or just made observation",
		maxTurns: 1,
		suppressThoughtPosting: false,
	},
	selectTemplate: {
		name: "select-template",
		promptPath: "subroutines/select-template.md",
		description: "Select appropriate response template for Linear thread reply",
		maxTurns: 1,
		suppressThoughtPosting: true,
	},
	primary: {
		name: "primary",
		promptPath: "primary", // Special: resolved via label (debugger/builder/scoper/orchestrator)
		description: "Main work execution phase",
	},
	debuggerReproduction: {
		name: "debugger-reproduction",
		promptPath: "subroutines/debugger-reproduction.md",
		description: "Reproduce bug and perform root cause analysis",
	},
	getApproval: {
		name: "get-approval",
		promptPath: "subroutines/get-approval.md",
		description: "Request user approval before proceeding",
		maxTurns: 1,
		requiresApproval: true, // Flag to trigger approval workflow
	},
	debuggerFix: {
		name: "debugger-fix",
		promptPath: "subroutines/debugger-fix.md",
		description: "Implement minimal fix based on approved reproduction",
	},
	verifications: {
		name: "verifications",
		promptPath: "subroutines/verifications.md",
		description: "Run tests, linting, and type checking",
	},
	gitGh: {
		name: "git-gh",
		promptPath: "subroutines/git-gh.md",
		description: "Commit changes and create/update PR",
	},
	conciseSummary: {
		name: "concise-summary",
		promptPath: "subroutines/concise-summary.md",
		maxTurns: 1,
		description: "Brief summary for simple requests",
		suppressThoughtPosting: true,
	},
	verboseSummary: {
		name: "verbose-summary",
		promptPath: "subroutines/verbose-summary.md",
		maxTurns: 1,
		description: "Detailed summary with implementation details",
		suppressThoughtPosting: true,
	},
} as const;

/**
 * Predefined procedure definitions
 */
export const PROCEDURES: Record<string, ProcedureDefinition> = {
	"simple-question": {
		name: "simple-question",
		description: "For questions or requests that don't modify the codebase",
		subroutines: [SUBROUTINES.primary, SUBROUTINES.conciseSummary],
	},

	"documentation-edit": {
		name: "documentation-edit",
		description:
			"For documentation/markdown edits that don't require verification",
		subroutines: [
			SUBROUTINES.primary,
			SUBROUTINES.gitGh,
			SUBROUTINES.conciseSummary,
		],
	},

	"full-development": {
		name: "full-development",
		description: "For code changes requiring full verification and PR creation",
		subroutines: [
			SUBROUTINES.primary,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
			SUBROUTINES.verboseSummary,
		],
	},

	"debugger-full": {
		name: "debugger-full",
		description:
			"Full debugging workflow with reproduction, fix, and verification",
		subroutines: [
			SUBROUTINES.debuggerReproduction,
			SUBROUTINES.debuggerFix,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
			SUBROUTINES.verboseSummary,
		],
	},

	"orchestrator-full": {
		name: "orchestrator-full",
		description:
			"Full orchestration workflow with decomposition and delegation to sub-agents",
		subroutines: [SUBROUTINES.primary, SUBROUTINES.verboseSummary],
	},

	// Controlled mode procedures - with command analysis and approval gates
	"full-development-controlled": {
		name: "full-development-controlled",
		description:
			"Controlled mode: Analyze command, select response template, get approval, then execute full development workflow",
		subroutines: [
			SUBROUTINES.analyzeCommand,
			SUBROUTINES.selectTemplate,
			SUBROUTINES.getApproval,
			SUBROUTINES.primary,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
			SUBROUTINES.verboseSummary,
		],
	},

	"debugger-full-controlled": {
		name: "debugger-full-controlled",
		description:
			"Controlled mode: Analyze command, select response template, get approval, then execute debugging workflow",
		subroutines: [
			SUBROUTINES.analyzeCommand,
			SUBROUTINES.selectTemplate,
			SUBROUTINES.debuggerReproduction,
			SUBROUTINES.getApproval,
			SUBROUTINES.debuggerFix,
			SUBROUTINES.verifications,
			SUBROUTINES.gitGh,
			SUBROUTINES.verboseSummary,
		],
	},

	"documentation-edit-controlled": {
		name: "documentation-edit-controlled",
		description:
			"Controlled mode: Analyze command, select response template, get approval, then edit documentation",
		subroutines: [
			SUBROUTINES.analyzeCommand,
			SUBROUTINES.selectTemplate,
			SUBROUTINES.getApproval,
			SUBROUTINES.primary,
			SUBROUTINES.gitGh,
			SUBROUTINES.conciseSummary,
		],
	},

	"simple-question-controlled": {
		name: "simple-question-controlled",
		description:
			"Controlled mode: Analyze command, select response template, then answer question (no approval needed for read-only)",
		subroutines: [
			SUBROUTINES.analyzeCommand,
			SUBROUTINES.selectTemplate,
			SUBROUTINES.primary,
			SUBROUTINES.conciseSummary,
		],
	},
};

/**
 * Mapping from request classification to procedure name
 */
export const CLASSIFICATION_TO_PROCEDURE: Record<
	RequestClassification,
	string
> = {
	question: "simple-question",
	documentation: "documentation-edit",
	transient: "simple-question",
	code: "full-development",
	debugger: "debugger-full",
	orchestrator: "orchestrator-full",
};

/**
 * Get a procedure definition by name
 */
export function getProcedure(name: string): ProcedureDefinition | undefined {
	return PROCEDURES[name];
}

/**
 * Get procedure name for a given classification
 */
export function getProcedureForClassification(
	classification: RequestClassification,
): string {
	return CLASSIFICATION_TO_PROCEDURE[classification];
}

/**
 * Get all available procedure names
 */
export function getAllProcedureNames(): string[] {
	return Object.keys(PROCEDURES);
}
