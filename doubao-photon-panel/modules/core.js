"use strict";

/* ========= 豆包 AI 创作 · Photon 原生插件面板 =========
   模块 0：core —— 基础设施 / 共享状态 / 网络 / Key / 画布 / 置入 / 模块注册表
   SDK: window.__photonSdk.activate(api => ...)          */

(function () {
  var DP = window.DP = window.DP || {};

  /* ---------- 常量与全局状态 ---------- */
  DP.SDK = null;                              // 激活后的 api
  DP.credId = "doubao.key";
  DP.ARK_ORIGIN = "https://ark.cn-beijing.volces.com";
  DP.ARK_BASE = DP.ARK_ORIGIN + "/api/v3";
  DP.TEXT_MODEL = "doubao-seed-2-1-pro-260628";
  DP.PLUGIN_VERSION = "1.8.5";                // 版本号集中管理（检查更新 / 打包命名）
  DP.autoGroupOn = false;                     // 默认关闭自动分组
  DP.state = {
    analyze: null,
    edit: [],
    merge: [],
    op: null,          // 扩图/重绘 参考图
    history: [],       // 生成历史（会话内）
    histSel: {},       // 图库多选：item.id → 1
    chatSessions: []   // 对话历史会话列表（localStorage 持久化）
  };

  /* ---------- 工具函数 ---------- */
  DP.$ = function (id) { return document.getElementById(id); };
  DP.setBusy = function (id, on) { DP.$(id).classList.toggle("on", !!on); };
  DP.setFoot = function (text) { DP.$("footStatus").textContent = text; };

  DP.bytesToBase64 = function (u8) {
    var bin = "";
    var chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(bin);
  };
  DP.base64ToBytes = function (b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  DP.dataURI = function (mime, b64) { return "data:" + mime + ";base64," + b64; };
  DP.esc = function (s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  DP.escAttr = function (s) {
    return DP.esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  DP.textResult = function (container, text) {
    var html = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">豆包结果</div>' +
      '<button class="btn small" data-act="copy" data-text="' + DP.escAttr(text) + '">复制</button></div>' +
      '<pre>' + DP.esc(text) + '</pre></div>';
    DP.$(container).innerHTML = html;
  };
  /* 把豆包方舟的常见接口错误转成友好中文提示（只改样式文本，不改调用方） */
  DP.friendlyErr = function (msg) {
    if (!msg) return msg;
    var s = String(msg);
    var head = "原始错误：";
    if (/429|TooManyRequests|SetLimitExceeded|usage limit|usage_limit|inference limit|Safe Experience|Free Tokens|安心体验|安全体验/.test(s)) {
      return "【额度不足】豆包方舟已暂停该模型服务（429 限额）。\n解决：\n1) 打开火山方舟控制台 →「开通管理」→ 找到对应模型 → 关闭「安全体验模式」或调高用量上限；\n2) 或在本面板把模型切换为 Seedream 5.0 Flash / 4.5 后再试。\n" + head + s.slice(0, 360);
    }
    if (/401|403|invalid api|authentication|unauthorized|鉴权|密钥/.test(s)) {
      return "【Key 无效】请检查面板右上角「配置 Key」里的 API Key 是否正确、是否已开通对应模型。\n" + head + s.slice(0, 300);
    }
    if (/insufficient|balance|余额/.test(s)) {
      return "【账户余额不足】请到火山引擎控制台充值后重试。\n" + head + s.slice(0, 300);
    }
    if (/timeout|ETIMEDOUT|网络|超时/.test(s)) {
      return "【请求超时】请检查网络后重试；生图通常需要 30-90 秒，请耐心等待。\n" + head + s.slice(0, 300);
    }
    return msg;
  };
  DP.errInto = function (container, message) {
    var box = DP.$(container);
    box.innerHTML = '<div class="errbox">' + DP.esc(DP.friendlyErr(message)) + "</div>";
  };
  DP.clearErr = function (container) {
    var box = DP.$(container);
    if (box) box.innerHTML = "";
  };

  /* ---------- 网络调用（经 Photon SDK 代理） ---------- */
  DP.sdkRequest = function (method, url, opts) {
    opts = opts || {};
    var payload = { method: method, url: url };
    if (opts.json !== undefined) payload.json = opts.json;
    if (opts.response === "bytes") payload.response = "bytes";
    payload.credential = { id: DP.credId, header: "Authorization", prefix: "Bearer " };
    return DP.SDK.network.request(payload);
  };
  DP.chat = function (messages, model) {
    return DP.sdkRequest("POST", DP.ARK_BASE + "/chat/completions", {
      json: { model: model || DP.TEXT_MODEL, messages: messages }
    });
  };
  DP.chatText = function (system, userText, model) {
    return DP.chat([
      { role: "system", content: system },
      { role: "user", content: userText }
    ], model).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
        throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
      }
      return r.body.choices[0].message.content;
    });
  };
  DP.imageGen = function (body) {
    return DP.sdkRequest("POST", DP.ARK_BASE + "/images/generations", { json: body })
      .then(function (r) {
        if (r.status !== 200) {
          var msg = (r.body && r.body.error && (r.body.error.message || r.body.error.code)) ||
            JSON.stringify(r.body || {}).slice(0, 300);
          throw new Error("生图接口错误 (" + r.status + ")：" + msg);
        }
        var items = (r.body && r.body.data) || [];
        if (!items.length) throw new Error("生图接口未返回图片数据。请检查：模型是否开通、余额是否充足。");
        var item = items[0];
        if (item.b64_json) return { b64: item.b64_json, url: item.url || null };
        if (item.url) return { b64: null, url: item.url };
        throw new Error("生图接口未返回 b64_json/url。请检查：模型是否开通、余额是否充足。");
      })
      .catch(function (e) {
        if (e && e.message && e.message.indexOf("permission") >= 0) {
          throw new Error(e.message + "\n请求地址: " + DP.ARK_BASE + "/images/generations\n若弹出了“Allow endpoint”窗口请点 Allow，然后重试。");
        }
        throw e;
      });
  };
  DP.downloadBytes = function (url) {
    return DP.sdkRequest("GET", url, { response: "bytes" }).then(function (r) {
      if (r.status !== 200 || !(r.body instanceof Uint8Array)) {
        throw new Error("图片下载失败 (" + r.status + ")，URL: " + url);
      }
      return r.body;
    });
  };
  /* 生图结果：优先 b64_json 直接解码，其次下载 URL */
  DP.resolveImage = function (img) {
    if (img.b64) return Promise.resolve({ url: img.url, bytes: DP.base64ToBytes(img.b64) });
    return DP.downloadBytes(img.url).then(function (b) { return { url: img.url, bytes: b }; });
  };

  /* ---------- 凭据（API Key） ---------- */
  DP.refreshKeyStatus = function () {
    if (!DP.SDK) return;
    DP.SDK.credentials.status(DP.credId).then(function (st) {
      var badge = DP.$("keyBadge");
      if (st && st.configured) {
        badge.innerHTML = '<span class="dot"></span>Key: 已配置';
        badge.className = "key-badge ok";
      } else {
        badge.innerHTML = '<span class="dot"></span>Key: 未配置';
        badge.className = "key-badge err";
      }
    }).catch(function () {
      var badge = DP.$("keyBadge");
      badge.innerHTML = '<span class="dot"></span>Key: 未配置';
      badge.className = "key-badge err";
    });
  };
  DP.configureKey = function () {
    if (!DP.SDK) return;
    DP.setFoot("正在请求安全输入窗口…");
    DP.SDK.credentials.configure(DP.credId, "豆包方舟 API Key", DP.ARK_ORIGIN)
      .then(function (st) {
        if (st && st.configured) {
          DP.setFoot("Key 已保存（系统加密存储）");
          DP.refreshKeyStatus();
        } else {
          DP.setFoot("未保存 Key");
          DP.refreshKeyStatus();
        }
      })
      .catch(function (e) { DP.setFoot("配置失败：" + (e && e.message || e)); });
  };

  /* ---------- 从画布取图（与软件互动） ---------- */
  DP.sdkProbe = function () {
    function keys(o) {
      try { return Object.keys(o).join(","); } catch (e) { return "?"; }
    }
    return "sdk={" + keys(DP.SDK) + "} documents={" + (DP.SDK.documents ? keys(DP.SDK.documents) : "无") +
      "} files={" + (DP.SDK.files ? keys(DP.SDK.files) : "无") + "}";
  };
  DP.shapeOf = function (res) {
    try {
      var out = {};
      for (var k in res) {
        var v = res[k];
        if (v instanceof Uint8Array) out[k] = "Uint8Array(" + v.length + ")";
        else if (v instanceof ArrayBuffer) out[k] = "ArrayBuffer(" + v.byteLength + ")";
        else if (v && typeof v === "object") out[k] = JSON.stringify(v).slice(0, 140);
        else out[k] = String(v);
      }
      return JSON.stringify(out);
    } catch (e) { return "?"; }
  };
  DP.toU8 = function (v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (Array.isArray(v)) return new Uint8Array(v);
    if (v && v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return null;
  };
  DP.normalizePixels = function (res) {
    var w = 0, h = 0, px = null;
    if (res && res.width > 0 && res.height > 0) { w = res.width; h = res.height; px = DP.toU8(res.pixels); }
    if (!px && res && res.image) { w = res.image.width; h = res.image.height; px = DP.toU8(res.image.pixels); }
    if (!px && res && res.data) { w = res.data.width; h = res.data.height; px = DP.toU8(res.data.pixels); }
    if (!px && res && res.pixels && res.sourceBounds) {
      var sb = res.sourceBounds;
      w = (sb.right != null && sb.left != null) ? (sb.right - sb.left) : (sb.width || 0);
      h = (sb.bottom != null && sb.top != null) ? (sb.bottom - sb.top) : (sb.height || 0);
      px = DP.toU8(res.pixels);
    }
    if (!px && res && res.pixels && res.options && res.options.width > 0) {
      w = res.options.width; h = res.options.height; px = DP.toU8(res.pixels);
    }
    if (!px) throw new Error("画布返回结构未识别：" + DP.shapeOf(res));
    if (w < 1 || h < 1) throw new Error("画布尺寸无法推断（" + DP.shapeOf(res) + "）");
    if (px.length !== w * h * 4) {
      if (px.length % 4 === 0 && w * h !== px.length / 4 && res && res.pixels && !res.width) {
        var area = px.length / 4, side = Math.round(Math.sqrt(area));
        if (side * side === area) { w = side; h = side; }
        else throw new Error("画布像素数据长度不匹配（期望 " + (w * h * 4) + "，实际 " + px.length + "）。" + DP.shapeOf(res));
      } else {
        throw new Error("画布像素数据长度不匹配（期望 " + (w * h * 4) + "，实际 " + px.length + "）。" + DP.shapeOf(res));
      }
    }
    var bounds = null;
    if (res && res.sourceBounds) {
      var sb2 = res.sourceBounds;
      bounds = { left: sb2.left, top: sb2.top, right: sb2.right, bottom: sb2.bottom };
    } else if (res && res.bounds) {
      var b2 = res.bounds;
      if (b2.left != null) bounds = { left: b2.left, top: b2.top, right: b2.right, bottom: b2.bottom };
      else if (b2.x != null) bounds = { left: b2.x, top: b2.y, right: b2.x + (b2.width || 0), bottom: b2.y + (b2.height || 0) };
    }
    return { w: w, h: h, pixels: px, bounds: bounds };
  };
  DP.rgbaToPNGDataURI = function (w, h, pixels) {
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    var imgData = ctx.createImageData(w, h);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  };
  DP.canvasToRef = function (opts) {
    opts = opts || {};
    return DP.SDK.documents.active().then(function (doc) {
      var docId = doc && (doc.documentId || doc.id);
      var docName = doc && (doc.name || doc.title || "当前文档");
      if (!docId) throw new Error("没有打开的文档，请先新建或打开画布");
      DP.canvasSeq = (DP.canvasSeq || 0) + 1;
      var attempts = [];
      if (opts.selection && DP.SDK.documents && typeof DP.SDK.documents.capture === "function") {
        attempts.push({ n: "capture-sel", f: function () { return DP.SDK.documents.capture({ selection: true }); } });
      }
      if (DP.SDK.documents && typeof DP.SDK.documents.capture === "function") {
        attempts.push({ n: "capture", f: function () { return DP.SDK.documents.capture({}); } });
      }
      if (DP.SDK.documents && typeof DP.SDK.documents.pixels === "function") {
        attempts.push({ n: "pixels", f: function () { return DP.SDK.documents.pixels({}); } });
      }
      if (!attempts.length) {
        return Promise.reject(new Error("SDK 未暴露画布取图方法。\nSDK 能力探测：" + DP.sdkProbe()));
      }
      var i = 0, lastErr = null;
      function next() {
        if (i >= attempts.length) {
          return Promise.reject(new Error("从画布取图失败。" + (lastErr ? "\n" + lastErr : "") + "\nSDK 能力：" + DP.sdkProbe()));
        }
        var a = attempts[i++];
        return Promise.resolve().then(a.f).catch(function (e) {
          lastErr = "[" + a.n + "] " + (e && e.message || e);
          return next();
        });
      }
      return next().then(function (res) {
        var norm = DP.normalizePixels(res);
        var token = res && res.token;
        if (token && DP.SDK.documents && typeof DP.SDK.documents.release === "function") {
          DP.SDK.documents.release({ token: token }).catch(function () { });
        }
        var uri = DP.rgbaToPNGDataURI(norm.w, norm.h, norm.pixels);
        var b64 = uri.split(",")[1] || "";
        if (b64.length > 10 * 1024 * 1024) throw new Error("画布过大（超过 10MB），请缩小画布尺寸后重试");
        return {
          path: "画布 · " + docName + " #" + DP.canvasSeq, mime: "image/png", b64: b64, uri: uri, docId: docId,
          bounds: norm.bounds || null
        };
      });
    });
  };

  /* ---------- 图片选择 / 处理 ---------- */
  DP.pickImage = function (multi) {
    return DP.SDK.files.pick({ folder: false, multi: multi ? true : undefined })
      .then(function (pathOrList) {
        if (!pathOrList) return null;
        if (multi) {
          var arr = Array.isArray(pathOrList) ? pathOrList : [pathOrList];
          if (!arr.length) return null;
          return Promise.all(arr.map(DP.readImage));
        }
        if (Array.isArray(pathOrList)) return DP.readImage(pathOrList[0]);
        return DP.readImage(pathOrList);
      });
  };
  DP.readImage = function (path) {
    return DP.SDK.files.read(path).then(function (u8) {
      if (!(u8 instanceof Uint8Array)) throw new Error("读取图片失败");
      var m = String(path).toLowerCase().match(/\.(png|jpe?g|webp)$/i);
      var mime = m ? (m[0] === ".png" ? "image/png" : (m[0] === ".webp" ? "image/webp" : "image/jpeg")) : "image/png";
      var b64 = DP.bytesToBase64(u8);
      if (b64.length > 10 * 1024 * 1024) throw new Error("图片过大（Base64 超过 10MB），请压缩后重试");
      return { path: String(path), mime: mime, b64: b64, uri: DP.dataURI(mime, b64) };
    });
  };
  DP.renderPicked = function (container, picked) {
    var box = DP.$(container);
    if (!picked) { box.innerHTML = ""; return; }
    if (Array.isArray(picked)) {
      box.innerHTML = picked.map(function (p) {
        return '<div class="picked"><img src="' + p.uri + '"><div class="pname">' + DP.esc(p.path) +
          '</div><button class="btn small" data-rm="' + DP.escAttr(p.path) + '">移除</button></div>';
      }).join("");
    } else {
      box.innerHTML = '<div class="picked"><img src="' + picked.uri + '"><div class="pname">' + DP.esc(picked.path) +
        '</div><button class="btn small" data-rm="' + DP.escAttr(picked.path) + '">移除</button></div>';
    }
  };

  /* ---------- 图片结果面板 ---------- */
  DP._layerStamp = function () {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  };
  DP.imageResult = function (container, url, bytes, label) {
    var b64 = DP.bytesToBase64(bytes);
    /* 图层名带时分秒，避免多次置入同名图层 */
    var uniqueLabel = (label || "豆包生成") + " " + DP._layerStamp();
    var html = '<div class="result"><div class="imgbox"><img src="' + DP.dataURI("image/png", b64) + '"></div>' +
      '<div class="meta">' + DP.esc(uniqueLabel) + " · " + bytes.length + " 字节 · <a href='" + DP.escAttr(url) + "' target='_blank' rel='noopener'>原图链接</a></div>" +
      '<div class="rbtns">' +
      '<button class="btn primary" data-act="place">置入画布</button>' +
      '<button class="btn" data-act="save">保存到本地</button>' +
      '<button class="btn" data-act="copyurl">复制链接</button>' +
      "</div></div>";
    var box = DP.$(container);
    box.innerHTML = html;
    box.__label = uniqueLabel;
    return { url: url, bytes: bytes, label: uniqueLabel };
  };

  /* ---------- 置入画布（先智能对象，再等比缩放，不拉伸） ---------- */
  DP.sdkExecute = function (op, params, docId) {
    if (DP.SDK.documents && typeof DP.SDK.documents.execute === "function") {
      return DP.SDK.documents.execute(op, params, docId);
    }
    return Promise.reject(new Error("SDK 未提供 documents.execute"));
  };
  DP.autoGroupLayer = function (docId, layerId) {
    if (!DP.autoGroupOn) return Promise.resolve();
    return DP.SDK.documents.active().then(function (doc2) {
      var layers = (doc2 && doc2.layers) || [];
      var grp = null;
      for (var i = 0; i < layers.length; i++) {
        var k = layers[i].kind || "";
        if ((k === "group" || k === "GROUP") && layers[i].name === "豆包生成") grp = layers[i];
      }
      if (!grp) {
        return DP.sdkExecute("core.layers.newGroup", { name: "豆包生成" }, docId).then(function (g) {
          var gid = g && (g.id || g.groupId || (g.layer && g.layer.id));
          if (!gid) throw new Error("新建组未返回组 ID");
          return DP.sdkExecute("core.layers.groupLayers", { ids: [gid, layerId] }, docId);
        });
      }
      return DP.sdkExecute("core.layers.groupLayers", { ids: [grp.id, layerId] }, docId);
    }).catch(function () { });
  };
  DP.placeOnCanvas = function (bytes, opts) {
    opts = opts || {};
    var label = opts.label || "豆包生成";
    return DP.SDK.images.decode(bytes).catch(function (e) {
      throw new Error("[decode] " + (e && e.message || e));
    }).then(function (img) {
      return DP.SDK.documents.active().then(function (doc) {
        var docId = doc && (doc.documentId || doc.id);
        if (!docId) throw new Error("没有打开的文档，请先新建或打开画布");
        var cw = doc.width, ch = doc.height;
        var iw = img.width, ih = img.height;
        if (!cw || !ch || !iw || !ih) throw new Error("[doc] 画布或图片尺寸无效");
        if (cw * ch > 16 * 1024 * 1024) {
          throw new Error("[doc] 画布过大（超过 1600 万像素），无法置入。请先缩小画布尺寸再试");
        }
        var s = Math.min(cw / iw, ch / ih);
        var tx = cw / 2 - s * iw / 2;
        var ty = ch / 2 - s * ih / 2;
        var placedLayerId = null, smartLayerId = null, placedName = null;
        return DP.SDK.documents.applyImage({
          documentId: docId,
          image: { width: iw, height: ih, pixels: img.pixels },
          name: "豆包生成"
        }).then(function (placed) {
          placedLayerId = placed && (placed.layerId || (placed.layer && placed.layer.id));
          if (!placedLayerId) throw new Error("[applyImage] 置入未返回图层 ID");
          return DP.sdkExecute("core.layers.convertToSmartObject", { ids: [placedLayerId] }, docId).catch(function (e) {
            throw new Error("[convertToSmartObject] " + (e && e.message || e));
          });
        }).then(function (conv) {
          return DP.SDK.documents.active().then(function (doc2) {
            var layers = (doc2 && doc2.layers) || [];
            var selId = doc2 && doc2.selectedLayerIds && doc2.selectedLayerIds[0];
            var isSmart = function (k) {
              return k === "smartObject" || k === "SMARTOBJECT" || k === "smartobject";
            };
            var lastSmart = null;
            var selSmart = null;
            for (var i = 0; i < layers.length; i++) {
              if (isSmart(layers[i].kind)) lastSmart = layers[i];
              if (selId && layers[i].id === selId && isSmart(layers[i].kind)) selSmart = layers[i];
            }
            var target = selSmart || lastSmart;
            var lid = (target && target.id) || selId || placedLayerId;
            smartLayerId = lid;
            placedName = target && target.name;
            var matrix = [s, 0, 0, s, tx, ty];
            return DP.sdkExecute("core.canvas.applyLayerTransform", {
              layerIds: [lid],
              matrix: matrix,
              interpolation: "bicubic"
            }, docId).catch(function (e) {
              throw new Error("[applyLayerTransform] " + (e && e.message || e));
            }).then(function (tr) {
              if (label && label !== placedName) {
                DP.sdkExecute("core.layers.renameLayer", { id: lid, name: label }, docId).catch(function () { });
              }
              if (DP.autoGroupOn) DP.autoGroupLayer(docId, lid);
              return {
                doc: doc, layerId: smartLayerId, scale: s,
                placed: true, smart: !!target, layerName: label,
                transformResult: tr
              };
            });
          });
        });
      });
    });
  };
  DP.saveToDisk = function (bytes) {
    return DP.SDK.files.pick({ save: true, name: "doubao_image.png" }).then(function (path) {
      if (!path) return null;
      return DP.SDK.files.write(path, bytes).then(function () { return path; });
    });
  };

  /* ---------- 模块注册表 ---------- */
  DP._inits = [];
  DP.registerInit = function (fn) { DP._inits.push(fn); };
  DP._actions = {};
  DP.registerAction = function (act, fn) { DP._actions[act] = fn; };
})();
