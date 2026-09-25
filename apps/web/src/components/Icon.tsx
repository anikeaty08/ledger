import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bitcoin,
  Check,
  CircleAlert,
  CircleCheck,
  FileText,
  HandCoins,
  LockKeyhole,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

// One icon family for the whole app: lucide, 1.8 stroke, drawn in currentColor.
const ICONS = {
  menu: Menu,
  close: X,
  check: Check,
  "check-circle": CircleCheck,
  "external-link": ArrowUpRight,
  "arrow-right": ArrowRight,
  lock: LockKeyhole,
  error: CircleAlert,
  sun: Sun,
  moon: Moon,
  shield: ShieldCheck,
  invoice: FileText,
  accepted: BadgeCheck,
  advance: HandCoins,
  wallet: Wallet,
  bitcoin: Bitcoin,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: 16 | 20 | 24 | 28 | 32; className?: string }) {
  const Component = ICONS[name];
  return <Component aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={`shrink-0 ${className}`} />;
}
