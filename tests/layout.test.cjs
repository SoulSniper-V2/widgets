const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

// Run the real layout methods without loading GNOME Shell's GI imports.
function createController(width = 1366, height = 768, panelHeight = 32) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  const constants = source.slice(source.indexOf('const GRID_SIZE ='), source.indexOf('const INTERFACE_SCHEMA ='));
  const sizes = source.slice(source.indexOf('const WIDGET_SIZES ='), source.indexOf('const ACCENT_COLORS ='));
  const helpers = source.slice(source.indexOf('function clamp('), source.indexOf('function raiseActor('));
  const clampMethod = source.slice(source.indexOf('  _clampWidget('), source.indexOf('  _animateWidget('));
  const layoutMethods = source.slice(source.indexOf('  _positionIsFreeAgainst('), source.indexOf('\n};', source.indexOf('  _resolveLayout(')));
  const context = vm.createContext({
    Main: {layoutManager: {primaryMonitor: {width, height}}, panel: {height: panelHeight}},
  });

  vm.runInContext(`${constants}\n${sizes}\n${helpers}
    class Controller {
      ${clampMethod}
      ${layoutMethods}
      _animateWidget() {};
    };
    globalThis.controller = new Controller();
    globalThis.overlaps = rectsOverlap;
  `, context);

  return context;
};

function widget(x, y, width = 220, height = 220) {
  return {x, y, width, height, size: 'small'};
};

test('resolving a right-edge collision preserves the widget gap after snapping', () => {
  const {controller, overlaps} = createController();
  const anchor = widget(1132, 60);
  const moved = widget(1132, 60);
  controller._widgets = [anchor, moved];

  controller._resolveLayout(anchor);

  assert.equal(overlaps(anchor, moved), false);
  const settled = {...moved};
  controller._clampWidget(moved);
  assert.deepEqual(moved, settled);
});

test('the free-origin fast path returns a position that survives clamping', () => {
  const {controller} = createController();
  const moving = widget(1140, 60);
  const result = controller._findOpenPosition(moving);
  const settled = {...moving, ...result};

  controller._clampWidget(settled);

  assert.equal(result.x, settled.x);
  assert.equal(result.y, settled.y);
});

test('a crowded search checks each final position at most once', () => {
  const {controller} = createController(1920, 1080);
  const blockers = [];

  for (let y = 60; y <= 540; y += 480) {
    for (let x = 20; x <= 1460; x += 480) {
      blockers.push(widget(x, y, 454, 454));
    };
  };

  const visited = new Set();
  let checks = 0;
  const isFree = controller._positionIsFreeAgainst.bind(controller);
  controller._positionIsFreeAgainst = (moving, x, y, blocking) => {
    checks++;
    visited.add(`${x},${y}`);
    return isFree(moving, x, y, blocking);
  };

  controller._findOpenPosition(widget(20, 60), blockers);

  assert.equal(checks, visited.size, 'duplicate final positions were checked');
  assert.ok(checks <= 3500, `expected a bounded screen-grid search, got ${checks}`);
});
