/* =====================================================================
   Танкова Арена — спільний рушій для «Майстерні» та «Арени»
   ---------------------------------------------------------------------
   1. Транслятор Python (шкільна підмножина) → JS-генератори
   2. Фізика бою (детермінована: однаковий ключ = однаковий бій)
   3. Малювання на canvas
   4. Кодування бота в рядок для пересилання
   5. Вбудовані боти-суперники
   ===================================================================== */
(function (global) {
'use strict';

/* ---------------- Налаштування бою ---------------- */
const CFG = {
  W: 800, H: 600,          // розмір поля
  R: 18,                   // радіус танка
  SPEED: 6,                // кроків за хід
  TURN: 8,                 // градусів корпусу за хід
  GUN_TURN: 15,            // градусів гармати за хід
  SCAN_HALF: 6,            // половина ширини променя радара, °
  SCAN_RANGE: 1000,
  START_HEAT: 3, COOL: 0.1,
  WALL_DMG: 0.5, RAM_DMG: 0.6,
  MAX_TICKS: 4500,         // ~2.5 хв при швидкості ×1
  IDLE_TICKS: 600,         // без влучань — починається «виснаження»
  OPS_PER_TICK: 3000,      // захист від нескінченних циклів
  LOG_LIMIT: 300,
};

/* ---------------- Випадкові числа з ключем ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* =====================================================================
   1. ТРАНСЛЯТОР PYTHON
   ===================================================================== */
class PyError extends Error {
  constructor(msg, line) { super(msg); this.line = line; this.pyMsg = msg; }
}

// Команди бота. gen=true — команда триває кілька ходів.
const API = {
  'вперед':            { gen: true,  min: 1, max: 1, doc: 'їхати вперед на n кроків' },
  'назад':             { gen: true,  min: 1, max: 1, doc: 'їхати назад на n кроків' },
  'ліворуч':           { gen: true,  min: 1, max: 1, doc: 'повернути корпус ліворуч на кут (°)' },
  'праворуч':          { gen: true,  min: 1, max: 1, doc: 'повернути корпус праворуч на кут (°)' },
  'гармата_ліворуч':   { gen: true,  min: 1, max: 1, doc: 'повернути гармату ліворуч на кут (°)' },
  'гармата_праворуч':  { gen: true,  min: 1, max: 1, doc: 'повернути гармату праворуч на кут (°)' },
  'навести_на_ворога': { gen: true,  min: 0, max: 0, doc: 'навести гармату туди, де востаннє бачив ворога' },
  'вогонь':            { gen: true,  min: 0, max: 1, doc: 'постріл із силою від 0.1 до 3 (за замовчуванням 1)' },
  'чекати':            { gen: true,  min: 0, max: 1, doc: 'нічого не робити n ходів' },
  'сказати':           { gen: false, min: 1, max: 1, doc: 'показати хмаринку з текстом над танком' },
  'моя_енергія':       { gen: false, min: 0, max: 0, doc: 'скільки енергії лишилось (на старті 100)' },
  'мій_x':             { gen: false, min: 0, max: 0, doc: 'координата x (0 — лівий край)' },
  'мій_y':             { gen: false, min: 0, max: 0, doc: 'координата y (0 — верхній край)' },
  'мій_напрямок':      { gen: false, min: 0, max: 0, doc: 'куди дивиться корпус: 0 — вгору, 90 — праворуч' },
  'напрямок_гармати':  { gen: false, min: 0, max: 0, doc: 'куди дивиться гармата (так само в градусах)' },
  'гармата_готова':    { gen: false, min: 0, max: 0, doc: 'True, якщо гармата охолола і може стріляти' },
  'ворог_видно':       { gen: false, min: 0, max: 0, doc: 'True, якщо радар бачить ворога саме зараз' },
  'ворог_відстань':    { gen: false, min: 0, max: 0, doc: 'відстань до ворога, якого бачив востаннє (-1 — ще не бачив)' },
  'ворог_кут':         { gen: false, min: 0, max: 0, doc: 'на скільки градусів повернути гармату праворуч, щоб цілитись у ворога' },
  'ворог_енергія':     { gen: false, min: 0, max: 0, doc: 'енергія ворога, якого бачив востаннє' },
  'ворогів_живих':     { gen: false, min: 0, max: 0, doc: 'скільки суперників ще у грі' },
  'удар_кут':          { gen: false, min: 0, max: 0, doc: 'звідки прилетіла куля: кут від корпусу (праворуч +)' },
  'ширина_поля':       { gen: false, min: 0, max: 0, doc: 'ширина арени' },
  'висота_поля':       { gen: false, min: 0, max: 0, doc: 'висота арени' },
  'хід':               { gen: false, min: 0, max: 0, doc: 'номер поточного ходу' },
  'випадкове':         { gen: false, min: 2, max: 2, doc: 'випадкове ціле від a до b включно' },
};
const EVENTS = {
  'на_старті':        { prio: 0, label: '🚩 коли бій почався' },
  'бачу_ворога':      { prio: 2, label: '👁 коли бачу ворога' },
  'влучили_в_мене':   { prio: 3, label: '💥 коли в мене влучили' },
  'вдарився_в_стіну': { prio: 4, label: '🧱 коли вдарився в стіну' },
};
const BUILTINS = ['print', 'abs', 'min', 'max', 'round', 'int', 'float', 'str', 'len', 'range',
  'sum', 'bool', 'list', 'randint', 'math', 'random', 'sorted', 'reversed', 'enumerate'];
const MODULES = { math: true, random: true };
const KEYWORDS = new Set(['def', 'if', 'elif', 'else', 'while', 'for', 'in', 'not', 'and', 'or',
  'return', 'break', 'continue', 'pass', 'global', 'nonlocal', 'import', 'from', 'as', 'True',
  'False', 'None', 'is', 'lambda', 'class', 'try', 'except', 'finally', 'with', 'yield', 'del', 'assert', 'raise']);

/* ---------- Лексер ---------- */
function tokenize(src) {
  src = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ') + '\n';
  const toks = [], indents = [0];
  let i = 0, line = 1, depth = 0, atStart = true;
  const push = (t, v, extra) => toks.push(Object.assign({ t, v, line }, extra));
  const OPS = ['**=', '//=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '//', '**', '->',
    '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}', ',', ':', '.'];
  while (i < src.length) {
    if (atStart && depth === 0) {
      let col = 0;
      while (src[i] === ' ') { col++; i++; }
      if (src[i] === '\n') { i++; line++; continue; }
      if (src[i] === '#') { while (src[i] !== '\n') i++; continue; }
      if (i >= src.length) break;
      if (col > indents[indents.length - 1]) { indents.push(col); push('INDENT'); }
      else {
        while (col < indents[indents.length - 1]) { indents.pop(); push('DEDENT'); }
        if (col !== indents[indents.length - 1]) throw new PyError('Відступ не збігається з жодним попереднім рядком', line);
      }
      atStart = false;
    }
    const c = src[i];
    if (c === '\n') { i++; if (depth === 0) { push('NL'); atStart = true; } line++; continue; }
    if (c === ' ') { i++; continue; }
    if (c === '#') { while (src[i] !== '\n') i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
    const rest = src.slice(i, i + 64);
    let m;
    if ((m = /^(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][+-]?\d+)?/.exec(rest))) {
      push('NUM', parseFloat(m[0].replace(/_/g, ''))); i += m[0].length; continue;
    }
    // рядки (у т.ч. f"..." і потрійні лапки)
    if ((m = /^([fFrR]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 6))) && (m[1] === '' || /[fFrR]/.test(m[1]))) {
      const pre = m[1].toLowerCase(), q = m[2];
      let j = i + m[0].length, s = '';
      const startLine = line;
      while (true) {
        if (j >= src.length) throw new PyError('Рядок не закрито лапками', startLine);
        if (src.startsWith(q, j)) { j += q.length; break; }
        const ch = src[j];
        if (ch === '\n') { if (q.length === 1) throw new PyError('Рядок не закрито лапками', startLine); line++; }
        if (ch === '\\' && !pre.includes('r')) {
          const n = src[j + 1];
          const map = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
          if (n in map) { s += map[n]; j += 2; continue; }
          if (n === '\n') { j += 2; line++; continue; }
        }
        s += ch; j++;
      }
      push(pre.includes('f') ? 'FSTR' : 'STR', s, { line: startLine });
      i = j; continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      m = /^[\p{L}\p{N}_ʼ]+/u.exec(src.slice(i, i + 200));
      const w = m[0];
      push(KEYWORDS.has(w) ? 'KW' : 'NAME', w); i += w.length; continue;
    }
    if (c === "'" || c === '’' || c === 'ʼ') {
      throw new PyError('Апостроф у назві не дозволено — назви змінні без нього (напр. "мяч")', line);
    }
    let op = null;
    for (const o of OPS) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) throw new PyError(`Незрозумілий символ «${c}»`, line);
    if ('([{'.includes(op)) depth++;
    if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
    push('OP', op); i += op.length;
  }
  if (toks.length && toks[toks.length - 1].t !== 'NL') push('NL');
  while (indents.length > 1) { indents.pop(); push('DEDENT'); }
  push('EOF');
  return toks;
}

