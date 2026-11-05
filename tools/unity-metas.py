#!/usr/bin/env python3
"""Writes missing Unity .meta files for the com.rabbit.runtime package.

Packages installed from git are immutable, so every file and folder needs a
committed .meta. GUIDs are derived from the package path (stable across runs).
Native plugin metas carry their platform settings; their binaries come from
tools/build-unity-plugins.sh or CI and are listed here even when absent.
"""
import hashlib
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'unity', 'com.rabbit.runtime')
PKG = 'com.rabbit.runtime'

PLUGINS = {
    'Plugins/Linux/x86_64/libsinew_ffi.so': ('Linux', 'x86_64'),
    'Plugins/Windows/x86_64/sinew_ffi.dll': ('Windows', 'x86_64'),
    'Plugins/macOS/libsinew_ffi.dylib': ('OSX', 'AnyCPU'),
    'Plugins/Android/arm64-v8a/libsinew_ffi.so': ('Android', 'ARM64'),
    'Plugins/Android/armeabi-v7a/libsinew_ffi.so': ('Android', 'ARMv7'),
    'Plugins/Android/x86_64/libsinew_ffi.so': ('Android', 'X86_64'),
    'Plugins/iOS/libsinew_ffi.a': ('iOS', 'AnyCPU'),
}


def guid(rel):
    return hashlib.md5(f'{PKG}/{rel}'.encode()).hexdigest()


def folder(rel):
    return f'fileFormatVersion: 2\nguid: {guid(rel)}\nfolderAsset: yes\nDefaultImporter:\n  externalObjects: {{}}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n'


def script(rel):
    return (f'fileFormatVersion: 2\nguid: {guid(rel)}\nMonoImporter:\n  externalObjects: {{}}\n  serializedVersion: 2\n'
            '  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n')


def simple(rel, importer, extra=''):
    return f'fileFormatVersion: 2\nguid: {guid(rel)}\n{importer}:\n  externalObjects: {{}}\n{extra}  userData: \n  assetBundleName: \n  assetBundleVariant: \n'


def plugin(rel, os_name, cpu):
    def entry(first, enabled, settings):
        s = ''.join(f'        {k}: {v}\n' for k, v in settings.items())
        return f'  - first:\n      {first}\n    second:\n      enabled: {enabled}\n      settings:\n{s}'
    data = entry(': Any', 0, {'Exclude Android': 1 if os_name != 'Android' else 0, 'Exclude Editor': 0 if os_name in ('Linux', 'Windows', 'OSX') else 1,
                              'Exclude Linux64': 0 if os_name == 'Linux' else 1, 'Exclude OSXUniversal': 0 if os_name == 'OSX' else 1,
                              'Exclude Win': 1, 'Exclude Win64': 0 if os_name == 'Windows' else 1, 'Exclude iOS': 0 if os_name == 'iOS' else 1})
    if os_name in ('Linux', 'Windows', 'OSX'):
        data += entry('Editor: Editor', 1, {'CPU': cpu, 'DefaultValueInitialized': 'true', 'OS': os_name})
        target = {'Linux': 'Linux64', 'Windows': 'Win64', 'OSX': 'OSXUniversal'}[os_name]
        data += entry(f'Standalone: {target}', 1, {'CPU': cpu})
    elif os_name == 'Android':
        data += entry('Android: Android', 1, {'CPU': cpu})
    elif os_name == 'iOS':
        data += entry('iPhone: iOS', 1, {'AddToEmbeddedBinaries': 'false', 'CPU': 'AnyCPU', 'CompileFlags': '', 'FrameworkDependencies': ''})
    return (f'fileFormatVersion: 2\nguid: {guid(rel)}\nPluginImporter:\n  externalObjects: {{}}\n  serializedVersion: 2\n  iconMap: {{}}\n'
            '  executionOrder: {}\n  defineConstraints: []\n  isPreloaded: 0\n  isOverridable: 0\n  isExplicitlyReferenced: 0\n'
            f'  validateReferences: 1\n  platformData:\n{data}  userData: \n  assetBundleName: \n  assetBundleVariant: \n')


def meta_for(rel, is_dir):
    if is_dir:
        return folder(rel)
    if rel in PLUGINS:
        return plugin(rel, *PLUGINS[rel])
    ext = os.path.splitext(rel)[1]
    if ext == '.cs':
        return script(rel)
    if ext == '.asmdef':
        return simple(rel, 'AssemblyDefinitionImporter')
    if ext == '.shader':
        return simple(rel, 'ShaderImporter', '  defaultTextures: []\n  nonModifiableTextures: []\n')
    if rel == 'package.json':
        return simple(rel, 'PackageManifestImporter')
    return simple(rel, 'TextScriptImporter' if ext in ('.md', '.txt', '.json') else 'DefaultImporter')


def main():
    wrote = 0
    paths = set()
    for dirpath, dirnames, filenames in os.walk(ROOT):
        for d in dirnames:
            rel = os.path.relpath(os.path.join(dirpath, d), ROOT)
            if not d.endswith('~'):  # Unity ignores '~' folders (samples are copied out with their metas)
                paths.add((rel, True))
        for f in filenames:
            if not f.endswith('.meta'):
                paths.add((os.path.relpath(os.path.join(dirpath, f), ROOT), False))
    for rel in PLUGINS:
        paths.add((rel, False))
        parts = rel.split('/')
        for i in range(1, len(parts)):
            paths.add(('/'.join(parts[:i]), True))
    for rel, is_dir in sorted(paths):
        target = os.path.join(ROOT, rel + '.meta')
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if is_dir:
            os.makedirs(os.path.join(ROOT, rel), exist_ok=True)
        content = meta_for(rel, is_dir)
        if not os.path.exists(target) or open(target).read() != content:
            with open(target, 'w') as fh:
                fh.write(content)
            wrote += 1
    print(f'{wrote} meta files written')


if __name__ == '__main__':
    sys.exit(main())
