export interface JjChange {
  changeId: string;
  commitId: string;
  description: string;
  empty: boolean;
  bookmarks: string[];
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface JjFileChange {
  path: string;
  status: FileChangeStatus;
}

export interface JjStatus {
  workingCopy: JjChange;
  fileChanges: JjFileChange[];
  hasConflicts: boolean;
}

export interface JjBookmark {
  name: string;
  present: boolean;
  tracking?: string; // remote tracking ref
}

export interface JjOperation {
  id: string;
  description: string;
  timestamp: string;
}

export interface JjWorkspace {
  name: string;
  path: string;
  active: boolean;
}
