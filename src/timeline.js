import { CONFIG } from './config.js';
import { compare } from './engine.js';

const TITLES = {
  reveal: 'Вскрытие',
  mid: 'Мид',
  transfer: 'Переброс',
  rotator: 'Ротатор',
  utility: 'Гранаты',
  siteA: 'Сайт A',
  siteB: 'Сайт B',
  result: 'Итог',
};

function formatStrength(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, '').replace('.', ',');
}

function pointName(id) {
  return CONFIG.points[id] ? CONFIG.points[id].name : id;
}

function sideName(side) {
  return side === 'attack' ? 'Атака' : 'Защита';
}

export function stageTitle(id) {
  return TITLES[id] || id;
}

export function describeStage(stage, previous, result) {
  const title = stageTitle(stage.id);
  if (stage.id === 'reveal') {
    return { title, text: 'Обе расстановки открыты. Выстрелов ещё нет.' };
  }
  if (stage.id === 'mid') {
    const point = stage.points[stage.focus];
    const who = point.control === 'attack' ? 'атака' : point.control === 'defense' ? 'защита' : 'никто';
    let text = `Атака ${formatStrength(point.attackStrength)}, защита ${formatStrength(point.defenseFinal)}. Мид берёт ${who}.`;
    if (point.smokePenalty) text += ` Смоук уже снял ${formatStrength(point.smokePenalty)}.`;
    if (point.flash && point.control === 'attack' && compare(point.attackStrength, point.defenseFinal) === 0) {
      text += ' Ничью забрал флеш.';
    }
    return { title, text };
  }
  if (stage.id === 'transfer') {
    if (!stage.transfer) return { title, text: 'Переброса нет.' };
    const move = stage.transfer;
    let text = `${sideName(move.side)} переносит ${move.name} с\u00A0мида на\u00A0${pointName(move.to)}.`;
    if (compare(move.strengthBefore, move.strengthAfter) !== 0) {
      text += ` Сила ${formatStrength(move.strengthBefore)} → ${formatStrength(move.strengthAfter)}.`;
    }
    return { title, text };
  }
  if (stage.id === 'rotator') {
    if (!stage.rotator || !stage.rotator.point) {
      return { title, text: 'Ротатор не вышел: на сайтах некого встречать.' };
    }
    return {
      title,
      text: `${stage.rotator.name} вышел на\u00A0${pointName(stage.rotator.point)} и\u00A0добавил ${formatStrength(stage.rotator.strength)} к\u00A0защите.`,
    };
  }
  if (stage.id === 'utility') {
    const changes = [];
    for (const id of CONFIG.pointOrder) {
      const before = previous.points[id].defenseFinal;
      const after = stage.points[id].defenseFinal;
      if (compare(before, after) !== 0) {
        changes.push(`${pointName(id)}: ${formatStrength(before)} → ${formatStrength(after)}`);
      }
    }
    let text = changes.length
      ? `Смоук изменил защиту. ${changes.join('. ')}.`
      : 'Смоуков нет, сила защиты не изменилась.';
    if (stage.flashes.length) {
      const names = stage.flashes.map((id) => pointName(id)).join(', ');
      text += ` Флеш на\u00A0${names}: ничья уйдёт атаке, если там есть её боец.`;
    }
    return { title, text };
  }
  if (stage.id === 'result') {
    const who = result.winner === 'attack' ? 'атакой' : 'защитой';
    const sites = result.takenSites.length
      ? `Проход на\u00A0${result.takenSites.map((id) => pointName(id)).join(' и\u00A0')}.`
      : 'Оба сайта удержаны.';
    return { title, text: `Раунд за\u00A0${who}. ${sites}` };
  }
  const point = stage.points[stage.focus];
  const outcome = point.control === 'attack' ? 'Сайт взят.' : 'Сайт удержан.';
  let text = `Атака ${formatStrength(point.attackStrength)}, защита ${formatStrength(point.defenseFinal)}. ${outcome}`;
  if (point.flash && point.control === 'attack' && compare(point.attackStrength, point.defenseFinal) === 0) {
    text += ' Решила ничья и\u00A0флеш.';
  }
  return { title, text };
}

export function changedOn(stages, pointId) {
  let found = stages[0].id;
  let previous = stages[0].points[pointId];
  for (const stage of stages.slice(1)) {
    const next = stage.points[pointId];
    const moved = compare(previous.attackStrength, next.attackStrength) !== 0
      || compare(previous.defenseFinal, next.defenseFinal) !== 0
      || previous.control !== next.control;
    if (moved) {
      found = stage.id;
      previous = next;
    }
  }
  return found;
}
