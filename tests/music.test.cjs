'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const between = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source block not found: ${start} .. ${end}`);
  return source.slice(a, b);
};
const constants = between('const LEADER_THEMES=', '\nlet musicEnabled=');
const state = between('let musicEnabled=false', '\nconst bg=');
const musicFunctions = between('function updateMusicButton()', '\nfunction burst(');
const pauseStart = source.indexOf('function togglePause()');
const pauseEnd = source.indexOf('\n', pauseStart);
assert.ok(pauseStart >= 0 && pauseEnd > pauseStart, 'togglePause source line not found');
const pauseFunction = source.slice(pauseStart, pauseEnd);

function createHarness({ fetchDelay = 0, decodeDelay = 0, resumeDelay = 0, autoLeader = true } = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', title: '', value: '', attrs: {}, classes: new Set(),
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      classList: { toggle(name, on) { if (on) thisElement.classes.add(name); else thisElement.classes.delete(name); } }
    });
    const thisElement = elements.get(id);
    return thisElement;
  }
  // Bind the class-list shim after creating each element.
  const document = { getElementById: element, createElement: () => ({}) };
  const contexts = [];
  class FakeAudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.resumeCalls = 0; this.suspendCalls = 0; this.sources = []; contexts.push(this); }
    createGain() { return { gain: { value: 1, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, cancelScheduledValues() {} }, connect() {}, disconnect() {} }; }
    createBufferSource() { const s = { buffer: null, loop: false, connect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; this.sources.push(s); return s; }
    resume() { this.resumeCalls++; return new Promise(resolve => setTimeout(() => { this.state = 'running'; resolve(); }, resumeDelay)); }
    suspend() { this.suspendCalls++; return new Promise(resolve => setTimeout(() => { this.state = 'suspended'; resolve(); }, 0)); }
    decodeAudioData() { return new Promise(resolve => setTimeout(() => resolve({ duration: 120 }), decodeDelay)); }
  }
  const fetchFn = () => new Promise(resolve => setTimeout(() => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }), fetchDelay));
  const context = {
    document, window: { AudioContext: FakeAudioContext }, fetch: fetchFn,
    Promise, Map, Array, Math, Number, String, Object, setTimeout, clearTimeout, console,
    paused: false, teams: [0, 1, 2, 3].map(f => ({ f, alive: true, land: f === 1 ? 5 : 1 })),
    NAME: ['红','蓝','绿','黄']
  };
  vm.createContext(context);
  vm.runInContext(`${constants}\n${state}\n${musicFunctions}\n${pauseFunction}\n`, context);
  if (autoLeader) vm.runInContext('updateLeaderMusic(2.5)', context);
  const run = (code) => vm.runInContext(code, context);
  const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 2)); };
  return { context, run, element, contexts, settle };
}

test('fresh music is disabled and generic unlock does not create an audio context', () => {
  const h = createHarness({ autoLeader: false });
  h.run('unlockLeaderMusic()');
  assert.equal(h.run('musicEnabled'), false);
  assert.equal(h.contexts.length, 0);
});

test('music control has Chinese visible label, action accessibility name, and pressed state', () => {
  const h = createHarness({ autoLeader: false });
  h.run('updateMusicButton()');
  const button = h.element('music');
  assert.equal(button.textContent, '音乐：关');
  assert.match(button.getAttribute('aria-label'), /音乐.*点击开启音乐/);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  h.run('toggleLeaderMusic()');
  assert.equal(button.textContent, '音乐：开');
  assert.match(button.getAttribute('aria-label'), /音乐.*点击关闭音乐/);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
});

test('pause suspends active track, retaining enabled preference, clock position, volume and fade', async () => {
  const h = createHarness();
  h.run('musicEnabled=true; unlockLeaderMusic()'); await h.settle();
  const c = h.contexts[0];
  h.run('musicVolume=.27; musicMasterGain.gain.value=.27; musicFade={target:1,elapsed:1,duration:3,start:musicContext.currentTime}; togglePause()');
  await h.settle();
  assert.equal(c.state, 'suspended');
  assert.equal(h.run('musicEnabled'), true);
  assert.equal(c.currentTime, 0);
  assert.equal(h.run('musicVolume'), .27);
  assert.equal(h.run('musicFade.duration'), 3);
  assert.equal(h.run('musicFade.elapsed'), 1);
});

