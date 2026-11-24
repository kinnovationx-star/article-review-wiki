'use strict';

const endpoint = 'https://script.google.com/macros/s/AKfycbxDfG5_NEbTBy8hxAaWQ7a9j94mprWQ02XJkupCkdDENsEQmIvjikofIpH1btfCTm-T/exec';
const byId = id => document.getElementById(id);
const article = document.querySelector('article');
const panel = byId('panel');
const form = byId('form');
const message = byId('message');
const status = byId('status');
const quote = byId('quote');
let key;
let notes = [];
let notesRevision = 0;
const deleting = new Set();
let target;
let lastControl;
let pending;
const anchors = new Map();

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function register(node, id, runs, label) {
  node.classList.add('anchor');
  node.id = id;
  node.tabIndex = 0;
  node.setAttribute('aria-description', 'クリックまたは Enter キーでコメントを入力');
  anchors.set(id, { node, runs, label, text: runs.map(run => run.text).join('') });
}

function decorate() {
  for (const [id, {node, runs, text}] of anchors) {
    const ranges = notes.filter(note => note.anchor === id && text.slice(note.start, note.end) === note.quote);
    node.classList.toggle('has-note', ranges.length > 0);
    node.classList.toggle('active', target?.anchor === id && !panel.hidden);
    node.replaceChildren();
    let offset = 0;
    for (const run of runs) {
      const end = offset + run.text.length;
      const limits = [...new Set([offset, end, ...ranges.flatMap(n => [n.start, n.end]).filter(x => x > offset && x < end)])].sort((a,b) => a-b);
      const parent = run.url ? element('a') : node;
      if (run.url) {
        parent.href = run.url;
        parent.target = '_blank';
        parent.rel = 'noopener noreferrer';
        node.append(parent);
      }
      for (let i = 1; i < limits.length; i++) {
        const from = limits[i-1], to = limits[i];
        const part = text.slice(from, to);
        parent.append(ranges.some(n => n.start <= from && n.end >= to) ? element('mark', part) : document.createTextNode(part));
      }
      offset = end;
    }
  }
}

function attachParagraph(entry, title) {
  const paragraph = element('p');
  register(paragraph, entry.id, [{text:entry.text}], title);
  article.append(paragraph);
}

function attachEntries(entries, title) {
  const list = element('ul');
  list.className = 'article-entries';
  for (const entry of entries) {
    const text = entry.date ? entry.title + '（' + entry.date.split('-').map((part, i) =>
      Number(part) + ['年', '月', '日'][i]).join('') + '）' : entry.title;
    const item = element('li');
    const span = element('span');
    register(span, entry.id, [{text}], title);
    item.append(span);
    if (entry.date && !entry.dateVerified) {
      const dateKind = element('small', ' F6 Design掲載日');
      dateKind.className = 'entry-date-kind';
      item.append(dateKind);
    }
    list.append(item);
  }
  article.append(list);
}

function render(data) {
  function renderSection(group, depth = 2) {
    if (group.id !== 'intro') {
      const heading = element('h' + depth, group.title);
      heading.id = group.id;
      article.append(heading);
    }
    for (const entry of group.paragraphs ?? []) attachParagraph(entry, group.title);
    if (group.books) renderBooks(data.books);
    if (group.entries?.length) attachEntries(group.entries, group.title);
    if (group.links?.length) {
      const list = element('ul');
      for (const external of group.links) {
        const item = element('li');
        const link = element('a', external.label);
        link.href = external.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link);
        list.append(item);
      }
      article.append(list);
    }
    for (const child of group.subsections ?? []) renderSection(child, depth + 1);
  }

  if (data.profile) renderProfile(data.profile);
  for (const group of data.sections) renderSection(group);
  decorate();
}

function renderProfile(profile) {
  const table = element('table');
  table.className = 'profile-summary';
  const rows = table.createTBody();
  const [, name] = profile[0];
  const [fullName, reading] = name.split('（');
  const heading = element('th');
  heading.colSpan = 2;
  heading.className = 'profile-name';
  if (reading) heading.append(element('span', reading.replace('）', '')));
  heading.append(element('strong', fullName));
  rows.insertRow().append(heading);
  for (const [label, value, url] of profile.slice(1)) {
    const row = rows.insertRow();
    const labelCell = element('th', label);
    labelCell.scope = 'row';
    row.append(labelCell);
    const cell = row.insertCell();
    if (!url) cell.textContent = value;
    else {
      const link = element('a', value);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      cell.append(link);
    }
  }
  article.append(table);
}

