import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <div className="w-full">
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground",
          "placeholder:text-secondary-400",
          "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500",
          error && "border-error-500 focus:ring-error-500",
          className
        )}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-error-600">{error}</p>}
    </div>
  )
);
Input.displayName = "Input";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1.5 block text-sm font-medium text-secondary-700", className)} {...props} />
  );
}
