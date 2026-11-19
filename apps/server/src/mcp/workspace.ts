import { readFileSync } from "node:fs";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const workspaceLogo = "data:image/png;base64," +
  readFileSync(new URL("../../../web/public/logo.png", import.meta.url)).toString("base64");

export const WORKSPACE_TOOL_NAME = "edm_workspace_open";
export const WORKSPACE_OPEN_WEB_TOOL_NAME = "edm_workspace_open_web";
export const WORKSPACE_WEB_URL = "http://127.0.0.1:18090/campaigns";
export const WORKSPACE_RESOURCE_URI = "ui://mailqivo/workspace-v7";
export const WORKSPACE_MIME_TYPE = "text/html;profile=mcp-app";

export const WORKSPACE_TOOL: Tool = {
  name: WORKSPACE_TOOL_NAME,
  title: "Mailqivo",
  icons: [{ src: workspaceLogo, mimeType: "image/png", sizes: ["64x64"] }],
  description: "打开 Mailqivo 邮件营销工作空间。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  _meta: {
    ui: { resourceUri: WORKSPACE_RESOURCE_URI, visibility: ["app"] },
    "openai/ui": { entrypoints: [{ type: "global" }] }
  }
};

export const WORKSPACE_OPEN_WEB_TOOL: Tool = {
  name: WORKSPACE_OPEN_WEB_TOOL_NAME,
  title: "打开 Mailqivo Web 管理台",
  description: "在本机默认浏览器中打开 Mailqivo Web 管理台。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  _meta: { ui: { visibility: ["app"] } }
};

