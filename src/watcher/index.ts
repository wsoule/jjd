import type { JjdConfig } from "../config";
import { FsWatcher, type WatcherCallback } from "./fs-watcher";
import { PollWatcher } from "./poll-watcher";

export type Watcher = FsWatcher | PollWatcher;

export function createWatcher(
  config: JjdConfig,
  callback: WatcherCallback
): Watcher {
  if (config.watcher === "poll") {
    return new PollWatcher(config.repoPath, config.pollIntervalMs, callback);
  }
  return new FsWatcher(config.repoPath, config.ignorePaths, callback);
}

export { type WatcherCallback } from "./fs-watcher";
