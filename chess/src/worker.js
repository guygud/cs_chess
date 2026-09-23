import { search } from './engine.js';

self.onmessage = (event) => {
  const { id, pos, options } = event.data;
  const board = Int8Array.from(pos.board);
  const result = search({
    board,
    side: pos.side,
    fullmove: pos.fullmove,
    plant: pos.plant,
    result: pos.result,
  }, options);
  self.postMessage({ id, result });
};