/* ---------- Парсер → дерево ---------- */
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const at = (t, v) => { const k = toks[p]; return k.t === t && (v === undefined || k.v === v); };
  const isOp = v => at('OP', v), isKw = v => at('KW', v);
  const next = () => toks[p++];
  const fail = (msg, tok = toks[p]) => { throw new PyError(msg, tok.line); };
  const describe = k => k.t === 'NL' ? 'кінець рядка' : k.t === 'EOF' ? 'кінець програми'
    : k.t === 'INDENT' ? 'зайвий відступ' : k.t === 'DEDENT' ? 'кінець блоку' : `«${k.v}»`;
  const expectOp = (v, hint) => { if (!isOp(v)) fail(hint || `Очікувалось «${v}», а знайдено ${describe(peek())}`); return next(); };
  const expectName = () => { if (!at('NAME')) fail(`Очікувалась назва, а знайдено ${describe(peek())}`); return next().v; };
  const expectNL = () => {
    if (at('NL')) { next(); return; }
    if (at('EOF')) return;
    fail(`Зайве в кінці рядка: ${describe(peek())}`);
  };

  function block() {
    expectOp(':', `Після цього рядка потрібна двокрапка «:»`);
    if (!at('NL')) { // однорядковий блок: if x: вогонь()
      const s = simpleStatement(); expectNL(); return [s];
    }
    next();
    if (!at('INDENT')) fail('Після «:» наступний рядок має бути з відступом (4 пробіли)');
    next();
    const body = [];
    while (!at('DEDENT') && !at('EOF')) body.push(statement());
    if (at('DEDENT')) next();
    return body;
  }

  function statement() {
    const k = peek();
    if (k.t === 'INDENT') fail('Зайвий відступ на початку рядка');
    if (k.t === 'KW') {
      switch (k.v) {
        case 'def': {
          next(); const name = expectName();
          expectOp('(', `Після назви функції потрібні дужки: def ${name}():`);
          const params = [];
          while (!isOp(')')) {
            params.push(expectName());
            if (isOp('=')) fail('Значення параметрів за замовчуванням не підтримуються');
            if (!isOp(')')) expectOp(',');
          }
          next();
          if (isOp('->')) { next(); expr(); }
          return { k: 'def', name, params, body: block(), line: k.line };
        }
        case 'if': {
          next(); const tests = [[expr(), block()]]; let orelse = null;
          while (isKw('elif')) { next(); tests.push([expr(), block()]); }
          if (isKw('else')) { next(); orelse = block(); }
          return { k: 'if', tests, orelse, line: k.line };
        }
        case 'while': {
          next(); const cond = expr(); const body = block();
          if (isKw('else')) fail('«else» після циклу не підтримується');
          return { k: 'while', cond, body, line: k.line };
        }
        case 'for': {
          next(); const targets = [expectName()];
          while (isOp(',')) { next(); targets.push(expectName()); }
          if (!isKw('in')) fail('У циклі for потрібне слово «in»: for i in range(5):');
          next(); const iter = expr(); const body = block();
          if (isKw('else')) fail('«else» після циклу не підтримується');
          return { k: 'for', targets, iter, body, line: k.line };
        }
        case 'elif': case 'else': fail(`«${k.v}» без «if» вище (або неправильний відступ)`);
      }
    }
    const s = simpleStatement(); expectNL(); return s;
  }

  function simpleStatement() {
    const k = peek(), line = k.line;
    if (k.t === 'KW') {
      switch (k.v) {
        case 'pass': next(); return { k: 'pass', line };
        case 'break': next(); return { k: 'break', line };
        case 'continue': next(); return { k: 'continue', line };
        case 'return': next(); return { k: 'return', e: (at('NL') || at('EOF')) ? null : exprList(), line };
        case 'global': case 'nonlocal': {
          next(); const names = [expectName()];
          while (isOp(',')) { next(); names.push(expectName()); }
          return { k: 'global', names, line };
        }
        case 'import': {
          next(); const mods = [];
          do { if (mods.length) next(); const mod = expectName(); let as = mod; if (isKw('as')) { next(); as = expectName(); } mods.push({ mod, as }); } while (isOp(','));
          return { k: 'import', mods, line };
        }
        case 'from': {
          next(); const mod = expectName();
          if (!isKw('import')) fail('Очікувалось: from модуль import назва');
          next(); const names = [];
          if (isOp('*')) { next(); names.push('*'); }
          else do { if (names.length) next(); names.push(expectName()); if (isKw('as')) fail('«as» тут не підтримується'); } while (isOp(','));
          return { k: 'from', mod, names, line };
        }
        case 'class': case 'try': case 'with': case 'lambda': case 'yield': case 'del': case 'raise': case 'assert':
          fail(`«${k.v}» не підтримується в Танковій Арені`);
      }
    }
    const e = exprList();
    if (isOp('=')) {
      const targets = [e];
      let val;
      while (isOp('=')) { next(); val = exprList(); if (isOp('=')) targets.push(val); }
      for (const t of targets) checkTarget(t);
      return { k: 'assign', targets, e: val, line };
    }
    const aug = ['+=', '-=', '*=', '/=', '//=', '%=', '**='];
    if (at('OP') && aug.includes(peek().v)) {
      const op = next().v.slice(0, -1); checkTarget(e);
      if (e.k === 'tuple') fail('Так присвоювати кільком змінним не можна');
      return { k: 'aug', target: e, op, e: exprList(), line };
    }
    if (isOp('==') && false) { /* noop */ }
    return { k: 'expr', e, line };
  }
  function checkTarget(t) {
    if (t.k === 'name' || t.k === 'index') return;
    if (t.k === 'tuple') { t.items.forEach(checkTarget); return; }
    if (t.k === 'call') fail('Не можна присвоїти значення виклику функції. Можливо, ти хотів «==» (порівняння)?');
    fail('Ліворуч від «=» має бути назва змінної');
  }

  function exprList() {
    const first = expr();
    if (!isOp(',')) return first;
    const items = [first];
    while (isOp(',')) { next(); if (at('NL') || isOp('=') || isOp(')')) break; items.push(expr()); }
    return { k: 'tuple', items };
  }
  function expr() {
    if (isKw('lambda')) fail('lambda не підтримується');
    const e = orExpr();
    if (isKw('if')) {
      next(); const cond = orExpr();
      if (!isKw('else')) fail('Умовний вираз: a if умова else b');
      next(); const other = expr();
      return { k: 'ifexp', cond, a: e, b: other };
    }
    return e;
  }
  function orExpr() { let e = andExpr(); while (isKw('or')) { next(); e = { k: 'bool', op: '||', a: e, b: andExpr() }; } return e; }
  function andExpr() { let e = notExpr(); while (isKw('and')) { next(); e = { k: 'bool', op: '&&', a: e, b: notExpr() }; } return e; }
  function notExpr() { if (isKw('not')) { next(); return { k: 'not', e: notExpr() }; } return compare(); }
  function compare() {
    const first = arith();
    const ops = [], rhs = [];
    while (true) {
      let op = null;
      if (at('OP') && ['<', '>', '==', '!=', '<=', '>='].includes(peek().v)) op = next().v;
      else if (isKw('in')) { next(); op = 'in'; }
      else if (isKw('not') && peek(1).t === 'KW' && peek(1).v === 'in') { next(); next(); op = 'not in'; }
      else if (isKw('is')) { next(); op = 'is'; if (isKw('not')) { next(); op = 'is not'; } }
      else break;
      ops.push(op); rhs.push(arith());
    }
    if (isOp('=') && false) {}
    return ops.length ? { k: 'cmp', first, ops, rhs } : first;
  }
  function arith() {
    let e = term();
    while (isOp('+') || isOp('-')) { const op = next().v; e = { k: 'bin', op, a: e, b: term() }; }
    return e;
  }
  function term() {
    let e = unary();
    while (isOp('*') || isOp('/') || isOp('//') || isOp('%')) { const op = next().v; e = { k: 'bin', op, a: e, b: unary() }; }
    return e;
  }
  function unary() {
    if (isOp('-')) { next(); return { k: 'neg', e: unary() }; }
    if (isOp('+')) { next(); return unary(); }
    return power();
  }
  function power() {
    const e = postfix();
    if (isOp('**')) { next(); return { k: 'bin', op: '**', a: e, b: unary() }; }
    return e;
  }
  function postfix() {
    let e = atom();
    while (true) {
      if (isOp('(')) {
        const line = next().line; const args = [], kw = {};
        while (!isOp(')')) {
          if (at('NAME') && peek(1).t === 'OP' && peek(1).v === '=') { const n = next().v; next(); kw[n] = expr(); }
          else args.push(expr());
          if (!isOp(')')) expectOp(',', 'Аргументи розділяються комою');
        }
        next();
        e = { k: 'call', f: e, args, kw, line };
      } else if (isOp('[')) {
        next();
        if (isOp(':') || true) {
          let lo = null, hi = null, slice = false;
          if (!isOp(':')) lo = expr();
          if (isOp(':')) { slice = true; next(); if (!isOp(']')) hi = expr(); }
          expectOp(']');
          e = slice ? { k: 'slice', obj: e, lo, hi } : { k: 'index', obj: e, idx: lo };
        }
      } else if (isOp('.')) {
        next(); e = { k: 'attr', obj: e, name: expectName() };
      } else break;
    }
    return e;
  }
  function atom() {
    const k = peek();
    if (k.t === 'NUM') { next(); return { k: 'num', v: k.v }; }
    if (k.t === 'STR' || k.t === 'FSTR') {
      // склеювання сусідніх рядків
      const parts = [];
      while (at('STR') || at('FSTR')) {
        const s = next();
        if (s.t === 'STR') parts.push({ k: 'str', v: s.v });
        else parts.push(fstring(s));
      }
      return parts.length === 1 ? parts[0] : parts.reduce((a, b) => ({ k: 'bin', op: '+', a, b }));
    }
    if (k.t === 'NAME') { next(); return { k: 'name', id: k.v, line: k.line }; }
    if (k.t === 'KW') {
      if (k.v === 'True') { next(); return { k: 'lit', js: 'true' }; }
      if (k.v === 'False') { next(); return { k: 'lit', js: 'false' }; }
      if (k.v === 'None') { next(); return { k: 'lit', js: 'null' }; }
    }
    if (isOp('(')) {
      next();
      if (isOp(')')) { next(); return { k: 'tuple', items: [] }; }
      const e = expr();
      if (isOp(',')) {
        const items = [e];
        while (isOp(',')) { next(); if (isOp(')')) break; items.push(expr()); }
        expectOp(')'); return { k: 'tuple', items };
      }
      expectOp(')', 'Не вистачає закриваючої дужки «)»'); return e;
    }
    if (isOp('[')) {
      next(); const items = [];
      while (!isOp(']')) {
        items.push(expr());
        if (isKw('for')) fail('Генератори списків [x for ...] не підтримуються — використай цикл');
        if (!isOp(']')) expectOp(',');
      }
      next(); return { k: 'list', items };
    }
    if (isOp('{')) fail('Словники та множини { } не підтримуються');
    if (k.t === 'NL' || k.t === 'EOF') fail('Рядок обірвався — не вистачає значення');
    if (k.t === 'KW') fail(`Слово «${k.v}» тут не на місці`);
    fail(`Тут не очікувалось ${describe(k)}`);
  }
  function fstring(tok) {
    const s = tok.v; let i = 0, cur = '';
    let node = null;
    const add = n => { node = node ? { k: 'bin', op: '+', a: node, b: n } : n; };
    while (i < s.length) {
      if (s[i] === '{' && s[i + 1] === '{') { cur += '{'; i += 2; continue; }
      if (s[i] === '}' && s[i + 1] === '}') { cur += '}'; i += 2; continue; }
      if (s[i] === '{') {
        let j = i + 1, d = 1;
        while (j < s.length && d) { if (s[j] === '{') d++; if (s[j] === '}') d--; j++; }
        if (d) throw new PyError('У f-рядку не закрито «}»', tok.line);
        let inner = s.slice(i + 1, j - 1), fmt = null;
        const ci = inner.lastIndexOf(':');
        if (ci > 0 && /^\.?\d*f?$/.test(inner.slice(ci + 1))) { fmt = inner.slice(ci + 1); inner = inner.slice(0, ci); }
        if (cur) { add({ k: 'str', v: cur }); cur = ''; }
        let sub;
        try { sub = parse(inner); } catch (e) { throw new PyError('Помилка всередині f-рядка: ' + e.pyMsg, tok.line); }
        if (sub.length !== 1 || sub[0].k !== 'expr') throw new PyError('У f-рядку в { } має бути вираз', tok.line);
        add({ k: 'fmt', e: sub[0].e, fmt });
        i = j; continue;
      }
      cur += s[i++];
    }
    if (cur || !node) add({ k: 'str', v: cur });
    return node;
  }

  const body = [];
  while (!at('EOF')) {
    if (at('NL')) { next(); continue; }
    if (at('DEDENT')) { next(); continue; }
    body.push(statement());
  }
  return body;
}

