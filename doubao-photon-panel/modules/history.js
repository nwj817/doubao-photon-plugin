"use strict";

/* ========= 模块：history —— 生成图库（会话内历史 / 筛选 / 批量置入 / 导出） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var HISTORY_MAX = 20;
  var histSeq = 0;
  var histFilter = "全部";

  DP.pushHistory = function (label, bytes, url, prompt) {
    histSeq++;
    var item = {
      id: "h" + histSeq,
      label: label || "豆包生成",
      bytes: bytes,
      url: url || "",
      prompt: prompt || "",
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false })
    };
    DP.state.history.unshift(item);
    if (DP.state.history.length > HISTORY_MAX) DP.state.history.length = HISTORY_MAX;
    renderHistCats();
    renderHistory();
  };
  DP.histById = function (id) {
    for (var i = 0; i < DP.state.history.length; i++) if (DP.state.history[i].id === id) return DP.state.history[i];
    return null;
  };
  DP.histItems = function () {
    return DP.state.history.filter(function (it) { return histFilter === "全部" || (it.label || "").indexOf(histFilter) === 0; });
  };
  DP.updateHistBar = function () {
    var btn = DP.$("histPlaceSel");
    if (!btn) return;
    var sel = Object.keys(DP.state.histSel).length;
    btn.disabled = !sel;
    btn.textContent = "批量置入（" + sel + "）";
    var all = DP.$("histSelAll");
    if (all) all.checked = sel > 0 && sel === DP.histItems().length;
  };
  DP.placeHistItems = function (items) {
    if (!items.length) return Promise.resolve();
    var btn = DP.$("histPlaceSel");
    if (btn) { btn.disabled = true; btn.textContent = "置入中 " + items.length + " 张…"; }
    return items.reduce(function (p, it, k) {
      return p.then(function () {
        DP.setFoot("置入中（" + (k + 1) + "/" + items.length + "）…");
        return DP.placeOnCanvas(it.bytes, { label: (it.label || "豆包生成").split("·")[0].trim() + " · 置入" });
      });
    }, Promise.resolve()).then(function () {
      DP.setFoot("已批量置入 " + items.length + " 张（智能对象 + 等比适配）");
    }).catch(function (e) {
      DP.setFoot("批量置入中断：" + DP.friendlyErr(e.message || String(e)));
    }).finally(function () {
      if (btn) DP.updateHistBar();
    });
  };

  function renderHistCats() {
    var box = DP.$("histCats");
    if (!box) return;
    var cats = [];
    DP.state.history.forEach(function (it) {
      var c = (it.label || "").split("·")[0].trim();
      if (c && cats.indexOf(c) < 0) cats.push(c);
    });
    var html = '<button class="ratio' + (histFilter === "全部" ? " on" : "") + '" data-cat="全部">全部</button>';
    html += cats.map(function (c) {
      return '<button class="ratio' + (histFilter === c ? " on" : "") + '" data-cat="' + DP.escAttr(c) + '">' + DP.esc(c) + "</button>";
    }).join("");
    box.innerHTML = html;
  }
  function renderHistory() {
    var box = DP.$("histList");
    if (!box) return;
    if (!DP.state.history.length) {
      box.innerHTML = '<div class="hint" style="margin-top:6px">还没有生成记录。用文生图 / 图生图 / 多图融合 / 扩图重绘 / 对话生图生成图片后会自动记录，可随时置入画布或导出 PNG。</div>';
      return;
    }
    var items = DP.histItems();
    if (!items.length) {
      box.innerHTML = '<div class="hint" style="margin-top:6px">当前分类下没有记录，点上方「全部」查看所有。</div>';
      DP.updateHistBar();
      return;
    }
    var html = items.map(function (it) {
      var uri = DP.dataURI("image/png", DP.bytesToBase64(it.bytes));
      var checked = DP.state.histSel[it.id] ? " checked" : "";
      return '<div class="histitem" style="display:flex;gap:9px;align-items:center;background:var(--ph-slab);box-shadow:var(--ph-hairline);border-radius:var(--ph-radius-11);padding:8px 9px;margin-bottom:7px">' +
        '<input type="checkbox" class="histchk" data-id="' + it.id + '"' + checked + ' style="accent-color:var(--ph-accent);width:13px;height:13px;margin:0;flex:none;cursor:pointer">' +
        '<img src="' + uri + '" style="width:50px;height:50px;object-fit:cover;border-radius:var(--ph-radius-7);box-shadow:var(--ph-hairline);flex:none;background:var(--ph-black-1);cursor:pointer" data-act="histPreview" data-id="' + it.id + '" title="点击预览大图">' +
        '<div style="flex:1;min-width:0"><div style="font-size:var(--ph-text-meta);color:var(--ph-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + DP.esc(it.label) + "</div>" +
        '<div style="font-size:var(--ph-text-sm);color:var(--ph-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">' + DP.esc(it.time) +
        (it.prompt ? " · " + DP.esc(it.prompt.slice(0, 36)) : "") + "</div></div>" +
        '<button class="btn small" data-act="histSave" data-id="' + it.id + '" title="导出 PNG 到本地">保存 PNG</button>' +
        '<button class="btn small" data-act="histCloud" data-id="' + it.id + '" title="上传到云端仓库（WebDAV）">云</button>' +
        '<button class="btn small primary" data-act="histPlace" data-id="' + it.id + '">置入</button></div>';
    }).join("");
    box.innerHTML = html;
    DP.updateHistBar();
  }

  /* 图库动作（data-act 委托）：预览 / 置入 / 导出 */
  DP.registerAction("histPreview", function (btn) {
    var pv = DP.histById(btn.dataset.id);
    if (pv) {
      DP.$("histPrevImg").src = DP.dataURI("image/png", DP.bytesToBase64(pv.bytes));
      DP.$("histPreview").classList.remove("hidden");
    }
  });
  DP.registerAction("histPlace", function (btn) {
    var item = DP.histById(btn.dataset.id);
    if (!item) return;
    btn.disabled = true; btn.textContent = "置入中…";
    DP.placeOnCanvas(item.bytes, { label: item.label }).then(function (r) {
      btn.disabled = false; btn.textContent = "置入";
      if (r && r.smart) DP.setFoot("已从图库置入画布（智能对象 · 等比居中）" + (r.layerName ? "图层：" + r.layerName : ""));
      else if (r && r.placed) DP.setFoot("已从图库置入画布（等比居中）");
      else DP.setFoot("已置入当前文档");
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "置入"; DP.setFoot("置入失败：" + (e.message || e));
    });
  });
  DP.registerAction("histSave", function (btn) {
    var hs = DP.histById(btn.dataset.id);
    if (!hs) return;
    btn.disabled = true; btn.textContent = "保存中…";
    DP.saveToDisk(hs.bytes).then(function (path) {
      btn.disabled = false; btn.textContent = "保存 PNG";
      if (path) DP.setFoot("已保存：" + path);
      else DP.setFoot("已取消");
    }).catch(function (e) { btn.disabled = false; btn.textContent = "保存 PNG"; DP.setFoot("保存失败：" + (e.message || e)); });
  });

  /* 图库页事件绑定 */
  DP.registerInit(function () {
    DP.$("histClear").addEventListener("click", function () {
      DP.state.history = [];
      DP.state.histSel = {};
      renderHistCats();
      renderHistory();
      DP.setFoot("生成图库已清空");
    });
    DP.$("histPlaceSel").addEventListener("click", function () {
      var items = DP.state.history.filter(function (it) { return DP.state.histSel[it.id]; });
      if (!items.length) { DP.setFoot("请先勾选要置入的图片"); return; }
      DP.placeHistItems(items);
    });
    DP.$("histSelAll").addEventListener("change", function (ev) {
      var on = ev.target.checked;
      DP.histItems().forEach(function (it) {
        if (on) DP.state.histSel[it.id] = 1; else delete DP.state.histSel[it.id];
      });
      renderHistory();
    });
    DP.$("histPrevClose").addEventListener("click", function () {
      DP.$("histPreview").classList.add("hidden");
    });
    DP.$("histCats").addEventListener("click", function (ev) {
      var b = ev.target;
      if (!b || !b.classList || !b.classList.contains("ratio")) return;
      histFilter = b.dataset.cat || "全部";
      renderHistCats();
      renderHistory();
    });
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains("histchk")) {
        if (t.checked) DP.state.histSel[t.dataset.id] = 1;
        else delete DP.state.histSel[t.dataset.id];
        DP.updateHistBar();
      }
    });
    var ag = DP.$("autoGroup");
    if (ag) {
      DP.autoGroupOn = ag.checked;
      ag.addEventListener("change", function () {
        DP.autoGroupOn = ag.checked;
        DP.setFoot(DP.autoGroupOn ? "已开启：置入画布后自动整理进「豆包生成」组" : "已关闭自动分组");
      });
    }
  });
})();
