declare module 'issue-parser' {
  interface Action {
    raw: string;
    action: string;
    slug?: string;
    prefix: string;
    issue: string;
  }
  interface Parsed {
    actions: Record<string, Action[]>;
    refs: Action[];
  }
  export default function issueParser(preset: string, options?: { hosts?: string[] }): (text: string) => Parsed;
}
