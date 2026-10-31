"""Run a command in the deployed Daytona sandbox with NEO4J_* env passed through. Never prints secrets."""
import os
import sys
from pathlib import Path

from daytona import Daytona, DaytonaConfig

ROOT = Path(__file__).resolve().parents[1]
d = Daytona(DaytonaConfig(api_key=os.environ["DAYTONA_API_KEY"],
                          api_url=os.getenv("DAYTONA_API_URL", "https://app.daytona.io/api")))
sb = d.get((ROOT / ".daytona_sandbox").read_text().strip())
env = {k: v for k, v in os.environ.items() if k.startswith("NEO4J_")}
r = sb.process.exec(f"cd {sb.get_user_home_dir()}/app && {sys.argv[1]}", env=env, timeout=300)
print(f"exit {r.exit_code}\n{r.result[-3000:]}")