/* ---------- Генератор JS ---------- */
function compileToJS(src) {
  const ast = parse(src);
  const defs = new Map();      // назва → {params}
  const moduleNames = new Set();
  const globalDecls = new Set();
  let tmp = 0;

  // збір інформації
  function collectAssigned(stmts, set, globals, inFunc) {
    for (const s of stmts) {
      switch (s.k) {
        case 'assign': for (const t of s.targets) addTarget(t, set); break;
        case 'aug': addTarget(s.target, set); break;
        case 'for': s.targets.forEach(n => set.add(n)); collectAssigned(s.body, set, globals, inFunc); break;
        case 'while': collectAssigned(s.body, set, globals, inFunc); break;
        case 'if': s.tests.forEach(([, b]) => collectAssigned(b, set, globals, inFunc)); if (s.orelse) collectAssigned(s.orelse, set, globals, inFunc); break;
        case 'global': s.names.forEach(n => globals.add(n)); break;
        case 'import': s.mods.forEach(m => set.add(m.as)); break;
        case 'from': s.names.forEach(n => n !== '*' && set.add(n)); break;
        case 'def':
          if (inFunc) throw new PyError('Функцію всередині функції оголошувати не можна', s.line);
          break;
      }
    }
  }
  function addTarget(t, set) {
    if (t.k === 'name') set.add(t.id);
    else if (t.k === 'tuple') t.items.forEach(x => addTarget(x, set));
  }
  function checkNested(stmts) {
    for (const s of stmts) {
      if (s.k === 'def') throw new PyError('Оголошуй функції (def) з самого початку рядка, без відступу', s.line);
      if (s.k === 'if') { s.tests.forEach(([, b]) => checkNested(b)); if (s.orelse) checkNested(s.orelse); }
      if (s.k === 'while' || s.k === 'for') checkNested(s.body);
    }
  }

  for (const s of ast) {
    if (s.k === 'def') {
      if (defs.has(s.name)) throw new PyError(`Функцію «${s.name}» оголошено двічі`, s.line);
      if (API[s.name] || BUILTINS.includes(s.name)) throw new PyError(`«${s.name}» — це вбудована команда, назви функцію інакше`, s.line);
      if (EVENTS[s.name] && s.params.length) throw new PyError(`Подія «${s.name}» не має параметрів: def ${s.name}():`, s.line);
      defs.set(s.name, s);
      checkNested(s.body);
    } else if (s.k === 'if' || s.k === 'while' || s.k === 'for') checkNested([s]);
  }
  collectAssigned(ast.filter(s => s.k !== 'def'), moduleNames, new Set(), false);
  for (const [, d] of defs) {
    const g = new Set(), loc = new Set();
    collectAssigned(d.body, loc, g, true);
    g.forEach(n => { globalDecls.add(n); moduleNames.add(n); });
    d.globals = g;
    d.locals = new Set([...loc].filter(n => !g.has(n) && !d.params.includes(n)));
  }
  for (const n of defs.keys()) moduleNames.delete(n);
  for (const n of moduleNames) if (API[n]) throw new PyError(`«${n}» — назва команди, не використовуй її як змінну`);

  const id = n => '$' + n;

  function resolve(name, scope, line) {
    if (scope && (scope.locals.has(name) || scope.params.includes(name))) return 'local';
    if (moduleNames.has(name) || defs.has(name)) return 'module';
    if (API[name] || BUILTINS.includes(name)) return 'builtin';
    const all = [...defs.keys(), ...moduleNames, ...Object.keys(API), ...BUILTINS, ...(scope ? [...scope.locals, ...scope.params] : [])];
    const near = closest(name, all);
    throw new PyError(`Невідома назва «${name}»` + (near ? `. Може, «${near}»?` : ''), line);
  }

  function E(e, sc) {
    switch (e.k) {
      case 'num': return String(e.v);
      case 'str': return JSON.stringify(e.v);
      case 'lit': return e.js;
      case 'fmt': return `__fmt(${E(e.e, sc)},${JSON.stringify(e.fmt)})`;
      case 'name': {
        const r = resolve(e.id, sc, e.line);
        if (r === 'builtin' || defs.has(e.id)) return id(e.id);
        return `__v(${id(e.id)},${JSON.stringify(e.id)})`;
      }
      case 'list': return `[${e.items.map(x => E(x, sc)).join(',')}]`;
      case 'tuple': return `[${e.items.map(x => E(x, sc)).join(',')}]`;
      case 'neg': return `(-__num(${E(e.e, sc)}))`;
      case 'not': return `(!__t(${E(e.e, sc)}))`;
      case 'bool': return `(${E(e.a, sc)}${e.op}${E(e.b, sc)})`;
      case 'ifexp': return `(__t(${E(e.cond, sc)})?${E(e.a, sc)}:${E(e.b, sc)})`;
      case 'bin': {
        const a = E(e.a, sc), b = E(e.b, sc);
        switch (e.op) {
          case '+': return `__add(${a},${b})`;
          case '-': return `(__num(${a})-__num(${b}))`;
          case '*': return `__mul(${a},${b})`;
          case '/': return `__div(${a},${b})`;
          case '//': return `__fdiv(${a},${b})`;
          case '%': return `__mod(${a},${b})`;
          case '**': return `Math.pow(__num(${a}),__num(${b}))`;
        }
        break;
      }
      case 'cmp': {
        const parts = [];
        let left = E(e.first, sc);
        for (let i = 0; i < e.ops.length; i++) {
          const right = E(e.rhs[i], sc);
          const op = e.ops[i];
          let c;
          if (op === '==' || op === 'is') c = `__eq(${left},${right})`;
          else if (op === '!=' || op === 'is not') c = `!__eq(${left},${right})`;
          else if (op === 'in') c = `__in(${left},${right})`;
          else if (op === 'not in') c = `!__in(${left},${right})`;
          else c = `(${left}${op}${right})`;
          parts.push(c); left = right;
        }
        return '(' + parts.join('&&') + ')';
      }
      case 'index': return `__gi(${E(e.obj, sc)},${E(e.idx, sc)})`;
      case 'slice': return `__sl(${E(e.obj, sc)},${e.lo ? E(e.lo, sc) : 'null'},${e.hi ? E(e.hi, sc) : 'null'})`;
      case 'attr': return `__ga(${E(e.obj, sc)},${JSON.stringify(e.name)})`;
      case 'call': {
        const args = e.args.map(x => E(x, sc));
        const kwNames = Object.keys(e.kw);
        if (e.f.k === 'attr') {
          if (kwNames.length) throw new PyError('Іменовані аргументи тут не підтримуються', e.line);
          return `__m(${E(e.f.obj, sc)},${JSON.stringify(e.f.name)},[${args.join(',')}])`;
        }
        if (e.f.k !== 'name') throw new PyError('Так викликати не можна', e.line);
        const n = e.f.id;
        const r = resolve(n, sc, e.line);
        if (n === 'print') {
          const ok = kwNames.every(k => k === 'sep' || k === 'end');
          if (!ok) throw new PyError('print підтримує лише sep= та end=', e.line);
          return `__print([${args.join(',')}],${e.kw.sep ? E(e.kw.sep, sc) : 'null'},${e.kw.end ? E(e.kw.end, sc) : 'null'})`;
        }
        if (kwNames.length) throw new PyError(`Іменовані аргументи (${kwNames[0]}=) тут не підтримуються`, e.line);
        if (r === 'builtin' && API[n]) {
          const a = API[n];
          if (args.length < a.min || args.length > a.max) {
            const need = a.min === a.max ? a.min : `${a.min}–${a.max}`;
            throw new PyError(`Команда ${n}() приймає ${need} аргумент(и), а отримала ${args.length}`, e.line);
          }
          return a.gen ? `(yield* ${id(n)}(${args.join(',')}))` : `${id(n)}(${args.join(',')})`;
        }
        if (r === 'module' && defs.has(n)) {
          const d = defs.get(n);
          if (EVENTS[n]) throw new PyError(`Подію «${n}» не можна викликати вручну — її запускає гра`, e.line);
          if (args.length !== d.params.length) throw new PyError(`Функція ${n}() очікує ${d.params.length} аргумент(и), а отримала ${args.length}`, e.line);
          return `(yield* ${id(n)}(${args.join(',')}))`;
        }
        if (r === 'builtin') return `${id(n)}(${args.join(',')})`;
        return `__call(${E(e.f, sc)},[${args.join(',')}])`;
      }
    }
    throw new PyError('Непідтримуваний вираз');
  }

  function assignTo(t, val, sc) {
    if (t.k === 'name') {
      if (API[t.id] || (BUILTINS.includes(t.id) && !moduleNames.has(t.id) && !(sc && sc.locals.has(t.id)))) throw new PyError(`«${t.id}» — вбудована назва, обери іншу`, t.line);
      if (defs.has(t.id)) throw new PyError(`«${t.id}» — це назва функції`, t.line);
      return `${id(t.id)}=${val};`;
    }
    if (t.k === 'index') return `__si(${E(t.obj, sc)},${E(t.idx, sc)},${val});`;
    if (t.k === 'tuple') {
      const tv = '__u' + (tmp++);
      let s = `{const ${tv}=__unpack(${val},${t.items.length});`;
      t.items.forEach((it, i) => { s += assignTo(it, `${tv}[${i}]`, sc); });
      return s + '}';
    }
    throw new PyError('Неможливе присвоєння');
  }

  const GUARD = `if(++__rt.ops>${CFG.OPS_PER_TICK}){__rt.ops=0;yield 0;}`;

  function S(stmts, sc, ind) {
    let out = '';
    for (const s of stmts) {
      const L = `__rt.line=${s.line || 0};`;
      switch (s.k) {
        case 'expr': out += ind + L + E(s.e, sc) + ';\n'; break;
        case 'assign': {
          if (s.targets.length === 1) out += ind + L + assignTo(s.targets[0], E(s.e, sc), sc) + '\n';
          else {
            const tv = '__a' + (tmp++);
            out += ind + L + `{const ${tv}=${E(s.e, sc)};` + s.targets.map(t => assignTo(t, tv, sc)).join('') + '}\n';
          }
          break;
        }
        case 'aug': {
          const cur = s.target.k === 'name' ? { k: 'name', id: s.target.id, line: s.line } : s.target;
          const val = E({ k: 'bin', op: s.op, a: cur, b: s.e }, sc);
          if (s.target.k === 'index') {
            // уникаємо подвійного обчислення індексу
            const o = '__o' + (tmp++), ix = '__i' + (tmp++);
            out += ind + L + `{const ${o}=${E(s.target.obj, sc)},${ix}=${E(s.target.idx, sc)};__si(${o},${ix},` +
              E({ k: 'bin', op: s.op, a: { k: 'raw', js: `__gi(${o},${ix})` }, b: s.e }, sc).replace('__RAW__', '') + ');}\n';
          } else out += ind + L + assignTo(s.target, val, sc) + '\n';
          break;
        }
        case 'if': {
          s.tests.forEach(([c, b], i) => {
            out += ind + (i ? '} else if' : L + 'if') + `(__t(${E(c, sc)})){\n` + S(b, sc, ind + '  ');
          });
          if (s.orelse) out += ind + '} else {\n' + S(s.orelse, sc, ind + '  ');
          out += ind + '}\n';
          break;
        }
        case 'while':
          out += ind + L + `while(__t(${E(s.cond, sc)})){${GUARD}\n` + S(s.body, sc, ind + '  ') + ind + '}\n';
          break;
        case 'for': {
          const it = s.iter;
          const tgt = s.targets.length === 1 ? { k: 'name', id: s.targets[0], line: s.line }
            : { k: 'tuple', items: s.targets.map(n => ({ k: 'name', id: n, line: s.line })) };
          if (it.k === 'call' && it.f.k === 'name' && it.f.id === 'range' && resolve('range', sc) === 'builtin') {
            const a = it.args.map(x => E(x, sc));
            if (a.length < 1 || a.length > 3) throw new PyError('range() приймає 1–3 числа', s.line);
            const [st, en, stp] = a.length === 1 ? ['0', a[0], '1'] : a.length === 2 ? [a[0], a[1], '1'] : a;
            const n = tmp++;
            out += ind + L + `{const __e${n}=__int(${en}),__s${n}=__int(${stp});if(__s${n}===0)__err('Крок range не може бути 0');` +
              `for(let __k${n}=__int(${st});__s${n}>0?__k${n}<__e${n}:__k${n}>__e${n};__k${n}+=__s${n}){${GUARD}` +
              assignTo(tgt, `__k${n}`, sc) + '\n' + S(s.body, sc, ind + '  ') + ind + '}}\n';
          } else {
            const n = tmp++;
            out += ind + L + `for(const __x${n} of __iter(${E(it, sc)})){${GUARD}` + assignTo(tgt, `__x${n}`, sc) + '\n' +
              S(s.body, sc, ind + '  ') + ind + '}\n';
          }
          break;
        }
        case 'break': out += ind + 'break;\n'; break;
        case 'continue': out += ind + 'continue;\n'; break;
        case 'pass': case 'global': break;
        case 'return':
          if (!sc) throw new PyError('return можна писати лише всередині функції', s.line);
          out += ind + L + `return ${s.e ? E(s.e, sc) : 'null'};\n`; break;
        case 'import':
          for (const m of s.mods) {
            if (!MODULES[m.mod]) throw new PyError(`Модуль «${m.mod}» недоступний (є лише math і random)`, s.line);
            out += ind + `${id(m.as)}=__mods.${m.mod};\n`;
          }
          break;
        case 'from':
          if (!MODULES[s.mod]) throw new PyError(`Модуль «${s.mod}» недоступний (є лише math і random)`, s.line);
          if (s.names[0] === '*') throw new PyError(`Напиши явно: from ${s.mod} import назва`, s.line);
          for (const n of s.names) out += ind + `${id(n)}=__ga(__mods.${s.mod},${JSON.stringify(n)});\n`;
          break;
        case 'def': break;
      }
    }
    return out;
  }
  // підтримка 'raw' вузла в E
  const _E = E;
  E = function (e, sc) { return e.k === 'raw' ? e.js : _E(e, sc); };

  let code = '';
  const mn = [...moduleNames];
  if (mn.length) code += 'let ' + mn.map(id).join(',') + ';\n';
  for (const [name, d] of defs) {
    const sc = { params: d.params, locals: d.locals };
    code += `function* ${id(name)}(${d.params.map(id).join(',')}){\n`;
    if (d.locals.size) code += '  let ' + [...d.locals].map(id).join(',') + ';\n';
    code += `  if(++__rt.depth>150){__rt.depth=0;__err('Занадто глибока рекурсія (функція викликає сама себе без кінця)');}\n`;
    code += '  try{\n' + S(d.body, sc, '    ') + '    return null;\n  } finally { __rt.depth--; }\n}\n';
  }
  code += 'return {\n init: function*(){\n' + S(ast.filter(s => s.k !== 'def'), null, '    ') + ' },\n ev: {';
  code += Object.keys(EVENTS).filter(n => defs.has(n)).map(n => `${JSON.stringify(n)}:${id(n)}`).join(',');
  code += '}\n};';

  const events = Object.keys(EVENTS).filter(n => defs.has(n));
  return { code, events };
}

