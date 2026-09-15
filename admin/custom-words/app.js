import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { firebaseConfig, apiBase } from './config.js';

const $ = id => document.getElementById(id);
const auth = getAuth(initializeApp(firebaseConfig));
await setPersistence(auth, browserSessionPersistence);
let next = null, generation = 0, authorized = false, loading = false, paged = false;
const message = text => { $('message').textContent = text; };
async function api(path, body) {
  if (!auth.currentUser) throw new Error('로그인이 필요합니다.');
  const token = await auth.currentUser.getIdToken();
  const result = await fetch(`${apiBase}/${path}`, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', credentials: 'omit' });
  const data = await result.json();
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      authorized = false; $('dashboard').hidden = true; $('words').replaceChildren();
    }
    throw new Error(data.error || '요청에 실패했습니다.');
  }
  return data;
}
function renderItem(item) {
  const row = document.createElement('article'); row.className = 'row';
  const details = document.createElement('div');
  const name = document.createElement('div'); name.className = 'word'; name.textContent = item.word;
  const state = document.createElement('div'); state.className = 'state';
  state.textContent = ({ complete: '음성 준비 완료', processing: '음성 생성 중', error: '음성 준비 실패 · 재시도 가능' })[item.ttsStatus] || '음성 준비 대기';
  details.append(name, state);
  const actions = document.createElement('div'); actions.className = 'actions';
  for (const [action, label, className] of [['approve', '승인', 'primary'], ['reject', '거절', 'reject'], ['retry', '음성 재시도', '']]) {
    if (action === 'retry' && !['error', 'not-started'].includes(item.ttsStatus)) continue;
    const button = document.createElement('button'); button.textContent = label; button.className = className;
    button.disabled = action === 'approve' && item.ttsStatus !== 'complete';
    button.setAttribute('aria-label', `${item.word} ${label}`);
    button.onclick = async () => {
      actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try { await api('moderate', { id: item.id, action, version: item.version }); message(`${item.word} 처리 완료`); }
      catch (error) { message(error.message); }
      finally { await load(false); }
    };
    actions.append(button);
  }
  row.append(details, actions); return row;
}
async function load(append = false) {
  if (!authorized || loading) return;
  loading = true; $('refresh').disabled = true; $('more').disabled = true;
  const requestGeneration = generation;
  try {
    const query = new URLSearchParams({ status: $('filter').value });
    if (append && next) query.set('after', next);
    const data = await api(`list?${query}`);
    if (requestGeneration !== generation || !authorized) return;
    paged = append;
    if (!append) $('words').replaceChildren();
    data.items.forEach(item => $('words').append(renderItem(item)));
    if (!$('words').children.length) $('words').textContent = '이 목록에 단어가 없습니다.';
    next = data.next; $('more').hidden = !next;
  } catch (error) { message(error.message); }
  finally {
    loading = false; $('refresh').disabled = false; $('more').disabled = false;
    if (requestGeneration !== generation && authorized) void load();
  }
}
$('login').onsubmit = async event => {
  event.preventDefault(); message('');
  const button = $('login').querySelector('button'); button.disabled = true;
  try { await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value); $('password').value = ''; }
  catch { message('로그인하지 못했습니다. 계정과 비밀번호를 확인해 주세요.'); }
  finally { button.disabled = false; }
};
$('logout').onclick = () => signOut(auth);
$('verify').onclick = async () => {
  $('verify').disabled = true;
  try {
    if (auth.currentUser && !auth.currentUser.emailVerified) await sendEmailVerification(auth.currentUser);
    message('이메일의 인증 링크를 연 뒤 로그아웃하고 다시 로그인해 주세요.');
  } catch { message('인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  finally { $('verify').disabled = false; }
};
$('refresh').onclick = () => load();
$('more').onclick = () => load(true);
$('filter').onchange = () => { generation++; next = null; void load(); };
onAuthStateChanged(auth, async user => {
  generation++; authorized = false; next = null; $('words').replaceChildren();
  $('login').hidden = !!user; $('logout').hidden = !user; $('dashboard').hidden = true;
  $('verify').hidden = !user || user.emailVerified;
  if (!user) return;
  try {
    const token = await user.getIdTokenResult(true);
    if (token.claims.customWordAdmin !== true || !user.emailVerified) throw new Error('관리자 권한과 이메일 인증을 확인해 주세요.');
    authorized = true; $('dashboard').hidden = false; message(''); await load();
  } catch (error) { message(error.message); }
});
// Refresh only the first page automatically; do not replace a user's paginated review.
setInterval(() => { if (!document.hidden && !paged && authorized) void load(); }, 30000);
