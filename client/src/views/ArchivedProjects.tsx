import React from "react";
import { ProjectsSection } from "./ProjectsSection";
import { Breadcrumbs } from "./common";

export const ArchivedProjects: React.FC = () => (
  <div className="page">
    <Breadcrumbs items={[{ label: "Projects", to: { name: "home" } }, { label: "Archived projects" }]} />
    <p className="page-subtitle">Archived projects are read-only. Managers can unarchive them from the project menu.</p>
    <ProjectsSection archived />
  </div>
);
