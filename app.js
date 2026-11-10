/* Insert Note: the vending machine. Data lives in Supabase (see supabase/schema.sql). */
(() => {
const $ = id => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['green','pink','blue','yellow','violet'];
const CSSVAR = {green:'--n-green',pink:'--n-pink',blue:'--n-blue',yellow:'--n-yellow',violet:'--n-violet'};
const MAX_MINE = 3;
const str = (v,n) => String(v == null ? '' : v).slice(0,n);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wait = ms => new Promise(r => setTimeout(r, REDUCED ? 0 : ms));
const anim = (node, frames, ms, easing) => node.animate(frames, {duration: REDUCED ? 1 : ms, easing: easing || 'ease', fill: 'forwards'}).finished.catch(() => {});

const cfg = window.INSERT_NOTE_CONFIG || {};
const configured = !!(cfg.url && cfg.anonKey && !/YOUR-/.test(cfg.url + cfg.anonKey) && window.supabase);
const sb = configured ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;

/* ---- boxes: top row of six, then five rows of four beside the control panel ---- */
const SLOTS = [];
'ABCDEF'.split('').forEach((L, r) => { for (let c = 0; c < (r === 0 ? 6 : 4); c++) SLOTS.push({id: L + (c + 1), r, c}); });
const win = $('window'), cells = {};
SLOTS.forEach(s => {
  const b = el('button', 'cell'); b.type = 'button';
  b.style.gridRow = s.r + 1; b.style.gridColumn = s.c + 1;
  const cube = el('span', 'cube'); b.append(cube, el('span', 'tag', s.id));
  b.addEventListener('click', () => pick(s.id));
  win.insertBefore(b, win.firstChild); cells[s.id] = {b, cube, note: null};
});

/* ---- state ---- */
let me = null, gate = 'out', firstPaint = true, channel = null, poll = null;
let notes = new Map();            // id -> note
let mode = 'idle', sel = null, prize = null;

const clean = (r, secret) => ({ id: r.id,
  slot: str(r.slot, 3), activity: str(r.activity, 48), color: COLORS.includes(r.color) ? r.color : 'yellow',
  by: r.author, pulledBy: r.pulled_by || (r.pulled_at ? 'gone' : ''), at: Date.parse(r.created_at) || 0,
  name: secret ? str(secret.name, 20) : '', contact: secret ? str(secret.contact, 32) : '' });
const inMachine = () => { const m = {}; [...notes.values()].filter(n => !n.pulledBy && cells[n.slot]).sort((a, b) => a.at - b.at).forEach(n => { if (!m[n.slot]) m[n.slot] = n; }); return m; };
const tilt = id => ((id.charCodeAt(0) * 7 + id.charCodeAt(id.length - 1) * 13) % 9) - 4;

function render() {
  const m = inMachine();
  SLOTS.forEach(s => {
    const c = cells[s.id], n = m[s.id];
    const key = n ? n.id + '|' + n.activity + '|' + n.color : '';
    if (c.note !== key) {
      c.cube.textContent = '';
      c.b.classList.toggle('full', !!n);
      c.b.classList.remove('pop');
      if (n) {
        const p = el('span', 'note ' + n.color, n.activity); p.style.setProperty('--tilt', tilt(n.id) + 'deg'); c.cube.append(p);
        if (!firstPaint) { void c.b.offsetWidth; c.b.classList.add('pop'); }
      }
      c.note = key;
    }
    c.b.dataset.note = n ? n.id : '';
    c.b.classList.toggle('mine', !!n && n.by === me);
    c.b.classList.toggle('sel', !!n && sel === n.id && mode === 'selected');
    c.b.setAttribute('aria-label', n ? 'Box ' + s.id + ': ' + n.activity + (n.by === me ? ' (your note)' : '') : 'Box ' + s.id + ', empty');
    c.b.disabled = !n;
  });
  if (sel && mode === 'selected' && (!notes.get(sel) || notes.get(sel).pulledBy)) { sel = null; setMode('idle', 'Someone just pulled that note. Pick another.'); }
  if ($('dMine').open) renderMine();
}

function say(text, screen) { $('status').textContent = text; if (screen) $('screenMsg').textContent = screen; }
function setMode(m, text, screen) {
  mode = m;
  $('bPay').hidden = m !== 'selected'; $('bTake').hidden = m !== 'ready';
  $('pay').classList.toggle('armed', m === 'selected');
  $('tray').classList.toggle('has', m === 'ready');
  if (m === 'idle') { const count = Object.keys(inMachine()).length; say(text || (count ? 'Tap a note in the machine to pick it.' : 'The machine is empty. Leave the first note.'), count ? 'Tap a note' : 'Empty'); }
  else say(text, screen);
  SLOTS.forEach(s => cells[s.id].b.classList.toggle('sel', m === 'selected' && cells[s.id].b.dataset.note === sel));
}

/* ---- membership gate ---- */
function setGate(g, name, isAdmin) {
  gate = g;
  $('rowPlay').hidden = g !== 'in'; $('rowGate').hidden = g === 'in';
  $('bApply').hidden = $('bSignIn').hidden = g !== 'out';
  $('bRecheck').hidden = g !== 'pending';
  $('acct').hidden = g === 'out' || g === 'unset';
  $('adminWrap').hidden = !isAdmin;
  if (name != null) $('who').textContent = 'Signed in as ' + name;
  if (g === 'unset') { $('rowGate').hidden = true; say('This site is not connected to its database yet. Add the Supabase keys to config.js.', 'Offline'); }
  if (g === 'out') say('Members only. Apply to join, or sign in if you have been approved.', 'Members only');
  if (g === 'pending') say('Your application is in. You can use the machine as soon as you are approved.', 'Awaiting approval');
  if (g === 'blocked') say('This account does not have access to the machine.', 'No access');
  $('mode').textContent = g === 'in' ? 'Every member here was approved by hand. The $1 is pretend for now.' : '';
}
function needMember() { if (gate === 'in') return false; if (gate === 'out') openAuth('apply'); return true; }

async function onSession(session) {
  stopLive(); notes = new Map(); sel = null; prize = null; mode = 'idle'; render();
  $('bPay').hidden = $('bTake').hidden = true; $('tray').classList.remove('has'); $('pay').classList.remove('armed');
  if (!session) { me = null; return setGate('out'); }
  me = session.user.id;
  const {data: p, error} = await sb.from('profiles').select('display_name,status,is_admin').eq('id', me).maybeSingle();
  if (error || !p) { setGate('pending', session.user.email, false); if (error) say('Could not check your membership. Try "Check again" in a moment.'); return; }
  const name = p.display_name || session.user.email;
  if (p.status !== 'approved') return setGate(p.status === 'blocked' ? 'blocked' : 'pending', name, p.is_admin);
  setGate('in', name, p.is_admin);
  if ($('iName') && !$('iName').value) $('iName').value = p.display_name || '';
  await load(); firstPaint = false; setMode('idle');
  channel = sb.channel('machine').on('postgres_changes', {event: '*', schema: 'public', table: 'notes'}, () => load()).subscribe();
  poll = setInterval(load, 30000);
}
function stopLive() { if (channel) { sb.removeChannel(channel); channel = null; } if (poll) { clearInterval(poll); poll = null; } }

let loading = null;
function load() {
  if (loading) return loading;
  loading = (async () => {
    const [n, s] = await Promise.all([
      sb.from('notes').select('id,slot,activity,color,author,pulled_by,pulled_at,created_at'),
      sb.from('note_secrets').select('note_id,name,contact')]);
    if (n.error) { say('Could not reach the machine. Retrying shortly.'); return; }
    const secrets = new Map((s.data || []).map(x => [x.note_id, x]));
    notes = new Map(n.data.map(r => [r.id, clean(r, secrets.get(r.id))]));
    render();
  })().finally(() => { loading = null; });
  return loading;
}

/* ---- picking and paying ---- */
function pick(slotId) {
  if (needMember() || mode === 'busy' || mode === 'ready') return;
  const n = inMachine()[slotId]; if (!n) return;
  if (n.by === me) { sel = null; setMode('idle', 'Box ' + slotId + ' is your own note. You can take it back from My notes.'); return; }
  sel = n.id; setMode('selected', 'Box ' + slotId + ': "' + n.activity + '". Insert $1 to get it.', slotId + '  $1.00');
}
function getRandom() {
  if (needMember() || mode === 'busy' || mode === 'ready') return;
  const pool = Object.values(inMachine()).filter(n => n.by !== me);
  if (!pool.length) { setMode('idle', 'No notes to pull right now. Leave one and check back.'); return; }
  pick(pool[Math.floor(Math.random() * pool.length)].slot);
}
async function pullNote(id) {
  const {data, error} = await sb.rpc('pull_note', {p_note: id});
  if (error) throw error;
  return data && data.length ? data[0] : null;
}
async function pay() {
  if (needMember()) return;
  if (mode === 'ready') return openPrize();
  if (mode !== 'selected') { if (mode === 'idle') setMode('idle', 'Pick a note first, then insert your dollar.'); return; }
  const n = notes.get(sel); if (!n) return setMode('idle');
  const cell = cells[n.slot], mrect = $('machine').getBoundingClientRect();
  const from = cell.cube.getBoundingClientRect();
  setMode('busy', 'Taking your dollar.', 'Reading bill');
  $('pay').classList.remove('armed');
  anim($('dial'), [{transform: 'rotate(0)'}, {transform: 'rotate(360deg)'}], 1100, 'ease-in-out');
  await anim($('bill'), [{opacity: 0, transform: 'translateY(5cqw)'}, {opacity: 1, transform: 'translateY(0)', offset: .35}, {opacity: 1, transform: 'translateY(-3.6cqw) scaleY(1)', offset: .6}, {opacity: 0, transform: 'translateY(-3.6cqw) scaleY(0)'}], 1200);
  let got = null;
  try { got = await pullNote(n.id); } catch (e) { sel = null; return setMode('idle', fail(e) + ' Your dollar is back.'); }
  if (!got) { sel = null; load(); return setMode('idle', 'Someone got to that note first. Your dollar is back.'); }
  n.pulledBy = me; n.name = str(got.name, 20); n.contact = str(got.contact, 32);
  say('Dropping box ' + n.slot + '.', 'Vending'); render();
  const to = $('tray').getBoundingClientRect();
  const f = el('div', 'fly'); f.style.background = 'var(' + CSSVAR[n.color] + ')';
  f.style.left = (from.left - mrect.left + from.width * .1) + 'px'; f.style.top = (from.top - mrect.top + from.height * .12) + 'px';
  f.style.width = from.width * .8 + 'px'; f.style.height = from.height * .76 + 'px';
  $('machine').append(f);
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2), dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  await anim(f, [{transform: 'translate(0,0) rotate(0)'}, {transform: 'translate(0,' + (dy * .15) + 'px) rotate(8deg)', offset: .2}, {transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(-200deg) scale(.6)'}], 950, 'cubic-bezier(.5,0,.85,.55)');
  f.remove();
  prize = n; sel = null;
  $('peek').style.background = 'var(' + CSSVAR[n.color] + ')';
  setMode('ready', 'Your note is in the tray. Take it.', 'Take your note');
}
function openPrize() { if (!prize) return; showNote(prize); prize = null; setMode('idle'); }
function showNote(n) {
  const box = $('prizeNote'); box.className = 'bignote ' + n.color; box.textContent = '';
  box.append(el('b', '', n.name || 'Someone'), document.createTextNode('is down for: ' + n.activity), el('span', 'c', n.contact));
  $('opener').textContent = 'Hey ' + (n.name || 'there') + ', I got your note from the vending machine. Still down for "' + n.activity + '"?';
  $('bCopy').textContent = 'Copy message';
  $('dPrize').showModal();
}

/* ---- leaving a note ---- */
function fail(e) {
  const m = (e && e.message) || '';
  if (/not_approved/.test(m)) return 'Your membership is not approved yet.';
  if (/limit/.test(m)) return 'You already have ' + MAX_MINE + ' notes in the machine. Take one back first.';
  if (/slot_taken/.test(m)) return 'That box was just filled. Try again.';
  return 'The machine could not be reached. Try again in a moment.';
}
function openLeave() {
  if (needMember() || mode === 'busy') return;
  $('leaveErr').textContent = '';
  $('dLeave').showModal(); ($('iName').value ? $('iAct') : $('iName')).focus();
}
$('fLeave').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = $('iName').value.trim(), activity = $('iAct').value.trim(), contact = $('iContact').value.trim();
  const color = (document.querySelector('input[name=color]:checked') || {}).value || 'yellow';
  const err = $('leaveErr');
  if (!name) { err.textContent = 'Add your first name.'; return $('iName').focus(); }
  if (activity.length < 3) { err.textContent = 'Add one thing you would do, like "Coffee at Rebel".'; return $('iAct').focus(); }
  if (contact.length < 3) { err.textContent = 'Add a phone number or handle so they can reach you.'; return $('iContact').focus(); }
  const m = inMachine();
  if (Object.values(m).filter(n => n.by === me).length >= MAX_MINE) { err.textContent = 'You already have ' + MAX_MINE + ' notes in the machine. Take one back first.'; return; }
  const free = SLOTS.filter(s => !m[s.id]).map(s => s.id).sort(() => Math.random() - .5);
  if (!free.length) { err.textContent = 'Every box is full. Pull a note to make room.'; return; }
  $('dLeave').close();
  const was = mode; if (was === 'idle') mode = 'busy';
  say('Feeding your note into the slot.', 'Reading note');
  const feed = $('feed'); feed.style.background = 'var(' + CSSVAR[color] + ')';
  await anim(feed, [{opacity: 0, transform: 'translateY(-26cqw) rotate(-6deg)'}, {opacity: 1, transform: 'translateY(-11cqw) rotate(-2deg)', offset: .45}, {opacity: 1, transform: 'translateY(0) scaleY(.5)', offset: .8}, {opacity: 0, transform: 'translateY(0) scaleY(.05)'}], 1100, 'ease-in');
  $('slot').classList.remove('flash'); void $('slot').offsetWidth; $('slot').classList.add('flash');
  let slot = null, lastErr = null;
  for (const tryId of free.slice(0, 3)) {               // another member may fill a box first: try up to three
    const {error} = await sb.rpc('leave_note', {p_slot: tryId, p_activity: activity, p_color: color, p_name: name, p_contact: contact});
    if (!error) { slot = tryId; break; }
    lastErr = error; if (!/slot_taken/.test(error.message || '')) break;
  }
  if (was === 'idle') mode = 'idle';
  if (!slot) return was === 'idle' ? setMode('idle', fail(lastErr)) : say(fail(lastErr));
  await load(); $('iAct').value = '';
  if (was === 'idle') setMode('idle', 'Your note is in box ' + slot + '. Someone can pull it now.'); else say('Your note is in box ' + slot + '.');
});

/* ---- my notes ---- */
function renderMine() {
  const all = [...notes.values()].sort((a, b) => b.at - a.at);
  const left = all.filter(n => n.by === me), got = all.filter(n => n.pulledBy === me);
  const L = $('lLeft'), G = $('lGot'); L.textContent = ''; G.textContent = '';
  if (!left.length) L.append(el('li', 'empty', 'Nothing yet. Leave a note to get started.'));
  left.forEach(n => {
    const li = el('li'); li.style.setProperty('--c', 'var(' + CSSVAR[n.color] + ')');
    const t = el('span', 't', n.activity); t.append(el('small', '', n.pulledBy ? 'Someone has it. Expect a message.' : 'Waiting in box ' + n.slot));
    const b = el('button', 'btn', n.pulledBy ? 'Clear' : 'Take back'); b.type = 'button';
    b.addEventListener('click', async () => { b.disabled = true; const {error} = await sb.from('notes').delete().eq('id', n.id); if (error) { b.disabled = false; say(fail(error)); } else load(); });
    li.append(t, el('span', 'pill' + (n.pulledBy ? ' out' : ''), n.pulledBy ? 'Pulled' : 'In machine'), b); L.append(li);
  });
  if (!got.length) G.append(el('li', 'empty', 'You have not pulled a note yet.'));
  got.forEach(n => {
    const li = el('li'); li.style.setProperty('--c', 'var(' + CSSVAR[n.color] + ')');
    const t = el('span', 't', (n.name || 'Someone') + ': ' + n.activity); t.append(el('small', '', n.contact));
    const b = el('button', 'btn', 'Open'); b.type = 'button'; b.addEventListener('click', () => { $('dMine').close(); showNote(n); });
    li.append(t, b); G.append(li);
  });
}
function openMine() { if (needMember()) return; renderMine(); $('dMine').showModal(); }

/* ---- sign in / apply ---- */
let authMode = 'apply';
function openAuth(m) {
  if (!sb) return;
  authMode = m; const apply = m === 'apply';
  $('tabApply').setAttribute('aria-pressed', apply); $('tabIn').setAttribute('aria-pressed', !apply);
  $('aNameWrap').hidden = !apply; $('authGo').textContent = apply ? 'Send application' : 'Sign in';
  $('aPass').autocomplete = apply ? 'new-password' : 'current-password';
  $('authHint').textContent = apply ? 'Every member is approved by hand before they can use the machine.' : 'Sign in with the email you applied with.';
  $('authErr').textContent = '';
  if (!$('dAuth').open) $('dAuth').showModal();
  (apply ? $('aName') : $('aEmail')).focus();
}
$('tabApply').addEventListener('click', () => openAuth('apply')); $('tabIn').addEventListener('click', () => openAuth('in'));
$('fAuth').addEventListener('submit', async ev => {
  ev.preventDefault();
  const err = $('authErr'), email = $('aEmail').value.trim(), password = $('aPass').value, name = $('aName').value.trim();
  if (authMode === 'apply' && !name) { err.textContent = 'Add your first name.'; return $('aName').focus(); }
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Enter a valid email address.'; return $('aEmail').focus(); }
  if (password.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return $('aPass').focus(); }
  $('authGo').disabled = true; err.textContent = '';
  const res = authMode === 'apply'
    ? await sb.auth.signUp({email, password, options: {data: {display_name: name}, emailRedirectTo: location.origin + location.pathname}})
    : await sb.auth.signInWithPassword({email, password});
  $('authGo').disabled = false;
  if (res.error) { err.textContent = res.error.message; return; }
  $('aPass').value = '';
  $('dAuth').close();
  if (authMode === 'apply' && !res.data.session) say('Almost there. Open the confirmation link we emailed you, then sign in.', 'Check email');
});

/* ---- wiring ---- */
$('pay').addEventListener('click', pay); $('bPay').addEventListener('click', pay);
$('tray').addEventListener('click', () => { if (needMember()) return; mode === 'ready' ? openPrize() : (mode === 'idle' && setMode('idle', 'The tray is empty. Pick a note and insert $1.')); });
$('bTake').addEventListener('click', openPrize);
$('slot').addEventListener('click', openLeave); $('bLeave').addEventListener('click', openLeave); $('tLeave').addEventListener('click', openLeave);
$('tGet').addEventListener('click', getRandom);
$('tMine').addEventListener('click', openMine); $('bMine').addEventListener('click', openMine);
['tHow', 'bHow', 'bHow2'].forEach(id => $(id).addEventListener('click', () => $('dHow').showModal()));
$('bApply').addEventListener('click', () => openAuth('apply')); $('bSignIn').addEventListener('click', () => openAuth('in'));
$('bRecheck').addEventListener('click', async () => { const {data} = await sb.auth.getSession(); onSession(data.session); });
$('bOut').addEventListener('click', () => sb.auth.signOut());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
$('bCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('opener').textContent); $('bCopy').textContent = 'Copied'; } catch (e) { $('bCopy').textContent = 'Select the text to copy'; } });
const tick = () => { const d = new Date(); $('clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
tick(); setInterval(tick, 30000);

/* ---- boot ---- */
render();
if (!sb) setGate('unset');
else {
  setGate('out');
  let lastUid;
  sb.auth.onAuthStateChange((event, session) => {
    const uid = session ? session.user.id : null;
    if (uid === lastUid && event !== 'SIGNED_OUT') return;      // token refreshes do not restart the machine
    lastUid = uid; setTimeout(() => onSession(session), 0);
  });
}

/* ---- light rain ---- */
(() => {
  const cv = $('rain'); if (REDUCED) return; const cx = cv.getContext('2d'); let W, H, drops = [];
  const size = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; drops = Array.from({length: Math.min(90, Math.round(W / 9))}, () => ({x: Math.random() * W, y: Math.random() * H, l: 8 + Math.random() * 14, v: 7 + Math.random() * 6})); };
  size(); addEventListener('resize', size);
  (function frame() { cx.clearRect(0, 0, W, H); cx.strokeStyle = 'rgba(235,242,248,.5)'; cx.lineWidth = 1; cx.beginPath();
    drops.forEach(d => { cx.moveTo(d.x, d.y); cx.lineTo(d.x - 1.5, d.y + d.l); d.y += d.v; if (d.y > H) { d.y = -d.l; d.x = Math.random() * W; } });
    cx.stroke(); requestAnimationFrame(frame); })();
})();
})();
