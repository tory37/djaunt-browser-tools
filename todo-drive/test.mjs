import {
  addTodo, clearCompleted, mergeTodos, removeTodo, sortTodos, toggleTodo,
} from './todos.js';

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  if (actual === expected) { pass += 1; return; }
  failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
}

function checkThrows(label, fn) {
  try {
    fn();
    failures.push(`${label}\n    expected a throw, got none`);
  } catch {
    pass += 1;
  }
}

function texts(todos) {
  return todos.map((todo) => todo.text).join('|');
}

// ---- add ----

check('add appends a trimmed todo', texts(addTodo([], '  Buy milk  ')), 'Buy milk');
checkThrows('add rejects empty text', () => addTodo([], '   '));

const withOne = addTodo([], 'first');
const id = withOne[0].id;
check('add gives each todo a unique id', typeof id, 'string');
check('add marks a new todo not done', withOne[0].done, false);

// ---- toggle / remove ----

check('toggle flips done', toggleTodo(withOne, id)[0].done, true);
check('toggle again flips back', toggleTodo(toggleTodo(withOne, id), id)[0].done, false);
check('toggle leaves other ids alone', texts(toggleTodo(withOne, 'missing')), 'first');
check('remove drops the matching id', removeTodo(withOne, id).length, 0);
check('remove leaves other ids alone', texts(removeTodo(withOne, 'missing')), 'first');

// ---- clearCompleted ----

let two = addTodo(addTodo([], 'a'), 'b');
two = toggleTodo(two, two[0].id);
check('clearCompleted drops only done todos', texts(clearCompleted(two)), 'b');

// ---- sortTodos ----

const older = { id: '1', text: 'older', done: false, createdAt: 1 };
const newer = { id: '2', text: 'newer', done: false, createdAt: 2 };
const done = { id: '3', text: 'done', done: true, createdAt: 0 };
check('sortTodos keeps open items in creation order', texts(sortTodos([newer, older])), 'older|newer');
check('sortTodos puts done items after open ones', texts(sortTodos([done, older])), 'older|done');

// ---- mergeTodos ----

const localOnly = { id: 'l', text: 'local', done: false, createdAt: 1 };
const remoteOnly = { id: 'r', text: 'remote', done: false, createdAt: 2 };
const editedLocally = { id: 'shared', text: 'local edit', done: true, createdAt: 0 };
const editedRemotely = { id: 'shared', text: 'remote edit', done: false, createdAt: 0 };

const merged = mergeTodos([localOnly, editedLocally], [remoteOnly, editedRemotely]);
check('mergeTodos keeps a local-only todo', merged.some((t) => t.id === 'l'), true);
check('mergeTodos keeps a remote-only todo', merged.some((t) => t.id === 'r'), true);
check(
  'mergeTodos prefers the local version of a todo edited on both sides',
  merged.find((t) => t.id === 'shared').text,
  'local edit',
);

console.log(`${pass} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`\nFAIL: ${failure}`);
if (failures.length > 0) process.exit(1);
