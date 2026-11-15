/* Танкова Арена — блоки для Blockly (українською) і перетворення їх на Python */
(function (global) {
'use strict';

function setupTankBlocks(Blockly, python) {
  const gen = python.pythonGenerator;
  const Order = python.Order;

  // Дозволяємо кирилицю в назвах змінних і функцій (Python 3 це вміє)
  Blockly.Names.prototype.safeName = function (name) {
    if (!name) return 'змінна';
    name = name.trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '_');
    if (/^\p{N}/u.test(name)) name = 'н_' + name;
    return name;
  };

  const C = { ev: '#e6a100', move: '#2e9e5b', gun: '#d84a3c', sens: '#3f7fd8', say: '#8e5bd6' };

  const defs = [
    // ---- події ----
    ...['на_старті', 'бачу_ворога', 'влучили_в_мене', 'вдарився_в_стіну'].map((ev, k) => ({
      type: 'tank_ev_' + ev,
      message0: ['🚩 коли бій почався', '👁 коли бачу ворога', '💥 коли в мене влучили', '🧱 коли вдарився в стіну'][k],
      message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }],
      colour: C.ev,
      tooltip: ['Цей код починає працювати на старті бою. Зазвичай тут цикл «повторювати завжди».',
        'Спрацьовує, коли радар (він дивиться туди ж, куди гармата) помітив ворога.',
        'Спрацьовує, коли в твій танк влучила куля.',
        'Спрацьовує, коли танк вперся в стіну.'][k],
      hat: 'cap',
    })),
    // ---- рух ----
    { type: 'tank_forward', message0: 'їхати вперед на %1 кроків', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.move, tooltip: 'Танк проїде вперед. 6 кроків = 1 хід.' },
    { type: 'tank_back', message0: 'їхати назад на %1 кроків', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.move },
    { type: 'tank_left', message0: '↺ повернути ліворуч на %1 °', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.move },
    { type: 'tank_right', message0: '↻ повернути праворуч на %1 °', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.move },
    { type: 'tank_wait', message0: '⏳ чекати %1 ходів', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.move },
    // ---- гармата ----
    { type: 'tank_gun_left', message0: '🔫 гармату ліворуч на %1 °', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.gun, tooltip: 'Радар дивиться туди ж, куди гармата. Крути гармату, щоб шукати ворогів.' },
    { type: 'tank_gun_right', message0: '🔫 гармату праворуч на %1 °', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.gun },
    { type: 'tank_aim', message0: '🎯 навести гармату на ворога', previousStatement: null, nextStatement: null, colour: C.gun, tooltip: 'Повертає гармату туди, де радар востаннє бачив ворога.' },
    { type: 'tank_fire', message0: '💥 вогонь! сила %1', args0: [{ type: 'input_value', name: 'N', check: 'Number' }], previousStatement: null, nextStatement: null, colour: C.gun, tooltip: 'Сила від 0.1 до 3. Сильніший постріл б’є болючіше, але куля летить повільніше і витрачає більше енергії.' },
    // ---- сенсори ----
    {
      type: 'tank_sensor', message0: '%1', output: 'Number', colour: C.sens,
      args0: [{ type: 'field_dropdown', name: 'S', options: [
        ['моя енергія', 'моя_енергія'], ['відстань до ворога', 'ворог_відстань'], ['кут до ворога', 'ворог_кут'],
        ['енергія ворога', 'ворог_енергія'], ['мій напрямок', 'мій_напрямок'], ['напрямок гармати', 'напрямок_гармати'],
        ['мій x', 'мій_x'], ['мій y', 'мій_y'], ['звідки влучили (кут)', 'удар_кут'], ['ворогів живих', 'ворогів_живих'],
        ['ширина поля', 'ширина_поля'], ['висота поля', 'висота_поля'], ['номер ходу', 'хід']] }],
      tooltip: 'Що знає танк про себе і про ворога.',
    },
    { type: 'tank_seen', message0: 'бачу ворога зараз?', output: 'Boolean', colour: C.sens },
    { type: 'tank_ready', message0: 'гармата готова?', output: 'Boolean', colour: C.sens },
    { type: 'tank_random', message0: 'випадкове від %1 до %2', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'input_value', name: 'B', check: 'Number' }], inputsInline: true, output: 'Number', colour: C.sens },
    // ---- говорити ----
    { type: 'tank_say', message0: '💬 сказати %1', args0: [{ type: 'input_value', name: 'T' }], previousStatement: null, nextStatement: null, colour: C.say, tooltip: 'Показує хмаринку з текстом над танком.' },
    { type: 'tank_print', message0: '📝 записати в журнал %1', args0: [{ type: 'input_value', name: 'T' }], previousStatement: null, nextStatement: null, colour: C.say, tooltip: 'Текст з’явиться в журналі під ареною (як print у Python).' },
    { type: 'tank_forever', message0: '🔁 повторювати завжди', message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }], previousStatement: null, colour: '#5b80a5' },
  ];
  // «шапки» подій: без з'єднань зверху і знизу
  defs.forEach(d => { if (d.hat) delete d.hat; });
  Blockly.defineBlocksWithJsonArray(defs);

  const val = (b, name, dflt = '0') => gen.valueToCode(b, name, Order.NONE) || dflt;
  const globalsLine = block => {
    const ws = block.workspace;
    const vars = ws.getVariableMap ? ws.getVariableMap().getAllVariables() : ws.getAllVariables();
    const names = vars.map(v => gen.getVariableName(v.getId()));
    return names.length ? gen.INDENT + 'global ' + names.join(', ') + '\n' : '';
  };
  for (const ev of ['на_старті', 'бачу_ворога', 'влучили_в_мене', 'вдарився_в_стіну']) {
    gen.forBlock['tank_ev_' + ev] = function (block) {
      let body = gen.statementToCode(block, 'DO') || gen.INDENT + 'pass\n';
      return `def ${ev}():\n` + globalsLine(block) + body + '\n';
    };
  }
  const cmd = (name, arg = 'N') => b => `${name}(${val(b, arg)})\n`;
  gen.forBlock['tank_forward'] = cmd('вперед');
  gen.forBlock['tank_back'] = cmd('назад');
  gen.forBlock['tank_left'] = cmd('ліворуч');
  gen.forBlock['tank_right'] = cmd('праворуч');
  gen.forBlock['tank_wait'] = cmd('чекати');
  gen.forBlock['tank_gun_left'] = cmd('гармата_ліворуч');
  gen.forBlock['tank_gun_right'] = cmd('гармата_праворуч');
  gen.forBlock['tank_aim'] = () => 'навести_на_ворога()\n';
  gen.forBlock['tank_fire'] = cmd('вогонь');
  gen.forBlock['tank_sensor'] = b => [b.getFieldValue('S') + '()', Order.FUNCTION_CALL];
  gen.forBlock['tank_seen'] = () => ['ворог_видно()', Order.FUNCTION_CALL];
  gen.forBlock['tank_ready'] = () => ['гармата_готова()', Order.FUNCTION_CALL];
  gen.forBlock['tank_random'] = b => [`випадкове(${val(b, 'A')}, ${val(b, 'B')})`, Order.FUNCTION_CALL];
  gen.forBlock['tank_say'] = b => `сказати(${val(b, 'T', "''")})\n`;
  gen.forBlock['tank_print'] = b => `print(${val(b, 'T', "''")})\n`;
  gen.forBlock['tank_forever'] = b => 'while True:\n' + (gen.statementToCode(b, 'DO') || gen.INDENT + 'pass\n');
  // простіший «змінити на», без isinstance
  gen.forBlock['math_change'] = b => `${gen.getVariableName(b.getFieldValue('VAR'))} += ${gen.valueToCode(b, 'DELTA', Order.ADDITIVE) || '0'}\n`;
  gen.forBlock['text_join'] = b => {
    const parts = [];
    for (let i = 0; i < b.itemCount_; i++) parts.push('str(' + (gen.valueToCode(b, 'ADD' + i, Order.NONE) || "''") + ')');
    if (!parts.length) return ["''", Order.ATOMIC];
    return [parts.join(' + '), Order.ADDITIVE];
  };
  // 4 пробіли, як у підручнику
  gen.INDENT = '    ';
}

