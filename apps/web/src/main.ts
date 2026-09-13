/**
 * 文件作用：XMA Web / Desktop 共享中文界面入口，提供 0.1.0 平台骨架的真实状态总览。
 * 关联模块：apps/desktop、未来 App Server API 与统一 Agent Event Stream。
 * 当前实现：展示中文平台工作台、Agent/Plugin/Native 状态以及尚未接入能力的明确提示。
 * 职责边界：Web 不复制 Agent Runtime；未实现的 Provider/专业能力不得用假按钮伪装完成。
 */

import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('XMA Web Shell 缺少 #app 根节点')

app.innerHTML = `
  <div class="desktop-shell">
    <aside class="sidebar" aria-label="XMA 主导航">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">鱼</div>
        <div>
          <strong>小鱼管理智能体</strong>
          <span>XMA · 0.1.0</span>
        </div>
      </div>

      <nav class="nav-list">
        <button class="nav-item is-active" type="button"><span>总览</span><small>当前</small></button>
        <button class="nav-item" type="button" disabled><span>Agent</span><small>骨架</small></button>
        <button class="nav-item" type="button" disabled><span>工作区</span><small>开发中</small></button>
        <button class="nav-item" type="button" disabled><span>插件</span><small>基础能力</small></button>
        <button class="nav-item" type="button" disabled><span>设置</span><small>后续接入</small></button>
      </nav>

      <div class="sidebar-note">
        <span class="status-dot"></span>
        <div><strong>Desktop 已启动</strong><small>Electron 41.2.0 主运行时</small></div>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">平台总览</p>
          <h1>欢迎使用小鱼管理智能体</h1>
        </div>
        <div class="version-pill">0.1.0 · 平台骨架期</div>
      </header>

      <main class="content">
        <section class="hero-card">
          <div>
            <span class="hero-kicker">XIAOYU MANAGEMENT AGENT</span>
            <h2>模型可以更换，<br />小鱼始终属于用户。</h2>
            <p>当前版本正在打通 Agent Runtime、Plugin Host、Workspace 与 Native Kernel。真实模型 Provider 与专业 Agent 产品闭环尚未完成。</p>
          </div>
          <div class="hero-badge" aria-hidden="true">XMA</div>
        </section>

        <section class="status-grid" aria-label="平台能力状态">
          <article class="status-card">
            <div class="card-head"><span>推理核心</span><span class="tag pending">尚未接入</span></div>
            <h3>真实模型 Provider</h3>
            <p>OpenAI / Claude / Gemini / DeepSeek / MiMo 等真实 Provider 仍在开发计划中。</p>
          </article>
          <article class="status-card">
            <div class="card-head"><span>Agent 身份</span><span class="tag ready">骨架已存在</span></div>
            <h3>Minecraft · Code · Writer</h3>
            <p>当前只有专业身份与基础目录边界，不宣称已经具备完整产品能力。</p>
          </article>
          <article class="status-card">
            <div class="card-head"><span>插件系统</span><span class="tag ready">基础可用</span></div>
            <h3>XMA Native + DSH 兼容层</h3>
            <p>已具备 Service、inject、apply(ctx)、effect/disposer 和基础事件语义。</p>
          </article>
          <article class="status-card">
            <div class="card-head"><span>Native Kernel</span><span class="tag ready">骨架已存在</span></div>
            <h3>TypeScript + Rust</h3>
            <p>TypeScript 决定做什么；Rust 负责 Native / Security / Performance 边界。</p>
          </article>
        </section>

        <section class="notice-card">
          <div class="notice-icon">i</div>
          <div>
            <strong>这是 0.1.0 平台骨架，不是功能已经全部完成的正式产品版。</strong>
            <p>界面会随着真实 Provider、Workspace、Tool、Memory、专业 Agent 闭环逐步开放。当前禁用项代表能力尚未完成，而不是程序故障。</p>
          </div>
        </section>
      </main>
    </section>
  </div>
`
