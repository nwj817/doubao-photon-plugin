"use strict";

/* ========= 模块：workflow —— 工作流（纯本地批处理，零 AI 消耗） =========
   ① 文件夹批量等比缩放 · 覆盖原图（格式可选 JPG/PNG，JPG 品质可调）
      - 目录枚举：SDK.files 无目录列表能力，采用「SDK 文件夹授权 + 隐藏 input[webkitdirectory]
        获取文件清单（File.webkitRelativePath）」拼接绝对路径，再走 SDK.files.read/write；
        宿主不支持时降级为「逐张添加」（SDK.files.pick 单文件追加，同样覆盖原图）
      - 缩放：SDK.images.decode 解码为 RGBA → canvas 等比缩放（长边适配、不拉伸）→
        canvas.toBlob 编码 JPG/PNG（本地编码，无需外部组件）
      - 覆盖：仅当输出扩展名与原文件一致时覆盖原路径；不一致时写同名新扩展名文件
      - 备份：默认覆盖前把原图写为「同目录 文件名.bak」（SDK 无 mkdir，备份走同目录可写路径）
   ② 一键导出当前文档（JPG / PNG / PDF）
      - 画布取图：documents.capture（用后立即 release 释放 token）
      - JPG/PNG：canvas.toBlob 编码；PDF：内联极简 PDF 生成器（DCTDecode 直嵌 JPG，单页）
      - 保存：SDK.files.pick({save:true}) 弹出保存位置（文件名预填「文档名.扩展名」）
   平台边界：面板侧无目录枚举与 JPEG/PDF 编码 API，上述全部走浏览器原生能力 + SDK 授权路径。 */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var IMG_RE = /\.(jpe?g|png|webp)$/i;

  /* ---------- 工作流 1 状态 ---------- */
  var wf1 = {
    folder: "",
    files: [],     // [{name, abs, rel, size}]
    tw: 0, th: 0,
    fmt: "jpg",
    quality: 90,
    shrinkOnly: true,
    backup: true,
    running: false
  };

  /* ---------- 通用：字节 / Blob / canvas ---------- */
  function blobToBytes(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); };
      fr.onerror = function () { rej(new Error("读取编码结果失败")); };
      fr.readAsArrayBuffer(blob);
    });
  }
  function canvasToBlob(cv, type, quality) {
    return new Promise(function (res, rej) {
      cv.toBlob(function (b) {
        if (b) res(b);
        else rej(new Error("图片编码失败：" + type));
      }, type, quality);
    });
  }
  function pixelsToCanvas(w, h, pixels) {
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    var id = ctx.createImageData(w, h);
    id.data.set(pixels);
    ctx.putImageData(id, 0, 0);
    return cv;
  }
  function scaleCanvas(src, dw, dh) {
    var cv = document.createElement("canvas");
    cv.width = dw; cv.height = dh;
    var ctx = cv.getContext("2d");
    try { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; } catch (e) { }
    ctx.drawImage(src, 0, 0, dw, dh);
    return cv;
  }

  /* ---------- 内联极简 PDF 生成器：单页，DCTDecode 直嵌 JPEG ---------- */
  function pad10(n) {
    var s = String(n);
    while (s.length < 10) s = "0" + s;
    return s;
  }
  function buildPdf(jpegBytes, w, h) {
    var enc = new TextEncoder();
    var W = String(Math.round(w)), H = String(Math.round(h));
    var parts = [];
    parts.push(enc.encode("%PDF-1.4\n"));
    parts.push(enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
    parts.push(enc.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"));
    parts.push(enc.encode("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H +
      "] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"));
    var imgHead = enc.encode("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + W + " /Height " + H +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpegBytes.length + " >>\nstream\n");
    parts.push(imgHead);
    parts.push(jpegBytes);
    parts.push(enc.encode("\nendstream\nendobj\n"));
    var content = enc.encode("q " + W + " 0 0 " + H + " 0 0 cm /Im0 Do Q");
    var contHead = enc.encode("5 0 obj\n<< /Length " + content.length + " >>\nstream\n");
    parts.push(contHead);
    parts.push(content);
    parts.push(enc.encode("\nendstream\nendobj\n"));
    /* 记录各对象字节偏移（对象 1-5 分别在 parts[1],[2],[3],[4],[7]） */
    var offs = [];
    var pos = 0;
    for (var i = 0; i < parts.length; i++) {
      if (i === 1 || i === 2 || i === 3 || i === 4 || i === 7) offs.push(pos);
      pos += parts[i].length;
    }
    var xrefPos = pos;
    var trailer = enc.encode("xref\n0 6\n" +
      "0000000000 65535 f \n" +
      pad10(offs[0]) + " 00000 n \n" +
      pad10(offs[1]) + " 00000 n \n" +
      pad10(offs[2]) + " 00000 n \n" +
      pad10(offs[3]) + " 00000 n \n" +
      pad10(offs[4]) + " 00000 n \n" +
      "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF\n");
    var total = pos + trailer.length;
    var out = new Uint8Array(total);
    var o = 0;
    for (var j = 0; j < parts.length; j++) { out.set(parts[j], o); o += parts[j].length; }
    out.set(trailer, o);
    return out;
  }

  /* ---------- 路径工具 ---------- */
  function joinPath(folder, rel) {
    var base = String(folder).replace(/[\\/]+$/, "");
    return base + "\\" + rel.replace(/\//g, "\\");
  }
  function fileNameOf(path) {
    var s = String(path);
    var idx = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
    return idx >= 0 ? s.slice(idx + 1) : s;
  }

  /* ---------- 工作流 1：扫描文件夹 ---------- */
  function pickDirFiles() {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      try { input.setAttribute("webkitdirectory", ""); } catch (e) { }
      input.setAttribute("directory", "");
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      var done = false;
      input.addEventListener("change", function () {
        if (done) return;
        done = true;
        var files = Array.prototype.slice.call(input.files || []);
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(files);
      });
      input.click();
    });
  }

  function scan() {
    if (!DP.SDK || !DP.SDK.files || !DP.SDK.files.pick) {
      DP.setFoot("SDK 文件能力不可用，请重启 Photon"); return;
    }
    var btn = DP.$("wf1Scan");
    btn.disabled = true;
    DP.setFoot("第 1 步：请选择要处理的文件夹…（第 2 步会再选一次同一个文件夹以读取文件清单）");
    DP.SDK.files.pick({ folder: true }).then(function (folder) {
      if (!folder) { DP.setFoot("已取消选择文件夹"); return null; }
      DP.setFoot("第 2 步：请再次选择同一个文件夹（用于读取文件清单）…");
      return pickDirFiles().then(function (files) {
        if (!files || !files.length) return null;
        var list = [];
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var rel = f.webkitRelativePath || "";
          if (!rel) continue;
          if (!IMG_RE.test(f.name)) continue;
          list.push({ name: f.name, abs: joinPath(folder, rel), rel: rel, size: f.size || 0 });
        }
        return list;
      });
    }).then(function (list) {
      if (list === null) {
        DP.setFoot("已取消选择文件夹");
        return;
      }
      if (!list.length) {
        DP.setFoot("文件夹中没有找到 JPG / PNG / WebP 图片（若两次选择的文件夹不一致，请重新扫描）");
        return;
      }
      wf1.folder = folder;
      wf1.files = list;
      renderWf1List();
      DP.setFoot("已扫描 " + list.length + " 张图片");
    }).catch(function (e) {
      DP.setFoot("扫描失败：" + (e && e.message || e));
    }).finally(function () { btn.disabled = false; });
  }

  /* ---------- 工作流 1：逐张添加（降级入口） ---------- */
  function addOne() {
    if (!DP.SDK || !DP.SDK.files || !DP.SDK.files.pick) {
      DP.setFoot("SDK 文件能力不可用，请重启 Photon"); return;
    }
    if (wf1.running) { DP.setFoot("正在处理中，请稍候"); return; }
    DP.SDK.files.pick({ folder: false }).then(function (path) {
      if (!path) return;
      var name = fileNameOf(path);
      if (!IMG_RE.test(name)) { DP.setFoot("仅支持 JPG / PNG / WebP 图片"); return; }
      wf1.files.push({ name: name, abs: path, rel: "", size: 0 });
      renderWf1List();
      DP.setFoot("已添加：" + name + "（共 " + wf1.files.length + " 张）");
    }).catch(function (e) {
      DP.setFoot("添加失败：" + (e && e.message || e));
    });
  }

  function removeItem(idx) {
    if (wf1.running) return;
    wf1.files.splice(idx, 1);
    renderWf1List();
  }

  /* ---------- 工作流 1：列表 / 进度渲染 ---------- */
  function renderWf1List() {
    var meta = DP.$("wf1Meta"), list = DP.$("wf1List");
    if (meta) {
      meta.textContent = wf1.files.length
        ? "共 " + wf1.files.length + " 张图片" + (wf1.folder ? " · " + wf1.folder : " ·（逐张添加模式）")
        : "未扫描，请先选择文件夹";
    }
    if (list) {
      var show = wf1.files.slice(0, 80);
      var html = show.map(function (it, idx) {
        return '<div class="picked" style="padding:5px 9px"><div class="pname" style="font-size:11px">' +
          DP.esc(it.name) + '</div><button class="btn small" data-wf1rm="' + idx + '">移除</button></div>';
      }).join("");
      if (wf1.files.length > 80) {
        html += '<div class="tlhint" style="padding:5px 0">…等共 ' + wf1.files.length + ' 个文件（全部会处理）</div>';
      }
      list.innerHTML = html;
    }
    DP.$("wf1Run").disabled = !wf1.files.length || wf1.running;
  }

  /* ---------- 工作流 1：单文件处理 ---------- */
  function processOne(item) {
    var fmt = wf1.fmt, q = wf1.quality;
    return DP.SDK.files.read(item.abs).then(function (u8) {
      if (!(u8 instanceof Uint8Array)) throw new Error("读取文件失败（可能未授权或超过 64MB）");
      item.orig = u8;
      return DP.SDK.images.decode({ bytes: u8 });
    }).then(function (img) {
      if (!img || !img.width || !img.height || !img.pixels) throw new Error("图片解码失败（格式不支持或超过 1600 万像素）");
      var scale = Math.min(wf1.tw / img.width, wf1.th / img.height);
      if (wf1.shrinkOnly && scale > 1) scale = 1;
      var dw = Math.max(1, Math.round(img.width * scale));
      var dh = Math.max(1, Math.round(img.height * scale));
      if (dw > 8192 || dh > 8192) throw new Error("缩放后尺寸超限（>" + 8192 + "px），请调小目标尺寸");
      var src = pixelsToCanvas(img.width, img.height, img.pixels);
      var dst = scaleCanvas(src, dw, dh);
      var type = fmt === "jpg" ? "image/jpeg" : "image/png";
      return canvasToBlob(dst, type, fmt === "jpg" ? q / 100 : undefined).then(blobToBytes);
    }).then(function (outBytes) {
      var ext = fmt === "jpg" ? ".jpg" : ".png";
      var lower = item.abs.toLowerCase();
      var target;
      if (fmt === "jpg" && /\.jpe?g$/i.test(item.abs)) target = item.abs;
      else if (fmt === "png" && /\.png$/i.test(item.abs)) target = item.abs;
      else target = item.abs.replace(/\.[^.]+$/, "") + ext;
      var backupStep = (wf1.backup && target === item.abs && !item.backed)
        ? DP.SDK.files.write(item.abs + ".bak", item.orig).then(function () { item.backed = true; })
        : Promise.resolve();
      return backupStep.then(function () {
        return DP.SDK.files.write(target, outBytes);
      }).then(function () {
        return { target: target, size: outBytes.length };
      });
    });
  }

  /* ---------- 工作流 1：批量执行 ---------- */
  function runWf1() {
    var w = parseInt(DP.$("wf1W").value, 10);
    var h = parseInt(DP.$("wf1H").value, 10);
    if (!(w > 0) || !(h > 0)) { DP.setFoot("请填写有效的目标宽度与高度"); return; }
    if (w > 8192 || h > 8192) { DP.setFoot("目标尺寸不能超过 8192px"); return; }
    if (!wf1.files.length) { DP.setFoot("请先扫描文件夹或逐张添加图片"); return; }
    wf1.tw = w; wf1.th = h;
    wf1.fmt = wf1.fmt; wf1.quality = parseInt(DP.$("wf1Quality").value, 10) || 90;
    wf1.shrinkOnly = DP.$("wf1Shrink").checked;
    wf1.backup = DP.$("wf1Backup").checked;
    wf1.running = true;
    renderWf1List();
    DP.setBusy("wf1Busy", true);
    DP.$("wf1BusyText").textContent = "正在处理 0/" + wf1.files.length + "…";
    DP.$("wf1List").innerHTML = "";
    var total = wf1.files.length;
    var i = 0, ok = 0, fails = [];
    function next() {
      if (i >= total) { finish(); return; }
      var item = wf1.files[i];
      i++;
      processOne(item).then(function (r) {
        ok++;
        DP.$("wf1BusyText").textContent = "正在处理 " + i + "/" + total + "…";
        next();
      }).catch(function (e) {
        fails.push({ name: item.abs, err: (e && e.message) || String(e) });
        DP.$("wf1BusyText").textContent = "正在处理 " + i + "/" + total + "…";
        next();
      });
    }
    function finish() {
      wf1.running = false;
      DP.setBusy("wf1Busy", false);
      renderWf1List();
      var lines = ["成功 " + ok + " / " + total + " 个文件" + (wf1.files.length ? "" : "")];
      if (fails.length) {
        lines.push("");
        lines.push("失败 " + fails.length + " 个：");
        for (var k = 0; k < fails.length && k < 20; k++) {
          lines.push("· " + fileNameOf(fails[k].name) + "：" + fails[k].err);
        }
        if (fails.length > 20) lines.push("…等 " + fails.length + " 个失败项");
      }
      if (wf1.backup) lines.push("已开启原图备份：同目录「文件名.bak」可手动恢复");
      DP.$("wf1List").innerHTML = '<div class="result"><div class="rhead"><div class="dot"></div>' +
        '<div class="ttl">批量处理完成</div></div><pre>' + DP.esc(lines.join("\n")) + "</pre></div>";
      DP.setFoot("工作流 1 完成：成功 " + ok + "，失败 " + fails.length);
    }
    next();
  }

  /* ---------- 工作流 2：导出当前文档 ---------- */
  function runWf2() {
    if (!DP.SDK || !DP.SDK.documents) { DP.setFoot("SDK 文档能力不可用，请重启 Photon"); return; }
    var want = [];
    if (DP.$("wf2Jpg").checked) want.push("jpg");
    if (DP.$("wf2Png").checked) want.push("png");
    if (DP.$("wf2Pdf").checked) want.push("pdf");
    if (!want.length) { DP.setFoot("请至少勾选一种导出格式"); return; }
    var q = parseInt(DP.$("wf2Quality").value, 10) || 90;
    var btn = DP.$("wf2Run");
    btn.disabled = true;
    DP.setBusy("wf2Busy", true);
    DP.$("wf2Result").innerHTML = "";

    DP.SDK.documents.active().then(function (doc) {
      var docId = doc && (doc.documentId || doc.id);
      if (!docId) throw new Error("没有打开的文档，请先新建或打开画布");
      var base = String(doc.name || doc.title || "导出").replace(/\.[^.]+$/, "");
      return DP.SDK.documents.capture({}).then(function (res) {
        var norm = DP.normalizePixels(res);
        if (res && res.token && DP.SDK.documents.release) {
          DP.SDK.documents.release({ token: res.token }).catch(function () { });
        }
        return { base: base, w: norm.w, h: norm.h, pixels: norm.pixels };
      });
    }).then(function (meta) {
      var cv = pixelsToCanvas(meta.w, meta.h, meta.pixels);
      var results = [], errors = [];
      function saveOne(label, name, makeBytes) {
        return makeBytes().then(function (bytes) {
          return DP.SDK.files.pick({ save: true, name: name }).then(function (path) {
            if (!path) return label + "：已取消保存";
            return DP.SDK.files.write(path, bytes).then(function () {
              return label + "：已保存 → " + path;
            });
          });
        });
      }
      var chain = Promise.resolve();
      if (want.indexOf("jpg") >= 0) {
        chain = chain.then(function () {
          return saveOne("JPG", meta.base + ".jpg", function () {
            return canvasToBlob(cv, "image/jpeg", q / 100).then(blobToBytes);
          }).then(function (r) { results.push(r); }, function (e) { errors.push("JPG：" + (e && e.message || e)); });
        });
      }
      if (want.indexOf("png") >= 0) {
        chain = chain.then(function () {
          return saveOne("PNG", meta.base + ".png", function () {
            return canvasToBlob(cv, "image/png").then(blobToBytes);
          }).then(function (r) { results.push(r); }, function (e) { errors.push("PNG：" + (e && e.message || e)); });
        });
      }
      if (want.indexOf("pdf") >= 0) {
        chain = chain.then(function () {
          return saveOne("PDF", meta.base + ".pdf", function () {
            return canvasToBlob(cv, "image/jpeg", q / 100).then(blobToBytes).then(function (jb) {
              return buildPdf(jb, meta.w, meta.h);
            });
          }).then(function (r) { results.push(r); }, function (e) { errors.push("PDF：" + (e && e.message || e)); });
        });
      }
      return chain.then(function () { return { results: results, errors: errors }; });
    }).then(function (out) {
      DP.setBusy("wf2Busy", false);
      btn.disabled = false;
      var lines = out.results.concat(out.errors);
      DP.$("wf2Result").innerHTML = '<div class="result"><div class="rhead"><div class="dot"></div>' +
        '<div class="ttl">导出结果</div></div><pre>' + DP.esc(lines.join("\n") || "未选择任何格式") + "</pre></div>";
      DP.setFoot("工作流 2 完成");
    }).catch(function (e) {
      DP.setBusy("wf2Busy", false);
      btn.disabled = false;
      DP.errInto("wf2Result", e && e.message || e);
      DP.setFoot("导出失败：" + (e && e.message || e));
    });
  }

  /* ---------- 事件：格式切换 / 品质联动 / 移除 ---------- */
  function bindWf1Fmt() {
    var box = DP.$("wf1Fmt");
    box.addEventListener("click", function (ev) {
      var el = ev.target.closest ? ev.target.closest("span[data-fmt]") : null;
      if (!el) return;
      box.querySelectorAll("span[data-fmt]").forEach(function (s) { s.classList.remove("on"); });
      el.classList.add("on");
      wf1.fmt = el.dataset.fmt;
      DP.$("wf1QualityRow").style.display = wf1.fmt === "jpg" ? "flex" : "none";
    });
    DP.$("wf1Quality").addEventListener("input", function () {
      DP.$("wf1QualityV").textContent = DP.$("wf1Quality").value;
    });
    DP.$("wf2Quality").addEventListener("input", function () {
      DP.$("wf2QualityV").textContent = DP.$("wf2Quality").value;
    });
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest ? ev.target.closest("button[data-wf1rm]") : null;
      if (!btn) return;
      removeItem(parseInt(btn.dataset.wf1rm, 10) || 0);
    });
  }

  /* ---------- 初始化绑定 ---------- */
  DP.registerInit(function () {
    if (!DP.$("wf1Scan")) return; // 视图未挂载（异常降级）时不重复绑定
    DP.$("wf1Scan").addEventListener("click", scan);
    DP.$("wf1AddOne").addEventListener("click", addOne);
    DP.$("wf1Run").addEventListener("click", runWf1);
    DP.$("wf2Run").addEventListener("click", runWf2);
    bindWf1Fmt();
    renderWf1List();
    DP.$("wf1QualityRow").style.display = "flex";
  });
})();
