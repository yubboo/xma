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

# 05 统一会话运行指标、真实计费来源与多 Host 状态栏

- 状态：验证中
- 日期：2026-09-16
- 类型：功能开发 + Host-neutral 业务模块
- 影响范围：`xma-ai` Provider/Billing Contract、`xma-session` Metrics Projection、App Protocol、Terminal 状态栏；未来 Desktop/Web 直接复用同一数据合同
- 关联记录：`# 01`～`# 04`

## 用户目标

把参考产品底部状态栏中“当前模型、缓存命中、会话/本轮 tokens、费用、会话轮次、上下文占用、压缩状态、账户余额、权限模式”等能力实现成 **一套真实、可复用、Host-neutral 的业务模块**。Terminal 只负责在输入 Dock 下方投影；未来 Desktop/Web/Server 必须消费同一 Runtime/App Protocol 数据，不得各自重新统计或写死 Provider。

## 强制产品语义

1. **绝不写死 DeepSeek / OpenAI / Astra 或任何模型名。** 当前显示必须来自用户当前真实 Provider Profile + ModelIdentity；用户切换 Provider/Model 后状态自动变化。
2. **计费来源必须区分 API 与套餐/订阅。**
   - `api`：token/usage 来自真实 Provider usage；费用只有在存在可验证价格来源时才显示，并标注 reported/estimated；余额只有 Provider 有真实账户接口并查询成功时才显示。
   - `subscription`：不得拿 API token 单价计算“本次费用”；应显示套餐/配额语义（套餐内、额度、重置时间等 Provider 实际能提供的字段）。
   - `unknown`：不知道就显示 `—` / `不可用`，严禁伪造 0、余额、费用或套餐额度。
3. **真实数据优先，未知即未知。** 禁止为了“看起来完整”把 `¥0.0000`、`80%`、`100 万上下文`、`余额 12.93` 等作为 UI 常量。0 只有在数据源明确报告为 0 时才是 0。
4. **Session 指标由 durable facts 投影。** turn count、usage、latency、provider/model、缓存命中等必须从 Session event / Provider report 派生，不让 Terminal 自己维护第二套业务账本。
5. **上下文占用是当前请求事实，不是会话累计 tokens。** 使用最近一次真实 Step 的 input token 与模型 context window 计算；context window 不知道则不显示百分比。
6. **费用必须可解释。** 每个 cost 值必须带 currency、precision（provider-reported / estimated）、price source；Provider usage 缺失或 price metadata 不可靠时不显示精确金额。
7. **余额/套餐查询不得阻塞每一帧。** Provider Account Snapshot 使用显式 refresh/TTL；失败只把 account telemetry 标成 unavailable，不影响 Agent Turn。
8. **Permission 只显示 Runtime 真实 Permission Profile。** 当前尚未完成的三档权限不可用 UI 常量伪装；若当前实际策略仍为 ask/standard，则显示“请求批准”。
9. **Compaction 未实现就显示未启用/—。** 不允许先画“压缩阈值 80%”再假装功能存在。

## 本次开发 Prompt

> 以最新 `xma-0.1.0` 包为第一事实源，实现一个 Host-neutral 的 Session Runtime Metrics / Provider Billing Telemetry 模块，并让 Xiaoyu Terminal 在 PromptDock 下方显示真实状态栏。所有数字必须来自当前真实 Provider/Session/Runtime；不存在真实数据时显示 unavailable，而不是填充假数据。
>
> ### A. xma-ai：Provider Telemetry / Billing Contract
> - 新增通用 `ProviderBillingSource`：`api | subscription | unknown`，可携带套餐名/label，但不得携带 Secret。
> - 新增 `ProviderCostEstimate`、`ProviderAccountSnapshot`、`ProviderBalance`、可选 subscription quota 等纯数据 Contract。
> - Provider 品牌插件可注册 `ProviderTelemetryProvider`：负责该 Provider 的 model descriptor/context、费用估算、账户余额/套餐查询；Transport Adapter 不得因为 OpenAI-compatible 就假定品牌价格。
> - `ProviderRegistry` 增加 telemetry register/query seam；没有 provider telemetry 时仍可运行模型，只是 metrics 对应字段 unavailable。
>
> ### B. DeepSeek 当前真实 API telemetry
> - 仅在当前 Profile 的 `providerId=deepseek` 且真实 API credential 可用时查询官方 `/user/balance`；不得对自定义 OpenAI-compatible endpoint 假装是 DeepSeek。
> - 使用官方文档确认的 model context metadata；价格如果文档/路由存在歧义则宁可不显示 cost，也不得伪造精确值。
> - 官方最新模型名应与当前文档一致；兼容旧 alias 时必须明确 alias/billing model 语义。
> - Balance 查询失败、超时或 Provider 不支持时状态栏显示 `余额 —`，Agent 正常工作。
>
> ### C. xma-session：Durable Metrics Projection
> - 新增纯函数从 `SessionSnapshot.events` 计算：turn count、最新/本轮 turn usage、会话 usage、cache hit、latency、最近 provider/model、最近 Step input tokens。
> - 使用 step/start 关联每个 usage event 的真实 ModelIdentity；不得把不同模型切换后的 usage 全部按当前模型价格重算。
> - cost aggregation 通过注入 Provider telemetry estimator 对每个 Step 单独计算；若只有部分 step 可估算，必须标 `partial` 或隐藏精确 session total。
> - context ratio = latest step input tokens / 对应 model contextWindow；未知 contextWindow 时 ratio undefined。
> - compaction 只反映 durable compaction/config 事实；当前未实现则 `available=false`。
>
> ### D. App Protocol
> - 增加 `session/metrics` query/result Contract，使 CLI/Desktop/Web/Server 可拿到同一 `SessionRuntimeMetrics`，Renderer 不直接读 Session 内部事件。
> - 当前 CLI 可先使用同一个 projection service 作为过渡，但类型和返回数据必须就是 App Protocol 将来复用的 canonical shape。
>
> ### E. Terminal Host
> - 新增独立 `SessionStatusBar` 子组件放在 PromptDock 底部红框区域，不把业务计算写进 JSX。
> - 响应终端宽度：窄屏优先保留 model / 本轮 tokens / session tokens / context / permission；宽屏再显示 cache、cost、balance、turn count 等。
> - API 模式：显示真实 usage；cost/balance 只有 telemetry 可用才显示真实/估算值。
> - subscription 模式：显示套餐/配额信息，不显示 API 单价推算费用。
> - unknown 字段统一显示 `—`，不使用伪造 0。
> - 模型/Provider 切换后状态栏立即使用新 identity；历史 session cost 必须仍按各历史 step 自己的 provider/model 归属统计。
>
> ### F. 测试与留痕
> - xma-session 增加纯 projection 单测：多 Step、多 Turn、模型切换、usage 缺失、cache、context ratio、partial cost。
> - xma-ai 增加 telemetry registry 单测：品牌隔离、API/subscription/unknown、account unavailable 不影响 Provider。
> - DeepSeek account telemetry 使用本地 mock HTTP，验证 `/user/balance` 解析；不得用真实用户 API Key 作为自动测试条件。
> - Terminal 测试锁定 `SessionStatusBar` 只消费 canonical metrics，不出现 `deepseek` 品牌硬编码、不出现假的 `80%/¥0.0000/余额` 常量。
> - 更新 `AGENTS.md`、`DEVELOPMENT-RULES.md`、`MODEL-PROVIDER.md`、`AGENT-RUNTIME.md`、`PROJECT-STATUS.md`、`UPDATE-LOG.md`；重新生成 Source Manifest 和同名 `xma-0.1.0.zip`。

## 验收条件

- 切换真实模型后状态栏 model 字段同步变化，无品牌 if/else 写死在 UI。
- DeepSeek API Profile：真实 usage 能进入本轮/会话 token；官方 balance 查询成功时显示真实币种余额，失败时显示 `—`。
- 自定义 OpenAI-compatible：usage 有多少显示多少；没有价格/余额 metadata 时费用/余额必须 `—`。
- 模拟 subscription telemetry：状态栏显示套餐/配额，不计算 API cost。
- 同一 Session 中先后使用两个模型，历史 usage/cost 仍按各自 step identity 归属。
- contextWindow 未知时不上百分比；已知时按最近 Step input usage 计算。
- 当前没有 compaction durable fact 时明确显示“压缩 —/未启用”，不出现假 80%。
- Terminal 之外可直接复用 `SessionRuntimeMetrics` / App Protocol 类型，不需要复制统计逻辑。

