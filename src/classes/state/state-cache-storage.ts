import * as cache from '@actions/cache';
import * as core from '@actions/core';
import { context } from '@actions/github';
import * as crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IStateStorage } from '../../interfaces/state/state-storage';

const STATE_FILE = 'state.txt';
const STALE_DIR = '56acbeaa-1fef-4c79-8f84-7565e560fb03';

const mkTempDir = (): string => {
  const tmpDir = path.join(os.tmpdir(), STALE_DIR);
  fs.mkdirSync(tmpDir, {recursive: true});
  return tmpDir;
};

const unlinkSafely = (filePath: string) => {
  try {
    fs.unlinkSync(filePath);
  } catch (foo) {
    /* ignore */
  }
};

export class StateCacheStorage implements IStateStorage {
  #restoreCacheKey: string;
  #saveCacheKey: string;

  public constructor() {
    const fixedId = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        workflow: context.workflow,
        job: context.job,
        action: context.action,
      }))
      .digest('hex');
    const variableId = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      runNumber: context.runNumber,
      // NOTE: @actions/github was not rebuilt after github.runAttempt was added
      runAttempt: parseInt(process.env.GITHUB_RUN_ATTEMPT as string, 10),
    }))
    .digest('hex');
    this.#restoreCacheKey = `_state_${fixedId}_`;
    this.#saveCacheKey = `_state_${fixedId}_${variableId}`;
  }

  async save(serializedState: string): Promise<void> {
    const tmpDir = mkTempDir();
    const filePath = path.join(tmpDir, STATE_FILE);
    fs.writeFileSync(filePath, serializedState);

    try {
      await cache.saveCache([path.dirname(filePath)], this.#saveCacheKey);
    } catch (error) {
      core.warning(
        `Saving the state was not successful due to "${
          error.message || 'unknown reason'
        }"`
      );
    } finally {
      unlinkSafely(filePath);
    }
  }

  async restore(): Promise<string> {
    const tmpDir = mkTempDir();
    const filePath = path.join(tmpDir, STATE_FILE);
    unlinkSafely(filePath);
    try {
      await cache.restoreCache([path.dirname(filePath)], this.#restoreCacheKey);

      if (!fs.existsSync(filePath)) {
        core.warning(
          'Unknown error when unpacking the cache, the process starts from the first issue.'
        );
        return '';
      }
      return fs.readFileSync(path.join(tmpDir, STATE_FILE), {
        encoding: 'utf8'
      });
    } catch (error) {
      core.warning(
        `Restoring the state was not successful due to "${
          error.message || 'unknown reason'
        }"`
      );
      return '';
    }
  }
}
