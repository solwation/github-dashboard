import { inject, provide, type InjectionKey } from 'vue';
import type { Issue, Rules } from '../lib/model';
import type { SubIssue } from '../lib/sub-issues';
interface Context {
  load(repository: string, issue: Issue): Promise<SubIssue[] | null>;
  rules(repository: string): Rules;
  known(repository: string, id: number): Issue | undefined;
  revision(repository: string): number;
}
const key: InjectionKey<Context> = Symbol('sub-issues');
export function provideSubIssues(context: Context) { provide(key, context); }
export function useSubIssues() { return inject(key, undefined); }
