import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './db.js';
import { migrate } from './migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// GET /api/todos - list all todos
app.get('/api/todos', async (_req, res) => {
  const result = await pool.query('SELECT * FROM todos ORDER BY id');
  res.json(result.rows);
});

// POST /api/todos - create a todo
app.post('/api/todos', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const result = await pool.query(
    'INSERT INTO todos (text) VALUES ($1) RETURNING *',
    [text]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/todos/:id/toggle - toggle completed
app.patch('/api/todos/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    'UPDATE todos SET completed = NOT completed WHERE id = $1 RETURNING *',
    [parseInt(id)]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json(result.rows[0]);
});

// DELETE /api/todos/:id - delete a todo
app.delete('/api/todos/:id', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    'DELETE FROM todos WHERE id = $1 RETURNING *',
    [parseInt(id)]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json({ deleted: true });
});

const PORT = parseInt(process.env.PORT || '3005');

async function start() {
  await migrate();
  app.listen(PORT, () => {
    console.log(`Todo app listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
