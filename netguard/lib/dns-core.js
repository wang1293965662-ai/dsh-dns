/**
 * dns-core — 「DNS 伪装 / 泄漏检测」的核心逻辑（零依赖，只用 node 内置模块）
 *
 * 为什么单独一个文件：不 import @deepseek-ai/dsh-tools，所以可以脱离 DSH 直接
 * `node dns-core.js selftest` 跑自检，方便排查。
 *
 * 本机（Android）实测事实，代码按这些事实写：
 *   1. Node 的 *系统* 解析只能走 `dns.promises.lookup()`（getaddrinfo）。
 *      `dns.getServers()` 只返回 127.0.0.1（netd 代理），c-ares 用它必然 ECONNREFUSED。
 *   2. 直接指定 UDP 解析器（Resolver#setServers）是通的，但 **UDP/53 被运营商透明劫持**：
 *      实测 1.1.1.1 / 8.8.8.8 / 223.5.5.5 / 114.114.114.114 对外呈现的解析器身份完全相同。
 *      所以「换 UDP 解析器」在本机是假的。
 *   3. DoH（HTTPS）没有被劫持，能拿到干净结果 —— 这才是真正可用的通道。
 *   4. `whoami.akamai.net` 的 A 记录 = 发起查询的*解析器*的 IP，是判断「谁在替你解析」的核心探针。
 *
 * 三件事：检测（解析器对外是谁）、解析（指定解析器/DoH）、伪装（域名钉 IP 再抓页面）。
 */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";

export const DEFAULT_TIMEOUT = 15000;

/** 解析器别名 → { kind, target } */
export const RESOLVERS = {
  system: { kind: "system", target: "系统解析器（getaddrinfo）" },
  "doh:cloudflare": { kind: "doh", target: "https://1.1.1.1/dns-query", label: "Cloudflare DoH" },
  "doh:google": { kind: "doh", target: "https://8.8.8.8/resolve", label: "Google DoH" },
  "doh:google-name": { kind: "doh", target: "https://dns.google/resolve", label: "Google DoH(域名)" },
  "doh:quad9": { kind: "doh", target: "https://9.9.9.9:5053/dns-query", label: "Quad9 DoH" },
  cloudflare: { kind: "udp", target: "1.1.1.1", label: "Cloudflare 1.1.1.1" },
  google: { kind: "udp", target: "8.8.8.8", label: "Google 8.8.8.8" },
  quad9: { kind: "udp", target: "9.9.9.9", label: "Quad9 9.9.9.9" },
  alidns: { kind: "udp", target: "223.5.5.5", label: "阿里 DNS 223.5.5.5" },
  dnspod: { kind: "udp", target: "119.29.29.29", label: "DNSPod 119.29.29.29" },
  cn114: { kind: "udp", target: "114.114.114.114", label: "114DNS" },
};

/** 探针：A 记录回显「谁在替你解析」 */
export const RESOLVER_IDENTITY_PROBE = "whoami.akamai.net";

const DOH_ACCEPT = { accept: "application/dns-json" };

/* ───────── HTTP 小工具 ───────── */

export async function httpText(url, { headers = {}, timeout = DEFAULT_TIMEOUT } = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  return { status: res.status, text };
}

