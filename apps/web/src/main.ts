/**
 * 文件作用：XMA Web Shell 的最小入口。
 * 关联模块：未来 App Server API 与统一 Agent Event Stream。
 * 当前实现：展示平台定位和 0.1.0 骨架状态。
 * 职责边界：Web 不复制 Agent Runtime；所有真正执行能力必须来自共享 Core/Server。
 */

import './style.css'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <section class="shell">
    <p class="eyebrow">XMA · 0.1.0</p>
    <h1>Xiaoyu Management Agent</h1>
    <p class="subtitle">模型可以更换，小鱼始终属于用户。</p>
    <div class="grid">
      <article><strong>Agent</strong><span>Minecraft · Code · Writer</span></article>
      <article><strong>Plugin</strong><span>XMA Native + DeepSeek Harness Compatible</span></article>
      <article><strong>Kernel</strong><span>TypeScript + Rust Native</span></article>
    </div>
    <p class="note">0.1.0 是平台骨架，真实模型与专业能力将在后续版本逐步接入。</p>
  </section>
`
