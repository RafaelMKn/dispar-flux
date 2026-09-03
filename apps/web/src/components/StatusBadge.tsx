import React from 'react';

export type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral' | 'info';

interface StatusBadgeProps {
  status: string;
  variant?: BadgeVariant;
  pulse?: boolean;
  size?: 'sm' | 'md';
}

export function StatusBadge({
  status,
  variant = 'neutral',
  pulse = false,
  size = 'md',
}: StatusBadgeProps) {
  const getColors = () => {
    switch (variant) {
      case 'success':
        return {
          bg: 'rgba(16, 185, 129, 0.15)',
          text: '#10b981',
          border: 'rgba(16, 185, 129, 0.3)',
          dot: '#10b981',
        };
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          text: '#f59e0b',
          border: 'rgba(245, 158, 11, 0.3)',
          dot: '#f59e0b',
        };
      case 'error':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          text: '#ef4444',
          border: 'rgba(239, 68, 68, 0.3)',
          dot: '#ef4444',
        };
      case 'info':
        return {
          bg: 'rgba(59, 130, 246, 0.15)',
          text: '#3b82f6',
          border: 'rgba(59, 130, 246, 0.3)',
          dot: '#3b82f6',
        };
      case 'neutral':
      default:
        return {
          bg: 'rgba(100, 116, 139, 0.15)',
          text: '#94a3b8',
          border: 'rgba(100, 116, 139, 0.3)',
          dot: '#94a3b8',
        };
    }
  };

  const colors = getColors();
  const padding = size === 'sm' ? '0.15rem 0.5rem' : '0.25rem 0.75rem';
  const fontSize = size === 'sm' ? '0.75rem' : '0.8125rem';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: '9999px',
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        letterSpacing: '0.025em',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: '50%',
          backgroundColor: colors.dot,
          boxShadow: pulse ? `0 0 8px ${colors.dot}` : undefined,
          animation: pulse ? 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : undefined,
        }}
      />
      {status}
    </span>
  );
}
