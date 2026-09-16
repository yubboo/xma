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

本条仍为 **验证中**。用户 Windows Terminal 已确认 **任意目录 `xiaoyu/xma` 可启动** 与 **Textarea caret 稳定** 两项通过；完整历史鼠标滚轮/离底后 follow、`[4]` 二次启动耗时仍待继续验证。后续实机又暴露 `#02` Prompt Dock 父布局回归，因此 #01 暂不结束。

## 待优化进度

- **本轮必须继续**：从最终正式 ZIP 重新解压后再次跑 29 个 OpenTUI 回归、9 项 Gate、Source Manifest hash/extra-file 校验；用户完成 Windows E2E 后回填结果。
- **后续可优化**：继续把 `app.tsx` 中剩余命令面板/Provider Setup/跨 Dialog 协调拆成明确 controller/context，但只有在能缩小 ownership 且不改变 Runtime 语义时进行，不为“文件更小”机械拆分。
- **不在本轮扩大范围**：不顺手重构 Agent Runtime、Provider、Tool、Permission；#01 完成后恢复 Stage P1 Agent Engine 主线。

# 02 Terminal 会话布局、输入 Dock 消失与 Workspace 路径回归

- 状态：已完成
- 日期：2026-09-16
- 影响范围：`apps/cli/opentui-runtime`、Windows `[4]` 开发启动入口
- 关联修复：`# 01 Terminal 历史滚动、光标稳定、启动速度与全局命令回归`

## 用户可见症状

1. `#01` 后 `xiaoyu` / `xma` 已可从任意目录启动，Textarea caret 也恢复稳定；这两项实机验收通过。
2. 一旦发送第一条消息，Transcript 占满主工作区高度，右侧用户消息、Activity 和 Xiaoyu 回答被压到终端最底部；回答底部发生裁切。
3. 原本固定在聊天区下方的输入框、Build/Provider 状态、快捷键和提示整块 `PromptDock` 消失到 viewport 外，导致用户无法继续正常聊天。
4. `[4]` 直接 Bun 启动后，底部 Workspace 显示为 `H:\一键部署\xma\apps\cli\opentui-runtime`，而不是项目根 `H:\一键部署\xma`；说明启动提速时丢失了旧 `bun.ts dev` 默认把项目根作为 workspace 参数的行为。

## 已确认事实与证据

- 用户实机截图证明 PATH 与 caret 已修好，因此不得回退 `#01` 的稳定 User PATH 与 Textarea 原生 cursor ownership。
- `PromptDock` 当前组件返回 Fragment（`<>...</>`），其中输入区、快捷键栏、提示栏作为多个兄弟 Renderable 直接插入父级；父级同时存在一个 `flexGrow=1` 的 Transcript ScrollBox。这个边界没有把 Prompt 作为一个不可压缩的整体 Dock 参与 Yoga 分配，是本轮布局回归的首要根因。
- `TranscriptViewport` 本身设置 `flexGrow=1 / flexShrink=1 / minHeight=0`，但父级没有一个明确的“Transcript 可缩区域 + Prompt 固定区域”单元合同；实机结果表明当前组合仍允许 ScrollBox 占满主区域并把 Prompt 挤出屏幕。
- `Start-Cli` 优化后直接 `Push-Location apps\cli\opentui-runtime` 再运行 `bun run ../src/main.ts`。当 `[4]` 未显式传 `-Workspace` 时，没有再像原 `scripts/cli/bun.ts dev` 那样补默认项目根参数，因此 `main.ts` 以 runtime 目录作为 `process.cwd()`/workspace。
- Source Sync 不是当前根因；用户已经验证最新包可以正常启动，且此前 Manifest SHA-256 一致。

## 已被证伪/禁止重复的修法

