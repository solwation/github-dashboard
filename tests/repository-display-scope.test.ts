import { expect, it } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { provideRepositoryDisplayNames, useRepositoryDisplayName } from '../src/composables/useRepositoryDisplayName';
import type { RepositoryOwnerDisplay } from '../src/lib/repository-display-name';

it('nested statistics scopes inherit account overrides while preserving their own Auto owner calculation', async () => {
  for (const [preference, expected] of [['auto', 'repo'], ['yes', 'nested/repo'], ['no', 'repo']] as const) {
    const Label = defineComponent({ setup() { const name = useRepositoryDisplayName(() => 'nested/repo'); return () => h('span', name.value); } });
    const Nested = defineComponent({ setup() {
      provideRepositoryDisplayNames(() => ['nested/repo'], () => true);
      return () => h(Label);
    } });
    const Root = defineComponent({ setup() {
      provideRepositoryDisplayNames(() => ['other/one', 'mixed/two'], () => false, () => preference as RepositoryOwnerDisplay);
      return () => h(Nested);
    } });
    expect(await renderToString(createSSRApp(Root))).toBe(`<span>${expected}</span>`);
  }
});
