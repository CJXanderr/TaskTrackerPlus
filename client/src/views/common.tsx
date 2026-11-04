import React from "react";
import { ChevronRight, CircleAlert, FolderX } from "lucide-react";
import { errorMessage, isNotFound } from "../lib/api";
import { Link, Route } from "../lib/router";
import { Button, EmptyState } from "../components/ui";

export const QueryErrorView: React.FC<{ error: unknown; onRetry?: () => void; what?: string }> = ({
  error,
  onRetry,
  what = "This page",
}) => {
  if (isNotFound(error)) {
    return (
      <EmptyState icon={<FolderX size={28} />} title={`${what} isn't available`}>
        <p>It may have been deleted, or you no longer have access.</p>
        <Link to={{ name: "home" }} className="btn btn-outline btn-md">
          <span>Back to projects</span>
        </Link>
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={<CircleAlert size={28} />} title="Couldn't load this">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </EmptyState>
  );
};

export interface Crumb {
  label: string;
  to?: Route;
}

export const Breadcrumbs: React.FC<{ items: Crumb[] }> = ({ items }) => (
  <nav className="crumbs" aria-label="Breadcrumb">
    {items.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ChevronRight size={14} className="crumb-sep" />}
        {c.to ? (
          <Link to={c.to} className="crumb">
            {c.label}
          </Link>
        ) : (
          <span className="crumb current" aria-current="page">
            {c.label}
          </span>
        )}
      </React.Fragment>
    ))}
  </nav>
);
