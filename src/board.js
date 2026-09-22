import { CONFIG } from './config.js';

export function tokenPercent(pointId, index, config = CONFIG) {
  const zone = config.map.zones[pointId];
  if (!zone) return null;
  const column = index % config.map.tokenColumns;
  const row = Math.floor(index / config.map.tokenColumns);
  const x = zone.anchor.x + column * config.map.tokenStep;
  const y = zone.anchor.y + row * config.map.tokenStep;
  return {
    left: (x / config.map.viewBox.width) * 100,
    top: (y / config.map.viewBox.height) * 100,
  };
}

export function anchorPercent(point, config = CONFIG) {
  return {
    left: (point.x / config.map.viewBox.width) * 100,
    top: (point.y / config.map.viewBox.height) * 100,
  };
}

function svgPath(d, className, zoneId) {
  const zone = zoneId ? ` data-zone="${zoneId}"` : '';
  return `<path class="${className}" d="${d}"${zone}></path>`;
}

export function mapMarkup(focus) {
  const { map } = CONFIG;
  const box = `${map.viewBox.x} ${map.viewBox.y} ${map.viewBox.width} ${map.viewBox.height}`;
  const zones = CONFIG.pointOrder.map((id) => {
    const zone = map.zones[id];
    const focused = focus === id ? ' focus' : '';
    return svgPath(zone.path, `zone zone-${id}${focused}`, id);
  }).join('');
  const decor = map.decor.map((d) => svgPath(d, 'decor')).join('');
  const labels = CONFIG.pointOrder.map((id) => {
    const zone = map.zones[id];
    return `<text class="zone-label" x="${zone.labelAt.x}" y="${zone.labelAt.y}">${zone.label}</text>`;
  }).join('');
  const spawn = map.spawnAnchor;
  return `
    <svg class="radar" viewBox="${box}" role="img" aria-label="${map.name}">
      ${svgPath(map.ground, 'ground')}
      ${decor}
      ${zones}
      ${labels}
      <text class="spawn-label" x="${spawn.x}" y="${spawn.y}">T spawn</text>
    </svg>
  `;
}
