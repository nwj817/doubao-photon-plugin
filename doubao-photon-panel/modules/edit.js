"use strict";

/* ========= 模块：edit —— 图生图（参考图 / 画布取图 / 透明背景）+ 提示词反推 ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var revText = "";

  /* 透明背景开关：仅 5.0 Pro/Flash 支持 */
  DP.updateEditTransparentState = function () {
    var m = DP.$("editModel").value;
    var ok = m === "doubao-seedream-5-0-pro-260628" || m === "doubao-seedream-5-0-flash-260628";
    DP.$("editTransparent").disabled = !ok;
    if (!ok) DP.$("editTransparent").checked = false;
  };

  /* 图生图动作（data-act 委托）：反推结果填入本页 / 去文生图 */
  DP.registerAction("editFill", function () {
    DP.$("editPrompt").value = revText;
    DP.setFoot("已填入本页编辑指令");
  });
  DP.registerAction("toGenFill", function () {
    DP.$("genPrompt").value = revText;
    var gtab2 = document.querySelector('.tab[data-view="generate"]');
    if (gtab2) gtab2.click();
    DP.setFoot("已填入文生图画面描述");
  });

  DP.registerInit(function () {
    /* 图生图：运行 + 反推 */
    DP.$("editRun").addEventListener("click", function () {
      if (!DP.state.edit.length) { DP.errInto("editResult", "请先选择一张参考图"); return; }
      var prompt = DP.$("editPrompt").value.trim();
      if (!prompt) { DP.errInto("editResult", "请输入编辑指令"); return; }
      var size = DP.$("editSize").value, model = DP.$("editModel").value;
      var body = { model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false, image: DP.state.edit[0].uri };
      if (DP.$("editTransparent").checked) {
        body.background = "transparent";
        body.output_format = "png";
      }
      DP.clearErr("editResult"); DP.setBusy("editBusy", true);
      DP.imageGen(body)
        .then(DP.resolveImage)
        .then(function (r) {
          DP.imageResult("editResult", r.url, r.bytes, "图生图 · " + model + (DP.$("editTransparent").checked ? " · 透明" : ""));
          DP.pushHistory("图生图 · " + model, r.bytes, r.url, prompt);
          DP.setFoot("编辑完成，已记入历史");
        })
        .catch(function (e) { DP.errInto("editResult", e.message || String(e)); })
        .finally(function () { DP.setBusy("editBusy", false); });
    });
    DP.$("editReverse").addEventListener("click", function () {
      if (!DP.state.edit || !DP.state.edit[0]) { DP.errInto("editReverseOut", "请先选择一张参考图（本地或画布）"); return; }
      DP.clearErr("editReverseOut"); DP.setBusy("editRevBusy", true);
      var q = "分析这张参考图，反推可用于生成类似效果的结构化提示词：主体/材质/光影/构图/风格/色彩。输出英文+中文对照，直接给出提示词，不要解释。";
      var content = [
        { type: "text", text: q },
        { type: "image_url", image_url: { url: DP.state.edit[0].uri } }
      ];
      DP.chat([{ role: "user", content: content }]).then(function (r) {
        if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
          throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
        }
        revText = r.body.choices[0].message.content;
        var box = DP.$("editReverseOut");
        box.innerHTML = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">反推提示词</div>' +
          '<button class="btn small" data-act="editFill">填入本页</button>' +
          '<button class="btn small" data-act="toGenFill">去文生图</button>' +
          '<button class="btn small" data-act="copy" data-text="' + DP.escAttr(revText) + '">复制</button></div>' +
          '<pre>' + DP.esc(revText) + '</pre></div>';
        DP.setFoot("提示词反推完成，可填入本页或去文生图");
      }).catch(function (e) { DP.errInto("editReverseOut", DP.friendlyErr(e.message || String(e))); })
        .finally(function () { DP.setBusy("editRevBusy", false); });
    });

    /* 图生图：选图 / 画布取图 / 移除联动（data-rm 由 boot 统一处理） */
    DP.$("editPick").addEventListener("click", function () {
      DP.pickImage(false).then(function (p) {
        DP.state.edit = p ? [p] : [];
        DP.renderPicked("editPicked", p);
      }).catch(function (e) { DP.errInto("editResult", e.message || String(e)); });
    });
    DP.$("editCanvas").addEventListener("click", function () {
      DP.setFoot("正在导出画布…");
      DP.canvasToRef().then(function (p) {
        DP.state.edit = p ? [p] : [];
        DP.renderPicked("editPicked", p);
        DP.setFoot("已从画布取图");
      }).catch(function (e) {
        DP.errInto("editResult", e.message || String(e));
        DP.setFoot("从画布取图失败");
      });
    });

    DP.$("editModel").addEventListener("change", DP.updateEditTransparentState);
  });
})();
