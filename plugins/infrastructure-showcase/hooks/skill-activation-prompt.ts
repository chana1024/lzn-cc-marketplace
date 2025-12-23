#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

interface HookInput {
    session_id: string;
    transcript_path: string;
    cwd: string;
    permission_mode: string;
    prompt: string;
}

interface PromptTriggers {
    keywords?: string[];
    intentPatterns?: string[];
}

interface SkillRule {
    type: 'guardrail' | 'domain';
    enforcement: 'block' | 'suggest' | 'warn';
    priority: 'critical' | 'high' | 'medium' | 'low';
    promptTriggers?: PromptTriggers;
    source?: string; // Track which level this skill came from
}

interface SkillRules {
    version: string;
    skills: Record<string, SkillRule>;
}

interface MatchedSkill {
    name: string;
    matchType: 'keyword' | 'intent';
    config: SkillRule;
}

interface SkillSource {
    level: 'global' | 'global-plugin' | 'project-plugin' | 'project';
    path: string;
    priority: number; // Higher number = higher priority
}

/**
 * Get all skill-rules.json paths from all levels
 * Priority order (highest to lowest): project > project-plugin > global-plugin > global
 */
function getSkillSources(): SkillSource[] {
    const sources: SkillSource[] = [];
    const home = process.env.HOME || '';
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || '';

    // 1. Global level (lowest priority)
    const globalPath = join(home, '.claude', 'skills', 'skill-rules.json');
    if (existsSync(globalPath)) {
        sources.push({ level: 'global', path: globalPath, priority: 1 });
    }

    // 2. Global plugin level - scan all marketplace plugins
    const globalPluginsBase = join(home, '.claude', 'plugins', 'marketplaces');
    if (existsSync(globalPluginsBase)) {
        try {
            const marketplaces = readdirSync(globalPluginsBase);
            for (const marketplace of marketplaces) {
                const pluginsDir = join(globalPluginsBase, marketplace, 'plugins');
                if (existsSync(pluginsDir) && statSync(pluginsDir).isDirectory()) {
                    const plugins = readdirSync(pluginsDir);
                    for (const plugin of plugins) {
                        const skillPath = join(pluginsDir, plugin, 'skills', 'skill-rules.json');
                        if (existsSync(skillPath)) {
                            sources.push({ level: 'global-plugin', path: skillPath, priority: 2 });
                        }
                    }
                }
            }
        } catch {
            // Ignore errors when scanning directories
        }
    }

    // 3. Project plugin level - scan project's .claude/plugins
    const projectPluginsDir = join(projectDir, '.claude', 'plugins');
    if (existsSync(projectPluginsDir)) {
        try {
            const projectPlugins = readdirSync(projectPluginsDir);
            for (const plugin of projectPlugins) {
                const pluginPath = join(projectPluginsDir, plugin);
                if (statSync(pluginPath).isDirectory()) {
                    const skillPath = join(pluginPath, 'skills', 'skill-rules.json');
                    if (existsSync(skillPath)) {
                        sources.push({ level: 'project-plugin', path: skillPath, priority: 3 });
                    }
                }
            }
        } catch {
            // Ignore errors when scanning directories
        }
    }

    // 4. Project level (highest priority)
    const projectPath = join(projectDir, '.claude', 'skills', 'skill-rules.json');
    if (existsSync(projectPath)) {
        sources.push({ level: 'project', path: projectPath, priority: 4 });
    }

    return sources;
}

/**
 * Merge skill rules from all sources
 * Higher priority sources override lower priority ones for same skill name
 */
function mergeSkillRules(sources: SkillSource[]): SkillRules {
    const merged: SkillRules = { version: '1.0', skills: {} };

    // Sort by priority ascending (lower priority loaded first, higher overwrites)
    sources.sort((a, b) => a.priority - b.priority);

    for (const source of sources) {
        try {
            const content = readFileSync(source.path, 'utf-8');
            const rules: SkillRules = JSON.parse(content);

            // Merge skills, adding source info
            for (const [name, config] of Object.entries(rules.skills)) {
                merged.skills[name] = { ...config, source: source.level };
            }
        } catch {
            // File read or parse error, skip this source
        }
    }

    return merged;
}

async function main() {
    try {
        // Read input from stdin
        const input = readFileSync(0, 'utf-8');
        const data: HookInput = JSON.parse(input);
        const prompt = data.prompt.toLowerCase();

        // Load and merge skill rules from all levels
        const sources = getSkillSources();
        const rules = mergeSkillRules(sources);

        const matchedSkills: MatchedSkill[] = [];

        // Check each skill for matches
        for (const [skillName, config] of Object.entries(rules.skills)) {
            const triggers = config.promptTriggers;
            if (!triggers) {
                continue;
            }

            // Keyword matching
            if (triggers.keywords) {
                const keywordMatch = triggers.keywords.some(kw =>
                    prompt.includes(kw.toLowerCase())
                );
                if (keywordMatch) {
                    matchedSkills.push({ name: skillName, matchType: 'keyword', config });
                    continue;
                }
            }

            // Intent pattern matching
            if (triggers.intentPatterns) {
                const intentMatch = triggers.intentPatterns.some(pattern => {
                    const regex = new RegExp(pattern, 'i');
                    return regex.test(prompt);
                });
                if (intentMatch) {
                    matchedSkills.push({ name: skillName, matchType: 'intent', config });
                }
            }
        }

        // Generate structured output for hook
        if (matchedSkills.length > 0) {
            // Group by priority
            const critical = matchedSkills.filter(s => s.config.priority === 'critical');
            const high = matchedSkills.filter(s => s.config.priority === 'high');
            const medium = matchedSkills.filter(s => s.config.priority === 'medium');
            const low = matchedSkills.filter(s => s.config.priority === 'low');

            // Check if any critical skill with 'block' enforcement is matched
            const shouldBlock = critical.some(s => s.config.enforcement === 'block');

            // Build additional context message
            let contextParts: string[] = [];
            contextParts.push('SKILL ACTIVATION CHECK');
            contextParts.push('');

            if (critical.length > 0) {
                contextParts.push('CRITICAL SKILLS (REQUIRED):');
                critical.forEach(s => contextParts.push(`  - ${s.name}`));
                contextParts.push('');
            }

            if (high.length > 0) {
                contextParts.push('RECOMMENDED SKILLS:');
                high.forEach(s => contextParts.push(`  - ${s.name}`));
                contextParts.push('');
            }

            if (medium.length > 0) {
                contextParts.push('SUGGESTED SKILLS:');
                medium.forEach(s => contextParts.push(`  - ${s.name}`));
                contextParts.push('');
            }

            if (low.length > 0) {
                contextParts.push('OPTIONAL SKILLS:');
                low.forEach(s => contextParts.push(`  - ${s.name}`));
                contextParts.push('');
            }

            contextParts.push('ACTION: Use Skill tool BEFORE responding');

            // Build structured output
            const hookOutput: {
                decision?: 'block';
                reason?: string;
                hookSpecificOutput: {
                    hookEventName: string;
                    additionalContext: string;
                };
            } = {
                hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit',
                    additionalContext: contextParts.join('\n')
                }
            };

            // Add block decision if critical blocking skill is matched
            if (shouldBlock) {
                hookOutput.decision = 'block';
                hookOutput.reason = `Critical skill required: ${critical.filter(s => s.config.enforcement === 'block').map(s => s.name).join(', ')}. Please use the skill tool to invoke these skills first.`;
            }

            console.log(JSON.stringify(hookOutput));
        }

        process.exit(0);
    } catch (err) {
        console.error('Error in skill-activation-prompt hook:', err);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
});