## 当前开发进度

- Host-neutral `SessionRuntimeMetrics` / Provider Telemetry / App Protocol `session/metrics` 已进入代码。
- Terminal `SessionStatusBar` 已接入 PromptDock，只消费 canonical metrics；UI 无 Provider 品牌价格/余额硬编码。
- API / subscription / unknown 三类 billing 语义均有测试；DeepSeek balance 使用本地 HTTP mock，不使用真实用户 Secret。
- DeepSeek 官方价格/模型/余额文档已于 2026-09-16 重新核对；当前官方资料仍存在 V4 Pro 路由说明冲突，因此实现以当前模型价格表与更新日志中“V4 Pro 继续提供、计费方式不变”的可验证表格/更新事实为准，并保留价格 source 元数据；官方信息再次变化时必须更新 telemetry source。
- 当前仍需完成完整 Gate / Source Manifest / 成品 ZIP 独立解压验证以及 Windows 实机状态栏验收，因此本条保持“验证中”。

## 实际实现证据

- `packages/xma-ai/src/provider/telemetry.ts`：统一 `api | subscription | unknown` Billing Source、模型 metadata、cost estimator、account snapshot registry。
- `packages/xma-session/src/metrics.ts`：从 durable Session events 投影 Turn/Request/Token/Cache/Latency/Context/Cost/Permission/Compaction，不让 Terminal 自己统计。
- `core/src/app-protocol.ts`：增加 Host-neutral `session/metrics` query/result Contract。
- `plugins/deepseek/telemetry.ts`：DeepSeek 官方 API balance/model/pricing telemetry；仅官方 HTTPS Host 可读取余额，避免 Secret 发往第三方 endpoint。
- `apps/cli/opentui-runtime/ui/session-status.ts` / `session-status-bar.tsx`：纯格式化/Renderable，unknown 显示 `—`；套餐不使用 API 单价计算。
- 自动单测已验证：多 Turn/多模型历史归属、partial cost、context unknown、API/subscription/unknown status、DeepSeek balance mock。

## Windows 实机待验收

- 配置真实 API Provider 后，状态栏模型名必须随当前 Profile/Model 变化。
- 完成至少一轮真实对话后，本轮/会话 token 与轮数必须增长；未知字段必须保持 `—`。
- Provider 支持余额时只显示真实查询结果；失败不影响对话。
- 套餐 Provider 接入后显示真实 Plan/Quota，不出现 API 单价推算费用。



# 06 模型配置流程崩溃、usePaste 未定义与 TUI 存活性回归

- 状态：验证中
- 日期：2026-09-16
- 类型：阻断性 Bug 修复
- 影响范围：`apps/cli/opentui-runtime/ui/dialogs.tsx`、Provider Setup/Manager、Modal focus/caret、TUI 错误隔离
- 关联记录：`#05` 状态栏功能开发暴露；不允许为修 #06 回退 #02/#03/#04 已验收行为

## 用户可见症状

1. 首次 Brain Setup / `Ctrl+P → 模型 / 提供方` 无法顺利完成真实模型配置。
2. 配置 API Key 等输入流程后出现：`模型配置操作失败 · usePaste is not defined`。
3. 错误发生后星空/动画、Prompt、命令交互等 TUI 整体像“宕机”，用户无法继续正常配置或聊天。
4. 已有 Profile 有时仍显示旧模型状态，但重新配置流程无法正常工作。

## 已确认事实与直接证据

- `SecretInput` 位于 `ui/dialogs.tsx`，直接调用 `usePaste(...)`，但该模块只 import 了 `useKeyboard/useRenderer/useTerminalDimensions`；`usePaste` 没有在本模块导入。ES module 作用域不会继承 `app.tsx` 的 import，因此运行到 SecretInput 时必然产生 `ReferenceError: usePaste is not defined`。
- Provider Setup 把该异常包进 `providerManager` 的 catch 并显示 notice，但 modal promise/focus 生命周期可能已经被异常打断；当前缺少针对“Dialog render/hook 自身异常后 TUI 仍可用”的回归。
- `app.tsx` 仍多余 import `usePaste` / `PasteEvent` / `decodePasteBytes`，真正使用者已经拆进 `dialogs.tsx`，说明 #01 模块化后 import ownership 没完全迁移。

## 被禁止的错误修法

- 不得只把错误文本改成“配置失败”而不修真正的 hook/import ownership。
- 不得在 catch 后直接重启整个 TUI 或清空已保存 Provider Profile。
- 不得把 API Key 改成普通 Textarea 明文回显来绕过 SecretInput。
- 不得为了避免崩溃关闭全部动画、mouse、keyboard 或 Provider Setup。
- 不得把 Provider/Model 写死成 DeepSeek；配置流程必须继续来自真实 Provider Catalog/Profile。

## 本次修复 Prompt

> 在 #05 完整收口后的最新源码上修复 Provider/Model 配置阻断。先修模块 import ownership，再修 Dialog/Setup 的错误隔离和恢复路径，并加入真实交互回归。
>
> 1. `ui/dialogs.tsx` 自己显式 import `usePaste`、`decodePasteBytes`、`PasteEvent`；删除 `app.tsx` 中不属于父级的这些 import，锁定模块 ownership。
> 2. SecretInput 的 paste/keyboard 生命周期必须可独立测试：粘贴 Secret 不回显明文，回车提交，Esc 取消，Backspace 正常；不得泄露 Secret 到 notice/log/transcript。
> 3. Provider Setup 每一步（catalog → API Key/env → profile save → real model list → model select → reasoning）失败时只结束/返回当前步骤，保持已成功持久化事实；Dialog 必须关闭或恢复到可操作上一级，Prompt/animation/commands 必须继续运行。
> 4. 给 Provider Manager 增加单操作 guard：异常不能留下 unresolved modal Promise、stale `dialog()`、永久 `setupFlow.active` 或失焦 Prompt。
> 5. 初次 Setup 与 Ctrl+P 后续管理必须复用同一能力；已配置 Profile 不应因为一次 UI 异常被删除或标成未配置。
> 6. 新增 OpenTUI/纯合同回归：静态锁定每个拆分模块自己拥有 hook import；行为测试覆盖 SecretInput paste + submit/cancel；Provider operation throw 后 Dialog 关闭/恢复，TUI root 仍可接收 keyboard/timer/render。
> 7. 保留 #02/#03/#04：PromptDock 固定、Transcript wheel/sticky、Textarea 原生 caret、Windows 文本光标指示器规则不得回归。
> 8. 完成后更新本条最终根因、`UPDATE-LOG`、`PROJECT-STATUS`，重新生成 Source Manifest 与 `xma-0.1.0.zip`；Windows 实机完成“首次配置 + Ctrl+P 重配 + 发起真实对话 + 出错后继续操作”后才标已完成。

## 实际修改与验证证据

- `ui/dialogs.tsx` 已在自身模块显式 import `usePaste / decodePasteBytes / PasteEvent`；父级 `app.tsx` 删除这些不属于父级 ownership 的 import。
- `askList / askInput` 的 `setDialog` 增加同步异常 rollback/reject；异常不会留下永久 pending Promise。
- 当前 Dialog 树由 Solid `ErrorBoundary` 隔离；子 Dialog hook/render 失败时会 settle 当前 list/input 为 cancel、approval 为 deny，清除 modal，恢复主 Prompt 并请求重新渲染，而不是毒化整个 TUI root。
- 新增 `opentui-runtime.test.ts` 回归，锁定 hook import ownership、ErrorBoundary、dialog settlement 与 setupFlow finally 恢复。
- 相关静态/合同回归与 #05 metrics tests 在当前可运行环境合计 38 项 PASS；修改 TS/TSX 均通过 TypeScript `transpileModule` 语法检查。
- 当前环境没有项目完整 OpenTUI native `node_modules`，无法冒充 Windows Terminal 的首次配置/粘贴/动画 E2E 已通过，因此本条保持“验证中”。

## 验收条件

- 首次 Setup 能从真实 Provider Catalog 进入 API Key/环境变量输入，并完成真实模型选择。
- Ctrl+P 模型管理可以新增、切换 Profile/Model/Reasoning。
- 不再出现 `usePaste is not defined`。
- 任一配置步骤故意失败后，TUI 动画/键盘/Prompt/命令面板仍可操作，不需重启进程。
- 已保存 Profile 不因后续模型目录/Probe/UI 失败而丢失。
- Secret 不进入 Transcript/notice/log。

