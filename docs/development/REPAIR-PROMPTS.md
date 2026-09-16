# XMA 修复 Prompt 与历史台账

> 按 `REPAIR-WORKFLOW.md` 维护。这里保存每次修复可重放的工程上下文，而不是只保存最终结论。

# 01 Terminal 历史滚动、光标稳定、启动速度与全局命令回归

- 状态：验证中
- 日期：2026-09-16
- 影响范围：`apps/cli/opentui-runtime`、Windows 开发启动链、开发态 `xiaoyu/xma` 全局命令
- 关联历史：Terminal OpenTUI 迁移、实时 Activity、历史滚动修复尝试、Source Sync checkout 一致性修复

## 用户可见症状

1. 对话内容超过当前 viewport 后，鼠标滚轮无法自由向上查看完整历史；窗口放大后部分旧内容才重新可见。
2. 前几轮为了修滚动/布局继续修改巨型 `app.tsx`，已经验收过的输入光标稳定性再次出现回归，“光标到处飞”。
3. Windows 主菜单 `[4]` 启动 Xiaoyu Terminal 经过过多包装进程和重复 Runtime 检查，体感启动慢。
4. 用户期望执行 `[1]` 后，在任意目录都能直接输入 `xiaoyu` 或 `xma`；开发命令的 PATH 注册不能依赖某个 checkout 的临时路径。
5. Source Sync 日志已经显示 215 个受管文件 SHA-256 完全一致，因此“同步没有覆盖源码”不是当前主要根因。

## 已确认事实与证据

- OpenTUI `ScrollBoxRenderable` 的真实滚动范围由 `content.height` 与 `viewport.height` 决定，`scrollSize = content.height`；如果布局把历史裁掉而没有形成真实 content height，补 mouse handler 也不能恢复不可达内容。
- OpenTUI 原生 ScrollBox 已支持 wheel + sticky bottom/manual scroll；MiMo-Code 的会话页直接使用 `ScrollBoxRenderable + stickyScroll + stickyStart="bottom"`，没有为正常滚轮另造一套业务滚动模型。
- Pi 的 alternate-screen TUI 把 Transcript `ScrollView(follow=end, primary=true)` 与 Editor/Footer 做明确父子分区；滚动状态由 ScrollView 自己拥有。
- Codex 区分历史/scrollback 与当前交互 viewport，并避免把所有聊天、输入和动画状态揉成一个可变布局。
- 当前 XMA `app.tsx` 曾同时拥有 Transcript、Prompt、星空/流星、Activity、Dialog、Provider 配置、焦点和滚动；局部修复容易产生跨域回归。
- 当前开发版已经开始拆出 `TranscriptViewport`、`PromptDock`、`BackgroundSky`、`theme`，但需要完成职责收口并重写回归合同。
- 当前 Prompt 仍有应用层 `setInterval` 周期切换 `showCursor`；这与“focused Textarea 原生拥有 terminal caret”的规则冲突，是光标回归的高风险来源。
- 当前 Windows 开发链已经具备 Native fingerprint 缓存和项目 Bun，可直接从项目 Bun 运行 CLI 源码，无需每次再走 `pnpm -> tsx -> bun.ts -> bun`。

## 已被证伪/禁止重复的修法

- 只在根容器新增 wheel fallback，不能解决“历史没有进入真实 scroll range”的布局问题。
- 在 ScrollBox content 使用 `justifyContent: flex-end` 实现短会话贴底，会让长内容产生不可达负向溢出；禁止恢复。
- 继续把滚动、动画、输入光标补丁堆进 `app.tsx`，会扩大耦合；本次必须按子模块 ownership 修复。
- 用父级定时器反复隐藏/显示 Textarea cursor，不再作为“慢闪烁”实现；正确性优先于自定义闪烁节奏。

## 本次修复 Prompt

