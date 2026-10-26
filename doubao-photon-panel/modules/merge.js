"use strict";

/* ========= 模块：merge —— 多图融合（多参考图 + 融合指令） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  DP.registerInit(function () {
    DP.$("mergeRun").addEventListener("click", function () {
      if (DP.state.merge.length < 2) { DP.errInto("mergeResult", "请至少选择 2 张参考图"); return; }
      var prompt = DP.$("mergePrompt").value.trim();
      if (!prompt) { DP.errInto("mergeResult", "请输入融合指令"); return; }
      var size = DP.$("mergeSize").value, model = DP.$("mergeModel").value;
      DP.clearErr("mergeResult"); DP.setBusy("mergeBusy", true);
      DP.imageGen({ model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false, image: DP.state.merge.map(function (p) { return p.uri; }) })
        .then(DP.resolveImage)
        .then(function (r) {
          DP.imageResult("mergeResult", r.url, r.bytes, "多图融合 · " + model);
          DP.pushHistory("多图融合 · " + model, r.bytes, r.url, prompt);
          DP.setFoot("融合完成，已记入历史");
        })
        .catch(function (e) { DP.errInto("mergeResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("mergeBusy", false); });
    });
    /* SDK.files.pick 宿主只返回单个文件，故改为「点一次加一张」追加模式 */
    DP.$("mergePick").addEventListener("click", function () {
      var btn = this;
      btn.disabled = true;
      DP.pickImage(false).then(function (p) {
        if (!p) return;
        DP.state.merge = DP.state.merge || [];
        if (DP.state.merge.length >= 14) {
          DP.errInto("mergeResult", "最多 14 张参考图，请先移除多余的");
          return;
        }
        DP.state.merge.push(p);
        DP.renderPicked("mergePicked", DP.state.merge);
        DP.setFoot("已添加本地图片（" + DP.state.merge.length + " 张，可继续点按钮添加）");
      }).catch(function (e) { DP.errInto("mergeResult", e.message || String(e)); })
        .finally(function () { btn.disabled = false; });
    });
    DP.$("mergeCanvas").addEventListener("click", function () {
      DP.setFoot("正在导出画布…");
      DP.canvasToRef().then(function (p) {
        DP.state.merge = DP.state.merge || [];
        DP.state.merge.push(p);
        DP.renderPicked("mergePicked", DP.state.merge);
        DP.setFoot("已从画布取图（" + DP.state.merge.length + " 张）");
      }).catch(function (e) {
        DP.errInto("mergeResult", e.message || String(e));
        DP.setFoot("从画布取图失败");
      });
    });
  });
})();
