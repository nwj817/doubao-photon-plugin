"use strict";

/* ========= 模块：translate —— 本地中→英词典翻译（不联网、不消耗额度；保留取文本图层原文） ========= */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  /* 电商设计高频词词典（最长匹配时自动按词长排序，无需手动排序） */
  var DICT = {
    /* 产品与器材 */
    "补光灯": "fill light", "摄影灯": "video light", "环形灯": "ring light", "直播灯": "streaming light",
    "三脚架": "tripod", "灯架": "light stand", "云台": "gimbal", "吸盘": "suction cup",
    "摄影": "photography", "拍摄": "shooting", "拍照": "photo", "录像": "video recording",
    "直播": "live streaming", "带货": "live commerce", "电商": "e-commerce", "主图": "main image",
    "详情页": "detail page", "海报": "poster", "商品": "product", "产品": "product",
    "手机": "smartphone", "相机": "camera", "镜头": "lens",
    /* 卖点与品质 */
    "高清": "HD", "超清": "ultra HD", "专业": "professional", "高品质": "premium quality",
    "品质": "quality", "高档": "high-end", "优质": "premium", "精美": "exquisite",
    "便携": "portable", "轻便": "lightweight", "折叠": "foldable", "小巧": "compact",
    "可调": "adjustable", "无极": "stepless", "亮度": "brightness", "色温": "color temperature",
    "充电": "rechargeable", "续航": "battery life", "电池": "battery", "磁吸": "magnetic",
    "无线": "wireless", "智能": "smart", "稳定": "stable", "静音": "silent",
    "柔光": "soft light", "均匀": "even", "自然": "natural", "美颜": "beauty",
    "嫩肤": "skin smoothing", "美白": "whitening", "显色": "color rendering", "护眼": "eye-friendly",
    "耐用": "durable", "坚固": "sturdy", "防滑": "non-slip", "防震": "shockproof",
    /* 营销与时效 */
    "热销": "best seller", "爆款": "bestseller", "新品": "new arrival", "新款": "new model",
    "特惠": "special offer", "限时": "limited time", "特价": "on sale", "折扣": "discount",
    "包邮": "free shipping", "正品": "authentic", "推荐": "recommended", "首选": "top choice",
    "超值": "great value", "优惠": "offer", "秒杀": "flash deal", "热销中": "hot now",
    "爆款推荐": "bestseller recommended", "店长推荐": "manager's pick", "人气": "popular",
    /* 风格与调性 */
    "简约": "minimalist", "现代": "modern", "时尚": "stylish", "经典": "classic",
    "高级": "premium", "大气": "elegant", "清新": "fresh", "治愈": "soothing",
    "商务": "business", "科技": "tech", "质感": "texture", "氛围": "ambience",
    /* 材质 */
    "铝合金": "aluminum alloy", "不锈钢": "stainless steel", "金属": "metal", "塑料": "plastic",
    "硅胶": "silicone", "皮革": "leather", "玻璃": "glass", "橡胶": "rubber", "ABS": "ABS",
    /* 常用动词与形容词 */
    "支持": "supports", "适合": "ideal for", "适用": "suitable for", "轻松": "easy",
    "快速": "fast", "高效": "efficient", "安全": "safe", "稳定输出": "stable output",
    "多角度": "multi-angle", "全方位": "full-range", "多场景": "multi-scene",
    "自拍": "selfie", "静物": "still life", "人像": "portrait", "美食": "food",
    "室内": "indoor", "室外": "outdoor", "夜景": "night scene",
    /* 数字单位（常用规格词） */
    "瓦": "W", "厘米": "cm", "毫米": "mm", "英寸": "inch", "毫安": "mAh",
    /* 标点 */
    "，": ", ", "。": ".", "！": "!", "？": "?", "：": ":", "；": ";", "、": ", ",
    "（": " (", "）": ") ", "【": " [", "】": "] "
  };

  /* 按词长降序排序，保证最长匹配 */
  var KEYS = Object.keys(DICT).sort(function (a, b) { return b.length - a.length; });

  function translateLine(line) {
    var out = "", i = 0;
    while (i < line.length) {
      var hit = "";
      for (var k = 0; k < KEYS.length; k++) {
        var w = KEYS[k];
        if (line.substr(i, w.length) === w) { hit = w; break; }
      }
      if (hit) {
        var tr = DICT[hit];
        if (out && !/[\s\-\(]$/.test(out)) out += " ";
        out += tr;
        i += hit.length;
      } else {
        out += line[i];
        i++;
      }
    }
    return out.replace(/[ \t]{2,}/g, " ").trim();
  }

  function docSnapshot() {
    return DP.SDK.documents.active().then(function (doc) {
      if (!doc) return { docId: null, layers: [], selected: null };
      return {
        docId: doc.documentId || doc.id,
        layers: (doc.layers || []).filter(function (l) { return l.kind === "type"; }),
        selected: (doc.selectedLayerIds || [])[0] || null
      };
    });
  }

  /* 切到翻译页时刷新文本图层下拉（boot.bindTabs 调用） */
  DP.fillTrLayerOptions = function () {
    docSnapshot().then(function (info) {
      var sel = DP.$("trLayer");
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
  };

  DP.registerInit(function () {
    DP.$("trRun").addEventListener("click", function () {
      var text = DP.$("trText").value;
      if (!text.trim()) { DP.errInto("trResult", "请输入要翻译的内容"); return; }
      var lines = text.split(/\n/).filter(function (l) { return l.trim(); });
      if (!lines.length) { DP.errInto("trResult", "请输入要翻译的内容"); return; }
      DP.clearErr("trResult");
      DP.setBusy("trBusy", true);
      /* 本地同步词典翻译，几乎瞬间完成；用 setTimeout 让 UI 先渲染 busy */
      setTimeout(function () {
        var out = lines.map(translateLine).join("\n");
        var html = '<div class="result"><div class="rhead"><div class="dot"></div><div class="ttl">英文译文（本地词典，' +
          lines.length + " 行，逐行对应）</div>" +
          '<button class="btn small" data-act="copy" data-text="' + DP.escAttr(out) + '">复制全部</button></div>' +
          "<pre>" + DP.esc(out) + "</pre></div>";
        DP.$("trResult").innerHTML = html;
        DP.setBusy("trBusy", false);
      }, 30);
    });
    var getBtn = DP.$("trLayerGet");
    if (getBtn) {
      getBtn.addEventListener("click", function () {
        docSnapshot().then(function (info) {
          var lid = DP.$("trLayer").value;
          var layer = null;
          info.layers.forEach(function (l) { if (l.id === lid) layer = l; });
          if (!layer) {
            info.layers.forEach(function (l) { if (l.id === info.selected) layer = l; });
          }
          if (!layer) { DP.setFoot("未找到可用的文本图层，请先在画布中选择或创建文本图层"); return; }
          DP.$("trText").value = layer.name;
          DP.setFoot("已从文本图层取原文：" + layer.name);
        }).catch(function (e) { DP.setFoot("读取文本图层失败：" + (e.message || e)); });
      });
    }
  });
})();
