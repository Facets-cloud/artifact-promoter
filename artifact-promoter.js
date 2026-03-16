// artifact-promoter.js — Facets Web Component
// Promotes service artifacts between environments following the CI/CD promotion flow.

class ArtifactPromoter extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // State
    this.projects = [];
    this.selectedProject = '';
    this.ciCdFlow = null;
    this.validEnvs = [];        // [{sequence, name, clusterId}] sorted by sequence
    this.registrationType = 'ENVIRONMENT';
    this.ciIntegrations = [];           // [{id, name, ...}]
    this.enabledBlueprintServices = []; // service resource names enabled in blueprint
    this.sourceEnv = '';
    this.targetEnv = '';
    this.sourceClusterId = '';
    this.targetClusterId = '';
    this.sourceArtifacts = {};  // applicationName → Artifact (latest)
    this.targetArtifacts = {};  // applicationName → Artifact (latest)
    this.diffs = [];            // comparison rows
    this.noCiSvcs = [];         // enabled in blueprint but no CI integration
    this.selectedDiffs = new Set();
    this.serviceFilter = 'all';
    this.selectedServiceNames = new Set();
    this.promoteResults = [];

    this.render();
  }

  connectedCallback() {
    this.setupEventListeners();
    this.fetchProjects();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #1a1a2e;
          --primary: #4f46e5;
          --primary-hover: #4338ca;
          --success: #059669;
          --danger: #dc2626;
          --warning: #d97706;
          --border: #e2e8f0;
          --bg-light: #f8fafc;
          --shadow: 0 1px 3px rgba(0,0,0,0.1);
          --radius: 8px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .container { max-width: 1100px; margin: 0 auto; padding: 24px; }

        /* Header */
        .header {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 24px; padding-bottom: 16px;
          border-bottom: 2px solid var(--border);
        }
        .header-icon {
          width: 38px; height: 38px; background: var(--primary);
          border-radius: 8px; display: flex; align-items: center;
          justify-content: center; color: white; font-size: 20px; flex-shrink: 0;
        }
        .header h1 { font-size: 22px; font-weight: 700; color: #1a1a2e; }
        .header-sub { font-size: 13px; color: #64748b; margin-top: 2px; }

        /* Cards */
        .card {
          background: #fff; border: 1px solid var(--border);
          border-radius: var(--radius); padding: 24px;
          margin-bottom: 20px; box-shadow: var(--shadow);
        }
        .card-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.07em; color: #94a3b8; margin-bottom: 14px;
        }

        /* Forms */
        .form-row { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 16px; }
        .form-group { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 160px; }
        label { font-size: 13px; font-weight: 500; color: #374151; }
        select {
          border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;
          font-size: 14px; background: white; color: #1a1a2e; height: 38px;
          outline: none; transition: border-color 0.15s; cursor: pointer;
          max-width: 100%;
        }
        select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
        select:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }

        /* Buttons */
        .btn {
          display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px;
          border: none; border-radius: 6px; font-size: 14px; font-weight: 500;
          cursor: pointer; transition: background 0.15s, opacity 0.15s; height: 38px;
          white-space: nowrap;
        }
        .btn:active { opacity: 0.9; }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--primary-hover); }
        .btn-primary:disabled { background: #a5b4fc; cursor: not-allowed; }
        .btn-success { background: var(--success); color: white; }
        .btn-success:hover:not(:disabled) { background: #047857; }
        .btn-success:disabled { background: #6ee7b7; cursor: not-allowed; }

        /* Alerts */
        .alert {
          padding: 10px 14px; border-radius: 6px; font-size: 13px;
          display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px;
        }
        .alert-error  { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
        .alert-success { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
        .alert-warning { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
        .alert-info   { background: #eff6ff; border: 1px solid #93c5fd; color: #1d4ed8; }

        /* Unified CI/CD Flow Widget */
        .flow-widget {
          background: var(--bg-light); border: 1px solid var(--border);
          border-radius: 8px; padding: 16px 18px;
        }
        .flow-hint {
          font-size: 12px; color: #94a3b8; margin-bottom: 10px; line-height: 1.5;
        }
        .flow-hint strong { color: #64748b; font-weight: 600; }

        /* Section dividers */
        .divider {
          border: none; border-top: 1px solid var(--border); margin: 20px 0;
        }
        .flow-track {
          display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
        }
        .flow-node {
          padding: 6px 14px; border-radius: 6px; border: 2px solid var(--border);
          background: white; font-size: 13px; font-weight: 500; color: #475569;
          cursor: pointer; transition: all 0.15s; white-space: nowrap; user-select: none;
        }
        .flow-node:hover:not(.flow-node-end) { border-color: var(--primary); color: var(--primary); background: #eef2ff; }
        .flow-node.source { background: #eef2ff; border-color: var(--primary); color: var(--primary); }
        .flow-node.target { background: #f0fdf4; border-color: var(--success); color: #166534; }
        .flow-node.flow-node-end { cursor: default; opacity: 0.45; }
        .flow-connector {
          display: flex; align-items: center; color: #cbd5e1;
          font-size: 18px; flex-shrink: 0; line-height: 1; transition: color 0.15s;
        }
        .flow-connector.active { color: var(--primary); }
        .flow-pair-info {
          display: flex; align-items: center; gap: 6px; margin-top: 14px;
          padding-top: 12px; border-top: 1px solid var(--border);
          font-size: 13px; color: #475569;
        }
        .pair-src { font-weight: 600; color: var(--primary); }
        .pair-tgt { font-weight: 600; color: var(--success); }
        .pair-arrow { color: #94a3b8; font-size: 15px; }
        .pair-hint { font-size: 11px; color: #94a3b8; margin-left: 2px; }

        /* Section label (reusable for sub-sections in cards) */
        .section-lbl {
          font-size: 11px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: #94a3b8; margin-bottom: 10px;
        }

        /* Services */
        .radio-group { display: flex; gap: 20px; margin: 8px 0; }
        .radio-opt { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
        .services-chips {
          display: none; flex-wrap: wrap; gap: 8px; margin-top: 8px;
          max-height: 180px; overflow-y: auto; padding: 10px;
          background: var(--bg-light); border: 1px solid var(--border); border-radius: 6px;
        }
        .services-chips.open { display: flex; }
        .svc-chip {
          display: flex; align-items: center; gap: 5px; padding: 4px 10px;
          background: white; border: 1px solid var(--border); border-radius: 20px;
          font-size: 13px; cursor: pointer; user-select: none; transition: all 0.1s;
        }
        .svc-chip:hover { border-color: var(--primary); }
        .svc-chip.on { background: #eef2ff; border-color: var(--primary); color: var(--primary); }
        .svc-chip input { cursor: pointer; accent-color: var(--primary); }

        /* Table */
        .table-wrap { overflow-x: auto; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead th {
          background: var(--bg-light); padding: 10px 14px; text-align: left;
          font-weight: 600; font-size: 12px; color: #374151;
          border-bottom: 2px solid var(--border); white-space: nowrap;
        }
        tbody td { padding: 10px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; font-size: 13px; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: #f8fafc; }
        .row-check { cursor: pointer; accent-color: var(--primary); }
        .row-check:disabled { opacity: 0.35; cursor: not-allowed; }

        /* Badges */
        .badge {
          display: inline-flex; align-items: center; padding: 2px 8px;
          border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;
        }
        .badge-diff    { background: #fef3c7; color: #92400e; }
        .badge-new     { background: #eff6ff; color: #1e40af; }
        .badge-same    { background: #f0fdf4; color: #166534; }
        .badge-missing { background: #fef2f2; color: #991b1b; }

        .tag {
          font-family: monospace; font-size: 12px; padding: 2px 6px;
          border-radius: 4px; max-width: 200px; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; display: inline-block;
          vertical-align: middle;
        }
        .tag.src { background: #eff6ff; color: #1d4ed8; }
        .tag.tgt { background: #f0fdf4; color: #166534; }
        .tag-na { color: #94a3b8; font-style: italic; font-size: 12px; }

        .ci-ok  { font-size: 11px; background: #f0fdf4; border: 1px solid #86efac; color: #166534; border-radius: 4px; padding: 1px 6px; }
        .ci-no  { font-size: 11px; background: #f3f4f6; border: 1px solid #d1d5db; color: #6b7280; border-radius: 4px; padding: 1px 6px; }

        /* Toolbar */
        .toolbar {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
          padding-bottom: 14px; border-bottom: 1px solid var(--border);
        }
        .section-title { font-size: 15px; font-weight: 600; color: #1e293b; }
        .summary-text  { font-size: 12px; color: #64748b; margin-top: 4px; }

        /* Promote bottom bar */
        .promote-bar {
          display: flex; align-items: center; gap: 12px; margin-top: 20px;
          padding-top: 16px; border-top: 1px solid var(--border); flex-wrap: wrap;
        }
        .promote-note { font-size: 12px; color: #64748b; font-style: italic; }

        /* Results */
        .results-panel { margin-top: 16px; }
        .result-row {
          display: flex; align-items: center; gap: 10px; padding: 7px 0;
          font-size: 13px; border-bottom: 1px solid var(--border);
        }
        .result-row:last-child { border-bottom: none; }

        /* Loading overlay */
        .loading-overlay {
          display: none; align-items: center; justify-content: center;
          gap: 10px; padding: 12px; background: #f8fafc;
          border-radius: 6px; font-size: 13px; color: #475569;
          margin-bottom: 12px;
        }
        .loading-overlay.on { display: flex; }
        .spinner {
          width: 16px; height: 16px; border: 2px solid #e2e8f0;
          border-top-color: var(--primary); border-radius: 50%;
          animation: spin 0.7s linear infinite; flex-shrink: 0;
        }
        .btn-spinner {
          width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4);
          border-top-color: white; border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Empty state */
        .empty-state { text-align: center; padding: 40px 20px; color: #94a3b8; }
        .empty-state .icon { font-size: 36px; margin-bottom: 8px; }
        .empty-state p { font-size: 14px; }
      </style>

      <div class="container">

        <!-- Header -->
        <div class="header">
          <div class="header-icon">🚀</div>
          <div>
            <h1>Artifact Promoter</h1>
            <div class="header-sub">Promote service artifacts between environments following the CI/CD flow</div>
          </div>
        </div>

        <!-- Global messages -->
        <div id="global-error"   class="alert alert-error"   style="display:none;"></div>
        <div id="global-loading" class="loading-overlay">
          <div class="spinner"></div>
          <span id="loading-msg">Loading...</span>
        </div>

        <!-- Configuration Card -->
        <div class="card">
          <p class="card-title">Configuration</p>

          <!-- Project -->
          <div class="form-row">
            <div class="form-group" style="max-width:340px;">
              <label for="project-sel">Project</label>
              <select id="project-sel">
                <option value="">— Select project —</option>
              </select>
            </div>
          </div>

          <hr class="divider">

          <!-- Unified CI/CD Flow + Env Picker -->
          <div id="env-flow-widget" style="display:none;">
            <p class="card-title">CI/CD Promotion Flow</p>
            <p class="flow-hint">Click a stage to set it as <strong>source</strong> — the next stage auto-selects as <strong>target</strong>.</p>
            <div class="flow-widget">
              <div id="flow-nodes" class="flow-track"></div>
              <div id="flow-pair-summary" class="flow-pair-info" style="display:none;"></div>
            </div>
          </div>

          <!-- Registration-type info alert (shown for non-ENVIRONMENT types) -->
          <div id="comparison-alert" class="alert" style="display:none;margin-top:12px;"></div>

          <hr class="divider" id="svc-divider" style="display:none;">

          <!-- Services filter -->
          <div style="margin-bottom:20px;">
            <label>Services to Promote</label>
            <div class="radio-group">
              <label class="radio-opt">
                <input type="radio" name="svc-mode" id="filter-all" value="all" checked>
                All services with CI integration
              </label>
              <label class="radio-opt">
                <input type="radio" name="svc-mode" id="filter-specific" value="specific">
                Specific services
              </label>
            </div>
            <div id="svc-chips" class="services-chips"></div>
          </div>

          <!-- Compare button -->
          <button class="btn btn-primary" id="compare-btn" disabled>
            <span id="compare-spinner" style="display:none;"><span class="btn-spinner"></span></span>
            Load Comparison
          </button>
        </div>

        <!-- Results Card -->
        <div class="card" id="results-card" style="display:none;">
          <div class="toolbar">
            <div>
              <div class="section-title">Comparison Results</div>
              <div class="summary-text" id="results-summary"></div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
              <input type="checkbox" id="select-all"> Select all with diff
            </label>
          </div>

          <!-- Table 1: Excluded services (no CI / not in source) -->
          <div id="excluded-section" style="display:none;margin-bottom:24px;">
            <div class="section-lbl">Excluded Services</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody id="excluded-tbody"></tbody>
              </table>
            </div>
          </div>

          <!-- Table 2: Promotable services -->
          <div id="comparison-section">
            <hr class="divider" id="tables-divider" style="display:none;">
            <div class="section-lbl">Promotable Services</div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style="width:36px;"></th>
                    <th>Service</th>
                    <th>Source (<span id="src-label">—</span>)</th>
                    <th>Target (<span id="tgt-label">—</span>)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="diff-tbody"></tbody>
              </table>
            </div>
          </div>

          <div id="empty-diff" class="empty-state" style="display:none;">
            <div class="icon">✅</div>
            <p>All services are in sync — no promotion needed.</p>
          </div>

          <!-- Promote bar -->
          <div class="promote-bar">
            <button class="btn btn-success" id="promote-btn" disabled>
              <span id="promote-spinner" style="display:none;"><span class="btn-spinner"></span></span>
              Promote Selected (<span id="sel-count">0</span>)
            </button>
            <span class="promote-note" id="promote-note">Select services to promote</span>
          </div>

          <!-- Promote results -->
          <div id="promote-results" class="results-panel" style="display:none;"></div>
        </div>

      </div>
    `;
  }

  setupEventListeners() {
    const s = this.shadowRoot;

    s.getElementById('project-sel').addEventListener('change', e => this.onProjectChange(e.target.value));

    s.getElementById('filter-all').addEventListener('change', () => {
      this.serviceFilter = 'all';
      s.getElementById('svc-chips').classList.remove('open');
      this.validateForm();
    });

    s.getElementById('filter-specific').addEventListener('change', () => {
      this.serviceFilter = 'specific';
      s.getElementById('svc-chips').classList.add('open');
      this.validateForm();
    });

    s.getElementById('compare-btn').addEventListener('click', () => this.loadComparison());
    s.getElementById('select-all').addEventListener('change', e => this.toggleSelectAll(e.target.checked));
    s.getElementById('promote-btn').addEventListener('click', () => this.promoteSelected());
  }

  // ─── API ───────────────────────────────────────────────────────────────────

  async fetchProjects() {
    try {
      this.setLoading(true, 'Loading projects...');
      const res = await fetch('/cc-ui/v1/stacks/');
      if (!res.ok) throw new Error(`Failed to load projects (${res.status})`);
      const data = await res.json();
      this.projects = Array.isArray(data) ? data : (data.content || data.stacks || []);
      this.populateProjectDropdown();
    } catch (err) {
      this.showError(err.message);
    } finally {
      this.setLoading(false);
    }
  }

  async onProjectChange(stackName) {
    this.selectedProject = stackName;
    this.clearResults();
    this.resetEnvs();
    this.resetServices();
    this.clearError();

    if (!stackName) return;

    try {
      this.setLoading(true, 'Loading CI/CD flow...');

      const [ciCdRes, ciIntRes, bpRes] = await Promise.all([
        fetch(`/cc-ui/v1/ci-cd/${encodeURIComponent(stackName)}`),
        fetch(`/cc-ui/v1/artifacts-ci/blueprint/${encodeURIComponent(stackName)}`),
        fetch(`/cc-ui/v1/designer/${encodeURIComponent(stackName)}/master/files`)
      ]);

      if (!ciCdRes.ok) {
        if (ciCdRes.status === 404) {
          this.showError('No CI/CD flow found for this project. Please configure CI/CD settings first.');
        } else {
          throw new Error(`Failed to load CI/CD flow (${ciCdRes.status})`);
        }
        return;
      }

      const ciCd = await ciCdRes.json();
      this.ciCdFlow = ciCd;
      this.registrationType = ciCd.registrationType || 'ENVIRONMENT';

      const hierarchies = (ciCd.promotionHierarchies || []).sort((a, b) => a.sequence - b.sequence);

      // Fetch all clusters for the project in one call to build clusterId → name map.
      // Works for all registrationTypes: ENVIRONMENT (IDs), RELEASE_STREAM / HYBRID (stream names).
      const clustersRes = await fetch(`/cc-ui/v1/stacks/${encodeURIComponent(stackName)}/clusters`);
      const clusterNameMap = {};
      if (clustersRes.ok) {
        const clustersData = await clustersRes.json();
        const list = Array.isArray(clustersData) ? clustersData : (clustersData.content || []);
        list.forEach(c => { if (c.id) clusterNameMap[c.id] = c.name; });
      }

      this.validEnvs = hierarchies.map(h => ({
        sequence: h.sequence,
        name: clusterNameMap[h.registrationValue] || h.registrationValue,
        clusterId: h.registrationValue
      }));

      if (ciIntRes.ok) {
        const ciIntData = await ciIntRes.json();
        const all = Array.isArray(ciIntData) ? ciIntData : (ciIntData.content || []);
        // Project-scoped + global (stackName === null) CIs
        this.ciIntegrations = all.filter(ci => ci.stackName === stackName || !ci.stackName);
      } else {
        this.ciIntegrations = [];
      }

      // Extract enabled service-type blueprint resources for the chips list.
      // If no resourceType field is present, include the item (safer fallback).
      this.enabledBlueprintServices = [];
      if (bpRes.ok) {
        const bpList = await bpRes.json();
        (Array.isArray(bpList) ? bpList : (bpList.content || [])).forEach(item => {
          if (!item.resourceName) return;
          const rType = (item.resourceType || item.type || '').toLowerCase();
          if (rType && rType !== 'service') return;  // skip non-service types
          if (item.info?.disabled !== true) this.enabledBlueprintServices.push(item.resourceName);
        });
      }

      if (this.validEnvs.length === 0) {
        this.showError('The CI/CD flow has no environments defined. Please add promotion stages first.');
        return;
      }

      this.renderFlowIndicator();
      this.populateEnvDropdowns();
      this.populateServiceChips();

      if (this.registrationType !== 'ENVIRONMENT') {
        this.showComparisonAlert(
          `This project uses <strong>${this.registrationType}</strong> registration type. ` +
          `Environment names are shown from the promotion hierarchy — sequence validation applies.`,
          'alert-info'
        );
      }

    } catch (err) {
      this.showError(err.message);
    } finally {
      this.setLoading(false);
    }
  }

  async getClusterId(stackName, envName) {
    const res = await fetch(
      `/cc-ui/v1/clusters/stack/${encodeURIComponent(stackName)}/cluster/${encodeURIComponent(envName)}/info`
    );
    if (!res.ok) throw new Error(`Could not resolve environment "${envName}" to a cluster (${res.status})`);
    const data = await res.json();
    const id = data.id || data.clusterId || data.clusterID || data.cluster_id;
    if (!id) throw new Error(`No cluster ID found for environment "${envName}"`);
    return id;
  }

  buildArtifactMap(list) {
    const map = {};
    list.forEach(a => {
      const name = a.applicationName;
      if (!name) return;
      const prev = map[name];
      if (!prev) { map[name] = a; return; }
      const aDate = new Date(a.creationDate || a.createdOn || 0).getTime();
      const pDate = new Date(prev.creationDate || prev.createdOn || 0).getTime();
      if (aDate > pDate) map[name] = a;
    });
    return map;
  }

  async loadComparison() {
    this.clearResults();
    const s = this.shadowRoot;
    const compareBtn = s.getElementById('compare-btn');
    const spinner = s.getElementById('compare-spinner');
    compareBtn.disabled = true;
    spinner.style.display = 'inline';

    try {
      // Resolve cluster IDs up front so all 4 fetches can run in parallel.
      const srcEntry = this.validEnvs.find(e => e.name === this.sourceEnv);
      const tgtEntry = this.validEnvs.find(e => e.name === this.targetEnv);
      const srcId = srcEntry?.clusterId || await this.getClusterId(this.selectedProject, this.sourceEnv);
      const tgtId = tgtEntry?.clusterId || await this.getClusterId(this.selectedProject, this.targetEnv);
      this.sourceClusterId = srcId;
      this.targetClusterId = tgtId;

      // ── Step 1: Fetch blueprint, CI integrations, and artifacts in parallel ───
      this.setLoading(true, 'Checking blueprint and fetching artifacts...');
      const [bpRes, ciIntRes, srcRes, tgtRes] = await Promise.all([
        fetch(`/cc-ui/v1/designer/${encodeURIComponent(this.selectedProject)}/master/files`),
        fetch(`/cc-ui/v1/artifacts-ci/blueprint/${encodeURIComponent(this.selectedProject)}`),
        fetch(`/cc-ui/v1/artifacts/${srcId}`),
        fetch(`/cc-ui/v1/artifacts/${tgtId}`)
      ]);

      // ── Step 2: Build blueprint map — only service-type enabled resources ────
      const blueprintDisabled = {};
      const enabledResources = [];  // service-type resource names where disabled !== true
      if (bpRes.ok) {
        const bpList = await bpRes.json();
        (Array.isArray(bpList) ? bpList : (bpList.content || [])).forEach(item => {
          if (!item.resourceName) return;
          // Only consider service-type resources for CI/CD promotion
          const rType = (item.resourceType || item.type || '').toLowerCase();
          if (rType && rType !== 'service') return;
          const disabled = item.info?.disabled === true;
          blueprintDisabled[item.resourceName.toLowerCase()] = disabled;
          if (!disabled) enabledResources.push(item.resourceName);
        });
      }

      // ── Step 3: Build CI map ──────────────────────────────────────────────────
      // Include project-scoped CIs + global CIs (stackName === null).
      // Project-scoped entries take priority (added last to overwrite globals).
      const ciMap = {};
      if (ciIntRes.ok) {
        const ciIntData = await ciIntRes.json();
        const all = Array.isArray(ciIntData) ? ciIntData : (ciIntData.content || []);
        const projectCis = all.filter(ci => ci.stackName === this.selectedProject);
        const globalCis  = all.filter(ci => !ci.stackName);
        this.ciIntegrations = projectCis;
        // Global CIs as fallback, project-scoped override
        [...globalCis, ...projectCis].forEach(ci => {
          if (ci.ciName) ciMap[ci.ciName.toLowerCase()] = ci;
        });
      }
      if (!Object.keys(ciMap).length) {
        this.showError('No CI integrations found for this project. Configure CI/CD integrations first.');
        return;
      }

      // ── Step 4: Flatten cluster-level artifacts (RELEASE_STREAM / HYBRID) ────
      const toArray = d => {
        if (!d) return [];
        if (Array.isArray(d)) return d;
        if (d && Array.isArray(d.content)) return d.content;
        const items = [];
        Object.values(d).forEach(group => {
          if (group && typeof group === 'object' && !Array.isArray(group)) {
            Object.values(group).forEach(a => {
              if (a && typeof a === 'object' && a.applicationName) items.push(a);
            });
          }
        });
        return items;
      };
      if (srcRes.ok) this.sourceArtifacts = this.buildArtifactMap(toArray(await srcRes.json()));
      if (tgtRes.ok) this.targetArtifacts = this.buildArtifactMap(toArray(await tgtRes.json()));

      // ── Step 5: Determine candidates ─────────────────────────────────────────
      // For "all": use ENABLED blueprint resources (not CI integration names).
      // For "specific": use user-selected names.
      const candidates = this.serviceFilter === 'specific'
        ? [...this.selectedServiceNames]
        : enabledResources;

      const toShow       = [];  // enabled + has CI → diff table
      const disabledSvcs = [];  // disabled in blueprint → warn & exclude
      const noCiSvcs     = [];  // no CI integration → exclude (for specific filter warning)

      candidates.forEach(svcName => {
        const norm = svcName.toLowerCase();
        const ci = ciMap[norm] || ciMap[norm.replace(/-/g, '_')] || ciMap[norm.replace(/_/g, '-')];
        const isDisabled = blueprintDisabled[norm] ??
          blueprintDisabled[norm.replace(/-/g, '_')] ??
          blueprintDisabled[norm.replace(/_/g, '-')];
        if (isDisabled) { disabledSvcs.push(svcName); return; }
        if (!ci) { noCiSvcs.push(svcName); return; }
        toShow.push(svcName);
      });

      // ── Step 5.5: Two-phase probe for accurate per-service exclusion reason ───
      // Phase 1: GET /artifacts-ci/name/{svcName} — does a CI with this exact name exist?
      //   200 → CI exists but no artifact in source.
      // Phase 2 (if phase 1 is 4xx): GET /artifacts/cluster/{srcId}/application/{svcName}
      //   200 → artifact present under this app name (CI may use a different ciName).
      //   4xx → no artifact and no matching CI → "not configured".
      const noCiReasons = {};
      await Promise.all(noCiSvcs.map(async svcName => {
        try {
          // Phase 1: explicit CI name lookup
          const ciRes = await fetch(`/cc-ui/v1/artifacts-ci/name/${encodeURIComponent(svcName)}`);
          if (ciRes.ok) {
            noCiReasons[svcName] = 'Artifact not available in source environment';
            return;
          }
          // Phase 2: check cluster artifact by application name (RELEASE_STREAM/HYBRID)
          const artRes = await fetch(`/cc-ui/v1/artifacts/cluster/${encodeURIComponent(srcId)}/application/${encodeURIComponent(svcName)}`);
          if (artRes.ok) {
            noCiReasons[svcName] = 'Artifact available in source but CI integration name mismatch — check CI configuration';
            return;
          }
          noCiReasons[svcName] = 'CI integration not configured for this service';
        } catch (_) {
          noCiReasons[svcName] = 'CI integration not configured for this service';
        }
      }));

      this.noCiSvcs = noCiSvcs.map(name => ({
        name,
        reason: noCiReasons[name] || 'CI integration not configured for this service'
      }));

      if (toShow.length === 0 && this.noCiSvcs.length === 0) {
        this.showError('No enabled services found. Check blueprint and CI/CD configuration.');
        return;
      }
      if (toShow.length === 0) {
        // All services are excluded — still show the excluded table
        this.diffs = [];
        this.selectedDiffs = new Set();
        this.renderDiffTable();
        s.getElementById('results-card').style.display = 'block';
        s.getElementById('src-label').textContent = this.sourceEnv;
        s.getElementById('tgt-label').textContent = this.targetEnv;
        return;
      }

      // ── Step 6: Fetch per-CI artifacts for ENVIRONMENT-type integrations ──────
      // ENVIRONMENT-type CIs don't use /artifacts/{clusterId}; use /artifacts-ci/{ciName}/artifacts.
      const envCiArtifacts = {};  // ciName → { src: artifactItem|null, tgt: artifactItem|null }
      const envTypeCis = toShow
        .map(svcName => {
          const norm = svcName.toLowerCase();
          return ciMap[norm] || ciMap[norm.replace(/-/g, '_')] || ciMap[norm.replace(/_/g, '-')];
        })
        .filter((ci, idx, arr) => ci && ci.registrationType === 'ENVIRONMENT' &&
          arr.findIndex(x => x && x.ciName === ci.ciName) === idx);  // deduplicate

      if (envTypeCis.length > 0) {
        await Promise.all(envTypeCis.map(async ci => {
          try {
            const res = await fetch(`/cc-ui/v1/artifacts-ci/${encodeURIComponent(ci.ciName)}/artifacts`);
            if (res.ok) {
              const raw = await res.json();
              const arr = Array.isArray(raw) ? raw : (raw.content || []);
              // Match by registrationValue === clusterId; skip entries with no real artifact (artifactUri === '-')
              const srcItem = arr.find(a => a.registrationValue === srcId && a.artifactId && a.artifactUri !== '-') || null;
              const tgtItem = arr.find(a => a.registrationValue === tgtId && a.artifactId && a.artifactUri !== '-') || null;
              envCiArtifacts[ci.ciName] = { src: srcItem, tgt: tgtItem };
            }
          } catch (_) { /* leave undefined — treated as no artifact */ }
        }));
      }

      // ── Step 7: Build diff rows ───────────────────────────────────────────────
      this.diffs = toShow.map(svcName => {
        const norm = svcName.toLowerCase();
        const ci = ciMap[norm] || ciMap[norm.replace(/-/g, '_')] || ciMap[norm.replace(/_/g, '-')];

        let srcArtifact = null;
        let tgtArtifact = null;

        if (ci && ci.registrationType === 'ENVIRONMENT') {
          // Per-CI artifacts endpoint
          const ciArts = envCiArtifacts[ci.ciName];
          if (ciArts?.src) {
            srcArtifact = {
              id: ciArts.src.artifactId,
              artifactUri: ciArts.src.artifactUri,
              applicationName: svcName,
            };
          }
          if (ciArts?.tgt) {
            tgtArtifact = {
              id: ciArts.tgt.artifactId,
              artifactUri: ciArts.tgt.artifactUri,
              applicationName: svcName,
            };
          }
        } else {
          // Cluster-level artifacts (RELEASE_STREAM / HYBRID)
          const srcKey = Object.keys(this.sourceArtifacts).find(k => k.toLowerCase() === norm);
          const tgtKey = Object.keys(this.targetArtifacts).find(k => k.toLowerCase() === norm);
          srcArtifact = srcKey ? this.sourceArtifacts[srcKey] : null;
          tgtArtifact = tgtKey ? this.targetArtifacts[tgtKey] : null;
        }

        const srcUri = srcArtifact?.artifactUri || srcArtifact?.tag || srcArtifact?.buildId || null;
        const tgtUri = tgtArtifact?.artifactUri || tgtArtifact?.tag || tgtArtifact?.buildId || null;

        let status;
        if (!srcArtifact || !srcUri) status = 'no-source';
        else if (!tgtArtifact || !tgtUri) status = 'new';
        else if (srcUri === tgtUri)       status = 'same';
        else                              status = 'diff';

        return { svcName, ciId: ci?.id || null, ciName: ci?.ciName || null, srcArtifact, tgtArtifact, status };
      });

      // Pre-select diff/new rows that are promotable
      this.selectedDiffs = new Set(
        this.diffs
          .filter(d => (d.status === 'diff' || d.status === 'new') && d.ciId && d.srcArtifact?.id)
          .map(d => d.svcName)
      );

      this.renderDiffTable();
      s.getElementById('results-card').style.display = 'block';
      s.getElementById('src-label').textContent = this.sourceEnv;
      s.getElementById('tgt-label').textContent = this.targetEnv;
      s.getElementById('results-card').scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (err) {
      this.showError(err.message);
    } finally {
      this.setLoading(false);
      spinner.style.display = 'none';
      compareBtn.disabled = false;  // re-enable for retry; don't call validateForm() — it clears errors
    }
  }

  async promoteSelected() {
    const s = this.shadowRoot;
    const btn = s.getElementById('promote-btn');
    const spinner = s.getElementById('promote-spinner');
    btn.disabled = true;
    spinner.style.display = 'inline';
    s.getElementById('promote-results').style.display = 'none';

    const toPromote = this.diffs.filter(d => this.selectedDiffs.has(d.svcName));
    const results = [];

    for (const diff of toPromote) {
      if (!diff.ciId || !diff.srcArtifact?.id) {
        results.push({ svcName: diff.svcName, ok: false, msg: 'Missing CI integration ID or artifact ID' });
        continue;
      }
      try {
        const res = await fetch(
          `/cc-ui/v1/artifacts/${encodeURIComponent(diff.ciId)}/promote/${encodeURIComponent(diff.srcArtifact.id)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          results.push({ svcName: diff.svcName, ok: false, msg: errBody.message || errBody.detail || `HTTP ${res.status}` });
        } else {
          results.push({ svcName: diff.svcName, ok: true, msg: 'Promoted successfully' });
        }
      } catch (err) {
        results.push({ svcName: diff.svcName, ok: false, msg: err.message });
      }
    }

    this.promoteResults = results;
    this.renderPromoteResults();
    spinner.style.display = 'none';
    this.updatePromoteBar();
  }

  // ─── UI Rendering ──────────────────────────────────────────────────────────

  populateProjectDropdown() {
    const sel = this.shadowRoot.getElementById('project-sel');
    sel.innerHTML = '<option value="">— Select project —</option>';
    this.projects.forEach(p => {
      const name = p.name || p.stackName || p;
      sel.insertAdjacentHTML('beforeend', `<option value="${this.esc(name)}">${this.esc(name)}</option>`);
    });
  }

  renderFlowIndicator() {
    const s = this.shadowRoot;
    const widget = s.getElementById('env-flow-widget');
    const nodesEl = s.getElementById('flow-nodes');

    if (!this.validEnvs.length) { widget.style.display = 'none'; return; }

    widget.style.display = 'block';
    const svcDiv = this.shadowRoot.getElementById('svc-divider');
    if (svcDiv) svcDiv.style.display = 'block';
    nodesEl.innerHTML = this.validEnvs.map((env, i) => {
      const isLast = i === this.validEnvs.length - 1;
      const connector = i > 0
        ? `<span class="flow-connector" data-index="${i}">›</span>`
        : '';
      const title = isLast
        ? 'Last stage — cannot be source'
        : `Click to promote from ${this.esc(env.name)}`;
      return connector +
        `<span class="flow-node${isLast ? ' flow-node-end' : ''}" data-name="${this.esc(env.name)}" title="${title}">${this.esc(env.name)}</span>`;
    }).join('');

    // Wire click listeners onto non-last nodes
    nodesEl.querySelectorAll('.flow-node:not(.flow-node-end)').forEach(node => {
      node.addEventListener('click', () => {
        this.sourceEnv = node.dataset.name;
        this.updateTargetFromFlow();
        this.validateForm();
      });
    });
  }

  updateFlowHighlights() {
    const s = this.shadowRoot;

    // Update node classes
    s.querySelectorAll('#flow-nodes .flow-node').forEach(node => {
      node.classList.remove('source', 'target');
      if (node.dataset.name === this.sourceEnv) node.classList.add('source');
      if (node.dataset.name === this.targetEnv)  node.classList.add('target');
    });

    // Highlight the connector between source and target
    const srcIdx = this.validEnvs.findIndex(e => e.name === this.sourceEnv);
    const tgtIdx = this.validEnvs.findIndex(e => e.name === this.targetEnv);
    s.querySelectorAll('#flow-nodes .flow-connector').forEach(conn => {
      const idx = parseInt(conn.dataset.index);
      conn.classList.toggle('active', srcIdx >= 0 && tgtIdx === srcIdx + 1 && idx === tgtIdx);
    });

    // Pair summary
    const summary = s.getElementById('flow-pair-summary');
    if (this.sourceEnv && this.targetEnv) {
      summary.style.display = 'flex';
      summary.innerHTML = `
        <span>Promoting:</span>
        <span class="pair-src">${this.esc(this.sourceEnv)}</span>
        <span class="pair-arrow">›</span>
        <span class="pair-tgt">${this.esc(this.targetEnv)}</span>
        <span class="pair-hint">(next stage in CI/CD flow)</span>
      `;
    } else if (this.sourceEnv) {
      summary.style.display = 'flex';
      summary.innerHTML = `<span style="color:var(--danger);">⚠ <strong>${this.esc(this.sourceEnv)}</strong> is the last stage — no next environment to promote to.</span>`;
    } else {
      summary.style.display = 'none';
    }
  }

  populateEnvDropdowns() {
    // Flow widget is rendered by renderFlowIndicator(); nothing extra needed here.
  }

  populateServiceChips() {
    const container = this.shadowRoot.getElementById('svc-chips');
    container.innerHTML = '';
    this.selectedServiceNames.clear();

    // Show enabled blueprint service names (real resource names, not CI names)
    const names = this.enabledBlueprintServices.length > 0
      ? this.enabledBlueprintServices
      : this.ciIntegrations.map(ci => ci.ciName || ci.name || ci.id).filter(Boolean);

    if (!names.length) {
      container.innerHTML = '<span style="font-size:13px;color:#94a3b8;">No services found for this project.</span>';
      return;
    }

    names.forEach(name => {
      const label = document.createElement('label');
      label.className = 'svc-chip';
      label.innerHTML = `<input type="checkbox" value="${this.esc(name)}"> ${this.esc(name)}`;
      const cb = label.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) { this.selectedServiceNames.add(name); label.classList.add('on'); }
        else            { this.selectedServiceNames.delete(name); label.classList.remove('on'); }
        this.validateForm();
      });
      container.appendChild(label);
    });
  }

  renderDiffTable() {
    const s = this.shadowRoot;
    const tbody = s.getElementById('diff-tbody');
    const emptyDiv = s.getElementById('empty-diff');
    const summary = s.getElementById('results-summary');

    const promotable = this.diffs.filter(d => d.status === 'diff' || d.status === 'new');
    const same       = this.diffs.filter(d => d.status === 'same');
    const noSrc      = this.diffs.filter(d => d.status === 'no-source');

    summary.textContent =
      `${this.diffs.length + this.noCiSvcs.length} service(s) checked — ` +
      `${promotable.length} with diff, ${same.length} in sync` +
      (noSrc.length + this.noCiSvcs.length > 0
        ? `, ${noSrc.length + this.noCiSvcs.length} excluded`
        : '');

    // ── Table 1: Excluded services ────────────────────────────────────────────
    // noCiSvcs items are already {name, reason} objects
    const excludedRows = [
      ...this.noCiSvcs,
      ...noSrc.map(d => ({
        name: d.svcName,
        reason: 'Artifact not present in source environment'
      }))
    ];

    const excludedSection = s.getElementById('excluded-section');
    const excludedTbody   = s.getElementById('excluded-tbody');
    const tablesDivider   = s.getElementById('tables-divider');
    if (excludedRows.length > 0) {
      excludedSection.style.display = 'block';
      excludedTbody.innerHTML = excludedRows.map(r => `
        <tr>
          <td style="font-weight:500;">${this.esc(r.name)}</td>
          <td style="color:#64748b;">${this.esc(r.reason)}</td>
        </tr>
      `).join('');
      if (tablesDivider) tablesDivider.style.display = 'block';
    } else {
      excludedSection.style.display = 'none';
      if (tablesDivider) tablesDivider.style.display = 'none';
    }

    // ── Table 2: Promotable services ──────────────────────────────────────────
    const promotableRows = this.diffs.filter(d => d.status !== 'no-source');
    emptyDiv.style.display = promotableRows.length === 0 ? 'block' : 'none';

    if (!promotableRows.length) { tbody.innerHTML = ''; this.updatePromoteBar(); return; }

    const sorted = [...promotableRows].sort((a, b) => {
      const o = { diff: 0, new: 1, same: 2 };
      return (o[a.status] ?? 9) - (o[b.status] ?? 9);
    });

    tbody.innerHTML = sorted.map(d => {
      const canPromote = (d.status === 'diff' || d.status === 'new') && d.ciId && d.srcArtifact?.id;
      const checked = this.selectedDiffs.has(d.svcName);
      const srcTag = this.artifactLabel(d.srcArtifact);
      const tgtTag = this.artifactLabel(d.tgtArtifact);
      const disabledTooltip = !canPromote
        ? (d.status === 'same'
            ? 'Source and target are already in sync — no promotion needed'
            : !d.ciId
            ? 'No CI integration linked for this service'
            : !d.srcArtifact?.id
            ? 'No artifact ID available in source'
            : 'Cannot promote this service')
        : '';

      return `
        <tr>
          <td>
            <input type="checkbox" class="row-check" data-svc="${this.esc(d.svcName)}"
              ${checked ? 'checked' : ''}
              ${!canPromote ? `disabled title="${this.esc(disabledTooltip)}"` : ''}>
          </td>
          <td style="font-weight:500;">${this.esc(d.svcName)}</td>
          <td>
            ${srcTag
              ? `<span class="tag src" title="${this.esc(srcTag)}">${this.esc(this.shorten(srcTag))}</span>`
              : `<span class="tag-na">—</span>`}
          </td>
          <td>
            ${tgtTag
              ? `<span class="tag tgt" title="${this.esc(tgtTag)}">${this.esc(this.shorten(tgtTag))}</span>`
              : `<span class="tag-na">—</span>`}
          </td>
          <td>${this.statusBadge(d.status)}</td>
        </tr>
      `;
    }).join('');

    // Wire up checkboxes
    tbody.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const svc = cb.dataset.svc;
        if (cb.checked) this.selectedDiffs.add(svc);
        else            this.selectedDiffs.delete(svc);
        this.updatePromoteBar();
        this.syncSelectAll();
      });
    });

    this.updatePromoteBar();
    this.syncSelectAll();
  }

  renderPromoteResults() {
    const s = this.shadowRoot;
    const panel = s.getElementById('promote-results');

    if (!this.promoteResults.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';

    const successCount = this.promoteResults.filter(r => r.ok).length;
    const failCount    = this.promoteResults.filter(r => !r.ok).length;

    panel.innerHTML = `
      <div class="alert ${failCount === 0 ? 'alert-success' : 'alert-warning'}" style="margin-bottom:10px;">
        ${successCount > 0 ? `✓ ${successCount} artifact(s) promoted` : ''}
        ${failCount > 0 ? `  ✗ ${failCount} failed` : ''}
      </div>
      ${this.promoteResults.map(r => `
        <div class="result-row">
          <span style="font-size:16px;">${r.ok ? '✅' : '❌'}</span>
          <span style="flex:1;font-weight:500;">${this.esc(r.svcName)}</span>
          <span style="font-size:12px;color:${r.ok ? 'var(--success)' : 'var(--danger)'};">${this.esc(r.msg)}</span>
        </div>
      `).join('')}
    `;
  }

  // ─── State Helpers ─────────────────────────────────────────────────────────

  updateTargetFromFlow() {
    const srcEnv = this.validEnvs.find(e => e.name === this.sourceEnv);
    if (!srcEnv) {
      this.targetEnv = '';
    } else {
      const nextEnv = this.validEnvs.find(e => e.sequence === srcEnv.sequence + 1);
      this.targetEnv = nextEnv ? nextEnv.name : '';
    }
    this.updateFlowHighlights();
  }

  validateForm() {
    const s = this.shadowRoot;
    const btn = s.getElementById('compare-btn');

    const srcEnv = this.validEnvs.find(e => e.name === this.sourceEnv);
    const tgtEnv = this.validEnvs.find(e => e.name === this.targetEnv);

    const envsOk = srcEnv && tgtEnv;

    if (envsOk && tgtEnv.sequence !== srcEnv.sequence + 1) {
      const expected = this.validEnvs.find(e => e.sequence === srcEnv.sequence + 1);
      const msg = expected
        ? `Invalid target. The next step after '${srcEnv.name}' in the promotion flow is '${expected.name}'.`
        : `'${srcEnv.name}' is the last environment in the promotion flow — nothing to promote to.`;
      this.showError(msg);
      btn.disabled = true;
      return;
    }
    this.clearError();

    const svcOk = this.serviceFilter === 'all' || this.selectedServiceNames.size > 0;
    btn.disabled = !(envsOk && svcOk);
  }

  toggleSelectAll(checked) {
    const tbody = this.shadowRoot.getElementById('diff-tbody');
    tbody.querySelectorAll('.row-check:not(:disabled)').forEach(cb => {
      cb.checked = checked;
      if (checked) this.selectedDiffs.add(cb.dataset.svc);
      else         this.selectedDiffs.delete(cb.dataset.svc);
    });
    this.updatePromoteBar();
  }

  syncSelectAll() {
    const cbs = [...this.shadowRoot.getElementById('diff-tbody').querySelectorAll('.row-check:not(:disabled)')];
    const allChk = cbs.length > 0 && cbs.every(c => c.checked);
    const someChk = cbs.some(c => c.checked);
    const sa = this.shadowRoot.getElementById('select-all');
    sa.checked = allChk;
    sa.indeterminate = !allChk && someChk;
  }

  updatePromoteBar() {
    const s = this.shadowRoot;
    const n = this.selectedDiffs.size;
    s.getElementById('sel-count').textContent = n;
    s.getElementById('promote-btn').disabled = n === 0;
    s.getElementById('promote-note').textContent = n > 0
      ? `${n} artifact(s) will be promoted: ${this.sourceEnv} → ${this.targetEnv}`
      : 'Select services to promote';
  }

  setLoading(on, msg) {
    const el = this.shadowRoot.getElementById('global-loading');
    el.classList.toggle('on', on);
    if (msg) this.shadowRoot.getElementById('loading-msg').textContent = msg;
  }

  showError(msg) {
    const el = this.shadowRoot.getElementById('global-error');
    el.innerHTML = `⚠ ${this.esc(msg)}`;
    el.style.display = 'flex';
  }

  clearError() {
    this.shadowRoot.getElementById('global-error').style.display = 'none';
  }

  showComparisonAlert(html, cls) {
    const el = this.shadowRoot.getElementById('comparison-alert');
    el.className = `alert ${cls}`;
    el.innerHTML = html;
    el.style.display = 'flex';
  }

  clearResults() {
    const s = this.shadowRoot;
    this.diffs = [];
    this.noCiSvcs = [];
    this.selectedDiffs.clear();
    this.promoteResults = [];
    s.getElementById('results-card').style.display = 'none';
    s.getElementById('diff-tbody').innerHTML = '';
    s.getElementById('excluded-tbody').innerHTML = '';
    s.getElementById('excluded-section').style.display = 'none';
    s.getElementById('promote-results').style.display = 'none';
  }

  resetEnvs() {
    const s = this.shadowRoot;
    this.validEnvs = [];
    this.sourceEnv = '';
    this.targetEnv = '';
    this.ciCdFlow = null;
    s.getElementById('env-flow-widget').style.display = 'none';
    s.getElementById('flow-nodes').innerHTML = '';
    s.getElementById('flow-pair-summary').style.display = 'none';
    s.getElementById('svc-divider').style.display = 'none';
    s.getElementById('compare-btn').disabled = true;
  }

  resetServices() {
    const s = this.shadowRoot;
    this.ciIntegrations = [];
    this.selectedServiceNames.clear();
    s.getElementById('svc-chips').innerHTML = '';
    s.getElementById('svc-chips').classList.remove('open');
    s.getElementById('filter-all').checked = true;
    this.serviceFilter = 'all';
  }

  // ─── Pure Helpers ──────────────────────────────────────────────────────────

  artifactLabel(artifact) {
    if (!artifact) return null;
    return artifact.artifactUri || artifact.tag || artifact.buildId || artifact.id || null;
  }

  shorten(str) {
    if (!str || str.length <= 32) return str;
    const parts = str.split(':');
    if (parts.length === 2 && parts[1].length <= 20) return str;
    return str.slice(0, 28) + '…';
  }

  statusBadge(status) {
    const map = {
      diff:       `<span class="badge badge-diff">Diff</span>`,
      new:        `<span class="badge badge-new">Diff</span>`,
      same:       `<span class="badge badge-same">No Diff</span>`,
      'no-source':`<span class="badge badge-missing">Not in source</span>`
    };
    return map[status] || `<span class="badge">${status}</span>`;
  }

  esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

customElements.define('artifact-promoter', ArtifactPromoter);
