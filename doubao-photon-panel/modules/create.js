"use strict";

/* ========= 模块：create —— AI 创作（文生图 / 图生图 / 多图融合）
   0 张参考图 = 文生图；1 张 = 图生图；2-14 张 = 多图融合（Seedream 4.5） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var revText = "";
  var MAX_REFS = 14;

  /* ---------- 尺寸：固定比例（随模型切换档位） ---------- */
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
    var pxEl = DP.$("crSizePx");
    if (pxEl) {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var px = crRatioPx(model, DP.$("crSize").value, ratioEl ? ratioEl.dataset.ratio : "1:1");
      pxEl.value = px || "该档位暂不支持此比例";
    }
  }
  function crSizeValue() {
    var model = DP.$("crModel").value;
    var ratioEl = document.querySelector(".genratio .ratio.on");
    var ratio = ratioEl ? ratioEl.dataset.ratio : "1:1";
    var px = crRatioPx(model, DP.$("crSize").value, ratio);
    if (!px) { DP.errInto("crResult", "该档位暂不支持所选比例，请更换档位或比例"); return null; }
    return px;
  }

  function refCount() {
    return (DP.state.create && DP.state.create.length) || 0;
  }
  function modeName() {
    var n = refCount();
    return n >= 2 ? "merge" : (n === 1 ? "edit" : "gen");
  }

  /* ---------- 模式切换：0 = 文生图，1 = 图生图，≥2 = 多图融合 ---------- */
  function updateCrMode() {
    var m = modeName();
    var n = refCount();
    var tagGen = DP.$("crModeTag"), tagEdit = DP.$("crModeTag2"), tagMerge = DP.$("crModeTag3");
    if (tagGen) tagGen.classList.toggle("on", m === "gen");
    if (tagEdit) tagEdit.classList.toggle("on", m === "edit");
    if (tagMerge) tagMerge.classList.toggle("on", m === "merge");
    var hint = DP.$("crModeHint");
    if (hint) {
      if (m === "gen") hint.textContent = "文生图模式：无参考图，纯文字生成";
      else if (m === "edit") hint.textContent = "图生图模式：按参考图生成 / 编辑";
      else hint.textContent = "多图融合模式：已选 " + n + " 张参考图，请填写融合指令";
    }
    var label = DP.$("crPromptLabel");
    if (label) label.textContent = m === "merge" ? "融合指令" : (m === "edit" ? "画面描述 / 编辑指令" : "画面描述");
    var ta = DP.$("crPrompt");
    if (ta) {
      ta.placeholder = m === "merge" ? "例：将参考图中的产品放入参考图的场景中，保持产品外观与场景光影一致" :
        (m === "edit" ? "写编辑指令（例：背景改为浅灰渐变，保留产品光影与透视，外壳改为黑色皮革材质）" :
          "描述画面（例：白色磁吸补光灯悬浮在深色背景中，C4D超写实渲染，产品居中，柔和环形光效）");
    }
    /* 各模式专属参数显隐 */
    var isMerge = m === "merge";
    DP.$("crFixed").classList.toggle("hidden", isMerge);
    DP.$("crSizeLabel").classList.toggle("hidden", isMerge);
    DP.$("crModelRow").classList.toggle("hidden", isMerge);
    DP.$("crMergeRow").classList.toggle("hidden", !isMerge);
    /* 透明背景仅图生图有意义，且仅 5.0 Pro/Flash 支持 */
    var wrap = DP.$("crTransparentWrap");
    if (wrap) wrap.classList.toggle("hidden", m !== "edit");
    var mm = DP.$("crModel").value;
    var ok = mm === "doubao-seedream-5-0-pro-260628" || mm === "doubao-seedream-5-0-flash-260628";
    var cb = DP.$("crTransparent");
    if (cb) {
      cb.disabled = !ok || m !== "edit";
      if (!ok || m !== "edit") cb.checked = false;
    }
  }

  /* 反推提示词动作：填入本页 */
  DP.registerAction("crFill", function () {
    DP.$("crPrompt").value = revText;
    DP.setFoot("已填入本页画面描述 / 编辑指令");
  });

  /* 供 boot 移除参考图后刷新模式提示 */
  DP.updateCrMode = updateCrMode;
  DP.refCount = refCount;

  DP.registerInit(function () {
    /* ---------- 生成：0 张文生图 / 1 张图生图 / ≥2 融合 ---------- */
    DP.$("crRun").addEventListener("click", function () {
      var prompt = DP.$("crPrompt").value.trim();
      var m = modeName();
      if (!prompt) {
        DP.errInto("crResult", m === "merge" ? "请输入融合指令" : "请输入画面描述或编辑指令");
        return;
      }
      DP.clearErr("crResult");
      var body = { prompt: prompt, response_format: "b64_json", watermark: false };
      var label;
      if (m === "merge") {
        body.model = DP.$("crMergeModel").value;
        body.size = DP.$("crMergeSize").value;
        body.image = DP.state.create.map(function (p) { return p.uri; });
        label = "多图融合 · " + body.model;
      } else {
        var size = crSizeValue();
        if (!size) return;
        body.model = DP.$("crModel").value;
        body.size = size;
        if (m === "edit") {
          body.image = DP.state.create[0].uri;
          if (DP.$("crTransparent").checked) {
            body.background = "transparent";
            body.output_format = "png";
          }
          label = "图生图 · " + body.model + (DP.$("crTransparent").checked ? " · 透明" : "");
        } else {
          label = "文生图 · " + body.model;
        }
      }
      DP.setBusy("crBusy", true);
      DP.imageGen(body)
        .then(DP.resolveImage)
        .then(function (r) {
          DP.imageResult("crResult", r.url, r.bytes, label);
          DP.pushHistory(label, r.bytes, r.url, prompt);
          DP.setFoot("完成（" + (m === "merge" ? DP.$("crMergeSize").value : crSizeValue()) + "），已记入历史");
        })
        .catch(function (e) { DP.errInto("crResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("crBusy", false); });
    });

    /* ---------- 反推提示词（使用第一张参考图） ---------- */
    DP.$("crReverse").addEventListener("click", function () {
      if (!DP.state.create || !DP.state.create[0]) { DP.errInto("crReverseOut", "请先添加一张参考图（本地或画布）"); return; }
      DP.clearErr("crReverseOut"); DP.setBusy("crRevBusy", true);
      var q = "分析这张参考图，反推用于生成类似效果的中文提示词：把正向提示词与负向提示词合并成一段完整描述（包含主体/材质/光影/构图/风格/色彩，以及需要避免的瑕疵与负面要素）。只输出合并后的中文提示词，不要输出英文，不要解释。";
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

    /* ---------- 参考图：追加模式（点一次加一张，上限 14） ---------- */
    DP.$("crPick").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      DP.pickImage(false).then(function (p) {
        if (!p) return;
        DP.state.create = DP.state.create || [];
        if (DP.state.create.length >= MAX_REFS) {
          DP.errInto("crResult", "最多 " + MAX_REFS + " 张参考图，请先移除多余的");
          return;
        }
        DP.state.create.push(p);
        DP.renderPicked("crPicked", DP.state.create);
        updateCrMode();
        DP.setFoot("已添加本地图片（" + DP.state.create.length + " 张，可继续点按钮添加）");
      }).catch(function (e) { DP.errInto("crResult", e.message || String(e)); })
        .finally(function () { btn.disabled = false; });
    });
    DP.$("crCanvas").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      DP.setFoot("正在导出画布…");
      DP.canvasToRef().then(function (p) {
        if (!p) return;
        DP.state.create = DP.state.create || [];
        if (DP.state.create.length >= MAX_REFS) {
          DP.errInto("crResult", "最多 " + MAX_REFS + " 张参考图，请先移除多余的");
          return;
        }
        DP.state.create.push(p);
        DP.renderPicked("crPicked", DP.state.create);
        updateCrMode();
        DP.setFoot("已从画布取图（" + DP.state.create.length + " 张）");
      }).catch(function (e) {
        DP.errInto("crResult", e.message || String(e));
        DP.setFoot("从画布取图失败");
      }).finally(function () { btn.disabled = false; });
    });

    /* ---------- 尺寸 + 模型切换 ---------- */
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