export async function httpJson(url, opt) {
  try {
    const { status, text } = await httpText(url, opt);
    if (status < 200 || status >= 300) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function exitIp(timeout = DEFAULT_TIMEOUT) {
  for (const url of ["https://api.ipify.org", "https://ipinfo.io/ip", "https://ifconfig.me/ip"]) {
    try {
      const { status, text } = await httpText(url, { timeout });
      const ip = text.trim();
      if (status === 200 && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
    } catch { /* 换下一个源 */ }
  }
  return "";
}

export async function geoOf(ip, timeout = DEFAULT_TIMEOUT) {
  const empty = { country: "", countryCode: "", city: "", isp: "", asn: "", source: "" };
  if (!ip) return empty;
  const a = await httpJson("https://ipapi.co/" + ip + "/json/", { timeout });
  if (a && !a.error) {
    return {
      country: a.country_name || "",
      countryCode: a.country_code || a.country || "",
      city: a.city || "",
      isp: a.org || a.asn || "",
      asn: a.asn || "",
      source: "ipapi.co",
    };
  }
  const b = await httpJson("http://ip-api.com/json/" + ip + "?fields=status,country,countryCode,city,isp,as,query", { timeout });
  if (b && b.status === "success") {
    return {
      country: b.country || "",
      countryCode: b.countryCode || "",
      city: b.city || "",
      isp: b.isp || "",
      asn: b.as || "",
      source: "ip-api.com",
    };
  }
  return empty;
}

/* ───────── 解析器身份 ───────── */

export async function systemResolverIdentity() {
  try {
    const r = await dns.promises.lookup(RESOLVER_IDENTITY_PROBE, { family: 4 });
    return r && r.address ? r.address : "";
  } catch {
    return "";
  }
}

export async function udpResolverIdentity(server, timeout = 8000) {
  try {
    const r = new dns.promises.Resolver({ timeout, tries: 1 });
    r.setServers([server]);
    const list = await r.resolve4(RESOLVER_IDENTITY_PROBE);
    return list && list[0] ? list[0] : "";
  } catch {
    return "";
  }
}

export async function dohResolverIdentity(dohUrl, timeout = DEFAULT_TIMEOUT) {
  const rs = await dohResolve(RESOLVER_IDENTITY_PROBE, "A", dohUrl, timeout);
  return rs.answers[0] || "";
}

/* ───────── 解析 ───────── */

export async function udpResolve(name, type = "A", server = "1.1.1.1", timeout = 8000) {
  const started = Date.now();
  const r = new dns.promises.Resolver({ timeout, tries: 2 });
  if (server) r.setServers([server]);
  try {
    const list = await r.resolve(name, String(type).toUpperCase());
    return { answers: flattenAnswers(list), error: "", ms: Date.now() - started };
  } catch (e) {
    return { answers: [], error: String(e && (e.code || e.message) || e), ms: Date.now() - started };
  }
}

export async function dohResolve(name, type = "A", dohUrl = RESOLVERS["doh:cloudflare"].target, timeout = DEFAULT_TIMEOUT) {
  const started = Date.now();
  const sep = dohUrl.includes("?") ? "&" : "?";
  const url = dohUrl + sep + "name=" + encodeURIComponent(name) + "&type=" + encodeURIComponent(String(type).toUpperCase());
  try {
    const j = await httpJson(url, { headers: DOH_ACCEPT, timeout });
    if (!j) return { answers: [], error: "DoH 无响应", ms: Date.now() - started };
    const ans = Array.isArray(j.Answer) ? j.Answer.map((a) => String(a.data)) : [];
    const st = Number(j.Status || 0);
    return {
      answers: ans,
      error: st === 0 ? "" : "DNS Status=" + st + (st === 3 ? "（NXDOMAIN）" : ""),
      ms: Date.now() - started,
      status: st,
    };
  } catch (e) {
    return { answers: [], error: String(e && e.message || e), ms: Date.now() - started };
  }
}

export async function systemResolve(name, type = "A") {
  const started = Date.now();
  const t = String(type).toUpperCase();
  if (t !== "A" && t !== "AAAA") {
    return { answers: [], error: "系统解析只支持 A/AAAA（" + t + " 请改用 DoH 或 UDP 解析器）", ms: 0 };
  }
  try {
    const all = await dns.promises.lookup(name, { all: true, family: t === "A" ? 4 : 6 });
    const list = Array.isArray(all) ? all : [all];
    return { answers: list.map((x) => x.address).filter(Boolean), error: "", ms: Date.now() - started };
  } catch (e) {
    return { answers: [], error: String(e && (e.code || e.message) || e), ms: Date.now() - started };
  }
}

export async function resolveWith(name, type = "A", resolver = "doh:cloudflare", timeout = DEFAULT_TIMEOUT) {
  const key = String(resolver || "").trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(key)) {
    const r = await udpResolve(name, type, key, 8000);
    return { ...r, resolver: key, kind: "udp", label: "UDP " + key };
  }
  if (/^https?:\/\//i.test(key)) {
    const r = await dohResolve(name, type, key, timeout);
    return { ...r, resolver: key, kind: "doh", label: key };
  }
  const spec = RESOLVERS[key];
  if (!spec) {
    const r = await systemResolve(name, type);
    return { ...r, resolver: "system", kind: "system", label: "未知别名「" + key + "」，回退系统解析" };
  }
  if (spec.kind === "system") {
    const r = await systemResolve(name, type);
    return { ...r, resolver: "system", kind: "system", label: spec.target };
  }
  if (spec.kind === "doh") {
    const r = await dohResolve(name, type, spec.target, timeout);
    return { ...r, resolver: key, kind: "doh", label: spec.label || spec.target };
  }
  const r = await udpResolve(name, type, spec.target, 8000);
  return { ...r, resolver: key, kind: "udp", label: spec.label || spec.target };
}

function flattenAnswers(list) {
  if (!Array.isArray(list)) return list ? [String(list)] : [];
  return list.map((x) => {
    if (typeof x === "string") return x;
    if (Array.isArray(x)) return x.join("");
    if (x && typeof x === "object") {
      if (x.exchange) return ((x.priority === undefined ? "" : x.priority) + " " + x.exchange).trim();
      if (x.ns) return String(x.ns);
      if (x.address) return String(x.address);
      return JSON.stringify(x);
    }
    return String(x);
  });
}

/* ───────── 域名钉 IP 抓取 ───────── */

function pinnedLookup(ip) {
  const family = ip.includes(":") ? 6 : 4;
  return (hostname, options, cb) => {
    const wantAll = options && typeof options === "object" && options.all;
    if (wantAll) cb(null, [{ address: ip, family }]);
    else cb(null, ip, family);
  };
}

export function pinnedRequest(url, {
  ip,
  method = "GET",
  headers = {},
  maxBytes = 20000,
  timeout = DEFAULT_TIMEOUT,
  maxRedirects = 3,
} = {}) {
  return new Promise((resolve) => {
    const redirects = [];
    let left = maxRedirects;

    const attempt = (target) => {
      let u;
      try {
        u = new URL(target);
      } catch (e) {
        return resolve({ ok: false, status: 0, headers: {}, body: "", error: "URL 无效：" + e.message, redirects, finalUrl: target });
      }
      const mod = u.protocol === "http:" ? http : https;
      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search,
        method: String(method || "GET").toUpperCase(),
        servername: u.hostname,
        headers: { "user-agent": "Mozilla/5.0 (Linux; Android 14)", ...headers },
      };
      if (ip) opts.lookup = pinnedLookup(ip);

      const req = mod.request(opts, (res) => {
        const loc = res.headers && res.headers.location;
        if (left > 0 && [301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
          left -= 1;
          res.resume();
          let next;
          try {
            next = new URL(loc, target).toString();
          } catch {
            next = loc;
          }
          redirects.push(res.statusCode + " → " + next);
          return attempt(next);
        }
        let body = "";
        let truncated = false;
        res.setEncoding("utf8");
        res.on("data", (c) => {
          if (body.length >= maxBytes) { truncated = true; return; }
          body += c.slice(0, maxBytes - body.length);
        });
        res.on("end", () => resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode || 0,
          headers: res.headers || {},
          body: truncated ? body + "\n…（已截断）" : body,
          error: "",
          redirects,
          finalUrl: target,
        }));
      });

      req.setTimeout(timeout, () => {
        req.destroy();
        resolve({ ok: false, status: 0, headers: {}, body: "", error: "请求超时（" + timeout + "ms）", redirects, finalUrl: target });
      });
      req.on("error", (e) => resolve({ ok: false, status: 0, headers: {}, body: "", error: String(e && e.message || e), redirects, finalUrl: target }));
      req.end();
    };

    attempt(url);
  });
}

