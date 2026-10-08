#!/usr/bin/env node
/**
 * 伪装DNS.mjs —— 本机 DNS 被透明劫持（UDP/53 全被改写成运营商解析器）时的自保层
 * **只动 DNS 层，不改系统设置**（用户定过铁律：别碰他的 Private DNS）
 *
 * 三个能力：
 *   resolve <域名>        用 DoH 拿干净 IP（多个端点轮着试 → 成功就写进本地缓存）
 *   fetch <URL>           按缓存/DoH 的 IP 钉住再抓（等价 curl --resolve），失败自动试镜像
 *   check                 一屏看：系统解析器 / 各 DoH 通不通 / 缓存里有哪些
 *
 * 缓存文件：同目录 dns缓存.json（DoH 好的时候攒下来，DoH 被墙时继续用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'dns缓存.json');
/* curl：优先环境变量 → 常见 DSH 路径 → PATH 里的 curl（这份要上传 GitHub，所以不写死某一版） */
const CURL = (() => {
  const cands = [process.env.DNS_CURL, "/data/user/0/com.deepseek.harness.beta/files/payload/runtime/bin/curl",
    "/data/user/0/com.deepseek.harness/files/payload/runtime/bin/curl",
    "/data/user/0/com.deepseek.harness.compat/files/payload/runtime/bin/curl", "curl"].filter(Boolean);
  for (const c of cands) { try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch (e) {} }
  return "curl";
})();
const DOH = ['https://doh.pub/dns-query', 'https://223.5.5.5/dns-query', 'https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query', 'https://dns.google/dns-query'];
/* 被墙主机的镜像改写（DNS 修不好就直接换条路，这是实测最有效的） */
const MIRROR = [
  [/^https:\/\/raw\.githubusercontent\.com\/(.+)$/, ['https://cdn.jsdelivr.net/gh/$1', 'https://gh-proxy.com/https://raw.githubusercontent.com/$1']],
  [/^https:\/\/github\.com\/(.+)$/, ['https://gh-proxy.com/https://github.com/$1']],
];
const load = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } };
const save = (o) => { try { fs.writeFileSync(CACHE, JSON.stringify(o, null, 1)); } catch (e) {} };

function doh(host, endpoint) {
  const u = endpoint + '?name=' + encodeURIComponent(host) + '&type=A';
  try {
    const out = execFileSync(CURL, ['-s', '-k', '-m', '6', '-H', 'accept: application/dns-json', u], { encoding: 'utf8', maxBuffer: 1 << 20 });
    const j = JSON.parse(out);
    return (j.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
  } catch (e) { return []; }
}
function resolve(host) {
  const cache = load();
  for (const ep of DOH) {
    const ips = doh(host, ep);
    if (ips.length) { cache[host] = { ips, via: ep, at: new Date().toISOString() }; save(cache); return cache[host]; }
  }
  return cache[host] || null;                       /* DoH 全挂 → 用上次攒的 */
}
function curl(url, extra = []) {
  try {
    return { ok: true, out: execFileSync(CURL, ['-sSL', '-k', '-m', '40', ...extra, url], { encoding: 'utf8', maxBuffer: 64 << 20 }) };
  } catch (e) { return { ok: false, err: String(e.message).split('\n')[0].slice(0, 90) }; }
}
function curlResolved(url) {
  let h = ""; try { h = new URL(url).host; } catch (e) {}
  const rec = h ? resolve(h) : null;
  if (rec && rec.ips.length) return curl(url, ["--resolve", h + ":443:" + rec.ips[0]]);
  return curl(url);
}
function fetchUrl(url) {
  let host = ''; try { host = new URL(url).host; } catch (e) {}
  const rec = host ? resolve(host) : null;
  if (rec && rec.ips.length) {
    const ip = rec.ips[0];
    const r = curlResolved(url);
    if (r.ok && r.out.length) return { via: 'pin ' + ip, bytes: r.out.length, out: r.out };
  }
  for (const [re, reps] of MIRROR) {
    const m = url.match(re);
    if (!m) continue;
    for (const tpl of reps) {
      const mu = tpl.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
      const r = curlResolved(mu);
      if (r.ok && r.out.length) return { via: 'mirror ' + new URL(mu).host, bytes: r.out.length, out: r.out };
    }
  }
  const r = curlResolved(url);                            /* 最后直连试一次（也钉 IP） */
  if (r.ok && r.out.length) return { via: 'direct', bytes: r.out.length, out: r.out };
  return { via: 'fail', err: (r.err || '空响应') };
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'resolve') {
  const rec = resolve(arg);
  console.log(rec ? `${arg} → ${rec.ips.join(', ')}  (via ${rec.via}${rec.at ? ', cached ' + rec.at : ''})` : `${arg} → ❌ DoH 全不通，且缓存里没有`);
} else if (cmd === 'fetch') {
  const r = fetchUrl(arg);
  console.log(r.via === 'fail' ? `❌ ${arg} → ${r.err}` : `✅ ${arg} → ${r.bytes} 字节（via ${r.via}）`);
  if (process.env.SAVE_TO && r.out) { fs.writeFileSync(process.env.SAVE_TO, r.out); console.log('   已存 → ' + process.env.SAVE_TO); }
} else if (cmd === "on") {
  /* ← 用户口中的「打开DNS」= 跑这个：刷新干净解析 + 报状态（绝不碰系统设置） */
  const hosts = ["doh.pub", "registry.npmmirror.com", "api.github.com", "raw.githubusercontent.com", "cdn.jsdelivr.net", "data.jsdelivr.com", "unpkg.com", "registry.npmjs.org"];
  let ok = 0, via = "";
  for (const h of hosts) { const r = resolve(h); if (r) { ok++; if (!via) via = r.via; } }
  const live = DOH.filter((e) => doh("www.baidu.com", e).length);
  console.log("🔓 DNS 伪装已打开");
  console.log("  干净解析： " + (live.length ? live.join(" ") : "❌ 当前没有可用 DoH，改用缓存"));
  console.log("  域名缓存： " + ok + "/" + hosts.length + " 个（" + path.basename(CACHE) + "）");
  console.log("  UDP/53 ： 被透明劫持 → 明文解析器一律不用");
  console.log("  抓取用法：node 伪装DNS.mjs fetch \u003cURL\u003e   （钉 IP → 不通换镜像）");
} else if (cmd === "check") {
  const cache = load();
  console.log('缓存里的域名：');
  for (const [h, v] of Object.entries(cache)) console.log(`  ${h} → ${v.ips[0]}   (${v.via})`);
  console.log('DoH 端点：');
  for (const ep of DOH) { const ips = doh('www.baidu.com', ep); console.log(`  ${ips.length ? '✅' : '❌'} ${ep}`); }
} else {
  console.log('用法： node 伪装DNS.mjs resolve <域名> | fetch <URL> | check');
}
