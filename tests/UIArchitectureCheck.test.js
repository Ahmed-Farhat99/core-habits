import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import { checkMigrationOwnership } from '../scripts/check-ui-css.mjs';

const sheet = (file, css) => ({ file, sheet: postcss.parse(css, { from: file }) });

describe('UI ownership gate regression fixtures', () => {
  it('rejects feature-owned hover paint on shared collapse controls', () => {
    expect(checkMigrationOwnership([sheet('settings.css', '.daily-habits-plugin .dh-collapse-btn:hover { background: teal; }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining('belongs to habit-row.css')]));
  });
  it('rejects duplicate shared selector declarations across files', () => {
    const css = '.daily-habits-plugin .dh-empty-title { color: red; }';
    expect(checkMigrationOwnership([sheet('base.css', css), sheet('modal.css', css)]))
      .toEqual(expect.arrayContaining([expect.stringContaining('duplicate')]));
  });
  it('rejects repeated blocks in a single owner', () => {
    expect(checkMigrationOwnership([sheet('habit-row.css', '.habit-row:hover { background: red; } .habit-row:hover { background: blue; }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining('duplicate')]));
  });
  it('allows distinct conditional size inputs and feature-scoped variants', () => {
    expect(checkMigrationOwnership([
      sheet('mobile.css', 'body.is-mobile .daily-habits-plugin { --dh-touch-control-min: 36px; }'),
      sheet('diary-view.css', '.daily-habits-plugin .dh-diary-empty-state .dh-empty-title { font-size: 1em; }'),
      sheet('modal.css', '.daily-habits-plugin .dh-journey-empty-card .dh-empty-title { font-size: .8em; }'),
    ])).toEqual([]);
  });
  it('requires positive row display to respect native hidden', () => {
    expect(checkMigrationOwnership([sheet('settings.css', '.dh-habit-row { display: grid; }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining(':not([hidden])')]));
    expect(checkMigrationOwnership([sheet('settings.css', '.dh-habit-row:not([hidden]) { display: grid; }')])).toEqual([]);
  });
  it('allows header separators which explicitly exclude habit rows', () => {
    expect(checkMigrationOwnership([sheet('grid.css', '.dh-grid-row:not(.habit-row) { border-bottom: 1px solid gray; }')])).toEqual([]);
  });
  it('rejects ancestor-level aliases that silently miss a descendant habit color', () => {
    expect(checkMigrationOwnership([sheet('tokens.css', ':root { --dh-row-color: var(--habit-color); }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining('shared habit color scope')]));
  });
  it('rejects important declarations on migrated controls', () => {
    expect(checkMigrationOwnership([sheet('habit-row.css', '.dh-collapse-btn { color: red !important; }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining('!important')]));
  });
  it('rejects feature-owned paint on shared tabs', () => {
    expect(checkMigrationOwnership([sheet('weekly-grid-layout.css', '.daily-habits-plugin .dh-tab { border: 1px solid red; }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining('belongs to base.css')]));
  });
  it('rejects feature-owned paint on shared navigation buttons', () => {
    expect(checkMigrationOwnership([sheet('statistics.css', '.daily-habits-plugin .dh-nav-arrow-btn { background: red; }')]))
      .toEqual(expect.arrayContaining([expect.stringContaining('belongs to button.css')]));
  });
});
