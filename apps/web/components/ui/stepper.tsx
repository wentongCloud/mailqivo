"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

function Stepper({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="stepper" className={cn("w-full", className)} {...props} />;
}

function StepperList({ className, ...props }: React.ComponentProps<"ol">) {
  return <ol data-slot="stepper-list" className={cn("flex flex-col gap-3 sm:flex-row sm:items-start", className)} {...props} />;
}

function StepperItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="stepper-item" className={cn("relative flex min-w-0 flex-1", className)} {...props} />;
}

function StepperTrigger({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="stepper-trigger" className={cn("group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto", className)} {...props} />;
}

function StepperIndicator({ active = false, completed = false, children, className, ...props }: React.ComponentProps<"span"> & { active?: boolean; completed?: boolean }) {
  return <span data-slot="stepper-indicator" data-active={active || undefined} data-completed={completed || undefined} className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium transition-colors group-hover:border-primary data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[completed=true]:border-primary data-[completed=true]:text-primary", className)} {...props}>
    {completed ? <Check className="size-4" aria-hidden="true" /> : children}
  </span>;
}

function StepperContent({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="stepper-content" className={cn("min-w-0", className)} {...props} />;
}

function StepperTitle({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="stepper-title" className={cn("block text-sm font-medium", className)} {...props} />;
}

function StepperDescription({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="stepper-description" className={cn("text-muted-foreground block truncate text-xs", className)} {...props} />;
}

function StepperSeparator({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="stepper-separator" aria-hidden="true" className={cn("bg-border mx-2 hidden h-px min-w-6 flex-1 self-start sm:mt-4 sm:block", className)} {...props} />;
}

export { Stepper, StepperList, StepperItem, StepperTrigger, StepperIndicator, StepperContent, StepperTitle, StepperDescription, StepperSeparator };
