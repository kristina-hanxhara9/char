type Props = { size?: number; className?: string };

/**
 * YOPEY Befriender figure mark — the joyful "arms-up" person with the YB badge,
 * in the strict brand palette (purple #3F008A on transparent, gold YB). No
 * background plate, so it sits cleanly on the gold (yopey-accent) header band.
 * The favicon variant (public/icon.svg) is the same mark on a gold rounded
 * square. SVG so it stays crisp at any size; swap in official artwork later.
 */
export default function YbMark({ size = 36, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="YOPEY Befriender"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="#3F008A" strokeWidth={38} strokeLinecap="round" fill="none">
        <path d="M256 246 L150 150" />
        <path d="M256 246 L362 150" />
        <path d="M234 362 L188 452" />
        <path d="M278 362 L324 452" />
      </g>
      <circle cx="256" cy="150" r="50" fill="#3F008A" />
      <rect x="202" y="232" width="108" height="132" rx="30" fill="#3F008A" />
      <text
        x="256"
        y="322"
        textAnchor="middle"
        fontFamily="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"
        fontWeight={800}
        fontSize={58}
        letterSpacing={-2}
        fill="#FFAD00"
      >
        YB
      </text>
    </svg>
  );
}
