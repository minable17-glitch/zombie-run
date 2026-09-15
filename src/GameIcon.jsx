const icons = {
  run: <><circle cx="13" cy="5" r="2.4" /><path d="m10.5 9 3-1.5 3 3.5 3.5 1.5M13 8l-2 5 3 2.5-2 4.5M11 13l-4 3.5M14 15.5l4 4" /></>,
  users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M14.5 14a4.5 4.5 0 0 1 6 4.25V20" /></>,
  route: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" /></>,
  locate: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  shield: <path d="M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6Z" />,
  freeze: <><path d="M12 2v20M4.2 6.5l15.6 11M19.8 6.5l-15.6 11" /><path d="m9 3 3 3 3-3M9 21l3-3 3 3M3.4 9.5l4.2.8-1.7-3.9M20.6 14.5l-4.2-.8 1.7 3.9" /></>,
  warning: <><path d="M12 3 2.5 20h19Z" /><path d="M12 9v5M12 17.5v.1" /></>,
  zombie: <><path d="M6 12a6 6 0 1 1 12 0v4l-2 1.5V21l-3-1.5L12 21l-1-1.5L8 21v-3.5L6 16Z" /><circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" /><path d="m10 16 1-1 1 1 1-1 1 1" /></>,
  signal: <><path d="M5 16.5a10 10 0 0 1 14 0M8 13.5a6 6 0 0 1 8 0M11 10.5a2 2 0 0 1 2 0" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></>,
}

export default function GameIcon({ name, size = 20, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  )
}
