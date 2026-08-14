import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function PosIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8l1-4h16l1 4" />
      <rect x="4" y="8" width="16" height="10" rx="1.5" />
      <path d="M8 13h3M8 16h6M14 13h2" />
      <circle cx="17.5" cy="13" r="0.4" fill="currentColor" />
    </svg>
  );
}

export function MpesaIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M10.5 5.5h3" />
      <path d="M9 14.5l2.2 2.2L15.5 12" />
    </svg>
  );
}

export function InventoryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8l8-4 8 4-8 4-8-4z" />
      <path d="M4 8v8l8 4 8-4V8" />
      <path d="M12 12v8" />
    </svg>
  );
}

export function BranchesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="12" cy="18" r="2.6" />
      <path d="M7.8 7.6L11 15.6M16.2 7.6L13 15.6M8.4 6h7.2" />
    </svg>
  );
}

export function StaffIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="7" r="3" />
      <path d="M4.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
      <path d="M17 9.2l1.6-1c.9.5 1.4 1.4 1.4 2.4 0 1.6-1.3 2.7-2.9 3.1" />
      <path d="M16 12.5l1 1 2-2" />
    </svg>
  );
}

export function ReportingIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7" y="13" width="2.6" height="7" />
      <rect x="12" y="9" width="2.6" height="11" />
      <rect x="17" y="5" width="2.6" height="15" />
    </svg>
  );
}

export function RestaurantIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="13" r="6.5" />
      <circle cx="12" cy="13" r="2.6" />
      <path d="M12 2.5v3M9 2.5v3M15 2.5v3" />
    </svg>
  );
}

export function PharmacyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="9" width="9" height="9" rx="4.5" transform="rotate(-45 8.5 13.5)" />
      <path d="M6.2 11.2l4.6 4.6" />
      <path d="M17.5 4v6M14.5 7h6" />
    </svg>
  );
}

export function SalonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <path d="M7.8 7.5L19 17.5M7.8 16.5L19 6.5" />
    </svg>
  );
}

export function EtimsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 2.5h7l3.5 3.5V21.5H7z" />
      <path d="M14 2.5v3.5h3.5" />
      <path d="M9.5 13.5l2 2 4-4.5" />
    </svg>
  );
}

export function SmsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5h16v10.5H9l-4 3.5v-3.5H4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

export function LayawayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="9" cy="7" rx="5.5" ry="2.2" />
      <path d="M3.5 7v4c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V7" />
      <path d="M3.5 11v4c0 1.2 2.5 2.2 5.5 2.2 1 0 1.9-.1 2.7-.3" />
      <path d="M17 12.5a4 4 0 100 8 4 4 0 000-8z" />
      <path d="M17 14v2.5l1.6 1" />
    </svg>
  );
}

export function ShopfrontIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9l1-5h14l1 5" />
      <path d="M4 9a2 2 0 004 0 2 2 0 004 0 2 2 0 004 0 2 2 0 004 0" />
      <path d="M5 9v11.5h14V9" />
      <path d="M10 20.5V14h4v6.5" />
    </svg>
  );
}

export type IllustrationKey =
  | "pos"
  | "mpesa"
  | "inventory"
  | "branches"
  | "staff"
  | "reporting"
  | "restaurant"
  | "pharmacy"
  | "salon"
  | "etims"
  | "sms"
  | "layaway"
  | "shopfront";

export const ILLUSTRATIONS: Record<IllustrationKey, (props: IconProps) => ReactElement> = {
  pos: PosIcon,
  mpesa: MpesaIcon,
  inventory: InventoryIcon,
  branches: BranchesIcon,
  staff: StaffIcon,
  reporting: ReportingIcon,
  restaurant: RestaurantIcon,
  pharmacy: PharmacyIcon,
  salon: SalonIcon,
  etims: EtimsIcon,
  sms: SmsIcon,
  layaway: LayawayIcon,
  shopfront: ShopfrontIcon,
};

type Tone = "primary" | "accent" | "secondary" | "warning" | "success" | "error";

const TONE_CLASSES: Record<Tone, { tint: string; fg: string }> = {
  primary: { tint: "bg-primary-50", fg: "text-primary-600" },
  accent: { tint: "bg-accent-50", fg: "text-accent-600" },
  secondary: { tint: "bg-secondary-100", fg: "text-secondary-700" },
  warning: { tint: "bg-warning-50", fg: "text-warning-600" },
  success: { tint: "bg-success-50", fg: "text-success-600" },
  error: { tint: "bg-error-50", fg: "text-error-600" },
};

/** Tinted frame + line-art icon, used anywhere a "screenshot" or image slot used to be. */
export function FeatureIllustration({
  illustration,
  tone = "primary",
  className = "h-20",
  iconClassName = "h-9 w-9",
}: {
  illustration: IllustrationKey;
  tone?: Tone;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = ILLUSTRATIONS[illustration];
  const { tint, fg } = TONE_CLASSES[tone];
  return (
    <div className={`flex items-center justify-center rounded-md ${tint} ${className}`}>
      <Icon className={`${fg} ${iconClassName}`} />
    </div>
  );
}

/**
 * Larger abstract "shop counter" scene for big hero/image slots — a till,
 * a phone confirming an M-Pesa payment, and a rising sales trend, built
 * entirely from strokes/shapes in the brand palette (no photography).
 */
export function ShopSceneIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 240"
      className={className}
      role="img"
      aria-label="Illustration of a till, an M-Pesa payment confirmation, and a rising sales trend"
    >
      <rect x="0" y="0" width="400" height="240" rx="16" fill="#eff6ff" />
      <circle cx="340" cy="40" r="70" fill="#dbeafe" opacity="0.6" />
      <circle cx="40" cy="210" r="90" fill="#dbeafe" opacity="0.5" />

      {/* till */}
      <g transform="translate(60,80)">
        <rect x="0" y="24" width="120" height="80" rx="8" fill="#ffffff" stroke="#2563eb" strokeWidth="2.5" />
        <path d="M8 24l6-24h94l6 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="16" y="40" width="88" height="52" rx="4" fill="#eff6ff" stroke="#2563eb" strokeWidth="2" />
        <path d="M28 58h64M28 70h40M28 80h50" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* phone with M-Pesa confirmation */}
      <g transform="translate(230,50)">
        <rect x="0" y="0" width="70" height="128" rx="12" fill="#ffffff" stroke="#00873f" strokeWidth="2.5" />
        <rect x="8" y="12" width="54" height="96" rx="4" fill="#ecfdf5" />
        <circle cx="35" cy="60" r="18" fill="#00a651" />
        <path d="M27 60l6 6 12-13" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 92h34" stroke="#00873f" strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* sales trend */}
      <g transform="translate(60,170)" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" fill="none">
        <path d="M0 40l30-18 26 10 34-28 30 12" />
        <circle cx="120" cy="16" r="4" fill="#2563eb" stroke="none" />
      </g>
    </svg>
  );
}
