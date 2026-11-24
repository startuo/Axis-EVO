"""Minimal environment for product workers, including Windows OS paths."""
import os

from axis_evo.process_limits import child_environment as core_child_environment


def child_environment():
    environment = core_child_environment()
    if os.name == 'nt':
        # Some launcher environments provide only SystemRoot. Path consumers
        # must not fall back to literal, unexpanded Windows variables.
        environment.setdefault('WINDIR', environment['SYSTEMROOT'])
    return environment
