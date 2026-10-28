import assert from "node:assert/strict";
import test from "node:test";
import { clamp, focalOffset, panLimit, swipePage } from "../src/features/reader/gestures";

test("deslizes horizontais seguem a leitura da direita para a esquerda", () => {
  assert.equal(swipePage(90, 10, 1, false), 1);
  assert.equal(swipePage(-90, 10, 1, false), -1);
});

test("toques, rolagem vertical, diagonais, zoom e pinças não trocam páginas", () => {
  for (const [dx, dy, scale, multiple] of [
    [0, 0, 1, false], [40, 0, 1, false], [70, 100, 1, false],
    [70, 60, 1, false], [100, 0, 2, false], [100, 0, 1.005, false], [100, 0, 1, true],
  ] as const) {
    assert.equal(swipePage(dx, dy, scale, multiple), 0);
  }
});

test("limites deixam alcançar as duas extremidades de páginas altas e ampliadas", () => {
  assert.equal(panLimit(1200, 600, 1), 300);
  assert.equal(panLimit(400, 600, 1), 0);
  assert.equal(panLimit(400, 400, 3), 400);
  assert.equal(clamp(900, -300, 300), 300);
  assert.equal(clamp(-900, -300, 300), -300);
});

test("zoom preserva o ponto sob os dedos antes de aplicar limites", () => {
  const focal = 80;
  const offset = 20;
  const ratio = 2.5;
  const next = focalOffset(focal, offset, ratio);
  assert.equal((focal - next) / ratio, focal - offset);
  assert.equal(focalOffset(0, 0, 4), 0);
});
