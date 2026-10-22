"use strict";

/* ========= 模块：presets —— 自定义提示词预设（保存 + 一键注入） =========
   服务对象：文生图 genPrompt / 图生图 editPrompt 两个输入框           */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var promptPresets = [];
  var presetSource = "gen";   // 预设弹层当前服务的输入框：gen → genPrompt，edit → editPrompt

  DP.loadPromptPresets = function () {
    try {
      var raw = localStorage.getItem("doubao.promptPresets");
      if (raw) promptPresets = JSON.parse(raw);
    } catch (e) { promptPresets = []; }
    if (!Array.isArray(promptPresets)) promptPresets = [];
  };
  DP.savePromptPresets = function () {
    try { localStorage.setItem("doubao.promptPresets", JSON.stringify(promptPresets.slice(0, 30))); } catch (e) {}
  };
  DP.presetTarget = function () {
    return presetSource === "edit" ? DP.$("editPrompt") : DP.$("genPrompt");
  };
  DP.presetSource = function () { return presetSource; };

  function openPresetPanel(src) {
    presetSource = src;
    renderPresetList();
    DP.$("presetPanel").classList.remove("hidden");
  }
  function renderPresetList() {
    var box = DP.$("presetList");
    if (!box) return;
    if (!promptPresets.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;margin-top:14px">还没有提示词预设。<br>在下栏输入名称，点「保存当前输入为预设」即可。</div>';
      return;
    }
    box.innerHTML = promptPresets.map(function (p, i) {
      return '<div class="sess-item" data-act="presetUse" data-idx="' + i + '">' +
        '<div class="sess-body"><div class="sess-title">' + DP.esc(p.name) + "</div>" +
        '<div class="sess-meta">' + DP.esc(p.text.length > 60 ? p.text.slice(0, 60) + "…" : p.text) + "</div></div>" +
        '<button class="btn small" data-act="presetDel" data-idx="' + i + '" title="删除该预设">删除</button></div>';
    }).join("");
  }

  /* 预设动作（data-act 委托） */
  DP.registerAction("presetUse", function (btn) {
    var pi = +btn.dataset.idx;
    if (!promptPresets[pi]) return;
    DP.presetTarget().value = promptPresets[pi].text;
    DP.$("presetPanel").classList.add("hidden");
    DP.setFoot("已注入预设：" + promptPresets[pi].name);
  });
  DP.registerAction("presetDel", function (btn) {
    var pj = +btn.dataset.idx;
    if (!promptPresets[pj]) return;
    promptPresets.splice(pj, 1);
    DP.savePromptPresets();
    renderPresetList();
    DP.setFoot("已删除该预设");
  });

  DP.registerInit(function () {
    DP.$("genPreset").addEventListener("click", function () { openPresetPanel("gen"); });
    DP.$("editPreset").addEventListener("click", function () { openPresetPanel("edit"); });
    DP.$("presetClose").addEventListener("click", function () { DP.$("presetPanel").classList.add("hidden"); });
    DP.$("presetSave").addEventListener("click", function () {
      var t = DP.presetTarget().value.trim();
      if (!t) { DP.setFoot("当前输入框为空，无法保存预设"); return; }
      var name = DP.$("presetName").value.trim() || ("预设 " + (promptPresets.length + 1));
      promptPresets.unshift({ name: name, text: t });
      DP.savePromptPresets();
      DP.$("presetName").value = "";
      renderPresetList();
      DP.setFoot("已保存预设：" + name);
    });
  });
})();
