import { AGENT_GRADIENTS, type AgentType } from '@/lib/agents/constants';
import { cn } from '@/lib/utils';

interface AgentAvatarProps {
  agentType: AgentType;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-sm',
  lg: 'h-16 w-16 text-base',
};

export function AgentAvatar({ agentType, size = 'md', className }: AgentAvatarProps) {
  const config = AGENT_GRADIENTS[agentType];

  return (
    <div
      className={cn(
        'rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white',
        config.from,
        config.to,
        sizeClasses[size],
        className
      )}
    >
      {config.initials}
    </div>
  );
}
