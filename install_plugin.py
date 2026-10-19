# -*- coding: utf-8 -*-
"""豆包 AI 创作 - Photon 原生插件一键安装脚本
精确复刻 Photon 的 packages.install() 流程：
  key        = sha256("photon:<id>")[:32]
  sha256     = 对插件目录全部文件按(relative+\0+content+\0)顺序哈希
  directory  = packages/{key}/{sha256}
  并写入 plugins/registry.json（version:1）
要求：安装前关闭 Photon Studio。
"""
import hashlib, json, os, shutil, subprocess, sys

PLUGIN_SRC = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "doubao-photon-panel")
PHOTON_ROOT = os.path.join(os.environ["APPDATA"], "Photon Studio", "plugins")
MANIFEST = "photon.plugin.json"


def photon_running():
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Photon Studio.exe"],
                             capture_output=True, text=True, timeout=20).stdout
        return "Photon Studio.exe" in out
    except Exception:
        return False


def files_in(root):
    """收集目录下所有文件（相对路径，posix 风格），与 filesIn 语义一致"""
    result = []
    for dirpath, dirnames, filenames in os.walk(root):
        # 跳过临时/隐藏目录
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "__pycache__"]
        for fn in filenames:
            if fn.startswith("."):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace("\\", "/")
            result.append(rel)
    result.sort()
    return result


def manifest_metadata(source):
    """按 parsePhotonManifest 规则解析，返回 registry 用的 metadata"""
    m = json.loads(source)
    if m.get("manifestVersion") != 1 or m.get("sdkVersion") != 1:
        raise SystemExit("不支持的 manifest 版本")
    return {
        "id": m["id"],
        "name": m["name"],
        "version": m["version"],
        "family": "photon",
        "permissions": m.get("permissions", {}),
        "photon": {"sdkVersion": 1, "commands": m.get("commands", [])},
        "entrypoints": [
            {
                "id": p["id"],
                "label": p["label"],
                "type": "panel",
                "main": m["main"],
                "ui": p.get("ui", "native"),
                "minimumSize": p.get("minimumSize"),
            }
            for p in m["panels"]
        ],
    }


def compute_sha256(root):
    h = hashlib.sha256()
    for rel in files_in(root):
        h.update(rel.encode("utf-8") + b"\0")
        with open(os.path.join(root, rel.replace("/", os.sep)), "rb") as f:
            h.update(f.read())
        h.update(b"\0")
    return h.hexdigest()


def wait_key():
    try:
        if sys.stdin and sys.stdin.isatty():
            input("按回车键关闭窗口…")
    except Exception:
        pass


def main():
    check_only = "--check" in sys.argv
    print("=" * 56)
    print("豆包 AI 创作 · Photon 插件一键安装" + ("（预检模式）" if check_only else ""))
    print("=" * 56)

    if not os.path.isdir(PLUGIN_DIR):
        raise SystemExit(f"未找到插件目录：{PLUGIN_DIR}")
    manifest_path = os.path.join(PLUGIN_DIR, MANIFEST)
    if not os.path.isfile(manifest_path):
        raise SystemExit(f"未找到 {MANIFEST}")

    if not check_only and photon_running():
        print("[!] 检测到 Photon Studio 正在运行。")
        print("    请先完全退出 Photon Studio（包括托盘图标），再重新运行本脚本。")
        wait_key()
        return 2

    print("[1/4] 解析插件清单…")
    with open(manifest_path, "r", encoding="utf-8") as f:
        metadata = manifest_metadata(f.read())
    print("      插件名 :", metadata["name"], "v" + metadata["version"])
    print("      插件 ID :", metadata["id"])

    print("[2/4] 计算指纹…")
    sha256 = compute_sha256(PLUGIN_DIR)
    key = hashlib.sha256(("photon:" + metadata["id"]).encode("utf-8")).hexdigest()[:32]
    directory = f"packages/{key}/{sha256}"
    print("      key    :", key)
    print("      sha256 :", sha256[:16] + "…")

    if check_only:
        print("=" * 56)
        print("预检通过：清单有效、指纹算法正常、文件数 =", len(files_in(PLUGIN_DIR)))
        print("正式安装前请退出 Photon Studio，再运行（不带 --check）本脚本或双击 .bat。")
        return 0

    print("[3/4] 复制到插件目录…")
    os.makedirs(os.environ["APPDATA"], exist_ok=True)
    os.makedirs(PHOTON_ROOT, exist_ok=True)
    dest = os.path.join(PHOTON_ROOT, directory.replace("/", os.sep))
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copytree(PLUGIN_DIR, dest)
    for rel in files_in(dest):
        print("      已复制:", rel)

    print("[4/4] 写入插件注册表…")
    registry_path = os.path.join(PHOTON_ROOT, "registry.json")
    records = []
    if os.path.isfile(registry_path):
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("version") == 1 and isinstance(data.get("plugins"), list):
                records = data["plugins"]
        except Exception:
            # 注册表损坏时备份，不覆盖
            shutil.copy2(registry_path, registry_path + ".bak")
            records = []
    previous = next((p for p in records if p.get("key") == key), None)
    plugin = dict(metadata)
    plugin.update({
        "key": key,
        "directory": directory,
        "sha256": sha256,
        "installedAt": __import__("datetime").datetime.now().isoformat(),
        "enabled": True,
        "compatibility": "unverified",
        "issues": [],
        "diagnostics": [],
        "developmentSource": os.path.normpath(PLUGIN_DIR),
    })
    records = [p for p in records if p.get("key") != key]
    records.append(plugin)
    tmp = registry_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"version": 1, "plugins": records}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, registry_path)

    print("=" * 56)
    print("安装完成！")
    print("插件目录 :", os.path.normpath(dest))
    print("注册表   :", registry_path)
    print()
    print("下一步：启动 Photon Studio → 菜单「插件」→「豆包 AI 创作」")
    print("首次使用请先在面板右上角「配置 Key」输入你的方舟 API Key。")
    wait_key()
    return 0


if __name__ == "__main__":
    sys.exit(main())
