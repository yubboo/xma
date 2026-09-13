# XMA Development Skill

## 作用

给参与 XMA 开发的 Coding Agent 一套短而强制的执行清单。完整规则以根 `AGENTS.md` 和 `docs/` 为准；本 Skill 不能覆盖它们。

## 开工前

1. 阅读 `AGENTS.md`。
2. 阅读 `docs/architecture/PROJECT-ARCHITECTURE.md`、`AGENT-RUNTIME.md`、`MODEL-PROVIDER.md`、`PLUGIN-SYSTEM.md`。
3. 阅读 `docs/development/DEVELOPMENT-RULES.md`、`DEVELOPMENT-PLAN.md`、`PROJECT-STATUS.md`、`UPSTREAM-REFERENCE.md`。
4. 若涉及 Windows/发布，额外阅读 `WINDOWS-WORKFLOW.md` 与 `VERSIONING-AND-RELEASES.md`。
5. 先判断修改属于 TypeScript Agent/业务层还是 Rust Native/Security 层；不允许语言职责漂移。

## 实施纪律

- Provider Model 是推理核心，不写关键词路由/固定 Planner 替代模型。
- Model-visible 动态内容必须可从 Session/Context source 重建。
- 新行为优先通过 Provider/Tool/Context/Session/Plugin extension point；不要给 Agent Loop 加业务特例。
- Tool 必须有 Schema、权限/Capability、structured result、取消语义和测试；模型 Schema 与 Runtime 必须来自同一个 frozen ToolPlan。
- 需要 Approval 的副作用先 durable 记录最终决策再执行；allow-session 没有稳定 scope key 时禁止复用。
- Rust 只执行 Native/Security/Performance，不实现专业 Agent 决策；Native 先锁 Host Policy，真实 FS/Process 再由 Rust capability 二次 enforcement。
- UI 是 Runtime 客户端；当前优先底层，不为“看起来完成”堆假 UI。
- 不提交 Secret、node_modules、target、dist、根 runtime、用户 Workspace 或发布包。
- Windows 外部命令统一走 `Invoke-XmaExternal -FilePath ... -ArgumentList ...`。
- 命名遵循 XMA 统一规则：目录/TS 用小写 kebab-case，Rust 用 snake_case，`.` 只用于 test/config/d 等语义角色；普通名字 1～3 个核心词，父目录去重，同逻辑不碎拆，完成前运行 `pnpm gate:naming`。

## 完成前

- 运行与变更面匹配的 typecheck/test/Gate；不能运行的检查要明确说明原因。
- Provider/Native/跨平台能力没有真实 E2E 就不能宣称完成。
- 修改架构时同步文档和 Gate。
- 未冻结 0.1.0 修正仍交付 `xma-0.1.0.zip` + `xma-0.1.0.sha256.txt`，禁止 fixed/hotfix/final/v2/new。
