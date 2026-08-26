// ==UserScript==
// @name         Caveduck編輯器
// @namespace    https://caveduck.io/
// @version      1.0
// @description  可將 Google Sheet A/B 兩欄（TSV）貼上併匯入，也可將現有欄位內容匯出成可貼回試算表的格式。支援lorebook介面和小工具介面。
// @author       @lyre273
// @homepage     https://lyre-projects.pages.dev/
// @match        https://caveduck.io/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/oliviajwart-ship-it/caveduck-widget-import/main/dist/caveduck-widget-import.user.js
// @updateURL    https://raw.githubusercontent.com/oliviajwart-ship-it/caveduck-widget-import/main/dist/caveduck-widget-import.user.js
// @supportURL   https://github.com/oliviajwart-ship-it/caveduck-widget-import/issues
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'cd-sheet-panel';
  const BAR_ID = 'cd-tl-bar';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const C = {
    bg: '#f5f3ef', head: '#e9e5dd', line: '#d9d4ca', ink: '#3b3a37', ink2: '#877f74',
    field: '#ffffff', btn: '#e3dfd6', btnInk: '#4a4842',
    primary: '#5f7a6c', primaryOn: '#4e685b', danger: '#9a6357', dangerOn: '#875348',
    doneRed: '#a33b33', hlGreen: '#3f7a55',
  };
  const BTN = 'border:1px solid transparent;border-radius:7px;padding:8px 12px;cursor:pointer;font:600 13px/1 system-ui,sans-serif;';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FIELD = (h) => `width:100%;height:${h};box-sizing:border-box;background:${C.field};color:${C.ink};border:1px solid ${C.line};border-radius:8px;padding:8px 9px;resize:vertical;font:12.5px/1.55 ui-monospace,"Cascadia Mono",Menlo,monospace;white-space:pre;`;
  const LOGBOX = `display:none;margin-top:10px;max-height:120px;overflow:auto;background:${C.field};border:1px solid ${C.line};border-radius:8px;padding:8px 10px;font:12px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;color:${C.ink2};`;
  const SVG = (d, w) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON_ORB = SVG('<path d="M12 3v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>', 22);
  const ICON_FOLD = SVG('<path d="m6 9 6 6 6-6"/>', 16);
  const ICON_GRIP = SVG('<path d="M4 9h16"/><path d="M4 15h16"/>', 14);
  const ICON_INFO = SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16h.01"/>', 15);
  const infoBtn = (id) => `<button type="button" id="${id}" title="說明" style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;background:none;color:${C.ink2};cursor:pointer;">${ICON_INFO}</button>`;
  const helpBox = (rows) => `<div style="margin-bottom:10px;padding:9px 11px;background:${C.field};border:1px solid ${C.line};border-radius:8px;font-size:12px;line-height:1.7;color:${C.ink2};">`
    + rows.map(([k, v]) => `<div style="margin:2px 0;"><b style="color:${C.ink};">${k}</b>　${v}</div>`).join('') + '</div>';
  const detectMode = () => {
    const p = location.pathname;
    if (/\/(creator|player)-widgets\b/.test(p)) return 'widget';
    if (/\/lore-books\/edit\b/.test(p)) return 'lorebook';
    return null;
  };

  function inPanel(el) { return !!el.closest(`#${PANEL_ID}`); }
  function isVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function setReactValue(el, value) {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value == null ? '' : String(value)); else el.value = value == null ? '' : String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(ta); ta.focus(); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove(); return ok;
    }
  }
  function getConfirmButton() {
    const OK = ['確認', '확인', '確定', 'OK', '是的，我要刪除它。'];
    return [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).find((b) => OK.includes((b.innerText || '').trim())) || null;
  }
  function confirmBox({ title, body, warn }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);pointer-events:auto;font:13px/1.8 system-ui,-apple-system,"Segoe UI",sans-serif;';
      wrap.innerHTML = `
        <div style="width:min(430px,90vw);background:${C.bg};color:${C.ink};border:1px solid ${C.line};border-radius:12px;box-shadow:0 18px 46px rgba(0,0,0,.45);overflow:hidden;">
          <div style="padding:18px 20px 8px;text-align:center;font-size:15px;font-weight:700;color:${C.danger};">${esc(title)}</div>
          <div style="padding:0 20px;text-align:center;white-space:pre-wrap;">${esc(body)}</div>
          <div style="padding:18px 20px 0;text-align:center;font-weight:700;">${(warn || []).map((t) => esc(t)).join('<br>')}</div>
          <div style="display:flex;gap:8px;justify-content:center;padding:16px 20px 18px;">
            <button type="button" id="cd-cf-no" style="${BTN}min-width:88px;background:${C.btn};color:${C.btnInk};">取消</button>
            <button type="button" id="cd-cf-yes" style="${BTN}min-width:88px;background:${C.danger};color:#fff;">確定</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const finish = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('#cd-cf-no').onclick = () => finish(false);
      wrap.querySelector('#cd-cf-yes').onclick = () => finish(true);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) finish(false); });
    });
  }
  const LORE_WARN = ['Lorebook 自動儲存、無法復原', '確定要繼續嗎？'];

  function parseDSV(text, delim) {
    const rows = []; let row = []; let field = ''; let i = 0; let inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return rows;
  }
  function toTSVCell(s) { s = s == null ? '' : String(s); return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toTSV(rows) { return rows.map((r) => r.map(toTSVCell).join('\t')).join('\n'); }

  const isHtml = (raw) => /<[a-z!/][^>]*>/i.test(raw);
  function extractFromHtml(raw) {
    const re = /\{\{\s*([^}]+?)\s*\}\}/g; const seen = new Set(); const out = []; let m;
    while ((m = re.exec(raw))) {
      const name = m[1].trim(); if (!name) continue;
      const low = name.toLowerCase(); if (low === 'user' || low === 'char') continue;
      if (seen.has(name)) continue; seen.add(name); out.push({ a: name, b: '' });
    }
    return out;
  }
  function parseRows(raw, allowHtml) {
    raw = (raw || '').replace(/^﻿/, '');
    const trimmed = raw.trim();
    if (!trimmed) return { rows: [], mode: 'empty' };
    let rows, mode;
    if (/\t/.test(raw)) {
      const grid = parseDSV(raw, '\t');
      rows = grid.map((r) => ({ a: (r[0] || '').trim(), b: r[1] != null ? r[1] : '' })).filter((r) => r.a !== '' || (r.b || '').trim() !== '');
      mode = 'tsv';
    } else if (allowHtml && isHtml(trimmed)) {
      return { rows: extractFromHtml(trimmed), mode: 'html' };
    } else {
      rows = trimmed.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean).map((block) => {
        const lines = block.split(/\r?\n/); return { a: lines[0].trim(), b: lines.slice(1).join('\n').trim() };
      }).filter((r) => r.a);
      mode = 'blocks';
    }
    return { rows, mode };
  }

  const Widget = {
    trashButtons: () => [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).filter((b) => (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M3 6h18')),
    rowOf(btn) { let p = btn; for (let i = 0; i < 8 && p; i++) { p = p.parentElement; if (!p) break; if (p.querySelector('input') && p.querySelector('textarea')) return p; } return null; },
    rows() {
      const list = this.trashButtons().map((del) => { const row = this.rowOf(del); return row ? { input: row.querySelector('input'), textarea: row.querySelector('textarea'), del } : null; }).filter(Boolean);
      const seen = new Set(); return list.filter((r) => (seen.has(r.input) ? false : (seen.add(r.input), true)));
    },
    addButton: () => { const ADD = ['新增資訊', '添加信息', '정보 추가', 'Add Info', 'Add', '情報追加', '追加']; return [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).find((b) => ADD.includes((b.innerText || '').replace(/\s+/g, ' ').trim())); },
    async importOverwrite(rows, opts, log) {
      let cur = this.rows(); const addBtn = this.addButton(); let guard = 0;
      while (cur.length < rows.length) { if (!addBtn) { log('⚠ 找不到「新增資訊」按鈕'); break; } addBtn.click(); await sleep(220); cur = this.rows(); if (++guard > rows.length + 8) { log('⚠ 新增逾時'); break; } }
      let trim = 0;
      while (this.rows().length > rows.length) { const rs = this.rows(); const del = rs[rs.length - 1]?.del; if (!del) break; del.click(); let ok = null; for (let k = 0; k < 15 && !ok; k++) { await sleep(120); ok = getConfirmButton(); } if (ok) ok.click(); await sleep(350); if (++trim > rows.length + 60) break; }
      cur = this.rows();
      for (let i = 0; i < rows.length; i++) { if (!cur[i]) break; if (opts.a) setReactValue(cur[i].input, rows[i].a); if (opts.b) setReactValue(cur[i].textarea, rows[i].b); if (i % 6 === 0) await sleep(25); }
      log(`已覆蓋匯入 ${Math.min(rows.length, cur.length)} 列（${opts.a ? '含狀態值' : '略狀態值'}、${opts.b ? '含指令' : '略指令'}）`);
    },
    exportRows(opts) {
      return this.rows().map((r) => { const a = (r.input?.value || '').trim(); const b = r.textarea?.value || ''; if (opts.a && opts.b) return [a, b]; if (opts.a) return [a]; if (opts.b) return [b]; return null; }).filter(Boolean);
    },
  };

  const Lore = {
    MAX_KW: 50, MAX_CT: 400,
    keywordAreas: () => [...document.querySelectorAll('textarea')].filter((t) => !inPanel(t)).filter((t) => /關鍵字|키워드|keyword/i.test(t.placeholder || '')),
    contentAreas: () => [...document.querySelectorAll('textarea')].filter((t) => !inPanel(t)).filter((t) => /輸入內容|內容|내용|content/i.test(t.placeholder || '')),
    addButton: () => [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).find((b) => ['加入項目', '항목 추가', 'Add Item'].includes((b.innerText || '').replace(/\s+/g, ' ').trim())),
    pageButtons: () => [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).filter(isVisible).filter((b) => /^\d+$/.test((b.innerText || '').trim())),

    patched: false,
    patchFetch() {
      if (this.patched || typeof window.fetch !== 'function') return;
      const orig = window.fetch;
      window.fetch = function (input, init) {
        try {
          const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          const raw = typeof input === 'string' ? input : (input && input.url);
          if (method === 'GET' && raw && /\/api\/lore\/\d+/.test(raw)) {
            const u = new URL(raw, location.origin);
            if (u.searchParams.has('numPerPage')) {
              u.searchParams.set('page', '0');
              u.searchParams.set('numPerPage', '100');
              input = typeof input === 'string' ? u.toString() : new Request(u.toString(), input);
            }
          }
        } catch (e) {  }
        return orig.call(this, input, init);
      };
      this.patched = true;
    },
    loreId() { const m = location.pathname.match(/lore-books\/edit\/(\d+)/); return m ? m[1] : null; },
    async totalFromApi(tries) {
      const n = tries || 4;
      for (let i = 0; i < n; i++) {
        const id = this.loreId();
        if (id) {
          try {
            const r = await fetch(`/api/lore/${id}?page=0&numPerPage=100`, { credentials: 'include' });
            const j = await r.json();
            if (typeof j.totalItems === 'number') return j.totalItems;
          } catch (e) {  }
        }
        await sleep(400);
      }
      return null;
    },
    async status() {
      const total = await this.totalFromApi();
      const shown = this.keywordAreas().length;
      return { total, shown, full: total != null && shown >= total };
    },
    expandedFor: '',
    get expanded() { return this.expandedFor === location.pathname; },
    async waitFor(pred, ms) {
      for (let i = 0, n = Math.ceil(ms / 200); i < n; i++) { if (pred()) return true; await sleep(200); }
      return pred();
    },
    async expandAll(log) {
      this.patchFetch();
      const total = await this.totalFromApi();
      const shown = () => this.keywordAreas().length;
      if (total == null) { log && log('⚠ 讀不到總筆數，無法確認是否完整展開'); return { total: null, shown: shown(), full: false }; }
      for (let i = 0, last = -1, stable = 0; i < 40; i++) {
        const n = shown();
        if (total === 0 || n >= total) break;
        if (n === last && n > 0) { if (++stable >= 6) break; } else { stable = 0; last = n; }
        await sleep(200);
      }
      if (shown() < total) {
        const pages = this.pageButtons();
        if (pages.length > 1) {
          (pages[pages.length - 1] || pages[0]).click();
          await this.waitFor(() => shown() >= total, 6000);
        }
      }
      const st = { total, shown: shown(), full: shown() >= total };
      if (st.full) { this.expandedFor = location.pathname; this.hidePager(); }
      else log && log(`⚠ 只展開 ${st.shown}／${st.total} 筆，仍是分頁狀態（請重載頁面再試）`);
      return st;
    },
    hidePager() { [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).filter((b) => /^\d+$/.test((b.innerText || '').trim())).forEach((b) => { b.style.display = 'none'; }); },

    readRows() {
      const kws = this.keywordAreas(), cts = this.contentAreas();
      const n = Math.min(kws.length, cts.length); const out = [];
      for (let i = 0; i < n; i++) out.push({ a: kws[i].value || '', b: cts[i].value || '' });
      return out;
    },
    async addOne(row, log) {
      const btn = this.addButton();
      if (!btn) { log('⚠ 找不到「加入項目」按鈕'); return false; }
      const before = new Set(this.keywordAreas());
      btn.click();
      let node = null;
      for (let i = 0; i < 25 && !node; i++) { await sleep(200); node = this.keywordAreas().find((t) => !before.has(t)); }
      if (!node) { log('⚠ 新增的空列沒出現，已停止'); return false; }
      const idx = this.keywordAreas().indexOf(node);
      const ct = this.contentAreas()[idx];
      setReactValue(node, row.a); if (ct) setReactValue(ct, row.b);
      await sleep(700);
      if (!this.readRows().some((r) => r.a === row.a)) { log(`⚠「${row.a}」寫入後查不到，已停止`); return false; }
      return true;
    },
    async import(rows, opts, log) {
      await this.expandAll(log);
      let warned = 0;
      rows.forEach((e, i) => { if ((e.a || '').length > this.MAX_KW) { log(`⚠ 第${i + 1}列關鍵字 ${e.a.length}字 > ${this.MAX_KW}`); warned++; } if ((e.b || '').length > this.MAX_CT) { log(`⚠ 第${i + 1}列內容 ${e.b.length}字 > ${this.MAX_CT}`); warned++; } });
      if (warned) log(`（${warned} 處超過上限，可能被截斷）`);

      const existing = this.readRows();
      const total = opts.overwrite ? Math.max(existing.length, rows.length) : existing.length + rows.length;
      const ask = opts.overwrite
        ? `現有 ${existing.length} 筆的前 ${Math.min(rows.length, existing.length)} 筆會被改寫${rows.length > existing.length ? `，並新增 ${rows.length - existing.length} 筆` : ''}${existing.length > rows.length ? `，後面 ${existing.length - rows.length} 筆保持不動` : ''}`
        : `現有 ${existing.length} 筆完全不動，另外加上 ${rows.length} 筆（會出現在最上面）`;
      const ok = await confirmBox({ title: opts.overwrite ? '即將覆蓋匯入' : '即將新增匯入', body: ask, warn: LORE_WARN });
      if (!ok) { log('已取消，沒有動到任何東西'); return false; }
      if (total > 100) log(`⚠ 合計 ${total} 筆，超過 Lorebook 上限 100 筆，超出的可能存不進去`);
      log(`處理中…共 ${opts.overwrite ? rows.length : rows.length} 筆，逐筆寫入約需 ${Math.ceil(rows.length * 1.2)} 秒`);

      let n = 0;
      if (opts.overwrite) {
        const kws = this.keywordAreas(), cts = this.contentAreas();
        const hit = Math.min(rows.length, kws.length);
        for (let i = 0; i < hit; i++) {
          if (!document.contains(kws[i])) { log(`⚠ 第 ${i + 1} 列在寫入途中被換掉，已停止`); break; }
          setReactValue(kws[i], rows[i].a); if (cts[i]) setReactValue(cts[i], rows[i].b);
          n++; await sleep(400);
        }
        for (let i = hit; i < rows.length; i++) { if (!(await this.addOne(rows[i], log))) break; n++; }
        log(`已覆蓋 ${n} 筆${existing.length > rows.length ? `，後面 ${existing.length - rows.length} 筆舊項目保持不動` : ''}`);
      } else {
        for (const row of rows.slice().reverse()) { if (!(await this.addOne(row, log))) break; n++; }
        log(`已新增 ${n} 筆（現有 ${existing.length} 筆沒動）`);
        log('新項目會出現在清單最上面——平台固定最新在前，沒辦法排到最後。');
      }
      return true;
    },
    async applyOrder(rows, log) {
      const kws = this.keywordAreas(), cts = this.contentAreas();
      if (kws.length !== rows.length) { log(`⚠ 畫面 ${kws.length} 列 ≠ 排序 ${rows.length} 列，已停止`); return; }
      let changed = 0;
      for (let i = 0; i < rows.length; i++) {
        if (!document.contains(kws[i])) { log(`⚠ 第 ${i + 1} 列在寫入途中被換掉，已停止`); break; }
        const sameA = kws[i].value === rows[i].a, sameB = cts[i] ? cts[i].value === rows[i].b : true;
        if (sameA && sameB) continue;
        setReactValue(kws[i], rows[i].a); if (cts[i]) setReactValue(cts[i], rows[i].b);
        changed++; await sleep(400);
      }
      log(`已套用新順序（實際改寫 ${changed} 列）`);
      log('⚠ Lorebook 自動儲存，已直接生效、無法復原。');
    },
    readCurrentPage() { const kws = this.keywordAreas(), cts = this.contentAreas(); const out = []; const n = Math.max(kws.length, cts.length); for (let i = 0; i < n; i++) { const k = (kws[i]?.value || '').trim(); const c = cts[i]?.value || ''; if (k || c.trim()) out.push([k, c]); } return out; },
    async collectAll(log) {
      const st = await this.status();
      const pages = this.pageButtons();
      if (st.full || pages.length <= 1) { log && log(`讀取 ${st.shown} 筆（一頁全在畫面上）`); return this.readCurrentPage(); }
      const nums = [...new Set(pages.map((b) => (b.innerText || '').trim()))].sort((a, b) => Number(a) - Number(b));
      const out = [];
      for (const num of nums) { const btn = this.pageButtons().find((b) => (b.innerText || '').trim() === num); if (btn) { btn.click(); await sleep(400); } out.push(...this.readCurrentPage()); log && log(`已讀取第 ${num} 頁`); }
      if (st.total != null && out.length > st.total) log && log(`⚠ 讀到 ${out.length} 列但總數只有 ${st.total}，可能重複讀到同一頁，請重載頁面再試`);
      return out;
    },
  };

  const TLANGS = ['韓文', '英文', '日文', '簡體中文', '西班牙文', '法文', '葡萄牙文', '德文', '阿拉伯文'];
  const Trans = {
    dialog: () => [...document.querySelectorAll('[role="dialog"]')].filter((d) => !inPanel(d)).filter((d) => d.getAttribute('data-state') !== 'closed').find((d) => /管理翻譯/.test(d.textContent || '')) || null,
    rowNameOf(input, d) { let p = input.parentElement; for (let i = 0; i < 7 && p && p !== d; i++) { const t = [...p.querySelectorAll('span[title]')]; if (t.length === 1) return (t[0].getAttribute('title') || '').trim(); p = p.parentElement; } return null; },
    rows(d) { const ins = [...d.querySelectorAll('input')].filter(isVisible).filter((i) => !i.closest(`#${BAR_ID}`)).filter((i) => (i.placeholder || '') !== '請搜尋要翻譯的字詞'); return ins.map((i) => ({ name: this.rowNameOf(i, d), input: i })).filter((r) => r.name); },

    manageBtn: () => [...document.querySelectorAll('button')].filter((b) => !inPanel(b)).find((b) => (b.innerText || '').replace(/\s+/g, ' ').trim() === '管理翻譯') || null,
    async open(log) {
      let d = this.dialog(); if (d) return { dialog: d, opened: false };
      const b = this.manageBtn(); if (!b) { log('⚠ 找不到「管理翻譯」按鈕，略過多語'); return { dialog: null, opened: false }; }
      b.click();
      for (let k = 0; k < 25 && !d; k++) { await sleep(120); d = this.dialog(); }
      if (!d) { log('⚠ 開啟管理翻譯失敗，略過多語'); return { dialog: null, opened: false }; }
      await sleep(400); return { dialog: d, opened: true };
    },
    close(d) { if (!d) return; const c = d.querySelector('button.absolute.top-5.right-5') || [...d.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Close' || b.querySelector('svg.lucide-x,svg[class*="lucide-x"]')); if (c) c.click(); },
    async fillAllFromPanel(names, log, logRaw) {
      log('補 9 種語言的狀態值空白…約 25 秒');
      const { dialog: d, opened } = await this.open(log);
      if (!d) return;
      const known = new Set(this.rows(d).map((r) => r.name));
      const missing = (names || []).filter((n) => n && !known.has(n));
      await this.fillAllLanguages(d, log);
      if (missing.length) {
        logRaw(`⚠ 這 ${missing.length} 個狀態值沒有出現在管理翻譯：`);
        logRaw(`<b style="color:${C.hlGreen};">${missing.map(esc).join('、')}</b>`);
      }
      if (opened) this.close(d);
    },
    btn(d, txt) { return [...d.querySelectorAll('button')].find((b) => (b.innerText || '').replace(/\s+/g, ' ').trim() === txt) || null; },
    async selectLang(d, label, log) { const b = this.btn(d, label); if (!b) { log && log(`⚠ 找不到語言頁籤：${label}`); return false; } b.click(); await sleep(260); return true; },
    async selectStatusTab(d, log) { const b = this.btn(d, '狀態值'); if (!b) { log && log('⚠ 找不到「狀態值」分頁'); return false; } b.click(); await sleep(200); return true; },
    async fillAllLanguages(d, log) {
      let filled = 0, langs = 0;
      for (const lang of TLANGS) {
        if (!(await this.selectLang(d, lang, log))) continue;
        if (!(await this.selectStatusTab(d, log))) continue;
        let n = 0;
        for (const r of this.rows(d)) {
          if ((r.input.value || '').trim()) continue;
          setReactValue(r.input, r.name); n++; await sleep(30);
        }
        filled += n; langs++;
        log(`${lang}：補 ${n} 筆`);
      }
      await this.selectLang(d, TLANGS[0], log);
      await this.selectStatusTab(d, log);
      log(`共 ${langs} 種語言、補上 ${filled} 筆空白（已翻好的沒動）`);
      log('⚠ 記得按網站「儲存」才生效。');
    },

    activeLang(d) { const b = [...d.querySelectorAll('button')].find((x) => TLANGS.includes((x.innerText || '').trim()) && /bg-white/.test(String(x.className))); return b ? (b.innerText || '').trim() : '目前語言'; },
    activeType(d) { const b = [...d.querySelectorAll('button')].find((x) => ['狀態值', '文字'].includes((x.innerText || '').trim()) && /border-primary/.test(String(x.className))); return b ? (b.innerText || '').trim() : '目前分頁'; },
    fillCurrent(d, raw, log) {
      const rows = this.rows(d);
      if (!rows.length) { log('⚠ 這頁沒有可填的欄位'); return; }
      const where = `${this.activeLang(d)}／${this.activeType(d)}`;
      if (/\t/.test(raw)) {
        const map = new Map();
        rows.forEach((r) => { if (!map.has(r.name)) map.set(r.name, r.input); });
        let n = 0; const miss = [];
        for (const r of parseDSV(raw, '\t')) {
          const name = (r[0] || '').trim(); if (!name) continue;
          const input = map.get(name); if (!input) { miss.push(name); continue; }
          setReactValue(input, r[1] != null ? r[1] : ''); n++;
        }
        log(`已填入 ${where}：${n} 筆（依名稱對應）` + (miss.length ? `\n⚠ ${miss.length} 個名稱對不到：${miss.slice(0, 3).join('、')}${miss.length > 3 ? '…' : ''}` : ''));
      } else {
        const lines = raw.replace(/\r/g, '').split('\n');
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        const n = Math.min(lines.length, rows.length);
        for (let i = 0; i < n; i++) setReactValue(rows[i].input, lines[i]);
        log(`已填入 ${where}：${n} 筆（依畫面順序）` + (lines.length !== rows.length ? `\n⚠ 貼上 ${lines.length} 行 ≠ 畫面 ${rows.length} 欄，只填前 ${n} 個` : ''));
      }
      log('⚠ 記得按網站「儲存」才生效。');
    },
    injectBar(d) {
      if (!d || d.querySelector(`#${BAR_ID}`)) return;
      const bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.style.cssText = `flex:0 0 auto;pointer-events:auto;margin:0 20px 16px;padding:10px 12px;background:${C.bg};border:1px solid ${C.line};border-radius:10px;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:${C.ink};`;
      bar.innerHTML = `
        <div id="cd-tl-head" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin-bottom:8px;">
          <span style="display:flex;align-items:center;gap:5px;"><b style="font-size:13px;">批次貼上翻譯</b>${infoBtn('cd-tl-info')}</span>
          <span id="cd-tl-tog" style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid ${C.line};background:${C.field};color:${C.ink2};border-radius:6px;">${ICON_FOLD}</span></div>
        <div id="cd-tl-body">
          <div id="cd-tl-help" style="display:none;">${helpBox([
            ['貼一欄', '每行一個值，由上到下依畫面順序填'],
            ['貼兩欄', 'A 欄＝原文、B 欄＝譯文，依名稱對應，對不到的會列出來'],
            ['範圍', '只會動「當前語言分頁」，切到別的語言要再填一次'],
            ['複製原文', '把原文（中文）列成一欄，方便丟去翻譯'],
            ['複製譯文', '把「當前語言分頁」目前已填的譯文列成一欄，方便備份或改動'],
            ['填入本頁', '將內容寫進欄位。改完要按網站的「儲存」才生效'],
          ])}</div>
          <textarea id="cd-tl-text" placeholder="一欄＝依畫面順序　　兩欄＝原文 Tab 譯文" style="${FIELD('76px')}"></textarea>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button type="button" id="cd-tl-src" style="${BTN}flex:1;background:${C.btn};color:${C.btnInk};">複製原文</button>
            <button type="button" id="cd-tl-val" style="${BTN}flex:1;background:${C.btn};color:${C.btnInk};">複製譯文</button>
            <button type="button" id="cd-tl-clr" style="${BTN}background:${C.btn};color:${C.btnInk};">清空</button>
          </div>
          <button type="button" id="cd-tl-fill" style="${BTN}width:100%;margin-top:6px;background:${C.primary};color:#fff;">填入本頁</button>
          <div id="cd-tl-log" style="${LOGBOX}"></div>
        </div>`;
      d.appendChild(bar);
      const q = (s) => bar.querySelector(s);
      const logBox = q('#cd-tl-log');
      const log = (m) => { logBox.style.display = 'block'; logBox.textContent += (logBox.textContent ? '\n' : '') + m; logBox.scrollTop = logBox.scrollHeight; };
      const clearLog = () => { logBox.textContent = ''; logBox.style.display = 'none'; };
      q('#cd-tl-head').onclick = (e) => {
        if (e.target.closest('#cd-tl-info')) { const h = q('#cd-tl-help'); h.style.display = h.style.display === 'none' ? 'block' : 'none'; return; }
        const b = q('#cd-tl-body'); const open = b.style.display !== 'none';
        b.style.display = open ? 'none' : 'block';
        q('#cd-tl-tog').style.transform = open ? 'rotate(180deg)' : '';
      };
      q('#cd-tl-clr').onclick = () => { q('#cd-tl-text').value = ''; clearLog(); };
      const copyColumn = async (kind) => {
        clearLog();
        const rows = this.rows(d);
        if (!rows.length) { log('⚠ 這頁沒有可讀的欄位'); return; }
        const text = rows.map((r) => (kind === 'src' ? r.name : (r.input.value || ''))).join('\n');
        q('#cd-tl-text').value = text;
        log(kind === 'src'
          ? `已列出 ${this.activeType(d)} 原文 ${rows.length} 筆`
          : `已列出 ${this.activeLang(d)}／${this.activeType(d)} 譯文 ${rows.length} 筆`);
        const ok = await Promise.race([copyToClipboard(text), new Promise((r) => setTimeout(() => r(false), 1500))]);
        log(ok ? '已複製到剪貼簿' : '⚠ 剪貼簿沒回應，請直接在框內 Ctrl+A → Ctrl+C');
      };
      q('#cd-tl-src').onclick = () => copyColumn('src');
      q('#cd-tl-val').onclick = () => copyColumn('val');
      q('#cd-tl-fill').onclick = () => {
        clearLog();
        const raw = q('#cd-tl-text').value;
        if (!raw.trim()) { log('⚠ 請先貼上內容'); return; }
        try { this.fillCurrent(d, raw, log); } catch (e) { log('✗ 填入錯誤：' + e.message); }
      };
    },
  };

  function buildPanel(mode) {
    if (document.getElementById(PANEL_ID)) return;
    const isLore = mode === 'lorebook';
    const wrap = document.createElement('div');
    wrap.id = PANEL_ID; wrap.dataset.mode = mode; wrap.dataset.path = location.pathname;
    wrap.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:999999;display:flex;justify-content:flex-end;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;';
    const radio = (id, label, checked) => `<label style="display:flex;align-items:center;gap:5px;color:${C.ink};cursor:pointer;"><input type="radio" name="cd-lore-mode" id="${id}"${checked ? ' checked' : ''} style="accent-color:${C.primary};margin:0;"> ${label}</label>`;
    const check = (id, label) => `<label style="display:flex;align-items:center;gap:5px;color:${C.ink};cursor:pointer;"><input type="checkbox" id="${id}" checked style="accent-color:${C.primary};margin:0;"> ${label}</label>`;
    const optionRow = isLore
      ? `<span style="color:${C.ink2};">匯入</span>${radio('cd-append', '新增（不動現有）', true)}${radio('cd-over', '覆蓋現有', false)}`
      : `<span style="color:${C.ink2};">範圍</span>${check('cd-a', '狀態值(含多語)')}${check('cd-b', '文字')}`;
    const helpRows = isLore
      ? [
        ['貼上格式', '從 Google Sheet 複製 A、B 兩欄直接貼（A＝關鍵字、B＝內容）<br>也吃純文字空行分組'],
        ['新增（不動現有）', '現有項目完全不碰，只加上新的。新項目會出現在最上面（平台固定最新在前，排不到最後）'],
        ['覆蓋現有', '從第一列往下覆蓋，不夠再新增<br>貼的比現有少時，多出來的舊項目留著不動'],
        ['排序', '拖曳調整後按「套用順序」<br>不是真的搬動項目，所以只是把值重寫回固定位置'],
        ['匯出到剪貼簿', '把現有項目輸出成兩欄（.TSV格式），可直接貼回 Google Sheet'],
        ['⚠', '進頁面自動將多頁顯示在一頁，頁碼會被藏起來'],
        ['⚠', '這頁自動儲存，改了就生效、無法復原。匯入前請先按「預覽」簡單確認。'],
      ]
      : [
        ['貼上格式', '從 Google Sheet 複製 A、B 兩欄直接貼（A＝狀態值、B＝文字）<br>也吃純文字空行分組，或貼 HTML 抓 {{變數}}'],
        ['狀態值(含多語)', '寫入狀態值欄位，並自動開「管理翻譯」，把 9 種語言的狀態值空白補上原文（已翻好的不動）。約 25 秒。'],
        ['文字', '寫入指令'],
        ['匯入', '從第一列開始全部覆蓋<br>列數不夠自動新增，多出來的自動刪掉'],
        ['匯出到剪貼簿', '把現有欄位輸出成兩欄，可直接貼回 Google Sheet'],
        ['⚠', '改完要按網站的「儲存」才生效；按之前可以重載丟棄'],
      ];
    wrap.innerHTML = `
      <div id="cd-card" style="width:360px;background:${C.bg};color:${C.ink};border:1px solid ${C.line};border-radius:12px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.3);">
        <div id="cd-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;background:${C.head};border-bottom:1px solid ${C.line};cursor:move;user-select:none;">
          <span style="display:flex;align-items:center;gap:6px;"><b style="font-size:13.5px;">${isLore ? 'Lorebook 匯入匯出' : '小工具匯入匯出'} (.TSV)</b>${infoBtn('cd-info')}</span>
          <button type="button" id="cd-min" title="收合" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid ${C.line};background:${C.field};color:${C.ink2};border-radius:7px;cursor:pointer;">${ICON_FOLD}</button>
        </div>
        <div id="cd-body" style="padding:12px 14px 14px;">
          <div id="cd-help" style="display:none;">${helpBox(helpRows)}</div>
          <div id="cd-main">
            <textarea id="cd-text" placeholder="${isLore ? '關鍵字　　內容（Tab 分欄）' : '狀態值　　文字（Tab 分欄）'}" style="${FIELD('150px')}"></textarea>
            <div style="margin:10px 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap;">${optionRow}</div>
            <div style="display:flex;gap:8px;">
              <button type="button" id="cd-prev" style="${BTN}background:${C.btn};color:${C.btnInk};">預覽</button>
              <button type="button" id="cd-run" style="${BTN}flex:1;background:${C.primary};color:#fff;">匯入</button>
              ${isLore
                ? `<button type="button" id="cd-sort" style="${BTN}background:${C.btn};color:${C.btnInk};">排序</button>`
                : `<button type="button" id="cd-clear" style="${BTN}background:${C.btn};color:${C.btnInk};">清空</button>`}
            </div>
            <button type="button" id="cd-export" style="${BTN}width:100%;margin-top:8px;background:${C.field};color:${C.btnInk};border-color:${C.line};">匯出到剪貼簿</button>
          </div>
          ${isLore ? `
          <div id="cd-sortbox" style="display:none;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;color:${C.ink2};">
              <span>拖曳調整順序</span>
              <button type="button" id="cd-sort-cancel" style="${BTN}padding:5px 9px;font-weight:400;background:${C.btn};color:${C.btnInk};">取消</button>
            </div>
            <ul id="cd-sortlist" style="list-style:none;margin:0;padding:0;max-height:240px;overflow:auto;border:1px solid ${C.line};border-radius:8px;background:${C.field};"></ul>
            <button type="button" id="cd-sort-apply" style="${BTN}width:100%;margin-top:8px;background:${C.danger};color:#fff;">套用順序</button>
          </div>` : ''}
          <div id="cd-log" style="${LOGBOX}"></div>
        </div>
      </div>
      <button type="button" id="cd-orb" title="展開" style="display:none;align-items:center;justify-content:center;width:46px;height:46px;padding:0;border:1px solid ${C.line};background:${C.bg};color:${C.primary};border-radius:50%;box-shadow:0 8px 20px rgba(0,0,0,.3);cursor:pointer;">${ICON_ORB}</button>`;
    document.body.appendChild(wrap);

    const $ = (s) => wrap.querySelector(s);
    const logBox = $('#cd-log');
    const logRaw = (html) => { logBox.style.display = 'block'; logBox.insertAdjacentHTML('beforeend', (logBox.innerHTML ? '<br>' : '') + html); logBox.scrollTop = logBox.scrollHeight; };
    const log = (m) => logRaw(esc(m));
    const done = (m) => logRaw(`<b style="color:${C.doneRed};">${esc(m)}</b>`);
    const clearLog = () => { logBox.innerHTML = ''; logBox.style.display = 'none'; };
    const overwrite = () => isLore && $('#cd-over').checked;
    const setBusy = (on) => {
      ['#cd-prev', '#cd-run', '#cd-clear', '#cd-export', '#cd-sort', '#cd-sort-apply'].forEach((id) => {
        const el = $(id); if (!el) return;
        el.disabled = on;
        el.style.opacity = on ? '.45' : '';
        el.style.cursor = on ? 'progress' : 'pointer';
      });
    };

    if (isLore) {
      const syncRun = () => {
        const run = $('#cd-run'), on = overwrite();
        run.style.background = on ? C.danger : C.primary;
        run.textContent = on ? '覆蓋匯入' : '新增匯入';
      };
      $('#cd-append').onchange = syncRun; $('#cd-over').onchange = syncRun; syncRun();
      log('讀取中…正在確認 Lorebook 是否完整展開');
      setBusy(true);
      (async () => {
        try {
          const st = await Lore.expandAll(log);
          if (st && st.full) log(`Lorebook 共 ${st.total} 筆，已完整展開`);
        } finally { setBusy(false); }
      })();

      const box = $('#cd-sortbox'), list = $('#cd-sortlist'), main = $('#cd-main');
      let sortRows = [];
      const renderList = () => {
        list.innerHTML = sortRows.map((r, i) =>
          `<li draggable="true" data-i="${i}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid ${C.line};background:${C.field};cursor:grab;font-size:12.5px;">
             <span style="display:flex;color:${C.ink2};">${ICON_GRIP}</span>
             <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.a || '（空白）')}</span></li>`).join('');
      };
      $('#cd-sort').onclick = async () => {
        clearLog(); setBusy(true); log('讀取中…');
        try {
          await Lore.expandAll(log);
          sortRows = Lore.readRows();
          if (!sortRows.length) { log('⚠ 這本 Lorebook 還沒有項目'); return; }
          renderList(); main.style.display = 'none'; box.style.display = 'block';
          log(`共 ${sortRows.length} 筆，拖好後按「套用順序」`);
        } finally { setBusy(false); }
      };
      $('#cd-sort-cancel').onclick = () => { box.style.display = 'none'; main.style.display = 'block'; clearLog(); };
      list.addEventListener('dragstart', (e) => {
        const li = e.target.closest('li'); if (!li) return;
        li.classList.add('cd-dragging'); li.style.opacity = '.45';
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch (_) {  }
      });
      list.addEventListener('dragend', () => { const li = list.querySelector('.cd-dragging'); if (li) { li.classList.remove('cd-dragging'); li.style.opacity = ''; } });
      list.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = list.querySelector('.cd-dragging'), li = e.target.closest('li');
        if (!dragging || !li || li === dragging) return;
        const rect = li.getBoundingClientRect();
        list.insertBefore(dragging, (e.clientY - rect.top) > rect.height / 2 ? li.nextSibling : li);
      });
      list.addEventListener('drop', (e) => e.preventDefault());
      $('#cd-sort-apply').onclick = async () => {
        const order = [...list.children].map((li) => sortRows[Number(li.dataset.i)]);
        const ok = await confirmBox({
          title: '即將套用新順序',
          body: `會把 ${order.length} 列的內容整份重寫回去（平台不能搬動項目，只能改值）`,
          warn: LORE_WARN,
        });
        if (!ok) { log('已取消'); return; }
        clearLog(); setBusy(true); log('寫入中…');
        try { await Lore.applyOrder(order, log); done('排序完成（Lorebook 已自動儲存生效）'); }
        catch (e) { log('✗ 排序錯誤：' + e.message); }
        finally { setBusy(false); }
        box.style.display = 'none'; main.style.display = 'block';
      };
    }

    if ($('#cd-clear')) $('#cd-clear').onclick = () => { $('#cd-text').value = ''; clearLog(); };
    $('#cd-prev').onclick = () => {
      clearLog();
      const { rows, mode: pm } = parseRows($('#cd-text').value, !isLore);
      log(`預覽：${rows.length} 列（來源：${pm === 'tsv' ? '試算表' : pm === 'html' ? 'HTML {{}}' : pm === 'blocks' ? '純文字' : '空'}）`);
      rows.slice(0, 10).forEach((r, i) => log(`${i + 1}. [${r.a}] ${(r.b || '').replace(/\n/g, ' ').slice(0, 28)}`));
      if (rows.length > 10) log(`…還有 ${rows.length - 10} 列`);
    };
    $('#cd-run').onclick = async () => {
      clearLog(); setBusy(true);
      try {
        const { rows } = parseRows($('#cd-text').value, !isLore);
        if (!rows.length) { log('⚠ 沒有解析到任何列'); return; }
        if (isLore) { if (await Lore.import(rows, { overwrite: overwrite() }, log)) done('匯入完成（Lorebook 已自動儲存生效）'); }
        else {
          await Widget.importOverwrite(rows, { a: $('#cd-a').checked, b: $('#cd-b').checked }, log);
          if ($('#cd-a').checked) await Trans.fillAllFromPanel(rows.map((r) => r.a), log, logRaw);
          done('匯入完成，請檢查後按網站的「儲存」');
        }
      } catch (e) { log('✗ 匯入錯誤：' + e.message); } finally { setBusy(false); }
    };
    $('#cd-export').onclick = async () => {
      clearLog(); setBusy(true); log('讀取中…');
      try {
        let grid;
        if (isLore) { await Lore.expandAll(log); grid = await Lore.collectAll(log); }
        else grid = Widget.exportRows({ a: $('#cd-a').checked, b: $('#cd-b').checked });
        const tsv = toTSV(grid);
        $('#cd-text').value = tsv;
        log(`已匯出 ${grid.length} 列（試算表格式）`);
        log((await copyToClipboard(tsv)) ? '已複製到剪貼簿，可直接貼進 Google Sheet' : '⚠ 剪貼簿沒回應，請直接在框內 Ctrl+A → Ctrl+C');
        done('匯出完成');
      } catch (e) { log('✗ 匯出錯誤：' + e.message); } finally { setBusy(false); }
    };

    const card = $('#cd-card'), orb = $('#cd-orb'), head = $('#cd-head');
    const collapse = (on) => { card.style.display = on ? 'none' : 'block'; orb.style.display = on ? 'flex' : 'none'; };
    collapse(true);
    $('#cd-min').onclick = (e) => { e.stopPropagation(); collapse(true); };
    orb.onclick = () => collapse(false);
    $('#cd-info').onclick = (e) => { e.stopPropagation(); const h = $('#cd-help'); h.style.display = h.style.display === 'none' ? 'block' : 'none'; };

    let drag = false, ox = 0, oy = 0;
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      drag = true; ox = e.clientX - wrap.offsetLeft; oy = e.clientY - wrap.offsetTop;
      wrap.style.bottom = 'auto'; wrap.style.right = 'auto';
    });
    document.addEventListener('mousemove', (e) => { if (!drag) return; wrap.style.left = (e.clientX - ox) + 'px'; wrap.style.top = (e.clientY - oy) + 'px'; });
    document.addEventListener('mouseup', () => { drag = false; });
  }

  setInterval(() => {
    if (!document.body) return;
    const mode = detectMode();
    const panel = document.getElementById(PANEL_ID);
    const stale = panel && (panel.dataset.mode !== mode || (mode === 'lorebook' && panel.dataset.path !== location.pathname));
    if (mode) { if (!panel) buildPanel(mode); else if (stale) { panel.remove(); buildPanel(mode); } }
    else if (panel) panel.remove();
    if (mode === 'widget') { const d = Trans.dialog(); if (d) Trans.injectBar(d); }
    if (mode === 'lorebook' && Lore.expanded) Lore.hidePager();
  }, 800);
})();
