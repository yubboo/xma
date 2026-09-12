# Workspace 隔离与安全边界

专业 Agent 默认只能操作当前 Workspace。XMA 配置、Provider Secret、其他 Agent Workspace 和 Native Managed Runtime 不属于普通文件 Tool 的默认根目录。

权限原则：**最大化模型推理自由，最小化默认副作用范围。**

模型可以自由判断“应该删除哪个文件”，但真正执行仍必须经过 Tool → Permission/Approval → Native Capability → Rust Enforcement。
