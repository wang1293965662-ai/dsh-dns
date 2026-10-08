#!/system/bin/sh
# 把 dsh-dns 装进任意一个 DSH 版本（幂等）。用法：
#   sh 安装.sh [目标版本 files 目录] [--with-netguard]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
T=""; WITH_NG=0
for a in "$@"; do
  case "$a" in --with-netguard) WITH_NG=1;; *) T="$a";; esac
done
if [ -z "$T" ]; then
  for c in /data/user/0/com.deepseek.harness.beta/files /data/user/0/com.deepseek.harness/files /data/user/0/com.deepseek.harness.compat/files; do
    [ -d "$c/payload/dshhome" ] && T="$c" && break
  done
fi
[ -n "$T" ] && [ -d "$T/payload/dshhome" ] || { echo "❌ 找不到目标版本（传 <...>/files）"; exit 1; }
H="$T/payload/dshhome"
NODE="$T/payload/runtime/bin/node"; [ -x "$NODE" ] || NODE=node
echo "① SKILL.md → $H/skills/dsh-dns/"
mkdir -p "$H/skills/dsh-dns"; cp -f "$HERE/SKILL.md" "$H/skills/dsh-dns/SKILL.md"
echo "② 工具 → $H/skills/dsh-dns/伪装DNS.mjs"
cp -f "$HERE/伪装DNS.mjs" "$H/skills/dsh-dns/伪装DNS.mjs"
if [ "$WITH_NG" = "1" ] && [ -d "$HERE/netguard/lib" ]; then
  echo "③ netguard 工具插件 → profiles/node_modules/dsh-tool-netguard"
  NG="$H/profiles/node_modules/dsh-tool-netguard"; mkdir -p "$NG/lib"
  cp -f "$HERE/netguard/package.json" "$NG/package.json"
  cp -f "$HERE/netguard/lib/"*.js "$NG/lib/"
  "$NODE" -e '
const fs=require("fs");const f=process.env.H+"/cordis.patch.yml";let s=fs.readFileSync(f,"utf8");
if(s.includes("tool-netguard")){console.log("   已有注册，跳过");process.exit(0);}
const re=/( {4}- id: tool-vscreen\n {6}name: )["\x27]?(@deepseek-ai\/dsh-tool-vscreen)["\x27]?\n/;
if(!re.test(s)){console.log("   ⚠ 找不到 tool-vscreen 锚点，请手动加：- id: tool-netguard / name: dsh-tool-netguard");process.exit(0);}
fs.writeFileSync(f,s.replace(re,(m)=>m+"    - id: tool-netguard\n      name: dsh-tool-netguard\n"));console.log("   已注册 tool-netguard（热加载）");' H="$H" 2>/dev/null || H="$H" "$NODE" -e 'process.exit(0)'
fi
echo "✅ 完成。用法："
echo "   $NODE '$H/skills/dsh-dns/伪装DNS.mjs' on"
