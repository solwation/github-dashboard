import { describe, expect, it } from 'vitest';
import { compactRepositoryOwner, repositoryDisplayName, normalizeRepositoryOwnerDisplay, sidebarRepositoryDisplayName } from '../src/lib/repository-display-name';

describe('combined repository display labels', () => {
  it('shortens one or several selected repositories only when owners agree case-insensitively', () => {
    for (const names of [['owner/First'], ['owner/First', 'OWNER/Second']]) {
      const owner = compactRepositoryOwner(names, true);
      expect(owner).toBe('owner');
      expect(names.map(name => repositoryDisplayName(name, owner))).toEqual(names.map(name => name.split('/')[1]));
      expect(names[0]).toBe('owner/First');
    }
  });
  it('keeps every full name for mixed selected owners even if the visible issues come from one repository', () => {
    const selected = ['owner/same-name', 'another/same-name'];
    const visible = selected.slice(0, 1);
    const owner = compactRepositoryOwner(selected, true);
    expect(owner).toBeNull();
    expect(visible.map(name => repositoryDisplayName(name, owner))).toEqual(['owner/same-name']);
  });
  it('preserves full names for split views, empty or malformed selections, and foreign nested content', () => {
    expect(compactRepositoryOwner(['owner/first'], false)).toBeNull();
    expect(compactRepositoryOwner([], true)).toBeNull();
    for (const name of ['owner', '/repo', 'owner/', 'owner/repo/extra']) expect(compactRepositoryOwner([name], true)).toBeNull();
    expect(repositoryDisplayName('foreign/repo', 'owner')).toBe('foreign/repo');
    expect(repositoryDisplayName('owner/repo/extra', 'owner')).toBe('owner/repo/extra');
  });
  it('recomputes the policy from changed selection without changing canonical IDs or their order', () => {
    const selected = ['owner/one', 'OWNER/two', 'other/three'];
    expect(repositoryDisplayName(selected[0]!, compactRepositoryOwner(selected, true))).toBe('owner/one');
    selected.pop();
    expect(repositoryDisplayName(selected[0]!, compactRepositoryOwner(selected, true))).toBe('one');
    expect(selected).toEqual(['owner/one', 'OWNER/two']);
  });
});

describe('account owner-display choice', () => {
  it('defaults older or invalid account values to Auto', () => {
    for (const value of [undefined, null, false, 'YES', {}]) expect(normalizeRepositoryOwnerDisplay(value)).toBe('auto');
    for (const value of ['auto', 'yes', 'no'] as const) expect(normalizeRepositoryOwnerDisplay(value)).toBe(value);
  });
  it('overrides Auto for shared, mixed, colliding and foreign repository names without changing identity', () => {
    for (const names of [['owner/same', 'OWNER/other'], ['owner/same', 'another/same']]) {
      for (const combined of [true, false]) {
        const owner = compactRepositoryOwner(names, combined);
        expect(names.map(name => repositoryDisplayName(name, owner, 'yes'))).toEqual(names);
        expect(names.map(name => repositoryDisplayName(name, owner, 'no'))).toEqual(names.map(name => name.split('/')[1]));
      }
    }
    expect(repositoryDisplayName('foreign/repo', 'owner', 'no')).toBe('repo');
    expect(repositoryDisplayName('owner/repo/extra', null, 'no')).toBe('owner/repo/extra');
  });
  it('uses sidebar project owners independently of split board layout', () => {
    expect(sidebarRepositoryDisplayName('owner/first', ['owner/first', 'OWNER/second'], 'auto')).toBe('first');
    expect(sidebarRepositoryDisplayName('owner/first', ['owner/first', 'other/second'], 'auto')).toBe('owner/first');
    expect(sidebarRepositoryDisplayName('owner/first', ['owner/first'], 'yes')).toBe('owner/first');
    expect(sidebarRepositoryDisplayName('owner/first', ['owner/first', 'other/second'], 'no')).toBe('first');
  });
});
