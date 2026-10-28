"use strict";

/* ========= 模块：chat —— 统一对话（自由提问 / 快速·专家双模式 / 会话管理 / 对话内出图） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var chatAttachImg = null;
  var chatSaved = true;   // 当前会话是否已存档；消息变化后置 false
  var CHAT_SESS_MAX = 20;
  var CHAT_MODES = {
    fast: {
      model: "doubao-seed-1-6-flash-250828",
      label: "快速",
      desc: "Flash 快速模型 · 简短要点",
      sys: "（快速模式）请用简洁直接的语言回答，优先要点式短回复，通常控制在 5 句以内，不做冗长展开。"
    },
    expert: {
      model: DP.TEXT_MODEL,
      label: "专家",
      desc: "Seed 2.1 Pro · 深度思考",
      sys: "（专家模式）请以资深领域专家身份回答：深入分析问题，结构化分点阐述，提供关键细节、依据与可执行建议；涉及取舍时说明权衡。"
    }
  };
  var chatMode = "expert";

  /* 对话内出图：识别「生成/画/出一张…图」类意图，直接调生图接口 */
  var CHAT_GEN_RE = /^(生成|帮我生成|画|出张?|来张?)[^。！？\n]{0,24}(图|图片|图像)/;

  function updateChatModeHint() {
    var el = DP.$("chatModeHint");
    if (!el) return;
    var m = CHAT_MODES[chatMode] || CHAT_MODES.expert;
    el.textContent = m.label + "模式 · " + m.desc;
  }

  /* 会话历史：localStorage 持久化（不可用时降级为内存） */
  DP.loadChatSessions = function () {
    try {
      var raw = localStorage.getItem("doubao.chatSessions");
      if (raw) DP.state.chatSessions = JSON.parse(raw);
    } catch (e) { DP.state.chatSessions = []; }
    if (!Array.isArray(DP.state.chatSessions)) DP.state.chatSessions = [];
  };
  function saveChatSessions() {
    var list = DP.state.chatSessions.slice(0, CHAT_SESS_MAX);
    var json;
    try { json = JSON.stringify(list); } catch (e) { return; }
    if (json.length > 4 * 1024 * 1024) {
      list = list.map(function (s) {
        return { id: s.id, title: s.title, ts: s.ts,
          messages: s.messages.map(function (m) {
            if (m.image) return { role: m.role, text: (m.text || "") + "（附图已省略）", image: null };
            return m;
          }) };
      });
      json = JSON.stringify(list);
    }
    try { localStorage.setItem("doubao.chatSessions", json); } catch (e) {}
  }
  function chatSessionTitle(msgs) {
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== "user") continue;
      var t = (msgs[i].text || "").trim();
      if (t) return t.length > 24 ? t.slice(0, 24) + "…" : t;
      return "图片对话";
    }
    return "新对话";
  }
  function saveCurrentSession() {
    if (chatSaved || !DP.state.chat.length) return;
    var s = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: chatSessionTitle(DP.state.chat),
      mode: chatMode,
      ts: Date.now(),
      messages: DP.state.chat.slice()
    };
    DP.state.chatSessions.unshift(s);
    if (DP.state.chatSessions.length > CHAT_SESS_MAX) DP.state.chatSessions.length = CHAT_SESS_MAX;
    chatSaved = true;
    saveChatSessions();
  }
  DP.saveCurrentSession = saveCurrentSession;
  function restoreSession(s) {
    DP.state.chat = s.messages.slice();
    if (s.mode && CHAT_MODES[s.mode]) chatMode = s.mode;
    chatAttachImg = null;
    chatSaved = true;
    document.querySelectorAll(".chip[data-mode]").forEach(function (c) {
      c.classList.toggle("on", chatMode === c.dataset.mode);
    });
    updateChatModeHint();
    renderChat();
    renderChatAttach();
    scrollChat();
    DP.setFoot("已恢复会话：" + s.title + "（" + CHAT_MODES[chatMode].label + "模式）");
  }
  function renderChatSessions() {
    var box = DP.$("sessList");
    if (!box) return;
    if (!DP.state.chatSessions.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;margin-top:16px">暂无历史会话。<br>对话有内容后点「新建会话」，当前对话会自动存档到这里。</div>';
      return;
    }
    box.innerHTML = DP.state.chatSessions.map(function (s, i) {
      var d = new Date(s.ts);
      var time = d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) + " " +
        d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
      return '<div class="sess-item" data-act="sessOpen" data-idx="' + i + '">' +
        '<div class="sess-body"><div class="sess-title">' + DP.esc(s.title) + "</div>" +
        '<div class="sess-meta">' + time + " · " + s.messages.length + " 条消息" + "</div></div>" +
        '<button class="btn small" data-act="sessDel" data-idx="' + i + '" title="删除该会话">删除</button></div>';
    }).join("");
  }
  function openChatSessions() {
    saveCurrentSession();
    renderChatSessions();
    DP.$("chatSessions").classList.remove("hidden");
  }

  function chatSend() {
    var text = DP.$("chatInput").value.trim();
    var attach = chatAttachImg;
    if (!text && !attach) { DP.setFoot("请输入消息，或先选一张图片"); return; }
    DP.state.chat.push({ role: "user", text: text || "（附图）", image: attach });
    chatSaved = false;
    DP.$("chatInput").value = "";
    chatAttachImg = null;
    renderChatAttach();
    renderChat();
    scrollChat();
    if (text && CHAT_GEN_RE.test(text)) {
      DP.setBusy("chatBusy", true);
      var genBody = {
        model: "doubao-seedream-5-0-flash-260628",
        prompt: text,
        size: "2048x2048",
        response_format: "b64_json",
        watermark: false
      };
      if (attach) genBody.image = attach.uri;
      DP.imageGen(genBody).then(DP.resolveImage).then(function (r) {
        DP.state.chat.push({
          role: "assistant",
          text: "已生成" + (attach ? "（参考图模式）" : "（文生图）") + "：" + text,
          image: { uri: r.url, bytes: r.bytes }
        });
        DP.pushHistory("对话生图 · flash", r.bytes, r.url, text);
        renderChat();
        scrollChat();
        DP.setFoot("已在对话内生成图片，可点「置入画布」或到「生成图库」查看");
      }).catch(function (e) {
        DP.state.chat.push({ role: "error", text: DP.friendlyErr(e.message || String(e)) });
        renderChat();
        scrollChat();
      }).finally(function () { DP.setBusy("chatBusy", false); });
      return;
    }
    var msgs = [];
    if (CHAT_MODES[chatMode] && CHAT_MODES[chatMode].sys) msgs.push({ role: "system", content: CHAT_MODES[chatMode].sys });
    var recent = DP.state.chat.slice(-12);
    for (var i = 0; i < recent.length; i++) {
      var m = recent[i];
      if (m.role === "error") continue;
      if (m.image) {
        msgs.push({ role: m.role, content: [
          { type: "text", text: m.text },
          { type: "image_url", image_url: { url: m.image.uri } }
        ] });
      } else {
        msgs.push({ role: m.role, content: m.text });
      }
    }
    DP.setBusy("chatBusy", true);
    DP.chat(msgs, CHAT_MODES[chatMode].model).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
        throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
      }
      var reply = r.body.choices[0].message.content;
      DP.state.chat.push({ role: "assistant", text: reply });
      renderChat();
      scrollChat();
      DP.setFoot("已回复（会话内上下文最多保留最近 6 轮）");
    }).catch(function (e) {
      DP.state.chat.push({ role: "error", text: DP.friendlyErr(e.message || String(e)) });
      renderChat();
      scrollChat();
    }).finally(function () { DP.setBusy("chatBusy", false); });
  }

  function renderChat() {
    var box = DP.$("chatList");
    if (!box) return;
    if (!DP.state.chat.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;margin-top:16px">与豆包自由对话，直接提问即可。<br>支持文字与图片（选本地图片 / 从画布取图），可多轮追问。</div>';
      return;
    }
    box.innerHTML = DP.state.chat.map(function (m, idx) {
      var who = m.role === "user" ? "我" : "豆包";
      var imgHtml = m.image ? '<div class="imgwrap"><img src="' + m.image.uri + '"></div>' : "";
      var copyBtn = (m.role === "assistant" && m.text) ? '<button class="btn small" data-act="copy" data-text="' + DP.escAttr(m.text) + '">复制</button>' : "";
      var toGenBtn = (m.role === "assistant" && m.text) ? '<button class="btn small" data-act="chatToGen" data-text="' + DP.escAttr(m.text) + '">去生图</button>' : "";
      var placeBtn = (m.role === "assistant" && m.image) ? '<button class="btn small primary" data-act="chatPlace" data-idx="' + idx + '">置入画布</button>' : "";
      if (m.role === "error") {
        return '<div class="msg assistant"><div class="bubble errbubble">' + DP.esc(m.text) + "</div></div>";
      }
      if (m.role === "user") {
        return '<div class="msg user">' + imgHtml + '<div class="bubble">' + DP.esc(m.text || "") + "</div>" +
          '<div class="meta">' + who + "</div></div>";
      }
      return '<div class="msg assistant">' + '<div class="bubble">' + DP.esc(m.text || "") + "</div>" + imgHtml +
        '<div class="meta">' + who + placeBtn + copyBtn + toGenBtn + "</div></div>";
    }).join("");
  }

  function scrollChat() {
    var box = DP.$("chatList");
    if (box) box.scrollTop = box.scrollHeight;
  }
  function setChatAttach(p) {
    chatAttachImg = p;
    renderChatAttach();
    DP.setFoot("已附图：" + p.path + "（随下一条消息发送）");
  }
  function renderChatAttach() {
    var box = DP.$("chatAttach");
    if (!box) return;
    if (!chatAttachImg) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="picked"><img src="' + chatAttachImg.uri + '"><div class="pname">' + DP.esc(chatAttachImg.path) +
      '</div><button class="btn small" data-act="chatRmAttach">移除</button></div>';
  }

  /* 对话动作（data-act 委托） */
  DP.registerAction("chatRmAttach", function () {
    chatAttachImg = null;
    renderChatAttach();
    DP.setFoot("已移除附件图片");
  });
  DP.registerAction("chatToGen", function (btn) {
    DP.$("crPrompt").value = btn.dataset.text || "";
    var gtab = document.querySelector('.tab[data-view="create"]');
    if (gtab) gtab.click();
    DP.setFoot("已把回复填入 AI 创作，可修改后生成");
  });
  DP.registerAction("chatPlace", function (btn) {
    var cm = DP.state.chat[parseInt(btn.dataset.idx, 10)];
    if (!cm || !cm.image) return;
    btn.disabled = true; btn.textContent = "置入中…";
    DP.placeOnCanvas(cm.image.bytes, { label: "对话生图 · 置入" }).then(function (r) {
      btn.disabled = false; btn.textContent = "置入画布";
      if (r && r.smart) DP.setFoot("已置入画布并转为智能对象（等比居中，原始像素无损）");
      else if (r && r.placed) DP.setFoot("已置入画布（等比居中）");
      else DP.setFoot("已置入当前文档");
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "置入画布"; DP.setFoot("置入失败：" + (e.message || e));
    });
  });
  DP.registerAction("sessOpen", function (btn) {
    var idx = +btn.dataset.idx;
    if (!DP.state.chatSessions[idx]) return;
    var s = DP.state.chatSessions[idx];
    saveCurrentSession();
    DP.$("chatSessions").classList.add("hidden");
    restoreSession(s);
  });
  DP.registerAction("sessDel", function (btn) {
    var idx2 = +btn.dataset.idx;
    if (!DP.state.chatSessions[idx2]) return;
    DP.state.chatSessions.splice(idx2, 1);
    saveChatSessions();
    renderChatSessions();
    DP.setFoot("已删除该会话");
  });

  DP.registerInit(function () {
    DP.$("chatSend").addEventListener("click", chatSend);
    DP.$("chatInput").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); chatSend(); }
    });
    DP.$("chatNew").addEventListener("click", function () {
      saveCurrentSession();
      DP.state.chat = [];
      chatAttachImg = null;
      chatSaved = true;
      renderChat();
      renderChatAttach();
      DP.setFoot("已新建会话（旧对话已存档，可在「历史会话」找回）");
    });
    DP.$("chatHistory").addEventListener("click", openChatSessions);
    DP.$("sessClose").addEventListener("click", function () {
      DP.$("chatSessions").classList.add("hidden");
    });
    DP.$("chatPick").addEventListener("click", function () {
      DP.pickImage(false).then(function (p) { if (p) setChatAttach(p); })
        .catch(function (e) { DP.setFoot("选择图片失败：" + (e.message || e)); });
    });
    DP.$("chatCanvas").addEventListener("click", function () {
      DP.setFoot("正在读取画布内容…");
      DP.canvasToRef({}).then(function (p) { setChatAttach(p); })
        .catch(function (e) { DP.setFoot("从画布取图失败：" + (e.message || e)); });
    });
    document.querySelectorAll(".chip[data-mode]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip[data-mode]").forEach(function (c) { c.classList.remove("on"); });
        chip.classList.add("on");
        chatMode = chip.dataset.mode;
        updateChatModeHint();
        DP.setFoot("已切换" + CHAT_MODES[chatMode].label + "模式：" + CHAT_MODES[chatMode].desc);
      });
    });
    updateChatModeHint();
  });
})();