- 不得重新把 Prompt、Transcript、背景和 Activity 合并回巨型 `app.tsx`。
- 不得通过给 Transcript 写死一个“看起来差不多”的终端高度修复；窗口大小、Textarea 多行高度、tips 开关都会变化。
- 不得恢复父级 cursor timer、root wheel fallback 或 `justifyContent:flex-end`。
- 不得为了让 `[4]` workspace 正常而重新恢复 `pnpm -> tsx -> bun.ts -> bun` 慢启动链；只补回参数语义。

## 本次修复 Prompt

> 以 `#01` 验证后的最新 `xma-0.1.0` 为基线。保留已经实机通过的稳定 User PATH 与 Textarea caret 修复，只修会话父子布局和 `[4]` workspace 参数回归。先证明 ownership，再改代码。
>
> 1. **PromptDock 必须是单一不可压缩布局节点**：`PromptDock` 不得返回 Fragment 让输入区/快捷键/提示成为父级散落兄弟；改为一个 `flexShrink=0` 的根 `box`，内部再纵向包含输入区、快捷键、提示。父级 Yoga 只能看到“Transcript 可伸缩 + PromptDock 固定”两个会话主区域。
> 2. **Transcript 只能消费剩余高度**：主工作区使用明确 `flexGrow=1 / flexShrink=1 / minHeight=0`；Transcript ScrollBox 保持同样可缩合同，PromptDock 保持 `flexShrink=0`。禁止给 Transcript 写死终端高度。必要时主工作区设置 `overflow=hidden`，但不得用裁切掩盖错误分配。
> 3. **保持单滚动 owner**：Transcript 仍是唯一历史滚动 owner；top spacer、sticky bottom、PageUp/PageDown/Ctrl+Home/Ctrl+End 和原生 wheel 语义不变。本轮不得顺手重写滚动算法。
> 4. **恢复 `[4]` 默认 Workspace 语义**：当 `Start-Cli` 没收到 `WorkspacePath`（主菜单 `[4]`）时，显式把 `$Root` 作为 CLI workspace 参数；当全局 `xiaoyu/xma` 传入当前目录时，继续使用那个真实目录。直接 Bun 快启动保留。
> 5. **补防回归合同**：测试锁定 `PromptDock` 单根、根 `flexShrink=0`、父级/Transcript 可缩合同；Windows Gate/测试锁定 `[4]` 无显式 workspace 时默认传 `$Root`，防止再次落到 `apps/cli/opentui-runtime`。
> 6. 回填本条最终根因、自动验证和 Windows 实机验收；更新 `PROJECT-STATUS.md` / `UPDATE-LOG.md`，若形成长期规则则同步 `AGENTS.md` / `DEVELOPMENT-RULES.md`。重新生成 Source Manifest 和正式 `xma-0.1.0.zip`。

## 不允许回归的既有行为

- `#01` 已实机通过：任意目录 `xiaoyu/xma` 可启动；Textarea caret 稳定。
- 用户消息右对齐；Xiaoyu/Activity 左对齐；`Xiaoyu · 正在思考` 与真实 Activity 计时继续工作。
- Transcript 历史滚动仍由同一个 ScrollBox 负责；不恢复 root wheel fallback。
- `[4]` 继续使用项目 Bun 直接启动，不恢复多层包装启动链。
- Agent Runtime / Provider / Tool / Approval 语义不在本轮改动。

## 验收条件

### 自动验证

- `PromptDock` 只有一个根布局 box，根节点 `flexShrink=0`；快捷键/提示都在该根节点内部。
- 会话父级和 Transcript 保持 `flexGrow=1 / flexShrink=1 / minHeight=0`，Prompt 不参与可缩高度竞争。
- `[4]` 在 `WorkspacePath` 为空时把项目 `$Root` 传给 CLI；全局 shim 仍传调用者当前目录。
- OpenTUI 回归、Windows Gate 与项目 Gate 通过；最终 ZIP 与 Source Manifest 一致。

### Windows 实机 E2E

