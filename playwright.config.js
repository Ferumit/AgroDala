import { defineConfig, devices } from '@playwright/test';
import { SITE } from './scripts/emulators.js';

// Браузерные тесты. Запуск: npm run test:ui (эмуляторы и данные поднимаются автоматически)
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // Все тесты работают с одной базой на эмуляторе; на слабом ноутбуке двух потоков достаточно
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || SITE,
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Эмуляция телефона: viewport-мета, касания, мобильный User-Agent. Размер экрана задают тесты
    { name: 'phone', grep: /@phone/, use: { ...devices['Pixel 7'] } },
    { name: 'desktop', grep: /@desktop/, use: { ...devices['Desktop Chrome'] } },
    // Другие движки: npm run test:browsers; Firefox не умеет эмуляцию телефона, размеры те же
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