function renderBooks(books) {
  const table = element('table');
  table.className = 'books-table';
  const head = table.createTHead().insertRow();
  for (const name of ['刊行年月','書名','出版社']) {
    const th = element('th', name);
    th.scope = 'col';
    head.append(th);
  }
  const body = table.createTBody();
  books.forEach((book, i) => {
    const row = body.insertRow();
    row.insertCell().textContent = book[0].text;
    // The title remains clickable for editing. The catalog link is a separate action.
    const cell = row.insertCell();
    const name = element('span');
    register(name, 'book-' + (i+1), [{text:book[1].text}], '著書一覧');
    const source = element('a',' 書誌');
    source.href = book[1].url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    cell.append(name, source);
    const publisher = row.insertCell();
    publisher.append(document.createTextNode(book[2].text));
    if (book[1].isbn) {
      const identifier = element('small', 'ISBN ' + book[1].isbn);
      identifier.className = 'book-isbn';
      publisher.append(identifier);
    }
  });
  article.append(table);
}

function capture(anchor) {
  const {node, text} = anchors.get(anchor);
  const selection = window.getSelection();
  let start = 0, end = text.length;
  if (selection?.rangeCount && !selection.isCollapsed) {
    const selected = selection.getRangeAt(0);
    if (!node.contains(selected.startContainer) || !node.contains(selected.endContainer)) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(node);
    prefix.setEnd(selected.startContainer, selected.startOffset);
    start = prefix.toString().length;
    end = start + selected.toString().length;
  }
  return {anchor, start, end, quote:text.slice(start,end)};
}

function refreshPanel() {
  byId('comments').replaceChildren();
  const relevant = target ? notes.filter(n => n.anchor === target.anchor) : notes;
  for (const note of relevant) {
    const item = element('section');
    const jump = element('button', anchors.has(note.anchor) ? anchors.get(note.anchor).label + 'の該当箇所へ' : '以前の原稿へのコメント');
    jump.disabled = !anchors.has(note.anchor);
    jump.type = 'button';
    jump.addEventListener('click', () => {
      if (!anchors.has(note.anchor)) return;
      show(note, jump);
      anchors.get(note.anchor).node.scrollIntoView({block:'center',behavior:'smooth'});
    });
    const when = element('time', new Date(note.created).toLocaleString('ja-JP'));
    when.dateTime = note.created;
    const remove = element('button', '削除');
    remove.type = 'button';
    remove.className = 'delete-comment';
    remove.disabled = deleting.has(note.id);
    remove.addEventListener('click', () => void deleteComment(note, remove));
    item.append(jump, element('p', '「' + note.quote + '」'), element('p', note.message), when, remove);
    byId('comments').append(item);
  }
  if (!relevant.length) byId('comments').append(element('p','コメントはまだありません。'));
}

function show(next, control) {
  if (next?.anchor !== target?.anchor || next?.start !== target?.start || next?.end !== target?.end) {
    pending = undefined;
    message.value = '';
  }
  target = next;
  if (panel.hidden) lastControl = control;
  panel.hidden = false;
  document.body.classList.add('panel-open');
  quote.hidden = !target;
  form.hidden = !target;
  quote.textContent = target?.quote ?? '';
  byId('panel-title').textContent = target ? '修正コメント' : 'コメント一覧';
  status.textContent = '';
  decorate();
  refreshPanel();
  (target ? message : byId('close')).focus({preventScroll:true});
}

function closePanel() {
  panel.hidden = true;
  document.body.classList.remove('panel-open');
  decorate();
  lastControl?.focus({preventScroll:true});
}

async function request(action, fields = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    headers: {'Content-Type': 'text/plain;charset=UTF-8'},
    body: JSON.stringify({key, action, ...fields})
  });
  if (!response.ok) throw new Error('コメントの通信に失敗しました。');
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.data;
}

async function sync() {
  const revision = notesRevision;
  try {
    const latest = await request('list');
    if (revision !== notesRevision) return;
    notes = latest;
    byId('sync').textContent = '';
    if (window.getSelection()?.isCollapsed !== false) decorate();
    if (!panel.hidden) refreshPanel();
  } catch {
    byId('sync').textContent = 'コメントを読み込めませんでした。ページを再読み込みしてください。';
  }
}

async function deleteComment(note, button) {
  if (deleting.has(note.id) || !window.confirm('このコメントを削除しますか？\n\n' + note.message)) return;
  deleting.add(note.id);
  button.disabled = true;
  status.textContent = '削除しています…';
  try {
    await request('delete', {id: note.id});
    notesRevision++;
    notes = notes.filter(item => item.id !== note.id);
    decorate();
    refreshPanel();
    status.textContent = 'コメントを削除しました。';
    (target ? message : byId('close')).focus({preventScroll:true});
  } catch {
    status.textContent = '削除できませんでした。もう一度お試しください。';
  } finally {
    deleting.delete(note.id);
    if (button.isConnected) button.disabled = false;
    else if (notes.some(item => item.id === note.id)) refreshPanel();
  }
}