- 发送第一条消息后，输入框、Build/Provider、快捷键、提示仍固定在底部可见；可继续输入第二条、第三条消息。
- Xiaoyu 长回复只能在 Transcript viewport 内滚动，不得覆盖或挤走 PromptDock。
- 非全屏与全屏切换后上述结构都稳定。
- 主菜单 `[4]` 底部 Workspace 为 XMA 项目根；在其他目录直接运行 `xiaoyu/xma` 时 Workspace 为用户启动命令时所在目录。
- PATH 与 caret 继续保持 `#01` 的已通过状态。

## 当前判断

本轮是 `#01` 模块化过程中暴露出的**父子布局边界回归 + 快启动参数语义回归**。它不否定模块化方向，反而说明需要把“父级只分配区域、子级内部自管”继续落实：Prompt 作为一个 Dock 原子参与父级布局，Transcript 只拿剩余空间；启动优化也必须保持原入口的 workspace 语义。

## 最终根因

1. **Prompt Dock 不是父级布局原子**：#01 虽然把 Prompt 拆出 `prompt-dock.tsx`，但组件返回 Fragment，导致输入区、快捷键栏和提示栏仍作为多个 Yoga sibling 参与父级布局。Transcript ScrollBox 同时 `flexGrow=1` 后，Windows Terminal 实机出现 Transcript 占满可用高度、Prompt 整块被挤出 viewport。
2. **direct-Bun 优化丢失默认 Workspace 参数**：旧 `scripts/cli/bun.ts dev` 在没有 forwarded args 时默认传项目根；#01 的 `Start-Cli` 直接 Bun 路径只在显式 `WorkspacePath` 时才传参数，主菜单 `[4]` 又先 `Push-Location apps/cli/opentui-runtime`，因此 CLI 把 runtime 目录当成 Workspace。

## 实际修改与自动验证

- `ui/prompt-dock.tsx`：改为单一 `id="xiaoyu-prompt-dock"` 根 box，根 `flexShrink=0`；输入、Build/Provider 状态、快捷键、提示全部成为内部子节点，不再以 Fragment 散落到父级。
- `app.tsx`：父工作区增加稳定 `id="xiaoyu-workbench"`，显式 `width=100% / flexGrow=1 / flexShrink=1 / minHeight=0 / overflow=hidden`；Transcript 仍是唯一 scroll owner，Prompt 不参与可缩高度竞争。
- `scripts/windows/xma-console.ps1`：`Start-Cli` 统一计算 `$workspaceCandidate`；空 `WorkspacePath` 使用 `$Root`，显式参数使用调用者目录，并始终把 resolved workspace 传给 Bun。保留 direct-Bun 快启动。
- 防回归：OpenTUI 测试新增 Prompt 单根/不可压缩 Workbench 合同，以及 `[4]` 默认 `$Root` Workspace 合同；Windows Gate同步锁定该行为。
- 自动验证：OpenTUI **29/29 PASS**；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository Gate 全部 PASS；Runtime updater **2/2 PASS**。Windows Gate 还在实施过程中成功拦截了一次 `xma-console.ps1` 被编辑器写成 LF 的发行格式回归，现已恢复 CRLF 后通过。

## 当前实机验收状态

- #01 已由用户确认：`xiaoyu/xma` 任意目录启动正常；Textarea caret 稳定。
- #02 仍待用户 Windows Terminal 验证：发送第一条消息后 Prompt Dock 必须持续可见、可继续多轮聊天；长回复只在 Transcript 内滚动；主菜单 `[4]` Workspace 必须显示项目根。
- 在这些实机项确认前，本条保持“验证中”，不得写“已完成”。

## 待优化进度

- 若 #02 实机通过，再继续 #01 的长历史 mouse-wheel E2E，并结束 Terminal 阻断性修复批次。
- 若仍失败，下一条必须新增 `#03`，记录新的实机证据与根因，不允许回滚模块化或把所有 UI 重新塞回 `app.tsx`。