# 07 真实模型身份、工作模式、三档权限与上下文/账户指标一致性

- 状态：验证中
- 日期：2026-09-16
- 类型：#05 收口 + Runtime 权限能力修复
- 影响范围：`xma-tools` Tool Policy、App Protocol、CLI Backend、Terminal 权限设置、Session Metrics/StatusBar、Provider Telemetry
- 关联记录：`#05`、`#06`

## 用户可见症状

1. Tab 已切换 Build / Plan，但状态栏仍固定显示“请求批准”，看起来工作模式和权限没有真实联动。
2. 用户之前明确要求三种权限：请求批准 / 替我审批 / 完全权限，但当前 Terminal 没有真正可选择、可持久、可进入 Runtime Tool Policy 的三档状态。
3. DeepSeek V4 Pro 已产生真实本轮 token，但 `1,791 / 1M` 被显示成“上下文 0%”，误导用户认为上下文没有变化。
4. 官方 DeepSeek API Profile 已具备真实余额接口，但常见终端宽度状态栏看不到余额。
5. 产品身份“Xiaoyu”容易被误解成另一个模型；实际上每个真实 Step 必须使用用户配置的 Provider/Profile/Model 作为唯一模型请求目标。

## 已确认代码证据

- `apps/cli/src/main.ts` 当前存在 `const permissionProfile = 'ask' as const`，导致 Session Metrics 权限永远固定为 ask。
- `sendMessage()` 当前只根据 `Build / Plan / Compose` 选择 ToolRegistry，没有把用户 Permission Profile 作为 Tool Policy 注入 `session.runTurn()`。
- Plan 已通过 `registerNativeTools(... allowWrite: false)` 只暴露 read Tool；Compose 不暴露 Workspace Tool。这一方向保留。
- `apps/cli/opentui-runtime/ui/session-status.ts` 的百分比使用 `Math.round(value * 100)`；1M context 下约 1.8k input 被错误展示为 `0%`。
- `plugins/deepseek/telemetry.ts` 已有官方 1M context metadata 与 `/user/balance` account snapshot；状态栏中等宽度分支没有包含 balance。

## 强制架构语义

1. **模型身份只有用户实际选择的 Provider/Profile/Model。** `Xiaoyu` 是 Agent/Product identity，不是隐藏第二模型，不允许重路由、降级或用另一模型代跑。
2. **Work Mode 与 Permission Profile 是两条正交轴。**
   - Build：完整当前 Tool Surface；具体副作用由 Permission Profile + Guard + Rust Kernel 决定。
   - Plan：同一个真实模型，但 ToolPlan 强制只读；权限再高也不能突破 Plan 的 read-only ceiling。
   - Compose：legacy 纯模型对话，不暴露 Workspace Tools。
3. **Permission Profile 三档必须是真实 Runtime Policy，不是 UI 标签。**
   - `ask` / 请求批准：read/control 自动允许；write/execute/network 请求用户确认。
   - `smart` / 替我审批：当前 Workspace 内常规 read/write 可自动批准；execute/network、跨 Workspace、系统级或高风险动作仍请求用户。
   - `full` / 完全权限：Policy 对当前 Host 已暴露 Tool 自动批准，但 Security Guard、Workspace Guard、Rust Capability/OS 权限仍不可绕过。
4. 权限切换应由 Terminal 设置/命令面板完成并持久化为用户偏好；Desktop/Web 未来通过同一 App Protocol/Runtime Permission Contract 设置，禁止各自实现另一套 Policy。
5. Permission Profile 在一个 Turn 开始时形成稳定快照；用户下一次修改影响后续 Turn，不允许中途无审计地改变当前执行中的策略。
6. Context = 最近真实模型请求 input tokens / **该请求对应模型** context window；不能拿 Session 累计 token 当 context。
7. 小于 1% 的真实 context 不得四舍五入成 0%；至少显示 0.1% 级精度，并优先显示 `used/window`，例如 `上下文 0.2% · 1.8k/1.0m`。
8. API 余额只能显示 Provider Account Snapshot 的真实值；常见终端宽度也要保留余额/套餐关键信息，不能因为一行裁剪让功能实际不可见。

## 本次修复 Prompt

> 以当前 `xma-0.1.0` 最新包为第一事实源，完成 #05 剩余真实指标，并实现 Host-neutral 三档 Permission Profile。禁止用 UI 文案伪装权限变化，禁止创建 Xiaoyu 自有模型层。
>
> ### A. xma-tools Permission Policy
> - 新增稳定 `PermissionProfileToolPolicy`，输入 `ask | smart | full`。
> - ask：read/control allow；write/execute/network ask。
> - smart：read/control allow；具备当前 Workspace 明确 write scope 的常规 write allow；execute/network 和没有 Workspace scope 的副作用 ask。跨 Workspace/越权仍由 Workspace/Security Guard 单调 deny/ask，不得被 smart 放大。
> - full：Policy allow 当前 ToolPlan 中所有 effect，但 Guards/Rust Kernel 仍可 deny。
> - 增加 Contract Tests，证明三档会导致真实不同的 Approval 请求次数/execute 结果；Security Guard 在 full 下仍单调生效。
>
> ### B. Work Mode 与 Permission 分离
> - Build/Plan/Compose 保留同一个当前真实 ModelProvider。
> - Plan ToolPlan 必须持续只读；即使 permission=full，也不注册 write/execute Tool。
> - Compose 不注册 Workspace Tool。
> - Terminal Tab 只切工作模式；权限使用独立 `/permission` 与 Ctrl+P/设置入口。UI 要明确两者不是同一个开关。
>
> ### C. Runtime/Host Permission State
> - CLI Backend 将 permissionProfile 从硬编码常量改为可读/可设置状态。
> - `sendMessage()` 在每个 Turn 开始时用当前 profile 创建 Permission Policy 并传给 `session.runTurn()`。
> - `sessionMetrics.permission` 必须读取同一个 Runtime 状态，不允许 UI 自己猜。
> - Terminal 用户选择写入持久偏好；重启后仍恢复。
> - App Protocol 增加统一 permission set/result Contract，供未来 Desktop/Web 直接复用。
>
> ### D. Context/Balance #05 收口
> - 修正 context 百分比精度；1,791 / 1,000,000 不得显示 0%。
> - 状态栏显示真实 `used/window`；Model Telemetry 不知道 window 时显示 `—`。
> - 切换模型但尚未对新模型发请求时，不得拿旧模型 usage 配上新模型 window；可显示新模型 window，但 used/ratio 保持 unavailable，直到新模型真实 usage 到达。
> - DeepSeek 官方 API balance 成功时在常见 90~130 列状态栏也可见；失败/不支持显示 `—`，不影响聊天。
>
> ### E. 模型身份合同
> - 文档与测试锁定：Xiaoyu 是 Agent identity；真正模型请求永远使用当前 `providerId + profileId + modelId`。
> - 禁止 Terminal 状态栏、Agent Runtime 或 Skill 把 `Xiaoyu` 当 Model ID 或把用户模型换成隐藏内部模型。
>
> ### F. 验证
> - Tool Policy 三档行为单测。
> - Plan + full 仍只有 read Tool 的测试。
> - Terminal settings 持久化 permission profile 测试。
> - Session Metrics：active model 切换、context 精度、unknown context 测试。
> - StatusBar：中等宽度显示余额/套餐，1M context 小比例不是 0%。
> - 更新 `AGENTS.md`、`DEVELOPMENT-RULES.md`、`AGENT-RUNTIME.md`、`MODEL-PROVIDER.md`、`PROJECT-STATUS.md`、`UPDATE-LOG.md`；重新生成 Source Manifest 与最终 ZIP。

## 验收条件

- Ctrl+P 或 `/permission` 可选择 请求批准 / 替我审批 / 完全权限，重启 Terminal 后仍保持。
- Build 下三种权限会造成真实不同的 Tool Approval 行为，而不仅是状态栏文字变化。
- Plan 下不论权限选哪档，都不能看到/执行 write/execute Tool；仍使用用户当前同一个真实模型。
- DeepSeek 1M context 使用约 1.8k prompt tokens 时显示约 0.2%，而不是 0%。
- DeepSeek 官方 API balance 查询成功时常见终端宽度可看到真实余额；余额接口失败时显示 — 且不阻断对话。
- 切换 Provider/Model 后后续 Step 的 `step/start.provider` 与用户选择完全一致；Xiaoyu 不形成第二模型层。


## 实施结果（自动验证前）

