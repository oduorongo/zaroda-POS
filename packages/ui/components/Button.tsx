import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "mpesa";
type Size = "sm" | "md" | "lg" | "touch";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800",
  secondary: "bg-secondary-100 text-secondary-900 hover:bg-secondary-200 active:bg-secondary-300",
  outline: "border border-border bg-transparent text-foreground hover:bg-secondary-50",
  ghost: "bg-transparent text-foreground hover:bg-secondary-100",
  danger: "bg-error-600 text-white hover:bg-error-700",
  success: "bg-success-600 text-white hover:bg-success-700",
  // M-Pesa green (tokens.colors.accent) - reserved for M-Pesa payment
  // affordances only, never used as a generic accent elsewhere.
  mpesa: "bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700",
};

// "touch" is the default target size for POS terminal screens — cashiers tap fast, under
// pressure, often at an angle; anything smaller than 44px increases mis-taps.
const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-md",
  md: "h-10 px-4 text-sm rounded-md",
  lg: "h-12 px-6 text-base rounded-lg",
  touch: "h-touch min-w-touch px-6 text-base font-semibold rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
