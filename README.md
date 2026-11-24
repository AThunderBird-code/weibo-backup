# 微博备份（Weibo Backup）

一个运行在浏览器里的微博备份用户脚本。支持备份自己或任意公开账号的微博、收藏、图片原图与视频，并导出 JSON / Markdown / TXT / PDF。

当前版本：**v0.3.3**

## 功能

- 备份任意公开账号的全部可见微博
- 备份自己的微博，可选择「仅原创」
- 备份收藏
- 图片直接保存为本地原图，不使用远程链接
- 视频：mp4 直接下载，m3u8 保留链接
- 导出 JSON / Markdown / TXT
- 浏览器打印为 PDF，图片从本地文件夹嵌入
- 增量备份、断点续传、失败重试、随时停止
- 数据只保存在本机，不上传任何服务器

## 安装

### 1. 安装用户脚本管理器

| 浏览器 | 安装地址 |
| --- | --- |
| Edge | [Violentmonkey - Edge Addons](https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao) |
| Chrome | [Violentmonkey - Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) |
| Firefox | [Violentmonkey - Firefox Add-ons](https://addons.mozilla.org/firefox/addon/violentmonkey/) |

### 2. 安装脚本

方式一（推荐）：打开下面的地址，Violentmonkey 会弹出安装页：

```text
https://github.com/AThunderBird-code/weibo-backup/releases/latest/download/weibo-backup.user.js
```

方式二（镜像）：GitHub 访问不稳定时使用 jsDelivr：

```text
https://cdn.jsdelivr.net/gh/AThunderBird-code/weibo-backup@main/weibo-backup.user.js
```

方式三：打开 [`weibo-backup.user.js`](./weibo-backup.user.js) 后点「Raw」，或新建脚本粘贴内容。

安装后打开并登录 `https://weibo.com`。

## 使用

### 备份自己的微博

1. 打开自己的主页，例如 `https://weibo.com/u/1234567890`
2. 右上角面板会自动填入 uid，点「解析」
3. 选择「全部微博」或「仅原创」
4. 勾选需要的内容：图片原图、头像、JSON、Markdown、TXT
5. 点「开始备份」，选择一个本地文件夹并授权
6. 等待完成

### 备份其他人的公开微博

把对方主页链接、uid 或昵称填入输入框，点「解析」，其余步骤同上。

### 备份收藏

登录后把模式切到「收藏」，点「开始备份」。

### 导出 PDF

备份完成后（不要刷新页面），点「打印 PDF」，在打印窗口选择「另存为 PDF」。

> PDF 会优先从本次选择的本地文件夹读取原图；超过 150 MB 的部分会改用远程图片链接。

## 输出目录

```text
<你选择的文件夹>/
└── 昵称_uid/
    ├── images/          微博图片原图
    ├── videos/          mp4 视频
    ├── avatar.jpg       头像
    ├── 昵称_uid.json    完整数据
    ├── 昵称_uid.md      Markdown
    └── 昵称_uid.txt     TXT
```

## 权限与隐私

脚本只匹配 `https://weibo.com/*`，通过 `GM_xmlhttpRequest` 访问：

- `weibo.com`：微博网页接口
- `m.weibo.cn`：手机接口兜底
- `sinaimg.cn` / `weibocdn.com`：图片与视频 CDN

脚本不会上传 Cookie、微博内容或备份文件；所有数据写入你选择的本地文件夹。

## 已知限制

- 微博网页端/手机端只开放部分历史内容，通常上限约 2 万条；更早的内容需要在客户端内查看。
- 部分账号的微博被设置为「仅手机客户端可见」，脚本会尝试手机接口，但仍可能缺失少量内容。
- m3u8 流媒体在浏览器内无法合并，脚本会保留下载链接。
- PDF 内嵌图片上限 150 MB，超出部分使用远程链接。
- 微博接口有频率限制，抓取大量内容时请耐心等待，不要频繁重启。

## 常见问题

**只抓到很少几条？**

脚本会自动在网页接口和手机接口之间切换；如果仍很少，通常是账号内容受限或接口风控，稍后再试。

**图片 403？**

脚本已使用页面原生请求并直接使用接口返回的原图地址；如果仍失败，请确认已登录微博并刷新页面。

**PDF 很慢？**

图片较多时需要把原图转成本地数据，耐心等待；也可以按年份分批备份后分别打印。

## 参考与致谢

本项目的接口路径、分页方式和交互思路参考了以下开源项目，代码为独立实现：

- [Weibo Archiver](https://github.com/Chilfish/Weibo-archiver)（Apache-2.0）：微博接口与分页思路
- [Speechless](https://github.com/meterscao/Speechless)（MIT）：备份与 PDF 交互思路

## 许可证

[MIT](./LICENSE)

## 版本

v0.3.3
