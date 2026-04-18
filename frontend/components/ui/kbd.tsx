import { cn } from "../../lib/cn";

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // .kbd utility comes from globals.css so plain HTML inline usage matches too
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}
