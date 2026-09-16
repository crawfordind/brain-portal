import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ModalHeader } from '@/components/modals/modal-header';
import { ModalFooter } from '@/components/modals/modal-footer';
import { ModalSection } from '@/components/modals/modal-section';

describe('Complete Modal Integration', () => {
  it('renders all modal components together', () => {
    const handleClose = vi.fn();
    const handleCreate = vi.fn();
    const handleCancel = vi.fn();

    render(
      <Dialog open>
        <DialogContent size="compact" dismissible={false} showCloseButton={false} data-testid="modal">
          <ModalHeader
            title="Create Task"
            subtitle="Add a new task to your project"
            onClose={handleClose}
          />

          <ModalSection title="Details">
            <div className="space-y-4">
              <div>
                <label htmlFor="task-name" className="text-sm font-medium">
                  Task Name
                </label>
                <input
                  id="task-name"
                  type="text"
                  className="w-full px-3 py-2 border rounded"
                  placeholder="Enter task name"
                />
              </div>
              <div>
                <label htmlFor="task-description" className="text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="task-description"
                  className="w-full px-3 py-2 border rounded"
                  placeholder="Enter task description"
                  rows={3}
                />
              </div>
            </div>
          </ModalSection>

          <ModalSection title="Advanced" collapsible defaultOpen={false}>
            <div className="space-y-4">
              <div>
                <label htmlFor="task-priority" className="text-sm font-medium">
                  Priority
                </label>
                <select
                  id="task-priority"
                  className="w-full px-3 py-2 border rounded"
                >
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                </select>
              </div>
              <div>
                <label htmlFor="task-due-date" className="text-sm font-medium">
                  Due Date
                </label>
                <input
                  id="task-due-date"
                  type="date"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
            </div>
          </ModalSection>

          <ModalFooter
            primaryAction={{
              label: 'Create',
              onClick: handleCreate,
            }}
            secondaryAction={{
              label: 'Cancel',
              onClick: handleCancel,
            }}
          />
        </DialogContent>
      </Dialog>
    );

    // Verify modal renders with compact size
    const modal = screen.getByTestId('modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveClass('sm:max-w-md');

    // Verify header renders
    expect(screen.getByText('Create Task')).toBeInTheDocument();
    expect(screen.getByText('Add a new task to your project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();

    // Verify Details section (non-collapsible) renders
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByLabelText('Task Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();

    // Verify Advanced section (collapsible, collapsed by default) renders
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Due Date')).not.toBeInTheDocument();

    // Verify footer renders
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('handles Create button click', async () => {
    const handleCreate = vi.fn();

    render(
      <Dialog open>
        <DialogContent size="compact">
          <ModalHeader title="Create Task" />
          <ModalSection title="Details">
            <input type="text" placeholder="Task name" />
          </ModalSection>
          <ModalFooter
            primaryAction={{
              label: 'Create',
              onClick: handleCreate,
            }}
          />
        </DialogContent>
      </Dialog>
    );

    const createButton = screen.getByRole('button', { name: 'Create' });
    await userEvent.click(createButton);

    expect(handleCreate).toHaveBeenCalledTimes(1);
  });

  it('handles Cancel button click', async () => {
    const handleCancel = vi.fn();

    render(
      <Dialog open>
        <DialogContent size="compact">
          <ModalHeader title="Create Task" />
          <ModalSection title="Details">
            <input type="text" placeholder="Task name" />
          </ModalSection>
          <ModalFooter
            primaryAction={{
              label: 'Create',
              onClick: vi.fn(),
            }}
            secondaryAction={{
              label: 'Cancel',
              onClick: handleCancel,
            }}
          />
        </DialogContent>
      </Dialog>
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await userEvent.click(cancelButton);

    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it('handles header close button click', async () => {
    const handleClose = vi.fn();

    render(
      <Dialog open>
        <DialogContent size="compact" showCloseButton={false}>
          <ModalHeader title="Create Task" onClose={handleClose} />
          <ModalSection title="Details">
            <input type="text" placeholder="Task name" />
          </ModalSection>
          <ModalFooter
            primaryAction={{
              label: 'Create',
              onClick: vi.fn(),
            }}
          />
        </DialogContent>
      </Dialog>
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    await userEvent.click(closeButton);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('expands collapsible section when clicked', async () => {
    render(
      <Dialog open>
        <DialogContent size="compact">
          <ModalHeader title="Create Task" />
          <ModalSection title="Details">
            <input type="text" placeholder="Task name" />
          </ModalSection>
          <ModalSection title="Advanced" collapsible defaultOpen={false}>
            <input id="priority" type="text" placeholder="Priority" />
          </ModalSection>
          <ModalFooter
            primaryAction={{
              label: 'Create',
              onClick: vi.fn(),
            }}
          />
        </DialogContent>
      </Dialog>
    );

    // Advanced section is collapsed initially
    expect(screen.queryByPlaceholderText('Priority')).not.toBeInTheDocument();

    // Find and click the Advanced section trigger
    const advancedButtons = screen.getAllByRole('button');
    const advancedTrigger = advancedButtons.find(
      (btn) => btn.textContent?.includes('Advanced')
    );
    expect(advancedTrigger).toBeInTheDocument();

    await userEvent.click(advancedTrigger!);

    // Advanced section is now expanded
    expect(screen.getByPlaceholderText('Priority')).toBeInTheDocument();
  });

  it('prevents backdrop dismiss when dismissible=false', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent size="compact" dismissible={false}>
          <ModalHeader title="Create Task" />
          <ModalSection title="Details">
            <input type="text" placeholder="Task name" />
          </ModalSection>
          <ModalFooter
            primaryAction={{
              label: 'Create',
              onClick: vi.fn(),
            }}
          />
        </DialogContent>
      </Dialog>
    );

    // Try to click on overlay (backdrop)
    const overlay = document.querySelector('[data-radix-dialog-overlay]') ||
                     document.querySelector('[data-slot="dialog-overlay"]');
    if (overlay) {
      await userEvent.click(overlay);
    }

    // Modal should not close
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
