"""Build the x64 preview installer with pinned CPython, wheels and NSIS."""
from argparse import ArgumentParser
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from time import perf_counter
from urllib.request import urlopen
from zipfile import ZipFile


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PYTHON = (
    'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip',
    '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38',
)
NSIS = (
    'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11.zip',
    'c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1',
)
PRODUCT = 'Axis-Evo-0.1.0-Preview-M7.1-Setup.exe'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def npm_installation(web):
    return {
        'packageSha256': digest(web / 'package.json'),
        'lockSha256': digest(web / 'package-lock.json'),
        'installedLockSha256': digest(web / 'node_modules/.package-lock.json'),
        'toolchain': subprocess.check_output(
            ['node.exe', '-p', '[process.version,process.platform,process.arch,process.versions.modules].join("/")'],
            cwd=web, text=True,
        ).strip(),
    }


def prepare_web(web, *, skip_npm_ci=False):
    """Only reuse a dependency installation stamped by this build and still complete."""
    stamp = web / 'node_modules/.axis-evo-npm-ci.json'
    if skip_npm_ci:
        try:
            recorded = json.loads(stamp.read_text(encoding='utf-8'))
            if recorded != npm_installation(web):
                raise ValueError('The lockfile, installed lockfile or Node installation changed')
            subprocess.run(['npm.cmd', 'ls', '--all', '--include=dev', '--include=optional', '--json'],
                           cwd=web, check=True, stdout=subprocess.DEVNULL)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise ValueError('Cannot use --skip-npm-ci. Run a build without this option first.') from error
    else:
        subprocess.run(['npm.cmd', 'ci'], cwd=web, check=True)
        installation = npm_installation(web)
        # Publish only after npm ci succeeded. A partial record is unusable.
        with tempfile.NamedTemporaryFile(dir=stamp.parent, mode='w', encoding='utf-8', delete=False) as stream:
            temporary = Path(stream.name)
        try:
            temporary.write_text(json.dumps(installation), encoding='utf-8')
            temporary.replace(stamp)
        finally:
            temporary.unlink(missing_ok=True)


def download(cache, spec):
    url, expected = spec
    archive = cache / url.rsplit('/', 1)[-1]
    if not archive.exists():
        with urlopen(url, timeout=60) as response:
            data = response.read(32 * 1024 * 1024 + 1)
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f'Download integrity check failed: {archive.name}')
        archive.write_bytes(data)
    if digest(archive) != expected:
        raise ValueError(f'Cached archive integrity check failed: {archive.name}')
    return archive


def collect_licenses(app, runtime, compiler):
    notices = app / 'licenses'
    notices.mkdir()
    shutil.copyfile(runtime / 'LICENSE.txt', notices / 'CPython.txt')
    shutil.copyfile(compiler.parent / 'COPYING', notices / 'NSIS.txt')
    lock = json.loads((ROOT / 'web/package-lock.json').read_text(encoding='utf-8'))
    for location, spec in lock['packages'].items():
        if not location or spec.get('dev') and location != 'node_modules/vite':
            continue
        source = ROOT / 'web' / location
        if not source.is_dir():
            continue  # platform-specific dependency not bundled by this build
        for candidate in source.iterdir():
            if candidate.is_file() and candidate.name.lower().startswith(('license', 'copying', 'notice')):
                shutil.copyfile(candidate, notices / (location.replace('/', '_') + '_' + candidate.name))
    (notices / 'NOTICE.txt').write_text(
        'Axis-Evo 0.1.0 Preview M7.1, built from https://github.com/startuo/Axis-EVO\n'
        'Third-party Python wheel license files are in runtime/packages/*.dist-info.\n'
        'Font licenses are in app/web/dist/fonts. Edge extension notices are in app/browser/edge-extension/vendor.\n',
        encoding='utf-8',
    )


