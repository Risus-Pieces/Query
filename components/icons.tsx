// Minimal SF-Symbols-style icons (stroke-based, inherit currentColor).
type P = { size?: number };
const base = (size = 16) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export const StarIcon = ({ size, filled }: P & { filled?: boolean }) => (
  <svg {...base(size)} fill={filled ? "currentColor" : "none"}>
    <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.5 2.9 1.2-6.1L3.2 9.6l6.1-.8L12 3.2z" />
  </svg>
);
export const CheckCircleIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.7 2.7L16 9.5" />
  </svg>
);
export const XIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const UndoIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 5v5h5" />
    <path d="M5.2 14a8 8 0 101.9-8.3L4 10" />
  </svg>
);
export const SearchIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);
export const DownloadIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </svg>
);
export const ChevronIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const TrayIcon = ({ size = 40 }: P) => (
  <svg {...base(size)} strokeWidth={1.5}>
    <path d="M3.5 13.5l2.4-7a2 2 0 011.9-1.4h8.4a2 2 0 011.9 1.4l2.4 7" />
    <path d="M3.5 13.5V17a2 2 0 002 2h13a2 2 0 002-2v-3.5h-5.2a3 3 0 01-2.6 1.5h-2.4a3 3 0 01-2.6-1.5H3.5z" />
  </svg>
);
export const RadarIcon = ({ size = 28 }: P) => (
  <svg {...base(size)} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 12l5.5-5.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </svg>
);
export const GearIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
);
export const MailIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </svg>
);
export const PersonPlusIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 19.5a6.5 6.5 0 0113 0M18.5 8v6M15.5 11h6" />
  </svg>
);
export const LinkIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
  </svg>
);
export const CopyIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0013.5 4h-7A2.5 2.5 0 004 6.5v7A2.5 2.5 0 006.5 16H8" />
  </svg>
);
export const SparkleIcon = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
  </svg>
);
