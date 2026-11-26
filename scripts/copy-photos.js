// Фото товаров из тестовых данных для опубликованного сайта: копирует seed/images/*.jpg
// в public/img/products/ перед публикацией хостинга (firebase.json, hosting.predeploy).
// У облачного проекта нет Cloud Storage (тариф Spark), поэтому фото раздаёт хостинг.
// Папка public/img/products/ не хранится в git: это копия seed/images
import { copyFile, mkdir, readdir } from 'node:fs/promises';

const from = new URL('../seed/images/', import.meta.url);
const to = new URL('../public/img/products/', import.meta.url);
await mkdir(to, { recursive: true });
const photos = (await readdir(from)).filter((name) => name.endsWith('.jpg'));
await Promise.all(photos.map((name) => copyFile(new URL(name, from), new URL(name, to))));
console.log(`Фото товаров для хостинга: ${photos.length} файлов → public/img/products/`);
