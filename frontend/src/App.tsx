import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  DoorOpen,
  Download,
  Euro,
  FileSearch,
  FileText,
  Grid3X3,
  Layers,
  LayoutDashboard,
  Loader2,
  Maximize2,
  MoreVertical,
  Plus,
  RotateCcw,
  Ruler,
  ScanLine,
  Search,
  Settings,
  Shield,
  SquareStack,
  TriangleAlert,
  Upload,
  UserPlus,
  Users,
  WandSparkles,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ImageDropZone } from "./components/ImageDropZone";
import { ModelSelector } from "./components/ModelSelector";
import { AnalysisProgress } from "./components/AnalysisProgress";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { analyzeFloorPlanStream } from "./lib/api";
import { prepareGrayscaleImage } from "./lib/grayscale";
import type {
  AnalysisMode,
  AnalysisSteps,
  FloorPlanAnalysis,
  PreparedImage,
  StepId,
} from "./types";

type PageId =
  | "dashboard"
  | "projects"
  | "scanner"
  | "workspace"
  | "report"
  | "team"
  | "settings"
  | "billing"
  | "admin";

type WorkspaceTab = "materials" | "compliance" | "cost";

interface NavItem {
  id: PageId;
  label: string;
  icon: ReactNode;
}

const primaryNav: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { id: "projects", label: "Projects", icon: <ClipboardList size={18} /> },
  { id: "scanner", label: "Scanner", icon: <Upload size={18} /> },
  { id: "workspace", label: "Workspace", icon: <FileText size={18} /> },
  { id: "report", label: "Report", icon: <FileText size={18} /> },
];

const secondaryNav: NavItem[] = [
  { id: "team", label: "Team", icon: <Users size={18} /> },
  { id: "settings", label: "Settings", icon: <Settings size={18} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={18} /> },
  { id: "admin", label: "Admin", icon: <Shield size={18} /> },
];

const projectCards = [
  { name: "Berlin Residential Complex", time: "2 hours ago", score: 92, tone: "blue" },
  { name: "Munich Office Tower", time: "5 hours ago", score: 78, tone: "amber" },
  { name: "Hamburg Industrial Park", time: "1 day ago", score: 88, tone: "teal" },
  { name: "Cologne Mixed Use Block", time: "2 days ago", score: 84, tone: "blue" },
  { name: "Frankfurt Transit Hub", time: "3 days ago", score: 90, tone: "teal" },
  { name: "Stuttgart Campus Retrofit", time: "4 days ago", score: 81, tone: "amber" },
];

const teamRows = [
  { initials: "JD", name: "John Doe", email: "john@structureai.eu", role: "Admin", lastActive: "2 min ago" },
  { initials: "MS", name: "Marie Schmidt", email: "marie@structureai.eu", role: "Editor", lastActive: "1 hour ago" },
  { initials: "HW", name: "Hans Weber", email: "hans@weber-bau.de", role: "Viewer", lastActive: "3 hours ago" },
  { initials: "AM", name: "Anna Mueller", email: "anna@structureai.eu", role: "Editor", lastActive: "1 day ago" },
  { initials: "PK", name: "Peter Koenig", email: "peter@structureai.eu", role: "Viewer", lastActive: "2 days ago" },
];

const initialSteps = (): AnalysisSteps => ({
  geometry: { status: "idle", label: "Extracting room geometry" },
  classification: { status: "idle", label: "Classifying room types" },
  openings: { status: "idle", label: "Detecting doors & windows" },
  annotation: { status: "idle", label: "Generating annotated image" },
});

const completedSteps = (): AnalysisSteps => ({
  geometry: { status: "done", label: "Extracting room geometry" },
  classification: { status: "done", label: "Classifying room types" },
  openings: { status: "done", label: "Detecting doors & windows" },
  annotation: { status: "done", label: "Generating annotated image" },
});