# 03 Terminal Transcript 不可滚动与 PromptDock 再次被挤出 viewport

- 状态：已完成
- 日期：2026-09-16
- 影响范围：`apps/cli/opentui-runtime` 会话父布局、Transcript ScrollBox、PromptDock 可见性与滚轮历史回看
- 关联修复：`# 01`、`# 02`

## 用户可见症状

1. `#02` 成品包在 Windows Terminal 实机发送第一条消息后，输入框、Build/Provider 状态、快捷键与提示仍全部消失；用户只能看到用户消息、Activity 与第一段 Xiaoyu 回复，无法继续正常多轮聊天。
2. 同一实机中 Transcript 仍无法用鼠标滚轮自由向上查看历史，表现像滚动被其他代码禁用。
3. `xiaoyu/xma` 任意目录 PATH 与 Textarea caret 已由用户确认正常，本轮不得回退这两项。

## 已确认事实与证据

- Source Sync 已多次通过 Source Manifest SHA-256 校验；PATH 也已由用户实机验证，因此本轮不是“同步了旧包”或“启动了旧 checkout”。
- `PromptDock` 在 #02 后确实已经是单一 `flexShrink=0` 根 box；因此“Fragment 让 Dock 散成多个 sibling”只是 #02 的一层问题，不是当前最终根因。
- 当前 `TranscriptViewport` 自己仍作为父 Workbench 的直接 flex child，内部 OpenTUI `ScrollBoxRenderable` 的 `content.height` 又参与 Yoga intrinsic sizing。Windows 实机结果表明：仅给 ScrollBox root `flexGrow=1 / flexShrink=1 / minHeight=0` 并不足以把它约束为剩余高度 viewport。
- OpenTUI `ScrollBoxRenderable` 的真实滚动范围是 `scrollHeight = content.height`、`viewportSize = viewport.height`；只有 `content.height > viewport.height` 才存在可滚范围。当前症状“Prompt 被推走 + wheel 无位移”高度一致地说明 ScrollBox viewport 跟着内容一起长，导致父级被内容撑开且 `maxScrollTop` 接近 0。
- MiMo-Code 在同一 OpenTUI 技术栈中使用“会话父容器 → `scrollbox flexGrow=1` → `box flexShrink=0` Prompt”的两段布局，并让 ScrollBox 自己处理 wheel/sticky；Pi 也把 Transcript ScrollView 与 Editor/Footer 放入明确受限的 VStack region。共同点不是额外 wheel handler，而是**先存在受限 viewport，再谈滚动**。
- OpenTUI 官方测试证明 ScrollBox 原生 mouse wheel 可以改变 `scrollTop`；因此在 `useMouse: true` 下继续堆 root wheel fallback 不是首选。当前必须先证明 XMA 的 ScrollBox 确实拥有非零 `maxScrollTop`。

## 已被证伪/禁止重复的修法

- 仅把 PromptDock 从 Fragment 改成根 box：实机已证明不够。
- 只给 ScrollBox root 写 `flexGrow/flexShrink/minHeight`：实机已证明当前组合仍会被内容 intrinsic height 撑开。
- 再加一套 root wheel fallback：如果 `scrollHeight <= viewport.height`，事件再多也滚不动；禁止用事件补丁掩盖几何错误。
- 恢复 `justifyContent:flex-end`、auto negative overflow、父级 cursor timer、把所有 UI 合回 `app.tsx`：全部禁止。

## 本次修复 Prompt

