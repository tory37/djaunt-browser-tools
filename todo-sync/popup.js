import { beginSignIn, getPendingDeviceFlow, getStoredToken, pollOnce, signOut } from './github-auth.js';
import { loadRemote, saveRemote } from './github-store.js';
import { addTodo, clearCompleted, mergeTodos, removeTodo, sortTodos, toggleTodo } from './todos.js';

const api = globalThis.browser ?? globalThis.chrome;

const CACHE_KEY = 'todoSyncCache';
const SAVE_DEBOUNCE_MS = 600;

const elements = {
  head: document.getElementById('head'),
  pill: document.getElementById('pill'),
  signedOut: document.getElementById('signed-out'),
  deviceCode: document.getElementById('device-code'),
  deviceCodeValue: document.getElementById('device-code-value'),
  deviceCodeStatus: document.getElementById('device-code-status'),
  reopenGithub: document.getElementById('reopen-github'),
  signedIn: document.getElementById('signed-in'),
  signIn: document.getElementById('sign-in'),
  signOut: document.getElementById('sign-out'),
  addForm: document.getElementById('add-form'),
  addInput: document.getElementById('add-input'),
  list: document.getElementById('todo-list'),
  emptyHint: document.getElementById('empty-hint'),
  clearCompleted: document.getElementById('clear-completed'),
  status: document.getElementById('status'),
};

let state = { owner: null, sha: null, todos: [] };
let saveTimer = null;
let saveToken = 0;
let pollTimer = null;

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', isError);
}

function showPanel(name) {
  elements.signedOut.hidden = name !== 'signed-out';
  elements.deviceCode.hidden = name !== 'device-code';
  elements.signedIn.hidden = name !== 'signed-in';
}

function setPresence(signedIn) {
  elements.head.dataset.state = signedIn ? 'active' : 'idle';
  elements.pill.dataset.state = signedIn ? 'active' : 'idle';
  elements.pill.textContent = signedIn ? 'synced' : 'signed out';
}

async function readCache() {
  const stored = await api.storage.local.get(CACHE_KEY);
  return stored[CACHE_KEY] ?? { owner: null, sha: null, todos: [] };
}

async function writeCache() {
  await api.storage.local.set({ [CACHE_KEY]: state });
}

function render() {
  const sorted = sortTodos(state.todos);
  elements.list.innerHTML = '';
  for (const todo of sorted) {
    const item = document.createElement('li');
    item.className = 'todo-item';
    item.dataset.done = String(todo.done);
    item.dataset.id = todo.id;

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'todo-check';
    check.setAttribute('aria-label', todo.done ? 'Mark as not done' : 'Mark as done');
    check.addEventListener('click', () => handleToggle(todo.id));

    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'todo-remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', 'Delete');
    remove.addEventListener('click', () => handleRemove(todo.id));

    item.append(check, text, remove);
    elements.list.append(item);
  }
  elements.emptyHint.hidden = sorted.length > 0;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  const token = ++saveToken;
  saveTimer = setTimeout(() => save(token), SAVE_DEBOUNCE_MS);
}

async function save(token) {
  try {
    setStatus('Saving…');
    const result = await saveRemote({ owner: state.owner, sha: state.sha, todos: state.todos });
    if (token !== saveToken) return; // superseded by a newer edit

    if (result.conflict) {
      // Someone else (another device) changed the file since we last synced — fold
      // their copy in rather than overwriting it, then retry the save.
      const remote = await loadRemote();
      state.sha = remote.sha;
      state.todos = mergeTodos(state.todos, remote.todos);
      render();
      return save(token);
    }

    state.sha = result.sha;
    await writeCache();
    setStatus('Saved to GitHub');
  } catch (error) {
    setStatus(`Couldn't save: ${error.message}`, true);
  }
}

function handleToggle(id) {
  state.todos = toggleTodo(state.todos, id);
  render();
  writeCache();
  scheduleSave();
}

function handleRemove(id) {
  state.todos = removeTodo(state.todos, id);
  render();
  writeCache();
  scheduleSave();
}

elements.addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = elements.addInput.value;
  if (!text.trim()) return;
  state.todos = addTodo(state.todos, text);
  elements.addInput.value = '';
  render();
  writeCache();
  scheduleSave();
});

elements.clearCompleted.addEventListener('click', () => {
  state.todos = clearCompleted(state.todos);
  render();
  writeCache();
  scheduleSave();
});

elements.signIn.addEventListener('click', async () => {
  elements.signIn.disabled = true;
  try {
    const pending = await beginSignIn();
    showDeviceCode(pending);
    startPolling(pending);
  } catch (error) {
    setStatus(`Sign-in failed: ${error.message}`, true);
  } finally {
    elements.signIn.disabled = false;
  }
});

elements.reopenGithub.addEventListener('click', async () => {
  const pending = await getPendingDeviceFlow();
  if (pending) await api.tabs.create({ url: pending.verificationUri });
});

elements.signOut.addEventListener('click', async () => {
  await signOut();
  await api.storage.local.remove(CACHE_KEY);
  state = { owner: null, sha: null, todos: [] };
  render();
  setPresence(false);
  showPanel('signed-out');
  setStatus('');
});

function showDeviceCode(pending) {
  showPanel('device-code');
  elements.deviceCodeValue.textContent = pending.userCode;
  elements.deviceCodeStatus.textContent = 'Waiting for you to authorize…';
}

function startPolling(pending) {
  clearTimeout(pollTimer);
  const tick = async () => {
    try {
      const result = await pollOnce(pending);
      if (result.done) {
        await enterSignedIn();
        return;
      }
      pending.interval = result.interval;
      pollTimer = setTimeout(tick, pending.interval * 1000);
    } catch (error) {
      elements.deviceCodeStatus.textContent = error.message;
    }
  };
  // Polls right away rather than waiting a full interval first — if the popup was
  // closed and reopened after the user already authorized on github.com, this
  // notices immediately instead of leaving them staring at a stale code.
  tick();
}

async function enterSignedIn() {
  clearTimeout(pollTimer);
  showPanel('signed-in');
  setPresence(true);
  state = await readCache();
  render();
  setStatus('Syncing…');
  try {
    const remote = await loadRemote();
    state.owner = remote.owner;
    state.sha = remote.sha;
    state.todos = mergeTodos(state.todos, remote.todos);
    render();
    await writeCache();
    setStatus('Up to date');
  } catch (error) {
    setStatus(`Couldn't reach GitHub: ${error.message}`, true);
  }
}

async function init() {
  if (await getStoredToken()) {
    await enterSignedIn();
    return;
  }
  const pending = await getPendingDeviceFlow();
  if (pending) {
    showDeviceCode(pending);
    startPolling(pending);
    return;
  }
  showPanel('signed-out');
  setPresence(false);
}

init();
