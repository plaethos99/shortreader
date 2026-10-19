import { useId } from 'react';

/**
 * Readster's AI mark: an infinity sign inside a ring, drawn in a gold → rose →
 * violet gradient. E-ink has no gradients, so there it is drawn in plain ink.
 */
const AiInsightsMark = ({ size = 18, className }: { size?: number; className?: string }) => {
  // useId's colons are not safe inside `url(#…)` everywhere.
  const gradientId = `ai-mark-${useId().replace(/[^\w-]/g, '')}`;
  const stroke = `url(#${gradientId})`;
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      aria-hidden='true'
      className={className}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1='3'
          y1='3'
          x2='21'
          y2='21'
          gradientUnits='userSpaceOnUse'
        >
          <stop offset='0' stopColor='#e9b65a' />
          <stop offset='0.5' stopColor='#df6f97' />
          <stop offset='1' stopColor='#7c5cf0' />
        </linearGradient>
      </defs>
      <circle
        cx='12'
        cy='12'
        r='10.25'
        stroke={stroke}
        strokeWidth='1.3'
        className='eink:stroke-current'
      />
      <path
        d='M12 12C10.6 10.1 9.3 9.3 8 9.3a2.7 2.7 0 0 0 0 5.4c1.3 0 2.6-.8 4-2.7s2.7-2.7 4-2.7a2.7 2.7 0 0 1 0 5.4c-1.3 0-2.6-.8-4-2.7z'
        stroke={stroke}
        strokeWidth='1.9'
        strokeLinecap='round'
        strokeLinejoin='round'
        className='eink:stroke-current'
      />
    </svg>
  );
};

export default AiInsightsMark;
