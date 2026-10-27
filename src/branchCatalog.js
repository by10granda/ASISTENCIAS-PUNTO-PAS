export function buildBranchNames(workers, branches) {
  return [...new Set([
    ...workers.map((worker) => worker.branch?.trim()),
    ...branches.map((branch) => branch.name?.trim())
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function includesBranch(branches, name) {
  return branches.some((branch) => branch.toLocaleLowerCase('es') === name.trim().toLocaleLowerCase('es'));
}
