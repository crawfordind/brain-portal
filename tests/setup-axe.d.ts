import type { AxeResults } from 'axe-core';

declare module '@vitest/expect' {
  interface Assertion<T = any> {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
