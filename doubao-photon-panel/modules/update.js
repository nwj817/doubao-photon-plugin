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
      '<div style="margin-bottom:10px">点「立即更新」自动下载并覆盖安装，完成后自动热更新生效，无需重启 Photon。</div>' +
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

  /* 从面板自身加载 URL 自动反推插件安装目录，无需用户选文件夹 */
  function detectPluginDir() {
    try {
      var u = location.href || "";
      if (u.indexOf("file:///") === 0) {
        var p = decodeURIComponent(u.slice(8));       // C:/Users/.../packages/key/sha/index.html
        p = p.replace(/\//g, "\\").replace(/\\[^\\]*$/, "");  // 去掉 index.html，保留目录
        if (p) return p;
      }
    } catch (e) { }
    return null;
  }
  function getInstallDir() {
    var dir = detectPluginDir();
    if (dir) {
      console.log("[update] auto-detected plugin dir:", dir);
      return Promise.resolve(dir);
    }
    /* 极端兜底：无法从 URL 定位时才让用户选 */
    return DP.SDK.files.pick({ folder: true }).then(function (d) {
      if (!d) throw new Error("无法定位插件安装目录");
      return d;
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

  /* 自动更新主流程：下载 → 解压 → 自动覆盖当前插件目录（无需选文件夹） */
  function autoUpdate(url) {
    if (!url) { renderUpdateInfo("更新包地址为空"); return; }
    DP.setFoot("正在下载更新包…");
    downloadZipBytes(url).then(function (bytes) {
      DP.setFoot("正在解压并覆盖安装…");
      var entries = parseZipEntries(bytes);
      /* 只取插件目录内的文件；zip 顶层是 doubao-photon-panel/，剥掉前缀；
         install_plugin.py / 一键安装.bat 是给手动安装用的，自动更新跳过 */
      var files = entries.filter(function (e) {
        if (!e.name || e.name.charAt(e.name.length - 1) === "/") return false;
        return /^doubao-photon-panel\//.test(e.name);
      }).map(function (e) {
        return { rel: e.name.replace(/^doubao-photon-panel\//, ""), src: e };
      });
      if (!files.length) throw new Error("ZIP 内没有插件文件");
      console.log("[update] files to overwrite:", files.map(function (f) { return f.rel; }));
      return getInstallDir().then(function (dir) {
        var i = 0, ok = 0;
        function writeNext() {
          if (i >= files.length) return { dir: dir, count: ok };
          var f = files[i++];
          return extractEntry(bytes, f.src).then(function (content) {
            return DP.SDK.files.write(dir + "/" + f.rel, content);
          }).then(function () { ok++; return writeNext(); })
            .catch(function (we) {
              /* 单文件失败不中断，记录后继续 */
              console.warn("[update] write failed:", f.rel, we && we.message || we);
              return writeNext();
            });
        }
        return writeNext();
      });
    }).then(function (res) {
      console.log("[update] auto-update done:", res);
      /* 热更新：覆盖完成后自动刷新当前面板，新版本代码立即生效（宿主 preload 会在新导航重新注入 SDK）。
         若刷新被宿主拦截，5 秒后给出重启降级提示。 */
      var reloaded = false;
      window.addEventListener("beforeunload", function () { reloaded = true; });
      renderUpdateInfo(
        '<div style="padding:10px 4px">' +
        '<div style="color:var(--ph-accent);margin-bottom:8px">自动更新完成（覆盖 ' + res.count + " 个文件）</div>" +
        '<div style="margin-top:8px;color:var(--ph-muted)">正在自动刷新面板热更新，无需重启 Photon…</div></div>'
      );
      DP.setFoot("更新完成，正在热更新…");
      try { localStorage.setItem("doubao.afterUpdate", JSON.stringify({ t: Date.now() })); } catch (e) { }
      setTimeout(function () { if (!reloaded) location.reload(); }, 1200);
      setTimeout(function () {
        if (!reloaded) renderUpdateInfo("面板刷新被宿主拦截，请手动退出并重启 Photon Studio（文件已覆盖为最新版）。");
      }, 5000);
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
    /* 热更新完成标记：刷新后提示一次新版本号 */
    try {
      var au = JSON.parse(localStorage.getItem("doubao.afterUpdate") || "null");
      if (au && au.t) {
        localStorage.removeItem("doubao.afterUpdate");
        DP.setFoot("已热更新至 v" + DP.PLUGIN_VERSION);
      }
    } catch (e) { }
  });
})();
