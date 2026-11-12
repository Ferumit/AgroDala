// Поиск по названию без полнотекстового движка.
// Firestore умеет искать в массиве только точное совпадение элемента (array-contains).
// Поэтому при сохранении товара из названия и производителя строится массив searchTokens —
// начала всех слов длиной от 2 букв: «лопата» → «ло», «лоп», «лопа», «лопат», «лопата».
// Запрос покупателя приводится к той же форме и ищется в этом массиве.
// Модуль не зависит от браузера: его используют и страницы сайта, и скрипт тестовых данных

const MIN_PREFIX = 2;
// Начала длиннее 20 букв не сохраняются: так массив не разрастается из-за длинных слов
const MAX_PREFIX = 20;
// Больше слов в запросе не учитываем: каждое лишнее проверяется в браузере
const MAX_WORDS = 5;

// Строчные буквы и «е» вместо «ё»: «Трёхкорпусный» и «трехкорпусный» — одно слово
export function normalize(text) {
  return String(text ?? '').toLowerCase().replaceAll('ё', 'е');
}

// Слова из букв и цифр любого алфавита: «П-3-35» → «п», «3», «35»
export function words(text) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function searchTokens(...texts) {
  const tokens = new Set();
  for (const word of texts.flatMap(words)) {
    for (let n = MIN_PREFIX; n <= Math.min(word.length, MAX_PREFIX); n++) {
      tokens.add(word.slice(0, n));
    }
  }
  return [...tokens];
}

// Окончания, которые отбрасываются у слов запроса: «лопаты» → «лопат», «бензиновый» → «бензинов».
// Это не морфологический анализ, а грубое правило: снимается одно окончание (сначала длинные),
// и только если остаётся не меньше 4 букв — «весы» и «вилы» не превращаются в «вес» и «вил»
const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ых', 'их', 'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ий', 'ый',
  'ов', 'ев', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем',
  'ы', 'и', 'а', 'я', 'о', 'е', 'у', 'ю', 'ь', 'й',
];

export function stem(word) {
  const ending = ENDINGS.find((e) => word.endsWith(e) && word.length - e.length >= 4);
  return ending ? word.slice(0, -ending.length) : word;
}

// Запрос покупателя → основы слов, самая длинная первой: её ищет база,
// остальные проверяет браузер (matchesSearch). Длинная основа отсеивает больше товаров
export function parseSearch(text) {
  const stems = words(text)
    .filter((w) => w.length >= MIN_PREFIX)
    .map((w) => stem(w).slice(0, MAX_PREFIX));
  return [...new Set(stems)].sort((a, b) => b.length - a.length).slice(0, MAX_WORDS);
}

// Подходит ли товар: каждая основа запроса — начало какого-нибудь слова товара
export function matchesSearch(tokens, stems) {
  const set = new Set(tokens);
  return stems.every((s) => set.has(s));
}
