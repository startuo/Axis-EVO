"""Desktop entry point launched by Axis-Evo.exe with redirected standard streams."""
import os
from pathlib import Path
import sys

from .agent_workspace import serve


def main():
    if os.name != 'nt' or len(sys.argv) != 2:
        raise SystemExit('Windows Preview requires the per-user application directory')
    state = Path(sys.argv[1])
    network = state / 'network.json'
    assets = Path(__file__).resolve().parents[1] / 'web' / 'dist'
    serve(state / 'data', network if network.exists() else None, 0, assets, desktop=True)


if __name__ == '__main__':
    main()
