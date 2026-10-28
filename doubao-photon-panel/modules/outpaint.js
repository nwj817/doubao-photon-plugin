"use strict";

/* ========= 模块：outpaint —— 智能编辑（擦除 / 标记改图 / 扩图 / 变清晰） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var MODE_NAMES = { erase: "擦除", inpaint: "标记改图", outpaint: "扩图", enhance: "变清晰" };

  function currentMode() {
    var card = document.querySelector("#opMode .opmode-card.on");
    return card ? card.dataset.opmode : "erase";
  }

  /* 模式切换：决定显示区域 / 比例 / 指令区 */
  function updateOpUI() {
    var m = currentMode();
    document.querySelectorAll("#opMode .opmode-card").forEach(function (c) {
      c.classList.toggle("on", c.dataset.opmode === m);
    });
    DP.$("opRegionRow").style.display = (m === "erase" || m === "inpaint") ? "" : "none";
    DP.$("opRatioRow").style.display = m === "outpaint" ? "" : "none";
    DP.$("opPromptWrap").style.display = m === "erase" ? "none" : "";
    DP.$("opEnhanceHint").classList.toggle("hidden", m !== "enhance");
    DP.setFoot("智能编辑 · 模式：" + MODE_NAMES[m]);
  }

  function readBbox() {
    var l = parseInt(DP.$("opBboxL").value, 10), t = parseInt(DP.$("opBboxT").value, 10);
    var r = parseInt(DP.$("opBboxR").value, 10), b = parseInt(DP.$("opBboxB").value, 10);
    if (isNaN(l) || isNaN(t) || isNaN(r) || isNaN(b) || r <= l || b <= t) return null;
    return l + " " + t + " " + r + " " + b;
  }

  DP.registerInit(function () {
    document.querySelectorAll("#opMode .opmode-card").forEach(function (card) {
      card.addEventListener("click", function () {
        document.querySelectorAll("#opMode .opmode-card").forEach(function (c) { c.classList.remove("on"); });
        card.classList.add("on");
        updateOpUI();
      });
    });

    DP.$("opPick").addEventListener("click", function () {
      DP.pickImage(false).then(function (p) {
        if (!p) return;
        DP.state.op = p;
        DP.renderPicked("opPicked", p);
        DP.setFoot("已选择参考图：" + p.path);
      }).catch(function (e) { DP.errInto("opResult", e.message || String(e)); });
    });
    DP.$("opCanvas").addEventListener("click", function () {
      DP.setFoot("正在读取画布内容…");
      DP.canvasToRef({ selection: true }).then(function (p) {
        DP.state.op = p;
        DP.renderPicked("opPicked", p);
        if (p.bounds) {
          DP.$("opBboxL").value = Math.round(p.bounds.left);
          DP.$("opBboxT").value = Math.round(p.bounds.top);
          DP.$("opBboxR").value = Math.round(p.bounds.right);
          DP.$("opBboxB").value = Math.round(p.bounds.bottom);
          DP.setFoot("已从画布取图，并读取到选区坐标（已自动填入目标区域）");
        } else {
          DP.setFoot("已从画布取图（未检测到选区，可手动填写目标区域坐标）");
        }
      }).catch(function (e) { DP.errInto("opResult", e.message || String(e)); DP.setFoot("从画布取图失败"); });
    });
    DP.$("opBboxSel").addEventListener("click", function () {
      if (!DP.state.op) { DP.errInto("opResult", "请先取一张参考图（建议先点「从画布取图」）"); return; }
      DP.setFoot("正在读取画布选区…");
      DP.canvasToRef({ selection: true }).then(function (p) {
        if (p.bounds) {
          DP.$("opBboxL").value = Math.round(p.bounds.left);
          DP.$("opBboxT").value = Math.round(p.bounds.top);
          DP.$("opBboxR").value = Math.round(p.bounds.right);
          DP.$("opBboxB").value = Math.round(p.bounds.bottom);
          DP.setFoot("已读取画布选区坐标并填入");
        } else {
          DP.setFoot("未检测到选区：请在画布中用选区工具框选区域，或手动填写坐标");
        }
      }).catch(function (e) { DP.errInto("opResult", e.message || String(e)); DP.setFoot("读取画布选区失败：" + (e.message || e)); });
    });

    DP.$("opRun").addEventListener("click", function () {
      if (!DP.state.op) { DP.errInto("opResult", "请先选择一张参考图（本地文件或画布内容）"); return; }
      var m = currentMode();
      var prompt = DP.$("opPrompt").value.trim();
      var size = DP.$("opSize").value, model = DP.$("opModel").value;
      var body = {
        model: model,
        size: size,
        response_format: "b64_json",
        watermark: false,
        image: DP.state.op.uri
      };

      if (m === "erase") {
        var bboxE = readBbox();
        if (!bboxE) { DP.errInto("opResult", "请填写有效的目标区域坐标（left top right bottom，需 right > left 且 bottom > top）"); return; }
        prompt = "移除图片中 <bbox>" + bboxE + "</bbox> 标记区域内的物体、人物或痕迹，用周围环境自然填充，保持光影、材质与整体画质一致，画布其余部分保持不变。";
      } else if (m === "inpaint") {
        var bboxI = readBbox();
        if (!bboxI) { DP.errInto("opResult", "请填写有效的目标区域坐标（left top right bottom，需 right > left 且 bottom > top）"); return; }
        if (!prompt) prompt = "将框选区域中的内容按画面整体风格重新绘制，保持画布其余部分完全不变。";
        prompt = "对图片中 <bbox>" + bboxI + "</bbox> 标记的区域执行编辑：" + prompt + " 画布其余部分保持不变。";
      } else if (m === "outpaint") {
        var ratio = DP.$("opRatio").value;
        if (!prompt) prompt = "将图片扩展为 " + ratio + " 的画幅，画面主体保持不变，向外延伸补充与现有内容、光影和风格一致的边缘，使整体自然连贯，无生硬拼接。";
        else prompt = "将图片扩展为 " + ratio + " 的画幅。" + prompt;
      } else { /* enhance */
        if (!prompt) prompt = "对整张图片执行画质增强：去除噪点与压缩伪影，提升清晰度与细节锐度，改善光影层次与色彩通透度，保持主体内容、构图与画面结构完全不变。";
        else prompt = "对整张图片执行画质增强：" + prompt + " 保持主体内容、构图与画面结构完全不变。";
      }
      body.prompt = prompt;
      DP.clearErr("opResult"); DP.setBusy("opBusy", true);
      DP.imageGen(body).then(DP.resolveImage).then(function (r) {
        var tag = MODE_NAMES[m];
        DP.imageResult("opResult", r.url, r.bytes, tag + " · " + model);
        DP.pushHistory(tag + " · " + model, r.bytes, r.url, prompt);
        DP.setFoot(tag + "完成，已记入历史");
      }).catch(function (e) { DP.errInto("opResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("opBusy", false); });
    });

    updateOpUI();
  });
})();
