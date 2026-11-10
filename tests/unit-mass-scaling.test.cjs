'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const rosterStart = html.indexOf('const SP=');
const rosterEnd = html.indexOf('];', rosterStart);
const scalingStart = html.indexOf('function massLog10(');
const scalingEnd = html.indexOf('function updateBallRadii(', scalingStart);
const spawnStart = html.indexOf('function spawn(f,t,mass=1n)');
const spawnEnd = html.indexOf('function stunRemaining(', spawnStart);
assert.ok(rosterStart >= 0 && rosterEnd > rosterStart, 'could not find the live hero roster');
assert.ok(scalingStart >= 0 && scalingEnd > scalingStart, 'could not find the live mass helpers');
assert.ok(spawnStart >= 0 && spawnEnd > spawnStart, 'could not find the live spawn function');

// Evaluate the game's actual roster, mass helpers, and spawn() in a small VM.
// This keeps the test tied to production logic without exporting internals.
const productionSource = html.slice(rosterStart, rosterEnd + 2)
  + '\n'
  + html.slice(scalingStart, scalingEnd)
  + '\n'
  + html.slice(spawnStart, spawnEnd);
function createGameHarness() {
  const sandbox = {
    HOME: [[78, 78], [742, 78], [78, 742], [742, 742]],
    teams: Array.from({ length: 4 }, () => ({ alive: true, betrayalUntil: 0 })),
    units: [],
    uid: 0,
    time: 0,
    rng: () => 0.5
  };
  vm.createContext(sandbox);
  vm.runInContext(productionSource, sandbox);
  return sandbox;
}
function spawn(harness, faction, type, mass) {
  return vm.runInContext(`spawn(${faction}, ${type}, ${mass}n)`, harness);
}

test('larger marble values increase HP and attack for every soldier and faction hero', () => {
  const game = createGameHarness();
  const masses = [1n, 10n, 100n, 1000000n, 1000000000000000n, 1000000000000000000000000000000n];

  for (let faction = 0; faction < 4; faction++) {
    for (let type = 0; type <= 4; type++) {
      const units = masses.map((mass) => spawn(game, faction, type, mass));
      const label = `faction ${faction}, ${type === 4 ? 'hero' : `soldier type ${type}`}`;

      for (let i = 1; i < 5; i++) {
        assert.ok(units[i].max > units[i - 1].max, `${label}: HP should grow as marble mass grows`);
        assert.ok(units[i].damage > units[i - 1].damage, `${label}: attack should grow as marble mass grows`);
        assert.equal(units[i].max, units[i].hp, `${label}: new unit starts at its mass-scaled maximum HP`);
      }

      // The documented mass-based HP/attack bonus is capped at 4× from 10^15 onward.
      assert.equal(units[4].massScale, 4, `${label}: HP/attack multiplier reaches the existing 4× cap`);
      assert.equal(units[5].massScale, 4, `${label}: HP/attack multiplier remains capped above 10^15`);
      assert.equal(units[4].max, units[5].max, `${label}: HP does not exceed the 4× cap`);
      assert.equal(units[4].damage, units[5].damage, `${label}: attack does not exceed the 4× cap`);
      assert.equal(units[4].max, Math.round(units[0].max * 4), `${label}: capped HP equals 4× base HP`);
      assert.equal(units[4].damage, units[0].damage * 4, `${label}: capped attack equals 4× base attack`);
    }
  }
});