- `xma-tools` 新增 `PermissionProfileController + PermissionProfileToolPolicy`：三档权限进入真实 ToolRouter Policy；每个 Turn 通过 `createPolicy()` 形成不可变快照。
- Terminal `/permission` / Ctrl+P 可独立选择三档并持久化；Tab 继续只切 Build/Plan/Compose。
- Plan registry 继续只注册 `native.fs.read_text`；即使 `full` 也无法执行未进入 ToolPlan 的 write/execute Tool。
- Session status 的权限字段来自 Backend 同一 Permission state，不再硬编码 ask；文案统一“请求批准 / 替我审批 / 完全权限”。
- Context 小比例使用 0.1% 精度并显示 used/window；切换模型后在新模型产生真实 usage 前不会把旧 usage 配新 window。
- DeepSeek 官方 API context 固定按当前官方 1M metadata；`/user/balance` 真实查询保持官方 Host 限制。2026-09-14 04:00 UTC 后 `deepseek-v4-pro` 的费用估算按官方当前路由到 V4.1 Flash 的计费语义处理。
- 窄/中等 Terminal 宽度优先保留 context、账户/套餐与权限，避免真实余额被次要计数器裁掉。

## Windows 实机待验收

1. Ctrl+P → 权限/审批依次切 ask/smart/full，状态栏实时显示并重启保持。
2. Build+ask 写操作必须弹 Approval；Build+smart 的当前 Workspace 常规写不弹，execute/network 仍按策略询问；Build+full 对当前 ToolPlan 不弹 Approval。
3. Plan+full 仍无 write/execute Tool；模型仍是用户当前配置的同一 Provider/Model。
4. DeepSeek 1M 模型在约 1.8k prompt tokens 时显示约 0.2% + `1.8k/1.0m`，不是 0%。
5. 官方 DeepSeek API 余额接口成功时状态栏显示真实余额；失败/不支持只显示 `—` 且不影响聊天。


## 自动验证证据

- Node 22 `--experimental-transform-types`：#07 相关 Tool Policy / Plan ToolSet / Session Metrics / StatusBar / Provider Telemetry / TUI settings 共 **54/54 PASS**。
- Runtime updater：**2/2 PASS**。
- 项目 Gate：Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository **9/9 PASS**。
- 修改过的 14 个 TS/TSX 文件已通过 TypeScript transpile syntax diagnostics。
- Source Manifest 已重新生成：235 个正式受管源码文件。
- 仍需 Windows 实机验证真实 Provider 余额、权限切换/重启持久化与 Plan+full 行为后才能把 #07 标为已完成。

## #07 补充实施：显式 Yes/No Approval 与 Plan → Build 可恢复交接

> 本补充在用户 Windows 实机验证 #07 基础权限/上下文/余额后建立，属于同一 #07 根因簇，必须先于 #08 完成。

### 新增用户证据

1. `请求批准`模式触发真实 Tool Approval 时，用户要求只有两个最终决定：`Yes` / `No`。`Yes` 仅允许当前调用继续；`No` 必须 fail-closed，当前调用无论模型如何要求都不得执行。
2. Plan 模式虽然 TUI 显示 `Plan` 且 ToolPlan 已只读，但真实模型回答“当前没有明确的模式参数”，证明工作模式没有进入模型可见 Context。
3. Plan 完成后需要正式的“计划交接”语义：询问用户是否按当前 Plan 执行。`Yes` 才切换 Build 并继续；`No` 保留 Plan，不删除历史计划，后续用户切 Build 或明确要求执行最近 Plan 时仍可继续。

### 补充修复 Prompt

> 1. 把 Work Mode 提升为 Host-neutral Runtime Contract，禁止只存在于 TUI label。Build/Plan/Compose 必须把当前模式及能力边界作为 system context 发送给当前真实 Provider/Model。
> 2. Plan context 必须明确：当前就是 Plan；只允许读取/分析/规划，不得声称自己不知道模式，不得执行写入/进程/网络副作用；应根据用户目标生成可执行计划，并在计划足够明确时准备交给 Host 做执行确认。
> 3. Build context 必须明确当前为执行模式，可使用当前 ToolPlan 在用户 Permission Profile 和 Guard 允许范围内自主工作直到验证完成；不得因为 Xiaoyu 产品身份而替换用户真实模型。
> 4. Compose 保留独立语义，但不得假装成 Build/Plan。
> 5. `ask` Permission 下的 Approval UI 改成显式 `Yes / No`：Yes => `allow-once`；No/Esc/Abort => `deny`。UI 不再提供“本会话允许”，防止一次确认扩大成持久授权。底层兼容类型可暂保留 `allow-session`，但产品 ask 路径不得生成它。
> 6. No 必须先 durable 记录 Approval deny，再返回 `TOOL_APPROVAL_DENIED` 给同一个模型；Router 后续绝不可执行真实 Tool。模型可以收到 Observation 后寻找不需要该权限的替代方案，但不得重放同一个已拒绝副作用并绕过用户决定。
> 7. Plan 最终回答完成后，Host 显式询问：`是否按当前 Plan 开始执行？ Yes / No`。Yes => 记录用户确认、自动切到 Build，并以最近 Plan 为执行依据启动后续 Turn；No => 保留最近 Plan，不清除，不自动执行。
> 8. 最近 Plan 必须成为 durable Session fact，而不是只存在于 TUI signal；后续 Build Turn 可读取最近 Plan/decision。用户切换 Build 后说“按刚才计划执行”时，真实模型能从同一 Session history + durable Plan fact 继续。
> 9. 增加回归：Plan 模式 Provider 请求首个 system context 包含 Plan/read-only；Build 包含 Build/execute；ask Approval 的 Yes 执行一次、No 零副作用；Plan No 后 plan snapshot 仍存在；Plan Yes 进入 Build handoff。

### 本补充验收

- 在 Plan 问“当前是什么模式”，真实模型应明确知道自己处于 Plan，并解释只读规划边界。
- Plan 内不存在 write/execute Tool；即使权限=完全权限也保持只读。
- ask Approval 只显示 Yes/No，No 后对应 Tool 零执行。
- Plan 完成后出现独立 Yes/No 执行确认；No 后计划仍可继续引用；Yes 自动切 Build 并开始执行。

# 08 Ctrl+C 文本复制与中止/退出冲突

- 状态：已完成
- 日期：2026-09-16
- 类型：Terminal 输入/选择/生命周期 Bug
- 影响范围：OpenTUI renderer selection、keyboard routing、clipboard、busy cancel、process exit
- 关联记录：#01 caret/scroll、#03 transcript viewport、#07 work mode/approval

## 用户可见症状

1. 在 Xiaoyu/xma Terminal 中用鼠标选择模型回复文本后按 `Ctrl+C`，程序直接退出，无法像正常终端聊天工具一样复制选中文字。
2. 当前 `Ctrl+C` 同时承担“中止当前模型工作”和“退出 Xiaoyu”，但没有优先判断 OpenTUI 是否存在真实文本选区。
3. Windows Terminal 用户自然预期：有选区时 `Ctrl+C` 是复制；没有选区且 Agent 正忙时才是中止；空闲且无选区时才允许退出。

## 已确认事实与上游证据

- XMA 已创建 OpenTUI renderer 时使用 `exitOnCtrlC: false`，因此当前退出不是 OpenTUI 默认行为，而是 `app.tsx` 全局 keyboard handler 主动 `props.onExit()`。
- 当前 handler 在 modal/non-modal 下都直接把 Ctrl+C 当退出/中止，没有检查 `renderer.getSelection()?.getSelectedText()`。
- OpenTUI Renderer 提供真实 `getSelection()` / `getSelectedText()`；OpenCode/OpenTUI 相关修复也采用“只有真实 selected text 才拦截快捷键”的模式，避免空 Selection 对象误判。
- OpenTUI 0.5.11 提供 clipboard service/selection API；实现必须优先使用官方公开能力，不能 shell 出 `clip.exe` 作为唯一方案。

## 禁止的错误修法

- 不得简单禁用 Ctrl+C；用户仍需要中止当前 Agent 工作。
- 不得只依赖 Windows Terminal 自己的复制行为，因为 Desktop/SSH/未来 Host 的 terminal capability 不同。
- 不得在有选区时退出进程。
- 不得因为复制失败就退出或清空 Transcript。
- 不得破坏鼠标滚轮、sticky follow、Textarea caret、IME。

## 本次修复 Prompt

