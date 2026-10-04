import { describe, it, expect } from 'vitest';
import { TooltipHelper } from '../src/utils/TooltipHelper.js';
import enLocale from '../src/locales/en.js';
import arLocale from '../src/locales/ar.js';
import fs from 'fs';
import path from 'path';

describe('Tooltip Architecture & TooltipHelper', () => {
  const createMockElement = () => {
    const attrs = new Map();
    return {
      title: 'initial-browser-title',
      hasAttribute: (name) => attrs.has(name),
      getAttribute: (name) => attrs.get(name) || null,
      setAttribute: (name, val) => attrs.set(name, String(val)),
      removeAttribute: (name) => {
        attrs.delete(name);
        if (name === 'title') this.title = '';
      },
    };
  };

  const tAr = (key, params) => {
    let val = arLocale[key] || '';
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        val = val.replace(`{${k}}`, v);
      });
    }
    return val;
  };

  const tEn = (key, params) => {
    let val = enLocale[key] || '';
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        val = val.replace(`{${k}}`, v);
      });
    }
    return val;
  };

  describe('TooltipHelper.set', () => {
    it('should set aria-label and proactively strip title attribute and property', () => {
      const el = createMockElement();
      el.setAttribute('title', 'stray native title');
      el.title = 'stray property title';

      TooltipHelper.set(el, 'حفظ التغييرات');

      expect(el.getAttribute('aria-label')).toBe('حفظ التغييرات');
      expect(el.hasAttribute('title')).toBe(false);
      expect(el.title).toBe('');
    });

    it('should set data-tooltip-position when placement option is provided', () => {
      const el = createMockElement();
      TooltipHelper.set(el, 'تلميح للأعلى', { placement: 'top' });

      expect(el.getAttribute('aria-label')).toBe('تلميح للأعلى');
      expect(el.getAttribute('data-tooltip-position')).toBe('top');
    });

    it('should remove aria-label and data-tooltip-position when given empty or whitespace text', () => {
      const el = createMockElement();
      TooltipHelper.set(el, 'تلميح قديم');
      expect(el.getAttribute('aria-label')).toBe('تلميح قديم');

      TooltipHelper.set(el, '');
      expect(el.hasAttribute('aria-label')).toBe(false);

      TooltipHelper.set(el, 'تلميح آخر', { placement: 'bottom' });
      TooltipHelper.set(el, null);
      expect(el.hasAttribute('aria-label')).toBe(false);
      expect(el.hasAttribute('data-tooltip-position')).toBe(false);
    });

    it('should safely handle null/undefined elements without throwing', () => {
      expect(() => TooltipHelper.set(null, 'text')).not.toThrow();
      expect(() => TooltipHelper.set(undefined, 'text')).not.toThrow();
    });

    it('preserves an accessible name it did not create when clearing a tooltip', () => {
      const el = createMockElement();
      el.setAttribute('aria-label', 'Open habit details');
      TooltipHelper.set(el, null);
      expect(el.getAttribute('aria-label')).toBe('Open habit details');

      TooltipHelper.set(el, 'Details for Morning Run');
      TooltipHelper.set(el, 'Updated tooltip');
      TooltipHelper.set(el, null);
      expect(el.getAttribute('aria-label')).toBe('Open habit details');
    });

    it('does not overwrite an accessible name updated externally while a tooltip was active', () => {
      const el = createMockElement();
      TooltipHelper.set(el, 'Old tooltip');
      el.setAttribute('aria-label', 'Current action name');
      TooltipHelper.set(el, null);
      expect(el.getAttribute('aria-label')).toBe('Current action name');
    });

    it('restores the current external name after a later tooltip refresh', () => {
      const el = createMockElement();
      el.setAttribute('aria-label', 'Original action name');
      TooltipHelper.set(el, 'Old tooltip');
      el.setAttribute('aria-label', 'Updated action name');
      TooltipHelper.set(el, 'New tooltip');
      TooltipHelper.set(el, null);
      expect(el.getAttribute('aria-label')).toBe('Updated action name');
    });

    it('returns placement to the default when a later tooltip omits placement', () => {
      const el = createMockElement();
      TooltipHelper.set(el, 'Previous tooltip', { placement: 'bottom' });
      TooltipHelper.set(el, 'Default tooltip');
      expect(el.hasAttribute('data-tooltip-position')).toBe(false);
      expect(el.getAttribute('aria-label')).toBe('Default tooltip');
    });
  });

  describe('TooltipHelper.getStatusLabel', () => {
    it('should translate all habit statuses accurately in Arabic without English leaks', () => {
      expect(TooltipHelper.getStatusLabel('completed', tAr, true)).toBe('مُنجَز');
      expect(TooltipHelper.getStatusLabel('skipped', tAr, true)).toBe('معذور');
      expect(TooltipHelper.getStatusLabel('missed', tAr, true)).toBe('فائت');
      expect(TooltipHelper.getStatusLabel('uncompleted', tAr, true)).toBe('بانتظار الإنجاز');
      expect(TooltipHelper.getStatusLabel('pending', tAr, true)).toBe('بانتظار الإنجاز');
      expect(TooltipHelper.getStatusLabel('not-scheduled', tAr, true)).toBe('غير مجدول');
    });

    it('should translate all habit statuses accurately in English', () => {
      expect(TooltipHelper.getStatusLabel('completed', tEn, false)).toBe('Completed');
      expect(TooltipHelper.getStatusLabel('skipped', tEn, false)).toBe('Excused');
      expect(TooltipHelper.getStatusLabel('missed', tEn, false)).toBe('Missed');
      expect(TooltipHelper.getStatusLabel('uncompleted', tEn, false)).toBe('Pending');
      expect(TooltipHelper.getStatusLabel('not-scheduled', tEn, false)).toBe('Not scheduled');
    });

    it('should fallback gracefully to Arabic terms when t function is missing or key is undefined', () => {
      expect(TooltipHelper.getStatusLabel('skipped', null, true)).toBe('معذور');
      expect(TooltipHelper.getStatusLabel('completed', null, true)).toBe('مُنجَز');
    });
  });

  describe('TooltipHelper formatters', () => {
    it('should format habit cell tooltip unifying name, date, and translated status', () => {
      const cellTooltip = TooltipHelper.formatHabitCell({
        habitName: 'صلاة الفجر',
        dayName: 'الأربعاء',
        dateFormatted: '٩ سبتمبر',
        status: 'skipped',
        hasRightClickHint: false,
        t: tAr,
        isAr: true,
      });

      expect(cellTooltip).toBe('صلاة الفجر — الأربعاء ٩ سبتمبر (معذور)');
      expect(cellTooltip).not.toContain('skipped');
    });

    it('should append right-click hint when enabled in settings', () => {
      const cellTooltip = TooltipHelper.formatHabitCell({
        habitName: 'قراءة الورد',
        dayName: 'الخميس',
        dateFormatted: '١٠ سبتمبر',
        status: 'completed',
        hasRightClickHint: true,
        t: tAr,
        isAr: true,
      });

      expect(cellTooltip).toContain('قراءة الورد — الخميس ١٠ سبتمبر (مُنجَز)');
      expect(cellTooltip).toContain('•');
      expect(cellTooltip).toContain(arLocale.grid_cell_right_click_hint);
    });

    it('should format day header tooltip cleanly combining date and note open action', () => {
      const dayHeader = TooltipHelper.formatDayHeader('الأربعاء', '٩ سبتمبر', tAr, true);
      expect(dayHeader).toContain('الأربعاء ٩ سبتمبر');
      expect(dayHeader).toContain('•');
      expect(dayHeader).toContain(arLocale.grid_click_open_note_tooltip);
    });

    it('should format daily completion rate badge without hardcoded English', () => {
      const arRate = TooltipHelper.formatDailyCompletionRate(5, 7, tAr, true);
      expect(arRate).toBe('5/7 مُنجَز');
      expect(arRate).not.toContain('Completed');

      const enRate = TooltipHelper.formatDailyCompletionRate(5, 7, tEn, false);
      expect(enRate).toBe('5/7 Completed');
    });

    it('should format habit edit action tooltip', () => {
      const editLabel = TooltipHelper.formatHabitEdit('الرياضة الصباحية', tAr, true);
      expect(editLabel).toBe(`${tAr('edit_habit') || 'تعديل'}: الرياضة الصباحية`);
    });
  });

  describe('Architectural Integrity Check: Zero Native Title Attributes', () => {
    it('should ensure no source files in src/ set title attribute on UI elements', () => {
      const srcDir = path.resolve(__dirname, '../src');
      const filesToCheck = [];

      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.js')) {
            filesToCheck.push(fullPath);
          }
        }
      };

      walk(srcDir);

      const violations = [];
      for (const file of filesToCheck) {
        // Skip TooltipHelper itself where it proactively strips el.title = ""
        if (file.endsWith('TooltipHelper.js')) continue;

        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          // Check for .title = (assignment to title property)
          if (/\.title\s*=\s*[^=]/.test(line)) {
            violations.push(`${path.basename(file)}:${index + 1}: ${line.trim()}`);
          }
          // Check for setAttribute("title", ...)
          if (/setAttribute\(\s*["']title["']/.test(line)) {
            violations.push(`${path.basename(file)}:${index + 1}: ${line.trim()}`);
          }
          // Check for title: inside element creation (e.g. createEl("button", { title: ... }))
          // Exclude StatusView options.title and localization keys
          const recentContext = lines.slice(Math.max(0, index - 3), index + 1).join(' ');
          const isViewConfig = recentContext.includes('StatusView.renderEmptyState') || line.includes('empty_state_title') || line.includes('diary_empty_title') || line.includes('stats_error_loading');
          if (/\btitle:\s*(?:t\(|this\._|this\.plugin|["'`])/.test(line) && !isViewConfig && !file.includes('locales')) {
            violations.push(`${path.basename(file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }

      expect(violations, `Found forbidden title attribute usages:\n${violations.join('\n')}`).toEqual([]);
    });
  });
});
