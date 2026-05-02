import { CheckCircle, Clock, Loader2, Wallet, type LucideIcon } from "lucide-react";
import type { OrderStatus } from "@/context/OrdersContext";

export interface OrderStatusVisual {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Whether the icon should spin (e.g. processing). */
  animate?: boolean;
  /** Whether to add a soft pulse animation (e.g. pending payment). */
  pulse?: boolean;
  /** Tailwind classes for filled badge (bg + text). */
  badge: string;
  /** Solid dot color. */
  dot: string;
  /** Solid bar color (for left edge accents / progress fills). */
  bar: string;
  /** Text color in standalone usage. */
  text: string;
  /** Outlined chip / hero card background + border + text. */
  surface: string;
  /** Tailwind ring class for the active step indicator (full literal so JIT picks it up). */
  ring: string;
  /** Short headline shown as the main status message (e.g. "Waiting for payment"). */
  headline: string;
  /** Supporting tagline shown beneath the headline. */
  tagline: string;
  /** One-line description used on the order detail hero (kept for backwards compat). */
  description: string;
}

export const ORDER_STATUS_FLOW: OrderStatus[] = ["pending", "paid", "processing", "completed"];

export const ORDER_STATUS_VISUALS: Record<OrderStatus, OrderStatusVisual> = {
  pending: {
    label: "Pending",
    shortLabel: "Pending",
    icon: Clock,
    pulse: true,
    badge: "bg-warning/15 text-warning",
    dot: "bg-warning",
    bar: "bg-warning",
    text: "text-warning",
    surface: "bg-warning/10 text-warning border-warning/30",
    ring: "ring-warning/30",
    headline: "Waiting for payment",
    tagline: "Complete payment to start processing your order.",
    description: "Waiting for payment to be confirmed.",
  },
  paid: {
    label: "Paid",
    shortLabel: "Paid",
    icon: Wallet,
    badge: "bg-info/15 text-info",
    dot: "bg-info",
    bar: "bg-info",
    text: "text-info",
    surface: "bg-info/10 text-info border-info/30",
    ring: "ring-info/30",
    headline: "Payment received",
    tagline: "Thanks! We're getting your order ready to ship.",
    description: "Payment received — getting your order ready.",
  },
  processing: {
    label: "Processing",
    shortLabel: "Processing",
    icon: Loader2,
    animate: true,
    badge: "bg-primary/15 text-primary",
    dot: "bg-primary",
    bar: "bg-primary",
    text: "text-primary",
    surface: "bg-primary/10 text-primary border-primary/30",
    ring: "ring-primary/30",
    headline: "Preparing your order",
    tagline: "Your items are being packed and handed to the courier.",
    description: "Your order is being packed and shipped.",
  },
  completed: {
    label: "Completed",
    shortLabel: "Completed",
    icon: CheckCircle,
    badge: "bg-success/15 text-success",
    dot: "bg-success",
    bar: "bg-success",
    text: "text-success",
    surface: "bg-success/10 text-success border-success/30",
    ring: "ring-success/30",
    headline: "Order completed",
    tagline: "Delivered and wrapped up — thanks for shopping!",
    description: "Order completed. Thanks for shopping!",
  },
};

export const getOrderStatusVisual = (status: OrderStatus): OrderStatusVisual =>
  ORDER_STATUS_VISUALS[status] ?? ORDER_STATUS_VISUALS.pending;

export const getOrderStatusIndex = (status: OrderStatus): number =>
  Math.max(0, ORDER_STATUS_FLOW.indexOf(status));
