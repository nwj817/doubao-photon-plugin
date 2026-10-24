"use strict";

/* ========= 模块：update —— 检查更新（多源探测 / 面板内一键下载更新包） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var REPO = "nwj817/doubao-photon-plugin";
  var UPD_SOURCES = [
    "https://api.github.com/repos/" + REPO + "/contents/latest.json",
    "https://raw.githubusercontent.com/" + REPO + "/main/latest.json",
    "https://cdn.jsdelivr.net/gh/" + REPO + "@main/latest.json",
    "https://cdn.staticaly.com/gh/" + REPO + "@main/latest.json"
  ];

  function renderUpdateInfo(html) {
    DP.$("updBody").innerHTML = '<div style="padding:6px 2px">' + html + "</div>";
    DP.$("updPanel").classList.remove("hidden");
  }

  /* 发现新版本详情 HTML（提示框「查看」与手动检查共用） */
  var lastUpdateData = null;
  function renderNewVersionHtml(data) {
    var latest = data.version;
    return (
      '<div style="font-size:var(--ph-text-sm);margin-bottom:8px">发现新版本：<b style="color:var(--ph-accent);font-size:var(--ph-text-md)">v' + DP.esc(latest) + "</b>（当前 v" + DP.esc(DP.PLUGIN_VERSION) + "）</div>" +
      (data.note ? '<div style="margin-bottom:10px;white-space:pre-wrap">' + DP.esc(data.note) + "</div>" : "") +
      '<div style="margin-bottom:10px">更新步骤：点「下载更新包」保存 zip → 解压 → 退出 Photon → 双击「一键安装豆包插件.bat」→ 重启 Photon。</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn primary" data-act="dlzip" data-url="' + DP.escAttr(data.zip || "") + '">下载更新包</button>' +
      '<button class="btn" data-act="copy" data-text="' + DP.escAttr(data.zip || ("https://raw.githubusercontent.com/" + REPO + "/main/latest.json")) + '">复制下载链接</button>' +
      "</div>"
    );
  }

  /* 更新提示 Toast：发现新版本弹出，5 秒不点击自动消失，点击「查看」打开更新详情 */
  var toastTimer = null;
  var toastShown = false;
  function showUpdateToast(latest, note) {
    var toast = DP.$("updToast");
    if (!toast || toastShown) return;                 // 同一面板会话只弹一次
    toastShown = true;
    DP.$("updToastTitle").textContent = "发现新版本 v" + latest;
    var brief = String(note || "").replace(/\s+/g, " ").trim();
    var noteEl = DP.$("updToastNote");
    noteEl.textContent = brief || ("当前 v" + DP.PLUGIN_VERSION + "，点击查看更新详情");
    noteEl.style.display = brief ? "" : "none";
    toast.classList.remove("hidden");
    void toast.offsetWidth;                            // 强制重排，确保过渡动画生效
    toast.classList.add("show");
    console.log("[update] update-toast shown: v" + latest);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hideUpdateToast(true); }, 5000);
  }
  function hideUpdateToast(autod) {
    var toast = DP.$("updToast");
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.classList.remove("show");
    setTimeout(function () {
      if (!toast.classList.contains("show")) toast.classList.add("hidden");
    }, 220);
    if (autod) console.log("[update] update-toast auto-dismissed after 5s");
  }

  function fetchUpdateInfo() {
    var chain = Promise.reject(new Error("no source"));
    UPD_SOURCES.forEach(function (src) {
      chain = chain.catch(function () {
        return DP.SDK.network.request({ method: "GET", url: src }).then(function (r) {
          var text = "";
          if (r && typeof r.body === "string") text = r.body;
          else if (r && r.body && typeof r.body.content === "string") text = atob(r.body.content);
          if (!text) throw new Error("empty response");
          var data = JSON.parse(text);
          if (!data || !data.version) throw new Error("bad update info");
          return data;
        });
      });
    });
    return chain;
  }

  function checkUpdate(silent) {
    if (!DP.SDK || !DP.SDK.network || typeof DP.SDK.network.request !== "function") {      if (!silent) renderUpdateInfo("当前环境不支持网络请求（SDK.network 不可用）");
      return;
    }
    if (silent) {
      try {
        var cached = JSON.parse(localStorage.getItem("doubao.updCheck") || "{}");
        if (cached && cached.v === DP.PLUGIN_VERSION && (Date.now() - (cached.t || 0)) < 10 * 60 * 1000) return;
      } catch (e) { }
    }
    fetchUpdateInfo().then(function (data) {
      var latest = data.version;
      if (String(latest) === DP.PLUGIN_VERSION) {
        try { localStorage.setItem("doubao.updCheck", JSON.stringify({ t: Date.now(), v: DP.PLUGIN_VERSION })); } catch (e) { }
        if (!silent) renderUpdateInfo('<div class="hint" style="text-align:center;margin-top:16px">当前已是最新版本 <b style="color:var(--ph-text)">v' + DP.esc(DP.PLUGIN_VERSION) + "</b></div>");
      } else {
        lastUpdateData = data;
        if (silent) {
          /* 自动检查发现新版本：弹出提示框，5 秒不点击自动消失 */
          showUpdateToast(String(latest), data.note);
          DP.setFoot("发现新版本 v" + latest + "，点「检查更新」查看");
        } else {
          renderUpdateInfo(renderNewVersionHtml(data));
        }
      }
    }).catch(function (e) {
      if (!silent) renderUpdateInfo("检查失败：" + DP.friendlyErr(e.message || String(e)) + "<br>当前网络可能无法访问 GitHub 更新源，请稍后重试，或直接访问仓库 <b>github.com/" + DP.esc(REPO) + "</b> 手动下载更新。");
    });
  }

  function str2bin(s) {
    var n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function zipPathFromUrl(url) {
    var m = /\/releases\/[^\/?#]+\.zip/i.exec(url || "");
    return m ? m[0].replace(/^\//, "") : "";
  }
  function saveZipBlob(bytes, url) {
    var blob = new Blob([bytes], { type: "application/zip" });
    var name = "doubao-photon-panel-v" + DP.PLUGIN_VERSION + ".zip";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    renderUpdateInfo("下载已开始：保存 <b>" + DP.esc(name) + "</b> → 解压 → 退出 Photon → 双击「一键安装豆包插件.bat」→ 重启 Photon 即完成更新。");
  }
  function downloadZip(url) {
    if (!url) { renderUpdateInfo("更新包地址为空，请点「复制下载链接」手动下载"); return; }
    if (!DP.SDK || !DP.SDK.network || typeof DP.SDK.network.request !== "function") {
      renderUpdateInfo("当前环境不支持网络下载，请点「复制下载链接」在浏览器中打开下载"); return;
    }
    DP.setFoot("正在下载更新包…");
    var apiUrl = "https://api.github.com/repos/" + REPO + "/contents/" + zipPathFromUrl(url);
    DP.SDK.network.request({ method: "GET", url: apiUrl }).then(function (r) {
      if (r && r.body && typeof r.body.content === "string") {
        var bytes = str2bin(atob(r.body.content));
        if (bytes && bytes.length >= 5000) { saveZipBlob(bytes, url); return; }
      }
      throw new Error("api binary unavailable");
    }).catch(function () {
      return DP.SDK.network.request({ method: "GET", url: url }).then(function (r) {
        var body = r && r.body !== undefined ? r.body : (r && r.data !== undefined ? r.data : null);
        if (body === null || body === undefined) throw new Error("empty response");
        var bytes = null;
        if (typeof body === "string") bytes = str2bin(body);
        else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
        else if (body && body.buffer) bytes = new Uint8Array(body.buffer);
        if (!bytes || bytes.length < 5000) throw new Error("bad bytes");
        saveZipBlob(bytes, url);
      }).catch(function (e2) {
        DP.setFoot("面板内保存不可用，已为你复制下载链接");
        renderUpdateInfo("当前环境无法直接保存文件，已自动复制下载链接，粘贴到浏览器打开即可下载。");
        navigator.clipboard.writeText(url).catch(function () { });
      });
    });
  }

  /* 更新动作（data-act 委托） */
  DP.registerAction("dlzip", function (btn) {
    downloadZip(btn.dataset.url || "");
  });
  DP.checkUpdate = checkUpdate;

  DP.registerInit(function () {
    DP.$("updBtn").addEventListener("click", function () { checkUpdate(false); });
    DP.$("updClose").addEventListener("click", function () { DP.$("updPanel").classList.add("hidden"); });
    DP.$("updToastGo").addEventListener("click", function () {
      hideUpdateToast(false);
      if (lastUpdateData) renderUpdateInfo(renderNewVersionHtml(lastUpdateData));
      else checkUpdate(false);
    });
    DP.$("updToastClose").addEventListener("click", function () { hideUpdateToast(false); });
  });
})();