function closest(word, list) {
  let best = null, bd = 3;
  for (const w of new Set(list)) {
    const d = lev(word, w);
    if (d < bd || (d === bd && best === null && d <= 2)) { bd = d; best = w; }
  }
  return bd <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/* ---------- Середовище виконання ---------- */
const RT_PRELUDE = `
const __err=(m)=>{throw new __rt.PyError(m,__rt.line)};
const __v=(x,n)=>{if(x===undefined)__err('Змінна «'+n+'» ще не має значення — спершу присвой їй щось');return x;};
const __t=(x)=>Array.isArray(x)?x.length>0:!!x;
const __num=(x)=>{if(typeof x==='number')return x;if(typeof x==='boolean')return +x;__err('Тут потрібне число, а отримано '+__rt.repr(x));};
const __int=(x)=>{x=__num(x);if(!Number.isInteger(x))__err('Тут потрібне ціле число, а отримано '+x);return x;};
const __add=(a,b)=>{if(Array.isArray(a)&&Array.isArray(b))return a.concat(b);if(typeof a==='string'||typeof b==='string'){if(typeof a!==typeof b)__err('Не можна додати текст і число. Використай str(число)');return a+b;}return __num(a)+__num(b);};
const __mul=(a,b)=>{if(typeof a==='string'||Array.isArray(a)){[a,b]=[a,b];}else if(typeof b==='string'||Array.isArray(b)){[a,b]=[b,a];}else return __num(a)*__num(b);const n=Math.max(0,__int(b));if(typeof a==='string')return a.repeat(n);let r=[];for(let i=0;i<n;i++)r=r.concat(a);return r;};
const __div=(a,b)=>{b=__num(b);if(b===0)__err('Ділення на нуль');return __num(a)/b;};
const __fdiv=(a,b)=>{b=__num(b);if(b===0)__err('Ділення на нуль');return Math.floor(__num(a)/b);};
const __mod=(a,b)=>{b=__num(b);if(b===0)__err('Остача від ділення на нуль');a=__num(a);return ((a%b)+b)%b;};
const __eq=(a,b)=>{if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((x,i)=>__eq(x,b[i]));if(typeof a==='boolean')a=+a;if(typeof b==='boolean')b=+b;return a===b;};
const __in=(a,b)=>{if(typeof b==='string')return b.includes(a);if(Array.isArray(b))return b.some(x=>__eq(x,a));__err('Оператор in працює зі списками і рядками');};
const __idx=(a,i)=>{i=__int(i);const n=a.length;if(i<0)i+=n;if(i<0||i>=n)__err('Індекс '+i+' поза межами (довжина '+n+')');return i;};
const __gi=(a,i)=>{if(typeof a==='string'||Array.isArray(a))return a[__idx(a,i)];__err('Квадратні дужки [ ] працюють лише зі списками і рядками');};
const __si=(a,i,v)=>{if(!Array.isArray(a))__err('Змінювати елемент можна лише у списку');a[__idx(a,i)]=v;};
const __sl=(a,lo,hi)=>{if(!(typeof a==='string'||Array.isArray(a)))__err('Зрізи працюють лише зі списками і рядками');const n=a.length;let l=lo===null?0:__int(lo),h=hi===null?n:__int(hi);if(l<0)l+=n;if(h<0)h+=n;return a.slice(Math.max(0,l),Math.max(0,h));};
const __iter=(x)=>{if(Array.isArray(x))return x.slice();if(typeof x==='string')return Array.from(x);__err('Перебирати циклом for можна лише список, рядок або range()');};
const __unpack=(x,n)=>{x=__iter(x);if(x.length!==n)__err('Очікувалось '+n+' значень, а є '+x.length);return x;};
const __ga=(o,n)=>{if(o&&o.__module){if(!(n in o))__err('У модулі '+o.__module+' немає «'+n+'»');return o[n];}__err('Атрибут .'+n+' тут недоступний');};
const __m=(o,n,a)=>__rt.method(o,n,a);
const __call=(f,a)=>{if(typeof f!=='function')__err('Це не функція');return f(...a);};
const __fmt=(x,f)=>{if(f){const m=/^\\.?(\\d*)f?$/.exec(f);if(m&&m[1]!=='')return __num(x).toFixed(+m[1]);}return __rt.str(x);};
const __print=(a,sep,end)=>__rt.print(a,sep,end);
const __mods=__rt.mods;
`;

function makeBuiltins(rt) {
  const err = m => { throw new PyError(m, rt.line); };
  const num = x => { if (typeof x === 'number') return x; if (typeof x === 'boolean') return +x; err('Тут потрібне число, а отримано ' + repr(x)); };
  const str = x => {
    if (x === null) return 'None';
    if (x === true) return 'True'; if (x === false) return 'False';
    if (typeof x === 'number') return Number.isInteger(x) ? String(x) : String(Math.round(x * 1e10) / 1e10);
    if (Array.isArray(x)) return '[' + x.map(repr).join(', ') + ']';
    if (typeof x === 'function') return '<функція>';
    if (x && x.__module) return `<модуль ${x.__module}>`;
    return String(x);
  };
  const repr = x => typeof x === 'string' ? "'" + x + "'" : str(x);
  rt.str = str; rt.repr = repr;
  const rnd = rt.rand;
  const randint = (a, b) => { a = Math.ceil(num(a)); b = Math.floor(num(b)); if (b < a) err('randint(a, b): a має бути не більше за b'); return a + Math.floor(rnd() * (b - a + 1)); };
  const mathMod = {
    __module: 'math', pi: Math.PI, e: Math.E,
    sqrt: x => { x = num(x); if (x < 0) err('Корінь з від\'ємного числа'); return Math.sqrt(x); },
    sin: x => Math.sin(num(x)), cos: x => Math.cos(num(x)), tan: x => Math.tan(num(x)),
    asin: x => Math.asin(num(x)), acos: x => Math.acos(num(x)), atan: x => Math.atan(num(x)),
    atan2: (y, x) => Math.atan2(num(y), num(x)), hypot: (a, b) => Math.hypot(num(a), num(b)),
    degrees: x => num(x) * 180 / Math.PI, radians: x => num(x) * Math.PI / 180,
    floor: x => Math.floor(num(x)), ceil: x => Math.ceil(num(x)), fabs: x => Math.abs(num(x)),
    log: (x, b) => b === undefined ? Math.log(num(x)) : Math.log(num(x)) / Math.log(num(b)), exp: x => Math.exp(num(x)),
    pow: (a, b) => Math.pow(num(a), num(b)),
  };
  const randomMod = {
    __module: 'random', randint, random: () => rnd(),
    uniform: (a, b) => num(a) + rnd() * (num(b) - num(a)),
    choice: l => { if (!l || !l.length) err('choice() з порожнього списку'); return l[Math.floor(rnd() * l.length)]; },
  };
  rt.mods = { math: mathMod, random: randomMod };
  const toList = x => { if (Array.isArray(x)) return x.slice(); if (typeof x === 'string') return Array.from(x); err('Потрібен список'); };
  const b = {
    abs: x => Math.abs(num(x)),
    min: (...a) => { if (a.length === 1) a = toList(a[0]); if (!a.length) err('min() порожнього'); return a.reduce((m, x) => x < m ? x : m); },
    max: (...a) => { if (a.length === 1) a = toList(a[0]); if (!a.length) err('max() порожнього'); return a.reduce((m, x) => x > m ? x : m); },
    round: (x, n) => { x = num(x); if (n === undefined) { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2) ? r - 1 : r; } const k = Math.pow(10, num(n)); return Math.round(x * k) / k; },
    int: x => { if (typeof x === 'string') { const v = parseInt(x, 10); if (isNaN(v) || !/^\s*[-+]?\d+\s*$/.test(x)) err(`Не можу перетворити «${x}» на ціле число`); return v; } return Math.trunc(num(x)); },
    float: x => { if (typeof x === 'string') { const v = parseFloat(x); if (isNaN(v)) err(`Не можу перетворити «${x}» на число`); return v; } return num(x); },
    str: x => str(x === undefined ? '' : x),
    bool: x => Array.isArray(x) ? x.length > 0 : !!x,
    len: x => { if (typeof x === 'string' || Array.isArray(x)) return x.length; err('len() працює лише зі списками і рядками'); },
    range: (a, b2, c) => {
      let s = 0, e, st = 1;
      if (b2 === undefined) e = num(a); else { s = num(a); e = num(b2); if (c !== undefined) st = num(c); }
      if (st === 0) err('Крок range не може бути 0');
      const r = []; for (let i = s; st > 0 ? i < e : i > e; i += st) { r.push(i); if (r.length > 100000) err('Занадто великий range'); }
      return r;
    },
    sum: l => toList(l).reduce((a, x) => a + num(x), 0),
    list: x => x === undefined ? [] : toList(x),
    sorted: x => toList(x).sort((a, b3) => a < b3 ? -1 : a > b3 ? 1 : 0),
    reversed: x => toList(x).reverse(),
    enumerate: x => toList(x).map((v, i) => [i, v]),
    randint, math: mathMod, random: randomMod,
    print: (...a) => rt.print(a, null, null),
  };
  rt.print = (args, sep, end) => {
    rt.log(args.map(str).join(sep === null ? ' ' : String(sep)) + (end === null ? '' : String(end).replace(/\n$/, '')));
  };
  rt.method = (o, n, a) => {
    if (o && o.__module) { const f = o[n]; if (typeof f !== 'function') err(`У модулі ${o.__module} немає функції «${n}»`); return f(...a); }
    if (Array.isArray(o)) {
      switch (n) {
        case 'append': o.push(a[0]); return null;
        case 'pop': { if (!o.length) err('pop() з порожнього списку'); if (a.length) { const i = a[0] < 0 ? o.length + a[0] : a[0]; if (i < 0 || i >= o.length) err('Індекс поза межами'); return o.splice(i, 1)[0]; } return o.pop(); }
        case 'insert': o.splice(a[0] < 0 ? Math.max(0, o.length + a[0]) : a[0], 0, a[1]); return null;
        case 'remove': { const i = o.findIndex(x => x === a[0]); if (i < 0) err('Такого елемента немає у списку'); o.splice(i, 1); return null; }
        case 'index': { const i = o.findIndex(x => x === a[0]); if (i < 0) err('Такого елемента немає у списку'); return i; }
        case 'count': return o.filter(x => x === a[0]).length;
        case 'clear': o.length = 0; return null;
        case 'reverse': o.reverse(); return null;
        case 'sort': o.sort((x, y) => x < y ? -1 : x > y ? 1 : 0); return null;
        case 'copy': return o.slice();
        case 'extend': o.push(...a[0]); return null;
      }
      err(`У списку немає методу .${n}()`);
    }
    if (typeof o === 'string') {
      switch (n) {
        case 'upper': return o.toUpperCase(); case 'lower': return o.toLowerCase();
        case 'strip': return o.trim();
        case 'split': return a.length ? o.split(a[0]) : o.trim().split(/\s+/);
        case 'join': return a[0].map(str).join(o);
        case 'replace': return o.split(a[0]).join(a[1]);
        case 'startswith': return o.startsWith(a[0]); case 'endswith': return o.endsWith(a[0]);
        case 'count': return o.split(a[0]).length - 1;
        case 'find': return o.indexOf(a[0]);
        case 'format': { let i = 0; return o.replace(/\{\}/g, () => str(a[i++])); }
      }
      err(`У рядка немає методу .${n}()`);
    }
    err(`Метод .${n}() тут недоступний`);
  };
  return b;
}