> 以 #02 成品包为第一事实源，修复 Xiaoyu Terminal 会话态的垂直区域分配，使 PromptDock 永远可见、Transcript 真正拥有受限高度和真实 scroll range，并用可执行的 OpenTUI layout/mouse 回归测试证明，而不是只做源码字符串断言。
>
> 1. **建立显式 Transcript Slot**：在 `xiaoyu-workbench` 中，Transcript 不再直接作为可增长 flex child。新增父级 `xiaoyu-transcript-slot`，使用 `height=0 + flexBasis=0 + flexGrow=1 + flexShrink=1 + minHeight=0 + overflow=hidden`，把“剩余高度”先在父级固定下来。PromptDock 继续作为 sibling `flexShrink=0`。
> 2. **ScrollBox 填满 Slot，不参与父级 intrinsic height 竞争**：`TranscriptViewport` 内部 ScrollBox 改为 `height="100%" / width=100%`，由 Slot 决定 viewport 高度；不要再靠 ScrollBox 自己的 flexGrow 与内容高度和 Prompt 竞争。
> 3. **保持一个滚动 owner**：继续使用 OpenTUI `stickyScroll + stickyStart=bottom`、原生 wheel、PageUp/PageDown/Ctrl+Home/Ctrl+End；不新增 root wheel fallback。top spacer 只负责短内容底部视觉，不得改变长内容真实高度。
> 4. **新增行为级布局测试**：使用 `@opentui/core/testing` 构造与生产同构的父布局（固定终端高度、`height=0/flexBasis=0` Transcript Slot、ScrollBox、固定 Prompt Dock），添加超过 viewport 的多行内容；断言 Prompt 仍在屏内、`scrollHeight > viewport.height`、滚到底后 mock mouse wheel up 会让 `scrollTop` 下降。该测试必须进入 root `pnpm test` glob，不能只匹配源码字符串。
> 5. **保留已通过能力**：稳定 `%LOCALAPPDATA%\\Xiaoyu\\dev-bin` PATH、Textarea caret ownership、direct-Bun 启动、Workspace 参数、Activity、左右对齐、隐藏 reasoning、Provider/Approval 均不得回退。
> 6. 更新 `AGENTS.md` / `DEVELOPMENT-RULES.md` 的长期布局规则：关键滚动区域必须先由父 Slot 建立 bounded viewport，ScrollBox 不得直接用 intrinsic content height 与固定 Dock 竞争；更新 `PROJECT-STATUS.md` / `UPDATE-LOG.md`，重新生成 Source Manifest 与 `xma-0.1.0.zip`。

## 不允许回归的既有行为

- 用户实机已确认：任意目录 `xiaoyu/xma` 可启动；Textarea caret 稳定。
- PromptDock 的 Build/Plan/Compose、Provider/Model/Reasoning、快捷键、提示完整保留。
- 用户消息右对齐，Activity/Xiaoyu 左对齐；`Xiaoyu · 正在思考`、实时 Turn 计时和展开活动日志保留。
- 用户离开底部后新 token 不抢回；滚到底后才恢复 sticky follow。
- Agent Runtime / Tool / Permission 语义不在本轮修改。

## 验收条件

### 自动验证

- 生产 JSX 明确存在 `xiaoyu-transcript-slot`：`height={0}`、`flexBasis={0}`、`flexGrow={1}`、`flexShrink={1}`、`minHeight={0}`、`overflow="hidden"`。
- Transcript ScrollBox 使用 `height="100%"` 填满 Slot，不再直接用 `flexGrow=1` 参与 Workbench 主轴分配。
- 新增 OpenTUI 行为测试真实断言 Prompt 保持屏内、ScrollBox 形成 `scrollHeight > viewport.height`，并通过 mock wheel 改变 `scrollTop`。
- 原 OpenTUI 回归、Windows Gate、9 项 Gate 与 Source Manifest/ZIP 校验通过。

### Windows 实机 E2E

- 第一轮回答后输入框、Build/Provider、快捷键、提示仍持续可见；可以连续发送第二、第三条消息。
- 3 屏以上历史在非全屏窗口可用鼠标滚轮连续向上/向下查看全部内容。
- 向上滚后模型继续输出不强制回到底；滚到底后恢复自动 follow。
- PATH、caret、Workspace 显示继续保持已通过状态。

