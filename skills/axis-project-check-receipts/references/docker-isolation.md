# Optional Docker isolation

Use a trusted Linux image already present on a local Docker engine. Choose an image with the needed tools and no declared volumes. The runner uses the installed image and supplies the check command directly.

```text
python run_project_check.py --project ./example --name isolated-tests --docker-image python:3.12-slim --timeout 60 -- python -B -m unittest discover -s tests
```

The runner stages the same filtered files it hashes. It copies that directory into a stopped container and creates a temporary local image from the copy. The check then runs with `--network=none`, `--pull=never`, a read-only root filesystem, and no host bind mounts. It has a bounded writable temporary filesystem and runs as a non-root user with capabilities dropped. The working directory is the copied project. Use checks that can read the project without writing to it. Put disposable writes in the temporary directory.

The check time limit starts when the runner attaches to the check container. Docker setup and cleanup calls have their own time limits. The runner verifies the exit using the container state. If it cannot confirm the outcome, it records `UNKNOWN`. When the time limit is reached, it attempts to remove the container and records `TIMED_OUT` if removal succeeds. Cleanup issues are included in the JSON result. Review any remaining run-specific containers or images named in that result after an interruption.

Only include project files suitable for copying to the selected local engine. The temporary image contains the included project files until cleanup. Checks using the engine must have permission to create and remove these temporary objects.
