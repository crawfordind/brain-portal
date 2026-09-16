export const AGENT_GRADIENTS = {
  code: {
    initials: 'AC',
    name: 'Alex Chen',
    from: 'from-blue-500',
    to: 'to-purple-500',
  },
  copy: {
    initials: 'MR',
    name: 'Maya Rodriguez',
    from: 'from-pink-500',
    to: 'to-orange-500',
  },
  research: {
    initials: 'JT',
    name: 'Dr. James Thompson',
    from: 'from-teal-500',
    to: 'to-blue-500',
  },
  marketing: {
    initials: 'RP',
    name: 'Riley Park',
    from: 'from-orange-500',
    to: 'to-red-500',
  },
  analyst: {
    initials: 'PS',
    name: 'Priya Sharma',
    from: 'from-purple-500',
    to: 'to-indigo-500',
  },
  general: {
    initials: 'JL',
    name: 'Jordan Lee',
    from: 'from-green-500',
    to: 'to-teal-500',
  },
  ux: {
    initials: 'JF',
    name: 'Janine Foster',
    from: 'from-pink-500',
    to: 'to-purple-500',
  },
  legal: {
    initials: 'VK',
    name: 'Victoria Kingsley',
    from: 'from-slate-500',
    to: 'to-blue-700',
  },
  finance: {
    initials: 'DW',
    name: 'David Whitmore',
    from: 'from-emerald-600',
    to: 'to-green-800',
  },
  hr: {
    initials: 'SN',
    name: 'Sofia Nakamura',
    from: 'from-rose-400',
    to: 'to-pink-600',
  },
  product: {
    initials: 'MT',
    name: 'Marcus Torres',
    from: 'from-violet-500',
    to: 'to-fuchsia-500',
  },
  sales: {
    initials: 'CW',
    name: 'Chris Walker',
    from: 'from-amber-500',
    to: 'to-orange-600',
  },
  operations: {
    initials: 'NP',
    name: 'Nina Patel',
    from: 'from-cyan-500',
    to: 'to-blue-600',
  },
  security: {
    initials: 'RK',
    name: 'Ray Kovacs',
    from: 'from-red-600',
    to: 'to-slate-700',
  },
  data_eng: {
    initials: 'LE',
    name: 'Lena Eriksson',
    from: 'from-indigo-500',
    to: 'to-cyan-500',
  },
  educator: {
    initials: 'OM',
    name: 'Dr. Omar Mitchell',
    from: 'from-yellow-500',
    to: 'to-amber-600',
  },
  strategy: {
    initials: 'AH',
    name: 'Audrey Hamilton',
    from: 'from-fuchsia-500',
    to: 'to-purple-700',
  },
} as const;

export type AgentType = keyof typeof AGENT_GRADIENTS;

/**
 * What each background agent actually does.
 *
 * The roster used to be presented to the user as a cast of seventeen named
 * colleagues to choose between — and picking one was a prerequisite for
 * getting any AI help at all. Interactive help is a conversation now, so the
 * only thing left to render is a label on work that ran in the background:
 * a heartbeat rule, an MCP call, a skill. "Code" says what that was;
 * "Alex" does not.
 */
export const AGENT_ROLES: Record<AgentType, string> = {
  code: 'Code',
  copy: 'Copy',
  research: 'Research',
  marketing: 'Marketing',
  analyst: 'Analysis',
  general: 'General',
  ux: 'UX',
  legal: 'Legal',
  finance: 'Finance',
  hr: 'HR',
  product: 'Product',
  sales: 'Sales',
  operations: 'Operations',
  security: 'Security',
  data_eng: 'Data',
  educator: 'Teaching',
  strategy: 'Strategy',
};