> 1. 在 OpenTUI Root keyboard routing 最前面读取 `renderer.getSelection()?.getSelectedText()`；只有非空文本才视为真实选区。
> 2. Ctrl+C 优先级固定：`真实选区 → 复制并保持进程`；`无选区 + busy → Abort 当前 Turn`；`无选区 + modal → 按 modal 自身取消/deny，不退出`；`无选区 + idle → 二次 Ctrl+C 或明确 /exit 才退出`，避免误触单次退出。
> 3. 复制使用 OpenTUI Clipboard/renderer 官方能力，成功后清理 selection 并给短 notice；失败时保留进程并提示失败。
> 4. Esc 有选区时只清 Selection；没有选区再执行原有返回/取消语义。
> 5. 更新底部提示：有选区时 `Ctrl+C 复制`；busy 时 `Ctrl+C 中止`；idle 时不再误导成单击退出。
> 6. Dialog 内同样遵守 selection-first；API Key SecretInput 自己的 Ctrl+C 不得泄露 Secret。
> 7. 增加行为测试：选中文字 + Ctrl+C 不触发 onExit；busy + 无选区触发 Abort；idle 首次 Ctrl+C 不退出、明确二次或 /exit 才退出；复制后 Transcript/Prompt 仍可继续操作。
> 8. 保留 Windows 文本光标指示器、原生 caret、mouse wheel 与 PromptDock 已验收行为。

## 验收条件

- 鼠标选中 Xiaoyu 回复，Ctrl+C 后可以粘贴出真实选中文字，Xiaoyu 不退出。
- 模型工作中无选区 Ctrl+C 能中止当前 Turn，但进程保持。
- 空闲无选区误按一次 Ctrl+C 不退出；明确再次 Ctrl+C 或 `/exit` 才退出。
- 复制操作不导致焦点、caret、滚动和动画失活。

## #07 实施补记：Plan ready 必须由真实模型显式声明

- 普通 Plan 问答、询问“当前是什么模式”、尚未完成的分析都不能自动弹出执行确认。
- Plan ToolPlan 新增纯 `control` Tool：`xma.plan.ready`。只有当前真实 Provider/Model 判断计划已经足够完整、确实准备交接执行时，才调用该 Tool，并传入完整可执行 Plan。
- `xma.plan.ready` **不执行任何任务、不切换权限、不代表用户同意**；它只产生“计划已就绪”的 Host-neutral 信号。
- Host 收到 ready 后才显示 `是否按当前 Plan 开始执行？ Yes / No`。No 保留 durable Plan；Yes 记录决定并切换 Build。
- 这避免 UI 用字符串/启发式猜“计划是否完成”，也避免用户只问 Plan 模式说明时被错误询问执行。

## #07 补充实施结果

- 新增 `packages/xma-agent-loop/src/work-mode.ts`：Build/Plan/Compose 作为 Context Source 进入真实 Provider 请求；Plan 明确 read-only，Build 明确执行语义。
- 新增 `packages/xma-agent-loop/src/plan-control.ts`：Plan ToolPlan 暴露纯 control `xma.plan.ready`；普通 Plan 回复不再自动保存为 executable Plan。
- `AgentSession` 增加 `retainPlan()` / `latestPlan()` / `decideLatestPlan()`；`plan/snapshot` 与 `plan/decision` 是 durable Session fact，但不伪装成普通用户消息。
- `ask` Approval UI 只保留 `No` / `Yes`，默认 No；Yes 仅 allow-once。
- Plan ready 后 Host 默认选择 No。Yes 时先 durable 记录 decision，再切 Build；下一轮用户可见确认只记录真实的 `Yes`，Build Context 会读取已批准 retained Plan 并开始执行。
- 自动测试覆盖：Work Mode Context、Plan ready control Tool、普通 Plan 问答不会自动 retained、No 后 Plan 仍存在、Permission Tool Policy、OpenTUI Yes/No 合同。
- 状态仍为“验证中”：需要 Windows 实机证明当前真实 Provider 在 Plan 能正确说出模式、Plan ready 才出现 handoff、Yes/No 行为符合预期。

## #08 实施结果

- 新增 `apps/cli/src/terminal-shortcuts.ts`，把 Ctrl+C 优先级从 Renderer 组件中提取成纯合同。
- OpenTUI Root 先读取真实 Selection；非空选区使用 `renderer.copyToClipboardOSC52()`，终端能力不可用时回退 `createHostClipboard().writeText()`。成功后清 Selection；失败保留 Selection，不退出。
- 无选区时：busy 中止当前 Turn；modal 只 cancel/deny；idle 第一次 Ctrl+C 仅提示，1.5 秒内再次 Ctrl+C 才退出。`/exit` 仍是明确退出入口。
- Esc 在有选区时只清 Selection。
- 自动测试覆盖快捷键优先级与 OpenTUI 静态合同；本轮 #07/#08 相关回归合计 92/92 PASS、Runtime updater 2/2 PASS、9 项 Gate PASS。2026-09-16 用户 Windows 实机确认 Ctrl+C 复制/退出冲突已解决，#08 标记“已完成”；永久快捷栏过长属于后续独立 #10 UI 投影问题，不改写 #08 历史。

# 09 正在思考实时活动体验与 GitHub 远程最新同步优化

- 状态：验证中
- 日期：2026-09-16
- 类型：Terminal 可观测性体验 + Windows 开发链更新流程
- 影响范围：OpenTUI Turn Activity、Runtime 公开事件投影、`xma-dev.bat -> [10]`、`scripts/windows/xma-console.ps1`
- 关联记录：#05 Session Metrics、#07 Work Mode/Approval、#08 Ctrl+C Selection
- 编号说明：用户本轮口头命名为“#08”，但 #08 已被 Ctrl+C 修复历史占用；按 `REPAIR-WORKFLOW.md` 的“编号不得复用”规则自动顺延为 #09，禁止覆盖历史。

## 用户可见目标

1. 用户提交问题后立即进入“正在思考”状态；活动区必须是真实 Turn 生命周期，不是固定文案或假计时。
2. Turn 运行中显示“已处理 N秒/分”；用户点击“正在思考”可展开查看当前公开工作活动：任务处理阶段、真实 Tool Call、Tool Result 摘要、开始生成最终回答等。
3. Turn 完成后状态折叠为“用时 N秒/分 ▸”，点击后仍可查看这一轮真实发生过的公开活动。
4. 展开区只能展示**可公开的执行摘要**，不得展示 Provider 原始 hidden reasoning / chain-of-thought。可以展示“正在分析任务 / 读取文件 / 搜索 / 运行程序 / 工具结果 / 整理回答”等可验证活动，以及简短的执行计划摘要；不得把模型内部逐 token reasoning 原文暴露给 Host。
5. 最终回答继续由用户真实配置的 Provider/Model 生成；Xiaoyu 只是 Agent/Product identity，不增加第二个隐藏模型。
6. `xma-dev.bat -> [10]` 必须把已存在的正确 `yubboo/xma` Git clone **原地同步到 GitHub 最新 main**，不要求用户删除整个 `xma` 目录再 `git clone`，并尽量复用 `node_modules/runtime/.cache/.git/xma-state` 等本地依赖和缓存。

## 已确认事实

- 当前 Terminal 已有真实 Turn Activity 结构：`TerminalActivitySummary`、实时 elapsed、公开 Tool Call/Result 摘要和展开/折叠；但运行中标题固定为“思考了 N”，与 Codex 类产品“已处理 N + 正在思考”体验不一致。
- 当前 `reasoning-delta` 已明确丢弃原始 reasoning 正文，只记一次公开状态“模型思考与规划”；这一安全边界必须保留。
- 当前 `[10]` 已支持 `fetch + pull --rebase --autostash` 和明确确认后的 `reset --hard origin/main`，实际上不需要重新 clone；但 UI/验证不足，用户很难确认本地/远程版本、是否已经最新、更新是否真正同步成功。
- `xma-dev.bat` 本身只负责进入源码根并转发给 `scripts/windows/xma-console.ps1`；[10] 的真实业务逻辑 ownership 在 `xma-console.ps1`，不得把 Git 更新逻辑复制进 BAT。

## 禁止的错误修法