const compileCache = new Map();
function compileBot(src) {
  if (compileCache.has(src)) return compileCache.get(src);
  let res;
  try {
    const { code, events } = compileToJS(src);
    const names = [...Object.keys(API), ...BUILTINS];
    const header = 'const ' + names.map(n => `$${n}=__api[${JSON.stringify(n)}]`).join(',') + ';\n';
    const factory = new Function('__rt', '__api', RT_PRELUDE + header + 'return (function(){\n' + code + '\n})();');
    res = { ok: true, factory, events, js: code };
  } catch (e) {
    if (e instanceof PyError) res = { ok: false, error: { line: e.line || null, msg: e.pyMsg } };
    else res = { ok: false, error: { line: null, msg: 'Внутрішня помилка транслятора: ' + e.message } };
  }
  if (compileCache.size > 300) compileCache.clear();
  compileCache.set(src, res);
  return res;
}

/* =====================================================================
   2. ФІЗИКА БОЮ
   ===================================================================== */
const rad = d => d * Math.PI / 180;
const norm180 = a => { a = ((a % 360) + 360) % 360; return a > 180 ? a - 360 : a; };
const norm360 = a => ((a % 360) + 360) % 360;
const bearingTo = (x1, y1, x2, y2) => norm360(Math.atan2(x2 - x1, -(y2 - y1)) * 180 / Math.PI);

