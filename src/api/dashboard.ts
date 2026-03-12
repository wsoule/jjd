/**
 * Self-contained HTML dashboard for the jjd API server.
 * Served at GET / — polls the local API every 2s to show live status.
 * All dynamic content is HTML-escaped before insertion.
 */
export function dashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>jjd</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #21262d; --border2: #30363d;
      --text: #e6edf3; --muted: #7d8590;
      --green: #3fb950; --yellow: #d29922; --blue: #388bfd;
      --purple: #a371f7; --red: #f85149; --red-bg: #3d1a19;
    }
    body {
      background: var(--bg); color: var(--text);
      font-family: 'SF Mono','Fira Code','Cascadia Code',monospace;
      font-size: 13px; line-height: 1.5;
      padding: 28px 32px; max-width: 760px;
    }
    header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 28px; }
    header h1 { font-size: 15px; font-weight: 600; letter-spacing: .02em; }
    header .port { color: var(--muted); font-size: 12px; }

    .state-bar {
      display: flex; align-items: center; gap: 10px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .dot.idle       { background: var(--green); }
    .dot.debouncing { background: var(--yellow); }
    .dot.describing { background: var(--blue);   animation: pulse 1.2s ease-in-out infinite; }
    .dot.pushing    { background: var(--purple); animation: pulse 1.2s ease-in-out infinite; }
    .dot.error      { background: var(--red); }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    .state-label { font-weight: 600; font-size: 13px; min-width: 90px; }
    .state-meta  { color: var(--muted); font-size: 12px; margin-left: auto; text-align: right; }

    .error-banner {
      background: var(--red-bg); border: 1px solid var(--red);
      border-radius: 6px; padding: 10px 14px;
      color: var(--red); font-size: 12px; margin-bottom: 16px;
    }
    .section { margin-bottom: 24px; }
    .section-title {
      color: var(--muted); font-size: 10px; text-transform: uppercase;
      letter-spacing: .08em; margin-bottom: 10px;
      padding-bottom: 6px; border-bottom: 1px solid var(--border);
    }
    .activity-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; padding: 12px 14px;
    }
    .commit-msg  { color: #79c0ff; margin-bottom: 5px; word-break: break-all; }
    .commit-meta { color: var(--muted); font-size: 11px; }

    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button {
      background: var(--surface); color: var(--text);
      border: 1px solid var(--border2); border-radius: 6px;
      padding: 6px 14px; font-family: inherit; font-size: 12px;
      cursor: pointer; transition: background .12s, border-color .12s;
    }
    button:hover  { background: var(--border2); }
    button:active { opacity: .8; }
    button.primary { background: #238636; border-color: #2ea043; }
    button.primary:hover { background: #2ea043; }
    button.danger  { border-color: var(--red); color: var(--red); }
    button.danger:hover { background: var(--red-bg); }

    .cp-list { display: flex; flex-direction: column; }
    .cp-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid var(--border);
    }
    .cp-row:last-child { border-bottom: none; }
    .cp-id   { color: var(--muted); width: 28px; flex-shrink: 0; font-size: 12px; }
    .cp-desc { flex: 1; }
    .cp-time { color: var(--muted); font-size: 11px; flex-shrink: 0; width: 72px; text-align: right; }

    .repo-grid {
      display: grid; grid-template-columns: 90px 1fr; gap: 6px 12px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; padding: 12px 14px;
    }
    .repo-key { color: var(--muted); }
    .repo-val { word-break: break-all; }
    .muted { color: var(--muted); font-size: 12px; }
    .refresh {
      position: fixed; top: 14px; right: 20px;
      color: var(--muted); font-size: 11px;
      opacity: 0; transition: opacity .3s;
    }
    .refresh.show { opacity: 1; }
  </style>
</head>
<body>
  <header>
    <h1>jjd</h1>
    <span class="port">:${port}</span>
  </header>
  <div id="app"><p class="muted">Connecting\u2026</p></div>
  <span class="refresh" id="refresh">\u21bb</span>

  <script>
    function esc(s) {
      return String(s ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function timeAgo(iso) {
      if (!iso) return '\u2014';
      const s = (Date.now() - new Date(iso).getTime()) / 1000;
      if (s < 5)    return 'just now';
      if (s < 60)   return Math.round(s) + 's ago';
      if (s < 3600) return Math.round(s / 60) + 'm ago';
      return Math.round(s / 3600) + 'h ago';
    }

    async function api(method, path, body) {
      const r = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return r.json();
    }

    function buildCheckpointRow(cp) {
      const row = document.createElement('div');
      row.className = 'cp-row';

      const id   = document.createElement('span'); id.className = 'cp-id';   id.textContent = '#' + cp.id;
      const desc = document.createElement('span'); desc.className = 'cp-desc'; desc.textContent = cp.description || '(no description)';
      const time = document.createElement('span'); time.className = 'cp-time'; time.textContent = timeAgo(cp.createdAt);
      const btn  = document.createElement('button'); btn.className = 'danger'; btn.textContent = 'Rollback';
      btn.onclick = () => doRollback(cp.id);

      row.append(id, desc, time, btn);
      return row;
    }

    async function render() {
      let status, cps;
      try {
        [status, cps] = await Promise.all([
          api('GET', '/status'),
          api('GET', '/checkpoints'),
        ]);
      } catch {
        document.getElementById('app').textContent = 'Daemon not reachable';
        return;
      }

      flash();
      const { daemon, repo } = status;
      const app = document.getElementById('app');
      app.innerHTML = '';

      const stateColors = {
        idle: 'var(--green)', debouncing: 'var(--yellow)',
        describing: 'var(--blue)', pushing: 'var(--purple)', error: 'var(--red)',
      };

      // ── State bar ──────────────────────────────────────────────────────────
      const bar = document.createElement('div'); bar.className = 'state-bar';
      const dot = document.createElement('div'); dot.className = 'dot ' + daemon.state;
      const label = document.createElement('span'); label.className = 'state-label';
      label.style.color = stateColors[daemon.state] ?? 'var(--muted)';
      label.textContent = daemon.state;
      bar.append(dot, label);
      if (repo) {
        const meta = document.createElement('span'); meta.className = 'state-meta';
        meta.textContent = (repo.bookmarks?.join(', ') || '(no bookmark)')
          + '  \u00b7  ' + repo.fileChanges + ' file' + (repo.fileChanges !== 1 ? 's' : '') + ' changed';
        bar.append(meta);
      }
      app.append(bar);

      // ── Error banner ───────────────────────────────────────────────────────
      if (daemon.error) {
        const err = document.createElement('div'); err.className = 'error-banner';
        err.textContent = '\u26a0 ' + daemon.error;
        app.append(err);
      }

      // ── Last activity ──────────────────────────────────────────────────────
      const actSection = document.createElement('div'); actSection.className = 'section';
      const actTitle = document.createElement('div'); actTitle.className = 'section-title';
      actTitle.textContent = 'Last activity';
      actSection.append(actTitle);
      if (daemon.lastDescribe) {
        const card = document.createElement('div'); card.className = 'activity-card';
        const msg = document.createElement('div'); msg.className = 'commit-msg';
        msg.textContent = repo?.description || '(no description)';
        const meta = document.createElement('div'); meta.className = 'commit-meta';
        meta.textContent = 'described ' + timeAgo(daemon.lastDescribe)
          + (daemon.lastPush ? '  \u00b7  pushed ' + timeAgo(daemon.lastPush) : '');
        card.append(msg, meta);
        actSection.append(card);
      } else {
        const p = document.createElement('p'); p.className = 'muted';
        p.textContent = 'No describes yet this session';
        actSection.append(p);
      }
      app.append(actSection);

      // ── Actions ────────────────────────────────────────────────────────────
      const actionsSection = document.createElement('div'); actionsSection.className = 'section';
      const actionsTitle = document.createElement('div'); actionsTitle.className = 'section-title';
      actionsTitle.textContent = 'Actions';
      const actionsRow = document.createElement('div'); actionsRow.className = 'actions';

      const btnDescribe = document.createElement('button'); btnDescribe.className = 'primary';
      btnDescribe.textContent = 'Describe now';
      btnDescribe.onclick = () => act('POST', '/describe');

      const btnPush = document.createElement('button');
      btnPush.textContent = 'Push now';
      btnPush.onclick = () => act('POST', '/push');

      const btnCp = document.createElement('button');
      btnCp.textContent = '+ Checkpoint';
      btnCp.onclick = doCheckpoint;

      const btnStop = document.createElement('button'); btnStop.className = 'danger';
      btnStop.textContent = 'Stop daemon';
      btnStop.onclick = doStop;

      actionsRow.append(btnDescribe, btnPush, btnCp, btnStop);
      actionsSection.append(actionsTitle, actionsRow);
      app.append(actionsSection);

      // ── Checkpoints ────────────────────────────────────────────────────────
      const cpSection = document.createElement('div'); cpSection.className = 'section';
      const cpTitle = document.createElement('div'); cpTitle.className = 'section-title';
      const list = cps.checkpoints ?? [];
      cpTitle.textContent = 'Checkpoints (' + list.length + ')';
      cpSection.append(cpTitle);
      if (list.length === 0) {
        const p = document.createElement('p'); p.className = 'muted';
        p.textContent = 'No checkpoints yet';
        cpSection.append(p);
      } else {
        const cpList = document.createElement('div'); cpList.className = 'cp-list';
        list.forEach(cp => cpList.append(buildCheckpointRow(cp)));
        cpSection.append(cpList);
      }
      app.append(cpSection);

      // ── Repo info ──────────────────────────────────────────────────────────
      if (repo) {
        const repoSection = document.createElement('div'); repoSection.className = 'section';
        const repoTitle = document.createElement('div'); repoTitle.className = 'section-title';
        repoTitle.textContent = 'Repo';
        const grid = document.createElement('div'); grid.className = 'repo-grid';

        function row(key, val, color) {
          const k = document.createElement('span'); k.className = 'repo-key'; k.textContent = key;
          const v = document.createElement('span'); v.className = 'repo-val'; v.textContent = val;
          if (color) v.style.color = color;
          grid.append(k, v);
        }
        row('change',    repo.changeId?.slice(0, 16) || '\u2014');
        row('bookmarks', repo.bookmarks?.join(', ')  || '(none)');
        row('conflicts', repo.hasConflicts ? 'yes' : 'no',
            repo.hasConflicts ? 'var(--red)' : 'var(--green)');

        repoSection.append(repoTitle, grid);
        app.append(repoSection);
      }
    }

    async function act(method, path, body) {
      await api(method, path, body).catch(console.error);
      render();
    }

    async function doCheckpoint() {
      const desc = prompt('Checkpoint description (optional):');
      if (desc === null) return;
      await act('POST', '/checkpoint', { description: desc });
    }

    async function doRollback(id) {
      if (!confirm('Rollback to checkpoint #' + id + '?')) return;
      await act('POST', '/rollback/' + id);
    }

    async function doStop() {
      if (!confirm('Stop the jjd daemon?')) return;
      await act('POST', '/stop');
    }

    function flash() {
      const el = document.getElementById('refresh');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 400);
    }

    render();
    setInterval(render, 2000);
  </script>
</body>
</html>`;
}