test('generic unlock while paused cannot resume audio', async () => {
  const h = createHarness();
  h.run('musicEnabled=true; unlockLeaderMusic()'); await h.settle();
  h.run('togglePause()'); await h.settle();
  const c = h.contexts[0], resumes = c.resumeCalls;
  h.run('unlockLeaderMusic()'); await h.settle();
  assert.equal(c.state, 'suspended');
  assert.equal(c.resumeCalls, resumes);
});

test('resuming gameplay continues current track and does not reset playback position', async () => {
  const h = createHarness();
  h.run('musicEnabled=true; unlockLeaderMusic()'); await h.settle();
  const c = h.contexts[0];
  h.run('musicContext.currentTime=17.25');
  h.run('togglePause()'); await h.settle();
  h.run('togglePause()'); await h.settle();
  assert.equal(c.state, 'running');
  assert.equal(c.currentTime, 17.25);
  assert.equal(h.run('musicPlayingTarget'), 1);
  assert.equal(h.run('musicVoices.has(1)'), true);
});

test('disabling music while paused never resumes audio', async () => {
  const h = createHarness();
  h.run('musicEnabled=true; unlockLeaderMusic()'); await h.settle();
  h.run('togglePause()'); await h.settle();
  const c = h.contexts[0], resumes = c.resumeCalls;
  h.run('toggleLeaderMusic()'); await h.settle();
  assert.equal(c.state, 'suspended');
  assert.equal(c.resumeCalls, resumes);
  assert.equal(h.run('musicEnabled'), false);
});

test('enabling music while paused defers playback until gameplay resumes', async () => {
  const h = createHarness({ autoLeader: false });
  h.run('togglePause(); toggleLeaderMusic()'); await h.settle();
  assert.equal(h.contexts.length, 0);
  h.run('togglePause()'); await h.settle();
  h.run('updateLeaderMusic(2.5)'); await h.settle();
  assert.equal(h.run('musicPlayingTarget'), 1);
  assert.equal(h.run('musicVoices.has(1)'), true);
});

test('pause during delayed fetch/decode prevents track activation', async () => {
  const h = createHarness({ fetchDelay: 15, decodeDelay: 15 });
  h.run('musicEnabled=true; unlockLeaderMusic()');
  await new Promise(r => setTimeout(r, 3));
  h.run('togglePause()'); await h.settle(20);
  assert.equal(h.contexts[0].state, 'suspended');
  assert.equal(h.run('musicVoices.size'), 0);
  assert.equal(h.run('musicPlayingTarget'), -1);
});

test('pause during pending resume leaves context suspended', async () => {
  const h = createHarness({ resumeDelay: 20 });
  h.run('musicEnabled=true; unlockLeaderMusic()');
  await new Promise(r => setTimeout(r, 3));
  h.run('togglePause()'); await h.settle(20);
  assert.equal(h.contexts[0].state, 'suspended');
  assert.equal(h.run('paused'), true);
});

test('leader stability remains 2.5 seconds, transition fade 3 seconds, and volume is preserved', async () => {
  const h = createHarness({ autoLeader: false });
  h.run('musicEnabled=true; unlockLeaderMusic()'); await h.settle();
  h.run('updateLeaderMusic(2.49)');
  assert.equal(h.run('musicLeader'), -1);
  h.run('updateLeaderMusic(.01)'); await h.settle();
  assert.equal(h.run('musicLeader'), 1);
  assert.equal(h.run('musicFade.duration'), 3);
  h.run('musicVolume=.31; musicMasterGain.gain.value=.31');
  assert.equal(h.run('musicVolume'), .31);
  assert.equal(h.run('musicMasterGain.gain.value'), .31);
});
