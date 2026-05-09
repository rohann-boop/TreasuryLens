// TreasuryLens logo — geometric mark: a "lens" arrow pointing up out of a vault
// shape, signalling treasury insight. Uses currentColor so it adapts to theme.

export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="TreasuryLens"
      role="img"
      className={className}
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="6"
        stroke="currentColor"
        strokeOpacity="0.25"
      />
      {/* Inverted bracket — a chart peak */}
      <path
        d="M7 22 L7 10 L12 10 L12 17 L18 11 L18 22 L13 22 L13 16 L7 22 Z"
        fill="currentColor"
      />
      {/* accent dot — a 'datum' */}
      <circle cx="23" cy="10" r="2.5" className="fill-primary" />
    </svg>
  );
}

export function WordMark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo />
      <span className="font-semibold tracking-tight text-base">
        Treasury<span className="text-primary">Lens</span>
      </span>
    </div>
  );
}
