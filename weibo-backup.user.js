// ==UserScript==
// @name         微博备份
// @namespace    https://github.com/AThunderBird-code/weibo-backup
// @version      0.3.3
// @description  备份微博、收藏、图片原图到本地，导出 JSON / Markdown / TXT / PDF | Back up Weibo posts, favorites, and original images locally
// @author       Weibo Backup contributors
// @license      MIT
// @homepageURL  https://github.com/AThunderBird-code/weibo-backup
// @supportURL   https://github.com/AThunderBird-code/weibo-backup/issues
// @downloadURL  https://github.com/AThunderBird-code/weibo-backup/releases/latest/download/weibo-backup.user.js
// @updateURL    https://github.com/AThunderBird-code/weibo-backup/releases/latest/download/weibo-backup.user.js
// @match        https://weibo.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      weibo.com
// @connect      m.weibo.cn
// @connect      sinaimg.cn
// @connect      *.sinaimg.cn
// @connect      weibocdn.com
// @connect      *.weibocdn.com
// @connect      video.weibo.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  if (window.__wbBackupLoaded) return
  window.__wbBackupLoaded = true
  document.documentElement.dataset.wbBackup = '1'

  const S = {
    uid: '',
    user: null,
    posts: [],
    favorites: [],
    total: 0,
    cursor: { sinceId: '', page: 1 },
    running: false,
    paused: false,
    abort: false,
    dirHandle: null,
    rootHandle: null,
    media: { images: 0, videos: 0, failed: 0 },
    logs: [],
    resume: true,
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const rand = (min, max) => min + Math.random() * (max - min)

  function log(msg, level) {
    const line = '[' + new Date().toLocaleTimeString() + '] ' + msg
    S.logs.push(line)
    if (S.logs.length > 300) S.logs.shift()
    if (ui && ui.logEl) {
      ui.logEl.textContent = S.logs.join('\n')
      ui.logEl.scrollTop = ui.logEl.scrollHeight
    }
    if (level === 'error') console.error('[微博备份]', msg)
    else console.log('[微博备份]', msg)
  }

  function setStats(text) {
    if (ui && ui.statsEl) ui.statsEl.textContent = text
  }

  function setBar(cur, total) {
    if (!ui || !ui.barEl) return
    const pct = total > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0
    ui.barEl.style.width = pct + '%'
  }

  async function waitIfPaused() {
    while (S.paused && !S.abort) await sleep(400)
    if (S.abort) throw new Error('已停止')
  }

  function stripHtml(html) {
    if (!html) return ''
    const div = document.createElement('div')
    div.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  }

  function safeName(str) {
    return String(str || '')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || 'weibo'
  }

  function parseTime(str) {
    if (!str) return 0
    let t = Date.parse(str)
    if (!Number.isNaN(t)) return t
    const m = String(str).match(/([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})/)
    if (m) {
      t = Date.parse(m[1] + ' ' + m[2] + ', ' + m[7] + ' ' + m[3] + ':' + m[4] + ':' + m[5] + ' ' + m[6])
      if (!Number.isNaN(t)) return t
    }
    return 0
  }

  function dateKey(ts) {
    const d = ts ? new Date(ts) : new Date()
    const p = n => String(n).padStart(2, '0')
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes())
  }

  function parseMobileTime(str) {
    if (!str) return 0
    const t = Date.parse(str)
    if (!Number.isNaN(t)) return t
    const now = new Date()
    let m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime()
    m = String(str).match(/^(\d{2})-(\d{2})$/)
    if (m) {
      let d = new Date(now.getFullYear(), +m[1] - 1, +m[2])
      if (d.getTime() > now.getTime()) d = new Date(now.getFullYear() - 1, +m[1] - 1, +m[2])
      return d.getTime()
    }
    m = String(str).match(/^今天\s*(\d{1,2}):(\d{2})/)
    if (m) {
      const d = new Date(now)
      d.setHours(+m[1], +m[2], 0, 0)
      return d.getTime()
    }
    m = String(str).match(/^昨天\s*(\d{1,2}):(\d{2})/)
    if (m) {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      d.setHours(+m[1], +m[2], 0, 0)
      return d.getTime()
    }
    m = String(str).match(/^(\d+)\s*分钟前/)
    if (m) return Date.now() - (+m[1]) * 60000
    m = String(str).match(/^(\d+)\s*小时前/)
    if (m) return Date.now() - (+m[1]) * 3600000
    return 0
  }

  function todayStr() {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  }

  function dateText(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const p = n => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }

  function extOf(url) {
    const m = String(url || '').split('?')[0].match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)
    return m ? m[1].toLowerCase() : 'jpg'
  }

  function pickText(raw) {
    if (!raw) return ''
    if (raw.text_raw) return String(raw.text_raw).trim()
    return stripHtml(raw.text || '')
  }

  function extractPics(raw) {
    if (!raw) return []
    const list = []
    const add = u => {
      if (typeof u === 'string' && u && !list.includes(u)) list.push(u)
    }
    const pick = item => item && (
      (item.original && item.original.url) ||
      (item.woriginal && item.woriginal.url) ||
      (item.largest && item.largest.url) ||
      (item.large && item.large.url) ||
      (item.bmiddle && item.bmiddle.url) ||
      (item.thumbnail && item.thumbnail.url)
    )
    const infos = raw.pic_infos || {}
    Object.keys(infos).forEach(k => add(pick(infos[k] || {})))
    const mix = (raw.mix_media_info && raw.mix_media_info.items) || []
    mix.forEach(it => {
      if (it && it.type === 'pic') add(pick(it.data || {}))
    })
    return list.filter(u => !/\.(m3u8|mp4)(\?|$)/i.test(u))
  }

  function extractVideo(raw) {
    if (!raw) return null
    const info = raw.page_info && raw.page_info.media_info
    if (!info) return null
    const url = info.mp4_720p_mp4 || info.mp4_hd_url || info.stream_url_hd || info.stream_url || ''
    const hls = info.hls_url || info.stream_url_hls || ''
    if (!url && !hls) return null
    return {
      url: String(url || ''),
      hls: String(hls || ''),
      title: (raw.page_info && raw.page_info.page_title) || '',
      cover: (info.big_pic_info && info.big_pic_info.pic_big && info.big_pic_info.pic_big.url) || '',
    }
  }

  function parsePost(raw) {
    const user = raw.user || {}
    const rtRaw = raw.retweeted_status || null
    let retweet = null
    if (rtRaw) {
      const rtUser = rtRaw.user || {}
      retweet = {
        id: String(rtRaw.id || ''),
        mblogid: rtRaw.mblogid || '',
        createdAt: rtRaw.created_at || '',
        timestamp: parseTime(rtRaw.created_at),
        isLongText: !!(rtRaw.isLongText || rtRaw.is_long_text),
        text: pickText(rtRaw),
        pics: extractPics(rtRaw),
        video: extractVideo(rtRaw),
        localPics: {},
        user: {
          uid: String(rtUser.idstr || rtUser.id || ''),
          name: rtUser.screen_name || '',
          avatar: rtUser.profile_image_url || '',
        },
      }
    }
    return {
      id: String(raw.id || raw.mid || ''),
      mid: String(raw.mid || ''),
      mblogid: raw.mblogid || '',
      createdAt: raw.created_at || '',
      timestamp: parseTime(raw.created_at),
      text: pickText(raw),
      textHtml: raw.text || '',
      source: stripHtml(raw.source || ''),
      region: raw.region_name || '',
      isLongText: !!(raw.isLongText || raw.is_long_text),
      pics: extractPics(raw),
      video: extractVideo(raw),
      stats: {
        reposts: raw.reposts_count || 0,
        comments: raw.comments_count || 0,
        likes: raw.attitudes_count || 0,
      },
      user: {
        uid: String(user.idstr || user.id || ''),
        name: user.screen_name || '',
        avatar: user.profile_image_url || '',
      },
      retweet: retweet,
      localPics: {},
    }
  }

  // ---------- IndexedDB 断点 ----------
  let _db = null
  function dbOpen() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db)
      const req = indexedDB.open('wb-backup-local', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('jobs', { keyPath: 'uid' })
      req.onsuccess = () => { _db = req.result; resolve(_db) }
      req.onerror = () => reject(req.error)
    })
  }

  async function dbSave() {
    if (!S.uid) return
    const db = await dbOpen()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', 'readwrite')
      tx.objectStore('jobs').put({
        uid: S.uid,
        user: S.user,
        posts: S.posts,
        favorites: S.favorites,
        total: S.total,
        cursor: S.cursor,
        updatedAt: Date.now(),
      })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  }

  async function dbGet(uid) {
    const db = await dbOpen()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('jobs', 'readonly')
      const req = tx.objectStore('jobs').get(uid)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  }

  // ---------- 接口 ----------
  async function api(path, params) {
    const url = new URL(location.origin + path)
    Object.keys(params || {}).forEach(k => {
      const v = params[k]
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    })
    let lastErr = null
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (S.abort) throw new Error('已停止')
      await waitIfPaused()
      let res
      try {
        res = await fetch(url.toString(), {
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        })
      } catch (e) {
        lastErr = e
        await sleep(1500 * (attempt + 1))
        continue
      }
      if (res.status === 403 || res.status === 418 || res.status === 429) {
        lastErr = new Error('微博限流 HTTP ' + res.status)
        log('被微博限流（' + res.status + '），30 秒后重试', 'warn')
        await sleep(30000)
        continue
      }
      if (res.status >= 500) {
        lastErr = new Error('微博服务异常 HTTP ' + res.status)
        await sleep(5000 * (attempt + 1))
        continue
      }
      const text = await res.text()
      let json
      try {
        json = JSON.parse(text)
      } catch (e) {
        const ct = res.headers.get('content-type') || ''
        const head = text.replace(/\s+/g, ' ').slice(0, 160)
        throw new Error('接口返回非 JSON（HTTP ' + res.status + '，' + ct + '，' + url.pathname + url.search + '）：' + head)
      }
      if (json.ok !== 1) throw new Error(json.message || ('接口返回 ok=' + json.ok))
      return json
    }
    throw lastErr || new Error('请求失败')
  }

  function extractUid(text) {
    const s = String(text || '').trim()
    let m = s.match(/\/u\/(\d{5,})/)
    if (m) return m[1]
    m = s.match(/[?&]uid=(\d{5,})/)
    if (m) return m[1]
    m = s.match(/(\d{5,})/)
    if (m) return m[1]
    return ''
  }

  function findUidDeep(obj) {
    const stack = [obj]
    while (stack.length) {
      const cur = stack.pop()
      if (!cur || typeof cur !== 'object') continue
      if (cur.screen_name && (cur.id || cur.uid)) return String(cur.id || cur.uid)
      Object.keys(cur).forEach(k => {
        if (cur[k] && typeof cur[k] === 'object') stack.push(cur[k])
      })
    }
    return ''
  }

  async function resolveTarget(input, silent) {
    const text = String(input || '').trim()
    if (!text) throw new Error('请输入 uid、主页链接或昵称')
    let uid = extractUid(text)
    if (!uid) {
      if (!silent) log('按昵称搜索：' + text)
      const r = await api('/ajax/side/search', { q: text })
      uid = findUidDeep(r)
      if (!uid) throw new Error('没有搜到该用户，请直接填写数字 uid')
    }
    let info = null
    try {
      info = await api('/ajax/profile/info', { uid: uid })
    } catch (e) {
      log('读取用户信息失败，先按 uid 继续：' + e.message, 'warn')
    }
    if (!info) {
      S.uid = String(uid)
      S.user = { uid: S.uid, name: S.uid, avatar: '', followers: 0, followings: 0 }
      if (!silent) {
        ui.userEl.textContent = '@' + S.uid
        log('已使用 uid ' + S.uid + '，昵称稍后从微博正文补全')
      }
      return S.user
    }
    const u = info.data && info.data.user
    if (!u) throw new Error('用户不存在或不可见')
    const newUid = String(u.id || uid)
    if (S.uid && S.uid !== newUid) {
      S.dirHandle = null
      S.posts = []
      S.favorites = []
      S.total = 0
      S.cursor = { sinceId: '', page: 1 }
    }
    S.uid = newUid
    S.user = {
      uid: S.uid,
      name: u.screen_name || '',
      avatar: u.avatar_large || u.profile_image_url || '',
      followers: u.followers_count || 0,
      followings: u.friends_count || 0,
    }
    if (!silent) {
      ui.userEl.textContent = '@' + S.user.name + '（uid ' + S.uid + '）'
      log('已解析：@' + S.user.name)
    }
    return S.user
  }

  async function fillLongText(posts) {
    for (const p of posts) {
      if (S.abort) return
      const targets = []
      if (p.isLongText) targets.push(p)
      if (p.retweet && p.retweet.isLongText) targets.push(p.retweet)
      for (const t of targets) {
        await waitIfPaused()
        try {
          const r = await api('/ajax/statuses/longtext', { id: t.mblogid })
          const data = r.data || {}
          if (data.longTextContent) {
            t.text = stripHtml(data.longTextContent) || String(data.longTextContent)
          }
        } catch (e) {
          log('长文补全失败 ' + t.mblogid + '：' + e.message, 'warn')
        }
        await sleep(rand(250, 450))
      }
    }
  }

  async function fetchPosts(feature, onPage) {
    if (!S.resume) {
      S.posts = []
      S.cursor = { sinceId: '', page: 1 }
    } else {
      const saved = await dbGet(S.uid)
      if (saved && saved.posts && saved.posts.length) {
        S.posts = saved.posts
        S.favorites = saved.favorites || []
        S.total = Number(saved.total) || 0
        S.cursor = saved.cursor || S.cursor
        log('载入上次缓存 ' + S.posts.length + ' 条')
      }
    }
    if (!S.resume) S.total = 0
    const seen = new Set(S.posts.map(p => p.id))
    let sinceId = ''
    let page = 1
    // 上次没抓完就接着断点抓；已抓完则从头扫一遍，补新微博
    if (S.resume && S.total && S.posts.length < S.total) {
      sinceId = S.cursor.sinceId || ''
      page = S.cursor.page || 1
    }
    let total = S.total || 0
    let stuck = 0

    for (let guard = 0; guard < 3000; guard++) {
      if (S.abort) throw new Error('已停止')
      await waitIfPaused()
      const params = {
        uid: S.uid,
        page: page,
        feature: feature,
        hasmuisc: 1,
        haspic: 1,
        hastext: 1,
        hasvideo: 1,
        hasori: 1,
        hasret: 1,
      }
      if (sinceId) params.since_id = sinceId
      if (guard === 0) log('请求参数：page=' + page + '，since_id=' + (sinceId || '空'))
      const r = await api('/ajax/statuses/mymblog', params)
      const data = r.data || {}
      const list = data.list || []
      if (!list.length) break
      const apiTotal = Number(data.total)
      if (!Number.isNaN(apiTotal) && apiTotal > total) {
        total = apiTotal
        S.total = apiTotal
      }
      if (guard === 0) log('接口首页：list=' + list.length + '，total=' + (data.total === undefined ? '无' : data.total))

      const fresh = []
      for (const raw of list) {
        const p = parsePost(raw)
        if (!p.id || seen.has(p.id)) continue
        seen.add(p.id)
        fresh.push(p)
      }
      if (!fresh.length) {
        if (sinceId) {
          // 极少数情况下 since_id 不生效，退回页码翻页
          sinceId = ''
          page += 1
          S.cursor = { sinceId: '', page: page }
          await sleep(rand(1100, 1700))
          continue
        }
        stuck++
        if (stuck >= 2) break
      } else {
        stuck = 0
      }
      S.posts = S.posts.concat(fresh)
      S.cursor = { sinceId: sinceId, page: page }
      if (fresh.length) {
        await fillLongText(fresh)
        if (onPage) await onPage(fresh)
      }
      const nextSince = data.since_id ? String(data.since_id) : ''
      if (nextSince && nextSince !== sinceId) {
        sinceId = nextSince
        page = 1
      } else {
        page += 1
      }
      S.cursor = { sinceId: sinceId, page: page }
      setStats('已抓取 ' + S.posts.length + (total ? ' / ' + total : '') + ' 条，图片 ' + S.media.images + ' 张')
      setBar(S.posts.length, total)
      if (S.posts.length % 100 < fresh.length) await dbSave()
      if (total && S.posts.length >= total) break
      await sleep(rand(1100, 1700))
    }
    await dbSave()
    log('微博抓取结束，共 ' + S.posts.length + ' 条')
    const needFallback = (S.total > 0 && S.posts.length < S.total * 0.5) || (S.total <= 0 && S.posts.length < 20)
    if (needFallback) {
      log('网页接口只返回 ' + S.posts.length + ' 条（total=' + (S.total > 0 ? S.total : '未知') + '），改用手机接口继续')
      try {
        await fetchMobilePosts(feature, onPage)
      } catch (e) {
        log('手机接口失败：' + e.message + '，改用补充接口', 'warn')
        await fetchPostsBySearch(feature, onPage)
      }
    }
  }

  function gmJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest 不可用'))
        return
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: 30000,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'MWeibo-Pwa': '1',
          Referer: 'https://m.weibo.cn/',
        },
        onload: r => {
          if (r.status < 200 || r.status >= 300) {
            reject(new Error('HTTP ' + r.status))
            return
          }
          try {
            resolve(JSON.parse(r.responseText || r.response || '{}'))
          } catch (e) {
            reject(new Error('手机接口返回非 JSON'))
          }
        },
        onerror: () => reject(new Error('手机接口网络错误')),
        ontimeout: () => reject(new Error('手机接口超时')),
      })
    })
  }

  function parseMobilePost(mb) {
    const user = mb.user || {}
    const pics = []
    const add = u => {
      if (typeof u === 'string' && u && !pics.includes(u)) pics.push(u)
    }
    ;(mb.pics || []).forEach(p => {
      add((p.large && p.large.url) || (p.bmiddle && p.bmiddle.url) || p.url)
    })
    const info = mb.page_info && mb.page_info.media_info
    const video = info ? {
      url: String(info.mp4_720p_mp4 || info.stream_url_hd || info.stream_url || ''),
      hls: String(info.hls_url || info.stream_url_hls || ''),
      title: (mb.page_info && mb.page_info.page_title) || '',
      cover: (info.big_pic_info && info.big_pic_info.pic_big && info.big_pic_info.pic_big.url) || '',
    } : null
    const post = {
      id: String(mb.id || ''),
      mid: String(mb.mid || mb.id || ''),
      mblogid: mb.bid || '',
      createdAt: mb.created_at || '',
      timestamp: parseMobileTime(mb.created_at),
      text: stripHtml(mb.text || ''),
      textHtml: mb.text || '',
      source: stripHtml(mb.source || ''),
      region: mb.region_name || '',
      isLongText: !!mb.isLongText,
      pics: pics,
      video: video,
      stats: {
        reposts: mb.reposts_count || 0,
        comments: mb.comments_count || 0,
        likes: mb.attitudes_count || 0,
      },
      user: {
        uid: String(user.id || ''),
        name: user.screen_name || '',
        avatar: user.profile_image_url || '',
      },
      retweet: null,
      localPics: {},
    }
    if (mb.retweeted_status) {
      post.retweet = parseMobilePost(mb.retweeted_status)
      post.retweet.localPics = {}
    }
    return post
  }

  async function fillMobileLongText(posts) {
    for (const p of posts) {
      if (S.abort) return
      const targets = []
      if (p.isLongText) targets.push(p)
      if (p.retweet && p.retweet.isLongText) targets.push(p.retweet)
      for (const t of targets) {
        try {
          const j = await gmJson('https://m.weibo.cn/statuses/extend?id=' + encodeURIComponent(t.id))
          if (j.ok === 1 && j.data && j.data.longTextContent) {
            t.text = stripHtml(j.data.longTextContent) || String(j.data.longTextContent)
          }
        } catch (e) {
          log('手机长文补全失败 ' + t.id + '：' + e.message, 'warn')
        }
        await sleep(rand(250, 450))
      }
    }
  }

  async function fetchMobilePosts(feature, onPage) {
    const seen = new Set(S.posts.map(p => p.id))
    let since = ''
    let stuck = 0
    for (let guard = 0; guard < 1000; guard++) {
      if (S.abort) throw new Error('已停止')
      await waitIfPaused()
      const params = {
        type: 'uid',
        value: S.uid,
        containerid: '107603' + S.uid,
      }
      if (since) params.since_id = since
      const url = 'https://m.weibo.cn/api/container/getIndex?' + new URLSearchParams(params).toString()
      let j = null
      let lastErr = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          j = await gmJson(url)
          break
        } catch (e) {
          lastErr = e
          log('手机接口失败，10 秒后重试：' + e.message, 'warn')
          await sleep(10000)
        }
      }
      if (!j) throw lastErr || new Error('手机接口请求失败')
      if (j.ok !== 1) throw new Error('手机接口返回 ok=' + j.ok)
      const data = j.data || {}
      if (data.cardlistInfo) {
        const mobileTotal = Number(data.cardlistInfo.total)
        if (!Number.isNaN(mobileTotal) && mobileTotal > S.total) S.total = mobileTotal
      }
      const cards = data.cards || []
      const mblogs = []
      cards.forEach(c => {
        if (c.mblog) mblogs.push(c.mblog)
        ;(c.card_group || []).forEach(g => {
          if (g.mblog) mblogs.push(g.mblog)
        })
      })
      if (!mblogs.length) break
      const fresh = []
      for (const mb of mblogs) {
        const p = parseMobilePost(mb)
        if (!p.id || seen.has(p.id)) continue
        if (feature === 1 && p.retweet) continue
        seen.add(p.id)
        fresh.push(p)
      }
      if (!fresh.length) {
        stuck++
        if (stuck >= 2) break
      } else {
        stuck = 0
      }
      S.posts = S.posts.concat(fresh)
      if (fresh.length) {
        await fillMobileLongText(fresh)
        if (onPage) await onPage(fresh)
      }
      setStats('手机接口抓取 ' + S.posts.length + ' 条')
      setBar(S.posts.length, S.total)
      if (S.posts.length % 100 < fresh.length) await dbSave()
      const next = data.cardlistInfo && data.cardlistInfo.since_id
      if (!next || String(next) === String(since)) break
      since = String(next)
      await sleep(rand(1400, 2200))
    }
    await dbSave()
    log('手机接口结束，共 ' + S.posts.length + ' 条')
  }

  async function fetchPostsBySearch(feature, onPage) {
    const seen = new Set(S.posts.map(p => p.id))
    let stuck = 0
    for (let page = 1; page <= 60; page++) {
      if (S.abort) throw new Error('已停止')
      await waitIfPaused()
      const r = await api('/ajax/statuses/searchProfile', {
        uid: S.uid,
        page: page,
        feature: feature,
        starttime: '2010-01-01',
        endtime: todayStr(),
      })
      const data = r.data || {}
      const list = data.list || []
      if (!list.length) break
      const searchTotal = Number(data.total)
      if (!Number.isNaN(searchTotal) && searchTotal > S.total) S.total = searchTotal
      const fresh = []
      for (const raw of list) {
        const p = parsePost(raw)
        if (!p.id || seen.has(p.id)) continue
        seen.add(p.id)
        fresh.push(p)
      }
      if (!fresh.length) {
        stuck++
        if (stuck >= 2) break
      } else {
        stuck = 0
      }
      S.posts = S.posts.concat(fresh)
      if (fresh.length) {
        await fillLongText(fresh)
        if (onPage) await onPage(fresh)
      }
      setStats('补充抓取 ' + S.posts.length + ' 条')
      setBar(S.posts.length, S.total)
      if (S.posts.length % 100 < fresh.length) await dbSave()
      await sleep(rand(1100, 1700))
    }
    await dbSave()
    log('补充接口结束，共 ' + S.posts.length + ' 条')
  }

  async function fetchFavorites(onPage) {
    if (!S.resume) S.favorites = []
    else {
      const saved = await dbGet(S.uid)
      if (saved && saved.favorites && saved.favorites.length) S.favorites = saved.favorites
    }
    const seen = new Set(S.favorites.map(p => p.id))
    for (let page = 1; page <= 500; page++) {
      if (S.abort) throw new Error('已停止')
      await waitIfPaused()
      const r = await api('/ajax/favorites/all_fav', { page: page, with_total: true })
      const list = Array.isArray(r.data) ? r.data : ((r.data && r.data.data) || [])
      if (!list.length) break
      const fresh = []
      for (const raw of list) {
        const p = parsePost(raw)
        if (!p.id || seen.has(p.id)) continue
        seen.add(p.id)
        fresh.push(p)
      }
      S.favorites = S.favorites.concat(fresh)
      if (fresh.length) {
        await fillLongText(fresh)
        if (onPage) await onPage(fresh)
      }
      setStats('已抓收藏 ' + S.favorites.length + ' 条')
      if (page % 10 === 0) await dbSave()
      await sleep(rand(900, 1400))
    }
    await dbSave()
    log('收藏抓取结束，共 ' + S.favorites.length + ' 条')
  }

  // ---------- 媒体 ----------
  async function fetchBlob(url) {
    try {
      const res = await fetch(url, { credentials: 'omit' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.blob()
    } catch (firstErr) {
      if (typeof GM_xmlhttpRequest !== 'function') throw firstErr
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          responseType: 'blob',
          timeout: 90000,
          headers: { Referer: 'https://weibo.com/' },
          onload: r => {
            if (r.status >= 200 && r.status < 300 && r.response) resolve(r.response)
            else reject(new Error('HTTP ' + r.status))
          },
          onerror: () => reject(firstErr),
          ontimeout: () => reject(new Error('下载超时')),
        })
      })
    }
  }

  function folderName() {
    return safeName((S.user && S.user.name) || 'weibo') + '_' + S.uid
  }

  async function pickRoot() {
    if (S.rootHandle) {
      try {
        const st = await S.rootHandle.queryPermission({ mode: 'readwrite' })
        if (st === 'granted') return S.rootHandle
        const rq = await S.rootHandle.requestPermission({ mode: 'readwrite' })
        if (rq === 'granted') return S.rootHandle
      } catch (e) { /* 重新选择 */ }
    }
    if (typeof window.showDirectoryPicker !== 'function') return null
    S.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    return S.rootHandle
  }

  async function ensureDir(root) {
    if (!root) return null
    if (S.dirHandle) return S.dirHandle
    S.dirHandle = await root.getDirectoryHandle(folderName(), { create: true })
    return S.dirHandle
  }

  async function writeTo(dir, parts, blob) {
    let d = dir
    for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create: true })
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true })
    const w = await fh.createWritable()
    await w.write(blob)
    await w.close()
  }

  async function downloadPics(posts, dir) {
    const items = []
    posts.forEach(p => {
      p.localPics = p.localPics || {}
      if (p.retweet) p.retweet.localPics = p.retweet.localPics || {}
      ;(p.pics || []).forEach((u, idx) => items.push({ owner: p, url: u, idx: idx }))
      if (p.retweet) (p.retweet.pics || []).forEach((u, idx) => items.push({ owner: p.retweet, url: u, idx: idx }))
    })
    if (!items.length) return
    let done = 0
    for (let i = 0; i < items.length; i++) {
      if (S.abort) throw new Error('已停止')
      await waitIfPaused()
      const it = items[i]
      const name = dateKey(it.owner.timestamp) + '_' + safeName(it.owner.mblogid || it.owner.id) + '_' + (it.idx + 1) + '.' + extOf(it.url)
      try {
        if (dir) {
          const blob = await fetchBlob(it.url)
          await writeTo(dir, ['images', name], blob)
          it.owner.localPics[it.url] = 'images/' + name
        } else if (typeof GM_download === 'function') {
          GM_download({ url: it.url, name: 'WeiboBackup/' + folderName() + '/images/' + name, saveAs: false })
          it.owner.localPics[it.url] = 'images/' + name
        }
        S.media.images++
      } catch (e) {
        S.media.failed++
        log('图片失败 ' + name + '：' + e.message + '｜' + it.url, 'warn')
      }
      done++
      if (done % 10 === 0) {
        setStats('图片 ' + done + ' / ' + items.length + '，失败 ' + S.media.failed)
        await sleep(200)
      }
    }
    log('图片处理完成：成功 ' + S.media.images + '，失败 ' + S.media.failed)
  }

  async function downloadVideos(posts, dir) {
    const items = []
    posts.forEach(p => {
      if (p.video && (p.video.url || p.video.hls)) items.push({ post: p, video: p.video })
      if (p.retweet && p.retweet.video && (p.retweet.video.url || p.retweet.video.hls)) {
        items.push({ post: p.retweet, video: p.retweet.video })
      }
    })
    for (const it of items) {
      const v = it.video
      if (!v.url) {
        log('视频仅提供 m3u8，已记录链接：' + (v.hls || ''), 'warn')
        continue
      }
      const name = dateKey(it.post.timestamp) + '_' + safeName(it.post.mblogid || it.post.id) + '.mp4'
      if (dir) {
        try {
          const blob = await fetchBlob(v.url)
          await writeTo(dir, ['videos', name], blob)
          S.media.videos++
        } catch (e) {
          S.media.failed++
          log('视频失败 ' + name + '：' + e.message, 'warn')
        }
      } else if (typeof GM_download === 'function') {
        GM_download({ url: v.url, name: 'WeiboBackup/' + folderName() + '/videos/' + name, saveAs: false })
        S.media.videos++
      }
      await sleep(300)
    }
  }

  async function saveAvatar(dir) {
    if (!S.user || !S.user.avatar) return
    try {
      const blob = await fetchBlob(S.user.avatar)
      if (dir) await writeTo(dir, ['avatar.jpg'], blob)
      else if (typeof GM_download === 'function') {
        GM_download({ url: S.user.avatar, name: 'WeiboBackup/' + folderName() + '/avatar.jpg', saveAs: false })
      }
    } catch (e) {
      log('头像下载失败：' + e.message, 'warn')
    }
  }

  // ---------- 导出 ----------
  async function saveTextFile(dir, name, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' })
    if (dir) {
      await writeTo(dir, [name], blob)
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 2000)
    }
  }

  function allPosts() {
    return S.posts.concat(S.favorites)
  }

  function buildJSON() {
    return JSON.stringify({
      uid: S.uid,
      user: S.user,
      exportedAt: new Date().toISOString(),
      counts: { posts: S.posts.length, favorites: S.favorites.length },
      posts: S.posts,
      favorites: S.favorites,
    }, null, 2)
  }

  function imageMarkdown(p) {
    const lines = []
    ;(p.pics || []).forEach((url, i) => {
      const local = (p.localPics && p.localPics[url]) || url
      lines.push('![' + (p.mblogid || p.id) + '-' + (i + 1) + '](' + local + ')')
    })
    return lines.join('\n')
  }

  function postMarkdown(p, index) {
    const out = []
    out.push('## ' + (dateText(p.timestamp) || p.createdAt) + '  #' + (index + 1))
    out.push('')
    out.push(p.text || '')
    out.push('')
    const imgs = imageMarkdown(p)
    if (imgs) { out.push(imgs); out.push('') }
    if (p.retweet) {
      out.push('> 转发 @' + (p.retweet.user.name || '') + '：')
      String(p.retweet.text || '').split('\n').forEach(line => out.push('> ' + line))
      const rtImgs = imageMarkdown(p.retweet)
      if (rtImgs) {
        out.push('>')
        rtImgs.split('\n').forEach(line => out.push('> ' + line))
      }
      out.push('')
    }
    out.push('- 转发 ' + p.stats.reposts + ' · 评论 ' + p.stats.comments + ' · 赞 ' + p.stats.likes)
    if (p.video && p.video.url) out.push('- 视频：' + p.video.url)
    out.push('')
    out.push('---')
    out.push('')
    return out.join('\n')
  }

  function buildMarkdown() {
    const out = []
    out.push('# ' + ((S.user && S.user.name) || '微博') + ' 的微博备份')
    out.push('')
    out.push('- UID：' + S.uid)
    out.push('- 导出时间：' + new Date().toLocaleString())
    out.push('- 微博：' + S.posts.length + ' 条')
    out.push('- 收藏：' + S.favorites.length + ' 条')
    out.push('')
    if (S.posts.length) {
      out.push('# 微博')
      out.push('')
      S.posts.forEach((p, i) => out.push(postMarkdown(p, i)))
    }
    if (S.favorites.length) {
      out.push('# 收藏')
      out.push('')
      S.favorites.forEach((p, i) => out.push(postMarkdown(p, i)))
    }
    return out.join('\n')
  }

  function buildText() {
    const out = []
    out.push(((S.user && S.user.name) || '微博') + ' 的微博备份')
    out.push('UID：' + S.uid)
    out.push('导出时间：' + new Date().toLocaleString())
    out.push('微博：' + S.posts.length + ' 条；收藏：' + S.favorites.length + ' 条')
    out.push('='.repeat(50))
    const dump = (p, i) => {
      out.push('')
      out.push('[' + (i + 1) + '] ' + (dateText(p.timestamp) || p.createdAt))
      out.push(p.text || '')
      ;(p.pics || []).forEach((url, idx) => {
        out.push('图片' + (idx + 1) + '：' + ((p.localPics && p.localPics[url]) || url))
      })
      if (p.retweet) {
        out.push('转发 @' + (p.retweet.user.name || '') + '：')
        out.push(p.retweet.text || '')
      }
      out.push('转发 ' + p.stats.reposts + ' · 评论 ' + p.stats.comments + ' · 赞 ' + p.stats.likes)
      out.push('-'.repeat(50))
    }
    S.posts.forEach(dump)
    if (S.favorites.length) {
      out.push('')
      out.push('【收藏】')
      out.push('='.repeat(50))
      S.favorites.forEach(dump)
    }
    return out.join('\n')
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  async function readLocalFile(dir, rel) {
    const parts = String(rel).split('/')
    let d = dir
    for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i])
    const fh = await d.getFileHandle(parts[parts.length - 1])
    return await fh.getFile()
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error || new Error('读取失败'))
      reader.readAsDataURL(blob)
    })
  }

  async function embedLocalImages(dir) {
    const map = new Map()
    const limit = 150 * 1024 * 1024
    let bytes = 0
    let count = 0
    let skipped = 0
    const owners = []
    allPosts().forEach(p => {
      owners.push(p)
      if (p.retweet) owners.push(p.retweet)
    })
    for (const p of owners) {
      for (const url of (p.pics || [])) {
        if (map.has(url)) continue
        const rel = p.localPics && p.localPics[url]
        if (!rel) continue
        if (bytes >= limit) { skipped++; continue }
        try {
          const file = await readLocalFile(dir, rel)
          bytes += file.size
          map.set(url, await blobToDataURL(file))
          count++
        } catch (e) { /* 单张失败时保留远程地址 */ }
      }
    }
    if (count) log('PDF 已嵌入 ' + count + ' 张本地图片（约 ' + Math.round(bytes / 1048576) + ' MB）')
    if (skipped) log('图片总量过大，' + skipped + ' 张在 PDF 中改用远程链接', 'warn')
    return map
  }

  function buildPrintHtml(imgMap) {
    const posts = allPosts()
    const srcOf = url => (imgMap && imgMap.get(url)) || url
    const body = posts.map((p, i) => {
      const imgs = (p.pics || []).map((url, idx) =>
        '<figure><img src="' + escapeHtml(srcOf(url)) + '" alt="' + i + '-' + idx + '"></figure>'
      ).join('')
      const rt = p.retweet
        ? '<div class="rt"><b>@' + escapeHtml(p.retweet.user.name) + '：</b>' + escapeHtml(p.retweet.text).replace(/\n/g, '<br>') +
          (p.retweet.pics || []).map(u => '<figure><img src="' + escapeHtml(srcOf(u)) + '"></figure>').join('') + '</div>'
        : ''
      return '<article class="post">' +
        '<div class="meta">' + escapeHtml(dateText(p.timestamp) || p.createdAt) + ' · 转发 ' + p.stats.reposts + ' · 评论 ' + p.stats.comments + ' · 赞 ' + p.stats.likes + '</div>' +
        '<div class="text">' + escapeHtml(p.text).replace(/\n/g, '<br>') + '</div>' +
        rt +
        (imgs ? '<div class="imgs">' + imgs + '</div>' : '') +
        '</article>'
    }).join('')
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>' + escapeHtml((S.user && S.user.name) || '微博') + ' 微博备份</title>' +
      '<style>' +
      'body{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#111;margin:24px;line-height:1.7}' +
      '.cover{text-align:center;padding:60px 0;border-bottom:2px solid #eee;margin-bottom:24px}' +
      '.cover h1{margin:0 0 8px;font-size:26px}.cover p{color:#666;margin:4px 0}' +
      '.post{page-break-inside:avoid;border-bottom:1px solid #eee;padding:14px 0}' +
      '.meta{color:#888;font-size:12px;margin-bottom:6px}' +
      '.text{white-space:normal}.rt{background:#f5f5f5;border-left:3px solid #ccc;padding:8px 10px;margin:8px 0;color:#444}' +
      '.imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.imgs figure{margin:0;max-width:46%}' +
      '.imgs img{max-width:100%;max-height:420px;border-radius:4px}' +
      '.toolbar{position:fixed;right:16px;top:16px;z-index:9}' +
      '.toolbar button{padding:8px 14px;border:0;border-radius:6px;background:#e6162d;color:#fff;cursor:pointer}' +
      '@media print{.toolbar{display:none}body{margin:0}.imgs img{max-height:360px}}' +
      '</style></head><body>' +
      '<div class="toolbar"><button id="wb-print-btn" onclick="window.print()">打印 / 另存为 PDF</button></div>' +
      '<div class="cover"><h1>' + escapeHtml((S.user && S.user.name) || '') + ' 的微博备份</h1>' +
      '<p>UID：' + escapeHtml(S.uid) + '</p><p>微博 ' + S.posts.length + ' 条 · 收藏 ' + S.favorites.length + ' 条</p>' +
      '<p>导出时间：' + escapeHtml(new Date().toLocaleString()) + '</p></div>' +
      body +
      '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print()}catch(e){}},1200)})<\/script>' +
      '</body></html>'
  }

  async function exportPDF() {
    const w = window.open('about:blank', '_blank')
    if (!w) {
      log('打印窗口被拦截，请允许本站弹出窗口后重试', 'error')
      return
    }
    try { w.document.title = '正在准备 PDF...' } catch (e) { /* 忽略 */ }
    let imgMap = null
    if (S.dirHandle) {
      try {
        imgMap = await embedLocalImages(S.dirHandle)
      } catch (e) {
        log('读取本地图片失败，PDF 将使用远程图片：' + e.message, 'warn')
      }
    }
    const html = buildPrintHtml(imgMap)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    try {
      w.location.href = url
    } catch (e) {
      w.document.open()
      w.document.write(html)
      w.document.close()
    }
    setTimeout(() => URL.revokeObjectURL(url), 300000)
    log('已打开打印窗口，目标打印机选择「另存为 PDF」')
  }

  async function doExport(dir) {
    const name = folderName()
    if (ui.jsonEl.checked) {
      await saveTextFile(dir, name + '.json', buildJSON(), 'application/json;charset=utf-8')
      log('已导出 JSON')
    }
    if (ui.mdEl.checked) {
      await saveTextFile(dir, name + '.md', buildMarkdown(), 'text/markdown;charset=utf-8')
      log('已导出 Markdown')
    }
    if (ui.txtEl.checked) {
      await saveTextFile(dir, name + '.txt', buildText(), 'text/plain;charset=utf-8')
      log('已导出 TXT')
    }
    if (ui.pdfEl.checked) await exportPDF()
  }

  // ---------- 主流程 ----------
  async function startBackup() {
    if (S.running) return
    S.running = true
    S.abort = false
    S.paused = false
    ui.startEl.disabled = true
    ui.pauseEl.disabled = false
    ui.pauseEl.textContent = '暂停'
    ui.stopEl.disabled = false
    S.resume = ui.resumeEl.checked
    S.media = { images: 0, videos: 0, failed: 0 }
    try {
      let root = null
      try {
        root = await pickRoot()
      } catch (e) {
        log('未选择保存文件夹，改为浏览器下载目录：' + e.message, 'warn')
      }
      const inputText = ui.targetEl.value.trim()
      if (!S.uid || (inputText && extractUid(inputText) !== S.uid && inputText !== (S.user && S.user.name))) {
        await resolveTarget(inputText)
      }
      let dir = null
      if (root) {
        try {
          dir = await ensureDir(root)
        } catch (e) {
          log('创建备份目录失败：' + e.message, 'warn')
        }
      }
      if (dir) log('保存目录：' + folderName())
      if (ui.avatarEl.checked) await saveAvatar(dir)

      const mode = currentMode()
      const onPage = async fresh => {
        if (ui.imagesEl.checked) await downloadPics(fresh, dir)
        if (ui.videoEl.checked) await downloadVideos(fresh, dir)
      }
      if (mode === 'favorites') await fetchFavorites(onPage)
      else await fetchPosts(mode === 'original' ? 1 : 0, onPage)

      await doExport(dir)
      log('全部完成')
    } catch (e) {
      log('任务结束：' + e.message, 'error')
    } finally {
      S.running = false
      ui.startEl.disabled = false
      ui.pauseEl.disabled = true
      ui.stopEl.disabled = true
      setStats('结束：微博 ' + S.posts.length + ' 条，收藏 ' + S.favorites.length + ' 条，图片 ' + S.media.images + ' 张')
    }
  }

  async function exportOnly() {
    try {
      let root = null
      try { root = await pickRoot() } catch (e) { log('未选择文件夹，使用浏览器下载目录', 'warn') }
      if (!S.uid) await resolveTarget(ui.targetEl.value)
      let dir = null
      if (root) {
        try { dir = await ensureDir(root) } catch (e) { log('创建备份目录失败：' + e.message, 'warn') }
      }
      await doExport(dir)
      log('导出完成')
    } catch (e) {
      log('导出失败：' + e.message, 'error')
    }
  }

  // ---------- 面板 ----------
  const host = document.createElement('div')
  host.id = 'wb-backup-host'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '.card{position:fixed;right:16px;top:72px;width:360px;z-index:2147483000;background:#fff;color:#222;border:1px solid #e5e5e5;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif;overflow:hidden}',
    '.head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#fafafa;border-bottom:1px solid #eee;font-weight:700}',
    '.head em{font-style:normal;font-weight:400;color:#999;font-size:11px;margin-left:6px}',
    '.head button{border:0;background:transparent;font-size:16px;cursor:pointer;color:#666}',
    '.body{padding:12px;max-height:70vh;overflow:auto}',
    '.row{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}',
    'input[type=text]{flex:1;min-width:0;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px}',
    'button{padding:5px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:12px}',
    'button:disabled{opacity:.5;cursor:not-allowed}',
    '.primary{background:#e6162d;border-color:#e6162d;color:#fff}',
    'label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}',
    '.user{padding:6px 8px;background:#f7f7f7;border-radius:6px;margin-bottom:8px;color:#333}',
    '.bar{height:6px;background:#eee;border-radius:3px;overflow:hidden;margin:6px 0}',
    '.bar i{display:block;height:100%;width:0;background:#e6162d;transition:width .2s}',
    '.stats{color:#666;font-size:12px;margin-bottom:6px}',
    '.log{height:110px;overflow:auto;background:#111;color:#9fe8a0;font:11px/1.5 Consolas,monospace;padding:8px;border-radius:6px;margin:0;white-space:pre-wrap}',
    '</style>',
    '<div class="card">',
    '  <div class="head"><span>微博备份 <em>v0.3.3</em></span><button id="wb-min" title="收起">—</button></div>',
    '  <div class="body">',
    '    <div class="row"><input id="wb-target" type="text" placeholder="uid / 主页链接 / 昵称"><button id="wb-resolve">解析</button></div>',
    '    <div class="user" id="wb-user">未选择用户</div>',
    '    <div class="row">',
    '      <label><input type="radio" name="wb-mode" value="all" checked> 全部微博</label>',
    '      <label><input type="radio" name="wb-mode" value="original"> 仅原创</label>',
    '      <label><input type="radio" name="wb-mode" value="favorites"> 收藏</label>',
    '    </div>',
    '    <div class="row">',
    '      <label><input type="checkbox" id="wb-images" checked> 图片原图</label>',
    '      <label><input type="checkbox" id="wb-avatar" checked> 头像</label>',
    '      <label><input type="checkbox" id="wb-video"> 视频</label>',
    '    </div>',
    '    <div class="row">',
    '      <label><input type="checkbox" id="wb-json" checked> JSON</label>',
    '      <label><input type="checkbox" id="wb-md" checked> MD</label>',
    '      <label><input type="checkbox" id="wb-txt" checked> TXT</label>',
    '      <label><input type="checkbox" id="wb-pdf"> PDF</label>',
    '      <label><input type="checkbox" id="wb-resume" checked> 继续上次</label>',
    '    </div>',
    '    <div class="row">',
    '      <button class="primary" id="wb-start">开始备份</button>',
    '      <button id="wb-pause" disabled>暂停</button>',
    '      <button id="wb-stop" disabled>停止</button>',
    '      <button id="wb-export">仅导出</button>',
    '      <button id="wb-pdf-btn">打印 PDF</button>',
    '    </div>',
    '    <div class="bar"><i id="wb-bar"></i></div>',
    '    <div class="stats" id="wb-stats">就绪</div>',
    '    <pre class="log" id="wb-log"></pre>',
    '  </div>',
    '</div>',
  ].join('')

  const ui = {
    card: shadow.querySelector('.card'),
    targetEl: shadow.querySelector('#wb-target'),
    userEl: shadow.querySelector('#wb-user'),
    imagesEl: shadow.querySelector('#wb-images'),
    avatarEl: shadow.querySelector('#wb-avatar'),
    videoEl: shadow.querySelector('#wb-video'),
    jsonEl: shadow.querySelector('#wb-json'),
    mdEl: shadow.querySelector('#wb-md'),
    txtEl: shadow.querySelector('#wb-txt'),
    pdfEl: shadow.querySelector('#wb-pdf'),
    resumeEl: shadow.querySelector('#wb-resume'),
    startEl: shadow.querySelector('#wb-start'),
    pauseEl: shadow.querySelector('#wb-pause'),
    stopEl: shadow.querySelector('#wb-stop'),
    exportEl: shadow.querySelector('#wb-export'),
    pdfBtn: shadow.querySelector('#wb-pdf-btn'),
    barEl: shadow.querySelector('#wb-bar'),
    statsEl: shadow.querySelector('#wb-stats'),
    logEl: shadow.querySelector('#wb-log'),
    minEl: shadow.querySelector('#wb-min'),
  }

  function currentMode() {
    const el = shadow.querySelector('input[name="wb-mode"]:checked')
    return el ? el.value : 'all'
  }

  ui.minEl.addEventListener('click', () => {
    const body = shadow.querySelector('.body')
    body.style.display = body.style.display === 'none' ? '' : 'none'
  })

  ui.startEl.addEventListener('click', () => startBackup())
  ui.exportEl.addEventListener('click', () => exportOnly())
  ui.pdfBtn.addEventListener('click', () => {
    exportPDF().catch(e => log('生成 PDF 失败：' + e.message, 'error'))
  })
  ui.stopEl.addEventListener('click', () => {
    S.abort = true
    S.paused = false
    ui.pauseEl.textContent = '暂停'
    log('正在停止，已抓到的数据会保留')
  })
  ui.pauseEl.addEventListener('click', () => {
    S.paused = !S.paused
    ui.pauseEl.textContent = S.paused ? '继续' : '暂停'
    log(S.paused ? '已暂停' : '继续运行')
  })
  shadow.querySelector('#wb-resolve').addEventListener('click', async () => {
    try {
      await resolveTarget(ui.targetEl.value)
    } catch (e) {
      log('解析失败：' + e.message, 'error')
    }
  })

  // 自动填充当前主页 uid
  const autoUid = extractUid(location.href)
  if (autoUid) ui.targetEl.value = autoUid

  log('脚本已加载 v0.3.3，输入 uid 或直接点「解析」')
  document.documentElement.dataset.wbReady = '1'
})()
