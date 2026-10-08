---
name: dsh-dns
description: Use when the device's DNS is poisoned or transparently hijacked (UDP/53 rewritten by the carrier) and fetches fail — 打开DNS / DNS伪装 / 解析被污染 / 换个干净DNS再抓页面 / DoH / 钉IP绕开污染. Provides DoH-based clean resolution, IP pinning, mirror fallback and a DNS leak check, WITHOUT touching any system setting.
---

# DNS 伪装（只动 DNS 层）

> 使用者一句话对应一条命令：他说「**打开DNS**」= 跑下面这条，然后照旧**不碰系统设置**。

```sh
node 伪装DNS.mjs on        # 刷新干净解析 + 报状态（= 打开DNS）
node 伪装DNS.mjs fetch '<URL>'   # 之后的抓取都走它：先钉 IP → 不通换镜像
```

## 什么时候用

- 抓取报 `Could not resolve host` / `ENOTFOUND`，或解析出来的 IP 明显不对
- 明明网络是通的（国内站点 200），但目标域名解析不动
- 用户说「打开DNS」

## 环境事实（实测，别重试这些）

| 结论 | 说明 |
|---|---|
| UDP/53 **被透明劫持** | 系统解析器与 1.1.1.1 / 8.8.8.8 / 223.5.5.5 对外呈现**同一个运营商 IP** → 换明文解析器无效 |
| 境外 DoH 基本不通 | Cloudflare / Google / 1.1.1.1 / 8.8.8.8 常被 TLS 重置；**国内 `doh.pub` 最稳**，`dns.alidns.com` 次之 |
| curl 自带 `--doh-url` | Android 上常见 bootstrap/TLS 失败，**别依赖**；用本工具的「解析后 `--resolve` 钉 IP」 |
| 钉 IP 仍失败 | 那是**链路层封锁**（如 GitHub raw 的 TLS 重置）→ 换镜像，或直说做不到 |

## 铁律

1. **绝不改系统设置**（Private DNS / VPN / hosts）——用户明确禁止。
2. 明文 UDP 解析器一律不用。
3. 区分"解析不对"和"连不上"：前者我们能修，后者不能。
4. 抓取结果落盘再用 node 过滤，别把大 JSON/HTML 灌进上下文。
