import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { beforeEach, describe, expect, it } from 'vitest';

// These tests exercise the authored cascade, including feature and responsive
// rules. They deliberately do not treat jsdom as a browser color-mix renderer.
const projectRoot = process.cwd();
const entry = readFileSync(resolve(projectRoot, 'src/main.js'), 'utf8');
const sheets = [...entry.matchAll(/import\s+['"]\.\/styles\/([^'"]+)['"]/g)]
  .map(([, file]) => ({
    file,
    css: postcss.parse(readFileSync(resolve(projectRoot, `src/styles/${file}`), 'utf8'), {
      from: resolve(projectRoot, `src/styles/${file}`),
    }),
  }));

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Specificity for selectors in these stylesheets, with correct :where and
// maximum-argument semantics for :is/:not/:has. No pseudo state is inferred.
function specificity(selector) {
  const score = [0, 0, 0];
  let rest = selector.trim();
  while (rest) {
    let match;
    if ((match = rest.match(/^#[\w-]+/))) score[0]++;
    else if ((match = rest.match(/^\.[\w-]+|^\[[^\]]+\]/))) score[1]++;
    else if ((match = rest.match(/^(::?)([\w-]+)/))) {
      const token = match[0];
      const isElement = match[1] === '::';
      const name = match[2];
      rest = rest.slice(token.length);
      let args = '';
      if (rest.startsWith('(')) {
        let depth = 1;
        let end = 1;
        for (; end < rest.length && depth; end++) {
          if (rest[end] === '(') depth++;
          if (rest[end] === ')') depth--;
        }
        args = rest.slice(1, end - 1);
        rest = rest.slice(end);
      }
      if (['is', 'not', 'has'].includes(name)) {
        const max = postcss.list.comma(args).map(specificity).sort(compare).at(-1);
        max?.forEach((value, i) => { score[i] += value; });
      } else if (name !== 'where') score[isElement ? 2 : 1]++;
      continue;
    } else if ((match = rest.match(/^[\w-]+/))) score[2]++;
    if (match) rest = rest.slice(match[0].length);
    else rest = rest.slice(1);
  }
  return score;
}

const defaultContext = { width: 900, hover: true, coarse: false };

function conditionApplies(rule, context) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type !== 'atrule') continue;
    if (/keyframes/.test(parent.name)) return false;
    if (!['media', 'container'].includes(parent.name)) continue;
    const alternatives = postcss.list.comma(parent.params);
    if (!alternatives.some(query => {
      const max = query.match(/max-width:\s*(\d+)px/);
      const min = query.match(/min-width:\s*(\d+)px/);
      if (max && context.width > Number(max[1])) return false;
      if (min && context.width < Number(min[1])) return false;
      if (/hover:\s*hover/.test(query) && !context.hover) return false;
      if (/hover:\s*none/.test(query) && context.hover) return false;
      if (/pointer:\s*coarse/.test(query) && !context.coarse) return false;
      if (/prefers-reduced-motion:\s*reduce/.test(query)) return false;
      return true;
    })) return false;
  }
  return true;
}

function matchState(element, selector) {
  if (selector.includes('::')) return false;
  const controlled = selector.replace(/:(hover|focus-visible|focus-within|active)\b/g,
    (_, state) => `[data-test-${state}]`);
  return element.matches(controlled);
}

const declarationsByProperty = new Map();
let sourceOrder = 0;
for (const { file, css } of sheets) css.walkRules(rule => {
  sourceOrder++;
  for (const selector of postcss.list.comma(rule.selector)) {
    const weight = specificity(selector);
    rule.nodes.forEach((decl, index) => {
      if (decl.type !== 'decl') return;
      const properties = decl.prop === 'background' ? ['background', 'background-color'] : [decl.prop];
      for (const property of properties) {
        if (!declarationsByProperty.has(property)) declarationsByProperty.set(property, []);
        declarationsByProperty.get(property).push({ file, value: decl.value, selector, rule,
          rank: [Number(Boolean(decl.important)), ...weight, sourceOrder, index] });
      }
    });
  }
});

function winner(element, property, options = {}) {
  const context = { ...defaultContext, ...options };
  const candidates = (declarationsByProperty.get(property) || [])
    .filter(decl => conditionApplies(decl.rule, context) && matchState(element, decl.selector));
  const inline = element.style.getPropertyValue(property);
  if (inline) candidates.push({ file: 'inline', value: inline, rank: [0, 1000, 0, 0, 0, 0] });
  return candidates.sort((a, b) => compare(a.rank, b.rank)).at(-1);
}

