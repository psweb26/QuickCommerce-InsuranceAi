import clsx from "clsx";
import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <section className={clsx("luxe-card rounded-2xl p-5", className)}>
      {children}
    </section>
  );
}


