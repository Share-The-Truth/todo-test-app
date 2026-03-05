import { describe, test, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = `http://localhost:${process.env.PORT || 3005}`;

// Postgres container and server are started via global-setup.ts

describe('Todo API', () => {
  let createdId: number;

  test('POST /api/todos creates a todo', async () => {
    const res = await fetch(`${BASE_URL}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test todo' }),
    });
    expect(res.status).toBe(201);
    const todo = await res.json();
    expect(todo.text).toBe('Test todo');
    expect(todo.completed).toBe(false);
    expect(todo.id).toBeDefined();
    createdId = todo.id;
  });

  test('GET /api/todos returns todos', async () => {
    const res = await fetch(`${BASE_URL}/api/todos`);
    expect(res.status).toBe(200);
    const todos = await res.json();
    expect(Array.isArray(todos)).toBe(true);
    expect(todos.some((t: any) => t.id === createdId)).toBe(true);
  });

  test('PATCH /api/todos/:id/toggle toggles completed', async () => {
    const res = await fetch(`${BASE_URL}/api/todos/${createdId}/toggle`, {
      method: 'PATCH',
    });
    expect(res.status).toBe(200);
    const todo = await res.json();
    expect(todo.completed).toBe(true);
  });

  test('DELETE /api/todos/:id deletes a todo', async () => {
    const res = await fetch(`${BASE_URL}/api/todos/${createdId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const check = await fetch(`${BASE_URL}/api/todos/${createdId}`, {
      method: 'DELETE',
    });
    expect(check.status).toBe(404);
  });
});
