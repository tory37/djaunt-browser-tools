import { getAccessToken, isSignedIn, signOut } from './auth.js';
import { loadRemote, remoteModifiedTime, saveRemote } from './drive.js';
import { addTodo, clearCompleted, mergeTodos, removeTodo, sortTodos, toggleTodo } from './todos.js';

const api = globalThis.browser ?? globalThis.chrome;

const CACHE_KEY = 'todoDriveCache';
const SAVE_DEBOUNCE_MS = 600;

const elements = {
  head: document.getElementById('head'),
  pill: document.getElementById('pill'),
  signedOut: document.getElementById('signed-out'),
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

let state = { fileId: null, modifiedTime: null, todos: [] };
let saveTimer = null;
let saveToken = 0;

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', isError);
}

function setPresence(signedIn) {
  elements.head.dataset.state = signedIn ? 'active' : 'idle';
  elements.pill.dataset.state = signedIn ? 'active' : 'idle';
  elements.pill.textContent = signedIn ? 'synced' : 'signed out';
  elements.signedOut.hidden = signedIn;
  elements.signedIn.hidden = !signedIn;
}

async function readCache() {
  const stored = await api.storage.local.get(CACHE_KEY);
  return stored[CACHE_KEY] ?? { fileId: null, modifiedTime: null, todos: [] };
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
    if (state.fileId) {
      const current = await remoteModifiedTime(state.fileId);
      if (current !== state.modifiedTime) {
        // Someone else (another device) changed the file since we last synced —
        // fold their copy in rather than overwriting it.
        const remote = await loadRemote();
        state.todos = mergeTodos(state.todos, remote.todos);
        if (token !== saveToken) return; // a newer edit landed while we were merging
        render();
      }
    }
    const saved = await saveRemote({ fileId: state.fileId, todos: state.todos });
    if (token !== saveToken) return; // superseded by a newer edit
    state.fileId = saved.id;
    state.modifiedTime = saved.modifiedTime;
    await writeCache();
    setStatus('Saved to Drive');
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
  setStatus('Opening Google sign-in…');
  try {
    await getAccessToken({ interactive: true });
    await enterSignedIn();
  } catch (error) {
    setStatus(`Sign-in failed: ${error.message}`, true);
  } finally {
    elements.signIn.disabled = false;
  }
});

elements.signOut.addEventListener('click', async () => {
  await signOut();
  await api.storage.local.remove(CACHE_KEY);
  state = { fileId: null, modifiedTime: null, todos: [] };
  render();
  setPresence(false);
  setStatus('');
});

async function enterSignedIn() {
  setPresence(true);
  state = await readCache();
  render();
  setStatus('Syncing…');
  try {
    const remote = await loadRemote();
    state.fileId = remote.fileId;
    state.modifiedTime = remote.modifiedTime;
    state.todos = mergeTodos(state.todos, remote.todos);
    render();
    await writeCache();
    setStatus('Up to date');
  } catch (error) {
    setStatus(`Couldn't reach Drive: ${error.message}`, true);
  }
}

async function init() {
  if (await isSignedIn()) {
    await enterSignedIn();
  } else {
    setPresence(false);
  }
}

init();
