"use strict";

/* ========= 模块：slice-export —— 参考线切片批量导出 =========
   功能：基于文档中的水平参考线，将超长详情页按参考线切分为多个区域，
        逐个导出为 JPEG，绕开整页导出的 8192px 尺寸限制。
   原理：每段切片高度通常 1000-2000px，远低于 8192px 上限，不会被自动缩小。
*/

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  /* ---------- 获取文档参考线 ---------- */
  async function getGuides() {
    var doc = await DP.SDK.documents.active();
    if (!doc) throw new Error("没有打开的文档");

    // 方式1：直接访问 doc.guides（类似 Photoshop UXP）
    if (doc.guides && Array.isArray(doc.guides) && doc.guides.length) {
      return doc.guides.map(function (g) {
        return {
          orientation: g.orientation || (g._orientation || "horizontal"),
          coordinate: g.coordinate || g._coordinate || 0
        };
      });
    }

    // 方式2：通过 documents.execute 查询
    try {
      var result = await DP.SDK.documents.execute("core.guides.list", {}, doc.documentId || doc.id);
      if (result && Array.isArray(result.guides)) return result.guides;
      if (Array.isArray(result)) return result;
    } catch (e) {
      // 静默失败，尝试下一种方式
    }

    // 方式3：通过 documents.operations 查询后再执行
    try {
      var ops = await DP.SDK.documents.operations({ query: "guide" });
      var arr = Array.isArray(ops) ? ops : (ops && ops.operations) || [];
      var names = arr.map(function (o) { return o.id || o.name || ""; });
      if (names.length) {
        DP.setFoot("找到参考线相关操作：" + names.join(", "));
      }
    } catch (e) { }

    return [];
  }

  /* ---------- 按水平参考线划分切片区域 ---------- */
  function splitByGuides(guides, docHeight) {
    // 筛选水平参考线，按坐标排序
    var hGuides = guides
      .filter(function (g) {
        var o = (g.orientation || "").toLowerCase();
        return o === "horizontal" || o === "h" || o === "水平";
      })
      .map(function (g) { return g.coordinate; })
      .filter(function (y) { return y > 0 && y < docHeight; })
      .sort(function (a, b) { return a - b; });

    // 构建切片区间：[0, g1], [g1, g2], ..., [gn, docHeight]
    var cuts = [0].concat(hGuides, [docHeight]);
    var slices = [];
    for (var i = 0; i < cuts.length - 1; i++) {
      var top = cuts[i];
      var bottom = cuts[i + 1];
      if (bottom - top < 10) continue; // 跳过过窄的切片
      slices.push({
        index: i + 1,
        top: Math.round(top),
        bottom: Math.round(bottom),
        height: Math.round(bottom - top)
      });
    }
    return slices;
  }

  /* ---------- 截取指定区域的像素 ---------- */
  async function captureRegion(docId, bounds) {
    // 方式1：capture 直接传 bounds
    try {
      var res = await DP.SDK.documents.capture({
        bounds: bounds
      });
      return normalizeCaptureResult(res);
    } catch (e1) {
      // 方式2：capture 传 sourceBounds
      try {
        var res2 = await DP.SDK.documents.capture({
          sourceBounds: bounds
        });
        return normalizeCaptureResult(res2);
      } catch (e2) {
        // 方式3：pixels 传 bounds
        try {
          var res3 = await DP.SDK.documents.pixels({
            bounds: bounds
          });
          return normalizeCaptureResult(res3);
        } catch (e3) {
          throw new Error("截取区域失败：" + (e3 && e3.message || String(e3)));
        }
      }
    }
  }

  function normalizeCaptureResult(res) {
    var w = 0, h = 0, px = null;
    if (res && res.width > 0 && res.height > 0) {
      w = res.width; h = res.height;
      px = DP.toU8(res.pixels || (res.image && res.image.pixels) || (res.data && res.data.pixels));
    }
    if (!px && res && res.image) {
      w = res.image.width; h = res.image.height;
      px = DP.toU8(res.image.pixels);
    }
    if (!px && res && res.sourceBounds && res.pixels) {
      var sb = res.sourceBounds;
      w = (sb.right != null && sb.left != null) ? (sb.right - sb.left) : (sb.width || 0);
      h = (sb.bottom != null && sb.top != null) ? (sb.bottom - sb.top) : (sb.height || 0);
      px = DP.toU8(res.pixels);
    }
    if (!px && res && res.imageData) {
      var imgData = res.imageData;
      w = imgData.width || (imgData.options && imgData.options.width) || 0;
      h = imgData.height || (imgData.options && imgData.options.height) || 0;
      px = DP.toU8(imgData.getData());
    }
    if (!px) throw new Error("捕获结果格式未识别：" + DP.shapeOf(res));
    if (px.length !== w * h * 4) {
      // 尝试自动推断
      if (px.length % 4 === 0) {
        var area = px.length / 4;
        var side = Math.round(Math.sqrt(area));
        if (side * side === area) { w = side; h = side; }
        else throw new Error("像素长度不匹配（期望 " + (w * h * 4) + "，实际 " + px.length + "）");
      } else {
        throw new Error("像素长度不是 RGBA 格式：" + px.length);
      }
    }
    return { w: w, h: h, pixels: px };
  }

  /* ---------- 像素数据编码为 JPEG ---------- */
  function pixelsToJPEG(w, h, pixels, quality) {
    return new Promise(function (resolve, reject) {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        var imgData = ctx.createImageData(w, h);
        imgData.data.set(pixels);
        ctx.putImageData(imgData, 0, 0);
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error("JPEG 编码失败")); return; }
          var reader = new FileReader();
          reader.onload = function () {
            var arr = new Uint8Array(reader.result);
            resolve(arr);
          };
          reader.onerror = function () { reject(new Error("读取 JPEG 数据失败")); };
          reader.readAsArrayBuffer(blob);
        }, "image/jpeg", quality || 0.85);
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ---------- 主流程：导出切片 ---------- */
  async function exportSlices() {
    if (!DP.SDK) { DP.setFoot("SDK 未就绪"); return; }

    var doc = await DP.SDK.documents.active();
    if (!doc) { DP.setFoot("没有打开的文档"); return; }

    var docW = doc.width, docH = doc.height;
    if (!docW || !docH) { DP.setFoot("文档尺寸无法获取"); return; }

    DP.setFoot("正在读取参考线…");

    // 获取参考线
    var guides = await getGuides();
    DP.setFoot("找到 " + guides.length + " 条参考线");

    // 划分切片
    var slices = splitByGuides(guides, docH);
    if (!slices.length) {
      DP.setFoot("未找到水平参考线，请先在画布中添加水平参考线划分切片");
      return;
    }

    DP.setFoot("共 " + slices.length + " 个切片，选择导出文件夹…");

    // 选择导出文件夹
    var folderPath = await DP.SDK.files.pick({ folder: true, title: "选择切片导出文件夹" });
    if (!folderPath) { DP.setFoot("已取消导出"); return; }

    var btn = DP.$("sliceRun");
    btn.disabled = true;
    btn.textContent = "导出中…";

    var okCount = 0, failCount = 0;
    var docName = (doc.name || "document").replace(/\.[^.]+$/, "");

    try {
      for (var i = 0; i < slices.length; i++) {
        var s = slices[i];
        DP.setFoot("正在导出第 " + (i + 1) + "/" + slices.length + " 段…");

        try {
          // 截取该区域
          var region = await captureRegion(doc.documentId || doc.id, {
            left: 0, top: s.top, right: docW, bottom: s.bottom
          });

          // 编码为 JPEG
          var jpegBytes = await pixelsToJPEG(region.w, region.h, region.pixels, 0.85);

          // 保存文件
          var fileName = docName + "_切片" + s.index + "_" + s.height + "px.jpg";
          var filePath = folderPath.replace(/\/$/, "") + "/" + fileName;
          await DP.SDK.files.write(filePath, jpegBytes);

          okCount++;
        } catch (e) {
          console.error("切片 " + s.index + " 导出失败:", e);
          failCount++;
        }
      }

      DP.setFoot("导出完成：成功 " + okCount + " 段，失败 " + failCount + " 段");
    } catch (e) {
      DP.setFoot("导出失败：" + (e && e.message || String(e)));
    } finally {
      btn.disabled = false;
      btn.textContent = "开始导出切片";
    }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    var btn = DP.$("sliceRun");
    if (btn) btn.addEventListener("click", exportSlices);

    // 预览切片信息
    var previewBtn = DP.$("slicePreview");
    if (previewBtn) {
      previewBtn.addEventListener("click", async function () {
        try {
          var doc = await DP.SDK.documents.active();
          if (!doc) { DP.setFoot("没有打开的文档"); return; }
          var guides = await getGuides();
          var slices = splitByGuides(guides, doc.height);
          if (!slices.length) { DP.setFoot("未找到水平参考线"); return; }
          var info = slices.map(function (s) {
            return "切片" + s.index + ": " + s.top + " ~ " + s.bottom + " (" + s.height + "px)";
          }).join("\n");
          DP.$("sliceInfo").textContent = info;
          DP.setFoot("共 " + slices.length + " 个切片，最高 " +
            Math.max.apply(null, slices.map(function (s) { return s.height; })) + "px");
        } catch (e) {
          DP.setFoot("预览失败：" + (e && e.message || String(e)));
        }
      });
    }
  }

  DP.registerInit(init);
})();
