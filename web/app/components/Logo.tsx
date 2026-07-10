// NeighborhoodIQ brand logo: a blue map pin holding a near-black house, over a
// light-gray ground ring. One fixed definition — rendered identically on every
// surface (header, dashboard, login, landing hero) and mirrored by the favicon
// (app/icon.svg). Scalable SVG so it stays crisp at any size.
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="32" cy="55" rx="17" ry="5.4" stroke="#c9ccd2" strokeWidth="3.2" />
      <path
        d="M32 6.5C20 6.5 10.8 15.4 10.8 26.5C10.8 37.4 22 46.8 32 55.5C42 46.8 53.2 37.4 53.2 26.5C53.2 15.4 44 6.5 32 6.5Z"
        fill="#ffffff"
        stroke="#2563eb"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path d="M32 17L47 30.2H43.4V45.2H20.6V30.2H17L32 17Z" fill="#18181b" />
      <g fill="#ffffff">
        <rect x="27.4" y="33.6" width="4.2" height="4.2" rx="0.8" />
        <rect x="32.4" y="33.6" width="4.2" height="4.2" rx="0.8" />
        <rect x="27.4" y="38.6" width="4.2" height="4.2" rx="0.8" />
        <rect x="32.4" y="38.6" width="4.2" height="4.2" rx="0.8" />
      </g>
    </svg>
  );
}
