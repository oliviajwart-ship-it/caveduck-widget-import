// ==UserScript==
// @name         Caveduck編輯器
// @namespace    https://caveduck.io/
// @version      1.6
// @description  可將 Google Sheet 兩欄／三欄（TSV）貼上併匯入，也可將現有欄位內容匯出成可貼回試算表的格式。支援關鍵字書（基礎＋快捷指令＋翻譯）、小工具介面和骰子預設。
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
  const ICON_DICE = SVG('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/>', 22);
  const infoBtn = (id) => `<button type="button" id="${id}" title="說明" style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;background:none;color:${C.ink2};cursor:pointer;">${ICON_INFO}</button>`;
  const helpBox = (rows) => `<div style="margin-bottom:10px;padding:9px 11px;background:${C.field};border:1px solid ${C.line};border-radius:8px;font-size:12px;line-height:1.7;color:${C.ink2};">`
    + rows.map(([k, v]) => `<div style="margin:2px 0;"><b style="color:${C.ink};">${k}</b>　${v}</div>`).join('') + '</div>';

  const detectMode = () => {
    const p = location.pathname;
    if (/\/(creator|player)-widgets\/[^/]+/.test(p)) return 'widget';
    if (/\/lore-books\/edit\/[^/]+/.test(p)) return 'lorebook';
    if (/\/creates\/dices\/?$/.test(p)) return 'dice';
    return null;
  };
  const detectTab = () => {
    const t = document.getElementById('lorebook-shortcut-tab') || [...document.querySelectorAll('[role="tab"]')][1];
    return t && t.getAttribute('aria-selected') === 'true' ? 'shortcut' : 'basic';
  };
  const PRIMARY_RE = /\bbg-(cb-)?primary(-\d+)?\b/;

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
  function siteDialog() {
    return [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')]
      .filter((d) => !inPanel(d) && d.getAttribute('data-state') !== 'closed')
      .find(isVisible) || null;
  }
  function dialogConfirmButton() {
    const d = siteDialog(); if (!d) return null;
    const OK = ['確認', '확인', '確定', 'OK', 'Confirm', '是的，我要刪除它。'];
    return [...d.querySelectorAll('button')].filter(isVisible).find((b) => PRIMARY_RE.test(String(b.className)))
      || [...d.querySelectorAll('button')].find((b) => OK.includes((b.innerText || '').trim()))
      || null;
  }
  function siteSaveButton() {
    const cands = [...document.querySelectorAll('button')].filter((b) => !inPanel(b) && isVisible(b)
      && !b.closest('[role="dialog"],[role="alertdialog"]') && !b.closest('.lorebook-entry') && !b.closest('#lorebook-shortcut-panel')
      && PRIMARY_RE.test(String(b.className)));
    return cands.find((b) => b.closest('.sticky')) || cands.find((b) => /儲存|저장|保存|^Save$/i.test((b.innerText || '').trim())) || null;
  }
  function confirmBox({ title, body, warn }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);pointer-events:auto;font:14px/1.8 system-ui,-apple-system,"Segoe UI",sans-serif;';
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
  const LORE_WARN = ['匯入後只是草稿，要按網站的「儲存」才會生效', '（按儲存前重載頁面即可整份丟棄）', '確定要繼續嗎？'];
  const splitKeywords = (s) => String(s == null ? '' : s).split(/[|,，]+/).map((t) => t.trim()).filter(Boolean);

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

  const SHORT_LANGS = ['ko', 'en', 'ja', 'zh-hans', 'es', 'fr', 'pt', 'de', 'ar', 'ru'];
  const SHORT_FIELDS = ['name', 'description', 'prompt'];
  function parseShortRows(raw) {
    raw = (raw || '').replace(/^\uFEFF/, '');
    const trimmed = raw.trim(); if (!trimmed) return [];
    const cell = (r, i) => (r[i] == null ? null : String(r[i]));
    const blank = (v) => v == null || v.trim() === '';
    let rows;
    if (/\t/.test(raw)) {
      rows = parseDSV(raw, '\t').map((r) => {
        const row = { name: (cell(r, 0) || '').trim(), description: cell(r, 1), prompt: cell(r, 2), tr: {} };
        SHORT_LANGS.forEach((l, i) => {
          const base = 3 + i * 3; const t = {};
          SHORT_FIELDS.forEach((f, k) => { const v = cell(r, base + k); if (!blank(v)) t[f] = f === 'prompt' ? v : v.trim(); });
          if (Object.keys(t).length) row.tr[l] = t;
        });
        return row;
      }).filter((r) => r.name || !blank(r.description) || !blank(r.prompt) || Object.keys(r.tr).length);
    } else {
      rows = trimmed.split(/\r?\n\s*\r?\n/).map((b) => b.trim()).filter(Boolean).map((block) => {
        const lines = block.split(/\r?\n/); return { name: lines[0].trim(), description: null, prompt: lines.slice(1).join('\n').trim() || null, tr: {} };
      }).filter((r) => r.name);
    }
    if (rows.length && /^(名稱|名称|name)$/i.test(rows[0].name)) rows.shift();
    return rows;
  }

  const Widget = {
    trashButtons: () => [...document.querySelectorAll('button')]
      .filter((b) => !inPanel(b) && !b.closest('[role="dialog"]') && isVisible(b))
      .filter((b) => (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M3 6h18')),
    rowOf(btn) { let p = btn; for (let i = 0; i < 8 && p; i++) { p = p.parentElement; if (!p) break; if (p.querySelector('input') && p.querySelector('textarea')) return p; } return null; },
    rows() {
      const list = this.trashButtons().map((del) => {
        const row = this.rowOf(del); if (!row) return null;
        const input = [...row.querySelectorAll('input')].find(isVisible);
        const textarea = [...row.querySelectorAll('textarea')].find(isVisible);
        return input && textarea ? { input, textarea, del } : null;
      }).filter(Boolean);
      const seen = new Set(); return list.filter((r) => (seen.has(r.input) ? false : (seen.add(r.input), true)));
    },
    addButton: () => { const ADD = ['新增資訊', '添加信息', '정보 추가', 'Add Info', 'Add', '情報追加', '追加']; return [...document.querySelectorAll('button')].filter((b) => !inPanel(b) && isVisible(b)).find((b) => ADD.includes((b.innerText || '').replace(/\s+/g, ' ').trim())); },
    async importOverwrite(rows, opts, log) {
      let cur = this.rows(); const addBtn = this.addButton(); let guard = 0;
      while (cur.length < rows.length) { if (!addBtn) { log('⚠ 找不到「新增資訊」按鈕'); break; } addBtn.click(); await sleep(220); cur = this.rows(); if (++guard > rows.length + 8) { log('⚠ 新增逾時'); break; } }
      let trim = 0;
      while (this.rows().length > rows.length) { const rs = this.rows(); const del = rs[rs.length - 1]?.del; if (!del) break; del.click(); let ok = null; for (let k = 0; k < 15 && !ok; k++) { await sleep(120); ok = dialogConfirmButton(); } if (ok) ok.click(); await sleep(350); if (++trim > rows.length + 60) break; }
      cur = this.rows();
      for (let i = 0; i < rows.length; i++) { if (!cur[i]) break; if (opts.a) setReactValue(cur[i].input, rows[i].a); if (opts.b) setReactValue(cur[i].textarea, rows[i].b); if (i % 6 === 0) await sleep(25); }
      log(`已覆蓋匯入 ${Math.min(rows.length, cur.length)} 列（${opts.a ? '含狀態值' : '略狀態值'}、${opts.b ? '含指令' : '略指令'}）`);
    },
    exportRows(opts) {
      return this.rows().map((r) => { const a = (r.input?.value || '').trim(); const b = r.textarea?.value || ''; if (opts.a && opts.b) return [a, b]; if (opts.a) return [a]; if (opts.b) return [b]; return null; }).filter(Boolean);
    },
  };

  const Lore = {
    KW_MAX_LEN: 20, KW_MAX_COUNT: 50, CT_MAX: 400, ITEM_WARN: 100,
    savedCount: null,
    loreId() { const m = location.pathname.match(/lore-books\/edit\/(\d+)/); return m ? m[1] : null; },
    entries: () => [...document.querySelectorAll('.lorebook-entry')].filter((e) => !inPanel(e)).filter(isVisible),
    kwForm: (e) => e.querySelector('form'),
    kwInput(e) { const f = this.kwForm(e); return f ? [...f.querySelectorAll('input')].find(isVisible) : null; },
    contentArea: (e) => [...e.querySelectorAll('textarea')].find(isVisible) || null,
    chipButtons: (e) => [...e.querySelectorAll('button')].filter((b) => (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M18 6')),
    addEntryButton: () => [...document.querySelectorAll('button')]
      .filter((b) => !inPanel(b) && !b.closest('.lorebook-entry') && !b.closest('[role="dialog"]') && !b.closest('#lorebook-shortcut-panel') && isVisible(b))
      .find((b) => [...b.querySelectorAll('svg path')].some((p) => /^M5 12h14$|^M12 5v14$/.test(p.getAttribute('d') || ''))),

    async fetchAll() {
      const id = this.loreId(); if (!id) return null;
      const out = []; let total = null;
      for (let page = 0; page < 10; page++) {
        let j = null;
        for (let t = 0; t < 3 && !j; t++) {
          try { const r = await fetch(`/api/lore/${id}?page=${page}&numPerPage=100`, { credentials: 'include' }); j = await r.json(); }
          catch (e) { await sleep(350); }
        }
        if (!j) break;
        if (typeof j.totalItems === 'number') total = j.totalItems;
        if (page === 0 && Array.isArray(j.shortcuts)) Short.saved = j.shortcuts;
        const items = j.items || [];
        items.forEach((it) => out.push(it));
        if (total == null || out.length >= total || !items.length) break;
      }
      out.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      this.savedCount = total;
      return { total, items: out };
    },
    ensureNumberStyle() {
      if (document.getElementById('cd-lore-numstyle')) return;
      const st = document.createElement('style');
      st.id = 'cd-lore-numstyle';
      st.textContent = `
        body { counter-reset: cd-lore-num; }
        .lorebook-entry { counter-increment: cd-lore-num; }
        .lorebook-entry::before {
          content: counter(cd-lore-num);
          align-self: flex-start;
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 24px; height: 22px; padding: 0 8px;
          border-radius: 999px; background: ${C.primary}; color: #fff;
          font: 700 13px/1 system-ui, sans-serif;
        }`;
      document.head.appendChild(st);
    },
    savingSince: 0, savingPollTick: 0,
    statText() {
      const n = this.entries().length;
      if (this.savingSince) return `畫面 ${n} 筆｜存檔中…`;
      return `畫面 ${n} 筆${this.savedCount != null ? `｜已儲存 ${this.savedCount} 筆` : ''}`;
    },
    tickSaving() {
      if (!this.savingSince) return;
      if (Date.now() - this.savingSince > 30000) { this.savingSince = 0; return; }
      if ((this.savingPollTick = (this.savingPollTick + 1) % 2) !== 0) return;
      this.fetchAll().then((res) => {
        if (res && res.total === this.entries().length) this.savingSince = 0;
      }).catch(() => {});
    },
    ensurePageStat(txt) {
      let tag = document.getElementById('cd-page-stat');
      if (!tag || !document.contains(tag)) {
        const svg = [...document.querySelectorAll('svg')].find((s) => !s.closest('.lorebook-entry') && !inPanel(s)
          && [...s.querySelectorAll('path')].some((p) => /^M12 16v-4/.test(p.getAttribute('d') || '')));
        const row = svg && svg.closest('button') ? svg.closest('button').parentElement : null;
        if (!row) return;
        tag = document.createElement('span');
        tag.id = 'cd-page-stat';
        tag.style.cssText = 'margin-left:auto;font-size:13px;color:inherit;opacity:.65;font-weight:400;';
        row.appendChild(tag);
      }
      if (tag.textContent !== txt) tag.textContent = txt;
    },

    async clearChips(entry) {
      for (let guard = 0; guard < this.KW_MAX_COUNT + 5; guard++) {
        const x = this.chipButtons(entry)[0]; if (!x) return true;
        x.click(); await sleep(40);
      }
      return this.chipButtons(entry).length === 0;
    },
    async addKeywords(entry, kws, log, rowNo) {
      const form = this.kwForm(entry); const input = this.kwInput(entry);
      if (!form || !input) { log(`⚠ 第${rowNo}列找不到關鍵字輸入框`); return 0; }
      if (!kws.length) log(`⚠ 第${rowNo}列沒有關鍵字——網站規定每項至少一個，存檔可能被擋`);
      if (kws.length > this.KW_MAX_COUNT) log(`⚠ 第${rowNo}列有 ${kws.length} 個關鍵字 > 上限 ${this.KW_MAX_COUNT}`);
      let n = 0;
      for (const kw of kws) {
        if (kw.length > this.KW_MAX_LEN) log(`⚠ 第${rowNo}列關鍵字「${kw.slice(0, 10)}…」${kw.length}字 > 上限 ${this.KW_MAX_LEN}`);
        const before = this.chipButtons(entry).length;
        setReactValue(input, kw);
        form.requestSubmit();
        let ok = false;
        for (let t = 0; t < 10 && !ok; t++) { await sleep(60); ok = this.chipButtons(entry).length > before; }
        if (ok) n++; else log(`⚠ 第${rowNo}列關鍵字「${kw.slice(0, 12)}」沒有生成標籤（重複的關鍵字會被網站擋掉）`);
      }
      return n;
    },
    async setEntry(entry, row, log, rowNo) {
      await this.clearChips(entry);
      await this.addKeywords(entry, row.kws || splitKeywords(row.a), log, rowNo);
      if ((row.b || '').length > this.CT_MAX) log(`⚠ 第${rowNo}列內容 ${(row.b || '').length}字 > 上限 ${this.CT_MAX}`);
      const ct = this.contentArea(entry);
      if (ct) setReactValue(ct, row.b || ''); else log(`⚠ 第${rowNo}列找不到內容欄位`);
    },
    async addEntry(log) {
      const btn = this.addEntryButton();
      if (!btn) { log('⚠ 找不到「新增項目」按鈕'); return null; }
      const before = this.entries().length;
      btn.click();
      for (let t = 0; t < 25; t++) {
        await sleep(120);
        const list = this.entries();
        if (list.length > before) return list[list.length - 1];
      }
      log('⚠ 新增的項目沒出現，已停止'); return null;
    },
    async deleteLastEntry(log) {
      const before = this.entries().length;
      if (!before) return false;
      for (let t = 0; t < 3; t++) {
        const stray = siteDialog(); if (!stray) break;
        const cancel = [...stray.querySelectorAll('button')].filter(isVisible).find((b) => !PRIMARY_RE.test(String(b.className)));
        if (cancel) cancel.click();
        await sleep(400);
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const list = this.entries();
        const entry = list[list.length - 1];
        if (!entry) return false;
        const trash = [...entry.querySelectorAll('button')].find((b) => (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M3 6h18'));
        if (!trash) { log('⚠ 找不到項目的垃圾桶按鈕'); return false; }
        trash.click();
        let ok = null;
        for (let t = 0; t < 25 && !ok; t++) { await sleep(140); ok = dialogConfirmButton(); }
        if (!ok) continue;
        ok.click();
        for (let t = 0; t < 30; t++) { await sleep(140); if (this.entries().length < before) return true; }
        log('⚠ 刪除後列數沒有減少，已停止'); return false;
      }
      log('⚠ 刪除確認框一直沒出現，已停止'); return false;
    },
    async import(rows, opts, log) {
      if (detectTab() === 'shortcut') { log('⚠ 現在在「快捷指令」分頁。請先切到「基礎」分頁再匯入關鍵字（快捷指令請用切過去後的面板）'); return false; }
      if (!this.entries().length && !this.addEntryButton()) { log('⚠ 找不到項目區塊（.lorebook-entry），網站可能又改版了'); return false; }
      const existing = this.entries();
      const blankOnly = !opts.overwrite && existing.length === 1 && !this.chipButtons(existing[0]).length && !(this.contentArea(existing[0])?.value || '').trim();
      if (blankOnly) opts = { ...opts, overwrite: true };
      const ask = blankOnly
        ? `現有的 1 筆是空白項目，會直接填進去，其餘 ${rows.length - 1} 筆接在後面新增`
        : opts.overwrite
          ? `現有 ${existing.length} 筆的前 ${Math.min(rows.length, existing.length)} 筆會被改寫${rows.length > existing.length ? `，並在後面新增 ${rows.length - existing.length} 筆` : ''}${existing.length > rows.length ? `，後面 ${existing.length - rows.length} 筆會被刪除` : ''}`
          : `現有 ${existing.length} 筆完全不動，照貼上順序在最後面加上 ${rows.length} 筆`;
      const ok = await confirmBox({ title: opts.overwrite && !blankOnly ? '即將覆蓋匯入' : '即將新增匯入', body: ask, warn: LORE_WARN });
      if (!ok) { log('已取消，沒有動到任何東西'); return false; }
      const total = opts.overwrite ? Math.max(existing.length, rows.length) : existing.length + rows.length;
      if (total > this.ITEM_WARN) log(`⚠ 合計 ${total} 筆，可能超過網站上限（舊版上限 ${this.ITEM_WARN} 筆），超出的可能存不進去`);
      let n = 0;
      if (opts.overwrite) {
        const hit = Math.min(rows.length, existing.length);
        for (let i = 0; i < hit; i++) {
          if (!document.contains(existing[i])) { log(`⚠ 第 ${i + 1} 列在寫入途中被換掉，已停止`); return true; }
          await this.setEntry(existing[i], rows[i], log, i + 1); n++;
        }
        for (let i = hit; i < rows.length; i++) {
          const e = await this.addEntry(log); if (!e) break;
          await this.setEntry(e, rows[i], log, i + 1); n++;
        }
        const extra = existing.length - rows.length;
        if (extra > 0) {
          log(`刪除多出的 ${extra} 筆…`);
          let d = 0;
          for (; d < extra; d++) {
            if (!(await this.deleteLastEntry(log))) break;
            if ((d + 1) % 10 === 0) log(`已刪 ${d + 1}／${extra}`);
          }
          log(d === extra ? `已刪除多出的 ${extra} 筆舊項目` : `⚠ 只刪掉 ${d}／${extra} 筆，請手動處理剩下的`);
        }
        log(blankOnly ? `已新增 ${n} 筆（第 1 筆填進原本的空白項目）` : `已覆蓋 ${n} 筆`);
      } else {
        for (let i = 0; i < rows.length; i++) {
          const e = await this.addEntry(log); if (!e) break;
          await this.setEntry(e, rows[i], log, i + 1); n++;
        }
        log(`已新增 ${n} 筆（現有 ${existing.length} 筆沒動）`);
      }
      return true;
    },
    async exportGrid(log) {
      if (!this.loreId()) { log('⚠ 這本還沒儲存過（網址還是 new），沒有可匯出的資料'); return []; }
      const res = await this.fetchAll();
      if (!res) { log('⚠ 讀不到資料'); return []; }
      if (res.total != null && res.items.length < res.total) log(`⚠ 只讀到 ${res.items.length}／${res.total} 筆`);
      log(`讀取 ${res.items.length} 筆（以最後一次「儲存」的內容為準，畫面上未儲存的草稿不含在內）`);
      let sep = 0;
      const grid = res.items.map((it) => {
        const d = it.data || {};
        const kws = Array.isArray(d.keywords) && d.keywords.length ? d.keywords : String(d.keyword || '').split('|').filter(Boolean);
        sep += kws.filter((k) => /[|,，]/.test(k)).length;
        return [kws.join(','), d.content || ''];
      });
      if (sep) log(`⚠ 有 ${sep} 個關鍵字本身含「,」或「|」，重新匯入時會被拆成多個`);
      return grid;
    },
  };

  const Short = {
    NAME_MAX: 20, PROMPT_MAX: 400, DESC_MAX: 30,
    saved: null,
    panel: () => document.getElementById('lorebook-shortcut-panel'),
    hasTrash: (el) => [...el.querySelectorAll('button')].some((b) => (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M3 6h18')),
    rows() {
      const p = this.panel(); if (!p) return [];
      return [...p.querySelectorAll('input[id^="lorebook-shortcut-name-"]')].filter(isVisible).map((name) => {
        const key = name.id.slice('lorebook-shortcut-name-'.length);
        const prompt = p.querySelector(`textarea[id="lorebook-shortcut-prompt-${key}"]`);
        const desc = p.querySelector(`input[id="lorebook-shortcut-description-${key}"]`);
        let card = name.parentElement;
        while (card && card !== p && !(card.contains(prompt || name) && this.hasTrash(card))) card = card.parentElement;
        if (!card || card === p) card = name.parentElement;
        const trash = [...card.querySelectorAll('button')].find((b) => (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M3 6h18')) || null;
        return { key, card, name, prompt, desc, trash };
      });
    },
    isBlank: (r) => !(r.name.value || '').trim() && !(r.prompt?.value || '').trim() && !(r.desc?.value || '').trim(),
    addButton() {
      const p = this.panel(); if (!p) return null;
      const cards = this.rows().map((r) => r.card);
      return [...p.querySelectorAll('button')].filter(isVisible).filter((b) => !cards.some((c) => c.contains(b)))
        .find((b) => [...b.querySelectorAll('svg path')].some((x) => /^M5 12h14$|^M12 5v14$/.test(x.getAttribute('d') || ''))) || null;
    },
    manageBtn() {
      const p = this.panel(); if (!p) return null;
      const cards = this.rows().map((r) => r.card);
      const cands = [...p.querySelectorAll('button')].filter(isVisible).filter((b) => !cards.some((c) => c.contains(b)));
      return cands.find((b) => Trans.TITLE_RE.test((b.innerText || '').replace(/\s+/g, ' '))) || cands.find((b) => !b.querySelector('svg')) || null;
    },
    setRow(r, row, log, n) {
      const blank = (v) => v == null || String(v).trim() === '';
      if (!blank(row.name)) {
        if (row.name.length > this.NAME_MAX) log(`⚠ 第${n}條名稱 ${row.name.length} 字 > 上限 ${this.NAME_MAX}，網站會拒絕儲存`);
        setReactValue(r.name, row.name);
      }
      if (!blank(row.description)) {
        const v = row.description.trim();
        if (v.length > this.DESC_MAX) log(`⚠ 第${n}條說明 ${v.length} 字 > 上限 ${this.DESC_MAX}，網站會拒絕儲存`);
        if (r.desc) setReactValue(r.desc, v); else log(`⚠ 第${n}條找不到說明欄位`);
      }
      if (!blank(row.prompt)) {
        if (row.prompt.length > this.PROMPT_MAX) log(`⚠ 第${n}條提示詞 ${row.prompt.length} 字 > 上限 ${this.PROMPT_MAX}，網站會拒絕儲存`);
        if (r.prompt) setReactValue(r.prompt, row.prompt); else log(`⚠ 第${n}條找不到提示詞欄位`);
      }
    },
    async addRow(log) {
      const btn = this.addButton();
      if (!btn) { log('⚠ 找不到快捷指令的「新增」按鈕'); return null; }
      const before = this.rows().length;
      btn.click();
      for (let t = 0; t < 25; t++) {
        await sleep(120);
        const list = this.rows();
        if (list.length > before) return list[list.length - 1];
      }
      log('⚠ 新增的快捷指令沒出現，已停止'); return null;
    },
    async deleteLastRow(log) {
      const before = this.rows().length; if (!before) return false;
      for (let t = 0; t < 3; t++) {
        const stray = siteDialog(); if (!stray) break;
        const cancel = [...stray.querySelectorAll('button')].filter(isVisible).find((b) => !PRIMARY_RE.test(String(b.className)));
        if (cancel) cancel.click();
        await sleep(400);
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const list = this.rows(); const r = list[list.length - 1];
        if (!r) return false;
        if (!r.trash) { log('⚠ 找不到快捷指令的垃圾桶按鈕'); return false; }
        r.trash.click();
        let ok = null;
        for (let t = 0; t < 25 && !ok; t++) {
          await sleep(140);
          if (this.rows().length < before) return true;
          ok = dialogConfirmButton();
        }
        if (!ok) continue;
        ok.click();
        for (let t = 0; t < 30; t++) { await sleep(140); if (this.rows().length < before) return true; }
        log('⚠ 刪除後條數沒有減少，已停止'); return false;
      }
      log('⚠ 刪除確認框一直沒出現，已停止'); return false;
    },
    async import(rows, opts, log) {
      if (detectTab() !== 'shortcut') { log('⚠ 現在不在「快捷指令」分頁，請先切過去再匯入'); return false; }
      if (!this.panel()) { log('⚠ 找不到快捷指令分頁（#lorebook-shortcut-panel），網站可能又改版了'); return false; }
      const existing = this.rows();
      const blankOnly = !opts.overwrite && existing.length === 1 && this.isBlank(existing[0]);
      if (blankOnly) opts = { ...opts, overwrite: true };
      const trRows = rows.filter((r) => Object.keys(r.tr || {}).length);
      const isNew = !Lore.loreId();
      const ask = blankOnly
        ? `現有的 1 條是空白卡片，會直接填進去，其餘 ${rows.length - 1} 條接在後面新增`
        : opts.overwrite
          ? `現有 ${existing.length} 條的前 ${Math.min(rows.length, existing.length)} 條會被改寫${rows.length > existing.length ? `，並在後面新增 ${rows.length - existing.length} 條` : ''}${existing.length > rows.length ? `，後面 ${existing.length - rows.length} 條會被刪除` : ''}`
          : `現有 ${existing.length} 條完全不動，照貼上順序在最後面加上 ${rows.length} 條`;
      const warn = [...LORE_WARN];
      if (trRows.length && !isNew) warn.unshift(`其中 ${trRows.length} 條帶翻譯：填完外層會先替你按一次網站「儲存」（翻譯只能填已儲存的指令），`, '再開「管理翻譯」逐語言勾「不參與翻譯」並填入；填完請再按一次「儲存」');
      if (trRows.length && isNew) warn.unshift('這本還沒儲存過：這次只填外層，翻譯請先按「儲存」後再匯入一次');
      const ok = await confirmBox({ title: opts.overwrite && !blankOnly ? '即將覆蓋匯入快捷指令' : '即將新增匯入快捷指令', body: ask, warn });
      if (!ok) { log('已取消，沒有動到任何東西'); return false; }
      let n = 0;
      if (opts.overwrite) {
        const hit = Math.min(rows.length, existing.length);
        for (let i = 0; i < hit; i++) {
          if (!document.contains(existing[i].name)) { log(`⚠ 第 ${i + 1} 條在寫入途中被換掉，已停止`); return true; }
          this.setRow(existing[i], rows[i], log, i + 1); n++; await sleep(60);
        }
        for (let i = hit; i < rows.length; i++) {
          const r = await this.addRow(log); if (!r) break;
          this.setRow(r, rows[i], log, i + 1); n++; await sleep(60);
        }
        const extra = existing.length - rows.length;
        if (extra > 0) {
          log(`刪除多出的 ${extra} 條…`);
          let d = 0;
          for (; d < extra; d++) if (!(await this.deleteLastRow(log))) break;
          log(d === extra ? `已刪除多出的 ${extra} 條舊快捷指令` : `⚠ 只刪掉 ${d}／${extra} 條，請手動處理剩下的`);
        }
        log(blankOnly ? `已新增 ${n} 條（第 1 條填進原本的空白卡片）` : `已覆蓋 ${n} 條`);
      } else {
        for (let i = 0; i < rows.length; i++) {
          const r = await this.addRow(log); if (!r) break;
          this.setRow(r, rows[i], log, i + 1); n++; await sleep(60);
        }
        log(`已新增 ${n} 條（現有 ${existing.length} 條沒動）`);
      }
      if (trRows.length && !isNew) await this.fillTranslations(trRows, log);
      return true;
    },
    async exportGrid(log) {
      if (!Lore.loreId()) { log('⚠ 這本還沒儲存過（網址還是 new），沒有可匯出的資料'); return []; }
      await Lore.fetchAll();
      if (!Array.isArray(this.saved)) { log('⚠ 讀不到快捷指令資料'); return []; }
      const list = [...this.saved].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const header = ['名稱', '說明', '提示詞'];
      SHORT_LANGS.forEach((l) => SHORT_FIELDS.forEach((f) => header.push(this.LANG_LABEL[l] + this.FIELD_LABEL[f])));
      const grid = [header];
      list.forEach((s) => {
        const row = [s.name || '', s.description || '', s.prompt || '']; const tr = s.details_translated || {};
        SHORT_LANGS.forEach((l) => SHORT_FIELDS.forEach((f) => row.push((tr[l] && tr[l][f]) || '')));
        grid.push(row);
      });
      log(`讀取 ${list.length} 條（含各語言譯文，以最後一次「儲存」的內容為準，畫面上未儲存的草稿不含在內）；第一列是標題`);
      return grid;
    },

    LANG_LABEL: { ko: '韓文', en: '英文', ja: '日文', 'zh-hans': '簡體中文', es: '西班牙文', fr: '法文', pt: '葡萄牙文', de: '德文', ar: '阿拉伯文', ru: '俄文' },
    FIELD_LABEL: { name: '名稱', description: '說明', prompt: '提示詞' },
    dialog() {
      return [...document.querySelectorAll('[role="dialog"]')]
        .filter((d) => !inPanel(d) && d.getAttribute('data-state') !== 'closed').filter(isVisible)
        .find((d) => d.querySelector('[role="tab"][id*="-tab-"]') || Trans.TITLE_RE.test(d.textContent || '')) || null;
    },
    langTab: (d, code) => d.querySelector(`[role="tab"][id$="-tab-${code}"]`),
    field: (d, uuid, f) => d.querySelector(`[id$="-shortcut-${uuid}-${f === 'prompt' ? 'source-prompt' : 'translated-' + f}"]`),
    async open(log) {
      let d = this.dialog(); if (d) return { dialog: d, opened: false };
      const b = this.manageBtn(); if (!b) { log('⚠ 找不到快捷指令的「管理翻譯」按鈕'); return { dialog: null, opened: false }; }
      b.click();
      for (let k = 0; k < 30 && !d; k++) { await sleep(120); d = this.dialog(); }
      if (!d) { log('⚠ 開啟管理翻譯失敗'); return { dialog: null, opened: false }; }
      await sleep(500); return { dialog: d, opened: true };
    },
    async waitSaved(names) {
      for (let t = 0; t < 25; t++) {
        await sleep(600);
        try { await Lore.fetchAll(); } catch (e) {  }
        const have = new Set((this.saved || []).map((s) => s.name));
        if (names.every((n) => have.has(n)) && (this.saved || []).length === this.rows().length) return true;
      }
      return false;
    },
    async fillTranslations(trRows, log) {
      const save = siteSaveButton();
      if (!save) { log('⚠ 找不到網站的「儲存」鈕，翻譯沒有填；請自己儲存後再匯入一次'); return false; }
      log('先按網站「儲存」登記指令…');
      save.click();
      const need = [...new Set(trRows.map((r) => r.name).filter(Boolean))];
      if (!(await this.waitSaved(need))) { log('⚠ 儲存後 API 一直沒看到全部指令（可能被網站擋下，例如超過字數上限），翻譯沒有填'); return false; }
      log('已儲存，開「管理翻譯」填譯文…');
      const { dialog: d, opened } = await this.open(log);
      if (!d) return false;
      if (!d.querySelector('[role="tab"][id*="-tab-"]')) { log('⚠ 管理翻譯視窗裡沒有語言頁籤，翻譯沒有填'); if (opened) Trans.close(d); return false; }
      const byName = new Map(); (this.saved || []).forEach((s) => { if (!byName.has(s.name)) byName.set(s.name, s.uuid); });
      const missing = new Set(); let total = 0, ticked = 0;
      for (const lang of SHORT_LANGS) {
        const todo = trRows.filter((r) => r.tr[lang]); if (!todo.length) continue;
        const tab = this.langTab(d, lang);
        if (!tab) { log(`⚠ 視窗裡沒有「${this.LANG_LABEL[lang]}」頁籤，略過 ${todo.length} 條`); continue; }
        tab.click(); await sleep(350);
        let n = 0;
        for (const r of todo) {
          const uuid = byName.get(r.name); if (!uuid) { missing.add(r.name); continue; }
          const anchor = this.field(d, uuid, 'name') || this.field(d, uuid, 'prompt');
          if (!anchor) { log(`⚠ ${this.LANG_LABEL[lang]}／${r.name}：視窗裡找不到這條`); continue; }
          const sec = anchor.closest('section') || anchor.parentElement.parentElement;
          const cb = sec && sec.querySelector('[role="checkbox"]');
          if (cb && cb.getAttribute('data-state') !== 'checked') { cb.click(); ticked++; await sleep(200); }
          for (const f of SHORT_FIELDS) {
            const v = r.tr[lang][f]; if (v == null) continue;
            const el = this.field(d, uuid, f);
            if (!el) { log(`⚠ ${this.LANG_LABEL[lang]}／${r.name}：找不到${this.FIELD_LABEL[f]}欄位`); continue; }
            if (el.readOnly) { log(`⚠ ${this.LANG_LABEL[lang]}／${r.name}：${this.FIELD_LABEL[f]}仍是唯讀，略過`); continue; }
            setReactValue(el, v); n++;
          }
        }
        total += n; log(`${this.LANG_LABEL[lang]}：填入 ${n} 格`);
      }
      const first = d.querySelector('[role="tab"]'); if (first) { first.click(); await sleep(200); }
      if (missing.size) log(`⚠ ${missing.size} 個名稱在已儲存的指令裡找不到：${[...missing].slice(0, 5).join('、')}${missing.size > 5 ? '…' : ''}`);
      log(`翻譯共填入 ${total} 格，勾了 ${ticked} 處「不參與翻譯」`);
      if (opened) Trans.close(d);
      log('⚠ 翻譯還是草稿，記得再按一次網站「儲存」。');
      return true;
    },
  };

  const Trans = {
    TITLE_RE: /管理翻譯|翻譯管理|管理翻译|번역 관리|Manage Translation|翻訳管理/i,
    dialog() {
      return [...document.querySelectorAll('[role="dialog"]')]
        .filter((d) => !inPanel(d) && d.getAttribute('data-state') !== 'closed')
        .filter(isVisible)
        .find((d) => this.TITLE_RE.test(d.textContent || '')) || null;
    },
    langTabs(d) {
      const map = new Map();
      [...d.querySelectorAll('button')].filter(isVisible).filter((b) => !b.closest(`#${BAR_ID}`)).forEach((b) => {
        const k = b.parentElement; if (!map.has(k)) map.set(k, []); map.get(k).push(b);
      });
      let best = [];
      for (const g of map.values()) if (g.length > best.length) best = g;
      return best.length >= 4 ? best : [];
    },
    typeTabs(d) { return [...d.querySelectorAll('button')].filter(isVisible).filter((b) => /border-b-2/.test(String(b.className))); },
    activeLang(d) { const b = this.langTabs(d).find((x) => /bg-white/.test(String(x.className))); return b ? (b.innerText || '').trim() : '目前語言'; },
    activeType(d) { const b = this.typeTabs(d).find((x) => /border-primary/.test(String(x.className))); return b ? (b.innerText || '').trim() : '目前分頁'; },
    rowNameOf(input, d) { let p = input.parentElement; for (let i = 0; i < 7 && p && p !== d; i++) { const t = [...p.querySelectorAll('span[title]')]; if (t.length === 1) return (t[0].getAttribute('title') || '').trim(); p = p.parentElement; } return null; },
    rows(d) {
      const ins = [...d.querySelectorAll('input')].filter(isVisible).filter((i) => !i.closest(`#${BAR_ID}`));
      return ins.map((i) => { const name = this.rowNameOf(i, d); return name ? { name, input: i } : null; }).filter(Boolean);
    },
    LANG_ALIASES: {
      ko: ['韓文', '韩文', '한국어', 'korean', '韓国語', 'ko', 'kr'],
      en: ['英文', '英语', '영어', 'english', '英語', 'en'],
      ja: ['日文', '日语', '일본어', 'japanese', '日本語', 'ja', 'jp'],
      'zh-hans': ['簡體中文', '简体中文', '중국어 간체', 'simplified chinese', '簡体字中国語', 'zh-hans', 'zh-cn', 'zh_cn'],
      'zh-hant': ['繁體中文', '繁体中文', '중국어 번체', 'traditional chinese', '繁体字中国語', 'zh-hant', 'zh-tw', 'zh_tw'],
      es: ['西班牙文', '西班牙语', '스페인어', 'spanish', 'スペイン語', 'es'],
      fr: ['法文', '法语', '프랑스어', 'french', 'フランス語', 'fr'],
      pt: ['葡萄牙文', '葡萄牙语', '포르투갈어', 'portuguese', 'ポルトガル語', 'pt'],
      de: ['德文', '德语', '독일어', 'german', 'ドイツ語', 'de'],
      ar: ['阿拉伯文', '阿拉伯语', '아랍어', 'arabic', 'アラビア語', 'ar'],
      ru: ['俄文', '俄语', '러시아어', 'russian', 'ロシア語', 'ru'],
    },
    langCode(label) {
      const s = String(label || '').trim().toLowerCase();
      if (!s) return null;
      for (const [code, names] of Object.entries(this.LANG_ALIASES)) if (names.includes(s)) return code;
      return null;
    },
    tabForHeader(d, cell) {
      const tabs = this.langTabs(d); const s = String(cell || '').trim();
      if (!s) return null;
      const exact = tabs.find((b) => (b.innerText || '').trim() === s); if (exact) return exact;
      const code = this.langCode(s); if (!code) return null;
      return tabs.find((b) => this.langCode((b.innerText || '').trim()) === code) || null;
    },
    activeTypeBtn(d) { return this.typeTabs(d).find((x) => /border-primary/.test(String(x.className))) || this.typeTabs(d)[0] || null; },
    async collectAllLanguages(d, log) {
      const langs = this.langTabs(d);
      if (!langs.length) { log('⚠ 找不到語言頁籤'); return null; }
      const startLang = langs.find((x) => /bg-white/.test(String(x.className))) || langs[0];
      const typeBtn = this.activeTypeBtn(d);
      const names = this.rows(d).map((r) => r.name);
      if (!names.length) { log('⚠ 這頁沒有可讀的欄位'); return null; }
      const table = new Map(names.map((n) => [n, []]));
      const labels = [];
      for (const b of langs) {
        await this.selectTab(b); await this.selectTab(typeBtn);
        labels.push((b.innerText || '').trim());
        const cur = new Map(this.rows(d).map((r) => [r.name, r.input.value || '']));
        for (const n of names) table.get(n).push(cur.has(n) ? cur.get(n) : '');
      }
      await this.selectTab(startLang); await this.selectTab(typeBtn);
      return { header: ['原文', ...labels], rows: names.map((n) => [n, ...table.get(n)]) };
    },
    async fillAllLanguagesFromGrid(d, grid, log) {
      if (!grid.length || grid[0].length < 2) { log('⚠ 至少要有「原文」加一個語言欄'); return; }
      const header = grid[0];
      const cols = []; const badHeader = [];
      for (let c = 1; c < header.length; c++) {
        const cell = String(header[c] || '').trim(); if (!cell) continue;
        const tab = this.tabForHeader(d, cell);
        if (tab) cols.push({ c, tab, label: (tab.innerText || '').trim() }); else badHeader.push(cell);
      }
      if (!cols.length) { log('⚠ 第一列要是語言標題列（例：原文 Tab 韓文 Tab 英文…），一個語言都對不到'); return; }
      const data = grid.slice(1).map((r) => ({ name: String(r[0] || '').trim(), cells: r })).filter((r) => r.name);
      const langs = this.langTabs(d);
      const startLang = langs.find((x) => /bg-white/.test(String(x.className))) || langs[0];
      const typeBtn = this.activeTypeBtn(d);
      const typeLabel = typeBtn ? (typeBtn.innerText || '').trim() : '目前分頁';
      const missing = new Set(); let total = 0;
      for (const col of cols) {
        await this.selectTab(col.tab); await this.selectTab(typeBtn);
        const map = new Map(); this.rows(d).forEach((r) => { if (!map.has(r.name)) map.set(r.name, r.input); });
        let n = 0;
        for (const r of data) {
          const v = r.cells[col.c]; if (v == null || String(v).trim() === '') continue;
          const input = map.get(r.name); if (!input) { missing.add(r.name); continue; }
          setReactValue(input, String(v)); n++;
        }
        total += n; log(`${col.label}／${typeLabel}：填 ${n} 筆`);
        await sleep(30);
      }
      await this.selectTab(startLang); await this.selectTab(typeBtn);
      log(`共 ${cols.length} 種語言、填入 ${total} 格（空白格沒動）`);
      if (badHeader.length) log(`⚠ ${badHeader.length} 個標題對不到語言，整欄略過：${badHeader.join('、')}`);
      if (missing.size) log(`⚠ ${missing.size} 個名稱對不到：${[...missing].slice(0, 5).join('、')}${missing.size > 5 ? '…' : ''}`);
      log('⚠ 記得按網站「儲存」才生效。');
    },

    manageBtn() { return [...document.querySelectorAll('button')].filter((b) => !inPanel(b) && isVisible(b)).find((b) => this.TITLE_RE.test((b.innerText || '').replace(/\s+/g, ' ').trim())) || null; },
    async open(log) {
      let d = this.dialog(); if (d) return { dialog: d, opened: false };
      const b = this.manageBtn(); if (!b) { log('⚠ 找不到「管理翻譯」按鈕，略過多語'); return { dialog: null, opened: false }; }
      b.click();
      for (let k = 0; k < 25 && !d; k++) { await sleep(120); d = this.dialog(); }
      if (!d) { log('⚠ 開啟管理翻譯失敗，略過多語'); return { dialog: null, opened: false }; }
      await sleep(400); return { dialog: d, opened: true };
    },
    close(d) { if (!d) return; const c = d.querySelector('button.absolute.top-5.right-5') || [...d.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Close' || b.querySelector('svg.lucide-x,svg[class*="lucide-x"]') || (b.querySelector('svg path')?.getAttribute('d') || '').startsWith('M18 6')); if (c) c.click(); },
    async fillAllFromPanel(names, log, logRaw) {
      log('補各語言的狀態值空白…約 25 秒');
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
    async selectTab(btn) { if (!btn) return false; btn.click(); await sleep(260); return true; },
    async fillAllLanguages(d, log) {
      const langs = this.langTabs(d);
      if (!langs.length) { log('⚠ 找不到語言頁籤，略過多語'); return; }
      let filled = 0, done = 0;
      for (const langBtn of langs) {
        const label = (langBtn.innerText || '').trim();
        await this.selectTab(langBtn);
        await this.selectTab(this.typeTabs(d)[0]);
        let n = 0;
        for (const r of this.rows(d)) {
          if ((r.input.value || '').trim()) continue;
          setReactValue(r.input, r.name); n++; await sleep(30);
        }
        filled += n; done++;
        log(`${label}：補 ${n} 筆`);
      }
      await this.selectTab(langs[0]);
      await this.selectTab(this.typeTabs(d)[0]);
      log(`共 ${done} 種語言、補上 ${filled} 筆空白（已翻好的沒動）`);
      log('⚠ 記得按網站「儲存」才生效。');
    },

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
            ['複製原文', '把原文（中文）列成一欄，方便丟去翻譯'],
            ['複製譯文', '把「當前語言分頁」目前已填的譯文列成一欄，方便備份或改動'],
            ['複製全部', '把目前分頁在<b>所有語言</b>的譯文做成表格：第一列＝「原文、各語言名稱」，之後每列＝原文與各語譯文<br>貼進試算表請 AI 補齊空格，再整張複製回來'],
            ['填入本頁', '貼一欄＝每行一個值、依畫面順序填；貼兩欄＝A 原文、B 譯文，依名稱對應<br>只動「當前語言分頁」'],
            ['填入全部', '貼「複製全部」那種表格：第一列是語言名稱，工具照名稱找到對應分頁一次全部填入<br>空白格不會動、沒填的語言不會動；語言欄順序隨意、缺幾個也可以'],
            ['⚠', '兩種填入都只寫進欄位，改完要按網站的「儲存」才生效'],
          ])}</div>
          <textarea id="cd-tl-text" placeholder="一欄＝依畫面順序　　兩欄＝原文 Tab 譯文　　表格＝第一列語言名稱" style="${FIELD('76px')}"></textarea>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button type="button" id="cd-tl-src" style="${BTN}flex:1;background:${C.btn};color:${C.btnInk};">複製原文</button>
            <button type="button" id="cd-tl-val" style="${BTN}flex:1;background:${C.btn};color:${C.btnInk};">複製譯文</button>
            <button type="button" id="cd-tl-all" style="${BTN}flex:1;background:${C.btn};color:${C.btnInk};">複製全部</button>
            <button type="button" id="cd-tl-clr" style="${BTN}background:${C.btn};color:${C.btnInk};">清空</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button type="button" id="cd-tl-fill" style="${BTN}flex:1;background:${C.primary};color:#fff;">填入本頁</button>
            <button type="button" id="cd-tl-fillall" style="${BTN}flex:1;background:${C.primaryOn};color:#fff;">填入全部</button>
          </div>
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
      const setBusy = (on) => ['#cd-tl-src', '#cd-tl-val', '#cd-tl-all', '#cd-tl-clr', '#cd-tl-fill', '#cd-tl-fillall'].forEach((id) => { const el = q(id); if (el) { el.disabled = on; el.style.opacity = on ? '.45' : ''; } });
      q('#cd-tl-all').onclick = async () => {
        clearLog(); setBusy(true); log('讀取各語言中…');
        try {
          const res = await this.collectAllLanguages(d, log);
          if (!res) return;
          const text = toTSV([res.header, ...res.rows]);
          q('#cd-tl-text').value = text;
          log(`已列出 ${this.activeType(d)}：${res.rows.length} 筆 × ${res.header.length - 1} 種語言（試算表格式）`);
          const ok = await Promise.race([copyToClipboard(text), new Promise((r) => setTimeout(() => r(false), 1500))]);
          log(ok ? '已複製到剪貼簿，可直接貼進 Google Sheet' : '⚠ 剪貼簿沒回應，請直接在框內 Ctrl+A → Ctrl+C');
        } catch (e) { log('✗ 讀取錯誤：' + e.message); } finally { setBusy(false); }
      };
      q('#cd-tl-fill').onclick = () => {
        clearLog();
        const raw = q('#cd-tl-text').value;
        if (!raw.trim()) { log('⚠ 請先貼上內容'); return; }
        try { this.fillCurrent(d, raw, log); } catch (e) { log('✗ 填入錯誤：' + e.message); }
      };
      q('#cd-tl-fillall').onclick = async () => {
        clearLog();
        const raw = q('#cd-tl-text').value;
        if (!raw.trim()) { log('⚠ 請先貼上內容'); return; }
        if (!/\t/.test(raw)) { log('⚠ 「填入全部」要貼表格（Tab 分欄，第一列是語言名稱）；一欄或兩欄請用「填入本頁」'); return; }
        setBusy(true); log('寫入各語言中…');
        try { await this.fillAllLanguagesFromGrid(d, parseDSV(raw.replace(/^﻿/, ''), '\t'), log); }
        catch (e) { log('✗ 填入錯誤：' + e.message); } finally { setBusy(false); }
      };
    },
  };

  const Dice = {
    API: '/api/dice-templates',
    NOTATIONS: ['1D6', '2D6', '3D6', '1D20', '1D100'],
    INTERVALS: [1, 2, 3, 5, 10, 20, 30, 50, 100],
    LIMITS: { title: 100, condition: 200, instructions: 200 },
    HEADERS: ['id', '名稱', '骰子類型', '觸發方式', '每隔N輪', '擲骰條件', '各結果指示', '公開'],
    ALIAS: {
      id: ['id', '編號'], title: ['名稱', '預設名稱', '標題', '骰子名稱', 'title'], notation: ['骰子類型', '類型', 'notation'],
      mode: ['觸發方式', '觸發', 'mode'], interval: ['每隔n輪', '每隔 n 輪', '回合', 'interval'],
      condition: ['擲骰條件', '條件', 'condition'], instructions: ['各結果指示', '結果指示', '指示', 'instructions'],
      is_public: ['公開', '是否公開', 'is_public', 'public'],
    },
    ZH: { title: '名稱', notation: '骰子類型', mode: '觸發方式', interval: '每隔N輪', condition: '擲骰條件', instructions: '各結果指示', is_public: '公開' },
    MODE_OUT: { condition: '條件判定', interval: '每隔N輪' },
    norm: (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n'),
    normNotation(s) { const t = String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase(); return /^D(?:6|20|100)$/.test(t) ? '1' + t : t; },
    modeIn(s) {
      const t = String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      if (['條件判定', '條件', '判定', 'condition'].includes(t)) return 'condition';
      if (['每隔n輪', '每隔n回合', '回合', 'n輪', '間隔', 'interval'].includes(t)) return 'interval';
      return null;
    },
    pubIn(s) {
      const t = String(s == null ? '' : s).trim().toLowerCase();
      if (['1', '是', '公開', 'true', 'y', 'yes'].includes(t)) return 1;
      if (['', '0', '否', '私人', 'false', 'n', 'no'].includes(t)) return 0;
      return null;
    },
    toInt(s) { const m = String(s == null ? '' : s).match(/-?\d+/); return m ? parseInt(m[0], 10) : null; },
    zodMsg(msg) {
      try { const arr = JSON.parse(msg); if (Array.isArray(arr)) return arr.map((e) => `${(e.path || []).join('.')}：${e.message}`).join('；'); } catch (_) {  }
      return String(msg).slice(0, 160);
    },
    WRITE_LIMIT: 5, WRITE_WINDOW: 60000, writeTimes: [],
    async throttle(method, log) {
      if (method !== 'POST' && method !== 'PUT') return;
      const now = Date.now();
      this.writeTimes = this.writeTimes.filter((x) => now - x < this.WRITE_WINDOW);
      if (this.writeTimes.length >= this.WRITE_LIMIT) {
        const wait = this.writeTimes[0] + this.WRITE_WINDOW + 1500 - now;
        if (wait > 0) { if (log) log(`網站每分鐘只收 ${this.WRITE_LIMIT} 次新增／更新，等 ${Math.ceil(wait / 1000)} 秒後繼續…`); await sleep(wait); }
        this.writeTimes = this.writeTimes.filter((x) => Date.now() - x < this.WRITE_WINDOW);
      }
      this.writeTimes.push(Date.now());
    },
    async api(method, path, body, log) {
      for (let attempt = 0; ; attempt++) {
        await this.throttle(method, log);
        const r = await fetch(this.API + path, { method, credentials: 'include', cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
        const txt = await r.text(); let data = null; try { data = JSON.parse(txt); } catch (_) {  }
        if (r.status === 429 && attempt < 3) {
          const ra = parseInt(r.headers.get('retry-after') || '60', 10) || 60;
          if (log) log(`網站說寫入太頻繁（429），等 ${ra} 秒後重試…`);
          await sleep((ra + 1) * 1000);
          this.writeTimes = []; continue;
        }
        if (!r.ok) {
          const e0 = data && data.errors && data.errors[0];
          const msg = e0 && e0.msg ? this.zodMsg(e0.msg) : (data && data.error && data.error.message) || (data && data.code) || txt.replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
          throw new Error(`${method} ${path || '/'} 回 ${r.status}：${msg}`);
        }
        return data;
      }
    },
    async fetchAll() { return ((await this.api('GET', '')) || {}).items || []; },
    row(it) { return [it.id, it.title, this.normNotation(it.config.notation), this.MODE_OUT[it.config.mode] || it.config.mode, it.config.interval, it.config.condition, it.config.instructions, it.is_public ? '是' : '否']; },
    async exportGrid(log) { const items = await this.fetchAll(); log(`讀到 ${items.length} 顆骰子`); return [this.HEADERS, ...items.map((it) => this.row(it))]; },
    headerMap(first) {
      const map = {};
      first.forEach((h, i) => { const s = String(h).trim().toLowerCase(); for (const k of Object.keys(this.ALIAS)) if (map[k] === undefined && this.ALIAS[k].some((a) => a.toLowerCase() === s)) map[k] = i; });
      return map;
    },
    draftsFromTsv(text) {
      const rows = parseDSV(text.replace(/^\uFEFF/, ''), '\t').filter((r) => r.some((x) => String(x).trim() !== ''));
      if (!rows.length) throw new Error('沒有內容');
      const map = this.headerMap(rows[0]);
      if (map.title === undefined) throw new Error('第一列要是欄位名稱列（含「名稱」）：從試算表複製時把標題列一起選進來');
      const need = ['notation', 'mode', 'instructions'].filter((k) => map[k] === undefined);
      if (need.length) throw new Error('欄位名稱列缺了：' + need.map((k) => this.ZH[k]).join('、'));
      const get = (r, k) => (map[k] === undefined || r[map[k]] == null ? '' : r[map[k]]);
      return rows.slice(1).map((r, i) => ({
        line: i + 2,
        id: map.id === undefined ? null : this.toInt(get(r, 'id')),
        title: String(get(r, 'title')).trim(),
        config: {
          notation: this.normNotation(get(r, 'notation')), mode: this.modeIn(get(r, 'mode')),
          interval: String(get(r, 'interval')).trim() === '' ? null : this.toInt(get(r, 'interval')),
          condition: this.norm(get(r, 'condition')), instructions: this.norm(get(r, 'instructions')),
        },
        is_public: map.is_public === undefined ? null : this.pubIn(get(r, 'is_public')),
        raw: { notation: get(r, 'notation'), mode: get(r, 'mode'), interval: get(r, 'interval'), is_public: get(r, 'is_public') },
      }));
    },
    draftsFromJson(text) {
      const j = JSON.parse(text); const items = Array.isArray(j) ? j : (j.items || []);
      if (!Array.isArray(items) || !items.length) throw new Error('JSON 裡沒有 items');
      return items.map((it, i) => {
        const c = it.config || {};
        return {
          line: i + 1, id: it.id == null ? null : this.toInt(it.id), title: String(it.title == null ? '' : it.title).trim(),
          config: {
            notation: this.normNotation(c.notation), mode: c.mode === 'interval' || c.mode === 'condition' ? c.mode : this.modeIn(c.mode),
            interval: c.interval == null ? null : this.toInt(c.interval), condition: this.norm(c.condition), instructions: this.norm(c.instructions),
          },
          is_public: it.is_public == null ? null : this.pubIn(it.is_public),
          raw: { notation: c.notation, mode: c.mode, interval: c.interval, is_public: it.is_public },
        };
      });
    },
    toDrafts(text) { return /^\s*[[{]/.test(text) ? this.draftsFromJson(text) : this.draftsFromTsv(text); },
    validate(d, target) {
      const e = [], c = d.config, L = this.LIMITS;
      if (!d.title) e.push('名稱不能空白'); else if (d.title.length > L.title) e.push(`名稱 ${d.title.length} 字，上限 ${L.title}`);
      if (!this.NOTATIONS.includes(c.notation)) e.push(`骰子類型「${d.raw.notation}」不對，只能是 ${this.NOTATIONS.join('／')}`);
      if (!c.mode) e.push(`觸發方式「${d.raw.mode}」不對，寫「條件判定」或「每隔N輪」`);
      if (c.interval == null) c.interval = target ? target.config.interval : 1;
      if (!this.INTERVALS.includes(c.interval)) e.push(`每隔N輪「${d.raw.interval}」不在選單裡，只能是 ${this.INTERVALS.join('／')}`);
      if (c.condition.length > L.condition) e.push(`擲骰條件 ${c.condition.length} 字，上限 ${L.condition}`);
      if (c.mode === 'condition' && !c.condition.trim()) e.push('條件判定一定要填擲骰條件');
      if (!c.instructions.trim()) e.push('各結果指示不能空白'); else if (c.instructions.length > L.instructions) e.push(`各結果指示 ${c.instructions.length} 字，上限 ${L.instructions}`);
      if (d.is_public === null) d.is_public = target ? (target.is_public ? 1 : 0) : 0;
      if (d.is_public !== 0 && d.is_public !== 1) e.push(`公開欄「${d.raw.is_public}」不對，寫「是」或「否」`);
      return e;
    },
    diffFields(d, t) {
      const out = [];
      if (d.title !== t.title) out.push('title');
      for (const k of ['notation', 'mode', 'interval', 'condition', 'instructions']) {
        const a = k === 'notation' ? this.normNotation(d.config[k]) : d.config[k];
        const b = k === 'notation' ? this.normNotation(t.config[k]) : (k === 'condition' || k === 'instructions') ? this.norm(t.config[k]) : t.config[k];
        if (a !== b) out.push(k);
      }
      if (d.is_public !== (t.is_public ? 1 : 0)) out.push('is_public');
      return out;
    },
    plan(drafts, existing) {
      const byId = new Map(existing.map((e) => [e.id, e]));
      const byTitle = new Map(); existing.forEach((e) => byTitle.set(e.title, (byTitle.get(e.title) || []).concat(e)));
      const used = new Set(), rows = [];
      for (const d of drafts) {
        let target = null, note = '';
        if (d.id != null) { target = byId.get(d.id) || null; if (!target) note = `找不到 id ${d.id}，當新增`; }
        else { const c = byTitle.get(d.title) || []; if (c.length === 1) { target = c[0]; note = '依名稱對到'; } else if (c.length > 1) note = 'DUP'; }
        const errs = this.validate(d, target);
        if (note === 'DUP') { errs.push('現有清單有兩顆同名骰子，請在 id 欄填 id'); note = ''; }
        if (target && used.has(target.id)) { errs.push(`id ${target.id} 在貼上內容出現兩次`); target = null; }
        if (target) used.add(target.id);
        let action, fields = [];
        if (errs.length) action = 'error';
        else if (target) { fields = this.diffFields(d, target); action = fields.length ? 'update' : 'same'; }
        else action = 'create';
        rows.push({ d, target, note, errs, action, fields });
      }
      for (const r of rows) {
        if (r.action === 'error' || !r.target || r.target.title === r.d.title) continue;
        const others = (byTitle.get(r.d.title) || []).filter((e) => e.id !== r.target.id);
        if (!others.length) continue;
        r.errs.push(`id ${r.target.id} 現在叫「${r.target.title}」，而「${r.d.title}」已經是 id ${others.map((e) => e.id).join('／')}：id 欄可能錯位，請核對後再貼`);
        r.action = 'error'; r.fields = [];
      }
      const leftover = existing.filter((e) => !used.has(e.id));
      const cnt = (k) => rows.filter((r) => r.action === k).length;
      const writes = cnt('create') + rows.filter((r) => r.action === 'update' && r.fields.some((f) => f !== 'is_public')).length;
      return { rows, leftover, existing, writes, counts: { create: cnt('create'), update: cnt('update'), same: cnt('same'), error: cnt('error'), leftover: leftover.length } };
    },
    async apply(p, opts, log) {
      const res = { created: [], updated: [], deleted: [], failed: [], reordered: false, finalIds: [] };
      const ids = [];
      for (const r of p.rows) {
        if (r.action === 'error') continue;
        const c = r.d.config;
        const body = { title: r.d.title, config: { notation: c.notation, mode: c.mode, interval: c.interval, condition: c.condition, instructions: c.instructions } };
        try {
          if (r.action === 'create') {
            const out = await this.api('POST', '', body, log); const it = (out && out.item) || out;
            if (!it || it.id == null) throw new Error('新增後沒拿到 id');
            r.newId = it.id; ids.push(it.id); res.created.push(r.d.title); log(`＋ 新增「${r.d.title}」→ id ${it.id}`);
            if (r.d.is_public) { await this.api('PATCH', `/${it.id}/share`, { is_public: 1 }, log); log('  設為公開'); }
          } else if (r.action === 'update') {
            ids.push(r.target.id);
            const cfg = r.fields.filter((f) => f !== 'is_public');
            if (cfg.length) { await this.api('PUT', `/${r.target.id}`, body, log); log(`✎ 更新「${r.d.title}」(id ${r.target.id})：${cfg.map((f) => this.ZH[f]).join('、')}`); }
            if (r.fields.includes('is_public')) { await this.api('PATCH', `/${r.target.id}/share`, { is_public: r.d.is_public }, log); log(`  公開 → ${r.d.is_public ? '是' : '否'}`); }
            res.updated.push(r.d.title);
          } else ids.push(r.target.id);
        } catch (e) { res.failed.push(`「${r.d.title}」${e.message}`); log('✗ ' + r.d.title + '：' + e.message); if (r.target) ids.push(r.target.id); }
        await sleep(300);
      }
      if (res.failed.length) { log(`⚠ 有 ${res.failed.length} 列沒寫成，這次不刪清單外、也不重排；修好後再按一次匯入`); res.finalIds = ids.concat(p.leftover.map((e) => e.id)); return res; }
      if (opts.deleteOthers) {
        for (const e of p.leftover) {
          try { await this.api('DELETE', `/${e.id}`, null, log); res.deleted.push(e.title); log(`－ 刪除「${e.title}」(id ${e.id})`); }
          catch (err) { res.failed.push(`刪除「${e.title}」${err.message}`); log('✗ 刪除失敗 ' + e.title + '：' + err.message); ids.push(e.id); }
          await sleep(200);
        }
      } else p.leftover.forEach((e) => ids.push(e.id));
      res.finalIds = ids;
      if (opts.reorder) {
        const cur = p.existing.map((e) => e.id);
        if (!res.created.length && !res.deleted.length && ids.join(',') === cur.join(',')) { log('順序沒變，不用重排'); return res; }
        for (let k = 0; k < 2; k++) {
          const now = (await this.fetchAll()).map((e) => e.id);
          const want = ids.filter((id) => now.includes(id)).concat(now.filter((id) => !ids.includes(id)));
          if (want.join(',') === now.join(',')) { log('順序已經跟貼上的一樣，不用重排'); res.finalIds = want; break; }
          try { await this.api('POST', '/reorder', { ids: want }, log); res.reordered = true; res.finalIds = want; log('↕ 已照貼上的順序排好（清單外的接在最後）'); break; }
          catch (e) { if (k === 0 && /409/.test(e.message)) { log('排序時清單變了，重抓再試一次…'); await sleep(800); continue; } throw e; }
        }
      }
      return res;
    },
    async verify(p, res, opts, log) {
      const items = await this.fetchAll(); const byId = new Map(items.map((e) => [e.id, e])); const bad = [];
      for (const r of p.rows) {
        if (r.action === 'error' || r.action === 'same') continue;
        const id = r.newId != null ? r.newId : r.target.id; const it = byId.get(id);
        if (!it) { bad.push(`「${r.d.title}」(id ${id}) 伺服器上找不到`); continue; }
        const f = this.diffFields(r.d, it); if (f.length) bad.push(`「${r.d.title}」(id ${id}) 不一致：${f.map((k) => this.ZH[k]).join('、')}`);
      }
      if (opts.deleteOthers) p.leftover.forEach((e) => { if (byId.has(e.id)) bad.push(`「${e.title}」(id ${e.id}) 還在，沒刪成`); });
      if (res.reordered) { const now = items.map((e) => e.id).join(','), want = res.finalIds.filter((id) => byId.has(id)).join(','); if (now !== want) bad.push('順序跟貼上的不一樣'); }
      const pending = items.filter((i) => i.outcome_compilation && ['pending', 'processing'].includes(i.outcome_compilation.status)).length;
      log(bad.length ? `✗ 回查有 ${bad.length} 項不一致` : '✓ 回查：伺服器上的內容跟貼上的一致');
      bad.forEach((b) => log('  ' + b));
      if (pending) log(`網站正在背景重新整理 ${pending} 顆骰子的結果判定（會自己跑完，不用等）`);
      return bad;
    },
  };

  function buildPanel(mode, tab) {
    if (document.getElementById(PANEL_ID)) return;
    const isShort = mode === 'lorebook' && tab === 'shortcut';
    const isLore = mode === 'lorebook' && !isShort;
    const isDice = mode === 'dice';
    const wrap = document.createElement('div');
    wrap.id = PANEL_ID; wrap.dataset.mode = mode; wrap.dataset.path = location.pathname; wrap.dataset.tab = tab || '';
    wrap.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:999999;display:flex;justify-content:flex-end;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;';
    const radio = (id, label, checked) => `<label style="display:flex;align-items:center;gap:5px;color:${C.ink};cursor:pointer;"><input type="radio" name="cd-lore-mode" id="${id}"${checked ? ' checked' : ''} style="accent-color:${C.primary};margin:0;"> ${label}</label>`;
    const check = (id, label, on = true) => `<label style="display:flex;align-items:center;gap:5px;color:${C.ink};cursor:pointer;"><input type="checkbox" id="${id}"${on ? ' checked' : ''} style="accent-color:${C.primary};margin:0;"> ${label}</label>`;
    const optionRow = isDice
      ? `<span style="color:${C.ink2};">選項</span>${check('cd-d-order', '套用貼上的順序')}${check('cd-d-del', '刪除清單外的骰子', false)}`
      : (isLore || isShort)
      ? `<span style="color:${C.ink2};">匯入</span>${radio('cd-append', '新增（不動現有）', true)}${radio('cd-over', '覆蓋現有', false)}`
      : `<span style="color:${C.ink2};">範圍</span>${check('cd-a', '狀態值(含多語)')}${check('cd-b', '文字')}`;
    const helpRows = isDice
      ? [
        ['貼上格式', '從 Google Sheet 複製整張表（含第一列欄位名稱）直接貼：id、名稱、骰子類型、觸發方式、每隔N輪、擲骰條件、各結果指示、公開<br>欄位順序不限、可以沒有 id 欄'],
        ['對應', '有 id 的列對 id 更新；沒 id 的先對名稱（同名唯一才對到），對不到就新增；內容沒變的列不會送出'],
        ['欄位', '骰子類型 1D6／2D6／3D6／1D20／1D100；觸發方式「條件判定」或「每隔N輪」；每隔N輪只能是 1／2／3／5／10／20／30／50／100，留空＝沿用原值；擲骰條件與各結果指示各 200 字（換行也算一字）；公開寫是／否，留空＝沿用原值'],
        ['預覽', '列出每一列要做什麼：新增／更新（哪幾欄變了）／不變／錯誤（哪裡不對）；有錯誤列整批不會跑'],
        ['套用貼上的順序', '照貼上的列序重排，貼上內容沒提到的骰子接在最後'],
        ['刪除清單外的骰子', '貼上內容沒提到的骰子會被刪掉，按匯入時會再確認一次；刪了救不回來'],
        ['匯出到剪貼簿', '把這頁所有骰子輸出成上述 8 欄的 TSV，第一列是欄位名稱，可直接貼進 Google Sheet'],
        ['速度', '網站每分鐘只收 5 次新增／更新（第 6 次起會被擋 60 秒），工具會自己等；一次改很多顆就要等幾分鐘，中途別關頁面'],
        ['⚠', '這頁沒有儲存鈕，匯入直接寫進網站；存完網站會在背景重新編譯結果判定（幾十秒），列表要重新整理才看得到<br>有任何一列沒寫成，這次就不刪清單外、不重排，修好再匯入一次'],
      ]
      : isShort
      ? [
        ['貼上格式', '從 Google Sheet 複製貼上（Tab 分欄）：A 名稱、B 說明、C 提示詞，之後照介面語言順序每種語言三欄（名稱、說明、提示詞）：韓、英、日、簡中、西、法、葡、德、阿、俄，共 33 欄<br>只貼前三欄也可以；第一列是標題會自動跳過；純文字則空行分組、第一行名稱、其餘是提示詞'],
        ['空白格', '留空＝不動網頁上現有的值（新卡片就是留白）'],
        ['新增（不動現有）', '現有快捷指令完全不碰，新的照貼上順序加在最後面（整本只有一條空白卡片時會直接填進去）'],
        ['覆蓋現有', '整份取代：從第一條往下覆蓋；貼的比現有多會自動新增，比現有少時多出來的舊條目會被刪除'],
        ['翻譯', '有翻譯欄的列：填完外層後會先替你按一次網站「儲存」（翻譯只能填已儲存的指令），再自動開「管理翻譯」，每種語言先勾「不參與翻譯」再填名稱／說明／提示詞，填完關窗<br>這本還沒儲存過（網址是 new）時只填外層，翻譯請儲存後再匯入一次'],
        ['匯出到剪貼簿', '讀「最後一次儲存」的內容輸出全部 33 欄（含各語言譯文，沒有的留白），第一列是標題，可直接貼進 Google Sheet'],
        ['上限', '名稱 20 字、提示詞 400 字、說明 30 字；超過網站會拒絕儲存'],
        ['⚠', '匯入後請檢查再按網站的「儲存」；帶翻譯的匯入中途會自動儲存一次，最後那次仍要自己按'],
      ]
      : isLore
      ? [
        ['貼上格式', '從 Google Sheet 複製 A、B 兩欄直接貼（A＝關鍵字、B＝內容）<br>多個關鍵字用「,」或「|」分隔（關鍵字本身可含空格）；也吃純文字空行分組'],
        ['新增（不動現有）', '現有項目完全不碰，新項目照貼上順序加在清單最後面'],
        ['覆蓋現有', '整份取代：從第一列往下覆蓋（先清掉該列關鍵字再重加）<br>貼的比現有多會自動新增；比現有少時，多出來的舊項目會被刪除'],
        ['排序', '拖曳調整後按「套用順序」。列前編號＝原本的位置，拖曳後不變，套用並儲存後才重排<br>以「已儲存」的內容為準——畫面有未儲存變更會先請你儲存'],
        ['匯出到剪貼簿', '讀「最後一次儲存」的內容輸出成兩欄 TSV，關鍵字之間用「,」分隔<br>畫面上還沒儲存的草稿不會被匯出'],
        ['編號', '頁面上每個項目左上角的綠色號碼是本工具加的流水號，純顯示、不會存進網站'],
        ['上限', '每項關鍵字最多 50 個、每個 20 字；內容 400 字'],
        ['⚠', '匯入後只是草稿——檢查沒問題要自己按網站的「儲存」才生效；不滿意直接重載頁面就能整份丟棄'],
      ]
      : [
        ['貼上格式', '從 Google Sheet 複製 A、B 兩欄直接貼（A＝狀態值、B＝文字）<br>也吃純文字空行分組，或貼 HTML 抓 {{變數}}'],
        ['狀態值(含多語)', '寫入狀態值欄位，並自動開「管理翻譯」，把各語言的狀態值空白補上原文（已翻好的不動）。約 25 秒。'],
        ['文字', '寫入指令'],
        ['匯入', '從第一列開始全部覆蓋<br>列數不夠自動新增，多出來的自動刪掉'],
        ['匯出到剪貼簿', '把現有欄位輸出成兩欄，可直接貼回 Google Sheet'],
        ['⚠', '改完要按網站的「儲存」才生效；按之前可以重載丟棄'],
      ];
    wrap.innerHTML = `
      <div id="cd-card" style="width:360px;background:${C.bg};color:${C.ink};border:1px solid ${C.line};border-radius:12px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.3);">
        <div id="cd-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;background:${C.head};border-bottom:1px solid ${C.line};cursor:move;user-select:none;">
          <span style="display:flex;align-items:center;gap:6px;"><b style="font-size:13.5px;">${isDice ? '骰子 匯入匯出' : isShort ? '快捷指令 匯入匯出' : isLore ? 'Lorebook 匯入匯出' : '小工具匯入匯出'} (.TSV)</b>${infoBtn('cd-info')}</span>
          <button type="button" id="cd-min" title="收合" style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid ${C.line};background:${C.field};color:${C.ink2};border-radius:7px;cursor:pointer;">${ICON_FOLD}</button>
        </div>
        <div id="cd-body" style="padding:12px 14px 14px;">
          <div id="cd-help" style="display:none;">${helpBox(helpRows)}</div>
          <div id="cd-main">
            ${(isLore || isShort) ? `<div id="cd-stat" style="display:none;margin:0 0 8px;color:${C.ink2};font-size:12.5px;"></div>` : ''}
            <textarea id="cd-text" placeholder="${isDice ? 'id　名稱　骰子類型　觸發方式　每隔N輪　擲骰條件　各結果指示　公開（第一列是欄位名稱）' : isShort ? '名稱　　提示詞　　說明（Tab 分欄）' : isLore ? '關鍵字1,關鍵字2　　內容（Tab 分欄）' : '狀態值　　文字（Tab 分欄）'}" style="${FIELD('150px')}"></textarea>
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
      <button type="button" id="cd-orb" title="展開" style="display:none;align-items:center;justify-content:center;width:46px;height:46px;padding:0;border:1px solid ${C.line};background:${C.bg};color:${C.primary};border-radius:50%;box-shadow:0 8px 20px rgba(0,0,0,.3);cursor:pointer;">${isDice ? ICON_DICE : ICON_ORB}</button>`;
    document.body.appendChild(wrap);

    const $ = (s) => wrap.querySelector(s);
    const logBox = $('#cd-log');
    const logRaw = (html) => { logBox.style.display = 'block'; logBox.insertAdjacentHTML('beforeend', (logBox.innerHTML ? '<br>' : '') + html); logBox.scrollTop = logBox.scrollHeight; };
    const log = (m) => logRaw(esc(m));
    const done = (m) => logRaw(`<b style="color:${C.doneRed};">${esc(m)}</b>`);
    const clearLog = () => { logBox.innerHTML = ''; logBox.style.display = 'none'; };
    const overwrite = () => (isLore || isShort) && $('#cd-over').checked;
    const setBusy = (on) => {
      ['#cd-prev', '#cd-run', '#cd-clear', '#cd-export', '#cd-sort', '#cd-sort-apply'].forEach((id) => {
        const el = $(id); if (!el) return;
        el.disabled = on;
        el.style.opacity = on ? '.45' : '';
        el.style.cursor = on ? 'progress' : 'pointer';
      });
    };

    let dicePreview = null, diceRun = null;
    if (isDice) {
      const TAG = { create: ['新增', C.hlGreen], update: ['更新', C.primary], same: ['不變', C.ink2], error: ['錯誤', C.doneRed] };
      const tag = (k) => `<span style="display:inline-block;min-width:30px;text-align:center;padding:0 5px;border-radius:999px;background:${TAG[k][1]};color:#fff;font:600 11.5px/1.6 system-ui,sans-serif;">${TAG[k][0]}</span>`;
      const makePlan = async () => {
        const t = $('#cd-text').value; if (!t.trim()) throw new Error('文字框是空的');
        const drafts = Dice.toDrafts(t); const existing = await Dice.fetchAll();
        return Dice.plan(drafts, existing);
      };
      const showPlan = (p) => {
        const c = p.counts;
        logRaw(`<b>新增 ${c.create}、更新 ${c.update}、不變 ${c.same}、錯誤 ${c.error}；清單外 ${c.leftover}</b>`);
        p.rows.forEach((r) => {
          const det = r.action === 'update' ? `：${r.fields.map((f) => Dice.ZH[f]).join('、')}` : '';
          logRaw(`${tag(r.action)} ${esc(r.d.title || `（第 ${r.d.line} 列沒名稱）`)}${r.target ? ` <span style="color:${C.ink2};">id ${r.target.id}</span>` : ''}${esc(det)}${r.note ? ` <span style="color:${C.danger};">${esc(r.note)}</span>` : ''}`);
          r.errs.forEach((e) => logRaw(`<span style="color:${C.doneRed};">　　${esc(e)}</span>`));
        });
        if (p.leftover.length) log(`清單外（貼上內容沒提到）：${p.leftover.map((e) => e.title).join('、')}`);
      };
      const orderSame = (p) => !p.counts.create && p.rows.filter((r) => r.target).map((r) => r.target.id).concat(p.leftover.map((e) => e.id)).join(',') === p.existing.map((e) => e.id).join(',');
      dicePreview = async () => {
        log('讀取中…'); const p = await makePlan(); clearLog(); showPlan(p);
        if (p.counts.error) done(`有 ${p.counts.error} 列錯誤，修好再匯入`);
        else if (!p.counts.create && !p.counts.update && orderSame(p)) log('內容都一樣，沒東西要改' + (p.leftover.length ? '（要刪清單外的請勾選後按匯入）' : ''));
        else log('確認無誤就按「匯入」');
      };
      diceRun = async () => {
        log('讀取中…'); const p = await makePlan(); clearLog(); showPlan(p);
        if (p.counts.error) { done(`有 ${p.counts.error} 列錯誤，修好再匯入`); return; }
        const opts = { reorder: $('#cd-d-order').checked, deleteOthers: $('#cd-d-del').checked && p.leftover.length > 0 };
        const reorderNeeded = opts.reorder && !orderSame(p);
        if (!p.counts.create && !p.counts.update && !opts.deleteOthers && !reorderNeeded) { log('內容都一樣，沒東西要改'); return; }
        const body = [`新增 ${p.counts.create} 顆、更新 ${p.counts.update} 顆${reorderNeeded ? '、套用貼上的順序' : ''}`];
        const mins = Math.max(0, Math.ceil(p.writes / Dice.WRITE_LIMIT) - 1);
        if (mins) body.push(`網站每分鐘只收 ${Dice.WRITE_LIMIT} 次新增／更新，這批 ${p.writes} 次約要等 ${mins} 分鐘，中途別關頁面`);
        if (opts.deleteOthers) body.push(`刪除清單外 ${p.leftover.length} 顆：${p.leftover.map((e) => e.title).join('、')}`);
        const ok = await confirmBox({
          title: opts.deleteOthers ? '即將寫入並刪除骰子' : '即將寫入骰子', body: body.join('\n'),
          warn: ['這頁沒有儲存鈕，寫入直接生效' + (opts.deleteOthers ? '，刪了救不回來' : ''), '確定要繼續嗎？'],
        });
        if (!ok) { log('已取消'); return; }
        const res = await Dice.apply(p, opts, log);
        const bad = await Dice.verify(p, res, opts, log);
        done((res.failed.length || bad.length) ? '完成，但有問題（見上方）' : `完成：新增 ${res.created.length}、更新 ${res.updated.length}、刪除 ${res.deleted.length}`);
        logRaw(`<button type="button" id="cd-reload" style="${BTN}margin-top:4px;background:${C.btn};color:${C.btnInk};">重新整理頁面看結果</button>`);
        $('#cd-reload').onclick = () => location.reload();
      };
    }

    if (isShort) {
      const syncRun = () => { const run = $('#cd-run'), on = overwrite(); run.style.background = on ? C.danger : C.primary; run.textContent = on ? '覆蓋匯入' : '新增匯入'; };
      $('#cd-append').onchange = syncRun; $('#cd-over').onchange = syncRun; syncRun();
      (async () => { try { await Lore.fetchAll(); } catch (e) {  } })();
    }
    if (isLore) {
      const syncRun = () => {
        const run = $('#cd-run'), on = overwrite();
        run.style.background = on ? C.danger : C.primary;
        run.textContent = on ? '覆蓋匯入' : '新增匯入';
      };
      $('#cd-append').onchange = syncRun; $('#cd-over').onchange = syncRun; syncRun();
      (async () => { try { await Lore.fetchAll(); } catch (e) {  } })();

      const box = $('#cd-sortbox'), list = $('#cd-sortlist'), main = $('#cd-main');
      let sortRows = [];
      const renderList = () => {
        list.innerHTML = sortRows.map((r) =>
          `<li draggable="true" data-i="${r.orig}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid ${C.line};background:${C.field};cursor:grab;font-size:12.5px;">
             <span class="cd-sn" style="flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 6px;border-radius:999px;background:${C.primary};color:#fff;font:700 12px/1 system-ui,sans-serif;">${r.orig + 1}</span>
             <span style="display:flex;color:${C.ink2};">${ICON_GRIP}</span>
             <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.kws.join(',') || '（無關鍵字）')}</span></li>`).join('');
      };
      $('#cd-sort').onclick = async () => {
        clearLog(); setBusy(true); log('讀取中…');
        try {
          const res = await Lore.fetchAll();
          if (!res || res.total == null) { log('⚠ 讀不到已儲存的資料'); return; }
          const es = Lore.entries();
          const same = es.length === res.items.length
            && es.every((e, i) => (Lore.contentArea(e)?.value || '') === ((res.items[i].data || {}).content || ''));
          if (!same) { log('⚠ 畫面上有未儲存的變更。排序以「已儲存」內容為準，請先按網站「儲存」（或重載頁面）再排序。'); return; }
          sortRows = res.items.map((it, i) => {
            const d = it.data || {};
            const kws = Array.isArray(d.keywords) && d.keywords.length ? d.keywords : String(d.keyword || '').split('|').filter(Boolean);
            return { kws, content: d.content || '', orig: i };
          });
          if (!sortRows.length) { log('⚠ 這本還沒有已儲存的項目'); return; }
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
        const order = [...list.children].map((li) => sortRows.find((r) => r.orig === Number(li.dataset.i)));
        const changed = order.filter((r, i) => r.orig !== i).length;
        if (!changed) { log('順序沒有變，不用套用'); return; }
        const ok = await confirmBox({
          title: '即將套用新順序',
          body: `會把 ${order.length} 列的內容重寫回固定位置（實際需改寫 ${changed} 列）`,
          warn: LORE_WARN,
        });
        if (!ok) { log('已取消'); return; }
        clearLog(); setBusy(true); log('寫入中…');
        try {
          const es = Lore.entries();
          if (es.length !== order.length) { log('⚠ 畫面列數變了，已停止'); return; }
          let n = 0;
          for (let i = 0; i < order.length; i++) {
            if (order[i].orig === i) continue;
            if (!document.contains(es[i])) { log(`⚠ 第 ${i + 1} 列在寫入途中被換掉，已停止`); break; }
            await Lore.setEntry(es[i], { kws: order[i].kws, b: order[i].content }, log, i + 1); n++;
          }
          log(`已套用新順序（改寫 ${n} 列）`);
          done('排序完成——請檢查後按網站的「儲存」；儲存前重載頁面可整份丟棄');
        } catch (e) { log('✗ 排序錯誤：' + e.message); }
        finally { setBusy(false); box.style.display = 'none'; main.style.display = 'block'; }
      };
    }

    const clearBtn = $('#cd-clear');
    if (clearBtn) clearBtn.onclick = () => { $('#cd-text').value = ''; clearLog(); };
    $('#cd-prev').onclick = async () => {
      clearLog();
      if (isDice) { setBusy(true); try { await dicePreview(); } catch (e) { log('✗ ' + e.message); } finally { setBusy(false); } return; }
      if (isShort) {
        const rows = parseShortRows($('#cd-text').value);
        const trCells = rows.reduce((a, r) => a + Object.values(r.tr).reduce((b, t) => b + Object.keys(t).length, 0), 0);
        log(`預覽：${rows.length} 條（名稱｜說明｜提示詞）${trCells ? `，含 ${trCells} 格翻譯` : ''}`);
        rows.slice(0, 10).forEach((r, i) => {
          const langs = Object.keys(r.tr).map((l) => Short.LANG_LABEL[l]).join(',');
          log(`${i + 1}. [${r.name}] ${(r.description || '').slice(0, 12)}｜${(r.prompt || '').replace(/\n/g, ' ').slice(0, 20)}${langs ? `｜翻譯:${langs}` : ''}`);
        });
        if (rows.length > 10) log(`…還有 ${rows.length - 10} 條`);
        return;
      }
      const { rows, mode: pm } = parseRows($('#cd-text').value, !isLore);
      log(`預覽：${rows.length} 列（來源：${pm === 'tsv' ? '試算表' : pm === 'html' ? 'HTML {{}}' : pm === 'blocks' ? '純文字' : '空'}）`);
      rows.slice(0, 10).forEach((r, i) => { const a = isLore ? splitKeywords(r.a).join(',') : r.a; log(`${i + 1}. [${a}] ${(r.b || '').replace(/\n/g, ' ').slice(0, 28)}`); });
      if (rows.length > 10) log(`…還有 ${rows.length - 10} 列`);
    };
    $('#cd-run').onclick = async () => {
      clearLog(); setBusy(true);
      try {
        if (isDice) { await diceRun(); return; }
        if (isShort) {
          const rows = parseShortRows($('#cd-text').value);
          if (!rows.length) { log('⚠ 沒有解析到任何列'); return; }
          if (await Short.import(rows, { overwrite: overwrite() }, log)) done('匯入完成——請檢查後按網站的「儲存」；儲存前重載頁面可整份丟棄');
          return;
        }
        const { rows } = parseRows($('#cd-text').value, !isLore);
        if (!rows.length) { log('⚠ 沒有解析到任何列'); return; }
        if (isLore) { if (await Lore.import(rows, { overwrite: overwrite() }, log)) done('匯入完成——請檢查後按網站的「儲存」；儲存前重載頁面可整份丟棄'); }
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
        if (isLore) grid = await Lore.exportGrid(log);
        else if (isShort) grid = await Short.exportGrid(log);
        else if (isDice) grid = await Dice.exportGrid(log);
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

  let statTick = 0;
  setInterval(() => {
    if (!document.body) return;
    const mode = detectMode();
    const tab = mode === 'lorebook' ? detectTab() : '';
    const panel = document.getElementById(PANEL_ID);
    const stale = panel && (panel.dataset.mode !== mode || panel.dataset.path !== location.pathname || (panel.dataset.tab || '') !== tab);
    if (mode) {
      if (!panel) buildPanel(mode, tab);
      else if (stale) {
        const keep = panel.dataset.path === location.pathname ? { text: panel.querySelector('#cd-text')?.value || '', open: panel.querySelector('#cd-card')?.style.display !== 'none' } : null;
        panel.remove(); buildPanel(mode, tab);
        const p = document.getElementById(PANEL_ID);
        if (keep && p) { const t = p.querySelector('#cd-text'); if (t) t.value = keep.text; if (keep.open) p.querySelector('#cd-orb').click(); }
      }
    }
    else if (panel) panel.remove();
    if (mode === 'widget') { const d = Trans.dialog(); if (d) Trans.injectBar(d); }
    if (mode === 'lorebook') {
      Lore.ensureNumberStyle();
      Lore.tickSaving();
      const txt = tab === 'shortcut'
        ? `快捷指令：畫面 ${Short.rows().length} 條${Array.isArray(Short.saved) ? `｜已儲存 ${Short.saved.length} 條` : ''}`
        : Lore.statText();
      const p2 = document.getElementById(PANEL_ID);
      const stat = p2 && p2.querySelector('#cd-stat');
      if (stat) {
        const t = tab === 'shortcut' ? txt : `項目統計：${txt}`;
        if (stat.textContent !== t) stat.textContent = t;
        stat.style.display = 'block';
      }
      Lore.ensurePageStat(txt);
      if (!Lore.savingSince && (statTick = (statTick + 1) % 12) === 0) Lore.fetchAll().catch(() => {});
    }
  }, 800);
  document.addEventListener('click', (e) => {
    if (detectMode() !== 'lorebook') return;
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || inPanel(b) || b.closest('.lorebook-entry') || b.closest('[role="dialog"],[role="alertdialog"]')) return;
    if (!PRIMARY_RE.test(String(b.className))) return;
    if (Lore.savedCount != null && Lore.entries().length === Lore.savedCount) return;
    Lore.savingSince = Date.now(); Lore.savingPollTick = 0;
  }, true);
})();