function resolveVariables(element, value, options = {}, depth = 0) {
  if (depth > 20) throw new Error(`Circular custom property: ${value}`);
  return value.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name, fallback) => {
    for (let scope = element; scope; scope = scope.parentElement) {
      const declaration = winner(scope, name, options);
      if (declaration) return resolveVariables(scope, declaration.value, options, depth + 1);
    }
    return fallback || `var(${name})`;
  });
}

function numericSize(element, property, options) {
  const declaration = winner(element, property, options);
  const value = resolveVariables(element, declaration?.value || '', options);
  const pixels = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]));
  return value.startsWith('max(') ? Math.max(...pixels) : pixels[0];
}

function fixture(view = 'wide', { child = false, mobile = false, dir = 'ltr' } = {}) {
  document.body.className = mobile ? 'is-mobile' : '';
  const root = document.createElement('div');
  root.className = `daily-habits-plugin ${view === 'settings' ? 'daily-habits-settings-container' : 'weekly-grid-container'}`;
  root.dir = dir;
  root.style.setProperty('--habit-color', '#14b8a6');
  const row = root.createDiv({ cls: `dh-habit dh-habit-color-scope habit-row ${view === 'compact' ? 'dh-compact-row' : ''} ${view === 'settings' ? 'dh-habit-row' : ''} ${view === 'wide' ? 'dh-grid-row' : ''} ${child ? 'habit-row-child dh-habit-row-child' : ''}` });
  row.style.setProperty('--habit-color', '#f43f5e');
  const section = row.createDiv({ cls: view === 'compact' ? 'dh-compact-action-section' : 'dh-name-meta' });
  const collapse = row.createEl('button', { cls: 'dh-collapse-btn' });
  collapse.createEl('svg');
  const page = section.createEl('button', { cls: 'habit-open-page-icon' });
  const status = row.createEl('button', { cls: 'dh-compact-status-btn status-completed' });
  const actions = row.createDiv({ cls: 'dh-col-actions' });
  const icon = actions.createEl('button', { cls: 'dh-icon-btn' });
  const navZone = root.createDiv({ cls: 'dh-nav-zone' });
  const nav = navZone.createEl('button', { cls: 'dh-nav-arrow-btn' });
  document.body.append(root);
  return { root, row, collapse, page, status, actions, icon, nav };
}

