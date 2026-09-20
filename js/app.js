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

  /* ───────── challenge setup ─────────
     Deliberately code-only. Edit these two lines and redeploy — there is no
     in-app way to move the finish line, so neither player can change it.
     GOALS is a ladder: clear one and the race rolls straight on to the next. */
  const GOALS = [1000, 2000, 3000, 5000, 10000];
  const START_DATE = '2026-09-15';
  const CURRENCY = 'TND';

  // Active target = the lowest goal the leader has not cleared yet.
  function ladder() {
    const best = Math.max(0, ...state.profiles.map((p) => netOf(p.id)));
    let i = GOALS.findIndex((g) => best < g);
    if (i === -1) i = GOALS.length - 1;          // every goal cleared
    return { goal: GOALS[i], next: GOALS[i + 1] ?? null, step: i + 1, total: GOALS.length };
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

  /* Remembers the email address only. The password is left to the browser's
     own password manager via the autocomplete hints on the form — storing it
     ourselves would put it in plain text where any script could read it, and
     you should not have to reach this screen anyway now that the session
     persists. */
  const EMAIL_KEY = 'last_email';
  const rememberEmail = (v) => { try { localStorage.setItem(EMAIL_KEY, v); } catch {} };
  const lastEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };

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
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(f.get('email')).trim(),
      password: String(f.get('password')),
    });
    btn.disabled = false;
    if (error) return authMsg(/invalid/i.test(error.message) ? 'Wrong email or password.' : error.message);
    rememberEmail(String(f.get('email')).trim());
    authMsg('');
    await enterApp(data.session);
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
    const { data, error } = await sb.auth.signUp({
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
    rememberEmail(String(f.get('email')).trim());
    authMsg('');
    await enterApp(data.session ?? (await sb.auth.getSession()).data.session);
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
      sb.from('app_config').select('invite_code').eq('id', 1).single(),
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
    const start = new Date(START_DATE + 'T00:00:00');
    const day = daysBetween(start, new Date()) + 1;
    let label = `Day ${Math.max(1, day)}`;
    $('#day-pill').textContent = label;

    const { goal, next, step, total } = ladder();
    $('#goal-pill').textContent = `Goal ${money(goal)} ${CURRENCY}`;
    const nx = $('#next-goal');
    nx.textContent = next ? `Next up · ${money(next)} ${CURRENCY}` : 'Final goal';
    nx.title = `Goal ${step} of ${total}`;
  }

  function renderRace() {
    const box = $('#race');
    box.textContent = '';
    const { goal } = ladder();
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
            <small>${CURRENCY}</small>
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
      if (winner) banner.innerHTML = `🏆 <b>${esc(winner.p.display_name)}</b> hit ${money(goal)} ${CURRENCY} first!`;
      else if (gap === 0) banner.innerHTML = 'Dead heat — nobody is ahead.';
      else banner.innerHTML = `<b>${esc(a.p.display_name)}</b> leads by <b>${money(gap)} ${CURRENCY}</b>`;
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
    const cur = CURRENCY;
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
    toast(state.editing ? 'Entry updated' : `${state.dir === 'in' ? '＋' : '－'} ${money(val)} ${CURRENCY} logged`);
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
  // Takes the user straight from the stored session. Never calls getUser(),
  // which is a network round-trip — on a weak connection that returns nothing
  // and would bounce a perfectly valid session back to the login screen.
  async function enterApp(session) {
    if (!session?.user) return showAuth();
    state.user = session.user;
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
    state.user = null;
    $('#boot-msg').textContent = '';
    $('#boot').hidden = true;
    $('#app').hidden = true;
    $('#auth').hidden = false;

    // Bring back the address used last time, and put the cursor on the
    // password so the browser's saved password drops straight in.
    const saved = lastEmail();
    if (saved) {
      $('#form-login').email.value = saved;
      setTimeout(() => $('#form-login').password.focus(), 60);
    }

    // The invite code fills itself in: from a ?code=... share link, or from the
    // build-time INVITE_CODE. When we have one, the field is hidden entirely so
    // there is nothing to mistype. The database still enforces it either way.
    const fromLink = new URLSearchParams(location.search).get('code');
    const code = (fromLink || window.APP_CONFIG.INVITE_CODE || '').trim();
    if (code) {
      $('#join-code').value = code;
      $('#join-code').closest('label').hidden = true;
      if (fromLink) $('[data-auth-tab="join"]').click();
    }
  }

  /* ───────── staying logged in ─────────
     The only thing that should ever return you to the login screen is signing
     out on purpose, or a refresh token the server actively rejects. Being
     offline, on bad signal, or reopening after weeks must not. */

  // supabase-js may store the session under one key or split it across
  // "<key>.0", "<key>.1", so match on the prefix rather than an exact key.
  const TOKEN_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  const hasStoredSession = () => {
    try {
      return Object.keys(localStorage).some((k) => k.startsWith(TOKEN_KEY));
    } catch { return false; }
  };

  // Ask the browser to keep our storage; without this iOS can evict
  // script-written storage after a stretch of not opening the app.
  navigator.storage?.persist?.().catch(() => {});

  function bootMsg(text) { $('#boot-msg').textContent = text || ''; }

  function waitingForNetwork() {
    $('#boot').hidden = false;
    $('#auth').hidden = true;
    $('#app').hidden = true;
    bootMsg('Reconnecting… you are still signed in.');
  }

  // Resolve the session without ever giving up because of the network.
  async function resolveSession({ retries = 4 } = {}) {
    for (let i = 0; i < retries; i++) {
      const { data: { session } } = await sb.auth.getSession().catch(() => ({ data: {} }));
      if (session) return session;

      // No usable session. If nothing was ever stored, they are simply logged out.
      if (!hasStoredSession()) return null;

      // Something IS stored, so this is a refresh that has not landed yet.
      const { data, error } = await sb.auth.refreshSession().catch((e) => ({ error: e }));
      if (data?.session) return data.session;

      // A server that explicitly rejects the token means really signed out.
      const status = error?.status;
      if (status === 400 || status === 401 || status === 403) return null;

      waitingForNetwork();
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
    return 'offline';
  }

  async function restore() {
    const session = await resolveSession();
    if (session === 'offline') {
      waitingForNetwork();
      return;
    }
    if (session) await enterApp(session);
    else showAuth();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { showAuth(); return; }
    if (session?.user) state.user = session.user;   // TOKEN_REFRESHED, SIGNED_IN
  });

  // Coming back to the app: refresh data, and recover the session if it lapsed.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (state.user) loadAll();
    else if (hasStoredSession()) restore();
  });
  window.addEventListener('online', () => {
    if (state.user) loadAll(); else if (hasStoredSession()) restore();
  });

  restore();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
