import { ExpressWebhookService } from '../../../src/adapters/ExpressWebhookService.mjs';
import { jest } from '@jest/globals';

describe('ExpressWebhookService', () => {
  let webhookService;
  let mockIssueService;
  let mockHttpServer;
  let mockOAuthHelper;

  beforeEach(() => {
    // Create mock services with manually implemented mocks
    mockIssueService = {
      handleAgentMention: function() { return Promise.resolve(); },
      handleAgentAssignment: function() { return Promise.resolve(); },
      handleAgentReply: function() { return Promise.resolve(); },
      handleCommentEvent: function() { return Promise.resolve(); },
      // Mock the userId that our agent uses
      userId: 'agent-user-id'
    };
    
    // Track calls to the handler methods
    mockIssueService.handleAgentMention = jest.fn(mockIssueService.handleAgentMention);
    mockIssueService.handleAgentAssignment = jest.fn(mockIssueService.handleAgentAssignment);
    mockIssueService.handleAgentReply = jest.fn(mockIssueService.handleAgentReply);
    mockIssueService.handleCommentEvent = jest.fn(mockIssueService.handleCommentEvent);

    mockHttpServer = {
      createServer: jest.fn().mockReturnValue({}),
      jsonParser: jest.fn().mockReturnValue([]),
      listen: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue({}),
    };

    mockOAuthHelper = {};

    // Create webhook service
    webhookService = new ExpressWebhookService(
      'webhook-secret',
      mockIssueService,
      mockHttpServer,
      mockOAuthHelper
    );
  });

  describe('processAgentNotification', () => {
    it('should ignore comments from the agent itself to prevent infinite loops', async () => {
      // Test case 1: Agent is the actor (direct match)
      const selfCommentData1 = {
        type: 'issueNewComment',
        issueId: 'issue-123',
        issue: { identifier: 'ABC-123' },
        commentId: 'comment-456',
        comment: { userId: 'some-other-id', body: 'Test comment' },
        actor: { id: 'agent-user-id', name: 'Agent Bot' },
        userId: 'agent-user-id'
      };

      // Test case 2: Agent is the comment creator (userId match)
      const selfCommentData2 = {
        type: 'issueNewComment',
        issueId: 'issue-123',
        issue: { identifier: 'ABC-123' },
        commentId: 'comment-789',
        comment: { userId: 'agent-user-id', body: 'Another test comment' },
        actor: { id: 'some-other-id', name: 'Human User' },
        userId: 'agent-user-id'
      };

      // Test case 3: Comment from another user (should be processed)
      const humanCommentData = {
        type: 'issueNewComment',
        issueId: 'issue-123',
        issue: { identifier: 'ABC-123' },
        commentId: 'comment-101',
        comment: { userId: 'human-user-id', body: 'Human comment' },
        actor: { id: 'human-user-id', name: 'Human User' },
        userId: 'agent-user-id'
      };

      // Act - Process all three notifications
      await webhookService.processAgentNotification('issueNewComment', selfCommentData1);
      await webhookService.processAgentNotification('issueNewComment', selfCommentData2);
      await webhookService.processAgentNotification('issueNewComment', humanCommentData);

      // Assert
      // The issue service should NOT be called for the agent's own comments
      expect(mockIssueService.handleAgentMention.mock.calls.length).toBe(1);
      
      // It should only be called for the human comment
      expect(mockIssueService.handleAgentMention.mock.calls[0][0]).toEqual({
        commentId: 'comment-101',
        comment: { userId: 'human-user-id', body: 'Human comment' },
        issueId: 'issue-123',
        issue: { identifier: 'ABC-123' },
        actor: { id: 'human-user-id', name: 'Human User' }
      });
    });
  });

  describe('processEvent', () => {
    it('should ignore comment events from the agent itself', async () => {
      // Create test data
      const agentCommentData = {
        type: 'Comment',
        action: 'create',
        data: {
          issueId: 'issue-123',
          body: 'This is a comment from the agent',
          user: {
            id: 'agent-user-id', // This matches the agent's userId
            name: 'Agent Bot'
          }
        }
      };

      const humanCommentData = {
        type: 'Comment',
        action: 'create',
        data: {
          issueId: 'issue-123',
          body: 'This is a comment from a human',
          user: {
            id: 'human-user-id', // This is different from the agent's userId
            name: 'Human User'
          }
        }
      };

      // Act - Process both events
      await webhookService.processEvent('Comment', 'create', agentCommentData.data);
      await webhookService.processEvent('Comment', 'create', humanCommentData.data);

      // Assert
      // handleCommentEvent should only be called once, for the human comment
      expect(mockIssueService.handleCommentEvent.mock.calls.length).toBe(1);
      
      // It should be called with the human comment data
      expect(mockIssueService.handleCommentEvent.mock.calls[0][0]).toBe(humanCommentData.data);
    });
  });
});