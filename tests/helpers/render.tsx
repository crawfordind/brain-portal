import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Render a component with the providers the app actually gives it.
 *
 * Most components in this codebase call `useQuery` or `useMutation` somewhere
 * in their tree, so rendering them bare throws "No QueryClient set" — a failure
 * about the harness, not the component. Tests reached for `vi.mock` on
 * @tanstack/react-query to dodge it, which then broke whenever the component
 * started using a different hook from that module.
 *
 * Retries are off and logging is silenced: a test should fail once, fast, with
 * the assertion's message rather than after three retries and a console dump.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function TestProviders({
  children,
  queryClient = createTestQueryClient(),
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: Omit<RenderOptions, "wrapper"> & { queryClient?: QueryClient } = {}
): RenderResult & { queryClient: QueryClient } {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options;

  const result = render(ui, {
    wrapper: ({ children }) => (
      <TestProviders queryClient={queryClient}>{children}</TestProviders>
    ),
    ...renderOptions,
  });

  return { ...result, queryClient };
}