function generatePython(Blockly, python, ws) {
  const gen = python.pythonGenerator;
  gen.init(ws);
  // Лише блоки-події та функції дають код; самотні блоки ігноруємо
  const tops = ws.getTopBlocks(true);
  let code = '';
  const vars = (ws.getVariableMap ? ws.getVariableMap().getAllVariables() : ws.getAllVariables());
  for (const v of vars) code += gen.getVariableName(v.getId()) + ' = 0\n';
  if (vars.length) code += '\n';
  let loose = 0;
  for (const b of tops) {
    if (!b.isEnabled()) continue;
    if (b.type.startsWith('tank_ev_') || b.type.startsWith('procedures_def')) {
      let c = gen.blockToCode(b);
      if (Array.isArray(c)) c = c[0];
      code += c;
    } else loose++;
  }
  // визначення функцій, які зібрав генератор (procedures)
  const defs = gen.definitions_ || {};
  let extra = '';
  for (const k of Object.keys(defs)) {
    if (/^(import_|from_)/.test(k)) continue;
    const d = defs[k];
    if (/^def /.test(d) || /^%/.test(d)) extra += d + '\n\n';
  }
  gen.nameDB_ && gen.nameDB_.reset && 0;
  code = (extra ? extra : '') + code;
  code = code.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return { code, loose };
}

