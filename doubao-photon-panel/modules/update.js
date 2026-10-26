"use strict";

/* ========= 模块：update —— 检查更新 + 面板内自动解压覆盖安装（无需手动解压/跑脚本） ========= */

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

  /* 发现新版本详情 HTML */
  var lastUpdateData = null;
  function renderNewVersionHtml(data) {
    var latest = data.version;
    return (
      '<div style="font-size:var(--ph-text-sm);margin-bottom:8px">发现新版本：<b style="color:var(--ph-accent);font-size:var(--ph-text-md)">v' + DP.esc(latest) + "</b>（当前 v" + DP.esc(DP.PLUGIN_VERSION) + "）</div>" +
      (data.note ? '<div style="margin-bottom:10px;white-space:pre-wrap">' + DP.esc(data.note) + "</div>" : "") +
      '<div style="margin-bottom:10px">点「立即更新」自动下载并覆盖安装，完成后重启 Photon 即可。</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn primary" data-act="autoupd" data-url="' + DP.escAttr(data.zip || "") + '">立即更新</button>' +
      '<button class="btn" data-act="dlzip" data-url="' + DP.escAttr(data.zip || "") + '">手动下载 zip</button>' +
      "</div>"
    );
  }

  /* 更新提示 Toast：发现新版本弹出，5 秒不点击自动消失 */
  var toastTimer = null;
  var toastShown = false;
  function showUpdateToast(latest, note) {
    var toast = DP.$("updToast");
    if (!toast || toastShown) return;
    toastShown = true;
    DP.$("updToastTitle").textContent = "发现新版本 v" + latest;
    var brief = String(note || "").replace(/\s+/g, " ").trim();
    var noteEl = DP.$("updToastNote");
    noteEl.textContent = brief || ("当前 v" + DP.PLUGIN_VERSION + "，点击查看更新详情");
    noteEl.style.display = brief ? "" : "none";
    toast.classList.remove("hidden");
    void toast.offsetWidth;
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
    if (!DP.SDK || !DP.SDK.network || typeof DP.SDK.network.request !== "function") {
      if (!silent) renderUpdateInfo("当前环境不支持网络请求（SDK.network 不可用）");
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

  /* ---------- ZIP 解压（浏览器原生 DecompressionStream） ---------- */
  function utf8decode(view) { return new TextDecoder("utf-8").decode(view); }

  /* 解析 ZIP central directory，返回条目列表 */
  function parseZipEntries(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    var min = Math.max(0, bytes.length - 65557);
    for (var i = bytes.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 ZIP 包");
    var cdCount = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var entries = [], p = cdOffset;
    for (var n = 0; n < cdCount; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      entries.push({
        name: utf8decode(bytes.subarray(p + 46, p + 46 + dv.getUint16(p + 28, true))),
        method: dv.getUint16(p + 10, true),
        compSize: dv.getUint32(p + 20, true),
        localOff: dv.getUint32(p + 42, true)
      });
      p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return entries;
  }

  /* 解压单个条目（method 0=stored, 8=deflate-raw） */
  function extractEntry(bytes, e) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var lNameLen = dv.getUint16(e.localOff + 26, true);
    var lExtraLen = dv.getUint16(e.localOff + 28, true);
    var start = e.localOff + 30 + lNameLen + lExtraLen;
    var comp = bytes.subarray(start, start + e.compSize);
    if (e.method === 0) return Promise.resolve(comp);
    if (e.method === 8) {
      if (typeof DecompressionStream === "undefined") {
        return Promise.reject(new Error("当前 Photon 版本不支持在线解压（DecompressionStream 缺失），请用手动下载方式"));
      }
      return new Response(new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw")))
        .arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    }
    return Promise.reject(new Error("不支持的 ZIP 压缩方式 method=" + e.method));
  }

  /* 拿到插件安装目录授权（首次弹选择器，之后记住） */
  function getInstallDir() {
    var saved = null;
    try { saved = localStorage.getItem("doubao.pluginDir"); } catch (e) { }
    if (saved) return Promise.resolve(saved);
    return DP.SDK.files.pick({ folder: true }).then(function (dir) {
      if (!dir) throw new Error("已取消选择安装目录");
      localStorage.setItem("doubao.pluginDir", dir);
      return dir;
    });
  }

  /* 下载 zip bytes（优先 api base64，兜底直链） */
  function str2bin(s) {
    var n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function zipPathFromUrl(url) {
    var m = /\/releases\/[^\/?#]+\.zip/i.exec(url || "");
    return m ? m[0].replace(/^\//, "") : "";
  }
  function downloadZipBytes(url) {
    var apiUrl = "https://api.github.com/repos/" + REPO + "/contents/" + zipPathFromUrl(url);
    return DP.SDK.network.request({ method: "GET", url: apiUrl }).then(function (r) {
      if (r && r.body && typeof r.body.content === "string") {
        var b = str2bin(atob(r.body.content));
        if (b && b.length >= 5000) return b;
      }
      throw new Error("api binary unavailable");
    }).catch(function () {
      return DP.SDK.network.request({ method: "GET", url: url }).then(function (r) {
        var body = r && r.body !== undefined ? r.body : (r && r.data !== undefined ? r.data : null);
        var bytes = null;
        if (typeof body === "string") bytes = str2bin(body);
        else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
        else if (body && body.buffer) bytes = new Uint8Array(body.buffer);
        if (!bytes || bytes.length < 5000) throw new Error("bad bytes");
        return bytes;
      });
    });
  }

  /* 自动更新主流程：下载 → 解压 → 覆盖写入安装目录 */
  function autoUpdate(url) {
    if (!url) { renderUpdateInfo("更新包地址为空"); return; }
    DP.setFoot("正在下载更新包…");
    downloadZipBytes(url).then(function (bytes) {
      DP.setFoot("正在解压并覆盖安装…");
      var entries = parseZipEntries(bytes);
      var files = entries.filter(function (e) { return e.name && e.name.charAt(e.name.length - 1) !== "/"; });
      if (!files.length) throw new Error("ZIP 内没有文件");
      return getInstallDir().then(function (dir) {
        var i = 0, ok = 0;
        function writeNext() {
          if (i >= files.length) {
            return { dir: dir, count: ok };
          }
          var e = files[i++];
          return extractEntry(bytes, e).then(function (content) {
            return DP.SDK.files.write(dir + "/" + e.name, content);
          }).then(function () { ok++; return writeNext(); });
        }
        return writeNext();
      });
    }).then(function (res) {
      console.log("[update] auto-update done:", res);
      renderUpdateInfo(
        '<div style="padding:10px 4px">' +
        '<div style="color:var(--ph-accent);margin-bottom:8px">自动更新完成（覆盖 ' + res.count + " 个文件）</div>" +
        '<div>安装目录：' + DP.esc(res.dir) + "</div>" +
        '<div style="margin-top:8px;color:var(--ph-muted)">请退出并重启 Photon Studio 后生效。</div></div>'
      );
      try { localStorage.removeItem("doubao.pluginDir"); } catch (e) { }  // 不缓存授权，目录若变重新选
      DP.setFoot("更新完成，重启 Photon 后生效");
    }).catch(function (e) {
      DP.setFoot("自动更新失败");
      renderUpdateInfo(
        "自动更新失败：" + DP.friendlyErr(e.message || String(e)) +
        '<br>兜底方案：点「手动下载 zip」，解压后双击「一键安装豆包插件.bat」。'
      );
    });
  }

  /* 手动下载兜底（保存 zip 到用户选定位置） */
  function saveZipBlob(bytes, url) {
    return DP.SDK.files.pick({ save: true, name: "doubao-photon-panel.zip" }).then(function (path) {
      if (!path) { renderUpdateInfo("已取消保存"); return; }
      return DP.SDK.files.write(path, bytes).then(function () {
        renderUpdateInfo("已保存到：<b>" + DP.esc(path) + "</b><br>解压后双击「一键安装豆包插件.bat」即可。");
      });
    }).catch(function (e) {
      renderUpdateInfo("保存失败：" + (e && e.message || e) + "，已复制下载链接到剪贴板。");
      navigator.clipboard.writeText(url).catch(function () { });
    });
  }
  function manualDownload(url) {
    if (!url) { renderUpdateInfo("更新包地址为空"); return; }
    DP.setFoot("正在下载更新包…");
    downloadZipBytes(url).then(function (bytes) {
      return saveZipBlob(bytes, url);
    }).catch(function (e) {
      renderUpdateInfo("下载失败：" + DP.friendlyErr(e.message || String(e)) + "，已复制链接。");
      navigator.clipboard.writeText(url).catch(function () { });
    });
  }

  /* 更新动作（data-act 委托） */
  DP.registerAction("autoupd", function (btn) { autoUpdate(btn.dataset.url || ""); });
  DP.registerAction("dlzip", function (btn) { manualDownload(btn.dataset.url || ""); });
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
