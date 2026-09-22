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
    y: cell.y,
    r: cell.x + cell.w,
    b: cell.y + cell.h,
    cx: cell.x + cell.w / 2,
    cy: cell.y + cell.h / 2,
  };
}

function elbowsFor(left, right, map) {
  const key = [left, right].sort().join('-');
  if (key === 'CTSPAWN-MID') {
    const mid = rect('MID', map);
    const ct = rect('CTSPAWN', map);
    const short = rect('SHORT', map);
    const gutter = (ct.r + short.x) / 2;
    const below = short.b + (ct.y - short.b) / 2;
    return [[gutter, mid.cy], [gutter, below], [ct.cx, below]];
  }
  if (key === 'CTSPAWN-LONG') {
    const long = rect('LONG', map);
    const ct = rect('CTSPAWN', map);
    const edge = map.viewBox.width - 6;
    return [[edge, long.cy], [edge, ct.cy]];
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