for (const id of ['all','discuss']) byId(id).addEventListener('click', e => {show(null,e.currentTarget);void sync();});
byId('home').addEventListener('click', e => {e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});});
byId('share').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({review: key}).toString();
  try {
    await navigator.clipboard.writeText(url.href);
    byId('share').textContent = 'コピーしました';
  } catch {
    window.prompt('このURLをコピーしてください。', url.href);
  }
});
byId('close').addEventListener('click', closePanel);
document.addEventListener('keydown', e => {if(e.key === 'Escape' && !panel.hidden) closePanel();});
article.addEventListener('click', e => {
  const node = e.target.closest('.anchor');
  if (!node || e.target.closest('a')) return;
  const selected = capture(node.id);
  if (selected) show(selected, node);
});
article.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.anchor')) {
    const selected = capture(e.target.id);
    if (selected) show(selected,e.target);
  }
});
let selectionTimer;
document.addEventListener('selectionchange', () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const node = selection.anchorNode?.parentElement?.closest('.anchor');
    if (!node || !article.contains(node)) return;
    const selected = capture(node.id);
    if (selected) show(selected,node);
  }, 650);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!target || !message.value.trim()) return;
  const submit = form.querySelector('button');
  if (submit.disabled) return;
  const value = message.value.trim();
  if (!pending || pending.message !== value) pending = {...target,id:crypto.randomUUID(),message:value};
  const sending = pending;
  submit.disabled = true;
  status.textContent = '保存しています…';
  try {
    const saved = await request('save', {comment: sending});
    notesRevision++;
    if (!notes.some(n => n.id === saved.id)) notes.push(saved);
    if (pending === sending) {
      pending = undefined;
      message.value = '';
      status.textContent = 'コメントを保存しました。';
    }
    decorate();
    refreshPanel();
  } catch (error) {
    if (pending === sending) status.textContent = error.message === 'too_long'
      ? 'コメントが長すぎます。内容を分けて保存してください。'
      : '保存できませんでした。入力内容を残しました。もう一度お試しください。';
  } finally {
    submit.disabled = false;
  }
});

const decode64 = text => Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
(async function init() {
  const params = new URLSearchParams(location.hash.slice(1));
  const candidate = params.get('review');
  if (candidate) sessionStorage.setItem('review-key',candidate);
  key = candidate || sessionStorage.getItem('review-key');
  if (candidate) history.replaceState(null,'',location.pathname+location.search);
  try {
    if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error();
    const res = await fetch('article-v6.json');
    if (!res.ok) throw new Error();
    const file = await res.json();
    const cipherKey = await crypto.subtle.importKey('raw',decode64(key),'AES-GCM',false,['decrypt']);
    const raw = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(file.iv)},cipherKey,decode64(file.data));
    render(JSON.parse(new TextDecoder().decode(raw)));
    byId('access').hidden = true;
    byId('layout').hidden = false;
    byId('all').hidden = false;
    byId('share').hidden = false;
    void sync();
  } catch {
    byId('access').textContent = '確認用の共有リンクから開いてください。';
  }
})();

function bindToggle(buttonId, contentId) {
  const button = byId(buttonId);
  const content = byId(contentId);
  button.addEventListener('click', () => {
    content.hidden = !content.hidden;
    button.setAttribute('aria-expanded', String(!content.hidden));
    if (buttonId !== 'menu') button.textContent = content.hidden ? '表示' : '非表示';
  });
}

bindToggle('menu', 'menu-items');
bindToggle('toc-toggle', 'toc-links');
bindToggle('appearance-toggle', 'appearance-options');
byId('menu-items').addEventListener('click', event => {
  if (event.target.closest('a')) byId('menu').click();
});
byId('toc-links').addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  byId('toc-links').querySelector('.current')?.classList.remove('current');
  link.classList.add('current');
});

byId('appearance-options').addEventListener('change', event => {
  const {name, value} = event.target;
  if (['text', 'width', 'theme'].includes(name)) document.documentElement.dataset[name] = value;
});

byId('review-edit').addEventListener('click', event => {
  const first = anchors.keys().next().value;
  if (first) {
    show(capture(first), event.currentTarget);
    status.textContent = '該当箇所をクリックするか、文章を選択して修正を提案できます。';
  }
});

byId('article-search').addEventListener('submit', event => {
  event.preventDefault();
  const results = byId('search-results');
  const query = byId('search-input').value.trim().toLocaleLowerCase('ja');
  results.replaceChildren();
  if (!query) return;
  const hits = [...anchors].filter(([,entry]) => entry.text.toLocaleLowerCase('ja').includes(query)).slice(0, 12);
  for (const [id, entry] of hits) {
    const link = element('a', entry.label + ' — ' + entry.text.slice(0, 58));
    link.href = '#' + id;
    link.addEventListener('click', () => { results.hidden = true; });
    results.append(link);
  }
  if (!hits.length) results.append(element('p', '一致する項目はありません。'));
  results.hidden = false;
});