describe('UI component ownership and authored cascade', () => {
  beforeEach(() => { document.body.replaceChildren(); document.body.className = ''; });

  it.each(['wide', 'compact', 'settings'])('keeps the %s collapse color contract in idle and hover', view => {
    const { collapse } = fixture(view);
    expect(resolveVariables(collapse, winner(collapse, 'color').value)).toBe('#f43f5e');
    collapse.setAttribute('data-test-hover', '');
    expect(resolveVariables(collapse, winner(collapse, 'color').value)).toBe('#f43f5e');
    expect(winner(collapse, 'background-color').file).toBe('habit-row.css');
    expect(resolveVariables(collapse, winner(collapse, 'background-color').value)).toContain('#f43f5e');
  });

  it.each(['wide', 'compact', 'settings'])('keeps the %s collapse button in calm motion and habit color across active and focus-visible', view => {
    const { collapse } = fixture(view);
    collapse.setAttribute('data-test-active', '');
    expect(winner(collapse, 'transform')?.value || 'none').toBe('none');
    expect(resolveVariables(collapse, winner(collapse, 'background-color').value)).toContain('#f43f5e');

    collapse.removeAttribute('data-test-active');
    collapse.setAttribute('data-test-focus-visible', '');
    const shadow = winner(collapse, 'box-shadow');
    expect(shadow.file).toBe('habit-row.css');
    expect(resolveVariables(collapse, shadow.value)).toContain('#f43f5e');
    expect(resolveVariables(collapse, winner(collapse, 'border-color').value)).toBe('#f43f5e');
  });

  it('guarantees collapse button hover and active selectors strictly out-specify modal theme rules', () => {
    const modalButtonHoverSpec = specificity('.modal.mod-settings button:hover');
    const modalButtonFocusSpec = specificity('.modal.mod-settings button:focus');
    const collapseHoverRule = declarationsByProperty.get('border-color')
      ?.find(d => d.selector.includes('dh-collapse-btn') && d.selector.includes(':hover'));
    expect(collapseHoverRule).toBeDefined();
    const collapseHoverSpec = specificity(collapseHoverRule.selector);
    expect(compare(collapseHoverSpec, modalButtonHoverSpec)).toBeGreaterThan(0);
    expect(compare(collapseHoverSpec, modalButtonFocusSpec)).toBeGreaterThan(0);
  });

  it.each(['wide', 'compact', 'settings'])('cannot resurrect a hidden %s child at any layout boundary', view => {
    const { row } = fixture(view, { child: true });
    row.hidden = true;
    for (const width of [280, 300, 380, 500, 580, 900]) {
      const authored = winner(row, 'display', { width });
      // With no competing author display, the native hidden attribute keeps
      // ownership of visibility; a layout rule must never resurrect this row.
      expect(authored, `${view} at ${width}px`).toBeUndefined();
    }
  });

  it.each(['wide', 'compact', 'settings'])('applies the shared hover background to %s child rows', view => {
    const { row } = fixture(view, { child: true });
    row.setAttribute('data-test-hover', '');
    expect(winner(row, 'background-color').value).toBe('var(--background-modifier-hover)');
  });

  it('preserves touch minima through narrow feature layouts', () => {
    const { collapse, page, status, icon, nav } = fixture('settings', { mobile: true });
    for (const width of [280, 300, 500, 580, 900]) {
      const context = { width, hover: false, coarse: true };
      for (const [control, minimum] of [[collapse, 32], [page, 44], [status, 44], [icon, 36], [nav, 36]]) {
        expect(numericSize(control, 'width', context)).toBeGreaterThanOrEqual(minimum);
        expect(numericSize(control, 'height', context)).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it('reveals wide page actions and settings actions for keyboard focus', () => {
    const { row, page, actions } = fixture('settings');
    expect(winner(page, 'opacity').value).toBe('0');
    expect(winner(actions, 'opacity').value).toBe('0.7');
    row.setAttribute('data-test-focus-within', '');
    expect(Number(winner(page, 'opacity').value)).toBeGreaterThan(0);
    expect(winner(page, 'pointer-events').value).toBe('auto');
    expect(winner(actions, 'opacity').value).toBe('1');
    page.setAttribute('data-test-focus-visible', '');
    expect(winner(page, 'outline')?.value).not.toBe('none');
  });

  it('lets compact layout choose page size without defeating mobile touch size', () => {
    const { page } = fixture('compact');
    expect(numericSize(page, 'width', { width: 500 })).toBe(26);
    expect(numericSize(page, 'width', { width: 300 })).toBe(22);
    document.body.classList.add('is-mobile');
    expect(numericSize(page, 'width', { width: 300, hover: false, coarse: true })).toBe(44);
  });

  it('owns status keyboard focus and blocks disabled hover transformations', () => {
    const { status } = fixture('compact');
    status.setAttribute('data-test-focus-visible', '');
    expect(winner(status, 'outline')?.value).not.toBe('none');
    expect(winner(status, 'outline')?.file).toBe('day-cell.css');
    status.setAttribute('data-test-hover', '');
    expect(winner(status, 'transform')?.value).toBe('scale(1.05)');
    status.disabled = true;
    expect(winner(status, 'transform')).toBeUndefined();
    expect(winner(status, 'cursor')?.value).toBe('progress');
  });

  it('keeps settings actions visible on touch and in narrow containers', () => {
    const { actions } = fixture('settings');
    expect(winner(actions, 'opacity', { width: 400 }).value).toBe('1');
    expect(winner(actions, 'opacity', { hover: false, coarse: true }).value).toBe('1');
  });

  it('mirrors a collapsed chevron when RTL is on the plugin root itself', () => {
    const { collapse } = fixture('compact', { dir: 'rtl' });
    collapse.classList.add('is-collapsed');
    expect(winner(collapse.firstElementChild, 'transform').value).toBe('rotate(90deg)');
  });

  it('keeps navigation hover colors independent of responsive width', () => {
    const { nav } = fixture('wide');
    nav.setAttribute('data-test-hover', '');
    const colors = [280, 500, 580, 900].map(width => winner(nav, 'color', { width }).value);
    expect(new Set(colors).size).toBe(1);
    expect(winner(nav, 'color').file).toBe('button.css');
  });

  it('keeps an active compact day percentage legible in every progress state', () => {
    const { root } = fixture('compact');
    const day = root.createDiv({ cls: 'dh-strip-day is-active' });
    const percentage = day.createSpan({ cls: 'dh-strip-day-percentage' });
    // After consolidation, active day uses subtle border-bottom (not full accent bg),
    // so the active override colors percentages with var(--interactive-accent).
    for (const state of ['low', 'medium', 'high', 'complete', 'none']) {
      percentage.className = `dh-strip-day-percentage pct-${state}`;
      expect(winner(percentage, 'color').value, state).toBe('var(--interactive-accent)');
    }
  });

  it('isolates diary and journey empty-state variants from each other', () => {
    const { root } = fixture('settings');
    const journey = root.createDiv({ cls: 'dh-journey-empty-card' });
    const journeyTitle = journey.createDiv({ cls: 'dh-empty-title' });
    const diary = root.createDiv({ cls: 'dh-diary-empty-state' });
    const diaryTitle = diary.createDiv({ cls: 'dh-empty-title' });
    expect(winner(journeyTitle, 'font-size').value).toBe('var(--dh-font-sm)');
    expect(winner(journeyTitle, 'font-size').file).toBe('modal.css');
    expect(winner(diaryTitle, 'font-size').file).toBe('diary-view.css');
  });

  it('isolates settings and diary search icon positioning', () => {
    const { root } = fixture('settings');
    const settingsBox = root.createDiv({ cls: 'dh-search-input-wrapper' });
    const settingsIcon = settingsBox.createSpan({ cls: 'dh-search-icon' });
    const diaryBox = root.createDiv({ cls: 'dh-diary-search-box' });
    const diaryIcon = diaryBox.createSpan({ cls: 'dh-search-icon' });
    expect(winner(settingsIcon, 'inset-inline-start').value).toBe('var(--dh-space-md)');
    expect(winner(settingsIcon, 'inset-inline-start').file).toBe('settings.css');
    expect(winner(diaryIcon, 'inset-inline-start').value).toBe('10px');
    expect(winner(diaryIcon, 'inset-inline-start').file).toBe('diary-view.css');
  });

  it('keeps archived section headers separate from archived habit appearance', () => {
    const { root } = fixture('settings');
    const header = root.createDiv({ cls: 'dh-habit dh-habit-row dh-list-header archived' });
    expect(winner(header, 'background-color')?.value).toBe('transparent');
    const opacity = winner(header, 'opacity');
    expect(opacity ? Number(opacity.value) : 1).toBe(1);
    expect(winner(header, 'border-bottom')?.value).toBe('2px solid var(--background-modifier-border)');
  });

  it.each(['wide', 'compact', 'settings'])('keeps %s row identity paint out of layout stylesheets', view => {
    const { row } = fixture(view, { child: true });
    row.setAttribute('data-test-hover', '');
    const identityProperties = /^(?:background(?:-color)?|border(?:-(?:inline-start|inline-start-color|bottom|color|radius))?|box-shadow)$/;
    for (const { file, css } of sheets) css.walkRules(rule => {
      if (!conditionApplies(rule, { ...defaultContext, width: 400 })) return;
      if (!postcss.list.comma(rule.selector).some(selector => matchState(row, selector))) return;
      const paint = rule.nodes.filter(node => node.type === 'decl' && identityProperties.test(node.prop));
      if (paint.length) expect(file, `${rule.selector}: ${paint.map(node => node.prop).join(', ')}`).toBe('habit-row.css');
    });
  });

  it('assigns all collapse, status and navigation interaction rules to one component file', () => {
    const expected = new Map([
      ['dh-collapse-btn', 'habit-row.css'],
      ['dh-compact-status-btn', 'day-cell.css'],
      ['dh-nav-arrow-btn', 'button.css'],
    ]);
    const visualProperties = /^(?:color|background(?:-color)?|border(?:-(?:color|radius|style|width))?|box-shadow|outline(?:-color|-offset)?|opacity|cursor|transform|transition(?:-[\w-]+)?|(?:min-|max-)?(?:width|height))$/;
    for (const { file, css } of sheets) css.walkRules(rule => {
      for (const [component, owner] of expected) {
        if (!rule.selector.includes(`.${component}`)) continue;
        const paint = rule.nodes.filter(node => node.type === 'decl' && visualProperties.test(node.prop));
        if (paint.length) expect(file, `${rule.selector}: ${paint.map(node => node.prop).join(', ')}`).toBe(owner);
      }
    });
  });

  it('does not force the migration through important declarations', () => {
    for (const { file, css } of sheets) css.walkDecls(decl => {
      if (/collapse|row-color|status-control|touch-control|nav-control/.test(`${decl.parent.selector || ''} ${decl.prop}`)) {
        expect(decl.important, `${file}: ${decl.toString()}`).toBeFalsy();
      }
    });
  });
});
