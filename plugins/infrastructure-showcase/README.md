# Hooks

Claude Code hooks that enable skill auto-activation, file tracking, and validation.

---

## What Are Hooks?

Hooks are scripts that run at specific points in Claude's workflow:
- **UserPromptSubmit**: When user submits a prompt
- **PreToolUse**: Before a tool executes  
- **PostToolUse**: After a tool completes
- **Stop**: When user requests to stop

**Key insight:** Hooks can modify prompts, block actions, and track state - enabling features Claude can't do alone.

---

## Essential Hooks (Start Here)

### skill-activation-prompt (UserPromptSubmit)

**Purpose:** Automatically suggests relevant skills based on user prompts and file context

**How it works:**
1. Scans and merges `skill-rules.json` from all levels
2. Matches user prompt against trigger patterns
3. Checks which files user is working with
4. Injects skill suggestions into Claude's context

**Why it's essential:** This is THE hook that makes skills auto-activate.

**Multi-Level Skill Loading:**

| Priority | Level | Path |
|----------|-------|------|
| 4 (highest) | project | `<project>/.claude/skills/skill-rules.json` |
| 3 | project-plugin | `<project>/.claude/plugins/*/skills/skill-rules.json` |
| 2 | global-plugin | `~/.claude/plugins/marketplaces/*/plugins/*/skills/skill-rules.json` |
| 1 (lowest) | global | `~/.claude/skills/skill-rules.json` |

**Merge Strategy:**
- Same-name skills: Higher priority overrides lower
- Different-name skills: All preserved
- Each skill is tagged with `source` field for debugging

**Integration:**
```bash
# Copy both files
cp skill-activation-prompt.sh your-project/.claude/hooks/
cp skill-activation-prompt.ts your-project/.claude/hooks/

# Make executable
chmod +x your-project/.claude/hooks/skill-activation-prompt.sh

# Install dependencies
cd your-project/.claude/hooks
npm install
```

**Add to settings.json:**
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/skill-activation-prompt.sh"
          }
        ]
      }
    ]
  }
}
```

**Customization:** ✅ None needed - reads skill-rules.json automatically

**Relationship with skill-developer:**

The `skill-activation-prompt` hook and `skill-developer` skill work together as a complete skill management system:

| Component | Role | Location |
|-----------|------|----------|
| skill-activation-prompt (hook) | **Runtime engine** - Detects when skills should activate | `hooks/skill-activation-prompt.ts` |
| skill-developer (skill) | **Development guide** - How to create/configure skills | `skills/skill-developer/` |
| skill-rules.json | **Configuration** - Defines trigger rules for all skills | `skills/skill-rules.json` |

**How they connect:**

```
User prompt → skill-activation-prompt hook
                    ↓
              Reads skill-rules.json
                    ↓
              Matches triggers (keywords, patterns)
                    ↓
              Suggests/blocks based on enforcement level
                    ↓
              Claude uses Skill tool to load skill content
```

**When to use each:**
- **skill-activation-prompt hook**: Install once, runs automatically on every prompt
- **skill-developer skill**: Use when creating new skills or modifying skill-rules.json
- **skill-rules.json**: Edit to add/modify skill triggers

**Example flow:**
1. User types: "create a new skill for database migrations"
2. Hook detects keywords: "create", "skill" → matches skill-developer triggers
3. Hook suggests: "RECOMMENDED SKILLS: skill-developer"
4. Claude loads skill-developer content
5. Claude guides user through skill creation using skill-developer knowledge
6. skill-developer save skill in project's skill-rules.json by default. but user can choose to save in other level skill-rules.json
7. skill-activation-prompt hook will scan all four level skill-rules.json and suggest relevant skills 

---

### post-tool-use-tracker (PostToolUse)

**Purpose:** Tracks file changes to maintain context across sessions

**How it works:**
1. Monitors Edit/Write/MultiEdit tool calls
2. Records which files were modified
3. Creates cache for context management
4. Auto-detects project structure (frontend, backend, packages, etc.)

**Why it's essential:** Helps Claude understand what parts of your codebase are active.

**Integration:**
```bash
# Copy file
cp post-tool-use-tracker.sh your-project/.claude/hooks/

# Make executable
chmod +x your-project/.claude/hooks/post-tool-use-tracker.sh
```

**Add to settings.json:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/post-tool-use-tracker.sh"
          }
        ]
      }
    ]
  }
}
```

**Customization:** ✅ None needed - auto-detects structure

---

## Optional Hooks (Require Customization)

### tsc-check (Stop)

**Purpose:** TypeScript compilation check when user stops

**⚠️ WARNING:** Configured for multi-service monorepo structure

**Integration:**

**First, determine if this is right for you:**
- ✅ Use if: Multi-service TypeScript monorepo
- ❌ Skip if: Single-service project or different build setup

**If using:**
1. Copy tsc-check.sh
2. **EDIT the service detection (line ~28):**
   ```bash
   # Replace example services with YOUR services:
   case "$repo" in
       api|web|auth|payments|...)  # ← Your actual services
   ```
3. Test manually before adding to settings.json

**Customization:** ⚠️⚠️⚠️ Heavy

---

### trigger-build-resolver (Stop)

**Purpose:** Auto-launches build-error-resolver agent when compilation fails

**Depends on:** tsc-check hook working correctly

**Customization:** ✅ None (but tsc-check must work first)

---

## For Claude Code

**When setting up hooks for a user:**

1. **Read [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md)** first
2. **Always start with the two essential hooks**
3. **Ask before adding Stop hooks** - they can block if misconfigured  
4. **Verify after setup:**
   ```bash
   ls -la .claude/hooks/*.sh | grep rwx
   ```

**Questions?** See [CLAUDE_INTEGRATION_GUIDE.md](../../CLAUDE_INTEGRATION_GUIDE.md)
