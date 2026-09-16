import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsGrid } from '@/components/projects/stats-grid';

describe('StatsGrid', () => {
  const mockStats = {
    noteCount: 15,
    taskCount: 23,
    activeTasks: 8,
    completedTasks: 15,
    captureCount: 12,
    agentTaskCount: 3,
    recentActivityCount: 42,
    subProjectCount: 2
  };

  it('renders all stat cards', () => {
    render(<StatsGrid stats={mockStats} />);

    // Check for unique values
    expect(screen.getByText('8')).toBeInTheDocument();  // activeTasks
    expect(screen.getByText('12')).toBeInTheDocument(); // captureCount
    expect(screen.getByText('3')).toBeInTheDocument();  // agentTaskCount
    expect(screen.getByText('42')).toBeInTheDocument(); // recentActivityCount
  });

  it('renders stat labels', () => {
    render(<StatsGrid stats={mockStats} />);

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Active Tasks')).toBeInTheDocument();
    expect(screen.getByText('Completed Tasks')).toBeInTheDocument();
  });
});
