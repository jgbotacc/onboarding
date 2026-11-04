"""Deploy to a Daytona sandbox. Reads DAYTONA_API_KEY (+ optional NEO4J_*, GEMINI_API_KEY) from env.
Reuses the sandbox id in .daytona_sandbox if present. Never prints secret values."""
import io
import os
import tarfile
import time
from pathlib import Path

from daytona import CreateSandboxFromSnapshotParams, Daytona, DaytonaConfig, SessionExecuteRequest

ROOT = Path(__file__).resolve().parents[1]
ID_FILE = ROOT / ".daytona_sandbox"
PORT = 8000
SKIP = {".git", "var", "node_modules", "__pycache__", ".env", ".daytona_sandbox", ".pytest_cache"}
APP_ENV = ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "GEMINI_API_KEY", "GEMINI_IMAGE_MODEL", "OPENAI_API_KEY", "MODEL_API_KEY", "IMAGE_PROVIDER", "CHAT_PROVIDER", "BASETEN_API_KEY", "BASETEN_BASE_URL", "BASETEN_MODEL", "PUBLIC_BASE_URL",
           "RELAY_URL", "RELAY_SECRET", "STAFF_PASSCODE", "DESIGNER_PASSCODE", "DISABLE_DOCS", "ONBOARDING_NOTIFY_EMAIL"]
# RESEND_API_KEY is deliberately not passed: the sandbox cannot reach api.resend.com, outbox is used there.


def bundle() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(ROOT, arcname="app", filter=lambda ti: None if set(Path(ti.name).parts) & SKIP else ti)
    return buf.getvalue()


def run(sb, cmd, timeout=600):
    r = sb.process.exec(cmd, timeout=timeout)
    print(f"$ {cmd[:80]} -> exit {r.exit_code}")
    if r.exit_code:
        print(r.result[-1500:])
    return r


def main():
    d = Daytona(DaytonaConfig(api_key=os.environ["DAYTONA_API_KEY"],
                              api_url=os.getenv("DAYTONA_API_URL", "https://app.daytona.io/api")))
    env = {k: os.environ[k] for k in APP_ENV if os.getenv(k)}
    sb = None
    if ID_FILE.exists():
        try:
            sb = d.get(ID_FILE.read_text().strip())
            if sb.state != "started":
                sb.start()
        except Exception as e:
            print(f"Existing sandbox unusable ({e}); creating new")
            sb = None
    if sb is None:
        sb = d.create(CreateSandboxFromSnapshotParams(name="onboarding-agent", language="python", public=True,
                                                      auto_stop_interval=0, env_vars=env,
                                                      labels={"app": "onboarding-agent"}), timeout=180)
        ID_FILE.write_text(sb.id)
    print("sandbox id:", sb.id)
    home = sb.get_user_home_dir()
    sb.fs.upload_file(bundle(), f"{home}/app.tgz")
    run(sb, f"cd {home} && rm -rf app/src app/web && tar xzf app.tgz")
    run(sb, f"cd {home}/app && pip install -q -r requirements.txt", 900)
    web = f"{home}/app/web"
    if run(sb, f"test -f {web}/package.json && test ! -f {web}/dist/index.html").exit_code == 0:
        run(sb, f"cd {web} && (npm ci || npm install) && npm run build", 900)
    run(sb, "pkill -f 'uvicorn src.app' || true")
    try:
        sb.process.create_session("web")
    except Exception:
        pass
    env.setdefault("PUBLIC_BASE_URL", sb.get_preview_link(PORT).url)
    env.setdefault("DISABLE_DOCS", "1")  # no /docs, /redoc or /openapi.json on the public sandbox
    if not env.get("STAFF_PASSCODE"):
        print("WARNING: STAFF_PASSCODE not set; staff pages will answer 503 (fail closed)")
    if not env.get("ONBOARDING_NOTIFY_EMAIL"):
        print("WARNING: ONBOARDING_NOTIFY_EMAIL not set; staff-decision emails stay in the outbox")
    envs = " ".join(f"{k}='{v}'" for k, v in env.items())
    sb.process.execute_session_command("web", SessionExecuteRequest(
        command=f"cd {home}/app && {envs} nohup python -m uvicorn src.app:app --host 0.0.0.0 --port {PORT} "
                f"> {home}/uvicorn.log 2>&1 &", run_async=True))
    time.sleep(6)
    r = run(sb, f"curl -s localhost:{PORT}/api/health")
    print("health:", r.result.strip())
    print("preview url:", sb.get_preview_link(PORT).url)


if __name__ == "__main__":
    main()
