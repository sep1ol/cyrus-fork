# Cyrus

<p align="center">
  <a href="https://ceedar.ai">
    <img src="https://img.shields.io/badge/Built%20by-Ceedar.ai-b8ec83?style=for-the-badge&logoColor=black&labelColor=333333" alt="Built by Ceedar.ai">
  </a>
  <a href="https://github.com/ceedario/secret-agents/actions">
    <img src="https://github.com/ceedario/secret-agents/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>

### Tool Permissions (optional)

- `CLAUDE_ALLOWED_TOOLS`: Comma-separated list of Claude Code tools to allow (e.g., "Read,Glob,Grep,WebFetch"). 
  If not specified, defaults to read-only tools.
- `CLAUDE_READ_ONLY`: Set to "false" to allow all tools when `CLAUDE_ALLOWED_TOOLS` is not specified. Defaults to "true".

Available tools: https://docs.anthropic.com/en/docs/claude-code/security

### GitHub Actions

When Claude creates PRs using the `gh` CLI tool, it uses your local GitHub authentication. This means:

- All PRs and commits will be created under your GitHub account
- Comments and mentions in the PR will notify your account
- Review requests will be attributed to you
- Your repository permissions apply to all operations
- The only indication that Claude assisted is the "Co-Authored-By" commit trailer

Always review PR contents before allowing Claude to create them on your behalf.

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

Made possible by:
- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)

---

*This README was last updated: June 11 2025*
