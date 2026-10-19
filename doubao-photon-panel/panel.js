"use strict";

/* ========= 豆包 AI 创作 - Photon 原生插件面板逻辑 ========= */
/* SDK: window.__photonSdk.activate(api => ...)                    */
/* 网络: api.network.request（主进程代理，权限白名单+凭据引用）       */

(function () {
  var SDK = null;          // 激活后的 api
  var credId = "doubao.key";
  var ARK_ORIGIN = "https://ark.cn-beijing.volces.com";
  var ARK_BASE = ARK_ORIGIN + "/api/v3";
  var TEXT_MODEL = "doubao-seed-2-1-pro-260628";

  /* ---------- 工具函数 ---------- */
  function $(id) { return document.getElementById(id); }
  function setBusy(id, on) { $(id).classList.toggle("on", !!on); }
  function setFoot(text) { $("footStatus").textContent = text; }

  function bytesToBase64(u8) {
    var bin = "";
    var chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function dataURI(mime, b64) { return "data:" + mime + ";base64," + b64; }
  function textResult(container, text) {
    var html = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">豆包结果</div>' +
      '<button class="btn small" data-act="copy" data-text="' + escAttr(text) + '">复制</button></div>' +
      '<pre>' + esc(text) + '</pre></div>';
    $(container).innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  /* 把豆包方舟的常见接口错误转成友好中文提示（只改样式文本，不改调用方） */
  function friendlyErr(msg) {
    if (!msg) return msg;
    var s = String(msg);
    var head = "原始错误：";
    // ① 模型额度 / 安全体验模式限额（429 SetLimitExceeded）
    if (/429|TooManyRequests|SetLimitExceeded|usage limit|usage_limit|inference limit|Safe Experience|Free Tokens|安心体验|安全体验/.test(s)) {
      return "【额度不足】豆包方舟已暂停该模型服务（429 限额）。\n解决：\n1) 打开火山方舟控制台 →「开通管理」→ 找到对应模型 → 关闭「安全体验模式」或调高用量上限；\n2) 或在本面板把模型切换为 Seedream 5.0 Flash / 4.5 后再试。\n" + head + s.slice(0, 360);
    }
    // ② 密钥无效 / 未授权
    if (/401|403|invalid api|authentication|unauthorized|鉴权|密钥/.test(s)) {
      return "【Key 无效】请检查面板右上角「配置 Key」里的 API Key 是否正确、是否已开通对应模型。\n" + head + s.slice(0, 300);
    }
    // ③ 账户余额不足
    if (/insufficient|balance|余额/.test(s)) {
      return "【账户余额不足】请到火山引擎控制台充值后重试。\n" + head + s.slice(0, 300);
    }
    // ④ 请求超时 / 网络
    if (/timeout|ETIMEDOUT|网络|超时/.test(s)) {
      return "【请求超时】请检查网络后重试；生图通常需要 30-90 秒，请耐心等待。\n" + head + s.slice(0, 300);
    }
    return msg;
  }
  function errInto(container, message) {
    var box = $(container);
    box.innerHTML = '<div class="errbox">' + esc(friendlyErr(message)) + "</div>";
  }
  function clearErr(container) {
    var box = $(container);
    if (box) box.innerHTML = "";
  }

  /* ---------- 网络调用（经 Photon SDK 代理） ---------- */
  function sdkRequest(method, url, opts) {
    opts = opts || {};
    var payload = { method: method, url: url };
    if (opts.json !== undefined) payload.json = opts.json;
    if (opts.response === "bytes") payload.response = "bytes";
    payload.credential = { id: credId, header: "Authorization", prefix: "Bearer " };
    return SDK.network.request(payload);
  }

  function chat(messages, model) {
    return sdkRequest("POST", ARK_BASE + "/chat/completions", {
      json: { model: model || TEXT_MODEL, messages: messages }
    });
  }
  function chatText(system, userText, model) {
    return chat([
      { role: "system", content: system },
      { role: "user", content: userText }
    ], model).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
        throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
      }
      return r.body.choices[0].message.content;
    });
  }

  function imageGen(body) {
    return sdkRequest("POST", ARK_BASE + "/images/generations", { json: body })
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
        // 附上请求地址便于排查
        if (e && e.message && e.message.indexOf("permission") >= 0) {
          throw new Error(e.message + "\n请求地址: " + ARK_BASE + "/images/generations\n若弹出了“Allow endpoint”窗口请点 Allow，然后重试。");
        }
        throw e;
      });
  }

  function downloadBytes(url) {
    return sdkRequest("GET", url, { response: "bytes" }).then(function (r) {
      if (r.status !== 200 || !(r.body instanceof Uint8Array)) {
        throw new Error("图片下载失败 (" + r.status + ")，URL: " + url);
      }
      return r.body;
    });
  }

  /* 生图结果：优先 b64_json 直接解码，其次下载 URL */
  function resolveImage(img) {
    if (img.b64) return Promise.resolve({ url: img.url, bytes: base64ToBytes(img.b64) });
    return downloadBytes(img.url).then(function (b) { return { url: img.url, bytes: b }; });
  }

  /* ---------- 凭据（API Key） ---------- */
  function refreshKeyStatus() {
    if (!SDK) return;
    SDK.credentials.status(credId).then(function (st) {
      var badge = $("keyBadge");
      if (st && st.configured) {
        badge.innerHTML = '<span class="dot"></span>Key: 已配置';
        badge.className = "key-badge ok";
      } else {
        badge.innerHTML = '<span class="dot"></span>Key: 未配置';
        badge.className = "key-badge err";
      }
    }).catch(function () {
      var badge = $("keyBadge");
      badge.innerHTML = '<span class="dot"></span>Key: 未配置';
      badge.className = "key-badge err";
    });
  }

  function configureKey() {
    if (!SDK) return;
    setFoot("正在请求安全输入窗口…");
    SDK.credentials.configure(credId, "豆包方舟 API Key", ARK_ORIGIN)
      .then(function (st) {
        if (st && st.configured) {
          setFoot("Key 已保存（系统加密存储）");
          refreshKeyStatus();
        } else {
          setFoot("未保存 Key");
          refreshKeyStatus();
        }
      })
      .catch(function (e) { setFoot("配置失败：" + (e && e.message || e)); });
  }

  /* ---------- 从画布取图（与软件互动） ---------- */
  /* 链路：documents.active() → documents.capture()/pixels() 取画布 RGBA 像素
           → <canvas> 编码 PNG data URI。全程内存操作，无需文件与对话框。 */
  function sdkProbe() {
    function keys(o) {
      try { return Object.keys(o).join(","); } catch (e) { return "?"; }
    }
    return "sdk={" + keys(SDK) + "} documents={" + (SDK.documents ? keys(SDK.documents) : "无") +
      "} files={" + (SDK.files ? keys(SDK.files) : "无") + "}";
  }

  function shapeOf(res) {
    // 把返回对象的关键字段转成可读摘要，便于报错定位
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
  }

  function toU8(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (Array.isArray(v)) return new Uint8Array(v);
    if (v && v.buffer instanceof ArrayBuffer) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return null;
  }

  function normalizePixels(res) {
    // 兼容多种返回形态：
    //  {width,height,pixels} / {image:{...}} / {data:{...}}
    //  {pixels, sourceBounds:{left,top,right,bottom}} / {pixels, options:{width,height}}
    var w = 0, h = 0, px = null;
    if (res && res.width > 0 && res.height > 0) { w = res.width; h = res.height; px = toU8(res.pixels); }
    if (!px && res && res.image) { w = res.image.width; h = res.image.height; px = toU8(res.image.pixels); }
    if (!px && res && res.data) { w = res.data.width; h = res.data.height; px = toU8(res.data.pixels); }
    if (!px && res && res.pixels && res.sourceBounds) {
      var sb = res.sourceBounds;
      w = (sb.right != null && sb.left != null) ? (sb.right - sb.left) : (sb.width || 0);
      h = (sb.bottom != null && sb.top != null) ? (sb.bottom - sb.top) : (sb.height || 0);
      px = toU8(res.pixels);
    }
    if (!px && res && res.pixels && res.options && res.options.width > 0) {
      w = res.options.width; h = res.options.height; px = toU8(res.pixels);
    }
    if (!px) throw new Error("画布返回结构未识别：" + shapeOf(res));
    if (w < 1 || h < 1) throw new Error("画布尺寸无法推断（" + shapeOf(res) + "）");
    if (px.length !== w * h * 4) {
      // 长度与推断尺寸不符：优先以像素长度回推（若可整除）
      if (px.length % 4 === 0 && w * h !== px.length / 4 && res && res.pixels && !res.width) {
        var area = px.length / 4, side = Math.round(Math.sqrt(area));
        if (side * side === area) { w = side; h = side; }
        else throw new Error("画布像素数据长度不匹配（期望 " + (w * h * 4) + "，实际 " + px.length + "）。" + shapeOf(res));
      } else {
        throw new Error("画布像素数据长度不匹配（期望 " + (w * h * 4) + "，实际 " + px.length + "）。" + shapeOf(res));
      }
    }
    var bounds = null;
    if (res && res.sourceBounds) {
      var sb = res.sourceBounds;
      bounds = { left: sb.left, top: sb.top, right: sb.right, bottom: sb.bottom };
    } else if (res && res.bounds) {
      var b2 = res.bounds;
      if (b2.left != null) bounds = { left: b2.left, top: b2.top, right: b2.right, bottom: b2.bottom };
      else if (b2.x != null) bounds = { left: b2.x, top: b2.y, right: b2.x + (b2.width || 0), bottom: b2.y + (b2.height || 0) };
    }
    return { w: w, h: h, pixels: px, bounds: bounds };
  }

  function rgbaToPNGDataURI(w, h, pixels) {
    var canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext("2d");
    // 避免依赖 new ImageData(data,w,h) 三参构造（部分环境将其解析为 ImageDataSettings），
    // 使用 createImageData + data.set 的兼容写法
    var imgData = ctx.createImageData(w, h);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  var canvasSeq = 0;
  function canvasToRef(opts) {
    opts = opts || {};
    return SDK.documents.active().then(function (doc) {
      var docId = doc && (doc.documentId || doc.id);
      var docName = doc && (doc.name || doc.title || "当前文档");
      if (!docId) throw new Error("没有打开的文档，请先新建或打开画布");
      canvasSeq++;
      var attempts = [];
      // 选区模式优先：capture({selection:true}) 可能返回当前选区（bounds 即选区坐标）
      if (opts.selection && SDK.documents && typeof SDK.documents.capture === "function") {
        attempts.push({ n: "capture-sel", f: function () { return SDK.documents.capture({ selection: true }); } });
      }
      if (SDK.documents && typeof SDK.documents.capture === "function") {
        attempts.push({ n: "capture", f: function () { return SDK.documents.capture({}); } });
      }
      if (SDK.documents && typeof SDK.documents.pixels === "function") {
        attempts.push({ n: "pixels", f: function () { return SDK.documents.pixels({}); } });
      }
      if (!attempts.length) {
        return Promise.reject(new Error("SDK 未暴露画布取图方法。\nSDK 能力探测：" + sdkProbe()));
      }
      var i = 0, lastErr = null;
      function next() {
        if (i >= attempts.length) {
          return Promise.reject(new Error("从画布取图失败。" + (lastErr ? "\n" + lastErr : "") + "\nSDK 能力：" + sdkProbe()));
        }
        var a = attempts[i++];
        return Promise.resolve().then(a.f).catch(function (e) {
          lastErr = "[" + a.n + "] " + (e && e.message || e);
          return next();
        });
      }
      return next().then(function (res) {
        var norm = normalizePixels(res);
        var token = res && res.token;
        if (token && SDK.documents && typeof SDK.documents.release === "function") {
          SDK.documents.release({ token: token }).catch(function () { });
        }
        var uri = rgbaToPNGDataURI(norm.w, norm.h, norm.pixels);
        var b64 = uri.split(",")[1] || "";
        if (b64.length > 10 * 1024 * 1024) throw new Error("画布过大（超过 10MB），请缩小画布尺寸后重试");
        return {
          path: "画布 · " + docName + " #" + canvasSeq, mime: "image/png", b64: b64, uri: uri, docId: docId,
          bounds: norm.bounds || null
        };
      });
    });
  }

  /* ---------- 图片选择 / 处理 ---------- */
  function pickImage(multi) {
    return SDK.files.pick({ folder: false, multi: multi ? true : undefined })
      .then(function (pathOrList) {
        if (!pathOrList) return null;
        if (multi) {
          var arr = Array.isArray(pathOrList) ? pathOrList : [pathOrList];
          if (!arr.length) return null;
          return Promise.all(arr.map(readImage));
        }
        if (Array.isArray(pathOrList)) return readImage(pathOrList[0]);
        return readImage(pathOrList);
      });
  }
  function readImage(path) {
    return SDK.files.read(path).then(function (u8) {
      if (!(u8 instanceof Uint8Array)) throw new Error("读取图片失败");
      var mime = /\.(png|jpe?g|webp)$/i.test(String(path)) ?
        (String(path).toLowerCase().match(/\.(png|jpe?g|webp)$/i)[0] === ".png" ? "image/png" :
          (String(path).toLowerCase().match(/\.(png|jpe?g|webp)$/i)[0] === ".webp" ? "image/webp" : "image/jpeg")) : "image/png";
      var b64 = bytesToBase64(u8);
      if (b64.length > 10 * 1024 * 1024) throw new Error("图片过大（Base64 超过 10MB），请压缩后重试");
      return { path: String(path), mime: mime, b64: b64, uri: dataURI(mime, b64) };
    });
  }
  function renderPicked(container, picked) {
    var box = $(container);
    if (!picked) { box.innerHTML = ""; return; }
    if (Array.isArray(picked)) {
      box.innerHTML = picked.map(function (p) {
        return '<div class="picked"><img src="' + p.uri + '"><div class="pname">' + esc(p.path) +
          '</div><button class="btn small" data-rm="' + escAttr(p.path) + '">移除</button></div>';
      }).join("");
    } else {
      box.innerHTML = '<div class="picked"><img src="' + picked.uri + '"><div class="pname">' + esc(picked.path) +
        '</div><button class="btn small" data-rm="' + escAttr(picked.path) + '">移除</button></div>';
    }
  }

  /* ---------- 图片结果面板 ---------- */
  function imageResult(container, url, bytes, label) {
    var b64 = bytesToBase64(bytes);
    var mime = "image/png";
    var html = '<div class="result"><div class="imgbox"><img src="' + dataURI(mime, b64) + '"></div>' +
      '<div class="meta">' + esc(label || "豆包生成") + " · " + bytes.length + " 字节 · <a href='" + escAttr(url) + "' target='_blank' rel='noopener'>原图链接</a></div>" +
      '<div class="rbtns">' +
      '<button class="btn primary" data-act="place">置入画布</button>' +
      '<button class="btn" data-act="save">保存到本地</button>' +
      '<button class="btn" data-act="copyurl">复制链接</button>' +
      "</div></div>";
    var box = $(container);
    box.innerHTML = html;
    box.__label = label || "豆包生成";
    return { url: url, bytes: bytes, label: box.__label };
  }

  /* 置入画布（用户要求的无损顺序）：
     ① 以原始像素置入（不缩放）→ ② 立即转为智能对象（原始像素无损打包）
     → ③ 对智能对象做等比缩放变换并居中到画布（变换不破坏智能对象内部原始像素） */
  function sdkExecute(op, params, docId) {
    if (SDK.documents && typeof SDK.documents.execute === "function") {
      return SDK.documents.execute(op, params, docId);
    }
    return Promise.reject(new Error("SDK 未提供 documents.execute"));
  }

  /* 尽力而为的自动分组：把豆包图层整理进「豆包生成」组。
     若平台不接受参数（分组为增强能力），静默降级为仅命名，不影响置入结果。 */
  function autoGroupLayer(docId, layerId) {
    if (!autoGroupOn) return Promise.resolve();
    return SDK.documents.active().then(function (doc2) {
      var layers = (doc2 && doc2.layers) || [];
      var grp = null;
      for (var i = 0; i < layers.length; i++) {
        var k = layers[i].kind || "";
        if ((k === "group" || k === "GROUP") && layers[i].name === "豆包生成") grp = layers[i];
      }
      if (!grp) {
        return sdkExecute("core.layers.newGroup", { name: "豆包生成" }, docId).then(function (g) {
          var gid = g && (g.id || g.groupId || (g.layer && g.layer.id));
          if (!gid) throw new Error("新建组未返回组 ID");
          return sdkExecute("core.layers.groupLayers", { ids: [gid, layerId] }, docId);
        });
      }
      return sdkExecute("core.layers.groupLayers", { ids: [grp.id, layerId] }, docId);
    }).catch(function () {
      // 分组失败：静默降级（置入主链路已成功）
    });
  }

  function placeOnCanvas(bytes, opts) {
    opts = opts || {};
    var label = opts.label || "豆包生成";
    return SDK.images.decode(bytes).catch(function (e) {
      throw new Error("[decode] " + (e && e.message || e));
    }).then(function (img) {
      return SDK.documents.active().then(function (doc) {
        var docId = doc && (doc.documentId || doc.id);
        if (!docId) throw new Error("没有打开的文档，请先新建或打开画布");
        var cw = doc.width, ch = doc.height;
        var iw = img.width, ih = img.height;
        if (!cw || !ch || !iw || !ih) throw new Error("[doc] 画布或图片尺寸无效");
        if (cw * ch > 16 * 1024 * 1024) {
          throw new Error("[doc] 画布过大（超过 1600 万像素），无法置入。请先缩小画布尺寸再试");
        }
        // 等比 contain：最小缩放比 + 居中偏移（不拉伸）
        var s = Math.min(cw / iw, ch / ih);
        var tx = cw / 2 - s * iw / 2;
        var ty = ch / 2 - s * ih / 2;
        var placedLayerId = null, smartLayerId = null, placedName = null;
        // ① 原始像素置入（保持原图分辨率，不做任何缩放；图层名用安全短名，长标签仅作重命名尝试）
        return SDK.documents.applyImage({
          documentId: docId,
          image: { width: iw, height: ih, pixels: img.pixels },
          name: "豆包生成"
        }).then(function (placed) {
          placedLayerId = placed && (placed.layerId || (placed.layer && placed.layer.id));
          if (!placedLayerId) throw new Error("[applyImage] 置入未返回图层 ID");
          // ② 转为智能对象（原始像素无损打包）
          return sdkExecute("core.layers.convertToSmartObject", { ids: [placedLayerId] }, docId).catch(function (e) {
            throw new Error("[convertToSmartObject] " + (e && e.message || e));
          });
        }).then(function (conv) {
          // 转换后重新读取文档，定位【刚转换的】智能对象层：
          // 优先取当前选中图层（convert 后新层会被选中），否则取图层栈顶（最后一个）智能对象层。
          // 不能用第一个智能对象层——多次置入后旧层会被误缩放。
          return SDK.documents.active().then(function (doc2) {
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
            // ③ 对智能对象做等比缩放（无损变换语义）并居中到画布
            var matrix = [s, 0, 0, s, tx, ty];
            return sdkExecute("core.canvas.applyLayerTransform", {
              layerIds: [lid],
              matrix: matrix,
              interpolation: "bicubic"
            }, docId).catch(function (e) {
              throw new Error("[applyLayerTransform] " + (e && e.message || e));
            }).then(function (tr) {
              // 命名（尽力而为）：转智能对象后图层名可能变回默认名，尝试改回带功能标识的名字
              if (label && label !== placedName) {
                sdkExecute("core.layers.renameLayer", { id: lid, name: label }, docId).catch(function () { });
              }
              if (autoGroupOn) autoGroupLayer(docId, lid);
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
  }

  function saveToDisk(bytes) {
    return SDK.files.pick({ save: true, name: "doubao_image.png" }).then(function (path) {
      if (!path) return null;
      return SDK.files.write(path, bytes).then(function () { return path; });
    });
  }

  /* ---------- 各工具逻辑 ---------- */
  var state = {
    analyze: null,
    edit: [],
    merge: [],
    op: null,          // 扩图/重绘 参考图
    history: [],       // 生成历史（会话内）
    histSel: {},       // 图库多选：item.id → 1
    chatSessions: []   // 对话历史会话列表（localStorage 持久化）
  };
  var HISTORY_MAX = 20;
  var autoGroupOn = false;   // 默认关闭：分组操作未经平台实测，默认不启用以免错误编组

  /* ---------- 生成历史（图库） ---------- */
  var histSeq = 0;
  var histFilter = "全部";
  function pushHistory(label, bytes, url, prompt) {
    histSeq++;
    var item = {
      id: "h" + histSeq,
      label: label || "豆包生成",
      bytes: bytes,
      url: url || "",
      prompt: prompt || "",
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false })
    };
    state.history.unshift(item);
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    renderHistCats();
    renderHistory();
  }
  function renderHistCats() {
    var box = $("histCats");
    if (!box) return;
    var cats = [];
    state.history.forEach(function (it) {
      var c = (it.label || "").split("·")[0].trim();
      if (c && cats.indexOf(c) < 0) cats.push(c);
    });
    var html = '<button class="ratio' + (histFilter === "全部" ? " on" : "") + '" data-cat="全部">全部</button>';
    html += cats.map(function (c) {
      return '<button class="ratio' + (histFilter === c ? " on" : "") + '" data-cat="' + escAttr(c) + '">' + esc(c) + "</button>";
    }).join("");
    box.innerHTML = html;
  }
  function histItems() {
    return state.history.filter(function (it) { return histFilter === "全部" || (it.label || "").indexOf(histFilter) === 0; });
  }
  function histById(id) {
    for (var i = 0; i < state.history.length; i++) if (state.history[i].id === id) return state.history[i];
    return null;
  }
  function updateHistBar() {
    var btn = $("histPlaceSel");
    if (!btn) return;
    var sel = Object.keys(state.histSel).length;
    btn.disabled = !sel;
    btn.textContent = "批量置入（" + sel + "）";
    var all = $("histSelAll");
    if (all) all.checked = sel > 0 && sel === histItems().length;
  }
  function placeHistItems(items) {
    if (!items.length) return Promise.resolve();
    var btn = $("histPlaceSel");
    if (btn) { btn.disabled = true; btn.textContent = "置入中 " + items.length + " 张…"; }
    return items.reduce(function (p, it, k) {
      return p.then(function () {
        setFoot("置入中（" + (k + 1) + "/" + items.length + "）…");
        return placeOnCanvas(it.bytes, { label: (it.label || "豆包生成").split("·")[0].trim() + " · 置入" });
      });
    }, Promise.resolve()).then(function () {
      setFoot("已批量置入 " + items.length + " 张（智能对象 + 等比适配）");
    }).catch(function (e) {
      setFoot("批量置入中断：" + friendlyErr(e.message || String(e)));
    }).finally(function () {
      if (btn) updateHistBar();
    });
  }
  function renderHistory() {
    var box = $("histList");
    if (!box) return;
    if (!state.history.length) {
      box.innerHTML = '<div class="hint" style="margin-top:6px">还没有生成记录。用文生图 / 图生图 / 多图融合 / 扩图重绘 / 对话生图生成图片后会自动记录，可随时置入画布或导出 PNG。</div>';
      return;
    }
    var items = histItems();
    if (!items.length) {
      box.innerHTML = '<div class="hint" style="margin-top:6px">当前分类下没有记录，点上方「全部」查看所有。</div>';
      updateHistBar();
      return;
    }
    var html = items.map(function (it) {
      var uri = dataURI("image/png", bytesToBase64(it.bytes));
      var checked = state.histSel[it.id] ? " checked" : "";
      return '<div class="histitem" style="display:flex;gap:9px;align-items:center;background:var(--ph-slab);box-shadow:var(--ph-hairline);border-radius:var(--ph-radius-11);padding:8px 9px;margin-bottom:7px">' +
        '<input type="checkbox" class="histchk" data-id="' + it.id + '"' + checked + ' style="accent-color:var(--ph-accent);width:13px;height:13px;margin:0;flex:none;cursor:pointer">' +
        '<img src="' + uri + '" style="width:50px;height:50px;object-fit:cover;border-radius:var(--ph-radius-7);box-shadow:var(--ph-hairline);flex:none;background:var(--ph-black-1);cursor:pointer" data-act="histPreview" data-id="' + it.id + '" title="点击预览大图">' +
        '<div style="flex:1;min-width:0"><div style="font-size:var(--ph-text-meta);color:var(--ph-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.label) + "</div>" +
        '<div style="font-size:var(--ph-text-sm);color:var(--ph-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">' + esc(it.time) +
        (it.prompt ? " · " + esc(it.prompt.slice(0, 36)) : "") + "</div></div>" +
        '<button class="btn small" data-act="histSave" data-id="' + it.id + '" title="导出 PNG 到本地">保存 PNG</button>' +
        '<button class="btn small primary" data-act="histPlace" data-id="' + it.id + '">置入</button></div>';
    }).join("");
    box.innerHTML = html;
    updateHistBar();
  }

  /* ---------- 统一对话（自由提问） ---------- */
  var chatAttachImg = null;
  var chatSaved = true;   // 当前会话是否已存档；消息变化后置 false
  var CHAT_SESS_MAX = 20;
  /* 快速 / 专家模式：模型 + 回答风格提示词（flash 快速模型已在方舟模型列表核实可用） */
  var CHAT_MODES = {
    fast: {
      model: "doubao-seed-1-6-flash-250828",
      label: "快速",
      desc: "Flash 快速模型 · 简短要点",
      sys: "（快速模式）请用简洁直接的语言回答，优先要点式短回复，通常控制在 5 句以内，不做冗长展开。"
    },
    expert: {
      model: TEXT_MODEL,
      label: "专家",
      desc: "Seed 2.1 Pro · 深度思考",
      sys: "（专家模式）请以资深领域专家身份回答：深入分析问题，结构化分点阐述，提供关键细节、依据与可执行建议；涉及取舍时说明权衡。"
    }
  };
  var chatMode = "expert";
  function updateChatModeHint() {
    var el = $("chatModeHint");
    if (!el) return;
    var m = CHAT_MODES[chatMode] || CHAT_MODES.expert;
    el.textContent = m.label + "模式 · " + m.desc;
  }

  /* 会话历史：localStorage 持久化（不可用时降级为内存，仅本次可用） */
  function loadChatSessions() {
    try {
      var raw = localStorage.getItem("doubao.chatSessions");
      if (raw) state.chatSessions = JSON.parse(raw);
    } catch (e) { state.chatSessions = []; }
    if (!Array.isArray(state.chatSessions)) state.chatSessions = [];
  }
  function saveChatSessions() {
    var list = state.chatSessions.slice(0, CHAT_SESS_MAX);
    var json;
    try { json = JSON.stringify(list); } catch (e) { return; }
    if (json.length > 4 * 1024 * 1024) {
      // localStorage 容量有限：超限时省略图片数据，保留对话文本
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
    if (chatSaved || !state.chat.length) return;
    var s = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: chatSessionTitle(state.chat),
      mode: chatMode,
      ts: Date.now(),
      messages: state.chat.slice()
    };
    state.chatSessions.unshift(s);
    if (state.chatSessions.length > CHAT_SESS_MAX) state.chatSessions.length = CHAT_SESS_MAX;
    chatSaved = true;
    saveChatSessions();
  }
  function restoreSession(s) {
    state.chat = s.messages.slice();
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
    setFoot("已恢复会话：" + s.title + "（" + CHAT_MODES[chatMode].label + "模式）");
  }
  function renderChatSessions() {
    var box = $("sessList");
    if (!box) return;
    if (!state.chatSessions.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;margin-top:16px">暂无历史会话。<br>对话有内容后点「新建会话」，当前对话会自动存档到这里。</div>';
      return;
    }
    box.innerHTML = state.chatSessions.map(function (s, i) {
      var d = new Date(s.ts);
      var time = d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) + " " +
        d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
      return '<div class="sess-item" data-act="sessOpen" data-idx="' + i + '">' +
        '<div class="sess-body"><div class="sess-title">' + esc(s.title) + "</div>" +
        '<div class="sess-meta">' + time + " · " + s.messages.length + " 条消息" + "</div></div>" +
        '<button class="btn small" data-act="sessDel" data-idx="' + i + '" title="删除该会话">删除</button></div>';
    }).join("");
  }
  function openChatSessions() {
    saveCurrentSession();   // 先把当前有内容的对话存进去，保证列表完整
    renderChatSessions();
    $("chatSessions").classList.remove("hidden");
  }

  /* 对话内出图：识别「生成/画/出一张…图」类意图，直接调生图接口（不再走文本模型）。
     带附件图时自动作为参考图（图生图）。用 Seedream 5.0 Flash：速度快、429 限额独立。 */
  var CHAT_GEN_RE = /^(生成|帮我生成|画|出张?|来张?)[^。！？\n]{0,24}(图|图片|图像)/;
  function chatSend() {
    var text = $("chatInput").value.trim();
    var attach = chatAttachImg;
    if (!text && !attach) { setFoot("请输入消息，或先选一张图片"); return; }
    state.chat.push({ role: "user", text: text || "（附图）", image: attach });
    chatSaved = false;
    $("chatInput").value = "";
    chatAttachImg = null;
    renderChatAttach();
    renderChat();
    scrollChat();
    // 生图意图：跳过文本模型，直接出图
    if (text && CHAT_GEN_RE.test(text)) {
      setBusy("chatBusy", true);
      var genBody = {
        model: "doubao-seedream-5-0-flash-260628",
        prompt: text,
        size: "2048x2048",
        response_format: "b64_json",
        watermark: false
      };
      if (attach) genBody.image = attach.uri;
      imageGen(genBody).then(resolveImage).then(function (r) {
        state.chat.push({
          role: "assistant",
          text: "已生成" + (attach ? "（参考图模式）" : "（文生图）") + "：" + text,
          image: { uri: r.url, bytes: r.bytes }
        });
        pushHistory("对话生图 · flash", r.bytes, r.url, text);
        renderChat();
        scrollChat();
        setFoot("已在对话内生成图片，可点「置入画布」或到「生成图库」查看");
      }).catch(function (e) {
        state.chat.push({ role: "error", text: friendlyErr(e.message || String(e)) });
        renderChat();
        scrollChat();
      }).finally(function () { setBusy("chatBusy", false); });
      return;
    }
    var msgs = [];
    if (CHAT_MODES[chatMode] && CHAT_MODES[chatMode].sys) msgs.push({ role: "system", content: CHAT_MODES[chatMode].sys });
    // 携带最近 6 轮（12 条）上下文，避免话题串味与 token 膨胀
    var recent = state.chat.slice(-12);
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
    setBusy("chatBusy", true);
    chat(msgs, CHAT_MODES[chatMode].model).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
        throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
      }
      var reply = r.body.choices[0].message.content;
      state.chat.push({ role: "assistant", text: reply });
      renderChat();
      scrollChat();
      setFoot("已回复（会话内上下文最多保留最近 6 轮）");
    }).catch(function (e) {
      state.chat.push({ role: "error", text: friendlyErr(e.message || String(e)) });
      renderChat();
      scrollChat();
    }).finally(function () { setBusy("chatBusy", false); });
  }

  function renderChat() {
    var box = $("chatList");
    if (!box) return;
    if (!state.chat.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;margin-top:16px">与豆包自由对话，直接提问即可。<br>支持文字与图片（选本地图片 / 从画布取图），可多轮追问。</div>';
      return;
    }
    box.innerHTML = state.chat.map(function (m, idx) {
      var who = m.role === "user" ? "我" : "豆包";
      var imgHtml = m.image ? '<div class="imgwrap"><img src="' + m.image.uri + '"></div>' : "";
      var copyBtn = (m.role === "assistant" && m.text) ? '<button class="btn small" data-act="copy" data-text="' + escAttr(m.text) + '">复制</button>' : "";
      var toGenBtn = (m.role === "assistant" && m.text) ? '<button class="btn small" data-act="chatToGen" data-text="' + escAttr(m.text) + '">去生图</button>' : "";
      var placeBtn = (m.role === "assistant" && m.image) ? '<button class="btn small primary" data-act="chatPlace" data-idx="' + idx + '">置入画布</button>' : "";
      if (m.role === "error") {
        return '<div class="msg assistant"><div class="bubble errbubble">' + esc(m.text) + "</div></div>";
      }
      if (m.role === "user") {
        return '<div class="msg user">' + imgHtml + '<div class="bubble">' + esc(m.text || "") + "</div>" +
          '<div class="meta">' + who + "</div></div>";
      }
      return '<div class="msg assistant">' + '<div class="bubble">' + esc(m.text || "") + "</div>" + imgHtml +
        '<div class="meta">' + who + placeBtn + copyBtn + toGenBtn + "</div></div>";
    }).join("");
  }

  function scrollChat() {
    var box = $("chatList");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function setChatAttach(p) {
    chatAttachImg = p;
    renderChatAttach();
    setFoot("已附图：" + p.path + "（随下一条消息发送）");
  }
  function renderChatAttach() {
    var box = $("chatAttach");
    if (!box) return;
    if (!chatAttachImg) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="picked"><img src="' + chatAttachImg.uri + '"><div class="pname">' + esc(chatAttachImg.path) +
      '</div><button class="btn small" data-act="chatRmAttach">移除</button></div>';
  }

  function bindChat() {
    $("chatSend").addEventListener("click", chatSend);
    $("chatInput").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); chatSend(); }
    });
    $("chatNew").addEventListener("click", function () {
      saveCurrentSession();   // 当前对话有内容时先存档，可随时在「历史会话」找回
      state.chat = [];
      chatAttachImg = null;
      chatSaved = true;
      renderChat();
      renderChatAttach();
      setFoot("已新建会话（旧对话已存档，可在「历史会话」找回）");
    });
    $("chatHistory").addEventListener("click", openChatSessions);
    $("sessClose").addEventListener("click", function () {
      $("chatSessions").classList.add("hidden");
    });
    $("chatPick").addEventListener("click", function () {
      pickImage(false).then(function (p) { if (p) setChatAttach(p); })
        .catch(function (e) { setFoot("选择图片失败：" + (e.message || e)); });
    });
    $("chatCanvas").addEventListener("click", function () {
      setFoot("正在读取画布内容…");
      canvasToRef({}).then(function (p) { setChatAttach(p); })
        .catch(function (e) { setFoot("从画布取图失败：" + (e.message || e)); });
    });
    document.querySelectorAll(".chip[data-mode]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip[data-mode]").forEach(function (c) { c.classList.remove("on"); });
        chip.classList.add("on");
        chatMode = chip.dataset.mode;
        updateChatModeHint();
        setFoot("已切换" + CHAT_MODES[chatMode].label + "模式：" + CHAT_MODES[chatMode].desc);
      });
    });
    updateChatModeHint();
  }

  /* ---------- 文生图尺寸：固定比例 / 自定义像素（互斥） ---------- */
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
    var sel = $("genSize");
    var lim = genSizeLimits($("genModel").value);
    sel.innerHTML = lim.tiers.map(function (t) {
      return '<option value="' + t + '">' + t + (t === "2K" ? " · 推荐" : "") + "</option>";
    }).join("");
  }
  function updateGenSizeInfo() {
    var model = $("genModel").value;
    var lim = genSizeLimits(model);
    var hint = $("genSizeHint");
    if (hint) {
      hint.textContent = "模型限制：总像素 " + lim.minPx.toLocaleString() + " ~ " + lim.maxPx.toLocaleString() + "，宽高比 1:16 ~ 16:1（生成时自动校验）";
    }
    var pxEl = $("genSizePx");
    if (pxEl) {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var px = genRatioPx(model, $("genSize").value, ratioEl ? ratioEl.dataset.ratio : "1:1");
      pxEl.value = px || "该档位暂不支持此比例";
    }
  }
  function genSizeValue() {
    var mode = "fixed";
    var radio = document.querySelector('input[name="genSizeMode"]:checked');
    if (radio) mode = radio.value;
    var model = $("genModel").value;
    var lim = genSizeLimits(model);
    if (mode === "fixed") {
      var ratioEl = document.querySelector(".genratio .ratio.on");
      var ratio = ratioEl ? ratioEl.dataset.ratio : "1:1";
      var px = genRatioPx(model, $("genSize").value, ratio);
      if (!px) { errInto("genResult", "该档位暂不支持所选比例，请更换档位或比例"); return null; }
      return px;
    }
    var w = parseInt($("genW").value, 10), h = parseInt($("genH").value, 10);
    if (!w || !h || w <= 0 || h <= 0) { errInto("genResult", "请输入有效的像素宽高（正整数）"); return null; }
    var total = w * h;
    var r = w / h;
    if (total < lim.minPx) {
      errInto("genResult", "总像素不足：当前 " + total.toLocaleString() + " px，该模型最低需 " + lim.minPx.toLocaleString() + " px（例如 1280x720）");
      return null;
    }
    if (total > lim.maxPx) {
      errInto("genResult", "总像素超出：当前 " + total.toLocaleString() + " px，该模型上限 " + lim.maxPx.toLocaleString() + " px，请减小宽或高");
      return null;
    }
    if (r < 1 / 16 || r > 16) {
      errInto("genResult", "宽高比超出模型限制（1:16 ~ 16:1），当前为 1:" + (r < 1 ? (1 / r).toFixed(1) : r.toFixed(1)));
      return null;
    }
    return w + "x" + h;
  }
  function bindGenSize() {
    document.querySelectorAll('input[name="genSizeMode"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var custom = r.value === "custom" && r.checked;
        $("genFixed").classList.toggle("dim", custom);
        $("genCustom").classList.toggle("hidden", !custom);
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
    $("genSize").addEventListener("change", updateGenSizeInfo);
    $("genModel").addEventListener("change", function () {
      updateGenTiers();
      updateGenSizeInfo();
      setFoot("已切换模型：" + ($("genModel").selectedOptions[0] ? $("genModel").selectedOptions[0].textContent : $("genModel").value));
    });
    updateGenTiers();
    updateGenSizeInfo();
  }

  function runGenerate() {
    var prompt = $("genPrompt").value.trim();
    if (!prompt) { errInto("genResult", "请输入画面描述"); return; }
    clearErr("genResult");
    var size = genSizeValue();
    if (!size) return;
    var model = $("genModel").value;
    setBusy("genBusy", true);
    imageGen({ model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false })
      .then(resolveImage)
      .then(function (r) {
        imageResult("genResult", r.url, r.bytes, "文生图 · " + model);
        pushHistory("文生图 · " + model, r.bytes, r.url, prompt);
        setFoot("生成完成（" + size + "），已记入历史");
      })
      .catch(function (e) { errInto("genResult", e.message || String(e)); })
      .finally(function () { setBusy("genBusy", false); });
  }

  function runEdit() {
    if (!state.edit.length) { errInto("editResult", "请先选择一张参考图"); return; }
    var prompt = $("editPrompt").value.trim();
    if (!prompt) { errInto("editResult", "请输入编辑指令"); return; }
    var size = $("editSize").value, model = $("editModel").value;
    var body = { model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false, image: state.edit[0].uri };
    if ($("editTransparent").checked) {
      body.background = "transparent";
      body.output_format = "png";   // 透明模式输出必须是 png
    }
    clearErr("editResult"); setBusy("editBusy", true);
    imageGen(body)
      .then(resolveImage)
      .then(function (r) {
        imageResult("editResult", r.url, r.bytes, "图生图 · " + model + ($("editTransparent").checked ? " · 透明" : ""));
        pushHistory("图生图 · " + model, r.bytes, r.url, prompt);
        setFoot("编辑完成，已记入历史");
      })
      .catch(function (e) { errInto("editResult", e.message || String(e)); })
      .finally(function () { setBusy("editBusy", false); });
  }

  /* ---------- 提示词反推（参考图 → 结构化提示词） ---------- */
  var revText = "";
  function runReverse() {
    if (!state.edit || !state.edit[0]) { errInto("editReverseOut", "请先选择一张参考图（本地或画布）"); return; }
    clearErr("editReverseOut"); setBusy("editRevBusy", true);
    var q = "分析这张参考图，反推可用于生成类似效果的结构化提示词：主体/材质/光影/构图/风格/色彩。输出英文+中文对照，直接给出提示词，不要解释。";
    var content = [
      { type: "text", text: q },
      { type: "image_url", image_url: { url: state.edit[0].uri } }
    ];
    chat([{ role: "user", content: content }]).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.choices || !r.body.choices[0]) {
        throw new Error("模型返回异常：" + JSON.stringify(r.body || {}).slice(0, 300));
      }
      revText = r.body.choices[0].message.content;
      var box = $("editReverseOut");
      box.innerHTML = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">反推提示词</div>' +
        '<button class="btn small" data-act="editFill">填入本页</button>' +
        '<button class="btn small" data-act="toGenFill">去文生图</button>' +
        '<button class="btn small" data-act="copy" data-text="' + escAttr(revText) + '">复制</button></div>' +
        '<pre>' + esc(revText) + '</pre></div>';
      setFoot("提示词反推完成，可填入本页或去文生图");
    }).catch(function (e) { errInto("editReverseOut", friendlyErr(e.message || String(e))); })
      .finally(function () { setBusy("editRevBusy", false); });
  }

  /* ---------- 提示词预设（自定义保存 + 一键注入） ---------- */
  var promptPresets = [];
  var presetSource = "gen";   // 预设弹层当前服务的输入框：gen → genPrompt，edit → editPrompt
  function loadPromptPresets() {
    try {
      var raw = localStorage.getItem("doubao.promptPresets");
      if (raw) promptPresets = JSON.parse(raw);
    } catch (e) { promptPresets = []; }
    if (!Array.isArray(promptPresets)) promptPresets = [];
  }
  function savePromptPresets() {
    try { localStorage.setItem("doubao.promptPresets", JSON.stringify(promptPresets.slice(0, 30))); } catch (e) {}
  }
  function presetTarget() {
    return presetSource === "edit" ? $("editPrompt") : $("genPrompt");
  }
  function openPresetPanel(src) {
    presetSource = src;
    renderPresetList();
    $("presetPanel").classList.remove("hidden");
  }
  function renderPresetList() {
    var box = $("presetList");
    if (!box) return;
    if (!promptPresets.length) {
      box.innerHTML = '<div class="hint" style="text-align:center;margin-top:14px">还没有提示词预设。<br>在下栏输入名称，点「保存当前输入为预设」即可。</div>';
      return;
    }
    box.innerHTML = promptPresets.map(function (p, i) {
      return '<div class="sess-item" data-act="presetUse" data-idx="' + i + '">' +
        '<div class="sess-body"><div class="sess-title">' + esc(p.name) + "</div>" +
        '<div class="sess-meta">' + esc(p.text.length > 60 ? p.text.slice(0, 60) + "…" : p.text) + "</div></div>" +
        '<button class="btn small" data-act="presetDel" data-idx="' + i + '" title="删除该预设">删除</button></div>';
    }).join("");
  }
  function bindPreset() {
    $("genPreset").addEventListener("click", function () { openPresetPanel("gen"); });
    $("editPreset").addEventListener("click", function () { openPresetPanel("edit"); });
    $("presetClose").addEventListener("click", function () { $("presetPanel").classList.add("hidden"); });
    $("presetSave").addEventListener("click", function () {
      var t = presetTarget().value.trim();
      if (!t) { setFoot("当前输入框为空，无法保存预设"); return; }
      var name = $("presetName").value.trim() || ("预设 " + (promptPresets.length + 1));
      promptPresets.unshift({ name: name, text: t });
      savePromptPresets();
      $("presetName").value = "";
      renderPresetList();
      setFoot("已保存预设：" + name);
    });
  }

  /* ---------- 透明背景开关：仅 5.0 Pro/Flash 支持 ---------- */
  function updateEditTransparentState() {
    var m = $("editModel").value;
    var ok = m === "doubao-seedream-5-0-pro-260628" || m === "doubao-seedream-5-0-flash-260628";
    $("editTransparent").disabled = !ok;
    if (!ok) $("editTransparent").checked = false;
  }

  function runMerge() {
    if (state.merge.length < 2) { errInto("mergeResult", "请至少选择 2 张参考图"); return; }
    var prompt = $("mergePrompt").value.trim();
    if (!prompt) { errInto("mergeResult", "请输入融合指令"); return; }
    var size = $("mergeSize").value, model = $("mergeModel").value;
    clearErr("mergeResult"); setBusy("mergeBusy", true);
    imageGen({ model: model, prompt: prompt, size: size, response_format: "b64_json", watermark: false, image: state.merge.map(function (p) { return p.uri; }) })
      .then(resolveImage)
      .then(function (r) {
        imageResult("mergeResult", r.url, r.bytes, "多图融合 · " + model);
        pushHistory("多图融合 · " + model, r.bytes, r.url, prompt);
        setFoot("融合完成，已记入历史");
      })
      .catch(function (e) { errInto("mergeResult", e.message || String(e)); })
      .finally(function () { setBusy("mergeBusy", false); });
  }

  function runTranslate() {
    var text = $("trText").value;
    if (!text.trim()) { errInto("trResult", "请输入要翻译的内容"); return; }
    var target = $("trTarget").value, style = $("trStyle").value;
    var lines = text.split(/\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) { errInto("trResult", "请输入要翻译的内容"); return; }
    clearErr("trResult"); setBusy("trBusy", true);
    var sys = "你是专业翻译。把用户内容翻译成" + targetName(target) + "，风格：" + style + "。" +
      "保持每行一段、行数一一对应，只输出译文不要任何解释。";
    chatText(sys, text)
      .then(function (t) {
        var html = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">译文（' +
          lines.length + " 行，逐行对应原文）</div>" +
          '<button class="btn small" data-act="copy" data-text="' + escAttr(t) + '">复制全部</button></div>' +
          "<pre>" + esc(t) + "</pre></div>";
        $("trResult").innerHTML = html;
      })
      .catch(function (e) { errInto("trResult", e.message || String(e)); })
      .finally(function () { setBusy("trBusy", false); });
  }
  function targetName(v) {
    var map = { en: "英语", zh: "中文", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语" };
    return map[v] || v;
  }

  /* ---------- 扩图 / 局部重绘 ---------- */
  function runOutpaint() {
    if (!state.op) { errInto("opResult", "请先选择一张参考图（本地文件或画布内容）"); return; }
    var mode = $("opMode").value;
    var prompt = $("opPrompt").value.trim();
    var size = $("opSize").value, model = $("opModel").value;
    var body = {
      model: model,
      prompt: prompt,
      size: size,
      response_format: "b64_json",
      watermark: false,
      image: state.op.uri
    };
    if (mode === "outpaint") {
      var ratio = $("opRatio").value;
      if (!prompt) prompt = "将图片扩展为 " + ratio + " 的画幅，画面主体保持不变，向外延伸补充与现有内容、光影和风格一致的边缘，使整体自然连贯，无生硬拼接。";
      else prompt = "将图片扩展为 " + ratio + " 的画幅。" + prompt;
    } else {
      var l = parseInt($("opBboxL").value, 10), t = parseInt($("opBboxT").value, 10);
      var r = parseInt($("opBboxR").value, 10), b = parseInt($("opBboxB").value, 10);
      if (isNaN(l) || isNaN(t) || isNaN(r) || isNaN(b) || r <= l || b <= t) {
        errInto("opResult", "请填写有效的重绘区域坐标（left top right bottom，需 right > left 且 bottom > top）");
        return;
      }
      if (!prompt) prompt = "将框选区域中的内容按画面整体风格重新绘制，保持画布其余部分完全不变。";
      prompt = "对图片中 <bbox>" + l + " " + t + " " + r + " " + b + "</bbox> 标记的区域执行编辑：" + prompt + " 画布其余部分保持不变。";
    }
    body.prompt = prompt;
    clearErr("opResult"); setBusy("opBusy", true);
    imageGen(body).then(resolveImage).then(function (r) {
      var tag = mode === "outpaint" ? "智能扩图" : "局部重绘";
      imageResult("opResult", r.url, r.bytes, tag + " · " + model);
      pushHistory(tag + " · " + model, r.bytes, r.url, prompt);
      setFoot(tag + "完成，已记入历史");
    }).catch(function (e) { errInto("opResult", e.message || String(e)); })
      .finally(function () { setBusy("opBusy", false); });
  }

  function bindOutpaint() {
    var modeEl = $("opMode");
    if (!modeEl) return;
    modeEl.addEventListener("change", function () {
      var m = modeEl.value;
      $("opRatioRow").style.display = m === "outpaint" ? "" : "none";
      $("opBboxRow").style.display = m === "inpaint" ? "" : "none";
    });
    $("opPick").addEventListener("click", function () {
      pickImage(false).then(function (p) {
        if (!p) return;
        state.op = p;
        renderPicked("opPicked", p);
        setFoot("已选择参考图：" + p.path);
      }).catch(function (e) { errInto("opResult", e.message || String(e)); });
    });
    $("opCanvas").addEventListener("click", function () {
      setFoot("正在读取画布内容…");
      canvasToRef({ selection: true }).then(function (p) {
        state.op = p;
        renderPicked("opPicked", p);
        if (p.bounds) {
          $("opBboxL").value = Math.round(p.bounds.left);
          $("opBboxT").value = Math.round(p.bounds.top);
          $("opBboxR").value = Math.round(p.bounds.right);
          $("opBboxB").value = Math.round(p.bounds.bottom);
          setFoot("已从画布取图，并读取到选区坐标（已自动填入重绘区域）");
        } else {
          setFoot("已从画布取图（未检测到选区，可手动填写重绘区域坐标）");
        }
      }).catch(function (e) { errInto("opResult", e.message || String(e)); setFoot("从画布取图失败"); });
    });
    $("opBboxSel").addEventListener("click", function () {
      if (!state.op) { errInto("opResult", "请先取一张参考图（建议先点「从画布取图」）"); return; }
      setFoot("正在读取画布选区…");
      canvasToRef({ selection: true }).then(function (p) {
        if (p.bounds) {
          $("opBboxL").value = Math.round(p.bounds.left);
          $("opBboxT").value = Math.round(p.bounds.top);
          $("opBboxR").value = Math.round(p.bounds.right);
          $("opBboxB").value = Math.round(p.bounds.bottom);
          setFoot("已读取画布选区坐标并填入");
        } else {
          setFoot("未检测到选区：请在画布中用选区工具框选区域，或手动填写坐标");
        }
      }).catch(function (e) { errInto("opResult", e.message || String(e)); setFoot("读取画布选区失败：" + (e.message || e)); });
    });
    $("opRun").addEventListener("click", runOutpaint);
    $("histClear").addEventListener("click", function () {
      state.history = [];
      state.histSel = {};
      renderHistCats();
      renderHistory();
      setFoot("生成图库已清空");
    });
    $("histPlaceSel").addEventListener("click", function () {
      var items = state.history.filter(function (it) { return state.histSel[it.id]; });
      if (!items.length) { setFoot("请先勾选要置入的图片"); return; }
      placeHistItems(items);
    });
    $("histSelAll").addEventListener("change", function (ev) {
      var on = ev.target.checked;
      histItems().forEach(function (it) {
        if (on) state.histSel[it.id] = 1; else delete state.histSel[it.id];
      });
      renderHistory();
    });
    $("histPrevClose").addEventListener("click", function () {
      $("histPreview").classList.add("hidden");
    });
    // 图库筛选分类（.ratio 复用）
    $("histCats").addEventListener("click", function (ev) {
      var b = ev.target;
      if (!b || !b.classList || !b.classList.contains("ratio")) return;
      histFilter = b.dataset.cat || "全部";
      renderHistCats();
      renderHistory();
    });
    // 图库勾选（事件委托）
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains("histchk")) {
        if (t.checked) state.histSel[t.dataset.id] = 1;
        else delete state.histSel[t.dataset.id];
        updateHistBar();
      }
    });
    var ag = $("autoGroup");
    if (ag) {
      autoGroupOn = ag.checked;
      ag.addEventListener("change", function () {
        autoGroupOn = ag.checked;
        setFoot(autoGroupOn ? "已开启：置入画布后自动整理进「豆包生成」组" : "已关闭自动分组");
      });
    }
  }

  /* ---------- 翻译 × 文本图层互动 ---------- */
  function docSnapshot() {
    return SDK.documents.active().then(function (doc) {
      if (!doc) return { docId: null, layers: [], selected: null };
      return {
        docId: doc.documentId || doc.id,
        layers: (doc.layers || []).filter(function (l) { return l.kind === "type"; }),
        selected: (doc.selectedLayerIds || [])[0] || null
      };
    });
  }

  function fillTrLayerOptions() {
    docSnapshot().then(function (info) {
      var sel = $("trLayer");
      if (!sel) return;
      sel.innerHTML = "";
      if (!info.layers.length) {
        sel.innerHTML = '<option value="">（画布中没有文本图层）</option>';
        return;
      }
      var picked = false;
      info.layers.forEach(function (l) {
        var o = document.createElement("option");
        o.value = l.id;
        o.textContent = l.name + (l.id === info.selected ? "（当前选中）" : "");
        sel.appendChild(o);
        if (l.id === info.selected) { sel.value = l.id; picked = true; }
      });
      if (!picked) sel.value = info.layers[0].id;
      sel.title = info.docId ? "文档：" + (info.docId) : "";
    }).catch(function () { });
  }

  function bindTrLayer() {
    var getBtn = $("trLayerGet");
    getBtn.addEventListener("click", function () {
      docSnapshot().then(function (info) {
        var lid = $("trLayer").value;
        var layer = null;
        info.layers.forEach(function (l) { if (l.id === lid) layer = l; });
        if (!layer) {
          // 兜底：用当前选中图层名
          info.layers.forEach(function (l) { if (l.id === info.selected) layer = l; });
        }
        if (!layer) { setFoot("未找到可用的文本图层，请先在画布中选择或创建文本图层"); return; }
        $("trText").value = layer.name;
        setFoot("已从文本图层取原文：" + layer.name);
      }).catch(function (e) { setFoot("读取文本图层失败：" + (e.message || e)); });
    });

    // 切到翻译页时刷新下拉（在 bindTabs 的统一切换逻辑里调用 fillTrLayerOptions）
  }

  /* ---------- 事件绑定 ---------- */
  function bindTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("on"); });
        tab.classList.add("on");
        document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("on"); });
        $("view-" + tab.dataset.view).classList.add("on");
        if (tab.dataset.view === "translate") fillTrLayerOptions();
      });
    });
  }

  function bindPicks() {
    $("editPick").addEventListener("click", function () {
      pickImage(false).then(function (p) {
        state.edit = p ? [p] : [];
        renderPicked("editPicked", p);
      }).catch(function (e) { errInto("editResult", e.message || String(e)); });
    });
    $("mergePick").addEventListener("click", function () {
      pickImage(true).then(function (list) {
        state.merge = list || [];
        renderPicked("mergePicked", state.merge);
      }).catch(function (e) { errInto("mergeResult", e.message || String(e)); });
    });

    // 从画布取图
    $("editCanvas").addEventListener("click", function () {
      setFoot("正在导出画布…");
      canvasToRef().then(function (p) {
        state.edit = p ? [p] : [];
        renderPicked("editPicked", p);
        setFoot("已从画布取图");
      }).catch(function (e) {
        errInto("editResult", e.message || String(e));
        setFoot("从画布取图失败");
      });
    });
    $("mergeCanvas").addEventListener("click", function () {
      setFoot("正在导出画布…");
      canvasToRef().then(function (p) {
        state.merge = state.merge || [];
        state.merge.push(p);
        renderPicked("mergePicked", state.merge);
        setFoot("已从画布取图（" + state.merge.length + " 张）");
      }).catch(function (e) {
        errInto("mergeResult", e.message || String(e));
        setFoot("从画布取图失败");
      });
    });
  }

  /* ---------- 检查更新（GitHub latest.json 对比） ---------- */
  var PLUGIN_VERSION = "1.6.1";
  var REPO = "nwj817/doubao-photon-plugin";
  // 更新信息多源探测：按顺序尝试，哪个可达用哪个（国内网络下 api.github.com 最稳，raw/CDN 兜底）
  var UPD_SOURCES = [
    "https://api.github.com/repos/" + REPO + "/contents/latest.json",
    "https://raw.githubusercontent.com/" + REPO + "/main/latest.json",
    "https://cdn.jsdelivr.net/gh/" + REPO + "@main/latest.json",
    "https://cdn.staticaly.com/gh/" + REPO + "@main/latest.json"
  ];
  function renderUpdateInfo(html) {
    $("updBody").innerHTML = '<div style="padding:6px 2px">' + html + "</div>";
    $("updPanel").classList.remove("hidden");
  }
  function fetchUpdateInfo() {
    var chain = Promise.reject(new Error("no source"));
    UPD_SOURCES.forEach(function (src) {
      chain = chain.catch(function () {
        return SDK.network.request({ method: "GET", url: src }).then(function (r) {
          var text = "";
          if (r && typeof r.body === "string") text = r.body;
          else if (r && r.body && typeof r.body.content === "string") text = atob(r.body.content); // api.github.com 返回 base64
          if (!text) throw new Error("empty response");
          var data = JSON.parse(text);
          if (!data || !data.version) throw new Error("bad update info");
          return data;
        });
      });
    });
    return chain;
  }
  function checkUpdate(silent) {
    if (!SDK.network || typeof SDK.network.request !== "function") {
      if (!silent) renderUpdateInfo("当前环境不支持网络请求（SDK.network 不可用）");
      return;
    }
    // 静默自动检查 + 近期已确认最新 → 跳过（省网络请求）
    if (silent) {
      try {
        var cached = JSON.parse(localStorage.getItem("doubao.updCheck") || "{}");
        if (cached && cached.v === PLUGIN_VERSION && (Date.now() - (cached.t || 0)) < 10 * 60 * 1000) return;
      } catch (e) { }
    }
    fetchUpdateInfo().then(function (data) {
      var latest = data.version;
      if (String(latest) === PLUGIN_VERSION) {
        try { localStorage.setItem("doubao.updCheck", JSON.stringify({ t: Date.now(), v: PLUGIN_VERSION })); } catch (e) { }
        if (!silent) renderUpdateInfo('<div class="hint" style="text-align:center;margin-top:16px">当前已是最新版本 <b style="color:var(--ph-text)">v' + esc(PLUGIN_VERSION) + "</b></div>");
      } else {
        renderUpdateInfo(
          '<div style="font-size:var(--ph-text-sm);margin-bottom:8px">发现新版本：<b style="color:var(--ph-accent);font-size:var(--ph-text)">v' + esc(latest) + "</b>（当前 v" + esc(PLUGIN_VERSION) + "）</div>" +
          (data.note ? '<div style="margin-bottom:10px;white-space:pre-wrap">' + esc(data.note) + "</div>" : "") +
          '<div style="margin-bottom:10px">更新步骤：点「下载更新包」保存 zip → 解压 → 退出 Photon → 双击「一键安装豆包插件.bat」→ 重启 Photon。</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn primary" data-act="dlzip" data-url="' + escAttr(data.zip || "") + '">下载更新包</button>' +
          '<button class="btn" data-act="copy" data-text="' + escAttr(data.zip || ("https://raw.githubusercontent.com/" + REPO + "/main/latest.json")) + '">复制下载链接</button>' +
          '</div>'
        );
        if (silent) setFoot("发现新版本 v" + latest + "，点「检查更新」查看");
      }
    }).catch(function (e) {
      if (!silent) renderUpdateInfo("检查失败：" + friendlyErr(e.message || String(e)) + "<br>当前网络可能无法访问 GitHub 更新源，请稍后重试，或直接访问仓库 <b>github.com/" + esc(REPO) + "</b> 手动下载更新。");
    });
  }

  /* 一键下载更新包：优先走 api.github.com 二进制（base64），失败再试直链；都不可行则复制链接 */
  function str2bin(s) {
    var n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function zipPathFromUrl(url) {
    var m = /\/releases\/[^\/?#]+\.zip/i.exec(url || "");
    return m ? m[0].replace(/^\//, "") : "";
  }
  function saveZipBlob(bytes, url) {
    var blob = new Blob([bytes], { type: "application/zip" });
    var name = "doubao-photon-panel-v" + PLUGIN_VERSION + ".zip";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    renderUpdateInfo("下载已开始：保存 <b>" + esc(name) + "</b> → 解压 → 退出 Photon → 双击「一键安装豆包插件.bat」→ 重启 Photon 即完成更新。");
  }
  function downloadZip(url) {
    if (!url) { renderUpdateInfo("更新包地址为空，请点「复制下载链接」手动下载"); return; }
    if (!SDK.network || typeof SDK.network.request !== "function") {
      renderUpdateInfo("当前环境不支持网络下载，请点「复制下载链接」在浏览器中打开下载"); return;
    }
    setFoot("正在下载更新包…");
    var apiUrl = "https://api.github.com/repos/" + REPO + "/contents/" + zipPathFromUrl(url);
    SDK.network.request({ method: "GET", url: apiUrl }).then(function (r) {
      if (r && r.body && typeof r.body.content === "string") {
        var bytes = str2bin(atob(r.body.content));
        if (bytes && bytes.length >= 5000) { saveZipBlob(bytes, url); return; }
      }
      throw new Error("api binary unavailable");
    }).catch(function () {
      // 兜底：直链下载
      return SDK.network.request({ method: "GET", url: url }).then(function (r) {
        var body = r && r.body !== undefined ? r.body : (r && r.data !== undefined ? r.data : null);
        if (body === null || body === undefined) throw new Error("empty response");
        var bytes = null;
        if (typeof body === "string") bytes = str2bin(body);
        else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
        else if (body && body.buffer) bytes = new Uint8Array(body.buffer);
        if (!bytes || bytes.length < 5000) throw new Error("bad bytes");
        saveZipBlob(bytes, url);
      }).catch(function (e2) {
        setFoot("面板内保存不可用，已为你复制下载链接");
        renderUpdateInfo("当前环境无法直接保存文件，已自动复制下载链接，粘贴到浏览器打开即可下载。");
        navigator.clipboard.writeText(url).catch(function () { });
      });
    });
  }

  function bindActions() {
    $("genRun").addEventListener("click", runGenerate);
    $("editRun").addEventListener("click", runEdit);
    $("editReverse").addEventListener("click", runReverse);
    $("editModel").addEventListener("change", updateEditTransparentState);
    $("mergeRun").addEventListener("click", runMerge);
    $("trRun").addEventListener("click", runTranslate);
    $("keyBtn").addEventListener("click", configureKey);
    $("updBtn").addEventListener("click", function () { checkUpdate(false); });
    $("updClose").addEventListener("click", function () { $("updPanel").classList.add("hidden"); });

    $("opsBtn").addEventListener("click", function () {
      if (!SDK.documents || typeof SDK.documents.operations !== "function") {
        setFoot("SDK 未提供 operations 枚举"); return;
      }
      $("opsBtn").disabled = true; $("opsBtn").textContent = "查询中…";
      var queries = ["", ".", "*", "layer", "transform", "scale", "smart", "document", "pixels", "select", "filter", "core"];
      var results = [];
      function run(i) {
        if (i >= queries.length) {
          var lines = results.map(function (r) {
            return "query=" + JSON.stringify(r.q) + " → " + r.n + " 项" + (r.names.length ? "：" + r.names.join(", ") : "");
          });
          var text = "可用操作（多 query 汇总）：\n" + lines.join("\n") + "\n\n原始样例：" + JSON.stringify(results[0] && results[0].raw).slice(0, 1500);
          setFoot(text.replace(/\n/g, " ").slice(0, 900));
          var show = $("showOps");
          if (show) { show.value = text; show.style.display = "block"; }
          $("opsBtn").textContent = "能力清单"; $("opsBtn").disabled = false;
          return;
        }
        var q = queries[i];
        var p = {};
        if (q !== "") p.query = q;
        SDK.documents.operations(p).then(function (list) {
          var arr = Array.isArray(list) ? list : (list && list.operations) || [];
          var names = arr.map(function (o) { return (o && (o.id || o.name || o.operation)) || "?"; });
          results.push({ q: q, n: arr.length, names: names, raw: list });
          run(i + 1);
        }).catch(function (e) {
          results.push({ q: q, n: -1, names: [], raw: String((e && e.message) || e) });
          run(i + 1);
        });
      }
      run(0);
    });

    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-act]") : null;
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === "chatRmAttach") {
        chatAttachImg = null;
        renderChatAttach();
        setFoot("已移除附件图片");
      } else if (act === "chatToGen") {
        $("genPrompt").value = btn.dataset.text || "";
        var gtab = document.querySelector('.tab[data-view="generate"]');
        if (gtab) gtab.click();
        setFoot("已把回复填入文生图，可修改后生成");
      } else if (act === "editFill") {
        $("editPrompt").value = revText;
        setFoot("已填入本页编辑指令");
      } else if (act === "toGenFill") {
        $("genPrompt").value = revText;
        var gtab2 = document.querySelector('.tab[data-view="generate"]');
        if (gtab2) gtab2.click();
        setFoot("已填入文生图画面描述");
      } else if (act === "presetUse") {
        var pi = +btn.dataset.idx;
        if (!promptPresets[pi]) return;
        presetTarget().value = promptPresets[pi].text;
        $("presetPanel").classList.add("hidden");
        setFoot("已注入预设：" + promptPresets[pi].name);
      } else if (act === "presetDel") {
        var pj = +btn.dataset.idx;
        if (!promptPresets[pj]) return;
        promptPresets.splice(pj, 1);
        savePromptPresets();
        renderPresetList();
        setFoot("已删除该预设");
      } else if (act === "sessOpen") {
        var idx = +btn.dataset.idx;
        if (!state.chatSessions[idx]) return;
        var s = state.chatSessions[idx];
        saveCurrentSession();   // 当前对话若有未存档内容，先存档
        $("chatSessions").classList.add("hidden");
        restoreSession(s);
      } else if (act === "sessDel") {
        var idx2 = +btn.dataset.idx;
        if (!state.chatSessions[idx2]) return;
        state.chatSessions.splice(idx2, 1);
        saveChatSessions();
        renderChatSessions();
        setFoot("已删除该会话");
      } else if (act === "copy") {
        navigator.clipboard.writeText(btn.dataset.text || "").then(function () {
          btn.textContent = "已复制"; setFoot("已复制到剪贴板");
          setTimeout(function () { btn.textContent = "复制"; }, 1500);
        }).catch(function () { setFoot("复制失败"); });
      } else if (act === "dlzip") {
        downloadZip(btn.dataset.url || "");
      } else if (act === "copyurl") {
        var a = btn.parentElement.parentElement.querySelector("a");
        navigator.clipboard.writeText(a ? a.href : "").then(function () {
          btn.textContent = "已复制"; setTimeout(function () { btn.textContent = "复制链接"; }, 1500);
        });
      } else if (act === "place") {
        // 从当前结果容器找已存的图片数据
        var container = btn.closest(".result");
        var holder = container && container.__img;
        if (holder) {
          btn.disabled = true; btn.textContent = "置入中…";
          placeOnCanvas(holder.bytes, { label: (container && container.__label) || "豆包生成" }).then(function (r) {
            btn.disabled = false;
            btn.textContent = "置入画布";
            if (r && r.smart) setFoot("已置入画布并转为智能对象（等比居中，原始像素无损）图层：" + (r.layerName || "智能对象"));
            else if (r && r.placed) setFoot("已置入画布（等比居中）；智能对象图层未识别，请检查图层面板");
            else setFoot("已置入当前文档（等比适配）");
          }).catch(function (e) {
            btn.disabled = false;
            btn.textContent = "置入画布"; setFoot("置入失败：" + (e.message || e));
          });
        }
      } else if (act === "histPlace") {
        // 生成图库 → 重新置入画布
        var hid = btn.dataset.id;
        var item = histById(hid);
        if (item) {
          btn.disabled = true; btn.textContent = "置入中…";
          placeOnCanvas(item.bytes, { label: item.label }).then(function (r) {
            btn.disabled = false; btn.textContent = "置入";
            if (r && r.smart) setFoot("已从图库置入画布（智能对象 · 等比居中）" + (r.layerName ? "图层：" + r.layerName : ""));
            else if (r && r.placed) setFoot("已从图库置入画布（等比居中）");
            else setFoot("已置入当前文档");
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = "置入"; setFoot("置入失败：" + (e.message || e));
          });
        }
      } else if (act === "histPreview") {
        var pv = histById(btn.dataset.id);
        if (pv) {
          $("histPrevImg").src = dataURI("image/png", bytesToBase64(pv.bytes));
          $("histPreview").classList.remove("hidden");
        }
      } else if (act === "histSave") {
        var hs = histById(btn.dataset.id);
        if (hs) {
          btn.disabled = true; btn.textContent = "保存中…";
          saveToDisk(hs.bytes).then(function (path) {
            btn.disabled = false; btn.textContent = "保存 PNG";
            if (path) setFoot("已保存：" + path);
            else setFoot("已取消");
          }).catch(function (e) { btn.disabled = false; btn.textContent = "保存 PNG"; setFoot("保存失败：" + (e.message || e)); });
        }
      } else if (act === "chatPlace") {
        var cm = state.chat[parseInt(btn.dataset.idx, 10)];
        if (cm && cm.image) {
          btn.disabled = true; btn.textContent = "置入中…";
          placeOnCanvas(cm.image.bytes, { label: "对话生图 · 置入" }).then(function (r) {
            btn.disabled = false; btn.textContent = "置入画布";
            if (r && r.smart) setFoot("已置入画布并转为智能对象（等比居中，原始像素无损）");
            else if (r && r.placed) setFoot("已置入画布（等比居中）");
            else setFoot("已置入当前文档");
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = "置入画布"; setFoot("置入失败：" + (e.message || e));
          });
        }
      } else if (act === "save") {
        var holder2 = btn.closest(".result") && btn.closest(".result").__img;
        if (holder2) {
          btn.disabled = true; btn.textContent = "保存中…";
          saveToDisk(holder2.bytes).then(function (path) {
            btn.disabled = false;
            if (path) { btn.textContent = "保存到本地"; setFoot("已保存：" + path); }
            else { btn.textContent = "保存到本地"; setFoot("已取消"); }
          }).catch(function (e) { btn.disabled = false; btn.textContent = "保存到本地"; setFoot("保存失败：" + (e.message || e)); });
        }
      }
    });

    // 移除已选图片
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-rm]") : null;
      if (!btn) return;
      var path = btn.dataset.rm;
      if (state.edit && state.edit[0] && state.edit[0].path === path) { state.edit = []; $("editPicked").innerHTML = ""; }
      if (state.op && state.op.path === path) { state.op = null; $("opPicked").innerHTML = ""; }
      if (state.merge) {
        state.merge = state.merge.filter(function (p) { return p.path !== path; });
        renderPicked("mergePicked", state.merge);
      }
    });
  }

  function storeImageData() {
    // 把图片 bytes 挂到 result 容器上，供 置入/保存 按钮使用
    var observer = new MutationObserver(function () {
      document.querySelectorAll(".result").forEach(function (r) {
        var img = r.querySelector("img");
        var holder = r.__img;
        if (img && !holder && img.src && img.src.indexOf("data:") === 0) {
          var b64 = img.src.split(",")[1];
          try { r.__img = { bytes: base64ToBytes(b64) }; } catch (e) { }
        }
      });
    });
    observer.observe(document.getElementById("content"), { childList: true, subtree: true });
  }

  /* ---------- 文档信息 ---------- */
  function refreshDocInfo() {
    if (!SDK) return;
    SDK.documents.active().then(function (doc) {
      if (doc) {
        var w = doc.width, h = doc.height, name = doc.name || doc.title || "";
        $("docInfo").textContent = "文档：" + name + " " + (w || "?") + "×" + (h || "?");
      } else {
        $("docInfo").textContent = "未打开文档";
      }
    }).catch(function () { $("docInfo").textContent = ""; });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    loadChatSessions();
    loadPromptPresets();
    bindTabs();
    bindPicks();
    bindActions();
    bindGenSize();
    bindPreset();
    updateEditTransparentState();
    bindChat();
    bindOutpaint();
    bindTrLayer();
    storeImageData();

    if (window.__photonSdk && window.__photonSdk.activate) {
      window.__photonSdk.activate(function (api) {
        SDK = api;
        setFoot("SDK 已连接");
        refreshKeyStatus();
        refreshDocInfo();
        setInterval(refreshDocInfo, 5000);
        // 请求端点批准（若 Photon 弹出 Allow endpoint 窗口，请点 Allow）
        if (SDK.network && SDK.network.allowEndpoint) {
          SDK.network.allowEndpoint(ARK_ORIGIN).catch(function () { });
          SDK.network.allowEndpoint("https://api.github.com").catch(function () { });
          SDK.network.allowEndpoint("https://raw.githubusercontent.com").catch(function () { });
          SDK.network.allowEndpoint("https://cdn.jsdelivr.net").catch(function () { });
          SDK.network.allowEndpoint("https://cdn.staticaly.com").catch(function () { });
        }
        // 打开面板自动检查一次更新（有新版才提示）
        checkUpdate(true);
      });
    } else {
      // 等待 SDK 注入
      var tries = 0;
      var timer = setInterval(function () {
        tries++;
        if (window.__photonSdk && window.__photonSdk.activate) {
          clearInterval(timer);
          window.__photonSdk.activate(function (api) {
            SDK = api;
            setFoot("SDK 已连接");
            refreshKeyStatus();
            refreshDocInfo();
            setInterval(refreshDocInfo, 5000);
            if (SDK.network && SDK.network.allowEndpoint) {
              SDK.network.allowEndpoint(ARK_ORIGIN).catch(function () { });
            }
          });
        } else if (tries > 100) {
          clearInterval(timer);
          setFoot("SDK 未就绪，请重启 Photon 后重试");
        }
      }, 200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
