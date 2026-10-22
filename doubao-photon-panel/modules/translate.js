"use strict";

/* ========= 模块：translate —— 翻译（取原文联动文本图层；译文写层已按平台边界移除） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  function targetName(v) {
    var map = { en: "英语", zh: "中文", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语" };
    return map[v] || v;
  }

  function docSnapshot() {
    return DP.SDK.documents.active().then(function (doc) {
      if (!doc) return { docId: null, layers: [], selected: null };
      return {
        docId: doc.documentId || doc.id,
        layers: (doc.layers || []).filter(function (l) { return l.kind === "type"; }),
        selected: (doc.selectedLayerIds || [])[0] || null
      };
    });
  }

  /* 切到翻译页时刷新文本图层下拉（boot.bindTabs 调用） */
  DP.fillTrLayerOptions = function () {
    docSnapshot().then(function (info) {
      var sel = DP.$("trLayer");
      if (!sel) return;
      sel.innerHTML = "";
      if (!info.layers.length) {
        sel.innerHTML = '<option value="">（画布中没有文本图层）</option>';
        return;
      }
      var picked = false;
      info.layers.forEach(function (l) {
        var o = document.createElement("option");
        o.value = l.id;
        o.textContent = l.name + (l.id === info.selected ? "（当前选中）" : "");
        sel.appendChild(o);
        if (l.id === info.selected) { sel.value = l.id; picked = true; }
      });
      if (!picked) sel.value = info.layers[0].id;
      sel.title = info.docId ? "文档：" + (info.docId) : "";
    }).catch(function () { });
  };

  DP.registerInit(function () {
    DP.$("trRun").addEventListener("click", function () {
      var text = DP.$("trText").value;
      if (!text.trim()) { DP.errInto("trResult", "请输入要翻译的内容"); return; }
      var target = DP.$("trTarget").value, style = DP.$("trStyle").value;
      var lines = text.split(/\n/).filter(function (l) { return l.trim(); });
      if (!lines.length) { DP.errInto("trResult", "请输入要翻译的内容"); return; }
      DP.clearErr("trResult"); DP.setBusy("trBusy", true);
      var sys = "你是专业翻译。把用户内容翻译成" + targetName(target) + "，风格：" + style + "。" +
        "保持每行一段、行数一一对应，只输出译文不要任何解释。";
      DP.chatText(sys, text)
        .then(function (t) {
          var html = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">译文（' +
            lines.length + " 行，逐行对应原文）</div>" +
            '<button class="btn small" data-act="copy" data-text="' + DP.escAttr(t) + '">复制全部</button></div>' +
            "<pre>" + DP.esc(t) + "</pre></div>";
          DP.$("trResult").innerHTML = html;
        })
        .catch(function (e) { DP.errInto("trResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("trBusy", false); });
    });
    var getBtn = DP.$("trLayerGet");
    if (getBtn) {
      getBtn.addEventListener("click", function () {
        docSnapshot().then(function (info) {
          var lid = DP.$("trLayer").value;
          var layer = null;
          info.layers.forEach(function (l) { if (l.id === lid) layer = l; });
          if (!layer) {
            info.layers.forEach(function (l) { if (l.id === info.selected) layer = l; });
          }
          if (!layer) { DP.setFoot("未找到可用的文本图层，请先在画布中选择或创建文本图层"); return; }
          DP.$("trText").value = layer.name;
          DP.setFoot("已从文本图层取原文：" + layer.name);
        }).catch(function (e) { DP.setFoot("读取文本图层失败：" + (e.message || e)); });
      });
    }
  });
})();
