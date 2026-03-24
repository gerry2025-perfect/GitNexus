<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **GitNexus** (2298 symbols, 5501 relationships, 175 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/GitNexus/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/GitNexus/context` | Codebase overview, check index freshness |
| `gitnexus://repo/GitNexus/clusters` | All functional areas |
| `gitnexus://repo/GitNexus/processes` | All execution flows |
| `gitnexus://repo/GitNexus/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## 开发规范

#### 接到一项任务之后，按照如下总体步骤来进行处理，确保所有需求调整都按照规范来完成：
- 检查当前根目录下是否有 cr-doc 目录，如果没有就创建一个（这个目录是用来放置所有需求和对应实现文档的）；
- 如果 cr-doc 目录存在，检查当前会话是否是对已实现需求的补充，检查方式：
    - 在子目录下查README.md文档，如果当前会话ID在文档中，表示当前是在对这个子目录中的需求进行继续增补；
    - 子目录名称清单是否有能和当前会话上下文中需求所提炼出来的需求名称匹配的子目录名称，如果有匹配，表示当前会话是这个需求进行继续增补；
- 如果 2 中匹配到了已有需求的子目录，就读取这个子目录下的已有文档（这些文档会包括这个需求已经做的方案描述[{需求名称}-solution.md]、用户手册[{需求名称}-userguide.md]、变更清单({需求名称}-changelist.md)、测试用例[{需求名称}-testcase.md]、以及需求总体说明文档[README.md]），用来了解当前需求的历史信息；
- 如果 2 中没有匹配到已有需求子目录，表示当前会话是开发新需求，按如下流程操作：
    - 新增规范文档：
        - 测试用例文档：文件名为{requirement summary}-testcase.md，后续每次测试通过之后更新；
        - 变更清单文档：文件名为{requirement summary}-changelist.md，后续每次变更完成之后更新；
        - 用户手册文档：文件名为{requirement summary}-userguide.md，后续每次人工确认需求阶段性完成之后更新；
        - 实现方案文档：文件名为{requirement summary}-solution.md，后续每次人工确认需求阶段性完成之后更新；
        - 需求总体说明文档：文件名为Readme.md，后续每次人工确认需求阶段性完成之后更新（特别注意：将当前大模型会话恢复脚本输出到文件最末尾，后续可以通过这个脚本继续开发）
    - 新增需求专属的特性分支：
        - 在当前本地git中新增一个特性分支，等人工确定符合需求之后，将变更的代码提交到这个特性分支，但不要做push，只能提交当前需求变更对应的文件；
        - 将当前会话的 会话ID 放到特性分支的新增备注中；

#### 在整个编码过程中，需要按照如下约定来
- 关于文档输出有几项特别需要注意的：
    - 每次变更完代码不要急着输出总结，人工确认完全符合需求之后再生成（但是changelist除外，每次变更都更新）
    - 有需要操作确认的，默认都按照yes进行选择，除非有高危，比如删除文件之类的，才需要人工确认
    - 一轮代码修改完之后，针对当前调整制定测试用例，并测试
        - 如果当前需求有个测试数据，主动进行一次测试，并按需检查执行结果；
        - 如果当前需求没有提供测试数据，可以询问是否要提供测试数据。如果有提供就执行测试，否则就等下次一起测试；
        - 无论是否有测试，都需要记录到测试用例文档中，标识中测试通过、测试不通过、待测试，后续用例经过测试，都要及时更新用例状态；
- 对于复杂逻辑，在构思的时候就需要考虑性能问题，对于循环、嵌套调用等逻辑，都需要按照性能最高的方式来实现，不要先满足功能要求，然后再来优化
- 优先使用单条复合 Bash 命令（如使用 && 连接）以减少工具调用次数，从而减少潜在的确认弹窗。 - 在执行非破坏性操作（如读取文件、列出目录）时，直接执行
- 在开发需求之前都需要先制定好开发计划，计划中的每个步骤逻辑不易过于复杂，尽量控制每次变更的范围
- 每次测试通过之后，提示人工确认是否满足了需求，如果确认符合需求之后：
    - 将变更的代码提交到这个特性分支，但不要做push，只能提交当前需求变更对应的文件（切记：不要提交任何非本次操作的变更）；
    - 提交变更代码的时候尽量精简提炼备注，主要体现改了什么，达到了什么效果，不要通过枚举的方式将每个文件修改的内容都描述进去；
    - 按照规范文档整理输出文档（切记：对于已经生成的内容，需要做一轮检查，以保证文档被及时更新，不要出现文档内容和实际情况不符的情况）；
