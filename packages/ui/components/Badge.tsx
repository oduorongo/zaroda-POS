import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "neutral" | "success" | "warning" | "error" | "primary";

const variantClasses: Record<Variant, string> = {
  neutral: "bg-secondary-100 text-secondary-700",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  error: "bg-error-50 text-error-700",
  primary: "bg-primary-50 text-primary-700",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
