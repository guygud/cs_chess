export function analysisText(history) {
  if (!history.length) return 'Движок не успел оценить партию.';
  if (history[0].forced) {
    const who = history[0].forced === 'attack' ? 'Атака' : 'Защита';
    return `${who} выигрывает при точной игре ещё до первого хода. Дальше партия только доводит уже готовый результат.`;
  }
  const hit = history.find((item) => item.san && item.forced);
  if (!hit) {
    return 'Движок так и не увидел форсированного исхода. До конца всё решала оценка, а не точный расчёт.';
  }
  const who = hit.forced === 'attack' ? 'атака' : 'защита';
  return `На ${hit.fullmove}-м ходу ${hit.san} оценка стала форсированной: ${who} выигрывает при точной игре.`;
}
