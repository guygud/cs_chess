import { CONFIG } from './config.js';

export function formatStrength(value) {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace('.', ',');
}

function countWord(count) {
  return ['', 'один', 'двое', 'трое', 'четверо', 'пятеро'][count] || String(count);
}

export function resultText(fight) {
  if (!fight?.contact) return '';
  const prefix = fight.clash ? 'Встречка на дороге. ' : '';
  const bits = [`${prefix}${formatStrength(fight.attackFinal)} против ${formatStrength(fight.defenseFinal)}.`];
  const enemyDead = fight.present.filter((person) => person.side === 'defense' && person.died);
  const ownDead = fight.present.filter((person) => person.side === 'attack' && person.died);
  if (enemyDead.length > 1) bits.push(`Их ${countWord(enemyDead.length)} легли.`);
  else if (enemyDead.length === 1) bits.push(`${enemyDead[0].name} погиб.`);
  if (ownDead.length === 1) bits.push(`${ownDead[0].name} погиб.`);
  else if (ownDead.length > 1) bits.push(`Ваши легли: ${ownDead.map((person) => person.name).join(', ')}.`);
  const saved = fight.present.filter((person) => person.saved);
  if (saved.length) bits.push(`Броник спас: ${saved.map((person) => person.name).join(', ')}.`);
  return bits.join(' ');
}

export function playCaption(step) {
  if (!step?.plays?.attack) return '';
  const bot = step.plays.defense ? ` Бот: ${step.plays.defense}.` : '';
  return `Вы: ${step.plays.attack}.${bot}`;
}

// Фейк сработал, если бот увёл людей туда, куда ушла двойка.
export function fakeCaption(step, config = CONFIG) {
  const { fakeZone, defenseZone } = step?.plays || {};
  if (!fakeZone) return '';
  const label = (cellId) => config.map.cells[cellId]?.label || cellId;
  if (defenseZone === fakeZone) return `Фейк сработал: бот ушёл на\u00A0${label(fakeZone)}.`;
  if (config.map.cells[defenseZone]?.plant) return `Фейк не сработал: бот держит ${label(defenseZone)}.`;
  return 'Фейк не сработал: бот не повёлся.';
}

export function throwCaption(step, side, config = CONFIG) {
  const items = step?.thrown?.[side] || [];
  if (!items.length) return '';
  return items.map((item) => {
    const name = config.utility[item.type]?.name || item.type;
    const cell = config.map.cells[item.point]?.label || item.point;
    const who = side === 'attack' ? `Ваша ${name.toLowerCase()}` : `${name} бота`;
    return `${who}\u00A0— в\u00A0${cell}.`;
  }).join(' ');
}

export function endText(state) {
  if (!state?.winner) return '';
  if (state.endReason === 'bomb') return 'Бомба не обезврежена. Раунд ваш.';
  if (state.endReason === 'defuse') return 'Бомбу обезвредили. Раунд защиты.';
  if (state.endReason === 'wipe' && state.winner === 'attack') return 'Защита выбита. Раунд ваш.';
  if (state.endReason === 'wipe') return 'Вас выбили. Раунд защиты.';
  if (state.endReason === 'alive' && state.winner === 'attack') return 'Бомбы не было. Живых больше у вас.';
  return 'Бомбы не было. Живых не больше, раунд защиты.';
}

export function cellNote(cellId, step, truth) {
  const bits = [];
  const fight = step?.fights[cellId];
  if (fight && (truth || fight.contact)) {
    const smoke = (fight.smoke.attack || 0) + (fight.smoke.defense || 0);
    if (smoke) bits.push(`Дымовая −${formatStrength(smoke)} каждому.`);
    if (fight.flash.attack || fight.flash.defense) bits.push('Световая в этой клетке.');
  }
  if (step?.planted === cellId) bits.push('Бомба поставлена.');
  if (step?.defused && step.state.bomb?.point === cellId) bits.push('Бомба обезврежена.');
  return bits.join(' ');
}
