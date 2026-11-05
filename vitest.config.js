import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Только тесты правил и данных; браузерные тесты (tests/ui) запускает Playwright
    include: ['tests/*.test.js'],
    // Файлы работают с одним эмулятором и очищают его, поэтому идут по очереди
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
