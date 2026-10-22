"use strict";

/* ========= 模块：generate —— 文生图（固定比例 / 自定义像素双模式 + 模型切换） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

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

  function genSizeLimits(model) {
    return GEN_SIZE_LIMITS[model] || GEN_SIZE_LIMITS["doubao-seedream-5-0-pro-260628"];
  }
  function genRatioPx(model, tier, ratio) {
    var map = model === "doubao-seedream-4-5-251128" ? GEN_RATIOS_45 : GEN_RATIOS_5;
    var row = map[ratio];
    return row ? (row[tier] || "") : "";
  }
  function updateGenTiers() {
    var sel = DP.$("genSize");
    var lim = genSizeLimits(DP.$("genModel").value);
    sel.innerHTML = lim.tiers.map(function (t) {
      return '<option value="' + t + '">' + t + (t === "2K" ? " · 推荐" : "") + "</option>";
    }).join("");
  }
  function updateGenSizeInfo() {
    var model = DP.$("genModel").value;
    var lim = genSizeLimits(model);
    var hint = DP.$("genSizeHint");
    if (hint) {
      hint.textContent = "模型限制：总像素 " + lim.minPx.toLocaleString() + " ~ " + lim.maxPx.toLocaleString() + "，宽高比 1:16 ~ 16:1（生成时自动校验）";
    }
    var pxEl = DP.$("genSizePx");
    if (pxEl) {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var px = genRatioPx(model, DP.$("genSize").value, ratioEl ? ratioEl.dataset.ratio : "1:1");
      pxEl.value = px || "该档位暂不支持此比例";
    }
  }
  function genSizeValue() {
    var mode = "fixed";
    var radio = document.querySelector('input[name="genSizeMode"]:checked');
    if (radio) mode = radio.value;
    var model = DP.$("genModel").value;
    var lim = genSizeLimits(model);
    if (mode === "fixed") {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var ratio = ratioEl ? ratioEl.dataset.ratio : "1:1";
      var px = genRatioPx(model, DP.$("genSize").value, ratio);
      if (!px) { DP.errInto("genResult", "该档位暂不支持所选比例，请更换档位或比例"); return null; }
      return px;
    }
    var w = parseInt(DP.$("genW").value, 10), h = parseInt(DP.$("genH").value, 10);
    if (!w || !h || w <= 0 || h <= 0) { DP.errInto("genResult", "请输入有效的像素宽高（正整数）"); return null; }
    var total = w * h;
    var r = w / h;
    if (total < lim.minPx) {
      DP.errInto("genResult", "总像素不足：当前 " + total.toLocaleString() + " px，该模型最低需 " + lim.minPx.toLocaleString() + " px（例如 1280x720）");
      return null;
    }
    if (total > lim.maxPx) {
      DP.errInto("genResult", "总像素超出：当前 " + total.toLocaleString() + " px，该模型上限 " + lim.maxPx.toLocaleString() + " px，请减小宽或高");
      return null;
    }
    if (r < 1 / 16 || r > 16) {
      DP.errInto("genResult", "宽高比超出模型限制（1:16 ~ 16:1），当前为 1:" + (r < 1 ? (1 / r).toFixed(1) : r.toFixed(1)));
      return null;
    }
    return w + "x" + h;
  }

  DP.registerInit(function () {
    DP.$("genRun").addEventListener("click", function () {
      var prompt = DP.$("genPrompt").value.trim();
      if (!prompt) { DP.errInto("genResult", "请输入画面描述"); return; }
      DP.clearErr("genResult");
      var size = genSizeValue();
      if (!size) return;
      var model = DP.$("genModel").value;
      DP.setBusy("genBusy", true);
      DP.imageGen({ model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false })
        .then(DP.resolveImage)
        .then(function (r) {
          DP.imageResult("genResult", r.url, r.bytes, "文生图 · " + model);
          DP.pushHistory("文生图 · " + model, r.bytes, r.url, prompt);
          DP.setFoot("生成完成（" + size + "），已记入历史");
        })
        .catch(function (e) { DP.errInto("genResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("genBusy", false); });
    });
    document.querySelectorAll('input[name="genSizeMode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var custom = r.value === "custom" && r.checked;
        DP.$("genFixed").classList.toggle("dim", custom);
        DP.$("genCustom").classList.toggle("hidden", !custom);
        updateGenSizeInfo();
      });
    });
    document.querySelectorAll(".genratio .ratio").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".genratio .ratio").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        updateGenSizeInfo();
      });
    });
    DP.$("genSize").addEventListener("change", updateGenSizeInfo);
    DP.$("genModel").addEventListener("change", function () {
      updateGenTiers();
      updateGenSizeInfo();
      DP.setFoot("已切换模型：" + (DP.$("genModel").selectedOptions[0] ? DP.$("genModel").selectedOptions[0].textContent : DP.$("genModel").value));
    });
    updateGenTiers();
    updateGenSizeInfo();
  });
})();