- 禁止把“正在思考”做成固定 28 秒、固定活动清单或随机假工具记录。
- 禁止展示模型原始 chain-of-thought、reasoning token 正文、隐藏系统提示词或 Secret。
- 禁止为了做 Activity 再实现一套 Agent Loop；Terminal 只能投影现有 Runtime/Session/Tool 真值。
- 禁止 `[10]` 自动删除整个仓库、自动重新 clone、自动 `git clean -fdx`、删除 `node_modules/runtime/.cache/dist/.git/xma-state`。
- 禁止 `[10]` 在 origin 不是 `yubboo/xma`、不是 main、不是 Git 顶层时擅自修改源码。
- 禁止安全更新吞掉 Git 冲突；有冲突必须 fail loud 并保留可恢复状态。

## 修复 / 优化 Prompt

> 1. 把 Terminal Turn Activity 的显示状态改成明确生命周期：运行中第一行显示 `已处理 <真实elapsed>`，第二行显示可点击的 `正在思考 ▸/▾`；完成后折叠标题变成 `用时 <真实elapsed> ▸/▾`；取消/失败在同一标题追加结果状态。
> 2. elapsed 必须从当前 Turn 的真实 `startedAtMs` 到 Runtime 完成/取消/失败时刻计算，支持秒、分、小时；禁止 UI 固定值。
> 3. 展开内容按真实发生顺序显示公开事件：开始处理、当前 Work Mode 的公开目标（Build=理解任务并推进交付，Plan=分析并形成计划，Compose=编排/整理）、模型进入分析阶段、Tool Call、Tool Result、开始整理最终回答。工具参数/结果继续走既有脱敏器。
> 4. Provider 原始 reasoning delta 只作为“模型正在分析与规划”的阶段信号；不得保存或显示 `event.text`。如果未来需要“计划摘要”，只能来自显式 public plan/control event 或模型最终公开内容，不能从 hidden reasoning 截取。
> 5. 点击运行中“正在思考”和完成后“用时”都必须切换同一个 Activity Summary 的 expanded 状态；manual scroll/sticky-bottom/PromptDock/caret 不得回归。
> 6. `[10]` 改名/文案为“同步 GitHub 最新源码”，进入后先 `fetch --prune origin main`，显示本地 HEAD、origin/main、ahead/behind、工作区修改状态；让用户清楚知道是否已经最新。
> 7. 安全同步优先原地更新：没有远端差异时直接报告“已是最新”；存在远端提交时使用 `pull --rebase --autostash origin main`，冲突必须停止并提示解决方法，不删除 clone。
> 8. 强制恢复仍需输入 `YES`；执行前如果存在 tracked 修改，先把 `git diff --binary HEAD` 备份到 `.git/xma-state/update-backups/<timestamp>/tracked.patch` 并记录原 HEAD；然后 `fetch --prune + reset --hard origin/main`。不得自动清理 untracked/ignored 文件。
> 9. 更新完成后重新验证：当前分支 main、origin URL、remote behind=0；打印更新前后 commit。只有依赖清单（`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`Cargo.toml`、`Cargo.lock` 等）发生变化时才提示重新运行 `[1]`；否则可直接重新启动 `[4]`。
> 10. 更新 Windows Gate/文档/REPAIR/UPDATE-LOG，增加可失败测试：Activity lifecycle 格式、hidden reasoning 不泄露、[10] fetch/prune/版本比较/备份/禁止 clone 和 clean。

## 不允许回归的既有行为

- #03 Transcript 真实滚动范围、mouse wheel、sticky follow。
- #04 OpenTUI Textarea 原生 caret / IME ownership。
- #05 真实 Session Metrics/Provider Telemetry，不得造假。
- #07 用户真实 Provider/Model、Plan/Build、Permission/Approval 语义。
- #08 选中文本 Ctrl+C 复制优先，不得重新变成直接退出。
- `[4]/[7]` 不得因为 [10] 改造而偷偷联网安装依赖。

## 验收条件

- 真实长 Turn 运行时看到 `已处理 42秒` 等实时增长；点击 `正在思考` 能展开/折叠真实公开活动。
- Turn 完成后显示真实 `用时 1分35秒`，展开后仍能看到这一轮发生过的 Tool/状态摘要。
- 展开区不出现 Provider hidden reasoning 原文、API Key、token/password/Authorization 等 Secret。
- 正确 Git clone 内 `[10]` 能原地 fetch/sync 到远端最新 main，不需要删除 `xma` 目录重 clone；已是最新时明确显示。
- 强制恢复前 tracked 修改存在时生成 recovery patch；ignored 依赖/cache 不被删除。
- 更新后如果依赖清单未变化，提示可直接运行 `[4]`；变化时明确提示运行 `[1]`。

## #09 实施结果

- Terminal 新增 `apps/cli/opentui-runtime/ui/activity-view.ts` 纯展示合同：真实 elapsed 使用中文秒/分/小时格式；运行态投影为 `已处理 N` + `正在思考 ▸/▾`，Turn 结算后冻结为 `用时 N ▸/▾`，取消/失败追加结果状态。
- `TranscriptViewport` 的同一个 Activity Summary 在运行中和完成后都可点击展开；展开内容继续只消费真实公开活动。提交时新增 Work Mode 公开阶段：Build=`理解任务并推进交付`、Plan=`分析任务并形成可执行计划`、Compose=`编排任务并整理结果`；首个 reasoning 只记 `模型正在分析与规划`，首个正式 text delta 记 `开始整理最终回答`。
- 安全边界保持：`reasoning-delta` 的 `event.text` 不进入 Transcript/Activity；Tool Call/Result 继续使用 `activity-format.ts` 做路径/参数/Secret 脱敏。当前实现不会提供或保存隐藏 chain-of-thought，只展示可验证的执行摘要。
- `[10]` 的业务 ownership 继续留在 `scripts/windows/xma-console.ps1`，`xma-dev.bat` 仍只做稳定 launcher。菜单改为 `同步 GitHub 最新源码`，明确“原地更新当前 clone，不需要删除 xma 目录重新 clone”。
- `[10]/[1] 安全同步`：`fetch --prune origin main` 后显示本地 HEAD、origin/main、ahead/behind 与 dirty 状态；behind=0 直接报告已是最新；有远端新提交才执行 `pull --rebase --autostash origin main`，完成后再次验证 behind=0。
- `[10]/[2] 强制恢复`：保持 `YES` 明确确认；fetch 后如果存在 tracked 修改或本地 ahead commit，会在 `.git/xma-state/update-backups/<timestamp>/` 写 `metadata.txt`，未提交 tracked 变化写 `tracked.patch`，本地提交相对共同基线写 `local-commits.patch`，之后才 `reset --hard origin/main`。仍禁止 `git clean`，因此未跟踪文件与 ignored runtime/node_modules/.cache/dist 不被自动删除。
- 更新前后 commit 用于判断依赖清单是否变化；只有 `package.json/pnpm-lock.yaml/pnpm-workspace.yaml/Cargo.toml/Cargo.lock` 等依赖清单变化才提示重新运行 `[1]`，否则提示可直接重新启动 `[4]`。
- 自动验证：`activity-view.test.ts` 2/2 PASS；`opentui-runtime.test.ts` 33/33 PASS（两者合计 35/35）；Runtime updater 2/2 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。Source Manifest 为 242 个受管源码文件；成品 ZIP 为 243 entries（242 source + manifest），独立解压后缺失 0、额外 0、内容哈希差异 0，并从解压成品再次跑过 35/35 + 2/2 + 9/9。当前环境没有 Windows PowerShell 5.1 和真实 Windows Terminal，因此 `[10]` Git 更新交互、鼠标点击 Activity 展开仍保留 Windows 实机 E2E，状态为“验证中”。


# 10 Terminal 状态栏分区布局与 Ctrl+C 按需提示优化

- 状态：验证中
- 日期：2026-09-16
- 类型：Terminal Host UI 投影优化 / #05 Metrics 与 #08 Ctrl+C 后续收口
- 影响范围：`PromptDock`、Session Metrics Terminal projection、快捷键提示栏
- 关联历史：#05 统一 Session Runtime Metrics、#07 Permission/Context、#08 Ctrl+C Selection Copy、#09 Activity/Git Update
- 编号说明：Repair 编号是不可变历史 ID。即使用户口头再次指定已占用编号，也必须自动使用下一个未占用编号并告知用户；不得覆盖、重写或复用历史条目。本轮下一个可用编号为 #10。

## 用户可见症状

1. #08 修复后永久快捷栏加入 `ctrl+c 复制 / 再按一次退出`，常见 Windows Terminal 宽度下快捷栏过长并发生换行，破坏 Prompt Dock 的稳定单行布局。
2. #05 的 Session Status 把模型名、API、token、context、balance、permission 等长期堆在一整行；模型名又与上方 Provider 状态重复，常见窗口下过长、视觉层级不清晰。
3. 当前 Provider 状态行左侧存在可利用的空白区域；用户希望把最关心的 `上下文 used/window + 真实余额/套餐额度` 放到 Provider 身份左侧，并继续保持 Provider/Model/Ready/Reasoning 在最右侧。
4. 用户明确要求数据继续来自 #05 canonical `SessionRuntimeMetrics`，不得为了新布局写死 DeepSeek、1M、余额或费用。

## 锁定目标

建议的常见宽度视觉结构：

```text
Build                    上下文 0.2% · 1,793/1.0m · 余额 ¥12.02   ● DeepSeek · deepseek-v4-pro · 模型已就绪 · high