export const WORKSPACE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mailqivo</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f7f7; --panel: #fff; --line: #dce5e4; --text: #172526;
      --muted: #647576; --brand: #0f766e; --brand-soft: #dff4f1; --danger: #b42318;
      --shadow: 0 8px 28px rgba(21, 55, 54, .08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101616; --panel: #182120; --line: #2c3b39; --text: #eef6f5;
        --muted: #9fb0ae; --brand: #5eead4; --brand-soft: #173a35; --danger: #ff8a80;
        --shadow: 0 8px 28px rgba(0, 0, 0, .24);
      }
    }
    * { box-sizing: border-box; }
    html, body { min-width: 320px; min-height: 100%; margin: 0; background: var(--bg); color: var(--text); }
    body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
    button { font: inherit; }
    .shell { min-height: 100vh; padding: 28px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark { flex: none; width: 42px; height: 42px; object-fit: contain; }
    .brand h1 { margin: 0; font-size: 23px; line-height: 1.1; letter-spacing: -.02em; }
    .brand p { margin: 4px 0 0; color: var(--muted); }
    .actions { display: flex; gap: 8px; }
    .button { border: 1px solid var(--line); border-radius: 10px; padding: 8px 13px; background: var(--panel); color: var(--text); cursor: pointer; }
    .button:hover { border-color: var(--brand); }
    .button.primary { border-color: var(--brand); background: var(--brand); color: #fff; }
    .button:disabled { cursor: wait; opacity: .55; }
    .notice { display: none; margin-bottom: 16px; border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--line)); border-radius: 10px; padding: 10px 12px; background: var(--panel); color: var(--danger); }
    .notice.success { border-color: color-mix(in srgb, var(--brand) 40%, var(--line)); color: var(--brand); }
    .notice.show { display: block; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .card { min-height: 104px; border: 1px solid var(--line); border-radius: 15px; padding: 17px; background: var(--panel); box-shadow: var(--shadow); }
    .card .label { color: var(--muted); }
    .card .value { margin-top: 10px; font-size: 29px; line-height: 1; font-weight: 720; font-variant-numeric: tabular-nums; }
    .workspace { border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--panel); box-shadow: var(--shadow); }
    .tabs { display: flex; gap: 4px; padding: 10px; border-bottom: 1px solid var(--line); overflow-x: auto; }
    .tab { border: 0; border-radius: 9px; padding: 8px 14px; background: transparent; color: var(--muted); cursor: pointer; white-space: nowrap; }
    .tab[aria-selected="true"] { background: var(--brand-soft); color: var(--brand); font-weight: 650; }
    .panel { min-height: 330px; padding: 8px 18px 18px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 640px; }
    th { padding: 13px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; font-weight: 600; text-align: left; }
    td { padding: 13px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    .title { font-weight: 620; }
    .sub { margin-top: 3px; color: var(--muted); font-size: 12px; max-width: 440px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 8px; background: var(--brand-soft); color: var(--brand); font-size: 12px; white-space: nowrap; }
    .empty { display: grid; place-items: center; min-height: 270px; color: var(--muted); text-align: center; }
    .loading { animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .45; } }
    @media (max-width: 820px) {
      .shell { padding: 18px; }
      .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .topbar { align-items: flex-start; }
      .actions { flex-direction: column-reverse; }
    }
    @media (max-width: 520px) {
      .shell { padding: 12px; }
      .brand p { display: none; }
      .button span { display: none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <img class="mark" src="${workspaceLogo}" alt="">
        <div><h1>Mailqivo</h1><p data-i18n>Email marketing workspace</p></div>
      </div>
      <div class="actions">
        <button class="button" id="openWeb" type="button">↗ <span data-i18n>Web console</span></button>
        <button class="button primary" id="refresh" type="button" data-i18n>Refresh</button>
      </div>
    </header>

    <div class="notice" id="notice" role="alert"></div>

    <section class="cards" aria-label="Overview" data-i18n-label>
      <article class="card"><div class="label" data-i18n>All campaigns</div><div class="value" id="campaignTotal">—</div></article>
      <article class="card"><div class="label" data-i18n>All contacts</div><div class="value" id="contactTotal">—</div></article>
      <article class="card"><div class="label" data-i18n>Unhandled replies</div><div class="value" id="replyTotal">—</div></article>
      <article class="card"><div class="label" data-i18n>Available attachments</div><div class="value" id="assetTotal">—</div></article>
    </section>

    <section class="workspace">
      <nav class="tabs" aria-label="Workspace navigation" data-i18n-label>
        <button class="tab" type="button" data-tab="campaigns" aria-selected="true" data-i18n>Campaigns</button>
        <button class="tab" type="button" data-tab="contacts" aria-selected="false" data-i18n>Contacts</button>
        <button class="tab" type="button" data-tab="replies" aria-selected="false" data-i18n>Replies</button>
        <button class="tab" type="button" data-tab="assets" aria-selected="false" data-i18n>Attachments</button>
      </nav>
      <div class="panel" id="panel"><div class="empty loading" data-i18n>Connecting to Mailqivo…</div></div>
    </section>
  </main>

  <script>
    (function () {
      "use strict";
      var nextId = 1;
      var pending = new Map();
      var activeTab = "campaigns";
      var data = { campaigns: null, contacts: null, replies: null, assets: null };
      var panel = document.getElementById("panel");
      var notice = document.getElementById("notice");
      var refreshButton = document.getElementById("refresh");
      var openWebButton = document.getElementById("openWeb");

      var zh = {
        "Email marketing workspace": "邮件营销工作空间",
        "Web console": "Web 管理台",
        "Refresh": "刷新",
        "Overview": "概览",
        "All campaigns": "全部活动",
        "All contacts": "全部联系人",
        "Unhandled replies": "未处理回函",
        "Available attachments": "可用附件",
        "Workspace navigation": "工作区导航",
        "Campaigns": "活动",
        "Contacts": "联系人",
        "Replies": "回函",
        "Attachments": "附件",
        "Connecting to Mailqivo…": "正在连接 Mailqivo…",
        "Unrecognized data from the service": "服务返回了无法识别的数据",
        "Read failed": "读取失败",
        "No data yet": "暂无数据",
        "Loading…": "正在加载…",
        "Status": "状态",
        "Sent": "发送",
        "Opened": "打开",
        "Updated": "更新时间",
        "Company": "公司",
        "Tags": "标签",
        "Category": "分类",
        "Received": "时间",
        "(No subject)": "（无主题）",
        "Needs review": "待复核",
        "Type": "类型",
        "Size": "大小",
        "Disabled": "已停用",
        "Available": "可用",
        "Could not load the workspace": "工作空间读取失败",
        "Unknown error": "未知错误",
        "Make sure Mailqivo is running and try again.": "请确认 Mailqivo 服务正在运行后重试。",
        "Could not load data. Select Refresh to try again.": "暂时无法读取数据，请点击“刷新”重试。",
        "Request failed": "请求失败",
        "Opened the Mailqivo web console in your browser. Sign in if prompted.": "已在默认浏览器打开 Mailqivo Web 管理台。首次使用请先登录。",
        "Could not start the Mailqivo workspace.": "无法初始化 Mailqivo 工作空间。",
        "Draft": "草稿",
        "Scheduled": "已排程",
        "Preparing": "准备中",
        "Sending": "发送中",
        "Paused": "已暂停",
        "Completed": "已完成",
        "Cancelled": "已取消",
        "Failed": "失败",
        "Active": "有效",
        "Invalid": "无效",
        "Bounced": "已退信",
        "Unsubscribed": "已退订",
        "Bounce": "退信",
        "Automatic reply": "自动回函",
        "Human reply": "人工回函",
        "Unrelated": "无关邮件",
      };
      var statusLabels = {
        "draft": "Draft",
        "scheduled": "Scheduled",
        "preparing": "Preparing",
        "sending": "Sending",
        "paused": "Paused",
        "completed": "Completed",
        "cancelled": "Cancelled",
        "failed": "Failed",
        "active": "Active",
        "invalid": "Invalid",
        "bounced": "Bounced",
        "unsubscribed": "Unsubscribed",
        "bounce": "Bounce",
        "auto_reply": "Automatic reply",
        "human": "Human reply",
        "unrelated": "Unrelated",
      };
      var locale;
      var staticLabels = Array.from(document.querySelectorAll("[data-i18n], [data-i18n-label]"), function (node) {
        return { node: node, label: node.getAttribute("aria-label") || node.textContent };
      });

      function t(label) {
        return locale === "zh-CN" && Object.hasOwn(zh, label) ? zh[label] : label;
      }
      function statusLabel(value) {
        return Object.hasOwn(statusLabels, value) ? t(statusLabels[value]) : value;
      }
      function setLocale(language) {
        locale = /^zh(?:[-_]|$)/i.test(language || "") ? "zh-CN" : "en";
        document.documentElement.lang = locale;
        staticLabels.forEach(function (entry) {
          if (entry.node.hasAttribute("data-i18n-label")) entry.node.setAttribute("aria-label", t(entry.label));
          else entry.node.textContent = t(entry.label);
        });
      }
      setLocale(navigator.language);

      function post(message) { window.parent.postMessage(message, "*"); }
      function request(method, params) {
        var id = nextId++;
        post({ jsonrpc: "2.0", id: id, method: method, params: params });
        return new Promise(function (resolve, reject) { pending.set(id, { resolve: resolve, reject: reject }); });
      }
      function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params }); }
      function tool(name, args) {
        return request("tools/call", { name: name, arguments: args || {} }).then(function (result) {
          var block = result && result.content && result.content.find(function (item) { return item.type === "text"; });
          var parsed = {};
          if (block && block.text) {
            try { parsed = JSON.parse(block.text); } catch (_) { throw new Error(t("Unrecognized data from the service")); }
          }
          if (result && result.isError) throw new Error(parsed.message || t("Read failed"));
          return parsed;
        });
      }

      function text(value) { return value == null || value === "" ? "—" : String(value); }
      function date(value) {
        if (!value) return "—";
        var parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleString(locale, { hour12: false });
      }
      function el(tag, className, value) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = text(value);
        return node;
      }
      function cell(row, value) { row.appendChild(el("td", "", value)); }
      function namedCell(row, title, subtitle) {
        var td = el("td");
        td.appendChild(el("div", "title", title));
        if (subtitle) td.appendChild(el("div", "sub", subtitle));
        row.appendChild(td);
      }
      function badgeCell(row, value) {
        var td = el("td");
        td.appendChild(el("span", "badge", value));
        row.appendChild(td);
      }
      function empty(message) { panel.replaceChildren(el("div", "empty", message)); }
      function table(headers, rows, buildRow) {
        if (!rows || rows.length === 0) { empty(t("No data yet")); return; }
        var tableNode = el("table");
        var head = el("thead");
        var headRow = el("tr");
        headers.forEach(function (header) { headRow.appendChild(el("th", "", header)); });
        head.appendChild(headRow); tableNode.appendChild(head);
        var body = el("tbody");
        rows.forEach(function (item) { var row = el("tr"); buildRow(row, item); body.appendChild(row); });
        tableNode.appendChild(body); panel.replaceChildren(tableNode);
      }

      function render() {
        var page = data[activeTab];
        if (!page) { empty(t("Loading…")); return; }
        if (activeTab === "campaigns") {
          table([t("Campaigns"), t("Status"), t("Sent"), t("Opened"), t("Updated")], page.items, function (row, item) {
            namedCell(row, item.name, item.subject); badgeCell(row, statusLabel(item.status));
            cell(row, (item.metrics && item.metrics.sent || 0) + " / " + (item.metrics && item.metrics.total || 0));
            cell(row, item.metrics && item.metrics.opened || 0); cell(row, date(item.updated_at || item.created_at));
          });
        } else if (activeTab === "contacts") {
          table([t("Contacts"), t("Status"), t("Company"), t("Tags")], page.items, function (row, item) {
            namedCell(row, item.name || item.email, item.name ? item.email : ""); badgeCell(row, statusLabel(item.status)); cell(row, item.company);
            cell(row, Array.isArray(item.tags) ? item.tags.map(function (tag) { return tag.name || tag; }).join(locale === "zh-CN" ? "、" : ", ") : "—");
          });
        } else if (activeTab === "replies") {
          table([t("Replies"), t("Category"), t("Campaigns"), t("Received")], page.items, function (row, item) {
            namedCell(row, item.subject || t("(No subject)"), item.from_email); badgeCell(row, item.needs_review ? t("Needs review") : statusLabel(item.category));
            cell(row, item.campaign_name); cell(row, date(item.received_at));
          });
        } else {
          table([t("Attachments"), t("Type"), t("Size"), t("Status")], page.items, function (row, item) {
            namedCell(row, item.filename, item.sha256 ? item.sha256.slice(0, 12) : ""); cell(row, item.mime_type);
            cell(row, typeof item.size_bytes === "number" ? Math.max(1, Math.round(item.size_bytes / 1024)) + " KB" : "—");
            badgeCell(row, item.enabled === false ? t("Disabled") : t("Available"));
          });
        }
      }

      function setTotal(id, page) { document.getElementById(id).textContent = page && typeof page.total === "number" ? String(page.total) : "—"; }
      function showError(error) {
        notice.classList.remove("success");
        notice.textContent = t("Could not load the workspace") + ": " + (error && error.message ? error.message : t("Unknown error")) + ". " + t("Make sure Mailqivo is running and try again.");
        notice.classList.add("show");
      }
      function loadAll() {
        refreshButton.disabled = true; notice.classList.remove("show");
        return Promise.all([
          tool("edm_campaign_list", { page: 1, page_size: 20 }),
          tool("edm_contact_search", { filter: { statuses: ["active", "invalid", "bounced", "unsubscribed"], exclude_domain_suspect: false }, page: 1, page_size: 20 }),
          tool("edm_reply_list", { handled: false, page: 1, page_size: 20 }),
          tool("edm_asset_list", { enabled: true, page: 1, page_size: 20 })
        ]).then(function (results) {
          data.campaigns = results[0]; data.contacts = results[1]; data.replies = results[2]; data.assets = results[3];
          setTotal("campaignTotal", data.campaigns); setTotal("contactTotal", data.contacts);
          setTotal("replyTotal", data.replies); setTotal("assetTotal", data.assets); render();
        }).catch(function (error) {
          showError(error); empty(t("Could not load data. Select Refresh to try again."));
        }).finally(function () { refreshButton.disabled = false; });
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.id !== undefined && pending.has(message.id)) {
          var waiter = pending.get(message.id); pending.delete(message.id);
          if (message.error) waiter.reject(new Error(message.error.message || t("Request failed"))); else waiter.resolve(message.result || {});
          return;
        }
        if (message.method === "ui/notifications/host-context-changed" && message.params && message.params.locale) {
          setLocale(message.params.locale);
          render();
        }
        if (message.method === "ui/resource-teardown" && message.id !== undefined) post({ jsonrpc: "2.0", id: message.id, result: {} });
      });

      document.querySelectorAll(".tab").forEach(function (tab) {
        tab.addEventListener("click", function () {
          activeTab = tab.dataset.tab;
          document.querySelectorAll(".tab").forEach(function (item) { item.setAttribute("aria-selected", item === tab ? "true" : "false"); });
          render();
        });
      });
      refreshButton.addEventListener("click", loadAll);
      openWebButton.addEventListener("click", function () {
        openWebButton.disabled = true;
        tool("${WORKSPACE_OPEN_WEB_TOOL_NAME}", {}).then(function () {
          notice.textContent = t("Opened the Mailqivo web console in your browser. Sign in if prompted.");
          notice.classList.add("show", "success");
        }).catch(showError).finally(function () { openWebButton.disabled = false; });
      });

      request("ui/initialize", {
        protocolVersion: "2026-01-26",
        appInfo: { name: "mailqivo-workspace", version: "1.1.1" },
        appCapabilities: { availableDisplayModes: ["fullscreen"] }
      }).then(function (result) {
        if (result.hostContext && result.hostContext.locale) setLocale(result.hostContext.locale);
        notify("ui/notifications/initialized", {}); return loadAll();
      }).catch(function (error) {
        showError(error); empty(t("Could not start the Mailqivo workspace."));
      });
    }());
  </script>
</body>
</html>`;
