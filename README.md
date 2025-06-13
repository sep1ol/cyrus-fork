# Cyrus

<div>
  <a href="https://ceedar.ai">
    <img src="https://img.shields.io/badge/Built%20by-Ceedar.ai-b8ec83?style=for-the-badge&logoColor=black&labelColor=333333" alt="Built by Ceedar.ai">
  </a><br />
  <a href="https://github.com/ceedaragents/cyrus/actions">
    <img src="https://github.com/ceedaragents/cyrus/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</div>


AI development agent for Linear powered by Claude Code. Cyrus monitors Linear issues assigned to it, creates isolated Git worktrees for each issue, runs Claude Code sessions to process them, and posts responses back to Linear as comments.

## Installation

### Via npm (recommended)

```bash
npm install -g cyrus-ai
```

## Quick Start

1. Run the setup wizard:
   ```bash
   cyrus
   ```

2. Follow the prompts to:
   - Connect your Linear workspace via OAuth
   - Configure your repository settings
   - Set up allowed tools (security configuration)

3. The agent will start monitoring issues assigned to you in Linear and process them automatically.

## Submitting Work To GitHub

When Claude creates PRs using the `gh` CLI tool, it uses your local GitHub authentication. This means:

- All PRs and commits will be created under your GitHub account
- Comments and mentions in the PR will notify your account
- Review requests will be attributed to you
- Your repository permissions apply to all operations
- The only indication that Claude assisted is the "Co-Authored-By" commit trailer

## Documentation Resources

- [Linear Agents Documentation](https://linear.app/developers/agents)
- [Linear API Documentation](https://developers.linear.app/docs)
- [Linear OAuth Documentation](https://developers.linear.app/docs/oauth/authentication)
- [Linear Webhooks Documentation](https://developers.linear.app/docs/webhooks/getting-started)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
- [Anthropic Claude API Documentation](https://docs.anthropic.com/claude/reference/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

Developed by [Ceedar](https://ceedar.ai/)

This projects builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:
- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)

---

*This README was last updated: June 11 2025*