const formatArea = (value: number | undefined, digits = 1) => {
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${safeValue.toFixed(digits)} m²`;
};

const formatEuro = (value: number) => `€${Math.round(value).toLocaleString("en-US")}`;

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("materials");
  const [image, setImage] = useState<PreparedImage>();
  const [mode, setMode] = useState<AnalysisMode>("normal");
  const [analysis, setAnalysis] = useState<FloorPlanAnalysis>();
  const [error, setError] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [steps, setSteps] = useState<AnalysisSteps>(initialSteps());

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();

      if (file) void handleFile(file);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const canAnalyze = Boolean(image) && !isPreparing && !isAnalyzing;
  const imageMeta = useMemo(() => {
    if (!image) return "No image loaded";
    return `${image.originalName} · ${image.widthPx} x ${image.heightPx}px · grayscale PNG`;
  }, [image]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projectCards;
    return projectCards.filter((project) => project.name.toLowerCase().includes(query));
  }, [searchQuery]);

  const annotatedSource = analysis?.annotatedImage
    ? `data:${analysis.annotatedImage.mimeType};base64,${analysis.annotatedImage.base64}`
    : undefined;

  async function handleFile(file: File) {
    setError("");
    setAnalysis(undefined);
    setIsPreparing(true);
    setActivePage("scanner");

    try {
      setImage(await prepareGrayscaleImage(file));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to prepare image.");
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleAnalyze() {
    if (!image) return;

    setIsAnalyzing(true);
    setError("");
    setAnalysis(undefined);
    setProgress(0);
    setSteps(initialSteps());

    try {
      const result = await analyzeFloorPlanStream(
        {
          image,
          mode,
        },
        (event) => {
          if (event.type === "error") return;
          setProgress(event.progress);
          if (event.type === "step_start") {
            setSteps((prev) => ({
              ...prev,
              [event.step as StepId]: {
                status: "running",
                label: event.label ?? prev[event.step as StepId].label,
              },
            }));
          } else if (event.type === "step_done") {
            setSteps((prev) => ({
              ...prev,
              [event.step as StepId]: {
                ...prev[event.step as StepId],
                status: "done",
              },
            }));
          }
        },
      );
      setAnalysis(result);
      setProgress(100);
      setSteps(completedSteps());
      setWorkspaceTab("materials");
      setActivePage("workspace");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Analysis failed.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="product-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      <div className="main-frame">
        <header className="topbar">
          <label className="search-shell" aria-label="Search projects">
            <Search size={18} />
            <input
              type="search"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>

          <div className="topbar-actions">
            <button className="ghost-icon notification-button" type="button" aria-label="Notifications">
              <Bell size={19} />
              <span />
            </button>
            <div className="user-chip" aria-label="Current user">
              <span className="avatar">JD</span>
              <strong>John Doe</strong>
              <ChevronDown size={16} />
            </div>
          </div>
        </header>

        <main className={`page page-${activePage}`}>
          <ErrorBoundary>
            {activePage === "dashboard" && (
              <DashboardPage projects={filteredProjects} onNewProject={() => setActivePage("scanner")} />
            )}
            {activePage === "projects" && <ProjectsPage projects={filteredProjects} onOpenScanner={() => setActivePage("scanner")} />}
            {activePage === "scanner" && (
              <ScannerPage
                image={image}
                imageMeta={imageMeta}
                mode={mode}
                error={error}
                isPreparing={isPreparing}
                isAnalyzing={isAnalyzing}
                canAnalyze={canAnalyze}
                progress={progress}
                steps={steps}
                onFile={(file) => void handleFile(file)}
                onModeChange={setMode}
                onAnalyze={() => void handleAnalyze()}
              />
            )}
            {activePage === "workspace" && (
              <WorkspacePage
                image={image}
                analysis={analysis}
                annotatedSource={annotatedSource}
                tab={workspaceTab}
                onTabChange={setWorkspaceTab}
                onOpenScanner={() => setActivePage("scanner")}
              />
            )}
            {activePage === "report" && (
              <ReportPage
                image={image}
                analysis={analysis}
                annotatedSource={annotatedSource}
                onOpenScanner={() => setActivePage("scanner")}
              />
            )}
            {(activePage === "team" || activePage === "admin") && <AdminPage />}
            {activePage === "settings" && <SimplePanel title="Settings" subtitle="Workspace preferences and profile defaults" />}
            {activePage === "billing" && <SimplePanel title="Billing" subtitle="Plan usage, invoices, and payment methods" />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ activePage, onNavigate }: { activePage: PageId; onNavigate: (page: PageId) => void }) {
  return (
    <aside className="sidebar">
      <button className="brand" type="button" onClick={() => onNavigate("dashboard")}>
        <span className="brand-mark">S</span>
        <span>Crane Core Group</span>
      </button>

      <nav className="nav-stack" aria-label="Primary navigation">
        {primaryNav.map((item) => (
          <NavButton key={item.id} item={item} active={activePage === item.id} onNavigate={onNavigate} />
        ))}
      </nav>

      <nav className="nav-stack nav-stack-bottom" aria-label="Workspace navigation">
        {secondaryNav.map((item) => (
          <NavButton key={item.id} item={item} active={activePage === item.id} onNavigate={onNavigate} />
        ))}
      </nav>

      <button className="collapse-button" type="button" aria-label="Collapse sidebar">
        <ChevronLeft size={18} />
      </button>
    </aside>
  );
}

function NavButton({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: (page: PageId) => void }) {
  return (
    <button className={active ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate(item.id)}>
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
}

function DashboardPage({ projects, onNewProject }: { projects: typeof projectCards; onNewProject: () => void }) {
  return (
    <div className="page-inner dashboard-inner">
      <PageHeader
        title="Dashboard"
        subtitle="Welcome back, John. You have 3 projects pending optimization."
        actions={(
          <button className="primary-button" type="button" onClick={onNewProject}>
            <Plus size={16} />
            <span>New Project</span>
          </button>
        )}
      />

      <div className="stat-grid three-up">
        <StatCard label="Total Savings" value="€124,500" detail="+12.5% from last month" accent={<TrendingGlyph />} />
        <StatCard label="Active Projects" value="6" detail="3 optimized, 2 need review, 1 in progress" />
        <StatCard label="Avg. Score" value="81.5" detail="Across all projects" />
      </div>

      <section className="project-section" aria-labelledby="recent-projects-title">
        <h2 id="recent-projects-title">Recent Projects</h2>
        <div className="project-grid">
          {projects.map((project, index) => (
            <ProjectTile key={project.name} project={project} highlighted={index === 0} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ProjectsPage({ projects, onOpenScanner }: { projects: typeof projectCards; onOpenScanner: () => void }) {
  return (
    <div className="page-inner">
      <PageHeader
        title="Projects"
        subtitle="Review project scans, optimization scores, and recent activity."
        actions={(
          <button className="primary-button" type="button" onClick={onOpenScanner}>
            <Upload size={16} />
            <span>Scan Project</span>
          </button>
        )}
      />
      <div className="project-grid project-grid-wide">
        {projects.map((project) => <ProjectTile key={project.name} project={project} />)}
      </div>
    </div>
  );
}

function ScannerPage({
  image,
  imageMeta,
  mode,
  error,
  isPreparing,
  isAnalyzing,
  canAnalyze,
  progress,
  steps,
  onFile,
  onModeChange,
  onAnalyze,
}: {
  image?: PreparedImage;
  imageMeta: string;
  mode: AnalysisMode;
  error: string;
  isPreparing: boolean;
  isAnalyzing: boolean;
  canAnalyze: boolean;
  progress: number;
  steps: AnalysisSteps;
  onFile: (file: File) => void;
  onModeChange: (mode: AnalysisMode) => void;
  onAnalyze: () => void;
}) {
  return (
    <div className="scanner-content">
      <PageHeader
        title="Blueprint Scanner"
        subtitle="Upload your architectural drawings for AI-powered analysis"
        actions={<ModelSelector value={mode} onChange={onModeChange} />}
      />

      <ImageDropZone isPreparing={isPreparing} onFile={onFile} />

      {(image || isAnalyzing) && (
        <section className="scan-action-panel" aria-label="Selected blueprint">
          <div className="selected-file">
            {image ? <img src={image.dataUrl} alt="Selected grayscale blueprint" /> : <span className="file-placeholder" />}
            <div>
              <strong>{image?.originalName ?? "Preparing blueprint"}</strong>
              <span>{imageMeta}</span>
            </div>
          </div>
          <button className="primary-button analyze-primary" type="button" onClick={onAnalyze} disabled={!canAnalyze}>
            {isAnalyzing ? <Loader2 size={17} className="spin-icon" /> : <WandSparkles size={17} />}
            <span>{isAnalyzing ? "Analyzing" : "Analyze Blueprint"}</span>
          </button>
        </section>
      )}

      {isAnalyzing && (
        <section className="scan-progress-panel" aria-label="Analysis progress">
          <AnalysisProgress steps={steps} progress={progress} />
        </section>
      )}

      {error && <ErrorCallout message={error} />}

      <div className="scan-tip-grid">
        <InfoCard title="High Resolution" text="Upload at 300 DPI for best results" />
        <InfoCard title="Include Scale" text="Drawings with scale indicators are more accurate" />
        <InfoCard title="Layer Visibility" text="Ensure all structural layers are visible" />
      </div>
    </div>
  );
}

function WorkspacePage({
  image,
  analysis,
  annotatedSource,
  tab,
  onTabChange,
  onOpenScanner,
}: {
  image?: PreparedImage;
  analysis?: FloorPlanAnalysis;
  annotatedSource?: string;
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onOpenScanner: () => void;
}) {
  const viewerSource = annotatedSource ?? image?.dataUrl;

  return (
    <div className="workspace-layout">
      <section className="viewer-card" aria-label="3D viewer">
        <div className="viewer-toolbar">
          <strong>3D Viewer</strong>
          <div className="viewer-tools" aria-label="Viewer controls">
            <button type="button" aria-label="Zoom in"><ZoomIn size={16} /></button>
            <button type="button" aria-label="Zoom out"><ZoomOut size={16} /></button>
            <button type="button" aria-label="Reset view"><RotateCcw size={16} /></button>
            <button type="button" aria-label="Fullscreen"><Maximize2 size={16} /></button>
          </div>
        </div>

        <div className={viewerSource ? "viewer-stage has-plan" : "viewer-stage"}>
          {viewerSource ? (
            <>
              <img className="viewer-plan" src={viewerSource} alt="Analyzed floor plan" />
              {analysis && (
                <div className="viewer-summary-pill">
                  <strong>{formatArea(analysis.summary.totalAreaM2)}</strong>
                  <span>{analysis.summary.roomCount} rooms detected</span>
                </div>
              )}
            </>
          ) : (
            <div className="cube-state">
              <div className="wire-cube" aria-hidden="true">
                <span className="cube-face cube-top" />
                <span className="cube-face cube-left" />
                <span className="cube-face cube-right" />
              </div>
              <span>No analysis yet</span>
            </div>
          )}
          <span className="viewer-hint">{analysis ? "Scan loaded in workspace" : "Run a scan to populate the viewer"}</span>
        </div>
      </section>

      <section className="inspector-card" aria-label="Project inspector">
        <div className="inspector-tabs" role="tablist" aria-label="Workspace data">
          <TabButton active={tab === "materials"} onClick={() => onTabChange("materials")} icon={<Layers size={16} />} label="Materials" />
          <TabButton active={tab === "compliance"} onClick={() => onTabChange("compliance")} icon={<TriangleAlert size={16} />} label="Compliance" />
          <TabButton active={tab === "cost"} onClick={() => onTabChange("cost")} icon={<Euro size={16} />} label="Cost" />
        </div>

        {tab === "materials" && <MaterialsTab analysis={analysis} />}
        {tab === "compliance" && <ComplianceTab analysis={analysis} onOpenScanner={onOpenScanner} />}
        {tab === "cost" && <CostTab analysis={analysis} />}
      </section>
    </div>
  );
}

function ReportPage({
  image,
  analysis,
  annotatedSource,
  onOpenScanner,
}: {
  image?: PreparedImage;
  analysis?: FloorPlanAnalysis;
  annotatedSource?: string;
  onOpenScanner: () => void;
}) {
  if (!analysis) {
    return (
      <div className="empty-state-page">
        <span className="empty-icon"><FileSearch size={32} /></span>
        <h1>No analysis loaded</h1>
        <p>Run a scan to generate a floor-plan analysis report.</p>
        <button className="primary-button" type="button" onClick={onOpenScanner}>
          <span>Open Scanner</span>
          <ArrowRight size={16} />
        </button>
      </div>
    );
  }

  const summary = analysis.summary;
  const reportHref = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(analysis, null, 2))}`;

  return (
    <div className="page-inner report-inner">
      <PageHeader
        title="Analysis Report"
        subtitle={image ? image.originalName : "Current floor-plan scan"}
        actions={(
          <a className="primary-button" href={reportHref} download="floor-plan-analysis.json">
            <Download size={16} />
            <span>Export JSON</span>
          </a>
        )}
      />

      <div className="stat-grid four-up">
        <StatCard label="Total Area" value={formatArea(summary.totalAreaM2)} detail="Detected footprint" />
        <StatCard label="Rooms" value={String(summary.roomCount)} detail={`${summary.doorCount} doors, ${summary.windowCount} windows`} />
        <StatCard label="Wall Area" value={formatArea(summary.wallAreaM2)} detail="Estimated structural walls" />
        <StatCard label="Glass Area" value={formatArea(summary.glassAreaM2)} detail="Windows and glazing" />
      </div>

      <div className="report-grid">
        <section className="panel-card room-schedule">
          <div className="panel-heading">
            <h2>Room Schedule</h2>
            <span>{analysis.rooms.length} spaces</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Type</th>
                  <th>Area</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rooms.map((room) => (
                  <tr key={room.id}>
                    <td>
                      <span className="room-name-cell"><span className="swatch" style={{ backgroundColor: room.color }} />{room.label}</span>
                    </td>
                    <td>{room.type}</td>
                    <td>{formatArea(room.areaM2, 2)}</td>
                    <td>{Math.round((room.confidence ?? 0) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel-card report-side-card">
          <div className="panel-heading">
            <h2>Model & Scale</h2>
          </div>
          {annotatedSource && <img className="report-thumbnail" src={annotatedSource} alt="Annotated floor plan" />}
          <dl className="detail-list">
            <div><dt>Analysis model</dt><dd>{analysis.model.actualAnalysisModel}</dd></div>
            <div><dt>Image model</dt><dd>{analysis.model.imageModel}</dd></div>
            <div><dt>Scale source</dt><dd>{analysis.scale.source}</dd></div>
            <div><dt>Scale confidence</dt><dd>{Math.round((analysis.scale.confidence ?? 0) * 100)}%</dd></div>
          </dl>
        </section>
      </div>

      {(analysis.warnings?.length ?? 0) > 0 && (
        <section className="warning-panel">
          <AlertCircle size={18} />
          <div>
            {analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        </section>
      )}
    </div>
  );
}

function AdminPage() {
  return (
    <div className="page-inner admin-inner">
      <PageHeader
        title="Admin Panel"
        subtitle="Manage team members and their permissions"
        icon={<Shield size={20} />}
        actions={(
          <button className="primary-button" type="button">
            <UserPlus size={16} />
            <span>Invite User</span>
          </button>
        )}
      />

      <div className="stat-grid three-up admin-stats">
        <StatCard label="Total Users" value="5" />
        <StatCard label="Active Today" value="3" />
        <StatCard label="Pending Invites" value="2" />
      </div>

      <section className="panel-card user-table-card">
        <label className="search-shell table-search" aria-label="Search users">
          <Search size={18} />
          <input type="search" placeholder="Search users..." />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Last Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((user) => (
                <tr key={user.email}>
                  <td>
                    <div className="user-row-cell">
                      <span className="small-avatar">{user.initials}</span>
                      <div>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className={`role-pill role-${user.role.toLowerCase()}`}>{user.role}</span></td>
                  <td>{user.lastActive}</td>
                  <td><button className="ghost-icon" type="button" aria-label={`Actions for ${user.name}`}><MoreVertical size={17} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SimplePanel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-inner">
      <PageHeader title={title} subtitle={subtitle} />
      <section className="panel-card placeholder-panel">
        <Grid3X3 size={28} />
        <h2>{title}</h2>
        <p>This area uses the rebuilt Crane Core workspace shell and is ready for the next workflow.</p>
      </section>
    </div>
  );
}

function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{icon}{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

function StatCard({ label, value, detail, accent }: { label: string; value: string; detail?: string; accent?: ReactNode }) {
  return (
    <section className="stat-card">
      <div className="stat-topline">
        <span>{label}</span>
        {accent}
      </div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </section>
  );
}

function ProjectTile({ project, highlighted = false }: { project: typeof projectCards[number]; highlighted?: boolean }) {
  return (
    <article className={`project-tile tile-${project.tone} ${highlighted ? "highlighted" : ""}`}>
      <div className="tile-art" aria-hidden="true">
        <span className="blueprint-lines" />
      </div>
      <div className="project-tile-body">
        <div>
          <h3>{project.name}</h3>
          <span>{project.time}</span>
        </div>
        <strong className={project.score < 80 ? "score score-warn" : "score"}>{project.score}/100</strong>
      </div>
      {highlighted && <button className="tile-menu" type="button" aria-label="Project actions"><MoreVertical size={18} /></button>}
    </article>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <section className="info-card">
      <strong>{title}</strong>
      <span>{text}</span>
    </section>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button className={active ? "tab-button active" : "tab-button"} type="button" onClick={onClick} role="tab" aria-selected={active}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MaterialsTab({ analysis }: { analysis?: FloorPlanAnalysis }) {
  const floorArea = analysis?.summary.floorAreaM2 ?? 450;
  const wallArea = analysis?.summary.wallAreaM2 ?? 125;
  const glassArea = analysis?.summary.glassAreaM2 ?? 320;
  const materialRows = analysis
    ? [
        { name: "Floor Assembly", sub: `${formatArea(floorArea)} @ €120/m²`, price: floorArea * 120 },
        { name: "Wall Structure", sub: `${formatArea(wallArea)} @ €95/m²`, price: wallArea * 95 },
        { name: "Glass Facade", sub: `${formatArea(glassArea)} @ €180/m²`, price: glassArea * 180 },
        { name: "Openings Package", sub: `${analysis.summary.doorCount + analysis.summary.windowCount} items @ €450/item`, price: (analysis.summary.doorCount + analysis.summary.windowCount) * 450 },
      ]
    : [
        { name: "Concrete C25/30", sub: "450 m³ @ €120/m³", price: 54000 },
        { name: "Steel Rebar B500B", sub: "12,500 kg @ €1.20/kg", price: 15000 },
        { name: "Structural Steel S355", sub: "8,200 kg @ €2.50/kg", price: 20500 },
        { name: "Brick Masonry", sub: "2,800 units @ €0.85/unit", price: 2380 },
        { name: "Insulation XPS", sub: "680 m² @ €45/m²", price: 30600 },
        { name: "Glass Facade", sub: "320 m² @ €180/m²", price: 57600 },
      ];

  return (
    <div className="inspector-list">
      {materialRows.map((item) => (
        <div className="inspector-row" key={item.name}>
          <div>
            <strong>{item.name}</strong>
            <span>{item.sub}</span>
          </div>
          <strong>{formatEuro(item.price)}</strong>
        </div>
      ))}
    </div>
  );
}

function ComplianceTab({ analysis, onOpenScanner }: { analysis?: FloorPlanAnalysis; onOpenScanner: () => void }) {
  const warnings = analysis?.warnings ?? [];
  return (
    <div className="compliance-stack">
      <div className="compliance-row ok">
        <CheckCircle2 size={18} />
        <div>
          <strong>Geometry extracted</strong>
          <span>{analysis ? `${analysis.rooms.length} room polygons available` : "Waiting for scan data"}</span>
        </div>
      </div>
      <div className={warnings.length ? "compliance-row warn" : "compliance-row ok"}>
        {warnings.length ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
        <div>
          <strong>Warnings</strong>
          <span>{warnings.length ? `${warnings.length} items need review` : "No warning flags loaded"}</span>
        </div>
      </div>
      {!analysis && (
        <button className="primary-button full-width" type="button" onClick={onOpenScanner}>
          <ScanLine size={16} />
          <span>Run Scan</span>
        </button>
      )}
    </div>
  );
}

function CostTab({ analysis }: { analysis?: FloorPlanAnalysis }) {
  const wallCost = (analysis?.summary.wallAreaM2 ?? 240) * 95;
  const glassCost = (analysis?.summary.glassAreaM2 ?? 320) * 180;
  const floorCost = (analysis?.summary.floorAreaM2 ?? 450) * 120;
  const total = wallCost + glassCost + floorCost;

  return (
    <div className="cost-panel">
      <div className="cost-total">
        <span>Estimated Cost</span>
        <strong>{formatEuro(total)}</strong>
      </div>
      <dl className="detail-list">
        <div><dt>Floor systems</dt><dd>{formatEuro(floorCost)}</dd></div>
        <div><dt>Wall systems</dt><dd>{formatEuro(wallCost)}</dd></div>
        <div><dt>Glazing</dt><dd>{formatEuro(glassCost)}</dd></div>
      </dl>
    </div>
  );
}

function ErrorCallout({ message }: { message: string }) {
  return (
    <div className="error-banner">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  );
}

function TrendingGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 12l4-4 3 3 5-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 5h4v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}