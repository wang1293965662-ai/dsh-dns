#!/data/data/com.termux/files/usr/bin/bash
# 在 Termux 里跑这一条，就把 dsh-dns 推上 GitHub（幂等，可反复跑）
#   用法： sh /sdcard/工作区Lite/github-dsh-dns/git-push.sh
#   首次会要你输 GitHub 用户名 + 一个 Personal Access Token（当密码用；不是账号密码）
set -e
REPO="${REPO:-https://github.com/wang1293965662-ai/dsh-dns.git}"
cd "$(dirname "$0")"
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main
git config user.name  >/dev/null 2>&1 || git config user.name  "wang1293965662-ai"
git config user.email >/dev/null 2>&1 || git config user.email "wang1293965662-ai@users.noreply.github.com"
git add -A
git commit -m "dsh-dns 1.0.0: DoH clean resolution + IP pinning + mirror fallback" || echo "（没有新改动，跳过 commit）"
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO"
git branch -M main
echo "→ 开始推送（用户名填 wang1293965662-ai，密码填 Token）"
git push -u origin main
echo "✅ 推完了：$REPO"