class Battle {
  /** bots: [{name, color, code}] ; opts: {seed, onLog(botIdx, text, kind)} */
  constructor(bots, opts = {}) {
    this.seed = (opts.seed >>> 0) || 1;
    this.rng = mulberry32(this.seed);
    this.W = CFG.W; this.H = CFG.H;
    this.tick = 0; this.over = false; this.result = null;
    this.bullets = []; this.fx = [];
    this.onLog = opts.onLog || (() => {});
    this.lastHitTick = 0;
    this.deathOrder = [];
    this.bots = bots.map((b, i) => this._makeBot(b, i));
    this._place();
    this.bots.forEach(b => this._boot(b));
  }

  _place() {
    const pts = [];
    for (const b of this.bots) {
      let x, y, tries = 0;
      do {
        x = CFG.R * 2 + this.rng() * (this.W - CFG.R * 4);
        y = CFG.R * 2 + this.rng() * (this.H - CFG.R * 4);
        tries++;
      } while (tries < 200 && pts.some(p => Math.hypot(p.x - x, p.y - y) < 140));
      pts.push({ x, y });
      b.x = x; b.y = y;
      b.heading = Math.floor(this.rng() * 36) * 10;
      b.gunRel = 0;
    }
  }

  _makeBot(spec, i) {
    return {
      i, name: spec.name || `Танк ${i + 1}`, color: spec.color || '#4caf50', code: spec.code || '',
      energy: 100, alive: true, x: 0, y: 0, heading: 0, gunRel: 0,
      heat: CFG.START_HEAT, prevGun: 0, move: 0, turn: 0, gunTurn: 0, fire: 0,
      blocked: false, stack: [], pending: [], scan: null, hitBearing: 0,
      crashed: null, say: null, score: 0, dmgDealt: 0, hits: 0, shots: 0, logCount: 0,
      seenTick: -9, deathTick: null,
    };
  }

  gunHeading(b) { return norm360(b.heading + b.gunRel); }

  _log(b, text, kind = 'print') {
    if (b.logCount++ > CFG.LOG_LIMIT) { if (b.logCount === CFG.LOG_LIMIT + 2) this.onLog(b.i, '… забагато повідомлень, далі не показую', 'sys'); return; }
    this.onLog(b.i, text, kind);
  }

  _boot(b) {
    const comp = compileBot(b.code);
    if (!comp.ok) {
      b.crashed = comp.error;
      this._log(b, `Помилка в програмі${comp.error.line ? ' (рядок ' + comp.error.line + ')' : ''}: ${comp.error.msg}`, 'error');
      return;
    }
    const self = this;
    const rt = {
      ops: 0, line: 0, depth: 0, PyError,
      rand: mulberry32(hashStr(this.seed + ':' + b.i)),
      log: t => self._log(b, t),
    };
    const api = makeBuiltins(rt);
    Object.assign(api, this._makeApi(b, rt));
    b.rt = rt;
    try {
      b.mod = comp.factory(rt, api);
    } catch (e) { return this._crash(b, e); }
    b.events = b.mod.ev;
    const mod = b.mod;
    b.stack.push({ name: 'main', prio: 0, gen: (function* () { yield* mod.init(); if (mod.ev['на_старті']) yield* mod.ev['на_старті'](); })() });
  }

  _crash(b, e) {
    const info = e instanceof PyError ? { line: e.line, msg: e.pyMsg }
      : (e instanceof RangeError ? { line: b.rt && b.rt.line, msg: 'Занадто глибока рекурсія' } : { line: b.rt && b.rt.line, msg: String(e && e.message || e) });
    b.crashed = info; b.stack = [];
    this._log(b, `Помилка під час бою${info.line ? ' (рядок ' + info.line + ')' : ''}: ${info.msg}`, 'error');
    b.say = { text: '💥 помилка', until: this.tick + 90 };
  }

  _makeApi(b, rt) {
    const self = this;
    const err = m => { throw new PyError(m, rt.line); };
    const num = (x, name) => { if (typeof x === 'boolean') return +x; if (typeof x !== 'number' || !isFinite(x)) err(`${name}(): потрібне число`); return x; };
    function* move(d, sign) {
      d = num(d, sign > 0 ? 'вперед' : 'назад') * sign;
      let rem = Math.abs(d); const dir = Math.sign(d);
      while (rem > 1e-9) {
        const st = Math.min(rem, CFG.SPEED);
        b.move = st * dir; b.blocked = false;
        yield 1;
        if (b.blocked) break;
        rem -= st;
      }
    }
    function* turn(a, sign, gun) {
      a = num(a, 'поворот') * sign;
      let rem = Math.abs(a); const dir = Math.sign(a);
      const rate = gun ? CFG.GUN_TURN : CFG.TURN;
      while (rem > 1e-9) {
        const st = Math.min(rem, rate);
        if (gun) b.gunTurn = st * dir; else b.turn = st * dir;
        yield 1; rem -= st;
      }
    }
    const enemyLive = () => b.scan;
    return {
      'вперед': d => move(d, 1),
      'назад': d => move(d, -1),
      'ліворуч': a => turn(a, -1, false),
      'праворуч': a => turn(a, 1, false),
      'гармата_ліворуч': a => turn(a, -1, true),
      'гармата_праворуч': a => turn(a, 1, true),
      'навести_на_ворога': function* () {
        if (!b.scan) { yield 1; return null; }
        const a = norm180(bearingTo(b.x, b.y, b.scan.x, b.scan.y) - self.gunHeading(b));
        yield* turn(a, 1, true);
        return null;
      },
      'вогонь': function* (p) {
        p = p === undefined ? 1 : num(p, 'вогонь');
        p = Math.max(0.1, Math.min(3, p));
        let waited = 0;
        while (b.heat > 0 && waited < 60) { yield 1; waited++; }
        if (b.energy > p) b.fire = p;
        yield 1;
        return null;
      },
      'чекати': function* (n) {
        n = n === undefined ? 1 : Math.max(1, Math.round(num(n, 'чекати')));
        for (let i = 0; i < n; i++) yield 1;
        return null;
      },
      'сказати': t => { b.say = { text: rt.str(t).slice(0, 40), until: self.tick + 60 }; return null; },
      'моя_енергія': () => Math.round(b.energy * 10) / 10,
      'мій_x': () => Math.round(b.x * 10) / 10,
      'мій_y': () => Math.round(b.y * 10) / 10,
      'мій_напрямок': () => Math.round(b.heading * 10) / 10,
      'напрямок_гармати': () => Math.round(self.gunHeading(b) * 10) / 10,
      'гармата_готова': () => b.heat <= 0,
      'ворог_видно': () => !!b.scan && self.tick - b.seenTick <= 1,
      'ворог_відстань': () => enemyLive() ? Math.round(Math.hypot(b.scan.x - b.x, b.scan.y - b.y)) : -1,
      'ворог_кут': () => enemyLive() ? Math.round(norm180(bearingTo(b.x, b.y, b.scan.x, b.scan.y) - self.gunHeading(b)) * 10) / 10 : 0,
      'ворог_енергія': () => enemyLive() ? Math.round(b.scan.energy * 10) / 10 : -1,
      'ворогів_живих': () => self.bots.filter(o => o.alive && o !== b).length,
      'удар_кут': () => Math.round(b.hitBearing * 10) / 10,
      'ширина_поля': () => self.W,
      'висота_поля': () => self.H,
      'хід': () => self.tick,
      'випадкове': (a, c) => rt.mods.random.randint(a, c),
    };
  }

  /* --- один хід бота --- */
  _runBot(b) {
    if (!b.alive || b.crashed || !b.mod) return;
    b.rt.ops = 0;
    if (b.pending.length) {
      b.pending.sort((x, y) => EVENTS[y].prio - EVENTS[x].prio);
      const ev = b.pending[0]; b.pending = [];
      const top = b.stack[b.stack.length - 1];
      const running = b.stack.some(s => s.name === ev);
      if (!running && (!top || EVENTS[ev].prio > top.prio) && b.events[ev]) {
        b.stack.push({ name: ev, prio: EVENTS[ev].prio, gen: b.events[ev]() });
      }
    }
    let guard = 0;
    try {
      while (b.stack.length && guard++ < 8) {
        const top = b.stack[b.stack.length - 1];
        b.rt.depth = 0;
        const r = top.gen.next();
        if (r.done) { b.stack.pop(); continue; }
        break;
      }
    } catch (e) { this._crash(b, e); }
  }

  step() {
    if (this.over) return;
    this.tick++;
    const alive = this.bots.filter(b => b.alive);
    // порядок ходів — перемішаний, але з ключем
    const order = alive.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const b of order) { b.move = 0; b.turn = 0; b.gunTurn = 0; b.fire = 0; }
    for (const b of order) this._runBot(b);

    // рух
    for (const b of order) {
      b.prevGun = this.gunHeading(b);
      b.heading = norm360(b.heading + b.turn);
      b.gunRel = norm360(b.gunRel + b.gunTurn);
      if (b.move) {
        const h = rad(b.heading);
        let nx = b.x + Math.sin(h) * b.move, ny = b.y - Math.cos(h) * b.move;
        const R = CFG.R;
        let hitWall = false;
        if (nx < R) { nx = R; hitWall = true; } if (nx > this.W - R) { nx = this.W - R; hitWall = true; }
        if (ny < R) { ny = R; hitWall = true; } if (ny > this.H - R) { ny = this.H - R; hitWall = true; }
        const other = this.bots.find(o => o !== b && o.alive && Math.hypot(o.x - nx, o.y - ny) < R * 2);
        if (other) {
          b.blocked = true;
          b.energy -= CFG.RAM_DMG; other.energy -= CFG.RAM_DMG;
          if (b.events && b.events['вдарився_в_стіну']) {} // таран не є стіною
        } else { b.x = nx; b.y = ny; }
        if (hitWall) {
          b.blocked = true; b.energy -= CFG.WALL_DMG;
          if (b.events && b.events['вдарився_в_стіну'] && !b.pending.includes('вдарився_в_стіну')) b.pending.push('вдарився_в_стіну');
        }
      }
      // постріл
      b.heat = Math.max(0, b.heat - CFG.COOL);
      if (b.fire && b.heat <= 0 && b.energy > b.fire) {
        const p = b.fire, g = rad(this.gunHeading(b));
        b.energy -= p; b.heat = 1 + p / 5; b.shots++;
        this.bullets.push({ owner: b.i, p, x: b.x + Math.sin(g) * (CFG.R + 6), y: b.y - Math.cos(g) * (CFG.R + 6),
          vx: Math.sin(g) * (20 - 3 * p), vy: -Math.cos(g) * (20 - 3 * p), color: b.color });
        this.fx.push({ k: 'flash', x: b.x + Math.sin(g) * (CFG.R + 10), y: b.y - Math.cos(g) * (CFG.R + 10), t: 4 });
      }
    }

