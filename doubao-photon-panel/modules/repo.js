"use strict";

/* ========= 模块：repo —— 仓库（本地文件夹仓库 + 云端 WebDAV 云盘仓库） =========
   - 本地仓库：连接一个本地文件夹，新生成图片自动归档写入（SDK.files.pick/write）
   - 云端仓库：WebDAV 协议（坚果云/群晖/Nextcloud 等任意兼容云盘），图库条目手动上传
   平台边界：面板 fetch 已被宿主桥接（无 CORS 限制）；网络请求经 SDK 白名单放行 */

(function () {
  var DP = window.DP;
  if (!DP) throw new Error("core 未加载");

  var LS_LOCAL = "doubao.repoLocalPath";
  var LS_CLOUD = "doubao.repoCloud";

  var local = { path: localStorage.getItem(LS_LOCAL) || "" };
  var cloud = null;
  try { cloud = JSON.parse(localStorage.getItem(LS_CLOUD) || "null"); } catch (e) { cloud = null; }

  /* ---------- 工具：时间戳文件名 ---------- */
  function tsName() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return "DB_" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + "_" +
      Math.floor(Math.random() * 900 + 100);
  }

  /* ---------- 本地仓库 UI ---------- */
  function refreshLocalUI() {
    var st = DP.$("repoLocalStatus"), btn = DP.$("repoLocalBtn");
    if (!st || !btn) return;
    if (local.path) {
      st.textContent = "已连接：" + local.path + "（新图自动归档到此文件夹）";
      st.className = "repo-status ok";
      btn.textContent = "断开";
    } else {
      st.textContent = "未连接 —— 连接后，新生成的图片自动归档到选定文件夹";
      st.className = "repo-status";
      btn.textContent = "连接本地文件夹";
    }
  }

  /* 写一个文件到本地仓库（path 为完整文件路径） */
  function writeLocalFile(fullPath, bytes) {
    if (!DP.SDK || !DP.SDK.files || !DP.SDK.files.write) {
      return Promise.reject(new Error("SDK.files.write 不可用"));
    }
    return DP.SDK.files.write(fullPath, bytes);
  }

  /* 归档一张图到本地仓库根目录（文件名带时间戳，不建子目录——mkdir 面未确认，避免误报错） */
  function archiveLocal(bytes) {
    var name = tsName() + ".png";
    return writeLocalFile(local.path + "/" + name, bytes).then(function () {
      console.log("[repo] local archived:", name);
      return name;
    }).catch(function (e) {
      onLocalWriteFail(e);
      throw e;
    });
  }

  /* 连接本地文件夹：SDK.files.pick({folder:true}) 弹系统"选择文件夹"对话框（宿主已确认参数） */
  function connectLocal() {
    if (!DP.SDK || !DP.SDK.files || !DP.SDK.files.pick) {
      DP.setFoot("SDK 文件能力不可用，请重启 Photon");
      return;
    }
    var btn = DP.$("repoLocalBtn");
    btn.disabled = true;
    DP.setFoot("请在系统对话框中选择一个文件夹作为本地仓库…");
    DP.SDK.files.pick({ folder: true }).then(function (p) {
      if (!p) { DP.setFoot("已取消选择文件夹"); return; }
      local.path = p;
      localStorage.setItem(LS_LOCAL, p);
      refreshLocalUI();
      DP.setFoot("本地仓库已连接：" + p);
    }).catch(function (e) {
      DP.setFoot("本地仓库连接失败：" + (e.message || e));
    }).finally(function () { btn.disabled = false; });
  }

  /* 授权失效（重启 Photon 后内存授权丢失）时自动断开，避免静默失败 */
  function onLocalWriteFail(e) {
    console.log("[repo] local write failed, disconnecting:", e && e.message);
    local.path = "";
    localStorage.removeItem(LS_LOCAL);
    refreshLocalUI();
    DP.setFoot("本地仓库授权已失效，请重新连接文件夹");
  }

  function disconnectLocal() {
    local.path = "";
    localStorage.removeItem(LS_LOCAL);
    refreshLocalUI();
    DP.setFoot("已断开本地仓库（自动归档关闭）");
  }

  /* ---------- 云端仓库（WebDAV） ---------- */
  // 由配置对象组装：{url, dir} → {base, dir, origin}
  function composeCloud(cfg) {
    var base = String(cfg.url || "").replace(/\/+$/, "");
    var dir = String(cfg.dir || "/");
    if (dir.charAt(0) !== "/") dir = "/" + dir;
    if (dir.charAt(dir.length - 1) !== "/") dir += "/";
    var origin = base.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
    return { base: base, dir: dir, origin: origin };
  }
  // Basic 认证头：密码以 base64 存本机（桌面单机插件，仅本机可读）
  function authFromCfg(cfg) {
    var pass = "";
    try { pass = decodeURIComponent(escape(atob(cfg.passB64 || ""))); } catch (e) { pass = ""; }
    return "Basic " + btoa(String(cfg.user || "") + ":" + pass);
  }
  function authHeader() { return authFromCfg(cloud); }

  function refreshCloudUI() {
    var st = DP.$("repoCloudStatus"), tgl = DP.$("repoCloudToggle");
    if (!st || !tgl) return;
    if (cloud && cloud.url) {
      var host = String(cloud.url).replace(/^https?:\/\//, "").split("/")[0];
      st.textContent = "已连接：" + host + "（" + (cloud.user || "") + "），图库条目点「云」上传";
      st.className = "repo-status ok";
      tgl.textContent = "断开";
      DP.$("repoCloudForm").classList.add("hidden");
    } else {
      st.textContent = "未连接 —— 在图库条目上点「云」上传单张图片";
      st.className = "repo-status";
      tgl.textContent = "连接云盘";
    }
  }

  // 测试连接：PROPFIND 远程目录；404 时 MKCOL 建目录再试一次
  function testCloud(cfg) {
    var c = composeCloud(cfg);
    if (!/^https?:\/\//.test(c.base)) return Promise.reject(new Error("服务器地址需以 http:// 或 https:// 开头"));
    if (!cfg.user || !cfg.passB64) return Promise.reject(new Error("请填写用户名和密码"));
    function probe(method) {
      return fetch(c.base + c.dir, {
        method: method,
        headers: method === "PROPFIND"
          ? { "Authorization": authFromCfg(cfg), "Depth": "0" }
          : { "Authorization": authFromCfg(cfg) }
      });
    }
    return probe("PROPFIND").then(function (r) {
      if (r.status === 207 || r.status === 200) return c;
      if (r.status === 401 || r.status === 403) throw new Error("认证失败：用户名或密码错误（注意坚果云需用「应用密码」）");
      if (r.status === 404) {
        return probe("MKCOL").then(function (r2) {
          if (r2.status < 300 || r2.status === 405) return c;
          throw new Error("远程目录不存在且创建失败（HTTP " + r2.status + "）");
        });
      }
      throw new Error("连接失败（HTTP " + r.status + "）");
    });
  }

  // 上传单张图到云端仓库，返回远端文件名
  DP.cloudUpload = function (bytes, name) {
    if (!cloud) return Promise.reject(new Error("未连接云端仓库，请先在「仓库」页配置 WebDAV"));
    var c = composeCloud(cloud);
    return fetch(c.base + c.dir + name, {
      method: "PUT",
      headers: { "Authorization": authHeader(), "Content-Type": "image/png" },
      body: bytes
    }).then(function (r) {
      if (r.status >= 200 && r.status < 300) return name;
      throw new Error("上传失败（HTTP " + r.status + "）");
    });
  };

  /* ---------- 自动归档钩子：包装 pushHistory（history.js 先于本模块加载） ---------- */
  function hookAutoArchive() {
    var orig = DP.pushHistory;
    if (typeof orig !== "function" || orig.__repoHooked) return;
    var wrapped = function (label, bytes, url, prompt) {
      orig(label, bytes, url, prompt);
      if (local.path && bytes) {
        archiveLocal(bytes).then(function (name) {
          DP.setFoot("已自动归档到本地仓库：" + name);
        }).catch(function (e) {
          console.log("[repo] auto-archive failed:", e && e.message);
        });
      }
    };
    wrapped.__repoHooked = true;
    DP.pushHistory = wrapped;
  }

  /* ---------- 图库条目动作：上传云端 ---------- */
  DP.registerAction("histCloud", function (btn) {
    var it = DP.histById(btn.dataset.id);
    if (!it) return;
    btn.disabled = true; btn.textContent = "…";
    var name = tsName() + ".png";
    DP.cloudUpload(it.bytes, name).then(function () {
      DP.setFoot("已上传到云端仓库：" + name);
    }).catch(function (e) {
      DP.setFoot("云端上传失败：" + (e.message || e));
    }).finally(function () {
      btn.disabled = false; btn.textContent = "云";
    });
  });

  /* ---------- 初始化绑定 ---------- */
  DP.registerInit(function () {
    refreshLocalUI();
    refreshCloudUI();
    hookAutoArchive();

    DP.$("repoLocalBtn").addEventListener("click", function () {
      if (local.path) disconnectLocal(); else connectLocal();
    });

    DP.$("repoCloudToggle").addEventListener("click", function () {
      if (cloud && cloud.url) {
        cloud = null;
        localStorage.removeItem(LS_CLOUD);
        refreshCloudUI();
        DP.setFoot("已断开云端仓库");
      } else {
        DP.$("repoCloudForm").classList.toggle("hidden");
      }
    });

    DP.$("repoCloudTest").addEventListener("click", function () {
      var cfg = {
        url: DP.$("repoCloudUrl").value.trim(),
        user: DP.$("repoCloudUser").value.trim(),
        dir: DP.$("repoCloudDir").value.trim() || "/",
        passB64: btoa(unescape(encodeURIComponent(DP.$("repoCloudPass").value)))
      };
      var btn = DP.$("repoCloudTest");
      btn.disabled = true; btn.textContent = "测试中…";
      // 放行 WebDAV 域名（自定义端点，运行时注册）
      var origin = composeCloud(cfg).origin;
      if (DP.SDK && DP.SDK.network && DP.SDK.network.allowEndpoint) {
        DP.SDK.network.allowEndpoint(origin).catch(function () {});
      }
      testCloud(cfg).then(function () {
        cloud = { url: cfg.url, user: cfg.user, dir: cfg.dir, passB64: cfg.passB64 };
        localStorage.setItem(LS_CLOUD, JSON.stringify(cloud));
        refreshCloudUI();
        DP.setFoot("云端仓库连接成功并已保存");
      }).catch(function (e) {
        DP.setFoot("云端连接失败：" + (e.message || e));
      }).finally(function () {
        btn.disabled = false; btn.textContent = "测试连接并保存";
      });
    });
  });
})();
