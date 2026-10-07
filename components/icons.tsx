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
