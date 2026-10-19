# -*- coding: utf-8 -*-
"""验证安装的插件能否通过 Photon 的启动加载校验（模拟主进程 refreshPluginMenus 逻辑）"""
import json, os, re

root = r"C:\Users\Admin\AppData\Roaming\Photon Studio\plugins"
ok = True

# 1) registry 校验（与 PluginPackages.records 一致）
with open(os.path.join(root, "registry.json"), "r", encoding="utf-8") as f:
    reg = json.load(f)
assert reg["version"] == 1 and isinstance(reg["plugins"], list)
for p in reg["plugins"]:
    assert re.fullmatch(r"[a-f0-9]{32}", p["key"]), "key 格式错误"
    assert p["directory"] == f"packages/{p['key']}/{p['sha256']}", "directory 不匹配"
    assert re.fullmatch(r"[a-f0-9]{64}", p["sha256"]), "sha256 格式错误"
    print(f"[registry] OK: {p['name']} v{p['version']} enabled={p['enabled']}")

# 2) 插件目录存在且 manifest/入口完整（与 install 校验一致）
for p in reg["plugins"]:
    dest = os.path.join(root, p["directory"].replace("/", os.sep))
    assert os.path.isdir(dest), f"目录缺失: {dest}"
    mf = os.path.join(dest, "photon.plugin.json")
    with open(mf, "r", encoding="utf-8") as f:
        m = json.load(f)
    assert m["manifestVersion"] == 1 and m["sdkVersion"] == 1
    assert re.fullmatch(r"\d+\.\d+\.\d+", m["version"])
    main = os.path.join(dest, m["main"])
    assert os.path.isfile(main), f"main 缺失: {main}"
    for ep in p["entrypoints"]:
        assert ep["type"] == "panel" and ep["main"] == m["main"]
    print(f"[manifest] OK: id={m['id']} main={m['main']} panels={len(m['panels'])} commands={len(m.get('commands', []))}")

print("\n验证通过：Photon 启动后会正确发现并加载该插件。")
