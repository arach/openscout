import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

function Spinner({
  className,
  fps = 12,
  ...props
}: React.ComponentProps<'span'> & { fps?: number }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((prev) => (prev + 1) % BRAILLE_FRAMES.length);
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [fps]);

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block font-mono', className)}
      {...props}
    >
      {BRAILLE_FRAMES[frame]}
    </span>
  );
}

export { Spinner }