aPI/套餐 · 本轮 1,859 · 会话费用 ≈¥... · 权限 替我审批

tab / shift+tab  切换模式   ctrl+p  命令   ctrl+k  搜索   /  快捷命令   esc  返回
```

其中：

- `上下文 / 余额 / 套餐额度` 是 #05 canonical metrics 的“首要会话健康指标”，进入 Provider 状态同一行、Provider 身份左侧；两组之间保留稳定空隙。
- 第二指标行删除重复的 model/context/balance，只保留当前宽度下真正有价值的辅助统计（计费来源、本轮/会话 tokens、真实费用、permission 等）。
- 窄屏优先保留 Provider 身份；空间不足时依次裁辅助统计、账户摘要、context 摘要，禁止自动换行破坏 PromptDock 高度。
- `Ctrl+C` 不再长期占用快捷栏。只有用户实际按 Ctrl+C 时才通过现有 transient `tell()` 提示真实结果：复制成功/失败、已请求中止、已取消当前操作、再次按下退出。

## 修复 / 优化 Prompt

> 1. 保持 #05 `SessionRuntimeMetrics` 为唯一数据源，新增纯 Terminal formatter 区分 `headline metrics` 与 `detail metrics`；不得在 JSX 内按 Provider 品牌计算 context/cost/balance。
> 2. `headline metrics` 的常见宽度目标是 `上下文 <ratio> · <used>/<window> · 余额 <real>`；subscription 使用真实 plan/quota 语义；unknown 不伪造 0。宽度不足时按可预测优先级裁剪。
> 3. PromptDock 的 Mode/Status 行仍由单一子模块拥有：Build/Plan/Compose 保持左侧；右侧建立 `headline metrics` + gap + Provider/Model/Ready/Reasoning 两个相邻 group，并保持右对齐。不得让 metrics 挤掉 Provider truth。
> 4. 原 `SessionStatusBar` 保留为短 detail row，但移除与 headline/provider 重复的 model/context/balance；常见宽度只显示 billing/本轮 tokens/真实会话费用/permission 等少量信息，超宽屏也避免重新堆满所有 telemetry。
> 5. 从永久 `hintItems` 删除 Ctrl+C 文案；Ctrl+C 所有语义继续复用 #08 `resolveCtrlCAction()`，不得修改 Selection > cancel-turn > cancel-modal > arm-exit/exit 的优先级。
> 6. Ctrl+C 实际执行时补齐 transient feedback：selection copy 已有成功/失败提示；busy cancel 提示“已请求中止当前任务”；modal cancel/deny 给出取消/拒绝提示；idle 第一次仍提示“再按一次 Ctrl+C 退出”。
> 7. 补纯 formatter 测试：API/subscription/unknown、sub-percent context、真实余额、无余额、不同宽度；补 OpenTUI/静态合同锁定 status row 分区和永久快捷栏不含 Ctrl+C。
> 8. 更新 AGENTS/DEVELOPMENT-RULES/REPAIR-WORKFLOW：Repair 编号永不复用；用户提出冲突编号时自动选择下一个空闲编号并显式记录；历史业务模块后续 UI 优化必须引用来源编号但建立新 Repair ID。
> 9. 不修改 #03 scroll/sticky、#04 caret、#07 Plan/Permission、#09 Activity/Git Update；最终重新跑相关测试、Gate、Manifest、成品 ZIP 独立解压验证。

## 不允许回归

- Provider/Model/Ready/Reasoning 必须仍显示用户当前真实配置，不写死 DeepSeek。
- API balance、subscription quota、context window、费用仍来自真实 Provider telemetry / durable usage；unknown 就是 `—`。
- PromptDock 必须保持单一 `flexShrink=0` 原子；状态栏优化不能重新把 Transcript/Prompt 布局弄坏。
- Ctrl+C 有选区时仍必须复制而不是退出；无选区 busy/modal/idle 的 #08 路由不变。
- 快捷栏必须维持单行优先，不能为了展示低优先级说明产生显著换行。

## 验收条件

- 常见 Windows Terminal 宽度下，Prompt 主状态行可读为：`Build ... 上下文 ... 余额 ...   ● Provider · Model · 模型已就绪 · high`，且不换行。
- 第二指标行不再重复 model/context/balance，明显短于 #05/#07 旧布局。
- 永久快捷栏不显示 Ctrl+C；实际按 Ctrl+C 后才出现对应 transient 提示。
- API/套餐/unknown 三种 billing source 不产生假余额或假费用。
- #03/#04/#07/#08/#09 既有回归测试保持通过。


## #10 实施结果

- `session-status.ts` 新增 `sessionHeadlineItems()`，把真实 context used/window 与 API balance / subscription quota 投影为 Prompt 主状态摘要；常见宽度示例严格为 `上下文 0.2% · 1,793/1.0m · 余额 ¥12.02`，数据仍来自 #05 canonical metrics。
- `PromptDock` 主 Mode 行改为三段 ownership：Mode 固定左侧；中间/右侧可缩 headline metrics；最右 Provider/Model/Ready/Reasoning 固定 `flexShrink=0`。headline 先被裁，禁止挤掉 Provider truth；两组通过 3 列 padding 保持稳定间距。
- 原 `SessionStatusBar` 变成短 detail row：删除重复 model/context/balance；常见宽度只保留 billing、本轮 tokens、可用的真实会话费用、permission，宽屏才逐步增加会话 tokens/轮次/成本/命中率等。canonical telemetry 没有被删除。
- 永久 `hintItems` 已完全删除 Ctrl+C。实际 Ctrl+C 才给 transient feedback：复制成功/失败沿用 #08；busy 立即提示 `已请求中止当前任务`；approval modal 提示 `No · 当前操作未执行`；可取消 modal 提示 `已取消当前操作`；idle 首次仍提示二次 Ctrl+C 退出。
- Repair 编号规范已增强：冲突编号自动顺延为下一个未占用 ID；已有业务模块后续 UI/Host 优化引用来源编号但仍创建新 Repair ID。
- 定向自动验证：`session-status.test.ts + opentui-runtime.test.ts + terminal-shortcuts.test.ts` 共 41/41 PASS；关键 TS/TSX 使用 TypeScript transpile syntax check 全部 PASS；Runtime updater 2/2 PASS；Naming / Architecture / Distribution / Comments / Documentation / AI Context / Version / Windows / Repository 9/9 Gate PASS。Source Manifest 为 242 个受管源码文件。
- 成品发行复核：242 source + manifest = 243 ZIP entries；独立解压后 missing 0 / extra 0 / content hash diff 0，并从解压成品再次跑过定向 41/41、Runtime updater 2/2、9/9 Gate。
- Windows 实机仍需验证：常见/全屏宽度 headline 不挤 Provider、不换行；detail row 比旧版明显更短；Ctrl+C 不再长期出现在快捷栏且实际按键反馈正确。

# 11 Terminal 状态信息密度 / 用户消息高亮与 `[10]` Unicode 路径同步修复

- 状态：验证中
- 日期：2026-09-16
- 类型：Terminal Host UI 投影优化 / Windows Git Update 回归
- 影响范围：`PromptDock`、Session Metrics Terminal projection、Transcript user message、`xma-dev.bat -> [10]`
- 关联历史：#05 Session Runtime Metrics、#09 GitHub 原地同步、#10 状态栏分区布局

## 用户可见症状

1. #10 后 Prompt 主状态行仍显示 `● DeepSeek · deepseek-v4-pro · 模型已就绪 · high`；用户希望主状态行只保留真正需要持续查看的 `● deepseek-v4-pro · high`，并继续固定在最右侧。
2. #10 为缩短 detail row，把 cache hit、会话/本次 token、轮次等真实 telemetry 只留在较宽阈值下，用户在常见窗口看不到这些已经存在的 canonical metrics，误以为功能被删除。
3. 用户消息当前只是右侧小块深色 panel，视觉上仍不够明确；希望每条用户提问使用一行浅色/浅白背景强调“这是用户输入”，同时不影响 Transcript 滚动、assistant/activity 排版。
4. Windows 实机在含中文路径的 checkout（例如 `H:\一键部署\xma`）执行 `xma-dev.bat -> [10]` 时，在进入同步选择前抛出 `[IO.Path]::GetFullPath(...)` “路径中具有非法字符”，导致 GitHub 原地更新不可用。

## 已确认事实

- #05 `SessionRuntimeMetrics` 仍保存真实 `currentTurn/sessionUsage cache ratio`、会话/本次 tokens、turnCount、cost、permission；#10 只是 Terminal formatter 的宽度裁剪改变，没有删除 canonical metrics 数据。
- 当前 `session-status.ts` 在 `<170` 列时不会展示 cache hit；token 又使用 `k/m/b` compact formatter，因此不能呈现用户要求的精确大整数。
- 当前 durable context compaction **尚未实现**，canonical `metrics.compaction.available=false`；历史规则明确禁止把 `80%` 当 UI 常量伪造。此次只能在真实 threshold 存在时显示 `压缩阈值 <real>`，否则显示 `压缩阈值—`，不能为了视觉还原写死 80%。
- 当前 Prompt Provider group 的 `label` 来自 `providerLabel + Ready 文案`，因此会重复品牌 Provider 与“模型已就绪”；真实 model id 已存在于 canonical `sessionMetrics.identity.model`。
- `[10]` 当前在 `Assert-XmaGitCloneForUpdate()` 中把 `git rev-parse --show-toplevel` 的捕获文本直接传给 `[IO.Path]::GetFullPath($top)`。这是本次异常发生点；Git 输出在 Windows/Unicode/额外 native 输出场景下不应再作为 .NET path 字符串解析。

## 被证伪 / 禁止的错误修法

- 禁止从 Session Metrics Contract 删除 Provider/account/usage 字段；本轮只调整 Terminal 投影。
- 禁止写死 `DeepSeek`、`deepseek-v4-pro`、`80%`、token 数、余额或费用示例。
- 禁止为了显示“压缩阈值80%”伪造 compaction 已实现；真实 unavailable 必须仍可见为 `—`。
- 禁止把用户消息高亮实现成额外 ScrollBox / Overlay；Transcript 仍只有一个 scroll owner。
- 禁止 `[10]` 通过删除 clone、重新 clone、`git clean` 或绕过 origin/main 安全校验来“解决”路径异常。

## 修复 / 优化 Prompt

> 1. Prompt 主状态行保持 Mode 左侧、headline 中间、model group 最右；配置完成时 model group 只显示 readiness dot + canonical model id + reasoning，例如 `● deepseek-v4-pro · high`，删除 Provider display name 与“模型已就绪”常驻文案。未配置/凭据异常仍必须用 dot/明确提示表达异常状态。
> 2. `session-status.ts` 恢复常见宽度下的真实 telemetry：billing、本次命中、平均命中、会话 tokens、本次 tokens、compaction threshold、当前会话轮次、真实会话费用、permission。cache 百分比按两位小数显示；token 使用精确千分位整数，不用 k/m/b 缩写。
> 3. compaction 只消费 canonical `metrics.compaction`：`available=true + thresholdRatio` 才显示真实百分比；未实现时显示 `压缩阈值—`。不得写死 80%。
> 4. 用户 Transcript message 使用专用浅灰背景 token，默认单行提问视觉为一行高亮条；长内容仍允许正常换行，不能为了强制单行截断用户文本。保持右对齐与现有 content width ownership。
> 5. `[10]` 顶层仓库校验不得再把 `git --show-toplevel` 文本送入 `GetFullPath`。脚本已从自身位置解析 `$Root` 且运行前 `Set-Location $Root`，因此使用 `.git` marker + `git rev-parse --show-prefix`（根目录应为空）验证“当前脚本根就是 Git 顶层”，避免解析 Unicode path 输出；保留 branch=main 与 origin 白名单。
> 6. 新增/更新自动回归：Prompt 状态不再渲染 Provider display name/Ready 常驻文案；detail row 在常见宽度包含精确 cache/token/turn/compaction truth；unknown compaction 不出现 80%；Transcript user row 使用专用浅色背景；Windows Gate/静态合同禁止重新引入 `GetFullPath($top)`。
> 7. 按现有流程回填 UPDATE-LOG / PROJECT-STATUS，运行定向测试、Runtime updater、9 项 Gate、Source Manifest/ZIP 一致性检查。Windows PowerShell 5.1 的 `[10]` 中文路径仍标记为用户实机最终验收，不用 Linux 自动测试冒充。

## 不允许回归

- #03 Transcript bounded slot、mouse wheel、sticky follow。
- #04 OpenTUI Textarea caret / IME ownership。
- #05 canonical metrics “真实数据优先，unknown 即 unknown”。
- #08 Ctrl+C Selection copy 路由。
- #09 `[10]` 原地 fetch/pull/rebase、强制恢复备份、禁止 clone/clean。
- #10 PromptDock 单根 `flexShrink=0` 与 Provider/model group 右侧保护。

## 验收条件

- 常见 Windows Terminal 宽度主状态行形如：`Build  上下文 ... · 余额 ...    ● deepseek-v4-pro · high`；不再常驻显示 `DeepSeek` 与 `模型已就绪`。
- detail row 能看到真实 `本次命中0.00% · 平均命中0.00% · 会话 tokens63,112,938 · 本次 tokens198,157 · 压缩阈值—/真实值 · 当前会话35轮` 等字段；数值来自 canonical metrics。
- 当前 compaction 未实现时不会出现假的 `80%`；未来 canonical threshold 真正提供 0.8 时 formatter 自动显示 `80.00%`。
- 用户提问使用浅灰背景明确高亮；长提问仍完整可读，历史滚动/Assistant/Activity 不受影响。
- Windows 中文/Unicode checkout 执行 `[10]` 不再触发 `GetFullPath` 非法字符异常，并仍拒绝错误 origin、非 main、非 Git 顶层。
## #11 实施结果

- Prompt Provider status 正常态只消费 `sessionMetrics.identity.model`：绿色 `●` 表达 Ready，label 为 canonical model id，reasoning 继续由 PromptDock 独立追加；不再以 Provider displayName 作为回退，因此不会把 `DeepSeek` 品牌重新带回主状态。未配置/凭据异常分支仍明确显示异常。
- `session-status.ts` 恢复 #05 canonical cache/token/turn truth：cache hit 两位小数、session/turn token 精确千分位整数、turn count、费用/permission 按宽度保留；124~149 列优先使用用户可读的 `会话 tokens... / 本次 tokens... / 压缩阈值... / 当前会话...轮` 标签。SessionStatusBar 分隔符收紧为 ` · `，给真实指标留出横向空间。
- compaction 未伪造：当前 canonical `available=false` 时显示 `压缩阈值—`；测试额外锁定只有 `available=true, thresholdRatio=0.8` 才能显示 `80.00%`。这部分不是“删掉 80%”，而是遵守 #05 真实功能边界。
- Transcript 用户消息新增 `COLOR.userMessage=#d7d7d7` 与 `userMessageText=#181818`，短消息显示为右对齐浅灰单行高亮；长消息继续正常换行，未新增 ScrollBox/Overlay。
- `[10]` 已删除 `rev-parse --show-toplevel -> [IO.Path]::GetFullPath($top)` 路径解析，改为脚本自身 `$Root` 下 `.git` marker + `rev-parse --show-prefix` 顶层语义校验；main 分支、`yubboo/xma` origin whitelist、fetch/pull/reset/backup/no-clean 合同保持不变。PowerShell 文件继续保持 UTF-8 BOM + CRLF。
- 自动验证：`session-status.test.ts` 8/8、`opentui-runtime.test.ts` 34/34、`terminal-shortcuts.test.ts` 1/1，定向合计 43/43 PASS；Runtime updater 2/2 PASS；9 项静态 Gate 全部 PASS。
- 残留实机验收：当前环境没有 Windows PowerShell 5.1 / Windows Terminal，因此仍需在含中文 checkout 路径上执行 `xma-dev.bat -> [10]`，以及目视确认常见窗口主状态/metrics/user message 的最终宽度与对比度；在此之前状态保持“验证中”。

