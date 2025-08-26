import type { LinearService } from "../../services/linear-service.js";
import { isCreateAgentSessionArgs } from "../type-guards.js";

/**
 * Handler for creating an agent session on a Linear issue
 */
export function handleCreateAgentSession(linearService: LinearService) {
	return async (args: unknown) => {
		if (!isCreateAgentSessionArgs(args)) {
			throw new Error("Invalid arguments for agent_session_create");
		}

		try {
			// Use raw GraphQL through the Linear client
			// Access the underlying GraphQL client
			const graphQLClient = (linearService as any).client.client;

			const mutation = `
				mutation AgentSessionCreateOnIssue($input: AgentSessionCreateOnIssue!) {
					agentSessionCreateOnIssue(input: $input) {
						success
						lastSyncId
						agentSession {
							id
						}
					}
				}
			`;

			const variables = {
				input: {
					issueId: args.issueId,
					...(args.externalLink && { externalLink: args.externalLink }),
				},
			};

			console.log(`Creating agent session for issue ${args.issueId}`);

			const response = await graphQLClient.rawRequest(mutation, variables);

			const result = response.data.agentSessionCreateOnIssue;

			if (!result.success) {
				throw new Error("Failed to create agent session");
			}

			console.log(
				`Agent session created successfully: ${result.agentSession.id}`,
			);

			return {
				success: result.success,
				agentSessionId: result.agentSession.id,
				lastSyncId: result.lastSyncId,
			};
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Failed to create agent session: ${error.message}`);
			}
			throw error;
		}
	};
}
