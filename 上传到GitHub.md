# 上传流程（第一次照这个走，5 分钟）

## 名字与门面（建仓库时照着填）

| 项 | 填什么 |
|---|---|
| Repository name | **dsh-dns** |
| Description（About） | UDP/53 被劫持时，用 DoH 拿干净解析、把域名钉到 IP 再抓；只动 DNS 层，绝不碰系统设置。 |
| Website | 留空 |
| Topics | `dsh` `dns` `doh` `dns-over-https` `android` `deepseek-harness` `agent-tools` `anti-hijack` |
| 显示昵称 | 鲸鱼DNS · 别再裸奔（写在 README 第一行，仓库名仍是 dsh-dns） |


> 目标仓库：`https://github.com/wang1293965662-ai/dsh-dns`
> 手机上的 git 在 **Termux** 里；本包目录：`/sdcard/工作区Lite/github-dsh-dns/`

## 0. 前置（只做一次）

```sh
# ① Termux 里先给存储权限（否则读不到 /sdcard）
termux-setup-storage          # 弹窗点允许

# ② 网络：GitHub 是链路层被拦，DNS 修不了 —— 必须先开梯子
#    开完在 Termux 里验一下，能看到 IP 再往下走：
curl -s https://api.ip.sb/ip

# ③ 身份（二选一，推荐 gh）
pkg install gh        # 或者：pkg install git  （git 一般已自带）
gh auth login         # 选 GitHub.com → HTTPS → 用浏览器登录（一次即可）
```

> 没有 gh 也行：用 Personal Access Token 当密码（Settings → Developer settings → Tokens，勾 `repo`）。

## 1. 进包目录、本地成库

```sh
cd /sdcard/工作区Lite/github-dsh-dns
git init -b main
git add -A
git commit -m "dsh-dns 1.0.0: DoH clean resolution + IP pinning + mirror fallback"
```

**成功长这样**：`4 files changed...` 之类的统计；报 `nothing to commit` 说明已经提交过了，继续下一步。

## 2A. 有 gh：一条命令建仓库 + 推

```sh
gh repo create dsh-dns --public --source=. --push
```

**成功**：终端打印 `✓ Created repository wang1293965662-ai/dsh-dns` + `✓ Pushed`；浏览器打开仓库能看到文件。

## 2B. 只有 git：先网页建空仓库，再推

1. 浏览器开 `https://github.com/new` → 名字 `dsh-dns` → **不要勾** Add a README → Create
2. 回到 Termux：

```sh
git remote add origin https://github.com/wang1293965662-ai/dsh-dns.git
git push -u origin main
# 提示 Username：填 wang1293965662-ai
# 提示 Password：贴 Token（不是账号密码，粘贴时不显示是正常的）
```

## 3. 之后每次改动

```sh
cd /sdcard/工作区Lite/github-dsh-dns
git add -A && git commit -m "改了什么" && git push
```

## 一键脚本（懒人版）

```sh
sh /sdcard/工作区Lite/github-dsh-dns/git-push.sh          # 默认仓库名 dsh-dns
REPO=https://github.com/wang1293965662-ai/别的名字.git sh .../git-push.sh
```

## 常见卡点

| 现象 | 原因 / 解决 |
|---|---|
| `Could not resolve host: github.com` | 梯子没开 / 只代理了部分 App → 开全局或把 Termux 加进代理名单 |
| `Permission denied (publickey)` | 用的是 SSH 地址但没配 key → 改用 HTTPS 地址 |
| `Authentication failed` | 密码处填了账号密码 → 改成 **Token** |
| `! [rejected] ... fetch first` | 网页建仓库时勾了 README → `git pull --rebase origin main` 再 push |
| `src refspec main does not match any` | 没 commit 成功 → 回到第 1 步看报错 |
