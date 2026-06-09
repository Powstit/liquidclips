import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-fuchsia text-white shadow-[0_12px_30px_-12px_rgba(255,45,149,0.7)] hover:bg-fuchsia-bright",
        primary:
          "font-display font-bold tracking-[0.01em] bg-gradient-to-b from-[#ff6bb4] to-[#ff2d95] text-[#190007] shadow-[0_12px_30px_-12px_rgba(255,45,149,0.7),inset_0_1px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 hover:shadow-[0_18px_38px_-12px_rgba(255,45,149,0.85),inset_0_1px_0_rgba(255,255,255,0.4)]",
        publish:
          "font-display font-bold tracking-[0.01em] bg-gradient-to-b from-[#ffd34d] to-[#ffab2e] text-[#241500] shadow-[0_12px_30px_-12px_rgba(255,171,46,0.7),inset_0_1px_0_rgba(255,255,255,0.4)] hover:-translate-y-0.5",
        outline:
          "border border-line bg-transparent text-text-secondary hover:border-line-2 hover:text-paper",
        ghost: "hover:bg-paper-warm/10 hover:text-paper",
        destructive:
          "bg-red-500 text-white shadow-sm hover:bg-red-600",
        link: "text-fuchsia underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-xl px-7 text-[14px]",
        icon: "h-9 w-9",
        chip: "h-7 rounded-md px-2.5 text-[10px] font-mono uppercase tracking-[0.1em]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
