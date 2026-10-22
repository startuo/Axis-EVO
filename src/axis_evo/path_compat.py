"""Keep the interpreter's Windows name rules without the 3.13 deprecated API."""
import ntpath
from pathlib import PureWindowsPath


def windows_component_is_reserved(value):
    path = PureWindowsPath(value)
    check = getattr(ntpath, 'isreserved', None)
    if check is not None:
        return check(path)
    # Python 3.11/3.12 have the original narrower rules and no deprecation.
    return path.is_reserved()