## 当前根因判断

当前最可信根因是 **Transcript ScrollBox 缺少独立 bounded flex slot**。#02 只把 PromptDock 变成不可压缩 sibling，但 ScrollBox 仍直接参与父 Workbench 的 intrinsic sizing；OpenTUI ScrollBox 内部 `content` 自带 `minHeight:100%` 且 `flexShrink:0`，长 Transcript 会把 ScrollBox/root 的期望高度一起撑大。结果父级把 Prompt 推出 viewport，同时 ScrollBox 自己的 viewport 也随内容变高，失去真实 `maxScrollTop`，因此 wheel 看起来像被禁用。#03 将先固定父级 slot 高度，再让 ScrollBox 仅填满该 slot。
## 实际修改与自动验证

- `app.tsx`：在 Transcript 与 Workbench 之间新增唯一 `id="xiaoyu-transcript-slot"`，采用 `height={0} / flexBasis={0} / flexGrow={1} / flexShrink={1} / minHeight={0} / overflow="hidden"`。PromptDock 仍是紧随其后的固定 sibling。
- `ui/transcript-viewport.tsx`：ScrollBox 从直接 `flexGrow/flexShrink` 改为 `height="100%" / minHeight=0`，只填满 bounded slot；其 internal content 的 intrinsic height 不再决定 Workbench 主轴高度。
- `apps/cli/tests/opentui-layout.test.ts`：新增 OpenTUI Core 行为测试，使用固定 80x24 viewport、6 行 Prompt Dock、60 行 Transcript，真实断言 Dock 留在屏内、slot 获得剩余高度、`scrollHeight > viewport.height`，并用 `mockMouse.scroll(..., "up")` 验证 `scrollTop` 从 sticky bottom 向上移动。该 API 已按项目固定 `@opentui/core@0.5.11` 对应上游 testing contract 核验。
- `apps/cli/tests/opentui-runtime.test.ts` 与 Distribution Gate：锁定 bounded slot 和 ScrollBox `height=100%`，不再把“ScrollBox root 自己 flexGrow”当成正确合同。
- 长期规则：`AGENTS.md` / `DEVELOPMENT-RULES.md` 已补“bounded slot 先于 ScrollBox”的硬规则；`PROJECT-STATUS.md` / `UPDATE-LOG ##82` 已记录本轮。
- 当前容器可以执行的静态 OpenTUI 回归 **29/29 PASS**；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository **9/9 PASS**；Runtime updater **2/2 PASS**。
- 新增的 `opentui-layout.test.ts` 需要项目已准备的 `@opentui/core@0.5.11` 才能执行；当前干净源码包环境故意不带 `node_modules`，因此这里不冒充已经运行该依赖型行为测试。Windows `[1]/[7]` 准备依赖后的完整 `pnpm test/check` 与用户 Windows Terminal E2E 仍是最终权威。

## 当前验收状态

本条已由用户 Windows Terminal 实机验收为 **已完成**。用户确认：

1. 第一轮回答后 PromptDock（输入框 / Build / Provider / 快捷键 / 提示）持续可见；
2. 可以继续发送第二、第三条消息；
3. 多屏历史可以用鼠标滚轮自由向上/向下查看；
4. 手动离开底部后模型继续输出不会强制抢回，回到底部后恢复 follow。

因此 bounded Transcript slot + ScrollBox `height=100%` 的几何修复已通过最终 Windows E2E。PATH、Workspace 与 Textarea 原生 caret ownership 继续保持。

## 待优化进度

- 若实机通过：把 #03 标为已完成，同时回填 #01 的 wheel E2E，并结束这一轮 Terminal 阻断性回归。
- 若实机仍失败：下一编号不得再猜 Flex；必须临时增加只在 debug 模式输出的 `scroll.height / viewport.height / content.height / scrollTop / promptDock.y` 几何诊断，拿到 Windows 实机真实数值后再修。