def installer_lists(stage, install, uninstall):
    dirs = set()
    install_lines, uninstall_lines = [], []
    for item in sorted(stage.rglob('*')):
        if not item.is_file():
            continue
        loc = item.relative_to(stage)
        if any(c in str(item) for c in ('"', '$', '\n', '\r')):
            raise ValueError('A build path cannot be represented in NSIS')
        dirs.update(parent for parent in loc.parents if parent != Path('.'))
        install_lines.extend([f'SetOutPath "$INSTDIR\\{loc.parent}"', f'File "{item}"'])
        uninstall_lines.append(f'Delete "$INSTDIR\\{loc}"')
    uninstall_lines.extend(f'RMDir "$INSTDIR\\{p}"' for p in sorted(dirs, key=lambda p: (-len(p.parts), str(p))))
    install.write_text('\n'.join(install_lines), encoding='utf-8')
    uninstall.write_text('\n'.join(uninstall_lines), encoding='utf-8')


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.local/m7.1-build')
    parser.add_argument('--skip-npm-ci', action='store_true',
                        help='Reuse a previously built, unchanged and complete npm installation')
    args = parser.parse_args()
    if os.name != 'nt' or not os.environ.get('SystemRoot'):
        parser.error('Build on Windows x64')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    cache = output / 'downloads'
    cache.mkdir(exist_ok=True)
    target = output / PRODUCT
    if target.exists():
        parser.error('Choose a new output directory or move the existing installer first')

    build_started = perf_counter()
    try:
        prepare_web(ROOT / 'web', skip_npm_ci=args.skip_npm_ci)
    except ValueError as error:
        parser.error(str(error))
    prepared_at = perf_counter()
    subprocess.run(['npm.cmd', 'run', 'build'], cwd=ROOT / 'web', check=True)
    frontend_at = perf_counter()
    build = Path(tempfile.mkdtemp(prefix='build-', dir=output))
    stage = build / 'payload'
    app, runtime = stage / 'app', stage / 'runtime'
    runtime.mkdir(parents=True)
    for folder in ('src/axis_evo', 'web_api', 'examples', 'web/dist', 'browser/edge-extension'):
        shutil.copytree(ROOT / folder, app / folder,
                        ignore=shutil.ignore_patterns('tests', '__pycache__', '*.pyc', '.pytest_cache'))
    with ZipFile(download(cache, PYTHON)) as archive:
        archive.extractall(runtime)
    with ZipFile(download(cache, NSIS)) as archive:
        archive.extractall(build / 'nsis')
    compiler = build / 'nsis' / 'nsis-3.11' / 'makensis.exe'
    (runtime / 'python313._pth').write_text(
        'python313.zip\n.\npackages\n../app\n../app/src\n', encoding='ascii',
    )
    subprocess.run(['uv', 'pip', 'install', '--target', str(runtime / 'packages'),
                    '--python', str(runtime / 'python.exe'),
                    '--python-version', '3.13', '--python-platform', 'x86_64-pc-windows-msvc',
                    '--only-binary', ':all:', '--require-hashes', '-r', str(HERE / 'requirements.lock')],
                   check=True)
    # Exercise the actual interpreter and credential backend before compiling.
    subprocess.run([str(runtime / 'python.exe'), '-B', '-X', 'utf8', '-c',
                    'from web_api.provider_credentials import _windows_backend; '
                    'from examples import windows_preview; assert _windows_backend() is not None'], check=True)
    collect_licenses(app, runtime, compiler)
    csc = Path(os.environ['SystemRoot']) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    icon = build / 'axis.ico'
    icon_source = ROOT / 'web/public/axis-mark-light.png'
    icon_builder = build / 'IconBuilder.exe'
    subprocess.run([str(csc), '/nologo', '/optimize+', '/reference:System.Drawing.dll',
                    f'/out:{icon_builder}', str(HERE / 'IconBuilder.cs')], check=True)
    subprocess.run([str(icon_builder), str(icon_source), str(icon)], check=True)
    subprocess.run([str(csc), '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
                    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
                    f'/win32icon:{icon}', f'/out:{stage / "Axis-Evo.exe"}', str(HERE / 'AxisLauncher.cs')],
                   check=True)
    install, uninstall = build / 'install.nsh', build / 'uninstall.nsh'
    installer_lists(stage, install, uninstall)
    nsis_started = perf_counter()
    subprocess.run([str(compiler), '/INPUTCHARSET', 'UTF8', f'/DOUTPUT={target}',
                    f'/DAPP_ICON={icon}', f'/DINSTALL_FILES={install}', f'/DUNINSTALL_FILES={uninstall}',
                    f'/DAPP_PAYLOAD={app}',
                    str(HERE / 'setup.nsi')], check=True)
    checksum = digest(target)
    target.with_suffix('.exe.sha256').write_text(f'{checksum}  {target.name}\n', encoding='ascii')
    elapsed = perf_counter()
    print(json.dumps({'installer': str(target), 'sha256': checksum, 'bytes': target.stat().st_size,
                      'payload': str(stage), 'iconSourceSha256': digest(icon_source),
                      'npmCiReused': args.skip_npm_ci, 'timingsMs': {
                          'npmDependencies': round((prepared_at - build_started) * 1000, 1),
                          'frontendBuild': round((frontend_at - prepared_at) * 1000, 1),
                          'payloadPreparation': round((nsis_started - frontend_at) * 1000, 1),
                          'installerAndHash': round((elapsed - nsis_started) * 1000, 1),
                          'total': round((elapsed - build_started) * 1000, 1),
                      }}, ensure_ascii=False))


if __name__ == '__main__':
    main()
