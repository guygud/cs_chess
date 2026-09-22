import { CONFIG } from './config.js';

export function cellBox(cellId, config = CONFIG) {
  const cell = config.map.cells[cellId];
  const box = config.map.viewBox;
  return {
    left: (cell.x / box.width) * 100,
    top: (cell.y / box.height) * 100,
    width: (cell.w / box.width) * 100,
    height: (cell.h / box.height) * 100,
    cx: cell.x + cell.w / 2,
    cy: cell.y + cell.h / 2,
  };
}

function center(cellId, config) {
  const box = cellBox(cellId, config);
  return [box.cx, box.cy];
}

function rect(cellId, map) {
  const cell = map.cells[cellId];
  return {
    x: cell.x,
    r: cell.x + cell.w,
    b: cell.y + cell.h,
    cx: cell.x + cell.w / 2,
    cy: cell.y + cell.h / 2,
  };
}

function elbowsFor(left, right, map) {
  const key = [left, right].sort().join('-');
  const box = map.viewBox;
  const bottom = box.height - 10;
  const edge = box.width - 8;
  if (key === 'MID-TSPAWN') {
    const spawn = rect('TSPAWN', map);
    const mid = rect('MID', map);
    const gap = (spawn.r + rect('SHORT', map).x) / 2;
    return [[gap, spawn.cy], [gap, mid.cy]];
  }
  if (key === 'CTSPAWN-MID') {
    const mid = rect('MID', map);
    const ct = rect('CTSPAWN', map);
    return [[mid.cx, bottom], [edge, bottom], [edge, ct.cy]];
  }
  if (key === 'PLANTB-TUNNEL') {
    const tunnel = rect('TUNNEL', map);
    const plant = rect('PLANTB', map);
    return [[tunnel.cx, bottom], [edge, bottom], [edge, plant.cy]];
  }
  return [];
}

export function mapMarkup() {
  const { map } = CONFIG;
  const box = `${map.viewBox.x} ${map.viewBox.y} ${map.viewBox.width} ${map.viewBox.height}`;
  const lines = CONFIG.edges.map(([left, right]) => {
    const from = center(left);
    const to = center(right);
    const bend = elbowsFor(left, right, map);
    const points = [from, ...bend, to].map(([x, y]) => `${x},${y}`).join(' ');
    return `<polyline class="link" points="${points}"></polyline>`;
  }).join('');
  return `
    <svg class="radar" viewBox="${box}" role="img" aria-label="${map.name}">
      <rect class="ground" x="0" y="0" width="${map.viewBox.width}" height="${map.viewBox.height}"></rect>
      ${lines}
    </svg>
  `;
}