# 04 Windows 文本光标指示器与 Xiaoyu 原生 caret 兼容确认

- 状态：已识别 / 环境行为
- 日期：2026-09-16
- 影响范围：Windows Terminal + Windows 辅助功能“文本光标指示器”；`apps/cli/opentui-runtime/ui/prompt-dock.tsx` 仅作为原生 caret owner，不修改系统辅助功能。
- 关联修复：`# 01`、`# 03`

## 用户可见症状

用户完成 #03 实机验证后，Prompt 已可持续多轮聊天、历史滚动与 sticky follow 均正常，但输入框真实 caret 上下出现两个蓝色水滴/锚点状标记；视觉上像 XMA 又画了第二套光标。

## 已确认事实与证据

- 截图中的白色 block 为 OpenTUI focused Textarea 的真实 terminal caret；上下两个蓝色水滴形标记不是 XMA JSX / OpenTUI 自绘部件，而是 Windows 的“文本光标指示器（Text cursor indicator）”辅助功能。
- Microsoft 官方说明：Windows 11 可在文本光标周围添加彩色指示器，并允许用户在“设置 → 辅助功能 → 文本光标”中开关、调整大小和颜色。
- 当前 Active OpenTUI 已禁止 `CURSOR_MARKER`、手写 DECTCEM、应用层定时搬移硬件光标；因此本次蓝色标记不是此前的“cursor anchor 漂移”回归，而是 Windows 正常装饰当前真实 caret。
- #03 用户已确认 caret 本身稳定、Prompt/滚动/follow 正常，因此不得为了隐藏 OS 指示器重新把 Textarea `showCursor` 关掉或恢复软件假光标。

## 本次修复 Prompt

> 以 #03 已通过 Windows 实机验收的版本为基线，区分 Xiaoyu/OpenTUI 原生 caret 与 Windows Text Cursor Indicator。不得把 OS 辅助功能误判为 XMA 第二套 cursor，也不得为了消除系统装饰回退已经验证的原生 Textarea caret ownership。
>
> 1. 保持主 Prompt 为 OpenTUI 原生 focused Textarea；不重新引入 `CURSOR_MARKER`、reverse-video 软件光标、父级 `showCursor` interval 或全局 `setCursorPosition` timer。
> 2. 将“蓝色上下水滴 = Windows Text Cursor Indicator”记录进修复历史和开发规则；以后遇到“蓝色标记稳定跟随真实 caret”先按 OS 辅助功能判断，只有标记漂移到别处时才按 cursor ownership bug 调查。
> 3. XMA 不得静默修改用户 Windows 辅助功能注册表/系统设置。若用户不希望显示该指示器，应由用户在 Windows“设置 → 辅助功能 → 文本光标 → 文本光标指示器”关闭或调整。
> 4. 若未来产品需要提供光标样式偏好，只允许改变 OpenTUI caret 的 block/bar/underline 等应用层样式；不得承诺覆盖或关闭 Windows 的系统级文本光标指示器。
> 5. 回填 #02/#03 Windows E2E 已通过结果，并保留 #01 启动耗时项的独立验收状态。

## 不允许回归的行为

- 不因为系统蓝色 Text Cursor Indicator 而隐藏真实 Textarea caret。
- 不恢复曾导致 IME/焦点/光标漂移的全局 cursor timer 或软件假光标。
- 不让 Decoration/Transcript/Activity 抢占 Textarea cursor ownership。

## 验收结论

本项不是 XMA 代码缺陷，而是 Windows 辅助功能对真实文本 caret 的系统级视觉装饰。XMA 当前正确行为是保持原生 caret 稳定；用户若要隐藏蓝色上下标记，在 Windows 系统设置中关闭“文本光标指示器”。若蓝色标记未来出现不跟随 caret、漂移到屏幕其他位置，则重新开新的 Repair 编号按实际 cursor ownership 回归处理。
