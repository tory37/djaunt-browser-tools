/** Pure list operations — no browser or network API, so this file is unit-testable on its own. */

export function newTodo(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Todo text is required');
  return { id: crypto.randomUUID(), text: trimmed, done: false, createdAt: Date.now() };
}

export function addTodo(todos, text) {
  return [...todos, newTodo(text)];
}

export function toggleTodo(todos, id) {
  return todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo));
}

export function removeTodo(todos, id) {
  return todos.filter((todo) => todo.id !== id);
}

export function clearCompleted(todos) {
  return todos.filter((todo) => !todo.done);
}

/** Open items first (oldest first), then done items (oldest first). */
export function sortTodos(todos) {
  return [...todos].sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt);
}

/**
 * Merges a remote list into a local one after a conflicting Drive write, keyed by id.
 * A todo edited on either side beats one untouched since the last sync; a todo new on
 * one side is kept; nothing is silently dropped.
 */
export function mergeTodos(local, remote) {
  const byId = new Map(remote.map((todo) => [todo.id, todo]));
  for (const todo of local) byId.set(todo.id, todo);
  return sortTodos([...byId.values()]);
}
