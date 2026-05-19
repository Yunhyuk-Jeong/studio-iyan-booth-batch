// ==UserScript==
// @name         Booth Price & Tag Batch
// @namespace    https://studio.iyan-kim.dev/
// @version      2.2.1
// @description  Booth 가격 일괄 변경 + 태그 교체 + 옵션별 Digital Files 교체 적용
// @match        https://manage.booth.pm/items/*/edit
// @run-at       document-idle
// @grant        none
// @downloadURL  https://studio-iyan-booth-batch.pages.dev/booth-batch.user.js
// @updateURL    https://studio-iyan-booth-batch.pages.dev/booth-batch.user.js
// ==/UserScript==

(function () {
	'use strict';

	/***** Config *****/
	const PRICE_INPUT_SELECTOR = 'input.charcoal-text-field-input[inputmode="numeric"][maxlength="10"]';

	// ✅ 태그 입력: 구버전(Booth) + 신버전(react-autowhatever/autosuggest) 모두 대응
	const TAG_INPUT_SELECTOR = [
		'input.js-item-tags-array', // old
		'input[aria-autocomplete="list"][aria-controls^="react-autowhatever-"]', // new (most reliable)
		'input[aria-autocomplete="list"][aria-controls*="react-autowhatever"]',
		'input[role="combobox"][aria-autocomplete="list"]',
		'input[placeholder="add Tag"]',
		'input[placeholder*="tag" i]',
	].join(',');

	const LABEL_TEXT_ALLOW = /price|価格|가격/i;

	// 태그 칩 삭제(X) - 구버전
	const TAG_SECTION_SELECTOR = '#item_tag';
	const TAG_REMOVE_ICON_SELECTOR = `${TAG_SECTION_SELECTOR} pixiv-icon[name="32/BoothClose"]`;

	// 옵션명(Variation Name)
	const VAR_NAME_INPUT_SELECTOR = 'div[id^="variationName-"] input.charcoal-text-field-input';

	/***** Utilities *****/
	const $ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
	const el = (tag, props = {}, children = []) => {
		const e = document.createElement(tag);
		Object.assign(e, props);
		for (const c of [].concat(children ?? [])) e.append(c);
		return e;
	};
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	// native setter (React 대응)
	const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

	const isVisible = (node) => {
		if (!node) return false;
		const r = node.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	};

	const isExcludedPrice = (inp) => inp.name === 'purchaseLimit' || !!inp.closest('#purchaseLimit');

	const labelTextOf = (inp) => {
		const id = inp.getAttribute('aria-labelledby');
		if (!id) return '';
		const lab = document.getElementById(id);
		return ((lab && lab.textContent) || '').trim();
	};

	const isPriceField = (inp) => {
		const t = labelTextOf(inp);
		if (!t) return true;
		return LABEL_TEXT_ALLOW.test(t);
	};

	function normalizeTagsCommaOnly(s) {
		return Array.from(
			new Set(
				String(s ?? '')
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
			),
		);
	}

	const roundToUnit = (n, unit) => (!unit || unit <= 1 ? Math.round(n) : Math.round(n / unit) * unit);

	function norm(s) {
		return String(s ?? '')
			.toLowerCase()
			.replace(/\s+/g, ' ')
			.trim();
	}
	function normLoose(s) {
		return String(s ?? '')
			.toLowerCase()
			.replace(/[\s_\-]+/g, '')
			.trim();
	}

	async function waitFor(fn, { timeout = 9000, interval = 80 } = {}) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeout) {
			const v = fn();
			if (v) return v;
			await sleep(interval);
		}
		return null;
	}

	function extractLatinTokens(variationName) {
		const s = String(variationName ?? '');
		const raw = s.match(/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g) || [];
		const tokens = raw
			.map((t) => t.trim())
			.filter((t) => t.length >= 3)
			.filter((t) => /[A-Za-z]/.test(t));

		const seen = new Set();
		const out = [];
		for (const t of tokens) {
			const k = t.toLowerCase();
			if (seen.has(k)) continue;
			seen.add(k);
			out.push(k);
		}
		return out;
	}

	function isFullPackVariation(variationName) {
		const s = String(variationName ?? '').toLowerCase();
		const latin = (s.match(/[a-z0-9]+/g) || []).join('');
		return latin.startsWith('fullpack');
	}

	function isActuallyClickable(elm) {
		if (!elm || elm === document.body || elm === document.documentElement) return false;
		const cs = getComputedStyle(elm);
		if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
		const r = elm.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		return true;
	}

	function clickAtCenter(elm) {
		if (!elm) return false;
		try {
			elm.scrollIntoView({ block: 'center', inline: 'nearest' });
		} catch {}
		const r = elm.getBoundingClientRect();
		const cx = Math.floor(r.left + r.width * 0.5);
		const cy = Math.floor(r.top + r.height * 0.5);
		const target = document.elementFromPoint(cx, cy) || elm;
		try {
			target.focus?.();
		} catch {}
		try {
			target.click();
		} catch {
			return false;
		}
		return true;
	}

	function clickCheckboxInputOnce(inputEl) {
		if (!inputEl) return false;
		try {
			inputEl.scrollIntoView({ block: 'center', inline: 'nearest' });
		} catch {}

		const r = inputEl.getBoundingClientRect();
		const cx = Math.floor(r.left + Math.max(2, r.width * 0.5));
		const cy = Math.floor(r.top + Math.max(2, r.height * 0.5));

		const fire = (type, Ctor, extra = {}) => {
			try {
				const ev = new Ctor(type, {
					bubbles: true,
					cancelable: true,
					composed: true,
					view: window,
					clientX: cx,
					clientY: cy,
					button: 0,
					buttons: 1,
					...extra,
				});
				inputEl.dispatchEvent(ev);
			} catch {}
		};

		try {
			inputEl.focus?.();
		} catch {}

		fire('pointerdown', PointerEvent, { pointerType: 'mouse', isPrimary: true });
		fire('mousedown', MouseEvent);
		fire('pointerup', PointerEvent, { pointerType: 'mouse', isPrimary: true, buttons: 0 });
		fire('mouseup', MouseEvent, { buttons: 0 });
		fire('click', MouseEvent, { buttons: 0 });

		return true;
	}

	function findByTextAndClimbClickable(root, re) {
		const all = Array.from(root.querySelectorAll('*'))
			.filter(isVisible)
			.filter((n) => re.test((n.textContent || '').trim()));

		if (!all.length) return null;

		const innermost =
			all.find((n) => {
				const kids = Array.from(n.querySelectorAll('*'));
				return !kids.some((k) => re.test((k.textContent || '').trim()));
			}) || all[0];

		let elm = innermost;
		for (let i = 0; i < 18 && elm; i++) {
			const tag = elm.tagName?.toLowerCase();
			const role = elm.getAttribute?.('role') || '';
			const tab = elm.getAttribute?.('tabindex');

			const looksClickable = tag === 'button' || tag === 'a' || role === 'button' || tab !== null || typeof elm.onclick === 'function';

			if (looksClickable && isActuallyClickable(elm)) return elm;

			if (isActuallyClickable(elm) && (elm.className || '').toString().match(/button|btn|action|click/i)) {
				return elm;
			}

			elm = elm.parentElement;
		}

		return isActuallyClickable(innermost) ? innermost : null;
	}

	async function typeInto(elm, text) {
		const s = String(text);
		elm.focus();
		try {
			elm.setSelectionRange(0, (elm.value || '').length);
		} catch {}
		inputSetter?.call(elm, '');
		elm.dispatchEvent(new InputEvent('input', { bubbles: true }));
		for (const ch of s) {
			inputSetter?.call(elm, (elm.value || '') + ch);
			elm.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
			await sleep(2);
		}
		elm.dispatchEvent(new Event('change', { bubbles: true }));
		elm.blur();
	}

	// ✅ key dispatch helper (autosuggest 대응)
	function fireKey(elm, key, code, keyCode) {
		const base = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
		elm.dispatchEvent(new KeyboardEvent('keydown', base));
		elm.dispatchEvent(new KeyboardEvent('keypress', base));
		elm.dispatchEvent(new KeyboardEvent('keyup', base));
	}

	// ✅ 핵심: "추천어 선택"을 막고, 입력한 텍스트 그대로 태그로 확정
	// - 많은 autosuggest가 Enter를 누르면 "하이라이트된 추천"을 넣어버림
	// - 따라서 Escape로 목록/선택을 먼저 해제 -> Enter로 커밋
	async function typeTagAndEnterRaw(elm, text) {
		if (!elm || !inputSetter) return;

		elm.focus();
		try {
			elm.setSelectionRange(0, (elm.value || '').length);
		} catch {}

		inputSetter.call(elm, '');
		elm.dispatchEvent(new InputEvent('input', { bubbles: true }));

		for (const ch of String(text)) {
			inputSetter.call(elm, (elm.value || '') + ch);
			elm.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch }));
			await sleep(2);
		}

		// 1) autosuggest 닫기/선택 해제
		fireKey(elm, 'Escape', 'Escape', 27);
		await sleep(20);

		// 2) raw 값 커밋(Enter)
		fireKey(elm, 'Enter', 'Enter', 13);
		elm.dispatchEvent(new Event('change', { bubbles: true }));
		await sleep(80);

		// 3) UI에 따라 Enter가 무시될 때 대비(보조 커밋)
		//    - 일부 태그 입력은 Tab/Comma로도 커밋됨
		fireKey(elm, 'Tab', 'Tab', 9);
		await sleep(30);
		fireKey(elm, ',', 'Comma', 188);
		await sleep(60);
	}

	/***** State *****/
	const state = {
		directTyping: true,
		mode: 'set',
		setVal: null,
		deltaVal: 0,
		percentVal: 0,
		roundUnit: 0,

		priceTargets: [],
		tagsText: '',
		tagTargets: [],
		tagMode: 'add',

		fileCommonText: '',

		running: false,
		stop: false,

		locale: null,
		pos: null,
	};

	/***** I18N *****/
	const BPTE_MESSAGES = /* __BPTE_MESSAGES__ */ {};
	const BPTE_BUILD_LOCALE = '__BPTE_BUILD_LOCALE__';
	const BPTE_SUPPORTED_LOCALES = ['ko', 'en', 'ja'];
	const LS_LOCALE_KEY = 'bpte-locale';

	function normalizeLocale(locale) {
		const s = String(locale || '').toLowerCase();
		if (!s || s === 'auto' || s.startsWith('__')) return '';
		if (s.startsWith('ko')) return 'ko';
		if (s.startsWith('ja')) return 'ja';
		if (s.startsWith('en')) return 'en';
		return '';
	}

	function loadStoredLocale() {
		try {
			return localStorage.getItem(LS_LOCALE_KEY);
		} catch {
			return '';
		}
	}

	function saveLocale(locale) {
		try {
			localStorage.setItem(LS_LOCALE_KEY, locale);
		} catch {}
	}

	function pickLocale() {
		const candidates = [loadStoredLocale(), BPTE_BUILD_LOCALE, ...(navigator.languages || []), navigator.language, document.documentElement.lang];

		for (const candidate of candidates) {
			const locale = normalizeLocale(candidate);
			if (locale && BPTE_MESSAGES[locale]) return locale;
		}

		return BPTE_MESSAGES.ko ? 'ko' : Object.keys(BPTE_MESSAGES)[0] || 'ko';
	}

	state.locale = pickLocale();

	function t(key, values = {}) {
		const template = BPTE_MESSAGES[state.locale]?.[key] ?? BPTE_MESSAGES.en?.[key] ?? BPTE_MESSAGES.ko?.[key] ?? key;
		return String(template).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
	}

	function renderFoundCounts(priceFound = 0, priceTotal = 0, tagFound = 0) {
		return t('foundCounts', { priceFound, priceTotal, tagFound });
	}

	/***** UI *****/
	const style = el('style', {
		textContent: `
#bpte-panel {
  position: fixed; z-index: 999999; top: 12px; right: 12px;
  width: 420px; font: 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: #111c; backdrop-filter: blur(6px); color: #fff;
  border: 1px solid #444; border-radius: 10px; padding: 0;
  box-shadow: 0 10px 24px rgba(0,0,0,.35);
}
#bpte-header {
  display:flex; align-items:center; justify-content:space-between;
  gap:6px; padding:8px 10px;
  cursor: grab; user-select:none;
  border-bottom:1px solid #2a2a2a; background:#141414d9; border-top-left-radius:10px; border-top-right-radius:10px;
}
#bpte-header.dragging { cursor: grabbing; }
#bpte-title { font-weight:600; }
#bpte-body { padding: 10px 12px 12px 12px; }
#bpte-panel input, #bpte-panel select, #bpte-panel button {
  width: 100%; margin: 4px 0; padding: 6px 8px;
  border-radius: 8px; border: 1px solid #444; background:#1c1c1c; color:#fff;
}
#bpte-panel button { cursor:pointer; }
#bpte-panel button:disabled { opacity:.5; cursor:not-allowed; }
#bpte-panel .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#bpte-panel .muted { opacity:.75; }
.bpte-changed { outline: 2px solid #22c55e !important; }
#bpte-progress { margin-top:6px; opacity:.85; white-space:pre-wrap; }
hr { border:none; border-top:1px solid #333; margin:8px 0 }
`,
	});

	const panel = el('div', { id: 'bpte-panel' });
	const header = el('div', { id: 'bpte-header' });
	const title = el('div', { id: 'bpte-title', textContent: t('panelTitle') });
	header.append(title);
	const body = el('div', { id: 'bpte-body' });

	document.documentElement.append(style, panel);
	panel.append(header, body);

	const lblFound = el('div', { className: 'muted', textContent: renderFoundCounts() });
	const lblLanguage = el('div', { className: 'muted', textContent: t('languageLabel') });
	const selLanguage = el(
		'select',
		{},
		BPTE_SUPPORTED_LOCALES.map((locale) =>
			el('option', {
				value: locale,
				textContent: BPTE_MESSAGES[locale]?.languageName || locale,
			}),
		),
	);
	selLanguage.value = state.locale;

	const chkDirect = el('input', { type: 'checkbox', checked: true });
	const labDirectText = document.createTextNode(` ${t('directTyping')}`);
	const labDirect = el('label', {}, [chkDirect, labDirectText]);

	const btnRescan = el('button', { textContent: t('scan') });
	const btnStop = el('button', { textContent: t('stop'), disabled: true });

	// 가격
	const inpSet = el('input', { type: 'number', placeholder: t('setPricePlaceholder'), value: '' });
	const selRound = el('select', {}, [
		el('option', { value: '0', textContent: t('roundNone') }),
		el('option', { value: '1', textContent: t('roundOnes') }),
		el('option', { value: '10', textContent: t('roundTens') }),
		el('option', { value: '100', textContent: t('roundHundreds') }),
	]);
	const roundOptions = Array.from(selRound.options);
	const btnApplySet = el('button', { textContent: t('applySetPrice') });
	const btnApplyDelta = el('button', { textContent: t('applyDeltaPrice') });
	const btnApplyPct = el('button', { textContent: t('applyPercentPrice') });
	const inpDelta = el('input', { type: 'number', placeholder: t('deltaPlaceholder'), value: '' });
	const inpPct = el('input', { type: 'number', placeholder: t('percentPlaceholder'), value: '' });
	const btnClearMarks = el('button', { textContent: t('clearMarks') });

	// 태그
	const inpTags = el('input', { type: 'text', placeholder: t('tagsPlaceholder') });
	const selTagMode = el('select', {}, [el('option', { value: 'add', textContent: t('tagModeAdd') }), el('option', { value: 'replace', textContent: t('tagModeReplace') })]);
	const tagModeOptions = Array.from(selTagMode.options);
	const btnTagsApply = el('button', { textContent: t('applyTags') });

	// Digital Files
	const inpCommonFiles = el('input', { type: 'text', placeholder: t('commonFilesPlaceholder') });
	const btnApplyFiles = el('button', { textContent: t('applyFiles') });

	const progress = el('div', { id: 'bpte-progress', className: 'muted', textContent: '' });
	const sectionPrice = el('div', { className: 'muted', textContent: t('priceSection') });
	const sectionTags = el('div', { className: 'muted', textContent: t('tagSection') });
	const sectionFiles = el('div', { className: 'muted', textContent: t('filesSection') });

	body.append(
		lblFound,
		el('div', { className: 'row' }, [lblLanguage, selLanguage]),
		el('div', { className: 'row' }, [labDirect, el('div', { className: 'muted', textContent: ' ' })]),
		el('div', { className: 'row' }, [btnRescan, btnStop]),
		el('hr'),
		sectionPrice,
		el('div', { className: 'row' }, [inpSet, selRound]),
		el('div', { className: 'row' }, [btnApplySet, btnApplyDelta]),
		el('div', { className: 'row' }, [inpDelta, inpPct]),
		el('div', { className: 'row' }, [btnApplyPct, btnClearMarks]),
		el('hr'),
		sectionTags,
		inpTags,
		el('div', { className: 'row' }, [selTagMode, btnTagsApply]),
		el('hr'),
		sectionFiles,
		inpCommonFiles,
		btnApplyFiles,
		progress,
	);

	function updateLocaleText() {
		title.textContent = t('panelTitle');
		lblLanguage.textContent = t('languageLabel');
		labDirectText.textContent = ` ${t('directTyping')}`;
		btnRescan.textContent = t('scan');
		btnStop.textContent = t('stop');
		inpSet.placeholder = t('setPricePlaceholder');
		roundOptions[0].textContent = t('roundNone');
		roundOptions[1].textContent = t('roundOnes');
		roundOptions[2].textContent = t('roundTens');
		roundOptions[3].textContent = t('roundHundreds');
		btnApplySet.textContent = t('applySetPrice');
		btnApplyDelta.textContent = t('applyDeltaPrice');
		btnApplyPct.textContent = t('applyPercentPrice');
		inpDelta.placeholder = t('deltaPlaceholder');
		inpPct.placeholder = t('percentPlaceholder');
		btnClearMarks.textContent = t('clearMarks');
		inpTags.placeholder = t('tagsPlaceholder');
		tagModeOptions[0].textContent = t('tagModeAdd');
		tagModeOptions[1].textContent = t('tagModeReplace');
		btnTagsApply.textContent = t('applyTags');
		inpCommonFiles.placeholder = t('commonFilesPlaceholder');
		btnApplyFiles.textContent = t('applyFiles');
		sectionPrice.textContent = t('priceSection');
		sectionTags.textContent = t('tagSection');
		sectionFiles.textContent = t('filesSection');
	}

	function setLocale(locale) {
		const nextLocale = normalizeLocale(locale);
		if (!nextLocale || !BPTE_MESSAGES[nextLocale]) return;
		state.locale = nextLocale;
		selLanguage.value = nextLocale;
		saveLocale(nextLocale);
		updateLocaleText();
		progress.textContent = '';
		scan();
	}

	/***** 위치 저장/복원 + 드래그 *****/
	const LS_POS_KEY = 'bpte-pos';
	const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

	function savePos() {
		const rect = panel.getBoundingClientRect();
		const pos = { left: rect.left, top: rect.top };
		state.pos = pos;
		try {
			localStorage.setItem(LS_POS_KEY, JSON.stringify(pos));
		} catch {}
	}

	function restorePos() {
		let pos = null;
		try {
			const raw = localStorage.getItem(LS_POS_KEY);
			if (raw) pos = JSON.parse(raw);
		} catch {}
		const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
		const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

		panel.style.top = '12px';
		panel.style.right = '12px';
		panel.style.left = 'auto';

		if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
			const rect = panel.getBoundingClientRect();
			let left = clamp(pos.left, 4 - rect.width * 0.2, vw - 4);
			let top = clamp(pos.top, 4, vh - 4);
			panel.style.left = `${left}px`;
			panel.style.top = `${top}px`;
			panel.style.right = 'auto';
			state.pos = { left, top };
		}
	}

	let dragCtx = null;
	const DRAG_THRESHOLD = 3;

	function onPointerDown(ev) {
		if (!(ev.pointerType === 'mouse' ? ev.button === 0 : true)) return;
		const rect = panel.getBoundingClientRect();
		dragCtx = { startX: ev.clientX, startY: ev.clientY, baseLeft: rect.left, baseTop: rect.top, moved: false };
		header.classList.add('dragging');
		document.addEventListener('pointermove', onPointerMove, true);
		document.addEventListener('pointerup', onPointerUp, true);
		ev.preventDefault();
	}

	function onPointerMove(ev) {
		if (!dragCtx) return;
		if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) return onPointerUp();

		const dx = ev.clientX - dragCtx.startX;
		const dy = ev.clientY - dragCtx.startY;
		if (!dragCtx.moved) {
			if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
			dragCtx.moved = true;
		}

		const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
		const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
		const rect = panel.getBoundingClientRect();
		let left = clamp(dragCtx.baseLeft + dx, 4 - rect.width * 0.9, vw - 4);
		let top = clamp(dragCtx.baseTop + dy, 4, vh - 4);
		panel.style.left = `${left}px`;
		panel.style.top = `${top}px`;
		panel.style.right = 'auto';
	}

	function clearDrag() {
		header.classList.remove('dragging');
		document.removeEventListener('pointermove', onPointerMove, true);
		document.removeEventListener('pointerup', onPointerUp, true);
		dragCtx = null;
	}

	function onPointerUp() {
		if (!dragCtx) return;
		if (dragCtx.moved) savePos();
		clearDrag();
	}

	header.addEventListener('pointerdown', onPointerDown);

	/***** 스캔 *****/
	function scan() {
		const allPrice = $(PRICE_INPUT_SELECTOR).filter(isVisible);
		state.priceTargets = allPrice.filter((inp) => !isExcludedPrice(inp) && isPriceField(inp));

		// ✅ 태그 인풋: 신/구 셀렉터로 전부 잡음
		state.tagTargets = $(TAG_INPUT_SELECTOR).filter(isVisible);

		lblFound.textContent = renderFoundCounts(state.priceTargets.length, allPrice.length, state.tagTargets.length);

		for (const n of $(PRICE_INPUT_SELECTOR)) n.classList.remove('bpte-changed');
		for (const n of $(TAG_INPUT_SELECTOR)) n.classList.remove('bpte-changed');
	}

	/***** 가격 *****/
	function computeNext(cur) {
		const unit = state.roundUnit;
		if (state.mode === 'set') {
			if (state.setVal == null || Number.isNaN(Number(state.setVal))) return null;
			return roundToUnit(Number(state.setVal), unit);
		} else if (state.mode === 'delta') {
			const base = Number(cur || 0),
				d = Number(state.deltaVal || 0);
			return roundToUnit(base + d, unit);
		} else {
			const base = Number(cur || 0),
				p = Number(state.percentVal || 0);
			return roundToUnit(base * (1 + p / 100), unit);
		}
	}

	async function applyPriceOnce() {
		if (!state.priceTargets.length) scan();
		for (const elm of state.priceTargets) {
			if (state.stop) break;
			const cur = Number(elm.value || 0);
			const next = computeNext(cur);
			if (next === null) continue;

			const toPut = String(next).replace(/[^\d\-]/g, '');
			if (state.directTyping) await typeInto(elm, toPut);
			else {
				inputSetter?.call(elm, toPut);
				elm.dispatchEvent(new InputEvent('input', { bubbles: true }));
				elm.dispatchEvent(new Event('change', { bubbles: true }));
				elm.blur();
			}
			elm.classList.add('bpte-changed');
			await sleep(10);
		}
	}

	/***** 태그 교체(X 클릭 삭제) *****/
	// ✅ 신 UI에서 #item_tag / pixiv-icon이 없을 때를 대비한 fallback 삭제
	function findTagContainerNearInput(tagInput) {
		if (!tagInput) return null;
		let cur = tagInput.parentElement;
		for (let i = 0; i < 14 && cur; i++) {
			// input을 포함하고, 버튼이 몇 개 있는 컨테이너면 태그영역일 확률 높음
			const hasInput = !!cur.querySelector(TAG_INPUT_SELECTOR);
			const btnCount = cur.querySelectorAll('button, [role="button"]').length;
			if (hasInput && btnCount >= 1) return cur;
			cur = cur.parentElement;
		}
		return tagInput.closest('form') || tagInput.parentElement;
	}

	async function removeAllExistingTagsFallback(tagInput) {
		const container = findTagContainerNearInput(tagInput);
		if (!container) return;

		const candidatesSelector = [
			'button[aria-label*="remove" i]',
			'button[aria-label*="delete" i]',
			'button[aria-label*="clear" i]',
			'button[aria-label*="삭제" i]',
			'button[aria-label*="제거" i]',
			'button[aria-label*="消" i]',
			// 흔한 “x” 아이콘 버튼들(작은 버튼 위주로 area로 걸러냄)
			'button:has(svg)',
			'button:has(pixiv-icon)',
			'pixiv-icon[name*="Close" i]',
		].join(',');

		for (let guard = 0; guard < 120; guard++) {
			if (state.stop) break;

			const btns = $(candidatesSelector, container).filter(isVisible);
			if (!btns.length) break;

			// 가장 작은 버튼을 “칩 삭제”로 간주
			const btn = btns
				.map((b) => {
					const r = b.getBoundingClientRect();
					return { b, area: r.width * r.height, w: r.width, h: r.height };
				})
				.sort((a, c) => a.area - c.area)[0]?.b;

			if (!btn) break;

			const r = btn.getBoundingClientRect();
			// 큰 버튼(저장/닫기 등) 방지
			if (r.width > 60 || r.height > 60) break;

			clickAtCenter(btn.closest('button,[role="button"]') || btn);
			await sleep(90);
		}
	}

	async function removeAllExistingTags(tagInputForFallback) {
		// 1) 구 UI 방식 먼저 시도
		const section = document.querySelector(TAG_SECTION_SELECTOR);
		if (section) {
			for (let guard = 0; guard < 300; guard++) {
				if (state.stop) break;

				const icons = $(TAG_REMOVE_ICON_SELECTOR).filter(isVisible);
				if (!icons.length) break;

				const icon = icons[0];
				const clickable = icon.closest('a,button,[role="button"]') || icon;
				clickAtCenter(clickable);
				await sleep(90);
			}
			return;
		}

		// 2) 신 UI fallback
		await removeAllExistingTagsFallback(tagInputForFallback);
	}

	async function applyTagsOnce() {
		const tags = normalizeTagsCommaOnly(state.tagsText);
		if (!tags.length) {
			alert(t('alertNoTags'));
			return;
		}
		if (!state.tagTargets.length) scan();

		for (const input of state.tagTargets) {
			if (state.stop) break;

			if (state.tagMode === 'replace') {
				progress.textContent = t('deletingTags');
				await removeAllExistingTags(input);
				await sleep(150);
			}

			progress.textContent = t('enteringTags');
			for (const tag of tags) {
				if (state.stop) break;

				// ✅ 여기서 “추천어 선택” 방지 + raw 커밋
				await typeTagAndEnterRaw(input, tag);
			}
			input.classList.add('bpte-changed');
			await sleep(60);
		}
		progress.textContent = state.stop ? t('stopped') : t('done');
	}

	/***** Digital Files (옵션별) *****/
	function buildCommonKeywords(text) {
		const raw = String(text ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const set = new Set();
		for (const k of raw) {
			const kN = norm(k);
			if (!kN) continue;
			set.add(kN);
		}

		const exact = Array.from(set);
		const loose = new Set(exact.map(normLoose).filter(Boolean));
		return { exact, loose };
	}

	function getVariationCards() {
		const inputs = $(VAR_NAME_INPUT_SELECTOR);
		const cards = [];
		const seen = new Set();
		for (const inp of inputs) {
			const li = inp.closest('li');
			if (!li) continue;
			if (seen.has(li)) continue;
			seen.add(li);
			cards.push(li);
		}
		return cards;
	}

	function getVariationNameFromCard(card) {
		const inp = card.querySelector(VAR_NAME_INPUT_SELECTOR);
		return ((inp && (inp.value || inp.getAttribute('value') || '')) || '').trim();
	}

	function findDigitalFilesButton(card) {
		const edit = findByTextAndClimbClickable(card, /^edit$/i);
		if (edit) return edit;

		const addEdit = findByTextAndClimbClickable(card, /add\s*\/\s*edit\s*files/i);
		if (addEdit) return addEdit;

		const files = findByTextAndClimbClickable(card, /\bfiles\b/i);
		if (files) return files;

		return null;
	}

	function findFilesModalCandidate() {
		const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(isVisible);
		const candidates = dialogs.length ? dialogs : Array.from(document.querySelectorAll('body > div')).filter(isVisible);

		const isCloseText = (t) => /^(close|닫기|閉じる)$/i.test(String(t || '').trim());

		for (const cand of candidates) {
			const hasCheckbox = !!cand.querySelector('input[type="checkbox"]');
			if (!hasCheckbox) continue;

			const buttons = Array.from(cand.querySelectorAll('button, a, [role="button"]')).filter(isVisible);
			const hasClose = buttons.some((b) => isCloseText(b.textContent));
			if (!hasClose) continue;

			return cand;
		}
		return null;
	}

	async function openFilesModalByButton(btn) {
		clickAtCenter(btn);
		await sleep(120);
		const modal = await waitFor(() => findFilesModalCandidate(), { timeout: 9000, interval: 80 });
		return modal;
	}

	function installNoDownloadGuard(modal) {
		const handler = (e) => {
			if (!state.running) return;
			const a = e.target?.closest?.('a[href]');
			if (!a) return;

			const href = String(a.getAttribute('href') || '');
			if (/download|downloadable|files|uploads|storage|amazonaws|s3/i.test(href)) {
				e.preventDefault();
				e.stopPropagation();
			}
		};
		modal.addEventListener('click', handler, true);
		return () => modal.removeEventListener('click', handler, true);
	}

	function listFileRowsInModal(modal) {
		const rows = [];
		const inputs = Array.from(modal.querySelectorAll('input[type="checkbox"]')).filter(isVisible);

		for (const chk of inputs) {
			const label = chk.closest('label');
			const row = label?.closest('li') || chk.closest('li') || chk.closest('[role="row"]') || chk.closest('div');

			if (!row) continue;

			const a = row.querySelector('a');
			const name = ((a && a.textContent) || '').trim();
			if (!name) continue;

			rows.push({ row, chk, label, name });
		}

		const out = [];
		const seen = new Set();
		for (const r of rows) {
			const key = `${r.name}::${r.chk.id || r.chk.name || ''}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(r);
		}
		return out;
	}

	async function setCheckedByRealClick(row, desired) {
		const chk = row?.chk || null;
		if (!chk) return false;

		const readState = () => !!chk.checked;
		const ensure = () => readState() === desired;
		if (ensure()) return true;

		for (let i = 0; i < 8; i++) {
			clickCheckboxInputOnce(chk);
			await sleep(160);
			if (ensure()) return true;
		}

		return ensure();
	}

	async function closeFilesModal(modal) {
		const btn = findByTextAndClimbClickable(modal, /^(close|닫기|閉じる)$/i);
		if (btn) {
			clickAtCenter(btn);
			await waitFor(() => !document.body.contains(modal) || !isVisible(modal), { timeout: 4000, interval: 80 });
		}
	}

	async function applyDigitalFilesForOneVariation(card, commonKW) {
		const vName = getVariationNameFromCard(card);
		const isFull = isFullPackVariation(vName);

		const vTokens = extractLatinTokens(vName);
		const vTokensLoose = new Set(vTokens.map(normLoose).filter(Boolean));

		const btn = findDigitalFilesButton(card);
		progress.textContent = t('optionProcessing', { name: vName || t('emptyVariationName') });

		if (!btn) {
			progress.textContent = t('filesButtonNotFound', { name: vName });
			await sleep(250);
			return;
		}

		const modal = await openFilesModalByButton(btn);
		if (!modal) {
			progress.textContent = t('filesModalNotFound', { name: vName });
			await sleep(250);
			return;
		}

		const removeGuard = installNoDownloadGuard(modal);

		try {
			const rows = listFileRowsInModal(modal);
			if (!rows.length) {
				progress.textContent = t('modalCheckboxNotFound', { name: vName });
				return;
			}

			if (isFull) {
				progress.textContent = t('fullPackChecking', { name: vName });
				for (const r of rows) {
					if (state.stop) break;
					await setCheckedByRealClick(r, true);
					await sleep(45);
				}
				await closeFilesModal(modal);
				await sleep(220);
				return;
			}

			progress.textContent = t('uncheckingExisting', { name: vName });
			for (const r of rows) {
				if (state.stop) break;
				await setCheckedByRealClick(r, false);
				await sleep(35);
			}

			progress.textContent = t('checkingMatching', { name: vName });
			for (const r of rows) {
				if (state.stop) break;

				const fn = norm(r.name);
				const fnL = normLoose(r.name);

				const matchCommon = (commonKW.exact.length && commonKW.exact.some((k) => k && fn.includes(k))) || (commonKW.loose.size && Array.from(commonKW.loose).some((k) => k && fnL.includes(k)));

				const matchVariation = (vTokens.length && vTokens.some((t) => t && fn.includes(t))) || (vTokensLoose.size && Array.from(vTokensLoose).some((t) => t && fnL.includes(t)));

				if (matchCommon || matchVariation) {
					await setCheckedByRealClick(r, true);
					await sleep(45);
				}
			}

			await closeFilesModal(modal);
			await sleep(220);
		} finally {
			try {
				removeGuard?.();
			} catch {}
		}
	}

	async function applyDigitalFilesAllVariations() {
		const commonKW = buildCommonKeywords(state.fileCommonText);
		const cards = getVariationCards();

		if (!cards.length) {
			alert(t('alertNoVariationCards'));
			return;
		}

		progress.textContent = t('variationStart', { count: cards.length });

		for (let i = 0; i < cards.length; i++) {
			if (state.stop) break;
			progress.textContent = t('variationProcessing', { current: i + 1, total: cards.length });
			await applyDigitalFilesForOneVariation(cards[i], commonKW);
		}

		progress.textContent = state.stop ? t('stopped') : t('filesDone');
	}

	/***** 잡 러너 *****/
	function setRunning(on) {
		state.running = on;
		btnStop.disabled = !on;
		btnRescan.disabled = on;
		btnApplySet.disabled = on;
		btnApplyDelta.disabled = on;
		btnApplyPct.disabled = on;
		btnTagsApply.disabled = on;
		btnApplyFiles.disabled = on;
	}

	async function runJob(fn) {
		if (state.running) return;
		state.stop = false;
		setRunning(true);
		progress.textContent = t('jobStart');
		try {
			await fn();
			scan();
		} catch (e) {
			console.error('[Booth Batch] job error:', e);
			alert(t('errorAlert', { message: e?.message || e }));
			progress.textContent = t('errorProgress');
		} finally {
			setRunning(false);
			state.stop = false;
		}
	}

	/***** 이벤트 *****/
	selLanguage.addEventListener('change', () => {
		setLocale(selLanguage.value);
	});

	chkDirect.addEventListener('change', () => {
		state.directTyping = chkDirect.checked;
	});
	selRound.addEventListener('change', () => {
		state.roundUnit = Number(selRound.value);
	});

	inpSet.addEventListener('input', () => {
		state.setVal = inpSet.value === '' ? null : Number(inpSet.value);
	});
	inpDelta.addEventListener('input', () => {
		state.deltaVal = Number(inpDelta.value || 0);
	});
	inpPct.addEventListener('input', () => {
		state.percentVal = Number(inpPct.value || 0);
	});

	inpTags.addEventListener('input', () => {
		state.tagsText = inpTags.value || '';
	});
	selTagMode.addEventListener('change', () => {
		state.tagMode = selTagMode.value;
	});

	inpCommonFiles.addEventListener('input', () => {
		state.fileCommonText = inpCommonFiles.value || '';
	});

	btnRescan.addEventListener('click', scan);
	btnStop.addEventListener('click', () => {
		state.stop = true;
		progress.textContent = t('stopRequested');
	});

	btnApplySet.addEventListener('click', () =>
		runJob(async () => {
			state.mode = 'set';
			await applyPriceOnce();
		}),
	);
	btnApplyDelta.addEventListener('click', () =>
		runJob(async () => {
			state.mode = 'delta';
			await applyPriceOnce();
		}),
	);
	btnApplyPct.addEventListener('click', () =>
		runJob(async () => {
			state.mode = 'percent';
			await applyPriceOnce();
		}),
	);

	btnClearMarks.addEventListener('click', () => {
		for (const elx of $(PRICE_INPUT_SELECTOR)) elx.classList.remove('bpte-changed');
		for (const elx of $(TAG_INPUT_SELECTOR)) elx.classList.remove('bpte-changed');
		progress.textContent = '';
	});

	btnTagsApply.addEventListener('click', () =>
		runJob(async () => {
			await applyTagsOnce();
		}),
	);
	btnApplyFiles.addEventListener('click', () =>
		runJob(async () => {
			await applyDigitalFilesAllVariations();
		}),
	);

	document.addEventListener('keydown', (e) => {
		if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'r') {
			try {
				localStorage.removeItem(LS_POS_KEY);
			} catch {}
			panel.style.left = 'auto';
			panel.style.right = '12px';
			panel.style.top = '12px';
			alert(t('panelReset'));
		}
	});

	/***** 초기화 + 동적 로딩 대응 *****/
	(function init() {
		try {
			restorePos();
			scan();
		} catch (e) {
			console.error('[Booth Batch] init error:', e);
			try {
				localStorage.removeItem(LS_POS_KEY);
			} catch {}
			panel.style.top = '12px';
			panel.style.right = '12px';
			panel.style.left = 'auto';
			scan();
		}
	})();

	const mo = new MutationObserver(() => {
		clearTimeout(mo._t);
		mo._t = setTimeout(scan, 300);
	});
	mo.observe(document.body, { childList: true, subtree: true });
})();
