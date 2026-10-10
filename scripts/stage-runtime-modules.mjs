import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

// Materialize the traced pnpm graph without symlinks. Installers cannot retain
// pnpm's Windows junctions, and merely dereferencing a root package loses its
// sibling dependencies. Hoist shared packages and nest conflicting versions.
export function stageRuntimeModules(source, target, aliases = []) {
  const packages = new Map();
  function entries(directory) {
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => !name.startsWith('.'))
      .flatMap((name) =>
        name.startsWith('@')
          ? readdirSync(join(directory, name)).map((child) => [
              name + '/' + child,
              join(directory, name, child),
            ])
          : [[name, join(directory, name)]],
      );
  }
  function locate(path) {
    try {
      const actual = realpathSync(path);
      // Next on Windows can retain junctions to the build workspace. Prefer
      // its traced copy so we ship only runtime files and retain one graph.
      const marker = sep + '.pnpm' + sep;
      const offset = actual.lastIndexOf(marker);
      if (offset >= 0) {
        const traced = join(source, '.pnpm', actual.slice(offset + marker.length));
        if (existsSync(traced)) return realpathSync(traced);
      }
      return actual;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  for (const [name, path] of entries(source)) {
    const actual = locate(path);
    if (actual && existsSync(join(actual, 'package.json'))) packages.set(name, actual);
  }
  const store = join(source, '.pnpm');
  if (existsSync(store)) {
    for (const directory of readdirSync(store)) {
      for (const [name, path] of entries(join(store, directory, 'node_modules'))) {
        const actual = locate(path);
        if (actual && existsSync(join(actual, 'package.json')) && !packages.has(name))
          packages.set(name, actual);
      }
    }
  }
  const installed = new Set();
  function install(name, actual, destination, ancestors) {
    if (installed.has(destination)) return;
    installed.add(destination);
    cpSync(actual, destination, {
      recursive: true,
      dereference: true,
      filter: (path) => path !== join(actual, 'node_modules'),
    });
    const metadata = JSON.parse(readFileSync(join(actual, 'package.json'), 'utf8'));
    const dependencies = {
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies,
    };
    const scopeRoot = basename(dirname(actual)).startsWith('@')
      ? dirname(dirname(actual))
      : dirname(actual);
    const visible = new Map(ancestors);
    visible.set(name, actual);
    for (const dependency of Object.keys(dependencies)) {
      const resolved =
        locate(join(actual, 'node_modules', dependency)) ?? locate(join(scopeRoot, dependency));
      if (!resolved || !existsSync(join(resolved, 'package.json'))) continue;
      if ((visible.get(dependency) ?? packages.get(dependency)) === resolved) continue;
      install(dependency, resolved, join(destination, 'node_modules', dependency), visible);
    }
  }
  mkdirSync(target, { recursive: true });
  for (const [name, actual] of packages) install(name, actual, resolve(target, name), new Map());
  for (const [aliasSource, aliasTarget] of aliases) {
    for (const [alias, path] of entries(aliasSource)) {
      const actual = locate(path);
      if (!actual || !existsSync(join(actual, 'package.json'))) continue;
      const { name } = JSON.parse(readFileSync(join(actual, 'package.json'), 'utf8'));
      install(name, actual, join(aliasTarget, alias), new Map());
    }
  }
}
