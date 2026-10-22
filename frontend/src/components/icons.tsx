import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(paths: ReactNode) {
  return function Icon({ size = 18, className = '', ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`shrink-0 ${className}`}
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const ScanIcon = icon(
  <>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <path d="M4 12h16" />
  </>,
);
export const LayersIcon = icon(
  <>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12.5 9 5 9-5" />
    <path d="m3 17 9 5 9-5" opacity=".55" />
  </>,
);
export const ServerIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="6.5" rx="2" />
    <rect x="3" y="13.5" width="18" height="6.5" rx="2" />
    <path d="M7 7.25h.01M7 16.75h.01" />
  </>,
);
export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.8 3 2.6 3 5.6" />
  </>,
);
export const SunIcon = icon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </>,
);
export const MoonIcon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const MonitorIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </>,
);
export const SparklesIcon = icon(
  <>
    <path d="m12 3 1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />
    <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
  </>,
);
export const ShieldCheckIcon = icon(
  <>
    <path d="M12 3 4.5 6v5.5c0 4.5 3 7.8 7.5 9.5 4.5-1.7 7.5-5 7.5-9.5V6L12 3Z" />
    <path d="m8.8 12 2.3 2.3 4.2-4.6" />
  </>,
);
export const DownloadIcon = icon(<path d="M12 4v10m-4-4 4 4 4-4M5 19h14" />);
export const UploadIcon = icon(<path d="M12 15V5m-4 4 4-4 4 4M5 19h14" />);
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </>,
);
export const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />);
export const RefreshIcon = icon(
  <>
    <path d="M20 11a8 8 0 0 0-14.6-4M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.6 4M20 20v-4h-4" />
  </>,
);
export const AlertIcon = icon(
  <>
    <path d="M12 4 3 19h18L12 4Z" />
    <path d="M12 10v4M12 17h.01" />
  </>,
);
export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);
export const CheckIcon = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const XIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>,
);
export const ChevronRightIcon = icon(<path d="m9 6 6 6-6 6" />);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
export const LogoutIcon = icon(
  <>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    <path d="m15 8 4 4-4 4M19 12H9" />
  </>,
);
export const KeyIcon = icon(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8-8M16 7l3 3" />
  </>,
);
export const ExternalIcon = icon(<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />);
export const FileIcon = icon(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </>,
);
export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
