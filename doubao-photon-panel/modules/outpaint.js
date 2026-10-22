"use strict";

/* ========= 模块：outpaint —— 智能扩图 / 局部重绘（画布选区坐标联动） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  DP.registerInit(function () {
    var modeEl = DP.$("opMode");
    if (!modeEl) return;
    modeEl.addEventListener("change", function () {
      var m = modeEl.value;
      DP.$("opRatioRow").style.display = m === "outpaint" ? "" : "none";
      DP.$("opBboxRow").style.display = m === "inpaint" ? "" : "none";
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
          DP.setFoot("已从画布取图，并读取到选区坐标（已自动填入重绘区域）");
        } else {
          DP.setFoot("已从画布取图（未检测到选区，可手动填写重绘区域坐标）");
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
      var mode = DP.$("opMode").value;
      var prompt = DP.$("opPrompt").value.trim();
      var size = DP.$("opSize").value, model = DP.$("opModel").value;
      var body = {
        model: model,
        prompt: prompt,
        size: size,
        response_format: "b64_json",
        watermark: false,
        image: DP.state.op.uri
      };
      if (mode === "outpaint") {
        var ratio = DP.$("opRatio").value;
        if (!prompt) prompt = "将图片扩展为 " + ratio + " 的画幅，画面主体保持不变，向外延伸补充与现有内容、光影和风格一致的边缘，使整体自然连贯，无生硬拼接。";
        else prompt = "将图片扩展为 " + ratio + " 的画幅。" + prompt;
      } else {
        var l = parseInt(DP.$("opBboxL").value, 10), t = parseInt(DP.$("opBboxT").value, 10);
        var r = parseInt(DP.$("opBboxR").value, 10), b = parseInt(DP.$("opBboxB").value, 10);
        if (isNaN(l) || isNaN(t) || isNaN(r) || isNaN(b) || r <= l || b <= t) {
          DP.errInto("opResult", "请填写有效的重绘区域坐标（left top right bottom，需 right > left 且 bottom > top）");
          return;
        }
        if (!prompt) prompt = "将框选区域中的内容按画面整体风格重新绘制，保持画布其余部分完全不变。";
        prompt = "对图片中 <bbox>" + l + " " + t + " " + r + " " + b + "</bbox> 标记的区域执行编辑：" + prompt + " 画布其余部分保持不变。";
      }
      body.prompt = prompt;
      DP.clearErr("opResult"); DP.setBusy("opBusy", true);
      DP.imageGen(body).then(DP.resolveImage).then(function (r) {
        var tag = mode === "outpaint" ? "智能扩图" : "局部重绘";
        DP.imageResult("opResult", r.url, r.bytes, tag + " · " + model);
        DP.pushHistory(tag + " · " + model, r.bytes, r.url, prompt);
        DP.setFoot(tag + "完成，已记入历史");
      }).catch(function (e) { DP.errInto("opResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("opBusy", false); });
    });
  });
})();
