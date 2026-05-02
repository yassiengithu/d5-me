/**
 * react-router-dom compatibility shim mapped to @tanstack/react-router.
 *
 * The original source project was authored against react-router-dom v6.
 * This shim re-exposes the small subset of APIs that the ported code uses
 * (Link, NavLink, useNavigate, useLocation, useParams, useNavigationType)
 * with signatures that match react-router-dom closely enough that no
 * call site needs to change.
 */
import * as React from "react";
import {
  Link as TLink,
  useLocation as useTLocation,
  useNavigate as useTNavigate,
  useParams as useTParams,
  useRouter,
} from "@tanstack/react-router";

/* ----------------------------- Types ----------------------------- */

type To =
  | string
  | { pathname?: string; search?: string; hash?: string };

export interface LinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: To;
  replace?: boolean;
  state?: unknown;
  preventScrollReset?: boolean;
  end?: boolean;
}

export interface NavLinkProps extends Omit<LinkProps, "className"> {
  className?:
    | string
    | ((args: { isActive: boolean; isPending: boolean }) => string);
  end?: boolean;
}

/* --------------------------- Helpers ----------------------------- */

const toString = (to: To): string => {
  if (typeof to === "string") return to;
  return (to.pathname ?? "") + (to.search ?? "") + (to.hash ?? "");
};

/* --------------------------- Link / NavLink ---------------------- */

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  ({ to, replace, state: _state, preventScrollReset: _p, end: _e, ...rest }, ref) => {
    const href = toString(to);
    // TLink accepts an absolute path string for `to`. Cast through unknown to
    // satisfy its strict typed-router generics.
    return (
      <TLink
        ref={ref as never}
        to={href as never}
        replace={replace}
        {...(rest as Record<string, unknown>)}
      />
    );
  },
);
Link.displayName = "Link";

export const NavLink = React.forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ to, className, end, ...rest }, ref) => {
    const href = toString(to);
    const location = useTLocation();
    const isActive = end
      ? location.pathname === href
      : location.pathname === href || location.pathname.startsWith(href + "/");
    const computed =
      typeof className === "function"
        ? className({ isActive, isPending: false })
        : className;
    return (
      <TLink
        ref={ref as never}
        to={href as never}
        className={computed}
        {...(rest as Record<string, unknown>)}
      />
    );
  },
);
NavLink.displayName = "NavLink";

/* --------------------------- Hooks ------------------------------- */

export function useLocation() {
  const loc = useTLocation();
  return {
    pathname: loc.pathname,
    search: loc.searchStr ?? "",
    hash: loc.hash ?? "",
    state: (loc.state as unknown) ?? null,
    key: loc.pathname,
  };
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  const fn = useTParams as unknown as (opts: { strict: false }) => T;
  return fn({ strict: false });
}

type NavigateOptions = { replace?: boolean; state?: unknown };
type NavigateFn = {
  (to: To, opts?: NavigateOptions): void;
  (delta: number): void;
};

export function useNavigate(): NavigateFn {
  const tNav = useTNavigate();
  const router = useRouter();
  return ((to: To | number, opts?: NavigateOptions) => {
    if (typeof to === "number") {
      if (to < 0) router.history.back();
      else if (to > 0) router.history.forward();
      return;
    }
    const href = toString(to);
    tNav({ to: href as never, replace: opts?.replace });
  }) as NavigateFn;
}

export function useNavigationType(): "POP" | "PUSH" | "REPLACE" {
  // TanStack doesn't expose this directly; the source code only uses it for
  // a low-priority UX hint, so a constant is acceptable.
  return "PUSH";
}

/* --------------------- Misc passthroughs ------------------------- */

export type { To };