> 以当前最新 `xma-0.1.0` 源码为第一事实源，修复 Xiaoyu Terminal 的历史滚动、caret 回归、启动速度和全局开发命令。先验证根因再修改，禁止通过继续堆叠 `app.tsx` 补丁完成任务。
>
> 1. **模块化 Terminal Host**：`app.tsx` 只保留父级协调和跨模块状态；Transcript viewport、Prompt/Input Dock、背景动画、Home Logo/动画、主题必须拆成独立子模块。子模块不得反向拥有 Agent Runtime/Provider/Tool 业务逻辑。
> 2. **Transcript 独立拥有滚动**：使用一个真实受限高度的 OpenTUI ScrollBox；父级 flex 链必须允许收缩（`flexGrow=1 / flexShrink=1 / minHeight=0`），Prompt Dock 固定不压缩。短内容贴底只能通过正向 spacer/等价不会产生负向 overflow 的方案；长内容必须让 `content.height > viewport.height`，从而形成真实 `scrollHeight`。依赖 OpenTUI 原生 wheel/sticky manual-scroll，删除会重复处理/掩盖根因的 root wheel fallback。键盘 PageUp/PageDown/Ctrl+Home/Ctrl+End 继续调用同一个 ScrollBox。
> 3. **Caret ownership**：focused OpenTUI Textarea 必须始终拥有 terminal cursor。删除父级 `promptCursorVisible` 定时闪烁状态和 800ms toggle；Prompt 使用 OpenTUI/terminal 原生 cursor blink 或稳定可见 cursor。背景星空、流星、Logo 动画不得调用 Prompt `requestRender()` 或 `setCursorPosition()`。Modal 可以在自己的生命周期内 blur Prompt，但关闭后只能通过统一 refocus path 恢复。
> 4. **动画隔离**：背景与 Home Logo 的动画状态留在自己的组件内；进入会话后停止不必要的高频装饰动画，禁止每个装饰帧驱动 XiaoyuApp 父级状态。
> 5. **Windows 启动提速**：`[4]` 和全局 `xiaoyu/xma` 在 `[1]` 已准备依赖后，直接使用项目 `node_modules/bun/bin/bun.exe` 启动 CLI 源码；Native Runtime 先 fingerprint 命中缓存，只有 miss 才做 cargo offline/build。不得每次日常启动再走 `pnpm -> tsx -> bun.ts -> bun`。
> 6. **稳定 User PATH**：`[1]` 把固定 `%LOCALAPPDATA%\\Xiaoyu\\dev-bin` 写入 Windows User PATH；`xiaoyu.cmd/xma.cmd` 从该稳定目录读取 `source-root.txt` 指向当前 checkout。Source Sync 只更新指针，不反复把 checkout-local `.git/xma-state/dev-bin` 塞进 PATH。不得默认要求管理员 Machine PATH。
> 7. **回归测试升级**：测试必须分别读取新的子模块，锁定 ownership；新增“父级不得拥有 cursor blink timer/Transcript flex-end/root wheel fallback”的防回归断言；Windows Gate 锁定稳定 User PATH + 直接 Bun 启动。不要用旧的“所有代码必须在 app.tsx”静态测试阻碍模块化。
> 8. 更新 `AGENTS.md`、`DEVELOPMENT-RULES.md`、`CODEMAP.md`、`PROJECT-STATUS.md`、`UPDATE-LOG.md`，并在本条目中回填最终根因、验证证据和待实机验收项。重新生成 Source Manifest 与正式 `xma-0.1.0.zip`。

## 不允许回归的行为

- Provider 首次配置、API Key/模型选择、Tool Approval、Build/Plan/Compose、实时 text delta、`Xiaoyu · 正在思考`、真实 Turn Activity 计时继续工作。
- 用户消息右对齐、Xiaoyu/Activity 左对齐。
- 原始隐藏 reasoning 正文继续不进入 Transcript。
- 用户手动离开底部查看历史时，新 token 不得强制把视图拉回底部；回到底部后才恢复 follow。
- Workspace Trust、Runtime/Tool/Permission ownership 不因 TUI 重构改变。

## 验收条件

### 代码/结构

- `app.tsx` 不再实现星空/流星、Transcript 排版/滚动、Prompt Textarea 细节。
- Prompt 没有应用层 cursor blink interval；背景/Logo 动画不调用 Prompt render/cursor API。
- Transcript ScrollBox 是会话唯一滚动 owner，父级不再有 wheel fallback。
- Windows 全局命令入口固定在 `%LOCALAPPDATA%\\Xiaoyu\\dev-bin`。

### 自动验证

- OpenTUI 回归测试全部通过；测试已适配模块边界。
- Windows Gate、Architecture/Documentation/AI Context/Naming/Distribution/Comments/Version/Repository Gate 通过。
- TypeScript/TSX 至少完成语法转译检查；有依赖环境时执行完整 `pnpm typecheck/test`。
- Source Manifest 与最终 ZIP 内容一致。

### Windows 实机 E2E（当前环境无法冒充）

- 非全屏窗口制造 3 屏以上对话，鼠标放在正文任意位置可以连续向上/向下滚动完整历史。
- 向上滚后模型继续输出不抢回底部；滚到底后恢复跟随。
- 输入、Tab/Shift+Tab、流式输出、Activity 更新、背景动画过程中 caret 不跳到屏幕其他位置。
- `[4]` 二次启动在 Native fingerprint 命中时明显减少包装进程和重复检查。
- 新开 Windows Terminal，在任意目录直接执行 `xiaoyu` / `xma` 能进入当前激活 checkout。

## 最终根因

本次不是单一 ScrollBox 属性错误，而是 **Terminal Host ownership 失控后形成的一组耦合回归**：

