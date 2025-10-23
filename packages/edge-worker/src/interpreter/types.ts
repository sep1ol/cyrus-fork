/**
 * Event Interpreter Types
 * Type-safe action definitions for Linear event interpretation
 */

// Zod schemas will be added in interpreter/schemas.ts

/**
 * All possible action types the interpreter can generate
 */
export type ActionType =
	| "answer_question"
	| "execute_task"
	| "search_codebase"
	| "create_sub_issues"
	| "update_documentation"
	| "run_tests"
	| "review_code"
	| "debug_issue"
	| "acknowledge_only"
	| "delegate_to_agent"
	| "no_action";

/**
 * Context about where the event came from
 */
export interface EventContext {
	/** Linear workspace/organization */
	organizationId: string;
	/** Project ID if applicable */
	projectId?: string;
	/** Issue ID */
	issueId: string;
	/** Issue identifier (e.g., "CYR-123") */
	issueIdentifier: string;
	/** Issue title */
	issueTitle: string;
	/** Comment ID if triggered by comment */
	commentId?: string;
	/** Comment body if applicable */
	commentBody?: string;
	/** Parent comment ID for thread context */
	parentCommentId?: string;
	/** Team key (e.g., "ENG", "DESIGN") */
	teamKey?: string;
	/** User who triggered the event */
	userId?: string;
	/** Labels on the issue */
	labels?: string[];
	/** Current issue state */
	state?: string;
	/** Priority level */
	priority?: number;
}

/**
 * Answer a question about the codebase
 */
export interface AnswerQuestionAction {
	type: "answer_question";
	question: string;
	/** Where to post the answer */
	replyTo: "issue" | "comment_thread";
	/** Whether this requires deep code analysis */
	requiresCodeAnalysis: boolean;
	/** Specific files/paths to focus on */
	focusPaths?: string[];
}

/**
 * Execute a development task
 */
export interface ExecuteTaskAction {
	type: "execute_task";
	taskDescription: string;
	/** Estimated complexity */
	complexity: "simple" | "medium" | "complex";
	/** Whether to break into subtasks */
	shouldDecompose: boolean;
	/** Approval required before making changes */
	requiresApproval: boolean;
	/** Files that will likely be modified */
	affectedFiles?: string[];
	/** Testing required */
	requiresTesting: boolean;
}

/**
 * Search/explore the codebase
 */
export interface SearchCodebaseAction {
	type: "search_codebase";
	query: string;
	searchType: "keyword" | "pattern" | "semantic" | "file_structure";
	/** Specific directories to search */
	scope?: string[];
}

/**
 * Create sub-issues for decomposition
 */
export interface CreateSubIssuesAction {
	type: "create_sub_issues";
	parentIssueId: string;
	subTasks: Array<{
		title: string;
		description: string;
		assignee?: string;
		labels?: string[];
		priority?: number;
	}>;
}

/**
 * Update documentation
 */
export interface UpdateDocumentationAction {
	type: "update_documentation";
	documentationType: "readme" | "api_docs" | "comments" | "architecture";
	files: string[];
	changes: string;
}

/**
 * Run tests
 */
export interface RunTestsAction {
	type: "run_tests";
	testScope: "all" | "unit" | "integration" | "e2e" | "specific";
	specificTests?: string[];
	affectedFiles?: string[];
}

/**
 * Review code
 */
export interface ReviewCodeAction {
	type: "review_code";
	prNumber?: string;
	files?: string[];
	focusAreas: string[];
}

/**
 * Debug an issue
 */
export interface DebugIssueAction {
	type: "debug_issue";
	symptom: string;
	/** Steps to reproduce */
	reproSteps?: string[];
	/** Should try to reproduce first */
	shouldReproduce: boolean;
	/** Get approval before fixing */
	requiresApprovalBeforeFix: boolean;
}

/**
 * Just acknowledge - no action needed
 */
export interface AcknowledgeOnlyAction {
	type: "acknowledge_only";
	reason: string;
	suggestedNextSteps?: string[];
}

/**
 * Delegate to another agent/person
 */
export interface DelegateToAgentAction {
	type: "delegate_to_agent";
	targetAgent: string;
	reason: string;
	context: string;
}

/**
 * No action - event doesn't require response
 */
export interface NoActionAction {
	type: "no_action";
	reason: string;
}

/**
 * Union of all possible actions
 */
export type InterpreterAction =
	| AnswerQuestionAction
	| ExecuteTaskAction
	| SearchCodebaseAction
	| CreateSubIssuesAction
	| UpdateDocumentationAction
	| RunTestsAction
	| ReviewCodeAction
	| DebugIssueAction
	| AcknowledgeOnlyAction
	| DelegateToAgentAction
	| NoActionAction;

/**
 * Complete interpretation result
 */
export interface InterpretationResult {
	/** What action to take */
	action: InterpreterAction;
	/** Confidence score (0-1) */
	confidence: number;
	/** Reasoning for this interpretation */
	reasoning: string;
	/** Metadata about the interpretation */
	metadata: {
		/** Time taken to interpret */
		interpretationTimeMs: number;
		/** Model used for interpretation */
		model: string;
		/** Whether human review is suggested */
		suggestHumanReview: boolean;
	};
}

/**
 * Input to the interpreter
 */
export interface InterpreterInput {
	/** The event context */
	context: EventContext;
	/** Full text to interpret (issue description + comments) */
	fullText: string;
	/** Repository metadata */
	repository: {
		id: string;
		name: string;
		path: string;
	};
}
