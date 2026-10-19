豆包 AI 创作 · Photon 原生插件（v1.0.0）
==================================================

一、这是什么
  一个 Photon Studio 原生插件（photon.plugin.json 格式），安装后直接在
  Photon 的「插件」菜单出现「豆包 AI 创作」面板，无需 MCP、无需外部客户端。
  功能：文案生成 / 提示词优化 / 图片分析 / 文生图 / 图生图 / 多图融合 / 翻译。

二、安装方法（两种，任选其一）
  方式 A（推荐）：一键安装脚本
    1. 完全退出 Photon Studio（包括右下角托盘图标）
    2. 双击项目目录中的「一键安装豆包插件.bat」
    3. 脚本自动把插件复制到 Photon 插件目录并注册，完成后启动 Photon 即可

  方式 B：Photon 内导入
    1. 打开 Photon Studio
    2. 菜单：插件 → 管理插件 → Import folder…
    3. 选择本文件夹（doubao-photon-panel）
    4. 导入后自动加载，菜单「插件」里出现「豆包 AI 创作」

  （说明：Photon 只识别插件注册表 registry.json 中登记的插件，
   直接往 C:\Users\Admin\AppData\Roaming\Photon Studio\plugins\
   里丢文件夹不会被扫描到，请使用上面两种方式之一。）

三、首次使用
    1. 打开面板：插件 → 豆包 AI 创作
    2. 点右上角「配置 Key」，在 Photon 弹出的安全输入框中粘贴你的方舟
       API Key（形如 ark-xxxxxxxx），确认后系统加密保存
    3. 切换到需要的功能页（文案 / 提示词 / 图片分析 / 文生图 / 图生图 /
       多图融合 / 翻译），输入内容点执行即可
    4. 生成的图片：点「置入画布」直接放到当前文档；或「保存到本地」

四、注意事项
    - 首次打开面板时，Photon 可能弹出「Allow this plugin to send images and
      requests to https://ark.cn-beijing.volces.com?」窗口，请点「Allow endpoint」
      （仅首次，之后不再弹出）
    - 生图/编辑/融合使用 Seedream 模型，需方舟控制台已开通对应模型服务
      （文生图：doubao-seedream-5-0-pro-260628；编辑/融合：doubao-seedream-4-5-251128）
    - 文本/翻译/图片分析使用 doubao-seed-2-1-pro-260628
    - 参考图单张 Base64 上限约 10MB，超大图请先压缩
    - 网络请求全部经 Photon 代理，凭据加密存储，不会明文保存

五、目录结构
    photon.plugin.json  插件清单（面板/命令/权限声明）
    index.html          面板界面
    panel.js            面板逻辑（SDK 调用）

六、故障排查
    - 菜单里找不到：确认插件已 Import/复制到插件目录，并重启 Photon
    - 生成报错 401：Key 未配置或无效，重新点「配置 Key」
    - 报模型/接口错误：方舟控制台确认已开通对应模型，账户余额充足
    - 图片分析失败：图片过大或格式不支持，压缩后再试