1. **历史滚动根因**：Transcript、Prompt、背景动画与父级 flex 布局长期混在同一个 `app.tsx`。此前为“短对话贴底”引入 `justifyContent:flex-end` / root wheel fallback 等表现层补丁，掩盖了真实 `content.height / viewport.height` 的滚动合同。长内容没有稳定形成单一、受限高度的 Transcript viewport，于是出现“内容被裁掉但滚不上去”。
2. **Caret 回归根因**：父级仍通过 `promptCursorVisible` 定时状态控制 Textarea cursor，并让 decoration/父级 render 生命周期和 Prompt caret 耦合；修滚动或动画时会重新触发输入区域布局/重绘，破坏已经验证过的原生 caret ownership。
3. **启动慢根因**：开发启动仍叠加 `pnpm -> tsx -> scripts/cli/bun.ts -> bun` 包装链，并且 Native Runtime 在缓存已命中时仍有不必要的 Cargo 前置检查；这不是业务 Runtime 必需成本。
4. **全局命令脆弱根因**：User PATH 指向 checkout-local `.git/xma-state/dev-bin`，导致激活 checkout 与 PATH 绑定在一起；Source Sync 虽然可以重绑，但路径本身不稳定。
5. **Source Sync 已排除**：用户日志显示 Source Manifest 215 个受管文件 SHA-256 与目标 checkout 完全一致。同步没有覆盖源码不是本轮主要根因。

因此本次修复的核心不是再补一个 wheel handler，而是把 Terminal Host 拆回稳定父子 ownership，并分别修正 Scroll / Prompt / Decoration / Startup / PATH 的责任边界。

## 实际修改与验证证据

### 结构与代码

- `apps/cli/opentui-runtime/app.tsx` 从约 1900 行级巨型 Host 收口为父级协调器；新增：
  - `contracts.ts`
  - `ui/transcript-viewport.tsx`
  - `ui/prompt-dock.tsx`
  - `ui/background-sky.tsx`
  - `ui/home-logo.tsx`
  - `ui/dialogs.tsx`
  - `ui/activity-format.ts`
  - `ui/theme.ts`
- Transcript 只保留一个 OpenTUI ScrollBox owner：`flexGrow=1 / flexShrink=1 / minHeight=0 / stickyScroll / stickyStart=bottom`；短内容使用**正向 top spacer**贴底，不再依赖 `justifyContent:flex-end`，并删除父级 root wheel fallback。
- `PromptDock` 直接让 OpenTUI Textarea 原生拥有 `showCursor=true + blinking=true`；删除父级 800ms `promptCursorVisible` toggle。Decoration/Logo 自己维护动画状态，不再通过父级回调驱动 Prompt 重绘；进入会话后不必要的背景 motion 停止。
- `[4]` / 开发态全局命令改为项目 Bun 直接执行 CLI 源码，删除日常 `pnpm -> tsx -> bun.ts -> bun` 包装；Native Runtime 先 fingerprint/cache fast path，miss 才进入 Cargo offline/build。
- `[1]` 的开发命令入口固定为 `%LOCALAPPDATA%\Xiaoyu\dev-bin` 并写 Windows **User PATH**；`source-root.txt` 只负责指向当前 checkout，Source Sync 切换 checkout 时更新指针而不是反复更换 PATH 目录。

### 文档与规则

- 新增 `docs/development/REPAIR-WORKFLOW.md` 与本台账，正式锁定“先写修复 Prompt，再实施，再回填证据”的流程。
- `AGENTS.md` / `DEVELOPMENT-RULES.md` 已加入：父级协调器 + 子模块 ownership、Textarea 原生 cursor、Transcript 单一滚动 owner、实机未验收不得宣称完成等硬规则。
- `CODEMAP.md`、`PROJECT-STATUS.md`、`UPDATE-LOG.md` 已同步当前模块、验证状态与历史。对应历史记录：`UPDATE-LOG ##80`。

### 自动验证

- OpenTUI 回归：**29 / 29 PASS**。
- Gate：Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository **9 / 9 PASS**。
- 修改后的 TS/TSX 已完成语法转译检查。
- 成品候选源码包已按 Source Manifest 重新打包并在独立目录解压复核：**225 个受管源码文件 + 1 个 `.xma-package/source-manifest.json`，缺失 0、哈希差异 0、额外文件 0**；从解压后的源码再次执行 OpenTUI 回归与 9 项 Gate，结果仍全部 PASS。
- 当前提取源码环境没有完整依赖条件，不能把未运行的 `pnpm typecheck/test` 或 Windows Terminal 实机行为写成已验证。

### 当前验收状态

本条仍为 **验证中**。自动证据证明模块边界和防回归合同已落地，但以下项目只能在用户 Windows Terminal 真机确认后才能标记“已完成”：完整历史鼠标滚轮、离底后不被流式输出拉回、caret 稳定、`[4]` 二次启动耗时、任意目录 `xiaoyu/xma`。

## 待优化进度

- **本轮必须继续**：从最终正式 ZIP 重新解压后再次跑 29 个 OpenTUI 回归、9 项 Gate、Source Manifest hash/extra-file 校验；用户完成 Windows E2E 后回填结果。
- **后续可优化**：继续把 `app.tsx` 中剩余命令面板/Provider Setup/跨 Dialog 协调拆成明确 controller/context，但只有在能缩小 ownership 且不改变 Runtime 语义时进行，不为“文件更小”机械拆分。
- **不在本轮扩大范围**：不顺手重构 Agent Runtime、Provider、Tool、Permission；#01 完成后恢复 Stage P1 Agent Engine 主线。
