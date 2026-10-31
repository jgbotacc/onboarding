"""Run .cypher files against Neo4j over the HTTPS Query API (env NEO4J_*).
Usage: load_neo4j.py file.cypher ...   or   load_neo4j.py --query "CYPHER" key=value ..."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.data.neo4j_store import Neo4jStore  # noqa: E402


def statements(path):
    text = re.sub(r"^\s*//.*$", "", open(path).read(), flags=re.M)
    return [s.strip() for s in text.split(";") if s.strip()]


def main(args):
    st = Neo4jStore(os.environ["NEO4J_URI"], os.environ["NEO4J_USERNAME"], os.environ["NEO4J_PASSWORD"])
    if args[0] == "--query":
        params = dict(a.split("=", 1) for a in args[2:])
        for row in st._run(args[1], **params):
            print(row)
        return
    for f in args:
        for s in statements(f):
            st._run(s)
        print(f"ran {f}")


if __name__ == "__main__":
    main(sys.argv[1:])