    // кулі
    const keep = [];
    for (const bl of this.bullets) {
      const x0 = bl.x, y0 = bl.y;
      bl.x += bl.vx; bl.y += bl.vy;
      let hit = null, best = Infinity;
      for (const o of this.bots) {
        if (!o.alive || o.i === bl.owner) continue;
        const d = segDist(x0, y0, bl.x, bl.y, o.x, o.y);
        if (d < CFG.R + 2) { const dd = Math.hypot(o.x - x0, o.y - y0); if (dd < best) { best = dd; hit = o; } }
      }
      if (hit) {
        const dmg = 4 * bl.p + Math.max(0, 2 * (bl.p - 1));
        const sh = this.bots[bl.owner];
        hit.energy -= dmg;
        sh.dmgDealt += Math.min(dmg, Math.max(0, hit.energy + dmg)); sh.score += Math.min(dmg, Math.max(0, hit.energy + dmg));
        sh.hits++;
        if (sh.alive) sh.energy += 3 * bl.p;
        hit.hitBearing = norm180(bearingTo(hit.x, hit.y, x0, y0) - hit.heading);
        if (hit.events && hit.events['влучили_в_мене'] && !hit.pending.includes('влучили_в_мене')) hit.pending.push('влучили_в_мене');
        this.lastHitTick = this.tick;
        this.fx.push({ k: 'hit', x: bl.x, y: bl.y, t: 10, c: bl.color });
        continue;
      }
      if (bl.x < -10 || bl.x > this.W + 10 || bl.y < -10 || bl.y > this.H + 10) { this.fx.push({ k: 'spark', x: Math.max(0, Math.min(this.W, bl.x)), y: Math.max(0, Math.min(this.H, bl.y)), t: 6 }); continue; }
      keep.push(bl);
    }
    this.bullets = keep;

    // виснаження, якщо довго ніхто не влучає
    if (this.tick - this.lastHitTick > CFG.IDLE_TICKS) for (const b of this.bots) if (b.alive) b.energy -= 0.1;

    // загибель
    const nowAlive = this.bots.filter(b => b.alive);
    const dying = nowAlive.filter(b => b.energy <= 0);
    for (const d of dying) {
      d.alive = false; d.energy = 0; d.deathTick = this.tick; d.stack = [];
      this.fx.push({ k: 'boom', x: d.x, y: d.y, t: 30, c: d.color });
    }
    if (dying.length) {
      this.deathOrder.push(dying.map(d => d.i));
      for (const s of this.bots) if (s.alive) s.score += 50 * dying.length;
    }

    // радар
    for (const b of this.bots) {
      if (!b.alive) continue;
      const g = this.gunHeading(b), sweep = norm180(g - b.prevGun);
      let best = null, bd = Infinity;
      for (const o of this.bots) {
        if (o === b || !o.alive) continue;
        const dist = Math.hypot(o.x - b.x, o.y - b.y);
        if (dist > CFG.SCAN_RANGE) continue;
        const tol = CFG.SCAN_HALF + Math.asin(Math.min(1, CFG.R / dist)) * 180 / Math.PI;
        const d = norm180(bearingTo(b.x, b.y, o.x, o.y) - b.prevGun);
        const ok = sweep >= 0 ? (d >= -tol && d <= sweep + tol) : (d <= tol && d >= sweep - tol);
        if (ok && dist < bd) { bd = dist; best = o; }
      }
      if (best) {
        // «захоплення цілі»: якщо гармата пройшла повз ворога за цей хід — зупиняємо її точно на ньому
        const exact = bearingTo(b.x, b.y, best.x, best.y);
        const off = norm180(exact - b.prevGun);
        if (sweep !== 0 && (sweep > 0 ? off >= 0 && off <= sweep : off <= 0 && off >= sweep)) {
          b.gunRel = norm360(exact - b.heading);
        }
        b.scan = { id: best.i, x: best.x, y: best.y, energy: best.energy, tick: this.tick };
        b.seenTick = this.tick;
        if (b.events && b.events['бачу_ворога'] && !b.pending.includes('бачу_ворога')) b.pending.push('бачу_ворога');
      }
      if (b.scan && !this.bots[b.scan.id].alive) b.scan = null;
    }

    this.fx = this.fx.filter(f => --f.t > 0);

    // кінець
    const left = this.bots.filter(b => b.alive);
    if (left.length <= 1 || this.tick >= CFG.MAX_TICKS || (this.bots.length === 1 && this.tick > 300)) this._finish();
  }

  _finish() {
    this.over = true;
    const alive = this.bots.filter(b => b.alive).sort((a, b) => b.energy - a.energy);
    let winner = -1;
    if (alive.length === 1) { winner = alive[0].i; alive[0].score += 10 * (this.bots.length - 1); }
    else if (alive.length > 1 && alive[0].energy - alive[1].energy > 0.05) winner = alive[0].i;
    const ranking = [...alive.map(b => b.i)];
    for (let k = this.deathOrder.length - 1; k >= 0; k--) ranking.push(...this.deathOrder[k]);
    this.result = {
      winner, draw: winner < 0, ticks: this.tick, ranking, timeout: alive.length > 1,
      stats: this.bots.map(b => ({ name: b.name, score: Math.round(b.score), damage: Math.round(b.dmgDealt), energy: Math.round(b.energy), hits: b.hits, shots: b.shots, alive: b.alive, error: b.crashed })),
    };
  }

  runToEnd(maxTicks = CFG.MAX_TICKS + 5) { while (!this.over && this.tick < maxTicks) this.step(); return this.result; }
}

