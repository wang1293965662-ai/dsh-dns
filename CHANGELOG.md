# 更新记录 · dsh-dns（鲸鱼DNS · 别再裸奔）

## 1.0.0 — 2026-09-29
- 首个版本：`伪装DNS.mjs`（`on` / `resolve` / `fetch` / `check`）
- DoH 多端点轮询（`doh.pub` 优先）+ 解析结果本地缓存 + 镜像兜底（jsDelivr / gh-proxy）
- 引擎侧工具插件 `dsh-tool-netguard`（`dns_resolve` / `dns_pin_fetch` / `dns_leak_check`）源码随包
- 实测结论：UDP/53 透明劫持；境外 DoH 不可用；GitHub raw 属链路层封锁（DNS 无解）
