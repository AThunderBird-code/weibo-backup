# Weibo Backup

A browser userscript for backing up Weibo posts, favorites, original images, and videos. Export everything to JSON / Markdown / TXT / PDF.

Current version: **v0.3.3**

## Features

- Back up all visible posts of any public account
- Back up your own posts, with an option to keep originals only
- Back up your favorites
- Save original images locally instead of remote links
- Videos: download mp4 directly; keep m3u8 links
- Export JSON / Markdown / TXT
- Print to PDF in the browser, embedding images from the local folder
- Incremental backup, resume, retry, and stop at any time
- All data stays on your machine; nothing is uploaded

## Installation

### 1. Install a userscript manager

| Browser | Link |
| --- | --- |
| Edge | [Violentmonkey - Edge Addons](https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao) |
| Chrome | [Violentmonkey - Chrome Web Store](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) |
| Firefox | [Violentmonkey - Firefox Add-ons](https://addons.mozilla.org/firefox/addon/violentmonkey/) |

### 2. Install the script

Option A (recommended): install from Greasy Fork, which also delivers updates automatically:

```text
https://greasyfork.org/zh-CN/scripts/606987
```

Option B: ScriptCat (faster access from mainland China, also delivers updates):

```text
https://scriptcat.org/zh-CN/script-show-page/9226
```

Option C: direct link to the GitHub release; Violentmonkey shows the install prompt:

```text
https://github.com/AThunderBird-code/weibo-backup/releases/latest/download/weibo-backup.user.js
```

Option D (mirror): if GitHub is slow or blocked, use jsDelivr:

```text
https://cdn.jsdelivr.net/gh/AThunderBird-code/weibo-backup@main/weibo-backup.user.js
```

Option E: open [`weibo-backup.user.js`](./weibo-backup.user.js) and click "Raw", or create a new script and paste the contents.

Then open and sign in to `https://weibo.com`.

## Usage

### Back up your own posts

1. Open your profile, e.g. `https://weibo.com/u/1234567890`
2. The panel fills in your uid automatically; click "Parse"
3. Choose "All posts" or "Originals only"
4. Select what to save: original images, avatar, JSON, Markdown, TXT
5. Click "Start backup", choose a local folder, and grant access
6. Wait for completion

### Back up another public account

Paste the profile URL, uid, or nickname into the input, click "Parse", and follow the same steps.

### Back up favorites

After signing in, switch the mode to "Favorites" and click "Start backup".

### Export PDF

After the backup finishes (do not refresh the page), click "Print PDF" and choose "Save as PDF" in the print dialog.

> The PDF prefers images from the local folder selected in this session. Images beyond the 150 MB embedding limit fall back to remote URLs.

## Output layout

```text
<selected folder>/
└── nickname_uid/
    ├── images/          original images
    ├── videos/          mp4 videos
    ├── avatar.jpg       avatar
    ├── nickname_uid.json    full data
    ├── nickname_uid.md      Markdown
    └── nickname_uid.txt     TXT
```

## Permissions and privacy

The script matches only `https://weibo.com/*` and uses `GM_xmlhttpRequest` for:

- `weibo.com`: web API
- `m.weibo.cn`: mobile API fallback
- `sinaimg.cn` / `weibocdn.com`: image and video CDNs

It never uploads cookies, post content, or backup files. Everything is written to the local folder you choose.

## Known limitations

- Weibo exposes only part of its history on the web and mobile web, typically up to about 20,000 posts. Older content may only be available in the mobile app.
- Some accounts mark posts as "mobile app only". The script tries the mobile API, but a small number of posts may still be missing.
- m3u8 streams cannot be merged in the browser; the script keeps the download links.
- PDF image embedding is capped at 150 MB; the rest falls back to remote URLs.
- The API is rate-limited. For large accounts, be patient and avoid restarting frequently.

## FAQ

**Only a few posts were fetched?**

The script switches between the web and mobile APIs automatically. If the count is still low, the account is likely restricted or rate-limited; try again later.

**Images return 403?**

The script uses page-native requests and the original image URLs returned by the API. If failures persist, make sure you are signed in to Weibo and refresh the page.

**PDF is slow?**

Large image sets take time to embed as local data. You can also back up and print one year at a time.

## Credits

The API paths, pagination approach, and interaction ideas were informed by these open-source projects. This project is an independent implementation:

- [Weibo Archiver](https://github.com/Chilfish/Weibo-archiver) (Apache-2.0): Weibo API and pagination ideas
- [Speechless](https://github.com/meterscao/Speechless) (MIT): backup and PDF interaction ideas

## License

[MIT](./LICENSE)

## Version

v0.3.3
