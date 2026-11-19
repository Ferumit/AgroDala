// Порты эмуляторов Firebase. Заданы в одном месте — firebase.json (в firebase.phone.json те же),
// скрипты на Node.js берут их отсюда. Браузерный модуль public/js/firebase.js не может прочитать
// firebase.json, поэтому там номера записаны ещё раз; совпадение проверяет tests/pages.test.js.
// Порты 28571–28579 выбраны редкими: их нет в списке известных служб, и они ниже диапазонов,
// которые Linux (с 32768) и Windows (с 49152) раздают под исходящие соединения
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).emulators;

export const PORTS = Object.fromEntries(
  ['hosting', 'ui', 'firestore', 'auth', 'storage', 'functions'].map((name) => [name, config[name].port])
);

export const SITE = `http://127.0.0.1:${PORTS.hosting}/`;
export const PANEL = `http://127.0.0.1:${PORTS.ui}/`;
