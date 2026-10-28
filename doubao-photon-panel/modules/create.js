"use strict";

/* ========= 模块：create —— AI 创作（文生图 + 图生图合并）
   无参考图 = 文生图；有参考图 = 图生图（含透明背景 / 反推提示词） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var revText = "";

  /* ---------- 尺寸：固定比例 / 自定义像素（二选一，随模型切换档位） ---------- */
  var GEN_SIZE_LIMITS = {
    "doubao-seedream-5-0-pro-260628":  { minPx: 921600,  maxPx: 4624220,  tiers: ["1K", "1.5K", "2K"] },
    "doubao-seedream-5-0-flash-260628": { minPx: 921600,  maxPx: 4624220,  tiers: ["1K", "1.5K", "2K"] },
    "doubao-seedream-4-5-251128":       { minPx: 3686400, maxPx: 16777216, tiers: ["2K", "4K"] }
  };
  var GEN_RATIOS_5 = {
    "1:1":  { "1K": "1024x1024", "1.5K": "1536x1536", "2K": "2048x2048" },
    "4:3":  { "1K": "1152x864",  "1.5K": "1792x1344", "2K": "2368x1776" },
    "3:4":  { "1K": "864x1152",  "1.5K": "1344x1792", "2K": "1776x2368" },
    "16:9": { "1K": "1424x800",  "1.5K": "2048x1152", "2K": "2816x1584" },
    "9:16": { "1K": "800x1424",  "1.5K": "1152x2048", "2K": "1584x2816" },
    "3:2":  { "1K": "1248x832",  "1.5K": "1872x1248", "2K": "2496x1664" },
    "2:3":  { "1K": "832x1248",  "1.5K": "1248x1872", "2K": "1664x2496" },
    "21:9": { "1K": "1568x672",  "1.5K": "2352x1008", "2K": "3136x1344" }
  };
  var GEN_RATIOS_45 = {
    "1:1":  { "2K": "2048x2048", "4K": "4096x4096" },
    "4:3":  { "2K": "2304x1728", "4K": "4704x3520" },
    "3:4":  { "2K": "1728x2304", "4K": "3520x4704" },
    "16:9": { "2K": "2848x1600", "4K": "5504x3040" },
    "9:16": { "2K": "1600x2848", "4K": "3040x5504" },
    "3:2":  { "2K": "2496x1664", "4K": "4992x3328" },
    "2:3":  { "2K": "1664x2496", "4K": "3328x4992" },
    "21:9": { "2K": "3136x1344", "4K": "6240x2656" }
  };

  function crSizeLimits(model) {
    return GEN_SIZE_LIMITS[model] || GEN_SIZE_LIMITS["doubao-seedream-5-0-pro-260628"];
  }
  function crRatioPx(model, tier, ratio) {
    var map = model === "doubao-seedream-4-5-251128" ? GEN_RATIOS_45 : GEN_RATIOS_5;
    var row = map[ratio];
    return row ? (row[tier] || "") : "";
  }
  function updateCrTiers() {
    var sel = DP.$("crSize");
    var lim = crSizeLimits(DP.$("crModel").value);
    sel.innerHTML = lim.tiers.map(function (t) {
      return '<option value="' + t + '">' + t + (t === "2K" ? " · 推荐" : "") + "</option>";
    }).join("");
  }
  function updateCrSizeInfo() {
    var model = DP.$("crModel").value;
    var lim = crSizeLimits(model);
    var hint = DP.$("crSizeHint");
    if (hint) {
      hint.textContent = "模型限制：总像素 " + lim.minPx.toLocaleString() + " ~ " + lim.maxPx.toLocaleString() + "，宽高比 1:16 ~ 16:1（生成时自动校验）";
    }
    var pxEl = DP.$("crSizePx");
    if (pxEl) {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var px = crRatioPx(model, DP.$("crSize").value, ratioEl ? ratioEl.dataset.ratio : "1:1");
      pxEl.value = px || "该档位暂不支持此比例";
    }
  }
  function crSizeValue() {
    var mode = "fixed";
    var radio = document.querySelector('input[name="crSizeMode"]:checked');
    if (radio) mode = radio.value;
    var model = DP.$("crModel").value;
    var lim = crSizeLimits(model);
    if (mode === "fixed") {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var ratio = ratioEl ? ratioEl.dataset.ratio : "1:1";
      var px = crRatioPx(model, DP.$("crSize").value, ratio);
      if (!px) { DP.errInto("crResult", "该档位暂不支持所选比例，请更换档位或比例"); return null; }
      return px;
    }
    var w = parseInt(DP.$("crW").value, 10), h = parseInt(DP.$("crH").value, 10);
    if (!w || !h || w <= 0 || h <= 0) { DP.errInto("crResult", "请输入有效的像素宽高（正整数）"); return null; }
    var total = w * h;
    var r = w / h;
    if (total < lim.minPx) {
      DP.errInto("crResult", "总像素不足：当前 " + total.toLocaleString() + " px，该模型最低需 " + lim.minPx.toLocaleString() + " px（例如 1280x720）");
      return null;
    }
    if (total > lim.maxPx) {
      DP.errInto("crResult", "总像素超出：当前 " + total.toLocaleString() + " px，该模型上限 " + lim.maxPx.toLocaleString() + " px，请减小宽或高");
      return null;
    }
    if (r < 1 / 16 || r > 16) {
      DP.errInto("crResult", "宽高比超出模型限制（1:16 ~ 16:1），当前为 1:" + (r < 1 ? (1 / r).toFixed(1) : r.toFixed(1)));
      return null;
    }
    return w + "x" + h;
  }

  /* ---------- 模式切换：无参考图 = 文生图；有参考图 = 图生图 ---------- */
  function updateCrMode() {
    var hasRef = !!(DP.state.create && DP.state.create[0]);
    var tagGen = DP.$("crModeTag"), tagEdit = DP.$("crModeTag2");
    if (tagGen) tagGen.classList.toggle("on", !hasRef);
    if (tagEdit) tagEdit.classList.toggle("on", hasRef);
    var hint = DP.$("crModeHint");
    if (hint) hint.textContent = hasRef ? "图生图模式：将按参考图生成/编辑" : "文生图模式：无参考图，纯文字生成";
    /* 透明背景仅图生图有意义，且仅 5.0 Pro/Flash 支持 */
    var wrap = DP.$("crTransparentWrap");
    if (wrap) wrap.classList.toggle("hidden", !hasRef);
    var m = DP.$("crModel").value;
    var ok = m === "doubao-seedream-5-0-pro-260628" || m === "doubao-seedream-5-0-flash-260628";
    var cb = DP.$("crTransparent");
    if (cb) {
      cb.disabled = !ok || !hasRef;
      if (!ok || !hasRef) cb.checked = false;
    }
  }

  /* 反推提示词动作：填入本页（合并后不再需要"去文生图"） */
  DP.registerAction("crFill", function () {
    DP.$("crPrompt").value = revText;
    DP.setFoot("已填入本页画面描述 / 编辑指令");
  });

  /* 供 boot 移除参考图后刷新模式提示 */
  DP.updateCrMode = updateCrMode;

  DP.registerInit(function () {
    /* ---------- 生成：无参考图 → 文生图；有参考图 → 图生图 ---------- */
    DP.$("crRun").addEventListener("click", function () {
      var prompt = DP.$("crPrompt").value.trim();
      if (!prompt) { DP.errInto("crResult", "请输入画面描述或编辑指令"); return; }
      DP.clearErr("crResult");
      var size = crSizeValue();
      if (!size) return;
      var model = DP.$("crModel").value;
      var hasRef = !!(DP.state.create && DP.state.create[0]);
      var body = { model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false };
      if (hasRef) {
        body.image = DP.state.create[0].uri;
        if (DP.$("crTransparent").checked) {
          body.background = "transparent";
          body.output_format = "png";
        }
      }
      DP.setBusy("crBusy", true);
      DP.imageGen(body)
        .then(DP.resolveImage)
        .then(function (r) {
          var label = (hasRef ? "图生图 · " : "文生图 · ") + model + (hasRef && DP.$("crTransparent").checked ? " · 透明" : "");
          DP.imageResult("crResult", r.url, r.bytes, label);
          DP.pushHistory(label, r.bytes, r.url, prompt);
          DP.setFoot((hasRef ? "编辑" : "生成") + "完成（" + size + "），已记入历史");
        })
        .catch(function (e) { DP.errInto("crResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("crBusy", false); });
    });

    /* ---------- 反推提示词 ---------- */
    DP.$("crReverse").addEventListener("click", function () {
      if (!DP.state.create || !DP.state.create[0]) { DP.errInto("crReverseOut", "请先选择一张参考图（本地或画布）"); return; }
      DP.clearErr("crReverseOut"); DP.setBusy("crRevBusy", true);
      var q = "分析这张参考图，反推可用于生成类似效果的结构化提示词：主体/材质/光影/构图/风格/色彩。输出英文+中文对照，直接给出提示词，不要解释。";
      var content = [
        { type: "text", text: q },
        { type: "image_url", image_url: { url: DP.state.create[0].uri } }
      ];
      DP.chat([{ role: "user", content: content }]).then(function (r) {
        if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
          throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
        }
        revText = r.body.choices[0].message.content;
        var box = DP.$("crReverseOut");
        box.innerHTML = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">反推提示词</div>' +
          '<button class="btn small" data-act="crFill">填入本页</button>' +
          '<button class="btn small" data-act="copy" data-text="' + DP.escAttr(revText) + '">复制</button></div>' +
          '<pre>' + DP.esc(revText) + '</pre></div>';
        DP.setFoot("提示词反推完成，可填入本页");
      }).catch(function (e) { DP.errInto("crReverseOut", DP.friendlyErr(e.message || String(e))); })
        .finally(function () { DP.setBusy("crRevBusy", false); });
    });

    /* ---------- 参考图：选图 / 画布取图（带并发锁，防连点） ---------- */
    DP.$("crPick").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      DP.pickImage(false).then(function (p) {
        DP.state.create = p ? [p] : [];
        DP.renderPicked("crPicked", p);
        updateCrMode();
      }).catch(function (e) { DP.errInto("crResult", e.message || String(e)); })
        .finally(function () { btn.disabled = false; });
    });
    DP.$("crCanvas").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      DP.setFoot("正在导出画布…");
      DP.canvasToRef().then(function (p) {
        DP.state.create = p ? [p] : [];
        DP.renderPicked("crPicked", p);
        updateCrMode();
        DP.setFoot("已从画布取图，当前为图生图模式");
      }).catch(function (e) {
        DP.errInto("crResult", e.message || String(e));
        DP.setFoot("从画布取图失败");
      }).finally(function () { btn.disabled = false; });
    });

    /* ---------- 尺寸互斥 + 模型切换 ---------- */
    document.querySelectorAll('input[name="crSizeMode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var custom = r.value === "custom" && r.checked;
        DP.$("crFixed").classList.toggle("hidden", custom);
        DP.$("crCustom").classList.toggle("hidden", !custom);
        updateCrSizeInfo();
      });
    });
    document.querySelectorAll(".genratio .ratio").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".genratio .ratio").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        updateCrSizeInfo();
      });
    });
    DP.$("crSize").addEventListener("change", updateCrSizeInfo);
    DP.$("crModel").addEventListener("change", function () {
      updateCrTiers();
      updateCrSizeInfo();
      updateCrMode();
      DP.setFoot("已切换模型：" + (DP.$("crModel").selectedOptions[0] ? DP.$("crModel").selectedOptions[0].textContent : DP.$("crModel").value));
    });
    updateCrTiers();
    updateCrSizeInfo();
    updateCrMode();
  });
})();
