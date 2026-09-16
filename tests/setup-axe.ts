/// <reference path="./setup-axe.d.ts" />
import { configureAxe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import { expect } from 'vitest';
import 'vitest-axe/extend-expect'; // TypeScript types

// Extend Vitest's expect with axe matchers
expect.extend(matchers);

export const axe = configureAxe({
  rules: {
    // WCAG 2.1 AA rules
    'color-contrast': { enabled: true },
    'label': { enabled: true },
    'button-name': { enabled: true },
    'link-name': { enabled: true },
    'aria-required-attr': { enabled: true },
    'aria-roles': { enabled: true },
    'aria-valid-attr': { enabled: true },
    'aria-valid-attr-value': { enabled: true },
  },
});
