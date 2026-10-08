/**
 * dsh-tool-netguard — DNS 伪装 / 泄漏检测工具插件
 *
 * 给每个会话三件能力：
 *   1. dns_leak_check  体检：解析器和出口对外呈现成哪个国家（有没有暴露 CN）
 *   2. dns_resolve     用指定解析器 / DoH / 系统解析域名，可横向对比多个解析器看是否被污染
 *   3. dns_pin_fetch   把域名钉到指定 IP 再抓页面（等价 curl --resolve），绕开被劫持的解析
 *
 * 全部零依赖，只用 node 内置模块（核心逻辑在 ./dns-core.js）。
 * 挂载方式：dshhome/cordis.patch.yml 的 insert 列表里加
 *   - id: tool-netguard
 *     name: 'dsh-tool-netguard'
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  leakCheck, resolveWith, pinnedRequest, RESOLVERS,
  RESOLVER_IDENTITY_PROBE, systemResolverIdentity, udpResolverIdentity,
  dohResolverIdentity, exitIp,
} from "./dns-core.js";

const name = "tool-netguard";
const inject = ["tools"];

const RESOLVER_HELP =
  "解析器可选：doh:cloudflare（默认，1.1.1.1 DoH）、doh:google、doh:google-name、doh:quad9、" +
  "cloudflare(1.1.1.1)、google(8.8.8.8)、quad9、alidns(223.5.5.5)、dnspod、cn114、system（系统解析，仅 A/AAAA），" +
  "也可以直接填解析器 IP（如 1.2.3.4）或完事的 DoH URL（如 https://1.1.1.1/dns-query）。";

function apply(ctx) {
  /* ── 1. DNS 泄漏体检 ── */
  ctx.tools.register(defineTool({
    name: "dns_leak_check",
    description:
      "体检本机 DNS 是不是在「裸奔」：查看系统解析器、明文 UDP 解析器、DoH 解析器各自对外呈现成哪个国家/运营商，" +
      "以及出口 IP 归属。用于判断「用 Claude / 国外账号时，DNS 有没有把 CN 身份暴露出去」。" +
      "原理：whoami.akamai.net 的 A 记录会回显发起查询的解析器 IP —— 这是判断谁在替你解析的核心探针。" +
      "注意本机实测：明文 UDP/53 会被运营商透明劫持（换 1.1.1.1 也没用），只有 DoH 是干净的。",
    parameters: {
      expect_country: {
        type: "string",
        description: "期望的出口国家两位码，默认 US。解析器或出口落到别的国家就报出来。",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          verdict: { type: "string" },
          expect_country: { type: "string" },
          exit_ip: { type: "string" },
          exit_country: { type: "string" },
          system_resolver_ip: { type: "string" },
          system_resolver_geo: { type: "string" },
          udp_hijacked: { type: "boolean" },
          doh_resolver_ip: { type: "string" },
          doh_resolver_geo: { type: "string" },
          problems: { type: "string" },
          summary: { type: "string" },
        },
      },
      render: (_args, v) => [{ type: "text", text: v.summary || "体检失败" }],
    },
    async execute(args) {
      const expect = String(args.expect_country || "US").toUpperCase();
      try {
        const r = await leakCheck(expect);

        const verdictText =
          r.verdict === "clean" ? "✅ 干净：解析器与出口都在期望国家"
          : r.verdict === "leak" ? "🚨 泄漏：DNS 暴露了非期望国家"
          : r.verdict === "suspect" ? "⚠️ 可疑：有异常项，见下"
          : "❔ 未知：探测数据不全";

        const lines = [
          verdictText,
          "",
          "出口 IP        " + (r.exitIp || "(取不到)") + "  " + cc(r.exitGeo),
          "系统解析器     " + (r.systemResolverIp || "(取不到)") + "  " + cc(r.systemResolverGeo),
          "UDP 1.1.1.1    " + (r.udpResolverIps.cloudflare || "(取不到)"),
          "UDP 223.5.5.5  " + (r.udpResolverIps.alidns || "(取不到)"),
          "DoH 出口       " + (r.dohResolverIp || "(取不到)") + "  " + cc(r.dohResolverGeo),
          "",
          "UDP/53 透明劫持：" + (r.udpHijacked ? "是 🚨（换明文解析器无效）" : "未发现"),
        ];
        if (r.problems.length) lines.push("", "问题：", ...r.problems.map((p) => "  · " + p));
        lines.push(
          "",
          (r.udpHijacked
            ? "结论：明文 UDP 解析被强制走同一个解析器（当前对外呈现 " + (cc(r.systemResolverGeo) || "未知") + "），换任何明文 UDP 解析器都无效。"
            : "结论：未发现 UDP 解析被劫持。") +
          "想让解析走指定出口，只能用 DoH —— 用 dns_resolve 且 resolver=doh:cloudflare，或用 dns_pin_fetch 直接钉 IP。"
        );

        return {
          ok: true,
          verdict: r.verdict,
          expect_country: expect,
          exit_ip: r.exitIp,
          exit_country: cc(r.exitGeo),
          system_resolver_ip: r.systemResolverIp,
          system_resolver_geo: cc(r.systemResolverGeo),
          udp_hijacked: r.udpHijacked,
          doh_resolver_ip: r.dohResolverIp,
          doh_resolver_geo: cc(r.dohResolverGeo),
          problems: r.problems.join("；"),
          summary: lines.join("\n"),
        };
      } catch (e) {
        return {
          ok: false, verdict: "error", expect_country: expect,
          exit_ip: "", exit_country: "", system_resolver_ip: "", system_resolver_geo: "",
          udp_hijacked: false, doh_resolver_ip: "", doh_resolver_geo: "",
          problems: String(e && e.message || e),
          summary: "体检出错：" + String(e && e.message || e),
        };
      }
    },
  }));

  /* ── 2. 指定解析器解析 ── */
  ctx.tools.register(defineTool({
    name: "dns_resolve",
    description:
      "解析域名，可以指定用哪个解析器（系统 / 明文 UDP / DoH），用来绕过被劫持的系统 DNS、拿到干净结果。" +
      "compare=true 时会横向对比多个解析器，用来判断某个域名是不是被污染（各解析器结果不一致）。" +
      RESOLVER_HELP,
    parameters: {
      name: { type: "string", required: true, description: "要解析的域名，如 x.com" },
      type: { type: "string", description: "记录类型：A（默认）、AAAA、CNAME、MX、TXT、NS、PTR、SOA、SRV、CAA、ANY" },
      resolver: { type: "string", description: "用哪个解析器（见工具描述）。默认 doh:cloudflare" },
      compare: { type: "boolean", description: "true = 同时用多个解析器解析并对比，判断是否被污染" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          name: { type: "string" },
          type: { type: "string" },
          resolver: { type: "string" },
          answers: { type: "string" },
          note: { type: "string" },
        },
      },
      render: (_args, v) => [{ type: "text", text: v.note || "" }],
    },
    async execute(args) {
      const host = String(args.name || "").trim();
      const rtype = String(args.type || "A").toUpperCase();
      if (!host) {
        return { ok: false, name: "", type: rtype, resolver: "", answers: "", note: "缺少 name 参数" };
      }

      try {
        if (args.compare) {
          const list = ["doh:cloudflare", "doh:google", "cloudflare", "google", "alidns", "system"];
          const results = await Promise.all(list.map(async (k) => {
            const r = await resolveWith(host, rtype, k);
            return { k, r };
          }));
          const rows = results.map(({ k, r }) =>
            "  " + k.padEnd(16) + (r.error ? "ERR " + r.error : (r.answers.join(", ") || "(空)")));
          const uniq = new Set(results.map(({ r }) => r.error ? "ERR" : r.answers.slice().sort().join(",")));
          const polluted = uniq.size > 1;
          const note =
            "对比解析 " + host + " (" + rtype + ")：\n" + rows.join("\n") + "\n\n" +
            (polluted
              ? "⚠️ 各解析器结果不一致 —— 存在污染/劫持或 CDN 就近解析差异（DoH 结果更可信）。"
              : "✅ 各解析器结果一致。");
          return {
            ok: true, name: host, type: rtype, resolver: "compare",
            answers: rows.join("\n"), note,
          };
        }

        const r = await resolveWith(host, rtype, args.resolver || "doh:cloudflare");
        const note =
          "解析 " + host + " (" + rtype + ") 用 " + (r.label || r.resolver) + "：\n" +
          (r.error ? "❌ " + r.error : (r.answers.length ? r.answers.map((a) => "  " + a).join("\n") : "（无记录）")) +
          (r.ms !== undefined ? "\n（" + r.ms + "ms）" : "");
        return {
          ok: !r.error,
          name: host,
          type: rtype,
          resolver: r.resolver,
          answers: r.answers.join("\n"),
          note,
        };
      } catch (e) {
        const m = String(e && e.message || e);
        return { ok: false, name: host, type: rtype, resolver: String(args.resolver || ""), answers: "", note: "解析出错：" + m };
      }
    },
  }));

  /* ── 3. 域名钉 IP 抓取 ── */
  ctx.tools.register(defineTool({
    name: "dns_pin_fetch",
    description:
      "把域名钉到指定 IP 再请求（等价 curl --resolve host:port:ip）：绕开被劫持/被污染的 DNS，直接用你指定的 IP 访问。" +
      "TLS 的 SNI 与证书校验仍用真实域名，所以「伪装的只是解析结果，不是服务器身份」——证书不对会直接报错。" +
      "典型用法：先用 dns_resolve（resolver=doh:google）拿到正确 IP，再用本工具钉住它抓页面。" +
      "不填 ip 时就是普通请求（走系统解析），可以用来对比。",
    parameters: {
      url: { type: "string", required: true, description: "要请求的完整 URL，如 https://help.x.com/" },
      ip: { type: "string", description: "把该 URL 的域名钉到这个 IP；留空 = 走系统解析（做对比用）" },
      method: { type: "string", description: "HTTP 方法，默认 GET（只要响应头可用 HEAD）" },
      max_bytes: { type: "number", description: "正文最多取多少字节，默认 20000" },
      user_agent: { type: "string", description: "自定义 User-Agent" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          url: { type: "string" },
          final_url: { type: "string" },
          pinned_ip: { type: "string" },
          status: { type: "number" },
          headers: { type: "string" },
          body: { type: "string" },
          error: { type: "string" },
        },
      },
      render: (_args, v) => [{ type: "text", text:
        (v.error ? "❌ " + v.error : "HTTP " + v.status + (v.ok ? " ✅" : "")) +
        "\n请求：" + v.url +
        (v.pinned_ip ? "\n钉到 IP：" + v.pinned_ip : "\n（未钉 IP，走系统解析）") +
        (v.final_url && v.final_url !== v.url ? "\n最终：" + v.final_url : "") +
        "\n\n响应头：\n" + (v.headers || "(无)") +
        (v.body ? "\n\n正文：\n" + v.body : "") }],
    },
    async execute(args) {
      const url = String(args.url || "").trim();
      if (!url) return { ok: false, url: "", final_url: "", pinned_ip: "", status: 0, headers: "", body: "", error: "缺少 url" };

      const ip = args.ip ? String(args.ip).trim() : "";
      const headers = {};
      if (args.user_agent) headers["user-agent"] = String(args.user_agent);

      try {
        const r = await pinnedRequest(url, {
          ip,
          method: args.method || "GET",
          headers,
          maxBytes: Math.max(200, Math.min(200000, Number(args.max_bytes) || 20000)),
        });

        const head = Object.entries(r.headers)
          .map(([k, v]) => k + ": " + (Array.isArray(v) ? v.join(", ") : v))
          .join("\n");
        const headAll = (r.redirects && r.redirects.length ? "跳转: " + r.redirects.join(" | ") + "\n" : "") + head;

        return {
          ok: r.ok,
          url,
          final_url: r.finalUrl || url,
          pinned_ip: ip,
          status: Number(r.status) || 0,
          headers: headAll,
          body: r.body || "",
          error: r.error || "",
        };
      } catch (e) {
        const m = String(e && e.message || e);
        return { ok: false, url, final_url: url, pinned_ip: ip, status: 0, headers: "", body: "", error: m };
      }
    },
  }));
}

function cc(geo) {
  if (!geo || !geo.countryCode) return "";
  return "[" + geo.countryCode + (geo.country ? " / " + geo.country : "") + (geo.city ? " / " + geo.city : "") + "]";
}

export { apply, inject, name };
