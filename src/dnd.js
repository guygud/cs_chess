// Захват указателя и попадание в зону. Про правила игры модуль не знает.

export function bindDrag(root, handlers, options) {
  let drag = null;

  function onDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('[data-stop]')) return;
    const token = event.target.closest('[data-token]');
    if (!token || !root.contains(token)) return;
    token.setPointerCapture(event.pointerId);
    drag = {
      token,
      id: token.dataset.token,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      pointerId: event.pointerId,
      zones: cacheZones(),
    };
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < options.threshold) return;
    drag.moved = true;
    document.documentElement.classList.add('dragging');
    const token = drag.token;
    token.classList.add('dragging');
    token.style.position = 'fixed';
    token.style.left = `${event.clientX}px`;
    token.style.top = `${event.clientY}px`;
    token.style.transform = 'translate(-50%, -50%)';
    token.style.zIndex = '20';
    token.style.pointerEvents = 'none';
  }

  function cacheZones() {
    return [...root.querySelectorAll('[data-zone]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.zone, rect, area: rect.width * rect.height };
    });
  }

  function zoneAt(x, y, zones) {
    const hit = document.elementFromPoint(x, y);
    const direct = hit && hit.closest('[data-zone]');
    if (direct && root.contains(direct)) return direct.dataset.zone;
    const inside = zones.filter((item) => (
      x >= item.rect.left && x <= item.rect.right && y >= item.rect.top && y <= item.rect.bottom
    ));
    inside.sort((left, right) => left.area - right.area);
    return inside.length ? inside[0].id : null;
  }

  function finish(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    document.documentElement.classList.remove('dragging');
    if (!current.moved) {
      handlers.onTap(current.id);
      return;
    }
    root.dataset.dragged = '1';
    const zone = zoneAt(event.clientX, event.clientY, current.zones);
    handlers.onDrop(current.id, zone);
  }

  function onClick(event) {
    if (root.dataset.dragged === '1') {
      delete root.dataset.dragged;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.target.closest('[data-token]') || event.target.closest('[data-stop]')) return;
    const zone = event.target.closest('[data-zone]');
    if (!zone || !root.contains(zone)) return;
    handlers.onZone(zone.dataset.zone);
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('click', onClick);
  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', finish);
    root.removeEventListener('pointercancel', finish);
    root.removeEventListener('click', onClick);
  };
}
