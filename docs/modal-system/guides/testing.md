# Testing Guide

**Framework:** Vitest + React Testing Library
**Audience:** Developers writing modal tests

## Overview

This guide covers testing patterns for modal dialogs, including unit tests, integration tests, and accessibility tests.

## Test Structure

### Basic Test File Template

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyDialog } from '@/components/my-dialog';
import '@testing-library/jest-dom';

describe('MyDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    render(<MyDialog {...defaultProps} />);
    expect(screen.getByText('Dialog Title')).toBeInTheDocument();
  });
});
```

## Unit Tests

### Rendering Tests

```tsx
describe('MyDialog rendering', () => {
  it('renders with title and subtitle', () => {
    render(<MyDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByText('Dialog Title')).toBeInTheDocument();
    expect(screen.getByText('Dialog subtitle')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<MyDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByText('Dialog Title')).not.toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<MyDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Field 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Field 2')).toBeInTheDocument();
  });
});
```

### Interaction Tests

```tsx
describe('MyDialog interactions', () => {
  it('calls onClose when cancel button clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={onClose} onSubmit={vi.fn()} />);

    await user.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSubmit with form data', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Field 1'), 'Test value');
    await user.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        field1: 'Test value',
        field2: ''
      });
    });
  });

  it('updates form state on input change', async () => {
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText('Field 1');
    await user.type(input, 'New value');

    expect(input).toHaveValue('New value');
  });
});
```

### Validation Tests

```tsx
describe('MyDialog validation', () => {
  it('disables submit when form is invalid', () => {
    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByText('Submit')).toBeDisabled();
  });

  it('enables submit when form is valid', async () => {
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText('Required Field'), 'Valid input');

    expect(screen.getByText('Submit')).not.toBeDisabled();
  });

  it('shows validation error for invalid input', async () => {
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText('Email');
    await user.type(input, 'invalid-email');
    await user.tab(); // Trigger blur

    expect(screen.getByText('Invalid email format')).toBeInTheDocument();
  });
});
```

### Async Tests

```tsx
describe('MyDialog async behavior', () => {
  it('shows loading state while submitting', async () => {
    const onSubmit = vi.fn(() => new Promise(resolve =>
      setTimeout(resolve, 100)
    ));
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Field'), 'Value');
    await user.click(screen.getByText('Submit'));

    expect(screen.getByText('Submitting...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText('Submitting...')).not.toBeInTheDocument();
    });
  });

  it('handles submission errors gracefully', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('API error')));
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Field'), 'Value');
    await user.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });
});
```

## Accessibility Tests

### vitest-axe Tests

```tsx
import { axe } from '../../setup-axe';

describe('MyDialog accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has proper ARIA attributes', () => {
    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const title = screen.getByText('Dialog Title');
    expect(title).toHaveAttribute('role', 'heading');
    expect(title).toHaveAttribute('aria-level', '2');
  });

  it('close button has accessible label', () => {
    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('Close dialog')).toBeInTheDocument();
  });
});
```

### Keyboard Navigation Tests

```tsx
describe('MyDialog keyboard navigation', () => {
  it('traps focus within dialog', async () => {
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    // Tab through all elements
    await user.tab(); // First focusable element
    await user.tab(); // Second element
    // ... continue tabbing

    // Focus should stay within dialog
    expect(document.activeElement).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={onClose} onSubmit={vi.fn()} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('submits on Enter in text input', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    const input = screen.getByLabelText('Field');
    await user.type(input, 'Value{Enter}');

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
  });
});
```

## Integration Tests

### Full Workflow Tests

```tsx
describe('MyDialog full workflow', () => {
  it('completes full create workflow', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={onClose} onSubmit={onSubmit} />);

    // Fill form
    await user.type(screen.getByLabelText('Title'), 'New Item');
    await user.selectOptions(screen.getByLabelText('Category'), 'work');
    await user.click(screen.getByLabelText('Important'));

    // Submit
    await user.click(screen.getByText('Create'));

    // Verify
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: 'New Item',
        category: 'work',
        important: true
      });
      expect(onClose).toHaveBeenCalled();
    });
  });
});
```

### Responsive Behavior Tests

```tsx
import { useMobile } from '@/hooks/use-mobile';

vi.mock('@/hooks/use-mobile');

describe('MyDialog responsive behavior', () => {
  it('renders as Dialog on desktop', () => {
    vi.mocked(useMobile).mockReturnValue(false);

    const { container } = render(
      <MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    // Check for Dialog-specific classes or structure
    expect(container.querySelector('[role="dialog"]')).toBeInTheDocument();
  });

  it('renders as Sheet on mobile', () => {
    vi.mocked(useMobile).mockReturnValue(true);

    const { container } = render(
      <MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    // Check for Sheet-specific classes
    expect(container.querySelector('.h-\\[75vh\\]')).toBeInTheDocument();
  });
});
```

## Test Utilities

### Custom Render Function

```tsx
// tests/utils/render-dialog.ts
import { render } from '@testing-library/react';

export function renderDialog(ui: React.ReactElement, options = {}) {
  return render(ui, {
    wrapper: ({ children }) => (
      <div id="modal-root">
        {children}
      </div>
    ),
    ...options
  });
}
```

### Mock Data Factories

```tsx
// tests/factories/dialog-props.ts
export function createDialogProps(overrides = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides
  };
}

// Usage
it('test', () => {
  render(<MyDialog {...createDialogProps()} />);
});
```

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test File

```bash
npm test tests/components/my-dialog.test.tsx
```

### Run with Coverage

```bash
npm run test:coverage
```

### Run in Watch Mode

```bash
npm run test:watch
```

### Run Only Accessibility Tests

```bash
npm test -- --grep="a11y|Accessibility"
```

## Best Practices

**Do:**
- ✅ Test user behavior, not implementation
- ✅ Use `userEvent` instead of `fireEvent`
- ✅ Wait for async updates with `waitFor`
- ✅ Clear mocks between tests (`beforeEach`)
- ✅ Test accessibility with vitest-axe
- ✅ Test both desktop and mobile views

**Don't:**
- ❌ Don't test internal state directly
- ❌ Don't use `setTimeout` (use `waitFor`)
- ❌ Don't skip accessibility tests
- ❌ Don't forget to test error states
- ❌ Don't mock everything (test real behavior)

## Debugging Tests

### View Rendered Output

```tsx
import { screen } from '@testing-library/react';

it('debug test', () => {
  render(<MyDialog open={true} onClose={vi.fn()} />);

  // Print DOM tree
  screen.debug();

  // Print specific element
  screen.debug(screen.getByText('Title'));
});
```

### Find Element Issues

```tsx
// If element not found, see available elements
screen.getByRole('button', { name: /submit/i });

// Shows all available roles
screen.logTestingPlaygroundURL();
```

## Coverage Goals

Aim for:
- **Statements:** >80%
- **Branches:** >80%
- **Functions:** >80%
- **Lines:** >80%

Check coverage:
```bash
npm run test:coverage
```

View report:
```bash
open coverage/index.html
```

## Examples in Codebase

See existing tests:
- `tests/components/modals/modal-header.test.tsx`
- `tests/components/modals/modal-header-a11y.test.tsx`
- `tests/components/modals/modal-section-a11y.test.tsx`

---

**Next:** [Migration Guide](./migration.md)
