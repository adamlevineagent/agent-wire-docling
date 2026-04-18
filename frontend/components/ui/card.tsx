import { cn } from "../../lib/cn";

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface-1 border border-border-subtle rounded-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
