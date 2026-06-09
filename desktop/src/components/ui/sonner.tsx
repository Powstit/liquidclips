import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <SonnerToaster
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-ink-2 group-[.toaster]:text-paper group-[.toaster]:border-line-2 group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-text-secondary",
          actionButton:
            "group-[.toast]:bg-fuchsia group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-paper-warm/10 group-[.toast]:text-text-tertiary",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
