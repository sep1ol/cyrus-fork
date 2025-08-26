import type { MCPToolDefinition } from '../../types.js';

/**
 * Tool for creating an agent session on a Linear issue.
 * This creates a new agent session that tracks AI/bot activity on an issue.
 */
export const createAgentSessionToolDefinition: MCPToolDefinition = {
	name: 'linear_agent_session_create',
	description: 'Create an agent session on a Linear issue to track AI/bot activity.',
	input_schema: {
		type: 'object',
		properties: {
			issueId: {
				type: 'string',
				description: 'The ID or identifier of the Linear issue (e.g., "ABC-123" or UUID)'
			},
			externalLink: {
				type: 'string',
				description: 'Optional URL of an external agent-hosted page associated with this session'
			}
		},
		required: ['issueId']
	},
	output_schema: {
		type: 'object',
		properties: {
			success: {
				type: 'boolean',
				description: 'Whether the operation was successful'
			},
			agentSessionId: {
				type: 'string',
				description: 'The ID of the created agent session'
			},
			lastSyncId: {
				type: 'number',
				description: 'The identifier of the last sync operation'
			}
		}
	}
};
