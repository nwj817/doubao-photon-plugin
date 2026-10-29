"use strict";

/* ========= 模块：boot —— 启动编排 / 标签页 / 全局事件委托（data-act / data-rm）/ SDK 激活 ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  /* ---------- 标签页切换（切到翻译页时刷新文本图层下拉） ---------- */
  function bindTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("on"); });
        tab.classList.add("on");
        document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("on"); });
        DP.$("view-" + tab.dataset.view).classList.add("on");
        if (tab.dataset.view === "translate" && DP.fillTrLayerOptions) DP.fillTrLayerOptions();
      });
    });
  }

  /* ---------- 通用动作（data-act 委托分发）：copy / copyurl / place / save 在 boot 内联，
      其余动作由各功能模块经 DP.registerAction 注册，这里统一查表分发 ---------- */
  function bindActions() {
    DP.$("keyBtn").addEventListener("click", DP.configureKey);

    DP.$("opsBtn").addEventListener("click", function () {
      if (!DP.SDK || !DP.SDK.documents || typeof DP.SDK.documents.operations !== "function") {
        DP.setFoot("SDK 未提供 operations 枚举"); return;
      }
      var btn = DP.$("opsBtn");
      btn.disabled = true; btn.textContent = "查询中…";
      var queries = ["", ".", "*", "layer", "transform", "scale", "smart", "document", "pixels", "select", "filter", "core"];
      var results = [];
      function run(i) {
        if (i >= queries.length) {
          var lines = results.map(function (r) {
            return "query=" + JSON.stringify(r.q) + " → " + r.n + " 项" + (r.names.length ? "：" + r.names.join(", ") : "");
          });
          var text = "可用操作（多 query 汇总）：\n" + lines.join("\n") + "\n\n原始样例：" + JSON.stringify(results[0] && results[0].raw).slice(0, 1500);
          DP.setFoot(text.replace(/\n/g, " ").slice(0, 900));
          var show = DP.$("showOps");
          if (show) { show.value = text; show.style.display = "block"; }
          btn.textContent = "能力清单"; btn.disabled = false;
          return;
        }
        var q = queries[i];
        var p = {};
        if (q !== "") p.query = q;
        DP.SDK.documents.operations(p).then(function (list) {
          var arr = Array.isArray(list) ? list : (list && list.operations) || [];
          var names = arr.map(function (o) { return (o && (o.id || o.name || o.operation)) || "?"; });
          results.push({ q: q, n: arr.length, names: names, raw: list });
          run(i + 1);
        }).catch(function (e) {
          results.push({ q: q, n: -1, names: [], raw: String((e && e.message) || e) });
          run(i + 1);
        });
      }
      run(0);
    });

    /* 通用 data-act 委托：先查模块注册表，命中即分发；内置动作在此处理 */
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-act]") : null;
      if (!btn) return;
      var act = btn.dataset.act;
      var handler = DP._actions[act];
      if (handler) { handler(btn); return; }
      if (act === "copy") {
        navigator.clipboard.writeText(btn.dataset.text || "").then(function () {
          btn.textContent = "已复制"; DP.setFoot("已复制到剪贴板");
          setTimeout(function () { btn.textContent = "复制"; }, 1500);
        }).catch(function () { DP.setFoot("复制失败"); });
      } else if (act === "copyurl") {
        var a = btn.parentElement.parentElement.querySelector("a");
        navigator.clipboard.writeText(a ? a.href : "").then(function () {
          btn.textContent = "已复制"; setTimeout(function () { btn.textContent = "复制链接"; }, 1500);
        });
      } else if (act === "place") {
        var container = btn.closest(".result");
        var holder = container && container.__img;
        if (holder) {
          btn.disabled = true; btn.textContent = "置入中…";
          DP.placeOnCanvas(holder.bytes, { label: (container && container.__label) || "豆包生成" }).then(function (r) {
            btn.disabled = false;
            btn.textContent = "置入画布";
            if (r && r.smart) DP.setFoot("已置入画布并转为智能对象（等比居中，原始像素无损）图层：" + (r.layerName || "智能对象"));
            else if (r && r.placed) DP.setFoot("已置入画布（等比居中）；智能对象图层未识别，请检查图层面板");
            else DP.setFoot("已置入当前文档（等比适配）");
          }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = "置入画布"; DP.setFoot("置入失败：" + (e.message || e));
          });
        }
      } else if (act === "save") {
        var holder2 = btn.closest(".result") && btn.closest(".result").__img;
        if (holder2) {
          btn.disabled = true; btn.textContent = "保存中…";
          DP.saveToDisk(holder2.bytes).then(function (path) {
            btn.disabled = false;
            if (path) { btn.textContent = "保存到本地"; DP.setFoot("已保存：" + path); }
            else { btn.textContent = "保存到本地"; DP.setFoot("已取消"); }
          }).catch(function (e) { btn.disabled = false; btn.textContent = "保存到本地"; DP.setFoot("保存失败：" + (e.message || e)); });
        }
      }
    });

    /* 移除已选图片（data-rm = 容器名:索引，只删单张） */
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-rm]") : null;
      if (!btn) return;
      var parts = String(btn.dataset.rm || "").split(":");
      var c = parts[0], idx = parseInt(parts[1] || "0", 10) || 0;
      if (c === "crPicked" && DP.state.create) {
        DP.state.create.splice(idx, 1);
        DP.renderPicked("crPicked", DP.state.create);
        if (DP.updateCrMode) DP.updateCrMode();
      }
      else if (c === "opPicked") { DP.state.op = null; DP.$("opPicked").innerHTML = ""; }
    });
  }

  /* 把图片 bytes 挂到 result 容器上，供 置入/保存 按钮使用 */
  function storeImageData() {
    var observer = new MutationObserver(function () {
      document.querySelectorAll(".result").forEach(function (r) {
        var img = r.querySelector("img");
        var holder = r.__img;
        if (img && !holder && img.src && img.src.indexOf("data:") === 0) {
          var b64 = img.src.split(",")[1];
          try { r.__img = { bytes: DP.base64ToBytes(b64) }; } catch (e) { }
        }
      });
    });
    observer.observe(document.getElementById("content"), { childList: true, subtree: true });
  }

  function refreshDocInfo() {
    if (!DP.SDK) return;
    DP.SDK.documents.active().then(function (doc) {
      if (doc) {
        var w = doc.width, h = doc.height, name = doc.name || doc.title || "";
        DP.$("docInfo").textContent = "文档：" + name + " " + (w || "?") + "×" + (h || "?");
      } else {
        DP.$("docInfo").textContent = "未打开文档";
      }
    }).catch(function () { DP.$("docInfo").textContent = ""; });
  }

  function onSdkReady(api) {
    DP.SDK = api;
    DP.setFoot("SDK 已连接");
    DP.refreshKeyStatus();
    refreshDocInfo();
    setInterval(refreshDocInfo, 5000);
    if (DP.SDK.network && DP.SDK.network.allowEndpoint) {
      DP.SDK.network.allowEndpoint(DP.ARK_ORIGIN).catch(function () { });
      DP.SDK.network.allowEndpoint("https://api.github.com").catch(function () { });
      DP.SDK.network.allowEndpoint("https://raw.githubusercontent.com").catch(function () { });
      DP.SDK.network.allowEndpoint("https://cdn.jsdelivr.net").catch(function () { });
      DP.SDK.network.allowEndpoint("https://cdn.staticaly.com").catch(function () { });
    }
    if (DP.checkUpdate) DP.checkUpdate(true);
  }

  function boot() {
    DP.loadChatSessions();
    DP.loadPromptPresets();
    bindTabs();
    bindActions();
    storeImageData();
    /* 按模块注册顺序执行各功能模块的初始化（绑定各自页面事件） */
    DP._inits.forEach(function (init) {
      try { init(); } catch (e) { console.error("[module init]", e); }
    });

    if (window.__photonSdk && window.__photonSdk.activate) {
      window.__photonSdk.activate(onSdkReady);
    } else {
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        if (window.__photonSdk && window.__photonSdk.activate) {
          clearInterval(timer);
          window.__photonSdk.activate(onSdkReady);
        } else if (tries > 100) {
          clearInterval(timer);
          DP.setFoot("SDK 未就绪，请重启 Photon 后重试");
        }
      }, 200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