const STARTER_BLOCKS = {
  blocks: { languageVersion: 0, blocks: [
    { type: 'tank_ev_на_старті', x: 20, y: 20, inputs: { DO: { block: { type: 'tank_forever', inputs: { DO: { block:
      { type: 'tank_forward', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 100 } } } }, next: { block:
      { type: 'tank_gun_right', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 360 } } } }, next: { block:
      { type: 'tank_back', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 100 } } } }, next: { block:
      { type: 'tank_gun_right', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 360 } } } } } } } } } } } } } } } } },
    { type: 'tank_ev_бачу_ворога', x: 20, y: 300, inputs: { DO: { block: { type: 'tank_fire', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } } } } },
    { type: 'tank_ev_вдарився_в_стіну', x: 20, y: 420, inputs: { DO: { block: { type: 'tank_back', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 50 } } } }, next: { block: { type: 'tank_right', inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 90 } } } } } } } } } },
  ] },
};

const num = n => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Події', colour: '#e6a100', contents: ['на_старті', 'бачу_ворога', 'влучили_в_мене', 'вдарився_в_стіну'].map(e => ({ kind: 'block', type: 'tank_ev_' + e })) },
    { kind: 'category', name: 'Рух', colour: '#2e9e5b', contents: [
      { kind: 'block', type: 'tank_forward', inputs: { N: num(100) } },
      { kind: 'block', type: 'tank_back', inputs: { N: num(100) } },
      { kind: 'block', type: 'tank_left', inputs: { N: num(90) } },
      { kind: 'block', type: 'tank_right', inputs: { N: num(90) } },
      { kind: 'block', type: 'tank_wait', inputs: { N: num(5) } },
    ] },
    { kind: 'category', name: 'Гармата', colour: '#d84a3c', contents: [
      { kind: 'block', type: 'tank_gun_right', inputs: { N: num(360) } },
      { kind: 'block', type: 'tank_gun_left', inputs: { N: num(360) } },
      { kind: 'block', type: 'tank_aim' },
      { kind: 'block', type: 'tank_fire', inputs: { N: num(1) } },
    ] },
    { kind: 'category', name: 'Сенсори', colour: '#3f7fd8', contents: [
      { kind: 'block', type: 'tank_sensor' },
      { kind: 'block', type: 'tank_sensor', fields: { S: 'ворог_відстань' } },
      { kind: 'block', type: 'tank_seen' },
      { kind: 'block', type: 'tank_ready' },
      { kind: 'block', type: 'tank_random', inputs: { A: num(1), B: num(10) } },
    ] },
    { kind: 'category', name: 'Цикли', colour: '#5b80a5', contents: [
      { kind: 'block', type: 'tank_forever' },
      { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: num(4) } },
      { kind: 'block', type: 'controls_whileUntil' },
      { kind: 'block', type: 'controls_flow_statements' },
    ] },
    { kind: 'category', name: 'Умови', colour: '#5b80a5', contents: [
      { kind: 'block', type: 'controls_if' },
      { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
      { kind: 'block', type: 'logic_compare' },
      { kind: 'block', type: 'logic_operation' },
      { kind: 'block', type: 'logic_negate' },
      { kind: 'block', type: 'logic_boolean' },
    ] },
    { kind: 'category', name: 'Числа', colour: '#5b67a5', contents: [
      { kind: 'block', type: 'math_number' },
      { kind: 'block', type: 'math_arithmetic', inputs: { A: num(1), B: num(1) } },
      { kind: 'block', type: 'math_single', fields: { OP: 'ABS' }, inputs: { NUM: num(-5) } },
      { kind: 'block', type: 'math_modulo', inputs: { DIVIDEND: num(10), DIVISOR: num(3) } },
      { kind: 'block', type: 'math_round', inputs: { NUM: num(3.1) } },
    ] },
    { kind: 'category', name: 'Говорити', colour: '#8e5bd6', contents: [
      { kind: 'block', type: 'tank_say', inputs: { T: { shadow: { type: 'text', fields: { TEXT: 'Привіт!' } } } } },
      { kind: 'block', type: 'tank_print', inputs: { T: { shadow: { type: 'text', fields: { TEXT: 'тут' } } } } },
      { kind: 'block', type: 'text' },
      { kind: 'block', type: 'text_join' },
    ] },
    { kind: 'sep' },
    { kind: 'category', name: 'Змінні', colour: '#a55b80', custom: 'VARIABLE' },
    { kind: 'category', name: 'Функції', colour: '#995ba5', custom: 'PROCEDURE' },
  ],
};

const api = { setupTankBlocks, generatePython, STARTER_BLOCKS, TOOLBOX };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.TankBlocks = api;
})(typeof window !== 'undefined' ? window : globalThis);
