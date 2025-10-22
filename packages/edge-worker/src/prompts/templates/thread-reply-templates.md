# Thread Reply Templates - Reference Guide

This document defines the available response templates for Linear thread replies. Each template has specific use cases and formatting guidelines.

---

## 🟢 TIER 1 - Priority Templates

### Template: `just-replying`
**When to use:** DEFAULT template for 95% of responses - quick confirmations, task completions, simple updates

**Characteristics:**
- 30-100 characters total (ultra concise!)
- Very casual, direct tone
- No sections or headers
- Just the essential info
- Usually just "✅ Feito" or similar

**Examples:**
```
✅ Feito
```

```
✅ Corrigido
```

```
✅ Feature implementada, PR #145
```

```
✅ Atualizado
```

**Non-examples (TOO LONG for just-replying):**
```
❌ "Feito! Checklist reduzido de 100 para 20 itens." (use only if user asked for details)
```

---

### Template: `task-completion`
**When to use:** Task completed successfully with multiple changes

**Characteristics:**
- 200-600 characters
- 3 clear sections: O que fiz / Mudanças / Status
- Professional but friendly
- Includes PR link if applicable

**Format:**
```
✅ [Brief summary of what was accomplished]

**O que fiz:**
[1-2 sentence overview]

**Mudanças:**
- [Key change 1]
- [Key change 2]
- [Key change 3]

**Status:** [Current status + PR link if created]
```

**Example:**
```
✅ Feature de export CSV implementada.

**O que fiz:**
Criei novo endpoint `/export` com suporte a CSV e Excel.

**Mudanças:**
- Novo controller `ExportController.ts`
- Lógica de conversão para CSV/XLSX
- Testes de integração completos

**Status:** PR #145 criado e pronto para review.
```

---

### Template: `documentation`
**When to use:** Technical explanations, how-to guides, architectural decisions

**Characteristics:**
- 400-1000 characters
- 3 sections: Contexto / Como funciona / Exemplo
- Educational tone
- Can include code snippets

**Format:**
```
**Contexto:**
[Why this exists / background]

**Como funciona:**
[Technical explanation]

**Exemplo:**
[Code snippet or usage example]
```

**Example:**
```
**Contexto:**
O sistema de autenticação usa JWT com refresh tokens para manter sessões seguras.

**Como funciona:**
1. Login retorna access token (15min) + refresh token (7 dias)
2. Access token usado em todas as requests
3. Quando expira, usa refresh token para pegar novo access token
4. Refresh token armazenado em httpOnly cookie

**Exemplo:**
\`\`\`typescript
const { accessToken, refreshToken } = await login(email, password);
// Use accessToken em headers: Authorization: Bearer {token}
\`\`\`
```

---

## 🟡 TIER 2 - Utility Templates

### Template: `default`
**When to use:** General responses that don't fit other templates

**Characteristics:**
- 150-400 characters
- Maximum 2 h3 headers
- Balanced formality
- Fallback template

**Format:**
```
[Opening statement]

### [Optional section 1]
[Content]

### [Optional section 2]
[Content]

[Closing if needed]
```

**Example:**
```
Analisei o código e identifiquei o problema.

### Causa
O endpoint estava usando GET em vez de POST.

### Solução
Mudei para POST e adicionei validação de body.
```

---

### Template: `error-report`
**When to use:** When something failed or encountered errors

**Characteristics:**
- 200-500 characters
- Clear problem statement
- What went wrong
- Next steps or workaround

**Format:**
```
⚠️ [Problem statement]

**O que aconteceu:**
[Brief explanation]

**Erro:**
[Error message or description]

**Próximos passos:**
[What needs to be done]
```

**Example:**
```
⚠️ Não consegui completar a tarefa devido a erro de build.

**O que aconteceu:**
O TypeScript está reportando 5 erros de tipo no novo código.

**Erro:**
Property 'userId' does not exist on type 'User'

**Próximos passos:**
Preciso que você revise o tipo `User` em `types.ts` e confirme se deve ter `userId` ou `id`.
```

---

## 🔴 TIER 3 - Special Templates

### Template: `important-note`
**When to use:** Critical warnings, breaking changes, important decisions

**Can be manually forced:** Yes (via `[template:important-note]`)

**Characteristics:**
- 150-400 characters
- Serious, direct tone
- Clear call-out of importance
- Action items if needed

**Format:**
```
🚨 **IMPORTANTE:** [Critical information]

[Explanation]

**Ação necessária:**
[What user needs to do]
```

**Example:**
```
🚨 **IMPORTANTE:** A mudança no schema vai quebrar a API v1.

A nova estrutura de User remove o campo `email` e adiciona `emailAddress`.

**Ação necessária:**
- Atualizar frontend antes do deploy
- Rodar migration: `npm run db:migrate`
- Avisar time mobile
```

---

### Template: `pr-created`
**When to use:** Specifically when a PR was created

**Characteristics:**
- 250-500 characters
- Link to PR prominent
- Brief summary + review checklist
- Encourages review

**Format:**
```
✅ PR criado: [PR title]

**Resumo:**
[What this PR does]

**Link:** #[PR number]

**Review checklist:**
- [ ] [Item 1]
- [ ] [Item 2]
- [ ] [Item 3]
```

**Example:**
```
✅ PR criado: Implementar autenticação JWT

**Resumo:**
Sistema completo de auth com JWT, refresh tokens, e middleware de proteção de rotas.

**Link:** #187

**Review checklist:**
- [ ] Testes de integração passando
- [ ] Security review (tokens, cookies)
- [ ] Documentação da API atualizada
```

---

## Template Selection Guidelines

The AI should select templates based on:

1. **just-replying**: Simple confirmations, one-line updates, casual replies
2. **task-completion**: Multi-step tasks completed successfully
3. **documentation**: Explaining how something works, architectural details
4. **default**: Doesn't clearly fit other categories
5. **error-report**: Something failed or needs attention
6. **important-note**: ONLY if manually specified or truly critical
7. **pr-created**: ONLY when a PR was actually created

**Priority order when uncertain:**
1. Check for manual override `[template:X]`
2. Did it fail? → `error-report`
3. Was PR created? → `pr-created`
4. Is it a simple confirmation? → `just-replying`
5. Multiple changes made? → `task-completion`
6. Explaining how something works? → `documentation`
7. None of the above → `default`
