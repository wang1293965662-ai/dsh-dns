# dsh-dns · 鲸鱼DNS · 别再裸奔

> 手机/模拟器上 **UDP/53 被运营商透明劫持**时，用 **DoH** 拿干净解析、**把域名钉到指定 IP**
> 再抓取，失败自动换镜像。**只动 DNS 层，绝不改系统设置。**

> UDP/53 被劫持时，用 DoH 拿干净解析、把域名钉到 IP 再抓；只动 DNS 层，绝不碰系统设置。

适用于 [DeepSeek Harness](https://github.com/deepseek-ai) 这类跑在 Android 上的 agent 环境，
也适用于任何"系统 DNS 不干净、境外 DoH 又被墙"的场合。

## 它解决什么

| 现象 | 现实 |
|---|---|
| 换个明文 DNS（1.1.1.1 / 8.8.8.8 / 223.5.5.5）没用 | **UDP/53 被透明劫持**：所有明文解析器对外都呈现同一个运营商 IP |
| 想用 DoH | 境外 DoH（Cloudflare / Google / 1.1.1.1 / 8.8.8.8）**普遍被墙**；国内常见可用的是 **`doh.pub`**（腾讯）、`dns.alidns.com`（阿里） |
| 解析干净了还是连不上 | 那是**链路层**封锁（TLS/SNI 被重置），**DNS 层解决不了** —— 本工具会直接告诉你，而不是装作能行 |

## 装

```sh
sh 安装.sh                     # 装 SKILL.md + 工具；可选装 netguard 工具插件
sh 安装.sh --with-netguard      # 连引擎侧工具插件一起装（提供 dns_resolve / dns_pin_fetch / dns_leak_check）
```
（脚本会**自己推导** DSH_HOME，不写死版本；只在目标版本内写文件。）

## 用

```sh
node 伪装DNS.mjs on                     # = 用户口中的「打开DNS」：刷新干净解析 + 报状态
node 伪装DNS.mjs resolve api.github.com # 拿干净 IP（DoH，多端点轮询，成功即缓存）
node 伪装DNS.mjs fetch '<URL>'          # 先钉 IP 抓；不通自动走镜像；再不行直连
node 伪装DNS.mjs check                  # 各 DoH 端点活没活 + 缓存清单
```

镜像兜底（内置，可自行加）：

| 原始 | 兜底 |
|---|---|
| `raw.githubusercontent.com/...` | `cdn.jsdelivr.net/gh/...` → `gh-proxy.com/https://raw.githubusercontent.com/...` |
| `github.com/...` | `gh-proxy.com/https://github.com/...` |

## 约定：用户说「打开DNS」

> 原话：「以后我每次说打开DNS…意思就是让你重复刚才的操作。」

= 跑 `node 伪装DNS.mjs on`，然后**照旧不碰系统设置**；后续所有抓取走 `fetch`。

## 三条铁律

1. **不动系统设置**（Private DNS / VPN / hosts 一律不碰）——这是使用者的明确要求。
2. **明文解析器不用**（劫持之下毫无意义）。
3. **不吹牛**：DNS 通了不等于连得上；过不去就直说是链路层问题。

## 文件

```
伪装DNS.mjs    主工具（resolve / fetch / on / check；curl 路径自动探测）
SKILL.md       DSH 技能描述（给 AI 看的说明书：何时用、怎么用、铁律）
安装.sh        一键装进任意 DSH 版本
netguard/      引擎侧工具插件源码（dsh-tool-netguard：dns_resolve / dns_pin_fetch / dns_leak_check）
```

## 许可

MIT（见 LICENSE）。