function segDist(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/* =====================================================================
   3. МАЛЮВАННЯ
   ===================================================================== */
function drawBattle(ctx, battle, opts = {}) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const s = Math.min(cw / battle.W, ch / battle.H);
  const ox = (cw - battle.W * s) / 2, oy = (ch - battle.H * s) / 2;
  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  ctx.translate(ox, oy); ctx.scale(s, s);
  // підлога
  ctx.fillStyle = '#1b2a1f'; ctx.fillRect(0, 0, battle.W, battle.H);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let x = 50; x < battle.W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, battle.H); ctx.stroke(); }
  for (let y = 50; y < battle.H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(battle.W, y); ctx.stroke(); }
  ctx.strokeStyle = '#8bc34a'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, battle.W - 4, battle.H - 4);

  // промені радара
  if (opts.scan !== false && CFG.SHOW_SCAN !== false) for (const b of battle.bots) {
    if (!b.alive) continue;
    const g = battle.gunHeading(b), sw = norm180(g - b.prevGun);
    const a1 = rad(Math.min(b.prevGun, b.prevGun + sw) - CFG.SCAN_HALF - 90), a2 = rad(Math.max(b.prevGun, b.prevGun + sw) + CFG.SCAN_HALF - 90);
    ctx.fillStyle = hexA(b.color, 0.07);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, 260, a1, a2); ctx.closePath(); ctx.fill();
  }
  // уламки
  for (const b of battle.bots) if (!b.alive) {
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(rad(b.heading));
    ctx.fillStyle = '#333'; ctx.fillRect(-15, -17, 30, 34);
    ctx.fillStyle = hexA(b.color, 0.35); ctx.fillRect(-10, -12, 20, 24);
    ctx.restore();
  }
  // кулі
  for (const bl of battle.bullets) {
    ctx.fillStyle = '#fff59d';
    ctx.beginPath(); ctx.arc(bl.x, bl.y, 2 + bl.p, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hexA(bl.color, 0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl.x - bl.vx * 0.8, bl.y - bl.vy * 0.8); ctx.stroke();
  }
  // танки
  for (const b of battle.bots) if (b.alive) drawTank(ctx, b.x, b.y, b.heading, battle.gunHeading(b), b.color, b.crashed);
  // ефекти
  for (const f of battle.fx) {
    if (f.k === 'flash') { ctx.fillStyle = `rgba(255,220,120,${f.t / 4})`; ctx.beginPath(); ctx.arc(f.x, f.y, 7, 0, 7); ctx.fill(); }
    if (f.k === 'hit') { ctx.strokeStyle = `rgba(255,140,60,${f.t / 10})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, 22 - f.t, 0, 7); ctx.stroke(); }
    if (f.k === 'spark') { ctx.fillStyle = `rgba(255,255,255,${f.t / 6})`; ctx.beginPath(); ctx.arc(f.x, f.y, 3, 0, 7); ctx.fill(); }
    if (f.k === 'boom') {
      const r = (30 - f.t) * 2.5;
      ctx.fillStyle = `rgba(255,${100 + f.t * 4},40,${f.t / 30})`; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.fill();
    }
  }
  // підписи
  ctx.textAlign = 'center'; ctx.font = 'bold 13px system-ui, sans-serif';
  for (const b of battle.bots) {
    if (!b.alive) continue;
    const w = 40;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(b.x - w / 2, b.y + 24, w, 5);
    ctx.fillStyle = b.energy > 50 ? '#76ff03' : b.energy > 20 ? '#ffd600' : '#ff3d00';
    ctx.fillRect(b.x - w / 2, b.y + 24, w * Math.max(0, Math.min(100, b.energy)) / 100, 5);
    ctx.fillStyle = '#fff'; ctx.fillText(b.name.slice(0, 16), b.x, b.y + 43);
    if (b.say && b.say.until > battle.tick) {
      ctx.font = '13px system-ui, sans-serif';
      const tw = ctx.measureText(b.say.text).width + 14;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      roundRect(ctx, b.x - tw / 2, b.y - 52, tw, 22, 8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b.x - 5, b.y - 31); ctx.lineTo(b.x + 5, b.y - 31); ctx.lineTo(b.x, b.y - 25); ctx.fill();
      ctx.fillStyle = '#222'; ctx.fillText(b.say.text, b.x, b.y - 36);
      ctx.font = 'bold 13px system-ui, sans-serif';
    }
  }
  ctx.restore();
}
function drawTank(ctx, x, y, heading, gun, color, broken) {
  ctx.save(); ctx.translate(x, y);
  ctx.save(); ctx.rotate(rad(heading));
  ctx.fillStyle = '#222'; ctx.fillRect(-17, -18, 8, 36); ctx.fillRect(9, -18, 8, 36);
  ctx.fillStyle = '#555'; for (let k = -16; k < 18; k += 6) { ctx.fillRect(-17, k, 8, 2); ctx.fillRect(9, k, 8, 2); }
  ctx.fillStyle = color; ctx.fillRect(-10, -15, 20, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-10, -15, 20, 5);
  ctx.restore();
  ctx.rotate(rad(gun));
  ctx.fillStyle = '#ddd'; ctx.fillRect(-2.5, -26, 5, 22);
  ctx.fillStyle = shade(color, -30); ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  if (broken) { ctx.fillStyle = 'rgba(120,120,120,0.5)'; ctx.beginPath(); ctx.arc(x, y, 20, 0, 7); ctx.fill(); }
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function shade(hex, d) { const n = parseInt(hex.slice(1), 16); const c = v => Math.max(0, Math.min(255, v + d)); return `rgb(${c(n >> 16 & 255)},${c(n >> 8 & 255)},${c(n & 255)})`; }

/** Програвач бою на canvas з керуванням швидкістю */
class BattlePlayer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.speed = 1; this.paused = false; this.battle = null; this.acc = 0; this.last = 0;
    this.onFrame = opts.onFrame || (() => {}); this.onEnd = opts.onEnd || (() => {});
    this._loop = this._loop.bind(this);
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
    requestAnimationFrame(this._loop);
  }
  _resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(100, Math.round(r.width * dpr)), h = Math.round(w * CFG.H / CFG.W);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (this.battle) drawBattle(this.ctx, this.battle);
    else this._idle();
  }
  _idle() {
    const c = this.ctx; c.fillStyle = '#1b2a1f'; c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.textAlign = 'center';
    c.font = `${Math.round(this.canvas.width / 30)}px system-ui, sans-serif`;
    c.fillText('Натисни «Почати бій»', this.canvas.width / 2, this.canvas.height / 2);
  }
  load(battle) { this.battle = battle; this.paused = false; this.acc = 0; this.ended = false; drawBattle(this.ctx, battle); this.onFrame(battle); }
  _loop(t) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(100, t - (this.last || t)); this.last = t;
    const b = this.battle;
    if (!b || this.paused) return;
    if (this.canvas.getBoundingClientRect().width && Math.abs(this.canvas.getBoundingClientRect().width * Math.min(2, devicePixelRatio || 1) - this.canvas.width) > 2) this._resize();
    if (!b.over) {
      if (this.speed === 'max') { const t0 = performance.now(); while (!b.over && performance.now() - t0 < 14) b.step(); }
      else { this.acc += dt * 30 / 1000 * this.speed; let n = 0; while (this.acc >= 1 && !b.over && n++ < 200) { b.step(); this.acc -= 1; } }
    }
    drawBattle(this.ctx, b);
    this.onFrame(b);
    if (b.over && !this.ended) { this.ended = true; this.onEnd(b.result, b); }
  }
}

/* =====================================================================
   4. КОДУВАННЯ БОТА В РЯДОК
   ===================================================================== */
const b64u = {
  enc(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; },
};
async function pipe(bytes, stream) {
  const res = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(res);
}
/** bot: {name, author, cls, color, league, code} → «TNK1…» */
async function encodeBot(bot) {
  const data = { v: 1, n: bot.name, a: bot.author, c: bot.cls, k: bot.color, l: bot.league, p: bot.code, t: bot.time || Date.now() };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'TNK1' + b64u.enc(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (e) {}
  }
  return 'TNK0' + b64u.enc(bytes);
}
async function decodeBot(str) {
  str = str.trim();
  let bytes;
  if (str.startsWith('TNK1')) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Цей браузер не вміє розпаковувати код — онови браузер');
    bytes = await pipe(b64u.dec(str.slice(4)), new DecompressionStream('deflate-raw'));
  } else if (str.startsWith('TNK0')) bytes = b64u.dec(str.slice(4));
  else if (str.startsWith('{')) return normBot(JSON.parse(str));
  else throw new Error('Це не схоже на код бота');
  return normBot(JSON.parse(new TextDecoder().decode(bytes)));
}
function normBot(d) {
  const b = d.p !== undefined ? { name: d.n, author: d.a, cls: d.c, color: d.k, league: d.l, code: d.p, time: d.t } : d;
  if (typeof b.code !== 'string') throw new Error('У файлі немає програми бота');
  b.name = String(b.name || 'Без назви').slice(0, 30);
  b.author = String(b.author || '').slice(0, 40);
  b.cls = String(b.cls || '').slice(0, 10);
  b.color = /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#4caf50';
  b.league = b.league === 'python' ? 'python' : 'blocks';
  return b;
}
/** Знаходить усі коди ботів у довільному тексті (напр., скопійованому з чату) */
function findBotCodes(text) { return (text.match(/TNK[01][A-Za-z0-9_-]{16,}/g) || []); }
function botId(b) { return hashStr(b.name + '|' + b.author + '|' + b.cls + '|' + b.code).toString(36); }

/* =====================================================================
   5. ВБУДОВАНІ БОТИ
   ===================================================================== */
const BUILTIN_BOTS = [
  {
    id: 'target', name: 'Мішень', color: '#9e9e9e', level: 'легкий', author: 'Арена', cls: '',
    about: 'Стоїть на місці і не стріляє. Для перших пострілів.',
    code: `# Мішень: просто стоїть
def на_старті():
    сказати("Я мішень 🎯")
    while True:
        чекати(10)
`,
  },
  {
    id: 'spinner', name: 'Крутько', color: '#ff9800', level: 'легкий', author: 'Арена', cls: '',
    about: 'Їздить туди-сюди, крутить гарматою і стріляє, коли бачить.',
    code: `# Крутько
def на_старті():
    while True:
        вперед(120)
        гармата_праворуч(360)
        назад(120)
        гармата_праворуч(360)

def бачу_ворога():
    вогонь(1)
`,
  },
  {
    id: 'walls', name: 'Стіноход', color: '#03a9f4', level: 'середній', author: 'Арена', cls: '',
    about: 'Їздить уздовж стін, гармата дивиться всередину арени.',
    code: `# Стіноход: їде вздовж стін
def на_старті():
    ліворуч(мій_напрямок() % 90)      # стати рівно
    вперед(1000)                       # доїхати до стіни
    гармата_праворуч(90)               # гармата — всередину арени
    праворуч(90)
    while True:
        вперед(1000)
        праворуч(90)

def бачу_ворога():
    вогонь(2)
`,
  },
  {
    id: 'hunter', name: 'Мисливець', color: '#e91e63', level: 'складний', author: 'Арена', cls: '',
    about: 'Шукає радаром, цілиться, стріляє сильніше зблизька і ухиляється.',
    code: `# Мисливець
напрям = 1

def на_старті():
    while True:
        гармата_праворуч(25)

def бачу_ворога():
    global напрям
    навести_на_ворога()
    д = ворог_відстань()
    if д < 200:
        вогонь(3)
    elif д < 450:
        вогонь(2)
    else:
        вогонь(1)
    праворуч(40)
    вперед(50 * напрям)

def влучили_в_мене():
    global напрям
    напрям = -напрям
    сказати("Ой!")

def вдарився_в_стіну():
    назад(60)
    праворуч(90)
`,
  },
];

const STARTER_PY = `# Мій танк. Рядки з # — коментарі.

def на_старті():
    # головний цикл: повторюється весь бій
    while True:
        вперед(100)
        гармата_праворуч(360)
        назад(100)
        гармата_праворуч(360)

def бачу_ворога():
    вогонь(1)

def влучили_в_мене():
    праворуч(90)
    вперед(80)

def вдарився_в_стіну():
    назад(50)
    праворуч(90)
`;

/* ---------- Турнірні допоміжні ---------- */
function matchSeed(key, a, b, round) { return hashStr(`${key}|${a}|${b}|${round}`); }

/** Нечасте перемальовування не блокує сторінку: проганяє бої порціями */
function runBattlesAsync(jobs, onProgress, onDone) {
  let i = 0, cancelled = false;
  const results = new Array(jobs.length);
  function chunk() {
    if (cancelled) return;
    const t0 = performance.now();
    while (i < jobs.length && performance.now() - t0 < 40) {
      const j = jobs[i];
      const battle = new Battle(j.bots, { seed: j.seed });
      results[i] = battle.runToEnd();
      i++;
    }
    onProgress(i, jobs.length);
    if (i < jobs.length) setTimeout(chunk, 0); else onDone(results);
  }
  setTimeout(chunk, 0);
  return { cancel() { cancelled = true; } };
}

const Tanky = {
  CFG, API, EVENTS, BUILTINS, Battle, BattlePlayer, drawBattle, drawTank, compileBot, compileToJS, PyError,
  encodeBot, decodeBot, normBot, findBotCodes, botId, BUILTIN_BOTS, STARTER_PY, hashStr, matchSeed, runBattlesAsync,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Tanky;
global.Tanky = Tanky;
})(typeof window !== 'undefined' ? window : globalThis);