/* ───────── 高层：泄漏体检 ───────── */

export async function leakCheck(expectCountry = "US") {
  const expect = String(expectCountry || "US").toUpperCase();

  const [ip, sysRes] = await Promise.all([exitIp(), systemResolverIdentity()]);
  const [udpA, udpB] = await Promise.all([
    udpResolverIdentity(RESOLVERS.cloudflare.target),
    udpResolverIdentity(RESOLVERS.alidns.target),
  ]);
  const dohRes = await dohResolverIdentity(RESOLVERS["doh:cloudflare"].target);

  const [geoExit, geoSys, geoDoh] = await Promise.all([geoOf(ip), geoOf(sysRes), geoOf(dohRes)]);

  const hijacked = !!sysRes && !!udpA && sysRes === udpA && udpA === udpB;
  const sysCc = (geoSys.countryCode || "").toUpperCase();
  const exitCc = (geoExit.countryCode || "").toUpperCase();

  let verdict = "unknown";
  const problems = [];
  if (sysCc && sysCc !== expect) {
    verdict = "leak";
    problems.push("系统解析器对外呈现为 " + sysCc + "（" + (geoSys.country || "?") + "），与期望的 " + expect + " 不符");
  }
  if (hijacked) {
    if (verdict !== "leak") verdict = "suspect";
    problems.push("所有明文 UDP 解析器对外身份完全相同 → UDP/53 被网络透明劫持，换 UDP 解析器无效");
  }
  if (verdict === "unknown" && sysCc && sysCc === expect) verdict = "clean";
  if (exitCc && exitCc !== expect) {
    problems.push("出口 IP 归属 " + exitCc + "（" + (geoExit.country || "?") + "），与期望的 " + expect + " 不符");
    if (verdict === "clean") verdict = "suspect";
  }

  return {
    expectCountry: expect,
    exitIp: ip,
    exitGeo: geoExit,
    systemResolverIp: sysRes,
    systemResolverGeo: geoSys,
    udpResolverIps: { cloudflare: udpA, alidns: udpB },
    udpHijacked: hijacked,
    dohResolverIp: dohRes,
    dohResolverGeo: geoDoh,
    verdict,
    problems,
  };
}

/* ───────── 自检 ───────── */

if (process.argv[1] && process.argv[1].endsWith("dns-core.js") && process.argv.includes("selftest")) {
  const line = (s) => process.stdout.write(s + "\n");
  (async () => {
    line("=== dns-core 自检 ===");
    line("出口 IP: " + (await exitIp()));
    line("系统解析器身份: " + (await systemResolverIdentity()));
    line("UDP 1.1.1.1 身份: " + (await udpResolverIdentity("1.1.1.1")));
    line("UDP 223.5.5.5 身份: " + (await udpResolverIdentity("223.5.5.5")));
    line("DoH(1.1.1.1) 身份: " + (await dohResolverIdentity(RESOLVERS["doh:cloudflare"].target)));
    line("DoH 解析 x.com: " + JSON.stringify(await resolveWith("x.com", "A", "doh:cloudflare")));
    line("UDP 解析 x.com: " + JSON.stringify(await resolveWith("x.com", "A", "cloudflare")));
    const p = await pinnedRequest("https://x.com/", { ip: "172.66.0.227", method: "HEAD" });
    line("钉 IP 抓取 x.com: status=" + p.status + " err=" + p.error);
    line("=== 完 ===");
  })();
}
