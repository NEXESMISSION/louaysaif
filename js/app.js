/* 1K Challenge — Saif vs Louay
   Vanilla JS + Supabase. No build step. */
(() => {
  'use strict';

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  /* ───────── tiny helpers ───────── */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const money = (n) => nf.format(Math.abs(Number(n) || 0));
  const signed = (n) => (Number(n) >= 0 ? '+' : '−') + money(n);

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);

  const toLocalInput = (d) => {
    const x = new Date(d), p = (v) => String(v).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
  };

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  /* ───────── categories ───────── */
  const CATS = {
    in: [['work', '💼', 'Work'], ['freelance', '🤝', 'Freelance'], ['sale', '🛒', 'Sale'],
         ['gift', '🎁', 'Gift'], ['other_in', '💰', 'Other']],
    out: [['food', '🍔', 'Food'], ['transport', '🚗', 'Transport'], ['shopping', '🛍️', 'Shopping'],
          ['bills', '🧾', 'Bills'], ['fun', '🎮', 'Fun'], ['other_out', '💸', 'Other']],
  };
  const CAT_META = {};
  for (const dir of ['in', 'out']) for (const [k, e, l] of CATS[dir]) CAT_META[k] = { emoji: e, label: l, dir };
  const catOf = (k) => CAT_META[k] || { emoji: '•', label: 'Other', dir: 'out' };

  /* ───────── state ───────── */
  const state = {
    user: null,
    profiles: [],           // ordered by created_at — index 0 = p1, 1 = p2
    txs: [],                // newest first
    cfg: { goal: 1000, currency: 'TND', start_date: null, end_date: null, invite_code: null },
    filter: 'all',
    view: 'race',
    editing: null,          // transaction being edited
    dir: 'in',
    cat: 'work',
    channel: null,
  };

  const netOf = (uid) => state.txs.reduce((s, t) => (t.user_id === uid ? s + Number(t.amount) : s), 0);
  const colorClass = (uid) => (state.profiles[0]?.id === uid ? 'p1' : 'p2');
  const nameOf = (uid) => state.profiles.find((p) => p.id === uid)?.display_name || 'Someone';

  /* ───────── auth screen ───────── */
  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('is-on', x === b));
    const join = b.dataset.authTab === 'join';
    $('#form-login').hidden = join;
    $('#form-join').hidden = !join;
    $('#auth-msg').textContent = '';
  }));

  function authMsg(text, ok = false) {
    const m = $('#auth-msg');
    m.textContent = text;
    m.classList.toggle('ok', ok);
  }

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const f = new FormData(e.target);
    btn.disabled = true; authMsg('Checking…');
    const { error } = await sb.auth.signInWithPassword({
      email: String(f.get('email')).trim(),
      password: String(f.get('password')),
    });
    btn.disabled = false;
    if (error) return authMsg(/invalid/i.test(error.message) ? 'Wrong email or password.' : error.message);
    authMsg('');
    await enterApp();
  });

  $('#form-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const f = new FormData(e.target);
    const code = String(f.get('invite_code')).trim();
    btn.disabled = true; authMsg('Checking invite…');

    const { data: gate, error: gateErr } = await sb.rpc('check_invite', { code });
    if (gateErr) { btn.disabled = false; return authMsg('Could not reach the server. Try again.'); }
    if (!gate.valid) { btn.disabled = false; return authMsg('That invite code is not right.'); }
    if (gate.slots_left <= 0) { btn.disabled = false; return authMsg('Both spots are already taken.'); }

    authMsg('Creating your side…');
    const { error } = await sb.auth.signUp({
      email: String(f.get('email')).trim(),
      password: String(f.get('password')),
      options: {
        data: {
          display_name: String(f.get('display_name')).trim(),
          avatar_emoji: String(f.get('avatar_emoji') || '🔥').trim() || '🔥',
          invite_code: code,
        },
      },
    });
    btn.disabled = false;
    if (error) {
      const m = error.message || '';
      if (/already registered|already been registered|User already/i.test(m))
        return authMsg('That email already has an account — log in instead.');
      if (/Database error saving new user/i.test(m))
        return authMsg('The invite code did not match. Check it and try again.');
      if (/password/i.test(m) && /least|short/i.test(m))
        return authMsg('Password needs at least 6 characters.');
      if (/invalid.*email|email.*invalid/i.test(m))
        return authMsg('That email address does not look right.');
      return authMsg(m);
    }
    authMsg('');
    await enterApp();
  });

  $('#btn-logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.reload();
  });

  /* ───────── data ───────── */
  async function loadAll() {
    const [p, t, c] = await Promise.all([
      sb.from('profiles').select('*').order('created_at', { ascending: true }),
      sb.from('transactions').select('*').order('occurred_at', { ascending: false }).limit(1000),
      sb.from('app_config').select('goal,currency,start_date,end_date,invite_code').eq('id', 1).single(),
    ]);
    if (p.data) state.profiles = p.data;
    if (t.data) state.txs = t.data;
    if (c.data) state.cfg = c.data;
    render();
  }

  function subscribe() {
    if (state.channel) return;
    state.channel = sb.channel('race')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadAll)
      .subscribe();
  }

  /* ───────── render ───────── */
  function render() {
    renderHeader();
    renderRace();
    renderList($('#recent'), state.txs.slice(0, 6), false);
    renderList($('#history'), filtered(), true);
    renderMe();
  }

  function renderHeader() {
    const start = state.cfg.start_date ? new Date(state.cfg.start_date + 'T00:00:00') : new Date();
    const day = daysBetween(start, new Date()) + 1;
    let label = `Day ${Math.max(1, day)}`;
    if (state.cfg.end_date) {
      const left = daysBetween(new Date(), new Date(state.cfg.end_date + 'T00:00:00'));
      label += left >= 0 ? ` · ${left}d left` : ' · over';
    }
    $('#day-pill').textContent = label;
    $('#goal-pill').textContent = `Goal ${money(state.cfg.goal)} ${state.cfg.currency}`;
  }

  function renderRace() {
    const box = $('#race');
    box.textContent = '';
    const goal = Number(state.cfg.goal) || 1000;
    const rows = state.profiles.map((p) => ({ p, net: netOf(p.id) }));
    const best = Math.max(...rows.map((r) => r.net), -Infinity);

    rows.forEach(({ p, net }, i) => {
      const cls = i === 0 ? 'p1' : 'p2';
      const pct = Math.max(0, Math.min(100, (net / goal) * 100));
      const won = net >= goal;
      const leads = rows.length > 1 && net === best && net > 0;
      const card = el('div', `racer ${cls}${p.id === state.user.id ? ' is-you' : ''}${won ? ' won' : ''}`);
      const count = state.txs.filter((t) => t.user_id === p.id).length;
      const today = state.txs.reduce((s, t) =>
        (t.user_id === p.id && daysBetween(t.occurred_at, new Date()) === 0 ? s + Number(t.amount) : s), 0);
      card.innerHTML = `
        <div class="racer-top">
          <span class="racer-emoji">${esc(p.avatar_emoji)}</span>
          <div>
            <div class="racer-name">${esc(p.display_name)}${won ? '<span class="crown">👑</span>' : leads ? '<span class="crown">🔥</span>' : ''}</div>
            <div class="racer-sub">
              ${count} ${count === 1 ? 'entry' : 'entries'}
              ${today !== 0 ? `<span class="today-tag ${today > 0 ? 'net-pos' : 'net-neg'}">${signed(today)} today</span>` : ''}
              ${p.id === state.user.id ? '<span class="you-tag">YOU</span>' : ''}
            </div>
          </div>
          <div class="racer-net">
            <b class="${net >= 0 ? 'net-pos' : 'net-neg'}">${signed(net)}</b>
            <small>${esc(state.cfg.currency)}</small>
          </div>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-meta">
          <span>${pct.toFixed(0)}% of goal</span>
          <span>${won ? 'Goal reached 🎉' : `${money(goal - net)} to go`}</span>
        </div>`;
      box.append(card);
    });

    if (state.profiles.length < 2) {
      const slot = el('div', 'empty-slot');
      slot.innerHTML = `<b>Waiting for your rival</b>
        Send them this app and the invite code below — they pick their own password.
        ${state.cfg.invite_code ? `<button type="button" class="code-chip">${esc(state.cfg.invite_code)}</button>` : ''}`;
      slot.querySelector('.code-chip')?.addEventListener('click', async (ev) => {
        try {
          await navigator.clipboard.writeText(state.cfg.invite_code);
          toast('Invite code copied');
        } catch {
          const r = document.createRange();
          r.selectNodeContents(ev.currentTarget);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        }
      });
      box.append(slot);
    }

    // leader banner
    const banner = $('#lead-banner');
    if (rows.length < 2) {
      banner.innerHTML = 'Race starts when both of you are in.';
    } else {
      const [a, b] = [...rows].sort((x, y) => y.net - x.net);
      const gap = a.net - b.net;
      const winner = rows.find((r) => r.net >= goal);
      if (winner) banner.innerHTML = `🏆 <b>${esc(winner.p.display_name)}</b> hit ${money(goal)} ${esc(state.cfg.currency)} first!`;
      else if (gap === 0) banner.innerHTML = 'Dead heat — nobody is ahead.';
      else banner.innerHTML = `<b>${esc(a.p.display_name)}</b> leads by <b>${money(gap)} ${esc(state.cfg.currency)}</b>`;
    }
  }

  function filtered() {
    const me = state.user.id;
    return state.txs.filter((t) => {
      switch (state.filter) {
        case 'mine': return t.user_id === me;
        case 'them': return t.user_id !== me;
        case 'in': return Number(t.amount) > 0;
        case 'out': return Number(t.amount) < 0;
        default: return true;
      }
    });
  }

  function dayLabel(d) {
    const diff = daysBetween(d, new Date());
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function renderList(box, rows, grouped) {
    box.textContent = '';
    if (!rows.length) {
      box.append(el('p', 'empty-note', 'Nothing here yet. Tap ＋ to log your first move.'));
      return;
    }
    // net per day, so each header can carry its own subtotal
    const dayNets = new Map();
    if (grouped) {
      for (const t of rows) {
        const k = startOfDay(t.occurred_at).getTime();
        dayNets.set(k, (dayNets.get(k) || 0) + Number(t.amount));
      }
    }

    let lastDay = null;
    for (const t of rows) {
      if (grouped) {
        const key = startOfDay(t.occurred_at).getTime();
        if (key !== lastDay) {
          lastDay = key;
          const n = dayNets.get(key) || 0;
          box.append(el('div', 'day-head',
            `<span>${dayLabel(t.occurred_at)}</span><span class="${n >= 0 ? 'net-pos' : 'net-neg'}">${signed(n)}</span>`));
        }
      }
      const mine = t.user_id === state.user.id;
      const amt = Number(t.amount);
      const c = catOf(t.category);
      const row = el(mine ? 'button' : 'div', `item${mine ? ' mine' : ''}`);
      if (mine) row.type = 'button';
      row.innerHTML = `
        <span class="item-ico">${c.emoji}</span>
        <span class="item-mid">
          <span class="item-note">${esc(t.note || c.label)}</span>
          <span class="item-sub">
            <span class="who ${colorClass(t.user_id)}">${esc(nameOf(t.user_id))}</span>
            <span>${c.label}</span>
            <span>· ${new Date(t.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </span>
        </span>
        <span class="item-amt ${amt >= 0 ? 'net-pos' : 'net-neg'}">${signed(amt)}</span>`;
      if (mine) row.addEventListener('click', () => openSheet(amt >= 0 ? 'in' : 'out', t));
      box.append(row);
    }
  }

  function renderMe() {
    const me = state.profiles.find((p) => p.id === state.user.id);
    $('#me-emoji').textContent = me?.avatar_emoji || '🔥';
    $('#me-name').textContent = me?.display_name || '—';
    $('#me-email').textContent = state.user.email;

    const mine = state.txs.filter((t) => t.user_id === state.user.id);
    const sum = (f) => mine.filter(f).reduce((s, t) => s + Number(t.amount), 0);
    const today = mine.filter((t) => daysBetween(t.occurred_at, new Date()) === 0)
      .reduce((s, t) => s + Number(t.amount), 0);
    const cur = state.cfg.currency;
    const stats = [
      ['Your net', signed(sum(() => true)), sum(() => true) >= 0 ? 'net-pos' : 'net-neg'],
      ['Today', signed(today), today >= 0 ? 'net-pos' : 'net-neg'],
      ['Money in', money(sum((t) => t.amount > 0)), 'net-pos'],
      ['Money out', money(sum((t) => t.amount < 0)), 'net-neg'],
    ];
    const box = $('#me-stats');
    box.textContent = '';
    for (const [label, val, cls] of stats) {
      box.append(el('div', 'stat', `<b class="${cls}">${val}</b><small>${label} (${esc(cur)})</small>`));
    }

    $('#set-goal').value = state.cfg.goal ?? 1000;
    $('#set-start').value = state.cfg.start_date ?? '';
    $('#set-end').value = state.cfg.end_date ?? '';
  }

  /* ───────── navigation ───────── */
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    $$('[data-view]').forEach((x) => x.classList.toggle('is-on', x === b));
    for (const v of ['race', 'history', 'me']) $(`#view-${v}`).hidden = v !== state.view;
    window.scrollTo({ top: 0 });
  }));

  $$('#filters .chip').forEach((c) => c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    $$('#filters .chip').forEach((x) => x.classList.toggle('is-on', x === c));
    renderList($('#history'), filtered(), true);
  }));

  $('#btn-refresh').addEventListener('click', async (e) => {
    e.currentTarget.classList.add('spin');
    await loadAll();
    e.currentTarget.classList.remove('spin');
  });

  /* ───────── entry sheet ───────── */
  function paintCats() {
    const box = $('#cat-chips');
    box.textContent = '';
    for (const [key, emoji, label] of CATS[state.dir]) {
      const c = el('button', `chip${key === state.cat ? ' is-on' : ''}`, `${emoji} ${label}`);
      c.type = 'button';
      c.addEventListener('click', () => { state.cat = key; paintCats(); });
      box.append(c);
    }
  }

  const QUICK_AMOUNTS = [5, 10, 20, 50, 100, 200, 500];
  function paintQuickAmounts() {
    const box = $('#quick-amounts');
    box.textContent = '';
    for (const v of QUICK_AMOUNTS) {
      const c = el('button', 'chip chip-amt', `${v}`);
      c.type = 'button';
      c.addEventListener('click', () => {
        const cur = parseFloat(String($('#f-amount').value).replace(',', '.')) || 0;
        $('#f-amount').value = money(cur + v);
        autosizeAmount();
        navigator.vibrate?.(8);
      });
      box.append(c);
    }
    const clr = el('button', 'chip chip-clear', '⌫');
    clr.type = 'button';
    clr.addEventListener('click', () => { $('#f-amount').value = ''; autosizeAmount(); });
    box.append(clr);
  }

  // The amount input shrink-wraps its value so the number stays optically centred.
  function autosizeAmount() {
    const i = $('#f-amount');
    i.size = Math.max(1, Math.min(9, (i.value || i.placeholder).length));
  }
  $('#f-amount').addEventListener('input', autosizeAmount);

  function setDir(dir) {
    state.dir = dir;
    $$('[data-dir]').forEach((b) => b.classList.toggle('is-on', b.dataset.dir === dir));
    $('#form-entry').classList.toggle('dir-in', dir === 'in');
    $('#form-entry').classList.toggle('dir-out', dir === 'out');
    $('#f-sign').textContent = dir === 'in' ? '＋' : '−';
    if (catOf(state.cat).dir !== dir) state.cat = CATS[dir][0][0];
    paintCats();
  }

  function openSheet(dir = 'in', tx = null) {
    state.editing = tx;
    setDir(dir);
    $('#f-amount').value = tx ? money(tx.amount) : '';
    $('#f-note').value = tx ? tx.note : '';
    $('#f-when').value = toLocalInput(tx ? tx.occurred_at : new Date());
    if (tx) state.cat = tx.category;
    paintCats();
    paintQuickAmounts();
    autosizeAmount();
    $('#f-save').textContent = tx ? 'Save changes' : 'Add entry';
    $('#f-delete').hidden = !tx;
    $('#entry-msg').textContent = '';
    $('#sheet').hidden = false;
    if (!tx) setTimeout(() => $('#f-amount').focus(), 120);
  }
  const closeSheet = () => { $('#sheet').hidden = true; state.editing = null; };

  $$('#sheet [data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  $$('#sheet [data-dir]').forEach((b) => b.addEventListener('click', () => setDir(b.dataset.dir)));
  $('#fab').addEventListener('click', () => openSheet('in'));
  $$('[data-quick]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.quick)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  $('#form-entry').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = $('#f-amount').value.trim().replace(/\s/g, '').replace(',', '.');
    const val = Math.abs(parseFloat(raw));
    if (!isFinite(val) || val <= 0) { $('#entry-msg').textContent = 'Type an amount first.'; return; }

    const payload = {
      amount: state.dir === 'in' ? val : -val,
      note: $('#f-note').value.trim(),
      category: state.cat,
      occurred_at: new Date($('#f-when').value || Date.now()).toISOString(),
    };

    const btn = $('#f-save');
    btn.disabled = true;
    const q = state.editing
      ? sb.from('transactions').update(payload).eq('id', state.editing.id)
      : sb.from('transactions').insert({ ...payload, user_id: state.user.id });
    const { error } = await q;
    btn.disabled = false;

    if (error) { $('#entry-msg').textContent = error.message; return; }
    toast(state.editing ? 'Entry updated' : `${state.dir === 'in' ? '＋' : '－'} ${money(val)} ${state.cfg.currency} logged`);
    closeSheet();
    await loadAll();
  });

  $('#f-delete').addEventListener('click', async () => {
    if (!state.editing || !confirm('Delete this entry for good?')) return;
    const { error } = await sb.from('transactions').delete().eq('id', state.editing.id);
    if (error) { $('#entry-msg').textContent = error.message; return; }
    toast('Entry deleted');
    closeSheet();
    await loadAll();
  });

  /* ───────── settings ───────── */
  $('#btn-save-settings').addEventListener('click', async () => {
    const msg = $('#settings-msg');
    const patch = {
      goal: Number($('#set-goal').value) || 1000,
      start_date: $('#set-start').value || null,
      end_date: $('#set-end').value || null,
    };
    if (!patch.start_date) { msg.textContent = 'Pick a start date.'; msg.classList.remove('ok'); return; }
    const { error } = await sb.from('app_config').update(patch).eq('id', 1);
    if (error) { msg.textContent = error.message; msg.classList.remove('ok'); return; }
    msg.textContent = 'Saved.'; msg.classList.add('ok');
    await loadAll();
  });

  /* ───────── install prompt ───────── */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('#btn-install').hidden = false;
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#btn-install').hidden = true;
  });
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    $('#install-hint').textContent =
      'On iPhone: tap the Share button in Safari, then "Add to Home Screen".';
  }

  /* ───────── boot ───────── */
  async function enterApp() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return showAuth();
    state.user = user;
    $('#boot').hidden = true;
    $('#auth').hidden = true;
    $('#app').hidden = false;
    await loadAll();
    subscribe();

    const add = new URLSearchParams(location.search).get('add');
    if (add === 'in' || add === 'out') {
      openSheet(add);
      history.replaceState(null, '', location.pathname);
    }
  }

  function showAuth() {
    $('#boot').hidden = true;
    $('#app').hidden = true;
    $('#auth').hidden = false;

    // A share link like ...?code=ABCDE-FGHIJ opens straight on Join with the
    // code already filled, so nobody has to retype it on a phone keyboard.
    const code = new URLSearchParams(location.search).get('code');
    if (code) {
      $('[data-auth-tab="join"]').click();
      $('#join-code').value = code.trim();
      $('#form-join').display_name.focus();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.user) loadAll();
  });

  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await enterApp(); else showAuth();
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
