"""agent-wire-docling CLI (awd).

Hits the running HTTP surface (default http://localhost:8000). Every UI
operation has a CLI equivalent so agents + humans can drive the prototype
without a browser.

Usage:
    uv run awd doctor
    uv run awd health
    uv run awd scan /absolute/path
    uv run awd sample <scan_id> --n 5
    uv run awd convert <source> <output_dir>
    uv run awd batch <scan_id> <output_dir> --stratum name=pipeline.json
    uv run awd manifest <output_dir>
    uv run awd export <output_dir> <destination> [--kind manifest_only]
    uv run awd taste new <scan_id> <output_dir>
    uv run awd taste get <session_id>
    uv run awd taste approve <session_id> --stratum X --hash Y --status approved
    uv run awd taste lock <session_id> --stratum X
    uv run awd fs-list [path]
    uv run awd end-to-end /absolute/path      # full flow against a folder
"""

from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Annotated, Any

import httpx
import typer

app = typer.Typer(no_args_is_help=True, add_completion=False)
taste_app = typer.Typer(no_args_is_help=True, help="Taste session operations")
app.add_typer(taste_app, name="taste")

DEFAULT_URL = "http://localhost:8000"


def _client(url: str, timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(base_url=url, timeout=timeout)


def _die(msg: str, code: int = 1) -> None:
    typer.echo(f"error: {msg}", err=True)
    raise typer.Exit(code)


def _print_json(data: Any) -> None:
    typer.echo(json.dumps(data, indent=2, default=str))


def _api_or_die(resp: httpx.Response) -> Any:
    if resp.status_code >= 400:
        try:
            body = resp.json()
            detail = body.get("detail") or body.get("message") or str(body)
        except Exception:
            detail = resp.text
        _die(f"{resp.status_code} {resp.request.method} {resp.request.url.path}: {detail}")
    if resp.headers.get("content-type", "").startswith("application/json"):
        return resp.json()
    return resp.text


# ─── Top-level commands ───────────────────────────────────────────────────


@app.command()
def doctor() -> None:
    """Check native deps and backend reachability."""
    typer.echo("── agent-wire-docling doctor ──")

    # Native tools
    for tool in ("tesseract", "pdfinfo", "pdftotext"):
        path = shutil.which(tool)
        status = f"✓ {path}" if path else "✗ MISSING"
        typer.echo(f"  {tool:<12} {status}")

    # Docling
    try:
        from importlib.metadata import version
        dv = version("docling")
        typer.echo(f"  docling      ✓ {dv}")
    except Exception as e:
        typer.echo(f"  docling      ✗ {e}")

    # Backend
    try:
        with _client(DEFAULT_URL, timeout=3) as c:
            r = c.get("/health")
            h = r.json() if r.status_code == 200 else {"status": "bad_response"}
        typer.echo(f"  backend      ✓ {DEFAULT_URL} — status={h.get('status')}")
    except Exception as e:
        typer.echo(f"  backend      ✗ {DEFAULT_URL} — {type(e).__name__}: {e}")


@app.command()
def health(url: str = DEFAULT_URL) -> None:
    """GET /health."""
    with _client(url) as c:
        _print_json(_api_or_die(c.get("/health")))


@app.command("fs-list")
def fs_list(
    path: Annotated[str | None, typer.Argument()] = None,
    url: str = DEFAULT_URL,
) -> None:
    """List directories under a path (or $HOME)."""
    params = {"path": path} if path else {}
    with _client(url) as c:
        r = c.get("/fs/list", params=params)
        _print_json(_api_or_die(r))


@app.command()
def scan(
    folder: str,
    url: str = DEFAULT_URL,
    follow_symlinks: bool = False,
    max_files: int = 50_000,
    quiet: bool = typer.Option(False, help="Print only scan_id"),
) -> None:
    """POST /scan — folder walk + stratification."""
    folder = str(Path(folder).expanduser().resolve())
    payload = {"folder": folder, "follow_symlinks": follow_symlinks, "max_files": max_files}
    with _client(url, timeout=120) as c:
        result = _api_or_die(c.post("/scan", json=payload))
    if quiet:
        typer.echo(result["scan_id"])
        return
    typer.echo(f"scan_id: {result['scan_id']}")
    typer.echo(f"folder:  {result['folder']}")
    typer.echo(f"files:   {result['total_files']} · skipped: {len(result.get('skipped', []))}")
    typer.echo("strata:")
    for s in result["strata"]:
        typer.echo(
            f"  {s['name']:<22} size={s['size']:>4}  "
            f"exhaustive={s.get('exhaustive', False)}"
        )


@app.command()
def sample(
    scan_id: str,
    n: int = 5,
    seed: int | None = None,
    url: str = DEFAULT_URL,
) -> None:
    """POST /strata/sample — stratified picks."""
    payload: dict[str, Any] = {"scan_id": scan_id, "n": n}
    if seed is not None:
        payload["seed"] = seed
    with _client(url) as c:
        _print_json(_api_or_die(c.post("/strata/sample", json=payload)))


@app.command()
def convert(
    source: str,
    output_dir: str,
    pipeline: Annotated[str | None, typer.Option(help="Path to pipeline JSON or inline JSON")] = None,
    url: str = DEFAULT_URL,
) -> None:
    """POST /convert — single-doc conversion."""
    source = str(Path(source).expanduser().resolve())
    output_dir = str(Path(output_dir).expanduser().resolve())
    payload: dict[str, Any] = {"source_path": source, "output_dir": output_dir}
    if pipeline:
        payload["pipeline"] = _load_json(pipeline)
    with _client(url, timeout=600) as c:
        _print_json(_api_or_die(c.post("/convert", json=payload)))


@app.command()
def batch(
    output_dir: str,
    root: Annotated[str | None, typer.Option("--root", help="Filemap root; walks .understanding/folder.yaml under it")] = None,
    scan_id: Annotated[str | None, typer.Option("--scan-id", help="Legacy scan_id mode")] = None,
    stratum_pipeline: Annotated[
        list[str] | None,
        typer.Option("--stratum", help="Legacy: per-stratum pipeline 'name=default|path.json'"),
    ] = None,
    pipeline_by_content_type: Annotated[
        list[str] | None,
        typer.Option("--pipeline-by-content-type", help="'pdf=path.json' (repeatable)"),
    ] = None,
    pipeline_by_stratum: Annotated[
        list[str] | None,
        typer.Option("--pipeline-by-stratum", help="'pdf-native-1-10=path.json' (repeatable)"),
    ] = None,
    concurrency: int = 2,
    wait: bool = typer.Option(True, help="Poll job until complete"),
    url: str = DEFAULT_URL,
) -> None:
    """POST /batch — filemap mode (--root) or legacy stratum mode (--scan-id)."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    payload: dict[str, Any] = {"output_dir": output_dir, "concurrency": concurrency}

    if root:
        payload["root"] = str(Path(root).expanduser().resolve())
        if pipeline_by_content_type:
            d = {}
            for spec in pipeline_by_content_type:
                if "=" not in spec:
                    _die(f"--pipeline-by-content-type expected 'ct=path.json', got: {spec}")
                k, v = spec.split("=", 1)
                d[k.strip()] = {} if v == "default" else _load_json(v)
            payload["pipeline_by_content_type"] = d
        if pipeline_by_stratum:
            d = {}
            for spec in pipeline_by_stratum:
                if "=" not in spec:
                    _die(f"--pipeline-by-stratum expected 'name=path.json', got: {spec}")
                k, v = spec.split("=", 1)
                d[k.strip()] = {} if v == "default" else _load_json(v)
            payload["pipeline_by_stratum"] = d
    else:
        if not scan_id:
            _die("provide either --root (filemap mode) or --scan-id (legacy mode)")
        sp = []
        for spec in stratum_pipeline or []:
            if "=" not in spec:
                _die(f"--stratum expected 'name=default|path.json', got: {spec}")
            name, rhs = spec.split("=", 1)
            pipe = {} if rhs == "default" else _load_json(rhs)
            sp.append({"stratum": name.strip(), "pipeline": pipe})
        if not sp:
            _die("legacy mode: provide at least one --stratum NAME=default|path.json")
        payload["scan_id"] = scan_id
        payload["stratum_pipelines"] = sp
    with _client(url, timeout=10) as c:
        job = _api_or_die(c.post("/batch", json=payload))
    typer.echo(f"job_id: {job['id']}  status: {job['status']}  docs_total: {job['progress'].get('docs_total')}")
    if not wait:
        return

    # Poll
    with _client(url, timeout=10) as c:
        while True:
            j = _api_or_die(c.get(f"/jobs/{job['id']}"))
            p = j.get("progress", {})
            typer.echo(
                f"  status={j['status']:<10}  done={p.get('docs_done',0)}/{p.get('docs_total',0)}"
                f"  failed={p.get('docs_failed',0)}",
                nl=True,
            )
            if j["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(1.0)
    _print_json(j)


@app.command()
def manifest(output_dir: str, url: str = DEFAULT_URL) -> None:
    """GET /manifest?output_dir=..."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    with _client(url) as c:
        _print_json(_api_or_die(c.get("/manifest", params={"output_dir": output_dir})))


@app.command()
def export(
    output_dir: str,
    destination: str,
    kind: str = typer.Option(
        "manifest_only",
        "--kind",
        help="manifest_only | manifest_plus_md | full_archive",
    ),
    wait: bool = True,
    url: str = DEFAULT_URL,
) -> None:
    """POST /export — start an export job."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    destination = str(Path(destination).expanduser().resolve())
    payload = {"output_dir": output_dir, "kind": kind, "destination": destination}
    with _client(url) as c:
        job = _api_or_die(c.post("/export", json=payload))
    typer.echo(f"export job: {job['id']}  status: {job['status']}")
    if not wait:
        return
    with _client(url) as c:
        while True:
            j = _api_or_die(c.get(f"/exports/{job['id']}"))
            if j["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(0.5)
    _print_json(j)


# ─── Taste subcommands ───────────────────────────────────────────────────


@taste_app.command("new")
def taste_new(scan_id: str, output_dir: str, url: str = DEFAULT_URL) -> None:
    """POST /taste_sessions."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    payload = {"scan_id": scan_id, "output_dir": output_dir}
    with _client(url) as c:
        _print_json(_api_or_die(c.post("/taste_sessions", json=payload)))


@taste_app.command("get")
def taste_get(session_id: str, url: str = DEFAULT_URL) -> None:
    """GET /taste_sessions/{id}."""
    with _client(url) as c:
        _print_json(_api_or_die(c.get(f"/taste_sessions/{session_id}")))


@taste_app.command("approve")
def taste_approve(
    session_id: str,
    stratum: str = typer.Option(...),
    source_sha256: str = typer.Option(..., "--hash"),
    pipeline_hash: str = typer.Option("default", "--pipeline-hash"),
    status: str = typer.Option("approved", help="approved|rejected|skipped|flagged"),
    notes: str | None = None,
    url: str = DEFAULT_URL,
) -> None:
    """PATCH /taste_sessions/{id} with an approval sub-patch."""
    import datetime as dt
    with _client(url) as c:
        sess = _api_or_die(c.get(f"/taste_sessions/{session_id}"))
        version = sess.get("version", 0)
        patch = {
            "version": version,
            "approval": {
                "stratum": stratum,
                "approval": {
                    "source_sha256": source_sha256,
                    "pipeline_hash": pipeline_hash,
                    "status": status,
                    "notes": notes,
                    "reviewed_at": dt.datetime.now(dt.UTC).isoformat(),
                },
            },
        }
        _print_json(_api_or_die(c.patch(f"/taste_sessions/{session_id}", json=patch)))


@taste_app.command("lock")
def taste_lock(
    session_id: str,
    stratum: str = typer.Option(...),
    unlock: bool = typer.Option(False, help="Unlock instead of lock"),
    url: str = DEFAULT_URL,
) -> None:
    """PATCH /taste_sessions/{id} lock_stratum sub-patch."""
    with _client(url) as c:
        sess = _api_or_die(c.get(f"/taste_sessions/{session_id}"))
        version = sess.get("version", 0)
        patch = {
            "version": version,
            "lock_stratum": {"stratum": stratum, "locked": not unlock},
        }
        _print_json(_api_or_die(c.patch(f"/taste_sessions/{session_id}", json=patch)))


@taste_app.command("pipeline")
def taste_pipeline(
    session_id: str,
    stratum: str = typer.Option(...),
    pipeline: str = typer.Option("default", help="'default' or path to JSON"),
    url: str = DEFAULT_URL,
) -> None:
    """Set a stratum's pipeline (PATCH pipeline_assignment)."""
    pipe = {} if pipeline == "default" else _load_json(pipeline)
    with _client(url) as c:
        sess = _api_or_die(c.get(f"/taste_sessions/{session_id}"))
        version = sess.get("version", 0)
        patch = {
            "version": version,
            "pipeline_assignment": {"stratum": stratum, "pipeline": pipe},
        }
        _print_json(_api_or_die(c.patch(f"/taste_sessions/{session_id}", json=patch)))


# ─── Filemap / filetree / triage (Level B) ───────────────────────────────


@app.command()
def filemap(folder: str, url: str = DEFAULT_URL) -> None:
    """GET /filemap?folder=..."""
    folder = str(Path(folder).expanduser().resolve())
    with _client(url) as c:
        _print_json(_api_or_die(c.get("/filemap", params={"folder": folder})))


@app.command()
def filetree(root: str, url: str = DEFAULT_URL) -> None:
    """GET /filetree?root=..."""
    root = str(Path(root).expanduser().resolve())
    with _client(url) as c:
        _print_json(_api_or_die(c.get("/filetree", params={"root": root})))


@app.command()
def triage(output_dir: str, url: str = DEFAULT_URL) -> None:
    """GET /triage?output_dir=..."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    with _client(url) as c:
        _print_json(_api_or_die(c.get("/triage", params={"output_dir": output_dir})))


@app.command("retry-triage")
def retry_triage(output_dir: str, url: str = DEFAULT_URL) -> None:
    """POST /triage/retry — applies user edits to triage.yaml."""
    output_dir = str(Path(output_dir).expanduser().resolve())
    with _client(url, timeout=600) as c:
        _print_json(_api_or_die(c.post("/triage/retry", json={"output_dir": output_dir})))


# ─── End-to-end convenience ──────────────────────────────────────────────


@app.command("end-to-end")
def end_to_end(
    folder: str,
    output_dir: Annotated[str | None, typer.Option("--output-dir")] = None,
    url: str = DEFAULT_URL,
) -> None:
    """Level B: scan (emits filemaps) → batch from filemaps → manifest."""
    folder = str(Path(folder).expanduser().resolve())
    output_dir = str(Path(output_dir or f"{folder}/.docling-out").expanduser().resolve())

    typer.echo(f"▸ scan {folder}")
    with _client(url, timeout=120) as c:
        scan_res = _api_or_die(c.post("/scan", json={"folder": folder}))
    typer.echo(
        f"  files={scan_res['total_files']}  strata={len(scan_res['strata'])}  "
        f"folders_with_filemaps={scan_res.get('folders_with_filemaps', 0)}"
    )

    typer.echo("▸ start batch (filemap mode)")
    with _client(url, timeout=10) as c:
        job = _api_or_die(
            c.post(
                "/batch",
                json={
                    "root": folder,
                    "output_dir": output_dir,
                    "concurrency": 2,
                },
            )
        )
    typer.echo(f"  job_id={job['id']}  docs_total={job.get('progress', {}).get('docs_total', 0)}")

    with _client(url, timeout=10) as c:
        while True:
            j = _api_or_die(c.get(f"/jobs/{job['id']}"))
            p = j.get("progress", {})
            typer.echo(
                f"  status={j['status']}  done={p.get('docs_done',0)}/{p.get('docs_total',0)}"
            )
            if j["status"] in ("completed", "failed", "cancelled"):
                break
            time.sleep(1.0)

    typer.echo("▸ manifest")
    with _client(url) as c:
        mf = _api_or_die(c.get("/manifest", params={"output_dir": output_dir}))
    typer.echo(f"  {len(mf.get('docs', []))} docs in manifest at {output_dir}/manifest.yaml")
    typer.echo(f"\ndone. output_dir={output_dir}")


# ─── Helpers ─────────────────────────────────────────────────────────────


def _load_json(spec: str) -> Any:
    """Load JSON from a file path or inline string."""
    p = Path(spec).expanduser()
    if p.exists() and p.is_file():
        return json.loads(p.read_text())
    try:
        return json.loads(spec)
    except json.JSONDecodeError as e:
        _die(f"could not parse as JSON file or inline JSON: {spec} ({e})")


if __name__ == "__main__":
    app()
