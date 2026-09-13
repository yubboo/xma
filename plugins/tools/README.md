# 通用 Tool Plugins

这里放跨多个 Agent 复用的 Tool Adapter，例如 Native FS/Process、Git、SSH、Browser、Docker。

当前 `native.ts` 是第一条真实副作用桥：它只通过 `core/src/native.ts` 申请最小 Rust Capability，再由 `native/runtime` 二次 enforcement；禁止为了方便改成 Node `fs` / `child_process` 直接执行。写入与进程工具仍必须经过 ToolRouter Policy/Approval。

只有真正可以被多个 Agent 复用的 Tool 才放这里；Minecraft/Writer 等领域 Tool 跟随对应 Agent 或领域插件，不能把业务规则塞进通用 Tool。
