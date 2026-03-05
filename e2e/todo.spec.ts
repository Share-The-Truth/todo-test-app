import { test, expect } from '@playwright/test';

test('page loads with correct title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Todo App');
});

test('can type in the input field', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('#todo-input');
  await input.fill('Buy groceries');
  await expect(input).toHaveValue('Buy groceries');
});

test('shows empty list initially', async ({ page }) => {
  await page.goto('/');
  const items = page.locator('.todo-item');
  await expect(items).toHaveCount(0);
});

test('newly added todo appears without page refresh', async ({ page }) => {
  await page.goto('/');
  const input = page.locator('#todo-input');
  await input.fill('Buy groceries');
  await page.locator('.add-form button').click();

  // The todo should appear in the list immediately
  const items = page.locator('.todo-item');
  await expect(items).toHaveCount(1);
  await expect(items.first().locator('span')).toHaveText('Buy groceries');
});
